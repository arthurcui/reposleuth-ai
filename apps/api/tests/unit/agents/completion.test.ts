/** Verifies early reporting, hard budget admission, and tool suppression without paid calls. */
import { type Model, type ModelRequest, Usage } from '@openai/agents';
import { afterEach, expect, it, vi } from 'vitest';

import { BudgetModel, DEFAULT_LIMITS, emptyUsage } from '../../../src/agents/budget.js';
import { CompletionModel } from '../../../src/agents/completion.js';

afterEach(() => vi.useRealTimers());
const request: ModelRequest = {
  input: 'Investigate',
  modelSettings: {},
  tools: [],
  handoffs: [],
  outputType: 'text',
  tracing: false,
};

it('shrinks the tool-result allowance before stopping exploration, without raising limits', async () => {
  const getResponse = vi.fn<Model['getResponse']>(async () => ({ usage: new Usage(), output: [] }));
  const model = new CompletionModel(
    {
      getResponse,
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    },
    { ...DEFAULT_LIMITS, costUsd: 0.04 },
    emptyUsage(),
    () => {},
    { input: 0.75 / 1e6, output: 4.5 / 1e6 },
  );
  await model.getResponse({ ...request, input: 'x'.repeat(5000) });
  expect(model.reason).toBeUndefined();
  expect(model.toolOutputBytes).toBeGreaterThanOrEqual(1024);
  expect(model.toolOutputBytes).toBeLessThan(8000);
  expect(getResponse.mock.calls[0]![0].modelSettings.toolChoice).not.toBe('none');
});

it('switches to reporting when the persistent allowance cannot fund exploration and a final request', async () => {
  const getResponse = vi.fn<Model['getResponse']>(async () => ({ usage: new Usage(), output: [] }));
  const model = new CompletionModel(
    {
      getResponse,
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    },
    DEFAULT_LIMITS,
    emptyUsage(),
    () => {},
    undefined,
    () => 0.002,
  );
  await model.getResponse(request);
  expect(model.reason).toBe('LIFETIME_COST_RESERVE');
  expect(model.allowTool()).toBe(false);
  expect(getResponse.mock.calls[0]![0].modelSettings.toolChoice).toBe('none');
});

it.each([
  ['REQUEST_RESERVE', { requests: 11 }, {}],
  ['TOKEN_RESERVE', { inputTokens: 85000 }, {}],
  ['COST_RESERVE', {}, { costUsd: 0.003 }],
] as const)('reserves the final response for %s', async (reason, prior, overrides) => {
  const usage = { ...emptyUsage(), ...prior };
  const getResponse = vi.fn(async () => ({
    usage: new Usage({ inputTokens: 10, outputTokens: 10 }),
    output: [],
  }));
  const delegate = {
    getResponse,
    getStreamedResponse: () => {
      throw new Error('unused');
    },
  };
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const emit = vi.fn();
  const model = new CompletionModel(
    new BudgetModel(
      delegate,
      limits,
      usage,
      () => {},
      () => {},
      () => {},
    ),
    limits,
    usage,
    emit,
  );
  await model.getResponse(request);
  expect(model.reason).toBe(reason);
  expect(getResponse.mock.calls).toHaveLength(1);
  expect(emit).toHaveBeenCalledWith('reporting', { reason });
  expect(emit).toHaveBeenCalledWith(
    'budget_plan',
    expect.objectContaining({
      requestNumber: usage.requests,
      reportingReason: reason,
      requiredTokens: expect.any(Number),
      requiredCostUsd: expect.any(Number),
      constraints: expect.objectContaining({ lifetimeBytes: null }),
    }),
  );
  expect(model.allowTool()).toBe(false);
  expect(usage.reservedCostUsd).toBe(0);
});

it('switches before the deadline and removes tools from the provider request', async () => {
  vi.useFakeTimers();
  const getResponse = vi.fn<Model['getResponse']>(async () => ({ usage: new Usage(), output: [] }));
  const model = new CompletionModel(
    {
      getResponse,
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    },
    DEFAULT_LIMITS,
    emptyUsage(),
    () => {},
  );
  vi.advanceTimersByTime(DEFAULT_LIMITS.timeoutMs * 0.65);
  await model.getResponse(request);
  expect(model.reason).toBe('TIME_RESERVE');
  expect(getResponse.mock.calls[0]![0]).toMatchObject({
    tools: [],
    modelSettings: { toolChoice: 'none' },
  });
});

it('blocks excess tool executions and refuses provider tool calls during final reporting', async () => {
  const model = new CompletionModel(
    {
      getResponse: async () => ({
        usage: new Usage(),
        output: [
          { type: 'function_call' as const, name: 'read_file', callId: '1', arguments: '{}' },
        ],
      }),
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    },
    { ...DEFAULT_LIMITS, tools: 1 },
    emptyUsage(),
    () => {},
  );
  expect(model.allowTool()).toBe(true);
  expect(model.allowTool()).toBe(false);
  await expect(model.getResponse(request)).rejects.toMatchObject({ code: 'INVALID_REPORT' });
});
