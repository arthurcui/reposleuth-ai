/** Exercises the real SDK loop across files and compact state using scripted, non-intelligent responses. */
import { type Model, type ModelRequest, Usage } from '@openai/agents';
import { expect, it } from 'vitest';

import { DEFAULT_LIMITS, emptyUsage } from '../../../src/agents/budget.js';
import { investigate } from '../../../src/agents/investigator.js';
import { sourceOutline } from '../../../src/github/sourceNavigation.js';
import { fakeRepository, validReport } from '../../fixtures/agentFixtures.js';

it('follows a wrapper to implementation and preserves evidence, notes, gaps and limits through compaction', async () => {
  const repo = fakeRepository();
  const files: Record<string, string> = {
    'src/api.ts': "import { load } from './service';\nexport function handler() { return load(); }",
    'src/service.ts':
      'export async function load() {\n  for (const item of items) {\n    await db.find(item.id);\n  }\n}',
  };
  repo.outlineFile = async (path, query) => sourceOutline(repo.revision, path, files[path]!, query);
  repo.readFile = async (path, start, end) => {
    const lines = files[path]!.split('\n');
    return {
      ...repo.revision,
      path,
      startLine: start,
      endLine: Math.min(end, lines.length),
      totalLines: lines.length,
      lines: lines.slice(start - 1, end).map((text, i) => ({ line: start + i, text })),
    };
  };
  const calls = [
    ['outline_file', { path: 'src/api.ts' }],
    ['read_definition', { path: 'src/api.ts', name: 'handler' }],
    ['outline_file', { path: 'src/service.ts' }],
    ['read_definition', { path: 'src/service.ts', name: 'load' }],
    [
      'update_plan',
      {
        symptom: 'slow with more items',
        hypotheses: [
          {
            explanation: 'repeated calls may cause latency',
            supportingHandles: ['read-1', 'read-2'],
            missingEvidence: 'runtime latency',
          },
        ],
        nextPaths: [{ path: 'tests/service.test.ts', reason: 'check batching coverage' }],
        uncertainty: 'No runtime tests',
      },
    ],
  ] as const;
  const requests: ModelRequest[] = [];
  const draft = {
    ...validReport(),
    evidence: [
      { id: 'e1', handle: 'read-1', startLine: 2, endLine: 2 },
      { id: 'e2', handle: 'read-2', startLine: 2, endLine: 4 },
    ],
  };
  draft.findings[0]!.evidenceIds = ['e1', 'e2'];
  const model: Model = {
    getResponse: async (request) => {
      requests.push(request);
      const call = calls[requests.length - 1];
      return {
        usage: new Usage({ inputTokens: 200, outputTokens: 100 }),
        output: call
          ? [
              {
                type: 'function_call',
                callId: `call-${requests.length}`,
                name: call[0],
                arguments: JSON.stringify(call[1]),
              },
            ]
          : [
              {
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: JSON.stringify(draft) }],
              },
            ],
      };
    },
    getStreamedResponse: () => {
      throw new Error('unused');
    },
  };
  const usage = emptyUsage();
  const report = await investigate({
    repository: repo,
    request: { repository: 'owner/repo', question: 'Why slow with more items?' },
    model,
    limits: DEFAULT_LIMITS,
    usage,
    signal: new AbortController().signal,
    reserve: () => {},
    saveUsage: () => {},
    emit: () => {},
  });
  expect(requests).toHaveLength(6);
  const context = JSON.parse(String(requests.at(-1)!.input));
  expect(context.workingPlan.nextPaths[0].path).toBe('tests/service.test.ts');
  expect(context.sourceEvidence.map((e: { handle: string }) => e.handle)).toEqual([
    'read-2',
    'read-1',
  ]);
  expect(report.evidence[1]?.quote).toBe(
    '  for (const item of items) {\n    await db.find(item.id);\n  }',
  );
  expect(report.verification).toMatchObject({
    sourceCitations: 'validated',
    diagnosis: 'unverified',
    runtime: 'not_executed',
    filesExamined: ['src/api.ts', 'src/service.ts'],
    rangesExamined: 2,
  });
  expect(usage.estimatedCostUsd).toBeLessThan(DEFAULT_LIMITS.costUsd);
});
it('cannot let a model grant itself semantic or runtime verification', async () => {
  const report = validReport();
  const model: Model = {
    getResponse: async () => ({
      usage: new Usage({ inputTokens: 100, outputTokens: 100 }),
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                ...report,
                findings: [],
                evidence: [],
                reasoningSummary: {
                  assessment: 'Insufficient supplied evidence',
                  evidenceIds: [],
                  alternatives: [],
                  counterEvidence: [],
                  limitations: 'No source read',
                },
                verification: { diagnosis: 'verified', runtime: 'tested' },
              }),
            },
          ],
        },
      ],
    }),
    getStreamedResponse: () => {
      throw new Error('unused');
    },
  };
  // The backend strips model-authored verification and derives it from actual reads.
  await expect(
    investigate({
      repository: fakeRepository(),
      request: { repository: 'owner/repo', question: 'Any problem?' },
      model,
      limits: DEFAULT_LIMITS,
      usage: emptyUsage(),
      signal: new AbortController().signal,
      reserve: () => {},
      saveUsage: () => {},
      emit: () => {},
    }),
  ).resolves.toMatchObject({
    verification: {
      diagnosis: 'unverified',
      runtime: 'not_executed',
      coverage: 'insufficient_evidence',
      sourceCitations: 'none',
    },
  });
});
