/** Grades saved benchmark attempts with deterministic source checks and an optional isolated AI judge. */
import { createHash } from 'node:crypto';

import { investigationRequestSchema, reportSchema } from '@reposleuth/shared';
import { z } from 'zod';

export const savedRunSchema = z
  .object({
    id: z.string(),
    request: investigationRequestSchema,
    status: z.string(),
    commitSha: z.string().nullable(),
    report: reportSchema.nullable(),
    model: z.string(),
    durationMs: z.number().nonnegative(),
    errorCode: z.string().nullable(),
    usage: z.object({ estimatedCostUsd: z.number().nonnegative() }).passthrough(),
  })
  .passthrough();
export const answerSchema = z.object({
  id: z.string(),
  repository: z.string(),
  issueNumber: z.number().int().positive(),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  answer: z
    .object({
      rootCause: z.string(),
      fix: z.string(),
      evidence: z
        .array(
          z.object({
            path: z.string(),
            startLine: z.number().int().positive(),
            endLine: z.number().int().positive(),
            quote: z.string(),
          }),
        )
        .min(1),
    })
    .passthrough(),
});
export type SavedRun = z.infer<typeof savedRunSchema>;
export type Answer = z.infer<typeof answerSchema>;
const score = z.number().int().min(0).max(2);
export const judgmentSchema = z.object({
  rootCause: score,
  evidenceRelevance: score,
  fix: score,
  uncertainty: score,
  uncertain: z.boolean(),
  rationale: z.string().min(10).max(3000),
  alternativesAreCauses: z.boolean(),
  counterEvidenceAssessed: z.boolean(),
});
export type Judgment = z.infer<typeof judgmentSchema>;
export type Judge = (input: string) => Promise<Judgment>;
export type SourceReader = (repository: string, commit: string, path: string) => string;
export const GRADER_VERSION = 'benchmark-grader-v2';

export async function gradeAttempt(
  run: SavedRun,
  answer: Answer,
  source: SourceReader,
  judge?: Judge,
  observedPaths?: string[],
) {
  const flags: string[] = [];
  const judgments: Judgment[] = [];
  const result = (status: string, citations: string, error: string | null = null) => ({
    runId: run.id,
    caseId: answer.id,
    model: run.model,
    mode: run.request.mode ?? 'legacy-default',
    status,
    citations,
    flags,
    judgments,
    error,
    sourceCommit: run.commitSha,
    investigationCostUsd: run.usage.estimatedCostUsd,
    durationMs: run.durationMs,
    examinedPaths: observedPaths ?? null,
    depthStatus:
      run.request.mode !== 'deep'
        ? 'not-applicable'
        : flags.length
          ? 'gap'
          : judgments.length &&
              judgments.every(
                (j) => !j.uncertain && j.alternativesAreCauses && j.counterEvidenceAssessed,
              )
            ? 'ai-supported'
            : 'unverified',
    graderVersion: GRADER_VERSION,
    reviewType: 'automated; not independent human validation',
  });
  if (
    run.request.repository !== answer.repository ||
    run.request.issueNumber !== answer.issueNumber
  )
    return result('incomparable', 'unchecked', 'CASE_OR_REVISION_MISMATCH');
  if (run.status !== 'completed' || !run.report)
    return result('failed', 'unchecked', run.errorCode ?? 'NO_ACCEPTED_REPORT');
  if (run.commitSha !== answer.commitSha)
    return result('incomparable', 'unchecked', 'CASE_OR_REVISION_MISMATCH');
  const report = run.report;
  const excerpts: { path: string; startLine: number; endLine: number; quote: string }[] = [];
  const ids = new Set<string>();
  try {
    // Check the private answer references too, so stale answer keys cannot silently grade new source.
    for (const e of answer.answer.evidence) {
      const lines = source(answer.repository, answer.commitSha, e.path).split(/\r?\n/);
      if (
        e.endLine < e.startLine ||
        e.endLine > lines.length ||
        lines.slice(e.startLine - 1, e.endLine).join('\n') !== e.quote
      )
        return result('incomparable', 'unchecked', 'ANSWER_SOURCE_MISMATCH');
      excerpts.push(e);
    }
    for (const e of report.evidence) {
      const lines = source(answer.repository, answer.commitSha, e.path).split(/\r?\n/);
      if (
        ids.has(e.id) ||
        e.commitSha !== answer.commitSha ||
        e.endLine < e.startLine ||
        e.endLine > lines.length ||
        lines.slice(e.startLine - 1, e.endLine).join('\n') !== e.quote
      )
        return result('failed', 'invalid', 'INVALID_CITATION');
      ids.add(e.id);
      excerpts.push(e);
    }
  } catch {
    return result('unverified', 'unverified', 'PINNED_SOURCE_UNAVAILABLE');
  }
  const reasoning = report.reasoningSummary;
  const references = [
    ...report.findings,
    ...(reasoning ? [reasoning, ...reasoning.alternatives, ...reasoning.counterEvidence] : []),
  ];
  if (references.some((item) => item.evidenceIds.some((id) => !ids.has(id))))
    return result('failed', 'invalid', 'UNKNOWN_EVIDENCE_REFERENCE');
  if (run.request.mode === 'deep') {
    if (!reasoning || reasoning.alternatives.length < 2) flags.push('DEEP_ALTERNATIVES_MISSING');
    if (!reasoning?.counterEvidence.length) flags.push('DEEP_COUNTER_EVIDENCE_MISSING');
    if (
      observedPaths
        ? new Set(observedPaths).size < 2
        : new Set(report.evidence.map((e) => e.path)).size < 2
    )
      flags.push(
        observedPaths
          ? 'DEEP_MULTIPLE_READ_PATHS_MISSING'
          : 'MULTIPLE_PATHS_NOT_DEMONSTRATED_BY_CITATIONS',
      );
  }
  if (!judge) return result('unscored', 'valid');
  const input = JSON.stringify({
    question: run.request.question,
    mode: run.request.mode ?? 'legacy-default',
    report,
    expected: answer.answer,
    pinnedSource: excerpts,
  });
  if (Buffer.byteLength(input) > 60000) return result('unverified', 'valid', 'JUDGE_INPUT_LIMIT');
  const inputHash = createHash('sha256').update(input).digest('hex');
  try {
    judgments.push(judgmentSchema.parse(await judge(input)));
    // A second independent call sees the original evidence, never the first judge's answer.
    if (judgments[0]!.uncertain || flags.length)
      judgments.push(judgmentSchema.parse(await judge(input)));
  } catch {
    return { ...result('unverified', 'valid', 'JUDGE_FAILED_OR_BUDGET_STOPPED'), inputHash };
  }
  const first = judgments[0]!;
  const conflict = judgments.some(
    (j) =>
      j.uncertain ||
      j.rootCause !== first.rootCause ||
      j.evidenceRelevance !== first.evidenceRelevance ||
      j.fix !== first.fix ||
      j.uncertainty !== first.uncertainty ||
      j.alternativesAreCauses !== first.alternativesAreCauses ||
      j.counterEvidenceAssessed !== first.counterEvidenceAssessed,
  );
  if (
    run.request.mode === 'deep' &&
    judgments.some((j) => !j.alternativesAreCauses || !j.counterEvidenceAssessed)
  )
    flags.push('DEEP_SEMANTIC_COVERAGE_GAP');
  const status = conflict
    ? 'uncertain'
    : first.rootCause === 2 && first.evidenceRelevance === 2 && first.fix === 2
      ? 'pass'
      : 'fail';
  return { ...result(status, 'valid'), inputHash };
}
