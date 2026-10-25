/** Verifies the consistency and case-specific content of illustrative demo investigations. */
import { describe, expect, it } from 'vitest';
import { reportSchema } from '@reposleuth/shared';
import { demoCases, demoForCase } from '../../src/features/demo/demo';
import { demoDetails } from '../../src/features/demo/demoDetails';

describe('demo presentation fixtures', () => {
  it('has distinct risks, questions, uncertainty, fixes and commits for all twenty cases', () => {
    const runs = demoCases.map((test) => demoForCase(test.id));
    for (const values of [
      runs.map((run) => run.commitSha),
      runs.map((run) => run.report!.risks[0]),
      runs.map((run) => run.report!.unresolvedQuestions[0]),
      runs.map((run) => run.report!.findings[0]!.uncertainty),
      demoCases.map((test) => demoDetails[test.id]!.code),
    ]) {
      expect(new Set(values).size).toBe(20);
    }
    expect(runs.some((run) => run.report!.evidence.length === 2)).toBe(true);
    expect(runs.some((run) => run.report!.evidence.length === 3)).toBe(true);
  });
  it.each(demoCases)('$id has consistent fixture metrics and exact evidence ranges', (test) => {
    const run = demoForCase(test.id);
    expect(reportSchema.safeParse(run.report).success).toBe(true);
    expect(run.request.issueNumber).toBe(42);
    expect(run.durationMs).toBeGreaterThan(0);
    expect(Date.parse(run.finishedAt!) - Date.parse(run.startedAt!)).toBe(run.durationMs);
    expect(run.usage.inputTokens).toBeGreaterThan(0);
    expect(run.usage.outputTokens).toBeGreaterThan(0);
    expect(run.usage.requests).toBeGreaterThan(0);
    expect(run.usage.estimatedCostUsd).toBeGreaterThan(0);
    for (const evidence of run.report!.evidence) {
      expect(evidence.commitSha).toBe(run.commitSha);
      expect(evidence.commitSha).toMatch(/^[a-f0-9]{40}$/);
      expect(evidence.quote).toBe(
        test.source
          .split('\n')
          .slice(evidence.startLine - 1, evidence.endLine)
          .join('\n'),
      );
      expect(run.report!.findings[0]!.evidenceIds).toContain(evidence.id);
    }
    expect(demoDetails[test.id]!.explanation.length).toBeGreaterThan(40);
  });
});
