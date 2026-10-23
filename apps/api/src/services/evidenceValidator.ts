import { reportSchema, type InvestigationReport } from '@reposleuth/shared';
import type { RepositoryRevision, SourceFile } from '../github/RepositoryProvider.js';
import { StopError } from '../agents/budget.js';

/** Only exact lines returned by read_file in this run may be cited. No new network requests. */
export function validateEvidence(value: unknown, revision: RepositoryRevision, reads: SourceFile[]): InvestigationReport {
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) throw new StopError('INVALID_REPORT');
  const report = parsed.data;
  const ids = new Set<string>();
  for (const evidence of report.evidence) {
    if (ids.has(evidence.id) || evidence.commitSha !== revision.commitSha || evidence.endLine < evidence.startLine) throw new StopError('INVALID_EVIDENCE');
    ids.add(evidence.id);
    const file = reads.find(file => file.path === evidence.path && file.commitSha === evidence.commitSha
      && file.startLine <= evidence.startLine && file.endLine >= evidence.endLine);
    const quote = file?.lines.filter(line => line.line >= evidence.startLine && line.line <= evidence.endLine).map(line => line.text).join('\n');
    if (quote !== evidence.quote) throw new StopError('INVALID_EVIDENCE');
  }
  if (report.findings.some(finding => finding.evidenceIds.some(id => !ids.has(id)))) throw new StopError('INVALID_EVIDENCE');
  if (!report.findings.length && !report.unresolvedQuestions.length) throw new StopError('INVALID_REPORT');
  return report;
}
