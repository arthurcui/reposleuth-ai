/** Adversarial saved report: a real import citation paired with a correct but unsupported causal claim. */
import { type Answer, type Judgment, savedRunSchema } from '../../evaluation/benchmarks/grading.js';
import { savedInvestigation } from './savedInvestigation.js';

export function claimGroundingFixture() {
  const run = savedRunSchema.parse(savedInvestigation());
  run.request.mode = 'standard';
  const source =
    "import { db } from './db';\nfor (const customer of customers) await db.orders.findMany({ customerId: customer.id });";
  const report = run.report!;
  const citation = report.evidence[0]!;
  citation.startLine = 1;
  citation.endLine = 1;
  citation.quote = source.split('\n')[0]!;
  report.summary = 'Per-customer database calls make this operation slow.';
  report.findings[0]!.explanation = report.summary;
  report.findings[0]!.kind = 'fact';
  report.findings[0]!.confidence = 'high';
  const answer: Answer = {
    id: 'incidental-import-citation',
    repository: run.request.repository,
    issueNumber: run.request.issueNumber!,
    commitSha: run.commitSha!,
    answer: {
      rootCause: 'One database call per customer in the loop.',
      fix: 'Batch the lookups.',
      evidence: [{ path: citation.path, startLine: 2, endLine: 2, quote: source.split('\n')[1]! }],
    },
  };
  // An explicit fixture judgment tests grading plumbing, not a model's ability to reason.
  const judgment: Judgment = {
    rootCause: 2,
    evidenceRelevance: 0,
    fix: 2,
    uncertainty: 0,
    uncertain: false,
    rationale:
      'The cause agrees with the implementation, but the finding cites only an import, which cannot establish the per-customer calls.',
    alternativesAreCauses: false,
    counterEvidenceAssessed: false,
  };
  return { run, answer, source, judgment };
}
