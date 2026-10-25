/** Provides reusable reports, repository doubles, and scripted model responses for tests. */
import { type Model, type ModelRequest, type ModelResponse, Usage } from '@openai/agents';
import type { InvestigationReport } from '@reposleuth/shared';

import type { RepositoryProvider } from '../../src/github/RepositoryProvider.js';

export const SHA = 'a'.repeat(40);
export function validReport(): InvestigationReport {
  return {
    reasoningSummary: {
      assessment: 'Potential repeated calls; frequency is not verified.',
      evidenceIds: ['e1'],
      alternatives: [],
      counterEvidence: [],
      limitations: 'Scripted fixture; no runtime verification or alternative-path coverage.',
    },
    summary: 'Potential repeated database calls.',
    findings: [
      {
        title: 'Repeated lookups',
        explanation: 'This call may be repeated per customer.',
        kind: 'hypothesis',
        confidence: 'low',
        uncertainty: 'No profiling evidence or test execution.',
        evidenceIds: ['e1'],
      },
    ],
    evidence: [
      {
        id: 'e1',
        path: 'src/customers.ts',
        commitSha: SHA,
        startLine: 1,
        endLine: 1,
        quote: 'await db.orders.findMany();',
      },
    ],
    recommendations: ['Consider batching after confirming the call frequency.'],
    testPlan: ['Measure query count.'],
    risks: ['Batch size may grow.'],
    unresolvedQuestions: ['How often is the function called?'],
  };
}
export function fakeRepository(): RepositoryProvider {
  const revision = { repository: 'owner/repo', commitSha: SHA };
  return {
    revision,
    getIssue: async (number) => ({
      ...revision,
      number,
      title: 'Slow customers',
      body: 'Untrusted issue text',
      state: 'open',
      comments: [],
      truncated: false,
      warnings: [],
      retrievedAt: new Date().toISOString(),
    }),
    listFiles: async () => ({
      ...revision,
      items: ['src/customers.ts'],
      truncated: false,
      warnings: [],
    }),
    searchCode: async () => ({
      ...revision,
      items: [
        {
          path: 'src/customers.ts',
          line: 1,
          snippet: 'await db.orders.findMany();',
          snippetTruncated: false,
        },
      ],
      truncated: false,
      warnings: [],
    }),
    readFile: async () => ({
      ...revision,
      path: 'src/customers.ts',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      lines: [{ line: 1, text: 'await db.orders.findMany();' }],
    }),
    getCommits: async () => ({ ...revision, items: [], truncated: false, warnings: [] }),
    getFileDiff: async () => ({
      ...revision,
      changeCommitSha: SHA,
      path: 'src/customers.ts',
      patch: null,
      status: 'modified',
      truncated: true,
      warnings: ['No patch'],
    }),
  };
}
export class ScriptedModel implements Model {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly report = validReport()) {}
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const step = this.requests.length;
    const calls = [
      { name: 'get_issue', arguments: JSON.stringify({ number: 42 }) },
      { name: 'search_code', arguments: JSON.stringify({ query: 'orders' }) },
      {
        name: 'read_file',
        arguments: JSON.stringify({ path: 'src/customers.ts', startLine: 1, endLine: 1 }),
      },
    ];
    const call = calls[step - 1];
    return {
      usage: new Usage({ requests: 1, inputTokens: 200, outputTokens: 100 }),
      output: call
        ? [{ type: 'function_call', callId: `call-${step}`, status: 'completed', ...call }]
        : [
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: JSON.stringify(this.report) }],
            },
          ],
    };
  }
  getStreamedResponse(): ReturnType<Model['getStreamedResponse']> {
    throw new Error('Not used');
  }
}
