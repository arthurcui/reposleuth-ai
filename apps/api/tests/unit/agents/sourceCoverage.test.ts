/** Verifies coverage gaps survive journal eviction and disappear only after delivered reads. */
import { expect, it } from 'vitest';

import { unreadRanges } from '../../../src/agents/sourceCoverage.js';
import { WorkingContext } from '../../../src/agents/workingContext.js';
import type { SourceFile } from '../../../src/github/RepositoryProvider.js';
import { fakeRepository } from '../../fixtures/agentFixtures.js';

const source = (startLine: number, endLine: number): SourceFile => ({
  ...fakeRepository().revision,
  path: 'large.ts',
  startLine,
  endLine,
  totalLines: 300,
  lines: Array.from({ length: endLine - startLine + 1 }, (_, i) => ({
    line: startLine + i,
    text: 'source();',
  })),
});
it('subtracts delivered intervals without hiding internal gaps or unrelated files', () => {
  const pending = unreadRanges(
    [
      { path: 'large.ts', startLine: 1, endLine: 100 },
      { path: 'large.ts', startLine: 50, endLine: 150 },
      { path: 'other.ts', startLine: 1, endLine: 10 },
    ],
    [source(1, 30), source(60, 80), source(101, 150)],
  );
  expect(pending).toEqual([
    { path: 'large.ts', startLine: 31, endLine: 59 },
    { path: 'large.ts', startLine: 81, endLine: 100 },
    { path: 'other.ts', startLine: 1, endLine: 10 },
  ]);
});
it('retains continuation beyond four tool results and clears it after the remainder is read', () => {
  const reads = [source(1, 100)],
    context = new WorkingContext({}, reads);
  context.record(
    'read_definition',
    JSON.stringify({
      ...reads[0],
      evidenceHandle: 'read-1',
      definitionStartLine: 1,
      definitionEndLine: 300,
      nextStartLine: 101,
    }),
  );
  for (let i = 0; i < 8; i++) context.record('find_files', JSON.stringify({ items: [] }));
  expect(context.snapshot().unreadSourceRanges).toEqual([
    { path: 'large.ts', startLine: 101, endLine: 300 },
  ]);
  reads.push(source(101, 300));
  expect(context.snapshot().unreadSourceRanges).toEqual([]);
});
it('records both unexamined sides of a focused definition read', () => {
  const reads = [source(230, 260)],
    context = new WorkingContext({}, reads);
  context.record(
    'read_definition',
    JSON.stringify({
      ...reads[0],
      evidenceHandle: 'read-1',
      definitionStartLine: 100,
      definitionEndLine: 300,
      requestedEndLine: 260,
      nextStartLine: null,
    }),
  );
  expect(context.pendingRanges()).toEqual([
    { path: 'large.ts', startLine: 100, endLine: 229 },
    { path: 'large.ts', startLine: 261, endLine: 300 },
  ]);
});
