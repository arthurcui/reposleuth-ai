/** Defines the repository read interface, result types, and domain errors. */
export interface RepositoryRevision {
  repository: string;
  commitSha: string;
}

export interface BoundedResult<T> extends RepositoryRevision {
  items: T[];
  truncated: boolean;
  warnings: string[];
  nextOffset?: number | null;
}

export interface SourceLine {
  line: number;
  text: string;
}
export interface SourceFile extends RepositoryRevision {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  lines: SourceLine[];
}
export interface CodeMatch {
  path: string;
  line: number;
  snippet: string;
  snippetTruncated: boolean;
}
export interface CommitSummary {
  sha: string;
  message: string;
}
export interface IssueDetails extends RepositoryRevision {
  number: number;
  title: string;
  body: string;
  state: string;
  comments: string[];
  truncated: boolean;
  warnings: string[];
  retrievedAt: string;
}
export interface FileDiff extends RepositoryRevision {
  changeCommitSha: string;
  path: string;
  patch: string | null;
  status: string;
  truncated: boolean;
  warnings: string[];
}

/** All methods retrieve data only. One instance represents one immutable source revision.
 * Issues/comments are live metadata and carry a retrieval timestamp instead.
 */
export interface RepositoryProvider {
  readonly revision: Readonly<RepositoryRevision>;
  getIssue(number: number): Promise<IssueDetails>;
  listFiles(prefix?: string, offset?: number): Promise<BoundedResult<string>>;
  findFiles(query: string, scope?: string): Promise<BoundedResult<string>>;
  searchCode(query: string, scope?: string): Promise<BoundedResult<CodeMatch>>;
  readFile(path: string, startLine: number, endLine: number): Promise<SourceFile>;
  getCommits(path: string): Promise<BoundedResult<CommitSummary>>;
  getFileDiff(commitSha: string, path: string): Promise<FileDiff>;
}

export class RepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/** Safe, structured range recovery data; never contains provider response text or source. */
export class SourceRangeError extends RepositoryError {
  constructor(
    public readonly reason:
      'INVALID_LINE_NUMBERS' | 'REVERSED_RANGE' | 'TOO_MANY_LINES' | 'START_AFTER_EOF',
    public readonly totalLines?: number,
  ) {
    super('INVALID_RANGE', 'Choose a valid source line range.');
  }
}
