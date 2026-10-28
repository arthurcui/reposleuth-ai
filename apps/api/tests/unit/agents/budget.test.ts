/** Verifies model budget enforcement and usage accounting. */
import { Usage } from '@openai/agents';
import { expect, it, vi } from 'vitest';

import { BudgetModel, DEFAULT_LIMITS, emptyUsage } from '../../../src/agents/budget.js';

it.each([
  ['REQUESTS', { requests: 12 }, 'test', {}],
  ['CONTEXT', {}, 'x'.repeat(80000), {}],
  ['TOKENS', { inputTokens: 57215, outputTokens: 249 }, 'x'.repeat(40000), {}],
  ['COST', {}, 'test', { costUsd: 0.000001 }],
] as const)(
  'identifies the %s guard before making or reserving another request',
  async (reason, prior, input, limits) => {
    const getResponse = vi.fn();
    const reserve = vi.fn();
    const usage = { ...emptyUsage(), ...prior };
    const model = new BudgetModel(
      {
        getResponse,
        getStreamedResponse: () => {
          throw new Error('unused');
        },
      },
      { ...DEFAULT_LIMITS, ...limits },
      usage,
      reserve,
      () => {},
      () => {},
    );
    await expect(
      model.getResponse({
        input,
        modelSettings: {},
        tools: [],
        handoffs: [],
        outputType: 'text',
        tracing: false,
      }),
    ).rejects.toMatchObject({ code: `BUDGET_EXCEEDED_${reason}` });
    expect(getResponse).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(usage.usageIncomplete).toBe(false);
  },
);

it('stops on an underestimated provider input after recording actual usage', async () => {
  const usage = emptyUsage();
  const model = new BudgetModel(
    {
      getResponse: async () => ({
        usage: new Usage({ inputTokens: 10000, outputTokens: 1 }),
        output: [],
      }),
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    },
    DEFAULT_LIMITS,
    usage,
    () => {},
    () => {},
    () => {},
    undefined,
    'openai',
    'gpt-5.4-mini',
  );
  await expect(
    model.getResponse({
      input: 'Hello',
      modelSettings: {},
      tools: [],
      handoffs: [],
      outputType: 'text',
      tracing: false,
    }),
  ).rejects.toMatchObject({ code: 'INPUT_ESTIMATE_EXCEEDED' });
  expect(usage.inputTokens).toBe(10000);
  expect(usage.usageIncomplete).toBe(false);
});
