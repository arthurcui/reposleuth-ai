/** Checks report citations against retrieved source so unsupported evidence is rejected. */
import { type InvestigationReport, reportSchema } from '@reposleuth/shared';

import { StopError } from '../agents/budget.js';
import type { RepositoryRevision, SourceFile } from '../github/RepositoryProvider.js';

export type EvidenceFailure =
  | 'DUPLICATE_ID'
  | 'COMMIT_MISMATCH'
  | 'INVALID_LINE_RANGE'
  | 'SOURCE_NOT_READ'
  | 'QUOTE_MISMATCH'
  | 'UNKNOWN_EVIDENCE_ID';
export class EvidenceValidationError extends StopError {
  constructor(
    public readonly reason: EvidenceFailure,
    public readonly evidenceIndex?: number,
  ) {
    super('INVALID_EVIDENCE');
  }
}

/** Only exact lines returned by read_file in this run may be cited. No new network requests. */
export function validateEvidence(
  value: unknown,
  revision: RepositoryRevision,
  reads: SourceFile[],
): InvestigationReport {
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) throw new StopError('INVALID_REPORT');
  const report = parsed.data;
  const ids = new Set<string>();
  for (const [index, evidence] of report.evidence.entries()) {
    if (ids.has(evidence.id)) throw new EvidenceValidationError('DUPLICATE_ID', index + 1);
    if (evidence.commitSha !== revision.commitSha)
      throw new EvidenceValidationError('COMMIT_MISMATCH', index + 1);
    if (evidence.endLine < evidence.startLine)
      throw new EvidenceValidationError('INVALID_LINE_RANGE', index + 1);
    ids.add(evidence.id);
    const file = reads.find(
      (file) =>
        file.path === evidence.path &&
        file.commitSha === evidence.commitSha &&
        file.startLine <= evidence.startLine &&
        file.endLine >= evidence.endLine,
    );
    if (!file) throw new EvidenceValidationError('SOURCE_NOT_READ', index + 1);
    const quote = file.lines
      .filter((line) => line.line >= evidence.startLine && line.line <= evidence.endLine)
      .map((line) => line.text)
      .join('\n');
    if (quote !== evidence.quote) throw new EvidenceValidationError('QUOTE_MISMATCH', index + 1);
  }
  if (report.findings.some((finding) => finding.evidenceIds.some((id) => !ids.has(id))))
    throw new EvidenceValidationError('UNKNOWN_EVIDENCE_ID');
  const reasoning = report.reasoningSummary;
  if (
    reasoning &&
    [reasoning, ...reasoning.alternatives, ...reasoning.counterEvidence].some((item) =>
      item.evidenceIds.some((id) => !ids.has(id)),
    )
  )
    throw new EvidenceValidationError('UNKNOWN_EVIDENCE_ID');
  if (!report.findings.length && !report.unresolvedQuestions.length)
    throw new StopError('INVALID_REPORT');
  return report;
}
