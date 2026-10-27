/** Exercises mechanical grading, isolated semantic judgments, uncertainty and no-spend defaults. */
import { expect, it, vi } from 'vitest';

import { gradingArguments } from '../../../evaluation/benchmarks/grade.js';
import {
  type Answer,
  gradeAttempt,
  type Judgment,
  savedRunSchema,
} from '../../../evaluation/benchmarks/grading.js';
import { savedInvestigation } from '../../fixtures/savedInvestigation.js';

const run = () => savedRunSchema.parse(savedInvestigation());
const answer = (): Answer => ({
  id: 'case-01',
  repository: run().request.repository,
  issueNumber: run().request.issueNumber!,
  commitSha: run().commitSha!,
  answer: {
    rootCause: 'Repeated database calls',
    fix: 'Batch calls',
    evidence: [run().report!.evidence[0]!],
  },
});
const source = () => run().report!.evidence[0]!.quote;
const judgment: Judgment = {
  rootCause: 2,
  evidenceRelevance: 2,
  fix: 2,
  uncertainty: 2,
  uncertain: false,
  rationale: 'The source supports this diagnosis and targeted fix.',
  alternativesAreCauses: true,
  counterEvidenceAssessed: true,
};

it('does not infer correctness from a completed report and exact citations', async () => {
  const result = await gradeAttempt(run(), answer(), source);
  expect(result).toMatchObject({ status: 'unscored', citations: 'valid', judgments: [] });
});
it('keeps failed attempts unscored without invoking the judge', async () => {
  const judge = vi.fn();
  const r = run();
  r.status = 'failed';
  r.report = null;
  r.errorCode = 'INVALID_EVIDENCE';
  expect(await gradeAttempt(r, answer(), source, judge)).toMatchObject({
    status: 'failed',
    judgments: [],
  });
  expect(judge).not.toHaveBeenCalled();
});
it.each(['revision', 'quote', 'source'] as const)(
  'blocks semantic judging on %s mismatch',
  async (kind) => {
    const judge = vi.fn();
    const r = run();
    if (kind === 'revision') r.commitSha = 'f'.repeat(40);
    if (kind === 'quote') r.report!.evidence[0]!.quote = 'invented';
    const result = await gradeAttempt(
      r,
      answer(),
      kind === 'source'
        ? () => {
            throw new Error('unavailable');
          }
        : source,
      judge,
    );
    expect(result.status).not.toBe('pass');
    expect(judge).not.toHaveBeenCalled();
  },
);
it('uses a separate judgment and retains incorrect diagnoses even with valid quotes', async () => {
  const judge = vi.fn(async () => ({ ...judgment, rootCause: 0 }));
  const result = await gradeAttempt(run(), answer(), source, judge);
  expect(result).toMatchObject({ status: 'fail', citations: 'valid' });
  expect(judge).toHaveBeenCalledOnce();
});
it('requests another assessment for Deep coverage gaps and exposes disagreement', async () => {
  const r = run();
  r.request.mode = 'deep';
  const judge = vi
    .fn()
    .mockResolvedValueOnce(judgment)
    .mockResolvedValueOnce({ ...judgment, rootCause: 1 });
  const result = await gradeAttempt(r, answer(), source, judge);
  expect(result.status).toBe('uncertain');
  expect(result.flags).toContain('DEEP_COUNTER_EVIDENCE_MISSING');
  expect(judge).toHaveBeenCalledTimes(2);
  expect(judge.mock.calls[0]).toEqual(judge.mock.calls[1]);
});
it('marks fixes mislabeled as alternatives using the semantic evaluator', async () => {
  const r = run();
  r.request.mode = 'deep';
  const result = await gradeAttempt(r, answer(), source, async () => ({
    ...judgment,
    alternativesAreCauses: false,
  }));
  expect(result.flags).toContain('DEEP_SEMANTIC_COVERAGE_GAP');
});
it('does not convert judge transport or budget errors into a passing result', async () => {
  const result = await gradeAttempt(run(), answer(), source, async () => {
    throw new Error('private transport');
  });
  expect(result).toMatchObject({ status: 'unverified', error: 'JUDGE_FAILED_OR_BUDGET_STOPPED' });
  expect(JSON.stringify(result)).not.toContain('private transport');
});
it('requires explicit opt-in and a bounded budget for paid judging', () => {
  expect(gradingArguments([])).toMatchObject({ judge: false });
  for (const args of [
    ['--judge'],
    ['--max-usd', '0.1'],
    ['--judge', '--max-usd', 'NaN'],
    ['--judge', '--max-usd', '2'],
  ])
    expect(() => gradingArguments(args)).toThrow();
  expect(gradingArguments(['--judge', '--max-usd', '0.10'])).toMatchObject({
    judge: true,
    maxUsd: 0.1,
  });
});

it('retains preflight failures even without a pinned revision', async () => {
  const r = run();
  r.status = 'failed';
  r.commitSha = null;
  r.report = null;
  r.errorCode = 'ISSUE_NOT_FOUND';
  expect(await gradeAttempt(r, answer(), source)).toMatchObject({
    status: 'failed',
    error: 'ISSUE_NOT_FOUND',
  });
});
it('uses recorded read paths without mistaking citation count for files examined', async () => {
  const r = run();
  r.request.mode = 'deep';
  const result = await gradeAttempt(r, answer(), source, undefined, ['src/a.ts', 'src/b.ts']);
  expect(result.examinedPaths).toHaveLength(2);
  expect(result.flags).not.toContain('MULTIPLE_PATHS_NOT_DEMONSTRATED_BY_CITATIONS');
  expect(result.flags).toContain('DEEP_COUNTER_EVIDENCE_MISSING');
});
