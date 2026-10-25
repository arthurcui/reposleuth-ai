import { expect, it } from 'vitest';
import { validateEvidence } from './evidenceValidator.js';
import { fakeRepository, validReport } from '../tests/agentFixtures.js';
import type { InvestigationReport } from '@reposleuth/shared';

it.each([
  ['COMMIT_MISMATCH', (r: InvestigationReport) => { r.evidence[0]!.commitSha = 'f'.repeat(40); }],
  ['SOURCE_NOT_READ', (r: InvestigationReport) => { r.evidence[0]!.path = 'unread.ts'; }],
  ['INVALID_LINE_RANGE', (r: InvestigationReport) => { r.evidence[0]!.startLine = 2; }],
  ['QUOTE_MISMATCH', (r: InvestigationReport) => { r.evidence[0]!.quote = ' await db.orders.findMany();'; }],
  ['UNKNOWN_EVIDENCE_ID', (r: InvestigationReport) => { r.findings[0]!.evidenceIds = ['unknown']; }],
  ['DUPLICATE_ID', (r: InvestigationReport) => { r.evidence.push({...r.evidence[0]!}); }],
] as const)('distinguishes %s without accepting invalid evidence', async (reason, mutate) => {
  const repository = fakeRepository();
  const source = await repository.readFile('src/customers.ts',1,1);
  const report = validReport(); mutate(report);
  expect(() => validateEvidence(report,repository.revision,[source])).toThrow(expect.objectContaining({code:'INVALID_EVIDENCE',reason}));
});
