/** Verifies citations are constructed solely from returned run-scoped source reads. */
import { RunContext } from '@openai/agents';
import { expect, it } from 'vitest';

import { createTools } from '../../../src/agents/tools.js';
import type { SourceFile } from '../../../src/github/RepositoryProvider.js';
import { materializeEvidence } from '../../../src/services/evidenceHandles.js';
import { EvidenceValidationError } from '../../../src/services/evidenceValidator.js';
import { fakeRepository, validReport } from '../../fixtures/agentFixtures.js';

function draft() {
  return { ...validReport(), evidence: [{ id: 'e1', handle: 'read-1', startLine: 1, endLine: 1 }] };
}
it('accepts a handle-only exact window but rejects half-specified ranges', async () => {
  const repo = fakeRepository();
  const file = await repo.readFile('src/customers.ts', 1, 1);
  const whole = {
    ...validReport(),
    evidence: [{ id: 'e1', handle: 'read-1', startLine: null, endLine: null }],
  };
  expect(materializeEvidence(whole, repo.revision, [file]).evidence).toEqual(
    validReport().evidence,
  );
  expect(() =>
    materializeEvidence(
      { ...whole, evidence: [{ id: 'e1', handle: 'read-1', startLine: 1, endLine: null }] },
      repo.revision,
      [file],
    ),
  ).toThrow();
});
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

it('returns a fitting window immediately and exposes continuation', async () => {
  const repo = fakeRepository();
  const base = await repo.readFile('src/customers.ts', 1, 1);
  repo.readFile = async (_path, start, end) => ({
    ...base,
    startLine: start,
    endLine: end,
    totalLines: 20,
    lines: Array.from({ length: end - start + 1 }, (_, i) => ({
      line: start + i,
      text: '�'.repeat(100),
    })),
  });
  const reads: SourceFile[] = [];
  const read = createTools(
    repo,
    reads,
    () => {},
    () => {},
    5,
    undefined,
    1024,
  ).find((t) => t.name === 'read_file')!;
  const blocked = JSON.parse(
    String(
      await read.invoke(
        new RunContext(),
        JSON.stringify({ path: base.path, startLine: 1, endLine: 20 }),
      ),
    ),
  );
  expect(blocked.evidenceHandle).toBe('read-1');
  expect(blocked.startLine).toBe(1);
  expect(blocked.endLine).toBeLessThan(20);
  expect(blocked.nextStartLine).toBe(blocked.endLine + 1);
  expect(Buffer.byteLength(JSON.stringify(blocked))).toBeLessThanOrEqual(1024);
  expect(reads).toHaveLength(1);
  expect(reads[0]!.endLine).toBe(blocked.endLine);
});

it.each([
  'REVERSED_RANGE',
  'OUTSIDE_READ',
  'MISSING_LINES',
  'EMPTY_QUOTE',
  'QUOTE_TOO_LONG',
] as const)('explains %s using only backend numeric metadata', async (problem) => {
  const repo = fakeRepository();
  const file = await repo.readFile('src/customers.ts', 1, 1);
  const report = draft();
  report.summary = 'private rejected prose';
  report.evidence[0]!.id = 'private-id';
  if (problem === 'REVERSED_RANGE') report.evidence[0]!.startLine = 2;
  if (problem === 'OUTSIDE_READ') report.evidence[0]!.endLine = 2;
  if (problem === 'MISSING_LINES') file.lines = [];
  if (problem === 'EMPTY_QUOTE') file.lines[0]!.text = '';
  if (problem === 'QUOTE_TOO_LONG') file.lines[0]!.text = 'private source'.repeat(400);
  let caught: unknown;
  try {
    materializeEvidence(report, repo.revision, [file]);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(EvidenceValidationError);
  if (!(caught instanceof EvidenceValidationError)) throw new Error('Expected rejection');
  expect(caught.code).toBe('INVALID_EVIDENCE');
  expect(caught.rangeDiagnostic).toMatchObject({
    problem,
    readIndex: 1,
    available: { startLine: 1, endLine: 1 },
  });
  expect(JSON.stringify(caught.rangeDiagnostic)).not.toContain('private');
  if (problem === 'QUOTE_TOO_LONG') expect(caught.rangeDiagnostic?.quoteCharacters).toBe(5600);
});
it('does not infer an available range from an unknown handle', async () => {
  const repo = fakeRepository();
  const file = await repo.readFile('src/customers.ts', 1, 1);
  const report = draft();
  report.evidence[0]!.handle = 'private unknown handle';
  try {
    materializeEvidence(report, repo.revision, [file]);
    throw new Error('Expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(EvidenceValidationError);
    if (!(error instanceof EvidenceValidationError)) throw error;
    expect(error.reason).toBe('UNKNOWN_HANDLE');
    expect(error.rangeDiagnostic).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('private');
  }
});
