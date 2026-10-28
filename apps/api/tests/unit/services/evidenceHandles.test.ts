/** Verifies citations are constructed solely from returned run-scoped source reads. */
import { RunContext } from '@openai/agents';
import { expect, it } from 'vitest';

import { createTools } from '../../../src/agents/tools.js';
import type { SourceFile } from '../../../src/github/RepositoryProvider.js';
import { materializeEvidence } from '../../../src/services/evidenceHandles.js';
import { fakeRepository, validReport } from '../../fixtures/agentFixtures.js';

function draft() {
  return { ...validReport(), evidence: [{ id: 'e1', handle: 'read-1', startLine: 1, endLine: 1 }] };
}
it('withholds oversized UTF-8 source without issuing a handle when the allowance shrinks', async () => {
  const repo = fakeRepository();
  const file = await repo.readFile('src/customers.ts', 1, 1);
  file.lines[0]!.text = 'é'.repeat(700);
  repo.readFile = async () => file;
  const reads: SourceFile[] = [];
  let limit = 1024;
  const read = createTools(
    repo,
    reads,
    () => {},
    () => {},
    24,
    () => true,
    () => limit,
  ).find((t) => t.name === 'read_file')!;
  const args = JSON.stringify({ path: file.path, startLine: 1, endLine: 1 });
  expect(JSON.parse(String(await read.invoke(new RunContext(), args)))).toMatchObject({
    error: 'OUTPUT_LIMIT',
  });
  expect(reads).toHaveLength(0);
  limit = 8000;
  expect(JSON.parse(String(await read.invoke(new RunContext(), args)))).toMatchObject({
    evidenceHandle: 'read-1',
  });
  expect(reads).toHaveLength(1);
});
it('constructs exact source metadata and preserves explanatory references', async () => {
  const repo = fakeRepository();
  const file = await repo.readFile('src/customers.ts', 1, 1);
  const report = materializeEvidence(draft(), repo.revision, [file]);
  expect(report.evidence).toEqual(validReport().evidence);
  expect(report.findings).toEqual(validReport().findings);
});
it('does not accept handles from a run without the corresponding read', () => {
  expect(() => materializeEvidence(draft(), fakeRepository().revision, [])).toThrow(
    expect.objectContaining({ reason: 'UNKNOWN_HANDLE' }),
  );
});
it.each(['unknown', 'range', 'duplicate', 'injected', 'gapped'] as const)(
  'rejects %s evidence',
  async (kind) => {
    const repo = fakeRepository();
    const file = await repo.readFile('src/customers.ts', 1, 1);
    const report = draft();
    if (kind === 'unknown') report.evidence[0]!.handle = 'read-99';
    if (kind === 'range') report.evidence[0]!.endLine = 2;
    if (kind === 'duplicate') report.evidence.push({ ...report.evidence[0]! });
    if (kind === 'gapped') file.lines = [];
    const value =
      kind === 'injected'
        ? { ...report, evidence: [{ ...report.evidence[0], quote: 'fabricated' }] }
        : report;
    expect(() => materializeEvidence(value, repo.revision, [file])).toThrow();
  },
);
it('preserves whitespace and blank lines in a selected subrange', async () => {
  const repo = fakeRepository();
  const file = await repo.readFile('src/customers.ts', 1, 1);
  file.endLine = 3;
  file.lines = [
    { line: 1, text: '  first();' },
    { line: 2, text: '' },
    { line: 3, text: '\tlast();' },
  ];
  const report = draft();
  report.evidence[0]!.startLine = 2;
  report.evidence[0]!.endLine = 3;
  expect(materializeEvidence(report, repo.revision, [file]).evidence[0]?.quote).toBe('\n\tlast();');
});
