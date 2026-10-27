/** Resolves run-scoped source handles into exact, backend-owned report citations. */
import { reasoningSummarySchema, reportSchema } from '@reposleuth/shared';
import { z } from 'zod';

import { StopError } from '../agents/budget.js';
import type { RepositoryRevision, SourceFile } from '../github/RepositoryProvider.js';
import { EvidenceValidationError, validateEvidence } from './evidenceValidator.js';

export const draftReportSchema = reportSchema.extend({
  reasoningSummary: reasoningSummarySchema,
  evidence: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(40),
        handle: z.string().min(1).max(80),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
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
    if (
      item.endLine < item.startLine ||
      item.startLine < file.startLine ||
      item.endLine > file.endLine
    )
      throw new EvidenceValidationError('INVALID_LINE_RANGE', index + 1);
    const lines = file.lines.filter(
      (line) => line.line >= item.startLine && line.line <= item.endLine,
    );
    if (
      lines.length !== item.endLine - item.startLine + 1 ||
      lines.some((line, i) => line.line !== item.startLine + i)
    )
      throw new EvidenceValidationError('INVALID_LINE_RANGE', index + 1);
    const quote = lines.map((line) => line.text).join('\n');
    if (!quote.length || quote.length > 4000)
      throw new EvidenceValidationError('INVALID_LINE_RANGE', index + 1);
    return {
      id: item.id,
      path: file.path,
      commitSha: file.commitSha,
      startLine: item.startLine,
      endLine: item.endLine,
      quote,
    };
  });
  return validateEvidence({ ...draft, evidence }, revision, reads);
}
