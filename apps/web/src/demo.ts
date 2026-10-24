import type { Investigation, InvestigationEvent } from '@reposleuth/shared';
import { cases } from '@reposleuth/shared/eval-cases';
import { demoDetails } from './demoDetails';

export const demoCases = cases;
// Stable fictional commit IDs for presentation, not hashes of a Git repository.
function fixtureCommit(id: string) {
  return Array.from({ length: 5 }, (_, block) => {
    let hash = 2166136261 ^ block;
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
}
export function demoForCase(id: string): Investigation {
  const test = cases.find(item => item.id === id) ?? cases[0]!;
  const details = demoDetails[test.id]!;
  const index = cases.indexOf(test);
  const durationMs = 18400 + index * 1373;
  const inputTokens = 3200 + index * 247;
  const outputTokens = 600 + index * 43;
  const commitSha = fixtureCommit(test.id);
  const lines = test.source.split('\n');
  const evidence = (details.ranges ?? [[1, lines.length]]).map(([startLine, endLine], index) => ({
    id: `E${index + 1}`, path: test.path, commitSha, startLine: startLine!, endLine: endLine!, quote: lines.slice(startLine! - 1, endLine).join('\n'),
  }));
  return { ...demo, durationMs, commitSha, model: 'gpt-6-luna', finishedAt: new Date(Date.parse(demo.startedAt!) + durationMs).toISOString(),
    usage: { requests: 3 + index % 5, inputTokens, outputTokens, estimatedCostUsd: inputTokens * 0.125 / 1_000_000 + outputTokens * 0.5 / 1_000_000, reservedCostUsd: 0, usageIncomplete: false },
    request: { repository: `example/${test.id}`, issueNumber: 42, question: test.question },
    report: {
      summary: test.rootCause,
      findings: [{ title: `${test.category}: ${test.id}`, explanation: test.rootCause, kind: 'hypothesis', confidence: 'medium', uncertainty: details.uncertainty, evidenceIds: evidence.map(item => item.id) }],
      evidence,
      recommendations: [test.fix], testPlan: [test.verification], risks: [details.risk], unresolvedQuestions: [details.question],
    } };
}

const sha = 'a'.repeat(40);
export const demo: Investigation = {
  id: 'demo', request: { repository: 'example/customer-api', issueNumber: 42, question: 'Why does listing customers become slower as the page size increases?' },
  status: 'completed', createdAt: '2026-01-01T12:00:00Z', startedAt: '2026-01-01T12:00:00Z', finishedAt: '2026-01-01T12:00:08Z', durationMs: 8000,
  commitSha: sha, errorCode: null, model: 'Illustrative fixture',
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, reservedCostUsd: 0, usageIncomplete: false },
  report: {
    summary: 'Synthetic example: the customer handler reads orders once per customer. This may explain latency that grows with page size.',
    findings: [{ title: 'Possible N+1 database reads', explanation: 'The loop awaits an order lookup for each customer, making these calls sequential.', kind: 'hypothesis', confidence: 'medium', uncertainty: 'No runtime traces or database measurements were collected. Caching and query behavior are unknown.', evidenceIds: ['E1'] }],
    evidence: [{ id: 'E1', path: 'src/customers.ts', commitSha: sha, startLine: 42, endLine: 44, quote: 'for (const customer of customers) {\n  customer.orders = await orders.findByCustomer(customer.id);\n}' }],
    recommendations: ['Fetch orders for all customer IDs in one bounded query and group the results by customer ID.'],
    testPlan: ['Measure query count and response time for pages with 1, 10, and 50 customers. Verify empty order lists and stable ordering.'],
    risks: ['Batching can increase memory use; retain pagination and bound the batch size.'],
    unresolvedQuestions: ['Does the repository layer already cache or batch these lookups?'],
  },
};
export const demoEvents: InvestigationEvent[] = ['queued', 'started', 'revision', 'tool_started', 'tool_finished', 'validating', 'terminal'].map((type, index) => ({
  id: index + 1, investigationId: 'demo', at: `2026-01-01T12:00:0${index}Z`, type,
  data: type.startsWith('tool_') ? { name: 'read_file' } : {},
}));
