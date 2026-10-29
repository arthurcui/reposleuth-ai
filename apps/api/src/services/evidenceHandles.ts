/** Resolves run-scoped source handles into exact, backend-owned report citations. */
import { reasoningSummarySchema, reportSchema } from '@reposleuth/shared';
import { z } from 'zod';

import { StopError } from '../agents/budget.js';
import type { RepositoryRevision, SourceFile } from '../github/RepositoryProvider.js';
import {
  type EvidenceRangeDiagnostic,
  EvidenceValidationError,
  validateEvidence,
} from './evidenceValidator.js';

export const draftReportSchema = reportSchema.omit({ verification: true }).extend({
  reasoningSummary: reasoningSummarySchema,
  evidence: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(40),
        handle: z.string().min(1).max(80),
        startLine: z.number().int().positive().nullable().optional(),
        endLine: z.number().int().positive().nullable().optional(),
      }),
    )
    .max(20),
});

export function materializeEvidence(
  value: unknown,
  revision: RepositoryRevision,
  reads: SourceFile[],
) {
  const parsed = draftReportSchema.safeParse(value);
  if (!parsed.success) throw new StopError('INVALID_REPORT');
  const draft = parsed.data;
  const evidence = draft.evidence.map((item, index) => {
    const file = reads.find((_, i) => item.handle === `read-${i + 1}`);
    if (!file) throw new EvidenceValidationError('UNKNOWN_HANDLE', index + 1);
    if ((item.startLine == null) !== (item.endLine == null)) throw new StopError('INVALID_REPORT');
    // A handle-only citation selects the exact delivered window, never unseen source.
    const startLine = item.startLine ?? file.startLine;
    const endLine = item.endLine ?? file.endLine;
    const invalidRange = (problem: EvidenceRangeDiagnostic['problem'], quoteCharacters?: number) =>
      new EvidenceValidationError('INVALID_LINE_RANGE', index + 1, {
        problem,
        readIndex: reads.indexOf(file) + 1,
        requested: { startLine, endLine },
        available: { startLine: file.startLine, endLine: file.endLine },
        ...(quoteCharacters === undefined ? {} : { quoteCharacters }),
      });
    if (endLine < startLine) throw invalidRange('REVERSED_RANGE');
    if (startLine < file.startLine || endLine > file.endLine) throw invalidRange('OUTSIDE_READ');
    const lines = file.lines.filter((line) => line.line >= startLine && line.line <= endLine);
    if (
      lines.length !== endLine - startLine + 1 ||
      lines.some((line, i) => line.line !== startLine + i)
    )
      throw invalidRange('MISSING_LINES');
    const quote = lines.map((line) => line.text).join('\n');
    if (!quote.length) throw invalidRange('EMPTY_QUOTE', 0);
    if (quote.length > 4000) throw invalidRange('QUOTE_TOO_LONG', quote.length);
    return {
      id: item.id,
      path: file.path,
      commitSha: file.commitSha,
      startLine,
      endLine,
      quote,
    };
  });
  return validateEvidence({ ...draft, evidence }, revision, reads);
}
