/** Compares explicit semantic assessments without confusing completion with diagnosis correctness. */
import { z } from 'zod';

export const reliabilityObservationSchema = z.object({
  engine: z.enum(['baseline', 'candidate']),
  caseId: z.string(),
  model: z.string(),
  repeat: z.number().int().nonnegative(),
  inputHash: z.string().min(1),
  settingsHash: z.string().min(1),
  completed: z.boolean(),
  citationsValid: z.boolean(),
  assessment: z.enum(['supported', 'appropriate_abstention', 'unsupported', 'unreviewed']),
  relevantImplementationReached: z.boolean(),
  estimatedCostUsd: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  hardLimitViolation: z.boolean(),
});
export type ReliabilityObservation = z.infer<typeof reliabilityObservationSchema>;
export function compareReliability(values: unknown) {
  const rows = z.array(reliabilityObservationSchema).parse(values);
  const key = (row: ReliabilityObservation) => JSON.stringify([row.caseId, row.model, row.repeat]);
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.engine + key(row);
    if (seen.has(id)) throw new Error('DUPLICATE_ATTEMPT');
    seen.add(id);
  }
  const baselines = new Map(rows.filter((r) => r.engine === 'baseline').map((r) => [key(r), r]));
  const candidates = rows.filter((r) => r.engine === 'candidate');
  if (
    !baselines.size ||
    baselines.size !== candidates.length ||
    candidates.some((c) => {
      const b = baselines.get(key(c));
      return !b || b.inputHash !== c.inputHash || b.settingsHash !== c.settingsHash;
    })
  )
    throw new Error('INCOMPARABLE_CAMPAIGN');
  const summary = (engine: ReliabilityObservation['engine']) => {
    const data = rows.filter((r) => r.engine === engine);
    return {
      attempts: data.length,
      completed: data.filter((r) => r.completed).length,
      supported: data.filter((r) => r.completed && r.citationsValid && r.assessment === 'supported')
        .length,
      appropriateAbstentions: data.filter(
        (r) => r.completed && r.citationsValid && r.assessment === 'appropriate_abstention',
      ).length,
      unsupported: data.filter((r) => r.assessment === 'unsupported').length,
      unreviewed: data.filter((r) => r.assessment === 'unreviewed').length,
      relevantImplementationReached: data.filter((r) => r.relevantImplementationReached).length,
      estimatedCostUsd: data.reduce((sum, r) => sum + r.estimatedCostUsd, 0),
      durationMs: data.reduce((sum, r) => sum + r.durationMs, 0),
      hardLimitViolations: data.filter((r) => r.hardLimitViolation).length,
    };
  };
  const baseline = summary('baseline'),
    candidate = summary('candidate');
  return {
    baseline,
    candidate,
    readyForComparison:
      baseline.unreviewed === 0 &&
      candidate.unreviewed === 0 &&
      candidate.hardLimitViolations === 0,
    note: 'Explicit assessments are inputs, not proof of correctness. Completion and citation fidelity alone never count as supported diagnosis.',
  };
}
