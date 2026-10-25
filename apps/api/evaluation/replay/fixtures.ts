/** Supplies deterministic repository and model doubles for replay evaluations. */
import { createHash } from 'node:crypto';
import { Usage, type Model, type ModelResponse } from '@openai/agents';
import type { InvestigationReport } from '@reposleuth/shared';
import { RepositoryError, type RepositoryProvider } from '../../src/github/RepositoryProvider.js';
import type { EvalCase } from './cases.js';

export function fixtureRepository(test: EvalCase): RepositoryProvider {
  const revision = {
    repository: `fixtures/${test.id}`,
    commitSha: createHash('sha1').update(test.source).digest('hex'),
  };
  const lines = test.source.split('\n');
  return {
    revision,
    getIssue: async (number) => {
      if (number !== 1) throw new RepositoryError('NOT_FOUND', 'Fixture issue absent');
      return {
        ...revision,
        number,
        title: test.question,
        body: 'Investigate this behavior using source evidence. Do not execute code.',
        state: 'open',
        comments: [],
        truncated: false,
        warnings: [],
        retrievedAt: '2026-01-01T00:00:00Z',
      };
    },
    listFiles: async (prefix = '') => ({
      ...revision,
      items: test.path.startsWith(prefix) ? [test.path] : [],
      truncated: false,
      warnings: [],
    }),
    searchCode: async (query) => ({
      ...revision,
      items: lines.flatMap((text, index) =>
        text.includes(query)
          ? [{ path: test.path, line: index + 1, snippet: text, snippetTruncated: false }]
          : [],
      ),
      truncated: false,
      warnings: [],
    }),
    readFile: async (path, startLine, endLine) => {
      if (path !== test.path) throw new RepositoryError('NOT_FOUND', 'Fixture file absent');
      if (startLine < 1 || endLine < startLine || startLine > lines.length)
        throw new RepositoryError('INVALID_RANGE', 'Invalid fixture range');
      const end = Math.min(endLine, lines.length, startLine + 199);
      return {
        ...revision,
        path,
        startLine,
        endLine: end,
        totalLines: lines.length,
        lines: lines
          .slice(startLine - 1, end)
          .map((text, index) => ({ line: startLine + index, text })),
      };
    },
    getCommits: async () => ({
      ...revision,
      items: [],
      truncated: false,
      warnings: ['Synthetic fixture has no history.'],
    }),
    getFileDiff: async () => {
      throw new RepositoryError('DIFF_UNAVAILABLE', 'Synthetic fixture has no diff.');
    },
  };
}
export function expectedReport(test: EvalCase): InvestigationReport {
  return {
    summary: test.rootCause,
    findings: [
      {
        title: test.category,
        explanation: test.rootCause,
        kind: 'hypothesis',
        confidence: 'medium',
        uncertainty:
          'Synthetic isolated snippet; no runtime measurements or surrounding implementation.',
        evidenceIds: ['E1'],
      },
    ],
    evidence: [
      {
        id: 'E1',
        path: test.path,
        commitSha: fixtureRepository(test).revision.commitSha,
        startLine: 1,
        endLine: test.source.split('\n').length,
        quote: test.source,
      },
    ],
    recommendations: [test.fix],
    testPlan: [test.verification],
    risks: ['Check surrounding callers and behavior before changing code.'],
    unresolvedQuestions: ['Does surrounding code mitigate this defect?'],
  };
}
/** Scripted oracle: tests SDK/tool/validation plumbing, NOT model reasoning accuracy. */
export class ReplayModel implements Model {
  private step = 0;
  constructor(private readonly test: EvalCase) {}
  async getResponse(): Promise<ModelResponse> {
    const calls = [
      { name: 'get_issue', arguments: JSON.stringify({ number: 1 }) },
      { name: 'list_files', arguments: JSON.stringify({ prefix: 'src/' }) },
      {
        name: 'read_file',
        arguments: JSON.stringify({
          path: this.test.path,
          startLine: 1,
          endLine: this.test.source.split('\n').length,
        }),
      },
    ];
    const call = calls[this.step++];
    return {
      usage: new Usage({ requests: 1, inputTokens: 200, outputTokens: 100 }),
      output: call
        ? [{ type: 'function_call', callId: `eval-${this.step}`, status: 'completed', ...call }]
        : [
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: JSON.stringify(expectedReport(this.test)) }],
            },
          ],
    };
  }
  getStreamedResponse(): ReturnType<Model['getStreamedResponse']> {
    throw new Error('Streaming disabled');
  }
}
