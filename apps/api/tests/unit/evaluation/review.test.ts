/** Verifies human review score validation and summaries. */
import { expect, it } from 'vitest';
import { gradeReview } from '../../../evaluation/replay/review.js';
import { cases } from '../../../evaluation/replay/cases.js';

const result = {
  runId: 'test',
  mode: 'live-model',
  planned: 20,
  attempted: 20,
  results: cases.map((test) => ({
    caseId: test.id,
    status: 'completed',
    citationsValid: true,
    forbiddenToolCalls: [],
    durationMs: 100,
  })),
};
const review = {
  runId: 'test',
  reviewer: 'Human tester',
  cases: cases.map((test) => ({
    caseId: test.id,
    correct: true,
    rationale: 'Matches the independently reviewed root cause.',
  })),
};
it('requires live results, matching run IDs and unique, complete judgments', () => {
  expect(() => gradeReview({ ...result, mode: 'scripted-replay' }, review)).toThrow();
  expect(() => gradeReview(result, { ...review, runId: 'other' })).toThrow();
  expect(() =>
    gradeReview(result, { ...review, cases: Array(20).fill(review.cases[0]) }),
  ).toThrow();
  expect(() => gradeReview(result, { ...review, cases: review.cases.slice(1) })).toThrow();
});
it('counts incorrect and failed runs against targets and rejects correct grades for failures', () => {
  expect(gradeReview(result, review).passed).toBe(true);
  const lowAccuracy = {
    ...review,
    cases: review.cases.map((item, index) => ({ ...item, correct: index < 15 })),
  };
  expect(gradeReview(result, lowAccuracy)).toMatchObject({
    rootCauseAccuracy: 0.75,
    passed: false,
  });
  expect(() =>
    gradeReview(
      {
        ...result,
        results: result.results.map((item, index) => ({
          ...item,
          status: index ? 'completed' : 'failed',
        })),
      },
      review,
    ),
  ).toThrow();
});
