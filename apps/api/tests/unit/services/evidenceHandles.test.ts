/** Verifies citations are constructed solely from returned run-scoped source reads. */
import { expect, it } from 'vitest';

import { materializeEvidence } from '../../../src/services/evidenceHandles.js';
import { fakeRepository, validReport } from '../../fixtures/agentFixtures.js';

function draft() {
  return { ...validReport(), evidence: [{ id: 'e1', handle: 'read-1', startLine: 1, endLine: 1 }] };
}
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
