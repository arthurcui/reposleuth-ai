/** Verifies the reference pipeline on varied source fixtures without claiming model-quality evidence. */
import { type ModelRequest, Usage } from '@openai/agents';
import { afterEach, expect, it, vi } from 'vitest';

import { explorationAdmitted } from '../../../evaluation/reference/admission.js';
import { corpusRepository } from '../../../evaluation/reference/corpus.js';
import { investigateReference } from '../../../evaluation/reference/investigate.js';
import { retrieveReference } from '../../../evaluation/reference/retrieve.js';
import { reliabilityCases } from '../../../evaluation/reliability/cases.js';
import { DEFAULT_LIMITS, emptyUsage } from '../../../src/agents/budget.js';
import { liveModel } from '../../../src/agents/models/createModel.js';
import { OPENAI } from '../../../src/agents/provider.js';

afterEach(() => vi.unstubAllGlobals());

it('rejects the insufficient live allowance without contacting a provider', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const provider = {
    ...OPENAI,
    model: 'gpt-5.4-mini',
    rates: { input: 0.75 / 1_000_000, output: 4.5 / 1_000_000 },
  };
  expect(await explorationAdmitted('Investigate order loading', provider, 0.025)).toBe(false);
  expect(await explorationAdmitted('Investigate order loading', provider, 0.18)).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

const abstain = {
  summary: 'Insufficient evidence',
  findings: [],
  evidence: [],
  recommendations: ['Verify the reported behavior.'],
  testPlan: ['Reproduce the symptom.'],
  risks: ['Missing runtime context.'],
  unresolvedQuestions: ['Is the symptom reproducible?'],
  reasoningSummary: {
    assessment: 'Insufficient evidence',
    evidenceIds: [],
    alternatives: [],
    counterEvidence: [],
    limitations: 'Scripted output, not a model assessment.',
  },
};

it('accepts a completed response through the actual OpenAI adapter without a Runner', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      id: 'resp_test',
      object: 'response',
      status: 'completed',
      model: 'test',
      output: [
        {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(abstain), annotations: [] }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const repository = corpusRepository('adapter', { 'src/a.ts': 'const value = 1;' });
  const adapter = liveModel('test-only');
  const result = await investigateReference({
    repository,
    request: { repository: repository.revision.repository, question: 'Check value' },
    model: adapter,
    limits: DEFAULT_LIMITS,
    usage: emptyUsage(),
    signal: new AbortController().signal,
    reserve: () => {},
    saveUsage: () => {},
    emit: () => {},
  });
  expect(result.report.summary).toBe('Insufficient evidence');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(reliabilityCases)(
  'makes one report request on $id with no private answers',
  async (test) => {
    const requests: ModelRequest[] = [];
    const repository = corpusRepository(test.id, test.files);
    const result = await investigateReference({
      repository,
      request: { repository: repository.revision.repository, question: test.question },
      limits: DEFAULT_LIMITS,
      usage: emptyUsage(),
      signal: new AbortController().signal,
      reserve: () => {},
      saveUsage: () => {},
      emit: () => {},
      model: {
        getResponse: async (request) => {
          requests.push(request);
          return {
            usage: new Usage({ inputTokens: 100, outputTokens: 100 }),
            output: [
              {
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: JSON.stringify(abstain) }],
              },
            ],
          };
        },
        getStreamedResponse: () => {
          throw new Error('unused');
        },
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.tools).toEqual([]);
    expect(String(requests[0]!.input)).not.toContain(test.expected.reason);
    expect(result.retrieval.calls).toBeLessThanOrEqual(DEFAULT_LIMITS.tools);
    expect(result.retrieval.bytes).toBeLessThanOrEqual(18000);
    expect(result.report.verification?.diagnosis).toBe('unverified');
  },
);

it('honors cancellation before repository work', async () => {
  const repo = corpusRepository('cancelled', { 'src/a.ts': 'const a = 1' });
  const find = vi.spyOn(repo, 'findFiles');
  await expect(
    retrieveReference(
      repo,
      'aSymbol',
      () => {
        throw new Error('cancelled');
      },
      24,
    ),
  ).rejects.toThrow('cancelled');
  expect(find).not.toHaveBeenCalled();
});

it('bounds reads and repository calls even with very long source lines', async () => {
  const repo = corpusRepository('large', { 'src/a.ts': 'aSymbol ' + 'x'.repeat(20000) });
  const result = await retrieveReference(repo, 'aSymbol', () => {}, 3);
  expect(result.calls).toBeLessThanOrEqual(3);
  expect(result.bytes).toBeLessThanOrEqual(18000);
  expect(result.reads).toHaveLength(0);
  expect(result.gaps).toContain('Source byte allowance exhausted.');
});
