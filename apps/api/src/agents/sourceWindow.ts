/** Returns an exact, citeable source window within provider, quote and tool-output limits. */
import {
  RepositoryError,
  type RepositoryProvider,
  type SourceFile,
} from '../github/RepositoryProvider.js';

export async function sourceWindow(
  repository: RepositoryProvider,
  path: string,
  startLine: number,
  endLine: number,
  handle: string,
  byteLimit: number,
  check: () => void,
  metadata: Record<string, unknown> = {},
) {
  let end = Math.min(endLine, startLine + 199);
  let file: SourceFile;
  for (;;) {
    check();
    try {
      file = await repository.readFile(path, startLine, end);
      break;
    } catch (error) {
      if (!(error instanceof RepositoryError) || error.code !== 'OUTPUT_LIMIT' || end <= startLine)
        throw error;
      end = startLine + Math.floor((end - startLine) / 2);
    }
  }
  const result = () => ({
    ...file,
    ...metadata,
    evidenceHandle: handle,
    requestedEndLine: endLine,
    nextStartLine: file.endLine < Math.min(endLine, file.totalLines) ? file.endLine + 1 : null,
  });
  while (file.lines.length) {
    const value = result();
    const json = JSON.stringify(value);
    const quote = file.lines.map((line) => line.text).join('\n');
    if (quote.length <= 4000 && json.length <= 30000 && Buffer.byteLength(json) <= byteLimit) {
      check();
      return { file, value };
    }
    file = { ...file, lines: file.lines.slice(0, -1), endLine: file.endLine - 1 };
  }
  return null;
}
