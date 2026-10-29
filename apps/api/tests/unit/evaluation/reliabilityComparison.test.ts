/** Checks frozen comparison alignment, failed attempts and quality claims without paid judges. */
import { expect, it } from 'vitest';

import { reliabilityCases } from '../../../evaluation/reliability/cases.js';
import {
  compareReliability,
  type ReliabilityObservation,
} from '../../../evaluation/reliability/comparison.js';
const row: ReliabilityObservation = {
  engine: 'baseline',
  caseId: 'test',
  model: 'model',
  repeat: 0,
  inputHash: 'source-and-issue',
  settingsHash: 'limits-and-model-settings',
  completed: true,
  citationsValid: true,
  assessment: 'unreviewed',
  relevantImplementationReached: false,
  estimatedCostUsd: 0.01,
  durationMs: 100,
  hardLimitViolation: false,
};
it('does not count completed reports as supported diagnoses', () => {
  const result = compareReliability([row, { ...row, engine: 'candidate' }]);
  expect(result.candidate.completed).toBe(1);
  expect(result.candidate.supported).toBe(0);
  expect(result.readyForComparison).toBe(false);
});
it('keeps failed attempts and appropriate abstention separate', () => {
  const result = compareReliability([
    { ...row, completed: false, assessment: 'unsupported' },
    { ...row, engine: 'candidate', assessment: 'appropriate_abstention' },
  ]);
  expect(result.baseline.completed).toBe(0);
  expect(result.baseline.unsupported).toBe(1);
  expect(result.candidate.appropriateAbstentions).toBe(1);
  expect(result.candidate.supported).toBe(0);
});
it.each(['inputHash', 'settingsHash', 'repeat'] as const)('rejects changed %s', (field) => {
  expect(() =>
    compareReliability([
      row,
      { ...row, engine: 'candidate', [field]: field === 'repeat' ? 1 : 'changed' },
    ]),
  ).toThrow('INCOMPARABLE_CAMPAIGN');
});
it('rejects duplicate attempts and tracks hard limit violations', () => {
  expect(() => compareReliability([row, row, { ...row, engine: 'candidate' }])).toThrow(
    'DUPLICATE_ATTEMPT',
  );
  const result = compareReliability([
    { ...row, assessment: 'supported' },
    { ...row, engine: 'candidate', assessment: 'supported', hardLimitViolation: true },
  ]);
  expect(result.readyForComparison).toBe(false);
});
it('includes abstention, misleading symptoms and multi-file cases without runtime answer imports', () => {
  expect(reliabilityCases).toHaveLength(4);
  expect(reliabilityCases.some((c) => Object.keys(c.files).length === 2)).toBe(true);
  expect(reliabilityCases.some((c) => c.expected.outcome === 'insufficient_evidence')).toBe(true);
});
