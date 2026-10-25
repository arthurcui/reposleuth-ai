/** Builds and searches a bounded source index while filtering unsafe or unsupported paths. */
/* eslint-disable no-control-regex -- Deliberate rejection of control characters in untrusted inputs. */
import { RepositoryError, type CodeMatch } from './RepositoryProvider.js';

export const LIMITS = Object.freeze({
  files: 5000,
  listedFiles: 500,
  fileBytes: 128 * 1024,
  indexedFiles: 40,
  indexBytes: 2 * 1024 * 1024,
  matches: 30,
  readLines: 200,
  readCharacters: 24000,
  snippetCharacters: 300,
  comments: 20,
  textCharacters: 8000,
  commits: 10,
  diffPages: 3,
  requests: 55,
});

export function parseRepository(input: string): { owner: string; repo: string } {
  let value = input.trim();
  if (/[\\%\x00-\x20]/.test(value) || /(^|\/)\.{1,2}(\/|$)/.test(value)) {
    throw new RepositoryError(
      'INVALID_REPOSITORY',
      'Repository identifiers cannot contain traversal, escapes, or whitespace.',
    );
  }
  if (value.startsWith('https://')) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new RepositoryError('INVALID_REPOSITORY', 'Invalid GitHub URL.');
    }
    if (
      url.hostname !== 'github.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new RepositoryError(
        'INVALID_REPOSITORY',
        'Use an HTTPS github.com repository URL without credentials, query, or fragment.',
      );
    }
    value = url.pathname.slice(1).replace(/\/$/, '');
  }
  value = value.replace(/\.git$/, '');
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/.exec(value);
  if (!match || match[2] === '.' || match[2] === '..') {
    throw new RepositoryError(
      'INVALID_REPOSITORY',
      'Use owner/repo or https://github.com/owner/repo.',
    );
  }
  return { owner: match[1]!, repo: match[2]! };
}

export function validatePath(path: string, prefix = false): void {
  const normalized = prefix ? path.replace(/\/$/, '') : path;
  if (prefix && path === '') return;
  if (
    !normalized ||
    normalized.length > 1024 ||
    /[\\\x00-\x1f\x7f]/.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new RepositoryError(
      'INVALID_PATH',
      'Use a repository-relative path without traversal or control characters.',
    );
  }
}

export function isSourcePath(path: string): boolean {
  return (
    !/(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next)(\/|$)/i.test(path) &&
    !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.env(?:\..*)?)$/i.test(path) &&
    !/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp[34]|exe|dll|map|min\.js)$/i.test(path)
  );
}

export function splitSource(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Literal, case-sensitive search; user input is never interpreted as a regex. */
export function searchIndex(index: ReadonlyMap<string, string[]>, query: string) {
  if (query.length < 2 || query.length > 200 || /[\r\n\x00]/.test(query)) {
    throw new RepositoryError('INVALID_QUERY', 'Search requires 2–200 characters on one line.');
  }
  const matches: CodeMatch[] = [];
  for (const [path, lines] of index) {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]!;
      const position = text.indexOf(query);
      if (position < 0) continue;
      if (matches.length === LIMITS.matches) return { matches, truncated: true };
      const offset = Math.max(0, position - 40);
      matches.push({
        path,
        line: i + 1,
        snippet: text.slice(offset, offset + LIMITS.snippetCharacters),
        snippetTruncated: offset > 0 || text.length > LIMITS.snippetCharacters,
      });
    }
  }
  return { matches, truncated: false };
}
