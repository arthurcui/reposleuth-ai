/** Reads public GitHub repositories and issues through Octokit at a pinned revision. */
import { Octokit } from '@octokit/rest';

import {
  isSourcePath,
  LIMITS,
  parseRepository,
  searchIndex,
  splitSource,
  validatePath,
} from './repositoryIndex.js';
import {
  type BoundedResult,
  type CodeMatch,
  type CommitSummary,
  type FileDiff,
  type IssueDetails,
  RepositoryError,
  type RepositoryProvider,
  type RepositoryRevision,
  type SourceFile,
} from './RepositoryProvider.js';

interface TreeFile {
  path: string;
  sha: string;
  size: number;
}
const shaPattern = /^[a-f0-9]{40}$/i;
const clip = (value: string | null | undefined) => (value ?? '').slice(0, LIMITS.textCharacters);

export class OctokitProvider implements RepositoryProvider {
  readonly revision: Readonly<RepositoryRevision>;
  private requests = 0;
  private filesPromise?: Promise<{ files: TreeFile[]; warnings: string[] }>;
  private indexPromise?: Promise<{ index: Map<string, string[]>; warnings: string[] }>;
  private readonly cache = new Map<string, string[]>();
  private cacheBytes = 0;
  private readonly allowedCommits = new Map<string, Set<string>>();

  private constructor(
    private readonly client: Octokit,
    private readonly owner: string,
    private readonly repo: string,
    sha: string,
    private readonly treeSha: string,
  ) {
    this.revision = Object.freeze({ repository: `${owner}/${repo}`, commitSha: sha });
  }

  static async connect(
    repository: string,
    options: { token?: string; client?: Octokit; commitSha?: string } = {},
  ): Promise<OctokitProvider> {
    const { owner, repo } = parseRepository(repository);
    if (options.commitSha !== undefined && !shaPattern.test(options.commitSha))
      throw new RepositoryError('INVALID_REVISION', 'Expected a full commit SHA.');
    const client =
      options.client ??
      new Octokit({ auth: options.token, request: { timeout: 15000, redirect: 'error' } });
    // No caller-supplied host or remote URL is ever sent to Octokit.
    try {
      const { data: metadata } = await client.rest.repos.get({ owner, repo });
      if (metadata.private !== false || (metadata.visibility && metadata.visibility !== 'public'))
        throw new RepositoryError('PRIVATE_REPOSITORY', 'Only public repositories are supported.');
      const { data: commit } = await client.rest.repos.getCommit({
        owner,
        repo,
        ref: options.commitSha ?? metadata.default_branch,
        per_page: 1,
      });
      if (options.commitSha && commit.sha.toLowerCase() !== options.commitSha.toLowerCase())
        throw new RepositoryError(
          'INVALID_REVISION',
          'Returned commit did not match the requested revision.',
        );
      if (!shaPattern.test(commit.sha) || !shaPattern.test(commit.commit.tree.sha))
        throw new RepositoryError(
          'INVALID_REVISION',
          'GitHub did not return a valid commit and tree.',
        );
      return new OctokitProvider(client, owner, repo, commit.sha, commit.commit.tree.sha);
    } catch (error) {
      throw safeError(error);
    }
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    if (this.requests >= LIMITS.requests)
      throw new RepositoryError(
        'REQUEST_LIMIT',
        'Repository request budget exhausted; start a new investigation.',
      );
    this.requests++;
    try {
      return await action();
    } catch (error) {
      throw safeError(error);
    }
  }

  private files() {
    this.filesPromise ??= this.call(async () => {
      const { data } = await this.client.rest.git.getTree({
        owner: this.owner,
        repo: this.repo,
        tree_sha: this.treeSha,
        recursive: '1',
      });
      const warnings: string[] = [];
      if (data.truncated)
        warnings.push('GitHub truncated the tree; file discovery and search are incomplete.');
      let excluded = 0;
      const files: TreeFile[] = [];
      for (const item of data.tree) {
        if (item.type !== 'blob') continue;
        if (!item.path || !item.sha || !shaPattern.test(item.sha)) {
          excluded++;
          continue;
        }
        try {
          validatePath(item.path);
        } catch {
          excluded++;
          continue;
        }
        if (
          !['100644', '100755'].includes(item.mode ?? '') ||
          !isSourcePath(item.path) ||
          item.size === undefined ||
          item.size > LIMITS.fileBytes ||
          item.size < 0
        ) {
          excluded++;
          continue;
        }
        if (files.length < LIMITS.files)
          files.push({ path: item.path, sha: item.sha, size: item.size });
        else excluded++;
      }
      if (excluded)
        warnings.push(`${excluded} files excluded by path, type, size, or tree limits.`);
      files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return { files, warnings };
    });
    return this.filesPromise;
  }

  async listFiles(prefix = ''): Promise<BoundedResult<string>> {
    validatePath(prefix, true);
    const { files, warnings } = await this.files();
    const matching = files.filter((file) => file.path.startsWith(prefix));
    return {
      ...this.revision,
      items: matching.slice(0, LIMITS.listedFiles).map((file) => file.path),
      truncated: matching.length > LIMITS.listedFiles || warnings.length > 0,
      warnings: [
        ...warnings,
        ...(matching.length > LIMITS.listedFiles
          ? ['File listing capped at 500 paths. Narrow the prefix.']
          : []),
      ],
    };
  }

  private async source(file: TreeFile): Promise<string[]> {
    const cached = this.cache.get(file.path);
    if (cached) return cached;
    const { data } = await this.call(() =>
      this.client.rest.git.getBlob({ owner: this.owner, repo: this.repo, file_sha: file.sha }),
    );
    if (
      data.size === null ||
      data.size > LIMITS.fileBytes ||
      data.content.length > LIMITS.fileBytes * 2
    )
      throw new RepositoryError(
        'FILE_TOO_LARGE',
        'File exceeds the source size limit or its size is unavailable.',
      );
    if (data.encoding !== 'base64')
      throw new RepositoryError('UNSUPPORTED_ENCODING', 'Only UTF-8 source blobs are supported.');
    const bytes = Buffer.from(data.content, 'base64');
    if (bytes.length > LIMITS.fileBytes)
      throw new RepositoryError('FILE_TOO_LARGE', 'File exceeds the source size limit.');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new RepositoryError('BINARY_FILE', 'File is not UTF-8 source text.');
    }
    // eslint-disable-next-line no-control-regex -- Detect binary control bytes, allowing tabs and newlines.
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
      throw new RepositoryError('BINARY_FILE', 'File contains binary control characters.');
    const lines = splitSource(text);
    if (this.cacheBytes + bytes.length <= LIMITS.indexBytes) {
      this.cache.set(file.path, lines);
      this.cacheBytes += bytes.length;
    }
    return lines;
  }

  async readFile(path: string, startLine: number, endLine: number): Promise<SourceFile> {
    validatePath(path);
    if (
      !Number.isSafeInteger(startLine) ||
      !Number.isSafeInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine ||
      endLine - startLine >= LIMITS.readLines
    )
      throw new RepositoryError(
        'INVALID_RANGE',
        'Read 1–200 lines using positive integer line numbers.',
      );
    const file = (await this.files()).files.find((file) => file.path === path);
    if (!file)
      throw new RepositoryError(
        'FILE_UNAVAILABLE',
        'Path is missing or excluded at the pinned revision.',
      );
    const lines = await this.source(file);
    if (startLine > lines.length)
      throw new RepositoryError('INVALID_RANGE', 'Start line is beyond the end of the file.');
    const selected = lines.slice(startLine - 1, endLine);
    if (selected.join('\n').length > LIMITS.readCharacters)
      throw new RepositoryError(
        'OUTPUT_LIMIT',
        'Requested source exceeds 24,000 characters; choose a smaller range.',
      );
    return {
      ...this.revision,
      path,
      startLine,
      endLine: startLine + selected.length - 1,
      totalLines: lines.length,
      lines: selected.map((text, index) => ({ line: startLine + index, text })),
    };
  }

  private async buildIndex() {
    const { files, warnings: discoveryWarnings } = await this.files();
    const warnings = [...discoveryWarnings];
    const index = new Map<string, string[]>();
    let bytes = 0;
    let visited = 0;
    for (const file of files) {
      if (visited >= LIMITS.indexedFiles || bytes + file.size > LIMITS.indexBytes) {
        warnings.push(
          'Search index reached the 40-file / 2 MiB limit; remaining files were not searched.',
        );
        break;
      }
      visited++;
      bytes += file.size;
      try {
        index.set(file.path, await this.source(file));
      } catch (error) {
        if (
          error instanceof RepositoryError &&
          ['BINARY_FILE', 'UNSUPPORTED_ENCODING', 'FILE_TOO_LARGE'].includes(error.code)
        ) {
          warnings.push(`Skipped non-source file: ${file.path}`);
        } else throw error;
      }
    }
    return { index, warnings };
  }

  async searchCode(query: string): Promise<BoundedResult<CodeMatch>> {
    searchIndex(new Map(), query); // Validate before any network requests.
    this.indexPromise ??= this.buildIndex();
    const { index, warnings } = await this.indexPromise;
    const result = searchIndex(index, query);
    return {
      ...this.revision,
      items: result.matches,
      truncated: result.truncated || warnings.length > 0,
      warnings: [
        ...warnings,
        ...(result.truncated ? ['Search results capped at 30 matching lines.'] : []),
      ],
    };
  }

  async getIssue(number: number): Promise<IssueDetails> {
    if (!Number.isSafeInteger(number) || number < 1)
      throw new RepositoryError('INVALID_ISSUE', 'Issue number must be a positive integer.');
    const { data } = await this.call(() =>
      this.client.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: number }),
    );
    if (data.pull_request)
      throw new RepositoryError(
        'NOT_AN_ISSUE',
        'The supplied number identifies a pull request, not an issue.',
      );
    const comments = data.comments
      ? (
          await this.call(() =>
            this.client.rest.issues.listComments({
              owner: this.owner,
              repo: this.repo,
              issue_number: number,
              per_page: LIMITS.comments + 1,
              page: 1,
            }),
          )
        ).data
      : [];
    const truncated =
      data.comments > LIMITS.comments ||
      comments.length > LIMITS.comments ||
      (data.body?.length ?? 0) > LIMITS.textCharacters ||
      data.title.length > LIMITS.textCharacters ||
      comments
        .slice(0, LIMITS.comments)
        .some((comment) => (comment.body?.length ?? 0) > LIMITS.textCharacters);
    return {
      ...this.revision,
      number,
      title: clip(data.title),
      body: clip(data.body),
      state: data.state,
      comments: comments.slice(0, LIMITS.comments).map((comment) => clip(comment.body)),
      truncated,
      warnings: truncated
        ? ['Issue text or comments were truncated (20 comments, 8,000 characters per field).']
        : [],
      retrievedAt: new Date().toISOString(),
    };
  }

  async getCommits(path: string): Promise<BoundedResult<CommitSummary>> {
    validatePath(path);
    const { data } = await this.call(() =>
      this.client.rest.repos.listCommits({
        owner: this.owner,
        repo: this.repo,
        sha: this.revision.commitSha,
        path,
        per_page: LIMITS.commits + 1,
        page: 1,
      }),
    );
    const selected = data.slice(0, LIMITS.commits);
    this.allowedCommits.set(path, new Set(selected.map((commit) => commit.sha)));
    const truncated =
      data.length > LIMITS.commits ||
      selected.some((commit) => commit.commit.message.length > LIMITS.textCharacters);
    return {
      ...this.revision,
      items: selected.map((commit) => ({ sha: commit.sha, message: clip(commit.commit.message) })),
      truncated,
      warnings: truncated ? ['Commit history or messages were truncated.'] : [],
    };
  }

  async getFileDiff(commitSha: string, path: string): Promise<FileDiff> {
    validatePath(path);
    if (!shaPattern.test(commitSha))
      throw new RepositoryError('INVALID_COMMIT', 'Use a full 40-character commit SHA.');
    if (!this.allowedCommits.has(path)) await this.getCommits(path);
    if (!this.allowedCommits.get(path)?.has(commitSha))
      throw new RepositoryError(
        'UNRELATED_COMMIT',
        'Choose a commit from getCommits for this path at the pinned revision.',
      );
    for (let page = 1; page <= LIMITS.diffPages; page++) {
      const response = await this.call(() =>
        this.client.rest.repos.getCommit({
          owner: this.owner,
          repo: this.repo,
          ref: commitSha,
          per_page: 100,
          page,
        }),
      );
      const file = response.data.files?.find((file) => file.filename === path);
      if (file) {
        const truncated = !file.patch || file.patch.length > LIMITS.readCharacters;
        return {
          ...this.revision,
          changeCommitSha: commitSha,
          path,
          status: file.status,
          patch: file.patch?.slice(0, LIMITS.readCharacters) ?? null,
          truncated,
          warnings: truncated
            ? [
                'Patch unavailable or truncated. GitHub patches are historical context, not validated source evidence.',
              ]
            : [],
        };
      }
      if (!response.headers.link?.includes('rel="next"')) break;
    }
    throw new RepositoryError(
      'DIFF_UNAVAILABLE',
      'File diff not found within the first 300 changed files.',
    );
  }
}

function safeError(error: unknown): RepositoryError {
  if (error instanceof RepositoryError) return error;
  const status =
    typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  if (status === 404)
    return new RepositoryError('NOT_FOUND', 'Repository or resource not found, or not accessible.');
  if (status === 401)
    return new RepositoryError(
      'AUTHENTICATION',
      'GitHub authentication failed. Check the server-side token.',
    );
  if (status === 403 || status === 429)
    return new RepositoryError(
      'RATE_LIMIT_OR_FORBIDDEN',
      'GitHub denied the request or its rate limit was reached. Retry later.',
    );
  if (status === 409)
    return new RepositoryError('EMPTY_REPOSITORY', 'Repository has no readable commits.');
  return new RepositoryError(
    'GITHUB_UNAVAILABLE',
    'GitHub request failed or timed out. Retry later.',
  );
}
