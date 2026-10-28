/** Verifies provider configuration and model adapter request behavior without live API calls. */
import { afterEach, expect, it, vi } from 'vitest';

import { liveModel } from '../../../src/agents/models/createModel.js';
import { GEMINI, OPENAI, providerConfig } from '../../../src/agents/provider.js';
import { InvestigationService } from '../../../src/services/investigationService.js';
import { InvestigationStore } from '../../../src/storage/sqlite.js';
import { fakeRepository, validReport } from '../../fixtures/agentFixtures.js';

afterEach(() => vi.unstubAllGlobals());
it('selects only supported providers and keeps OpenAI as the default', () => {
  expect(providerConfig({})).toEqual(OPENAI);
  expect(providerConfig({ LLM_PROVIDER: 'gemini' })).toEqual(GEMINI);
  expect(() => providerConfig({ LLM_PROVIDER: 'typo' })).toThrow('LLM_PROVIDER');
});

async function finish(service: InvestigationService) {
  const id = service.start({
    repository: 'owner/repo',
    question: 'Investigate customer queries',
  }).id;
  for (let attempt = 0; attempt < 200; attempt++) {
    const run = service.store.get(id)!;
    if (!['queued', 'running'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Test timed out');
}

it.each([false, true])(
  'runs Gemini tools and validates reports with reserved final phase=%s',
  async (reserveFinal) => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toBe(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      );
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      expect(body.model).toBe(GEMINI.model);
      expect(body).not.toHaveProperty('service_tier');
      expect(body).not.toHaveProperty('store');
      expect(body.response_format).toEqual({ type: 'json_object' });
      if (reserveFinal && bodies.length === 2) {
        expect(body.tools ?? []).toEqual([]);
        expect(body).not.toHaveProperty('tool_choice');
      }
      expect(JSON.stringify(body.messages)).toContain(
        'When finished, return only JSON matching this schema',
      );
      expect(body.reasoning_effort).toBe('minimal');
      expect(body.max_tokens).toBe(2000);
      const message =
        bodies.length === 1
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'read-1',
                  type: 'function',
                  extra_content: { google: { thought_signature: 'test-signature' } },
                  function: {
                    name: 'read_file',
                    arguments: JSON.stringify({
                      path: 'src/customers.ts',
                      startLine: 1,
                      endLine: 1,
                    }),
                  },
                },
              ],
            }
          : {
              role: 'assistant',
              content: JSON.stringify({
                ...validReport(),
                evidence: [{ id: 'e1', handle: 'read-1', startLine: 1, endLine: 1 }],
              }),
            };
      return new Response(
        JSON.stringify({
          id: `completion-${bodies.length}`,
          object: 'chat.completion',
          created: 1,
          model: GEMINI.model,
          choices: [
            { index: 0, message, finish_reason: bodies.length === 1 ? 'tool_calls' : 'stop' },
          ],
          usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetch);
    const service = new InvestigationService(
      new InvestigationStore(':memory:'),
      async () => fakeRepository(),
      () => liveModel('test-key', GEMINI),
      reserveFinal ? { turns: 2 } : {},
      1,
      GEMINI,
    );
    try {
      const run = await finish(service);
      expect(run).toMatchObject({
        status: 'completed',
        model: GEMINI.model,
        usage: { requests: 2, inputTokens: 2000, outputTokens: 200, usageIncomplete: false },
      });
      expect(run.usage.estimatedCostUsd).toBeCloseTo(
        2000 * GEMINI.rates.input + 200 * GEMINI.rates.output,
      );
      if (!reserveFinal)
        expect(bodies[1]!.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: 'tool', tool_call_id: 'read-1' }),
          ]),
        );
      expect(JSON.stringify(bodies[1]!.messages)).toContain('test-signature');
      expect(run.report?.evidence).toHaveLength(1);
    } finally {
      service.close();
    }
  },
);

it.each([
  [401, 'AUTHENTICATION'],
  [403, 'ACCESS'],
  [429, 'RATE_LIMIT'],
  [400, 'INVALID_REQUEST'],
])('does not retry Gemini HTTP %s or leak its response', async (status, code) => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { message: 'private upstream detail' } }), {
        status: Number(status),
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const service = new InvestigationService(
    new InvestigationStore(':memory:'),
    async () => fakeRepository(),
    () => liveModel('test-key', GEMINI),
    {},
    1,
    GEMINI,
  );
  try {
    const run = await finish(service);
    expect(run.errorCode).toBe(`GEMINI_${code}`);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(run.usage.usageIncomplete).toBe(true);
    expect(run.usage.reservedCostUsd).toBeGreaterThan(0);
  } finally {
    service.close();
  }
});

it('rejects malformed Gemini JSON despite a normal stop without retrying or repairing it', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      id: 'malformed',
      object: 'chat.completion',
      created: 1,
      model: GEMINI.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '{"summary":"private marker",}' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020 },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const service = new InvestigationService(
    new InvestigationStore(':memory:'),
    async () => fakeRepository(),
    () => liveModel('test-key', GEMINI),
    {},
    1,
    GEMINI,
  );
  try {
    const run = await finish(service);
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('INVALID_REPORT');
    expect(run.report).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const failure = service.store
      .events(run.id)
      .find((event) => event.type === 'validation_failed');
    expect(failure?.data).toMatchObject({
      reason: 'INVALID_REPORT_JSON',
      selectedJsonFailurePosition: expect.any(Number),
      finishReasons: ['stop'],
    });
    expect(JSON.stringify(failure)).not.toContain('private marker');
  } finally {
    service.close();
  }
});
