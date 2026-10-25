/** Validates human evaluation scores and summarizes reviewed investigation quality. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const resultSchema = z.object({
  runId: z.string(),
  mode: z.literal('live-model'),
  planned: z.literal(20),
  attempted: z.literal(20),
  results: z
    .array(
      z.object({
        caseId: z.string(),
        status: z.string(),
        citationsValid: z.boolean(),
        forbiddenToolCalls: z.array(z.string()),
        durationMs: z.number().nonnegative(),
      }),
    )
    .length(20),
});
const reviewSchema = z.object({
  runId: z.string(),
  reviewer: z.string().trim().min(1),
  cases: z
    .array(
      z.object({ caseId: z.string(), correct: z.boolean(), rationale: z.string().trim().min(10) }),
    )
    .length(20),
});

/** Human judgments are explicit inputs. Never infer correctness from oracle replay. */
export function gradeReview(result: unknown, review: unknown) {
  const run = resultSchema.parse(result);
  const judgments = reviewSchema.parse(review);
  if (run.runId !== judgments.runId) throw new Error('Review belongs to a different run');
  const ids = new Set(run.results.map((item) => item.caseId));
  if (
    ids.size !== 20 ||
    new Set(judgments.cases.map((item) => item.caseId)).size !== 20 ||
    judgments.cases.some((item) => !ids.has(item.caseId))
  )
    throw new Error('Review must cover each case exactly once');
  const correct = judgments.cases.filter((item) => item.correct);
  if (
    correct.some(
      (item) => run.results.find((result) => result.caseId === item.caseId)!.status !== 'completed',
    )
  )
    throw new Error('A failed investigation cannot be graded correct');
  const completed = run.results.filter((item) => item.status === 'completed');
  const completionRate = completed.length / 20;
  const rootCauseAccuracy = correct.length / 20;
  const citationsValid = completed.length > 0 && completed.every((item) => item.citationsValid);
  const noForbiddenTools = run.results.every((item) => !item.forbiddenToolCalls.length);
  const p95DurationMs = run.results.map((item) => item.durationMs).sort((a, b) => a - b)[18]!;
  return {
    runId: run.runId,
    reviewer: judgments.reviewer,
    completionRate,
    rootCauseAccuracy,
    citationsValid,
    noForbiddenTools,
    p95DurationMs,
    passed:
      completionRate >= 0.95 &&
      rootCauseAccuracy >= 0.8 &&
      citationsValid &&
      noForbiddenTools &&
      p95DurationMs < 90000,
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const [resultPath, reviewPath] = process.argv.slice(2);
    if (!resultPath || !reviewPath) throw new Error('Provide result and review paths');
    const grade = gradeReview(
      JSON.parse(readFileSync(resultPath, 'utf8')),
      JSON.parse(readFileSync(reviewPath, 'utf8')),
    );
    writeFileSync(`${resultPath}.reviewed.json`, JSON.stringify(grade, null, 2));
    console.log(JSON.stringify(grade, null, 2));
    if (!grade.passed) process.exitCode = 1;
  } catch {
    console.error(
      'Review rejected: requires a complete 20-case live-model run and matching, unique human judgments with rationale.',
    );
    process.exitCode = 1;
  }
}
