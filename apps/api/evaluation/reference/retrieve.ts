/** Fixed, answer-blind source retrieval for the one-request reference experiment. */
import type { RepositoryProvider, SourceFile } from '../../src/github/RepositoryProvider.js';

const ignored = new Set(
  'the and for that this with from when what should investigate relevant code find explain likely root cause recommend fix issue github repository'.split(
    ' ',
  ),
);

export function retrievalTerms(text: string) {
  const words = [
    ...new Set(text.slice(0, 12000).match(/[A-Za-z][A-Za-z0-9_]{2,63}/g) ?? []),
  ].filter((word) => !ignored.has(word.toLowerCase()));
  // Identifiers precede ordinary words; ties preserve the reporter's order.
  return words
    .sort((a, b) => Number(/[a-z][A-Z]|_/.test(b)) - Number(/[a-z][A-Z]|_/.test(a)))
    .slice(0, 4);
}

export async function retrieveReference(
  repository: RepositoryProvider,
  text: string,
  check: () => void,
  maxCalls: number,
) {
  let calls = 0;
  const reads: SourceFile[] = [];
  const gaps: string[] = [];
  const terms = retrievalTerms(text);
  const candidates: { path: string; line: number; score: number }[] = [];
  const call = async <T>(fn: () => Promise<T>) => {
    check();
    if (calls >= maxCalls) {
      gaps.push('Repository call allowance exhausted.');
      return undefined;
    }
    calls++;
    const result = await fn();
    check();
    return result;
  };
  for (const term of terms) {
    const files = await call(() => repository.findFiles(term));
    if (files?.truncated) gaps.push(`Filename results truncated for ${term}.`);
    for (const path of files?.items.slice(0, 8) ?? []) candidates.push({ path, line: 1, score: 1 });
    const matches = await call(() => repository.searchCode(term));
    if (matches?.truncated) gaps.push(`Source search truncated for ${term}.`);
    for (const match of matches?.items.slice(0, 8) ?? [])
      candidates.push({ path: match.path, line: match.line, score: 2 });
  }
  // A bounded listing is a fallback, not evidence that the repository was fully searched.
  if (!candidates.length) {
    const listing = await call(() => repository.listFiles());
    if (listing?.truncated) gaps.push('Fallback file listing truncated.');
    for (const path of listing?.items.slice(0, 100) ?? [])
      candidates.push({ path, line: 1, score: 0 });
  }
  const source = /\.(?:[cm]?[jt]sx?|cs|java|py|go|rs)$/i;
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  let bytes = 0;
  for (const candidate of candidates.filter((item) => source.test(item.path))) {
    if (reads.length >= 6) {
      gaps.push('Six source-window limit reached.');
      break;
    }
    if (
      reads.some(
        (read) =>
          read.path === candidate.path &&
          candidate.line >= read.startLine &&
          candidate.line <= read.endLine,
      )
    )
      continue;
    const start = Math.max(1, candidate.line - 12);
    const file = await call(() => repository.readFile(candidate.path, start, start + 79));
    if (!file) break;
    // Keep exact, contiguous lines; never truncate a line and then cite it as exact source.
    const kept: SourceFile = { ...file, lines: [] };
    for (const line of file.lines) {
      const proposed = { ...kept, endLine: line.line, lines: [...kept.lines, line] };
      if (bytes + Buffer.byteLength(JSON.stringify(proposed)) > 18000) break;
      kept.lines.push(line);
      kept.endLine = line.line;
    }
    if (kept.lines.length) {
      reads.push(kept);
      bytes += Buffer.byteLength(JSON.stringify(kept));
    }
    if (kept.lines.length < file.lines.length) {
      gaps.push('Source byte allowance exhausted.');
      break;
    }
    if (file.startLine > 1 || file.endLine < file.totalLines)
      gaps.push(`Only a window of ${file.path} was read.`);
  }
  return { reads, terms, calls, gaps: [...new Set(gaps)], bytes };
}
