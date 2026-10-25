/** Verifies deterministic evaluation results across the synthetic defect corpus. */
import { describe, expect, it } from 'vitest';
import { cases } from '../../../evaluation/replay/cases.js';
import { runCase } from '../../../evaluation/replay/runner.js';
import { expectedReport, fixtureRepository } from '../../../evaluation/replay/fixtures.js';
import { validateEvidence } from '../../../src/services/evidenceValidator.js';

describe('curated evaluation corpus (scripted replay, not model accuracy)', () => {
  it('has twenty distinct cases covering all six defect families', () => {
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map((test) => test.id)).size).toBe(20);
    expect(new Set(cases.map((test) => test.source)).size).toBe(20);
    expect(new Set(cases.map((test) => test.category)).size).toBe(6);
  });
  it.each(cases)('$id exercises the SDK, tools, storage and citation validator', async (test) => {
    const result = await runCase(test);
    expect(result.status).toBe('completed');
    expect(result.citationsValid).toBe(true);
    expect(result.forbiddenToolCalls).toEqual([]);
    expect(result.tools).toContain('read_file');
    expect(result.usage.requests).toBe(4);
  });
  it.each(cases)('$id rejects a mutated quote', async (test) => {
    const repository = fixtureRepository(test);
    const report = expectedReport(test);
    report.evidence[0]!.quote += '\n// invented evidence';
    expect(() =>
      validateEvidence(report, repository.revision, [
        {
          ...repository.revision,
          path: test.path,
          startLine: 1,
          endLine: test.source.split('\n').length,
          totalLines: test.source.split('\n').length,
          lines: test.source.split('\n').map((text, index) => ({ line: index + 1, text })),
        },
      ]),
    ).toThrow('INVALID_EVIDENCE');
  });
});
