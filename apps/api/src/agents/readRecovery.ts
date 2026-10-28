/** Suggests a bounded retry without returning source or registering evidence from withheld reads. */
import type { SourceFile } from '../github/RepositoryProvider.js';

export function readRecovery(file: SourceFile, evidenceHandle: string, maxBytes: number) {
  let count = file.lines.length;
  while (count > 0) {
    const candidate = {
      ...file,
      endLine: file.startLine + count - 1,
      lines: file.lines.slice(0, count),
      evidenceHandle,
    };
    const text = JSON.stringify(candidate);
    if (text.length <= 30000 && Buffer.byteLength(text) <= maxBytes) break;
    count--;
  }
  return {
    error: 'OUTPUT_LIMIT',
    totalLines: file.totalLines,
    suggestedRange: count
      ? { startLine: file.startLine, endLine: file.startLine + count - 1 }
      : null,
    message: count
      ? 'Source withheld. Retry this path with suggestedRange if budget permits; the allowance can change. No evidence handle was issued.'
      : 'Source withheld: even the first line exceeds the allowance. Choose another relevant range or file. No evidence handle was issued.',
  };
}
