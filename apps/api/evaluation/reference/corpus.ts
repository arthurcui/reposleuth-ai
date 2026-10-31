/** Exposes only issue text and source to the reference comparison, never private expected answers. */
import { createHash } from 'node:crypto';

import { RepositoryError, type RepositoryProvider } from '../../src/github/RepositoryProvider.js';
import { sourceOutline } from '../../src/github/sourceNavigation.js';

export function corpusRepository(id: string, files: Record<string, string>): RepositoryProvider {
  const revision = {
    repository: `fixtures/${id}`,
    commitSha: createHash('sha1').update(JSON.stringify(files)).digest('hex'),
  };
  const result = <T>(items: T[]) => ({ ...revision, items, truncated: false, warnings: [] });
  const source = (path: string) => {
    const text = files[path];
    if (text === undefined) throw new RepositoryError('NOT_FOUND', 'Fixture file missing');
    return text;
  };
  return {
    revision,
    getIssue: () => {
      throw new Error('Comparison supplies the question directly');
    },
    listFiles: async (prefix = '') =>
      result(Object.keys(files).filter((path) => path.startsWith(prefix))),
    findFiles: async (query, scope = '') =>
      result(
        Object.keys(files).filter(
          (path) => path.startsWith(scope) && path.toLowerCase().includes(query.toLowerCase()),
        ),
      ),
    searchCode: async (query, scope = '') =>
      result(
        Object.entries(files)
          .filter(([path]) => path.startsWith(scope))
          .flatMap(([path, text]) =>
            text
              .split('\n')
              .flatMap((snippet, index) =>
                snippet.toLowerCase().includes(query.toLowerCase())
                  ? [{ path, line: index + 1, snippet, snippetTruncated: false }]
                  : [],
              ),
          ),
      ),
    outlineFile: async (path, query) => sourceOutline(revision, path, source(path), query),
    readFile: async (path, startLine, endLine) => {
      const lines = source(path).split('\n');
      if (
        startLine < 1 ||
        startLine > lines.length ||
        endLine < startLine ||
        endLine - startLine >= 200
      )
        throw new RepositoryError('INVALID_RANGE', 'Invalid fixture range');
      const end = Math.min(endLine, lines.length);
      return {
        ...revision,
        path,
        startLine,
        endLine: end,
        totalLines: lines.length,
        lines: lines
          .slice(startLine - 1, end)
          .map((text, index) => ({ line: startLine + index, text })),
      };
    },
    getCommits: async () => result([]),
    getFileDiff: () => {
      throw new RepositoryError('DIFF_UNAVAILABLE', 'No fixture diff');
    },
  };
}
