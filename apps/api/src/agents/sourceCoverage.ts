/** Tracks requested-but-unread intervals using actual delivered source, never inferred behavior. */
import type { SourceFile } from '../github/RepositoryProvider.js';

export type SourceRange = { path: string; startLine: number; endLine: number };
export function unreadRanges(requested: SourceRange[], reads: SourceFile[]): SourceRange[] {
  const merged: SourceRange[] = [];
  for (const range of [...requested].sort(
    (a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine,
  )) {
    const previous = merged.at(-1);
    if (previous?.path === range.path && range.startLine <= previous.endLine + 1)
      previous.endLine = Math.max(previous.endLine, range.endLine);
    else merged.push({ ...range });
  }
  let pending = merged;
  for (const read of reads) {
    pending = pending.flatMap((range) => {
      if (
        range.path !== read.path ||
        read.endLine < range.startLine ||
        read.startLine > range.endLine
      )
        return [range];
      const remaining: SourceRange[] = [];
      if (read.startLine > range.startLine)
        remaining.push({ ...range, endLine: read.startLine - 1 });
      if (read.endLine < range.endLine) remaining.push({ ...range, startLine: read.endLine + 1 });
      return remaining;
    });
  }
  return pending;
}
