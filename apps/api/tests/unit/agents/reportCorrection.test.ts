/** Exercises one-shot report correction through real budget admission without provider calls. */
import { type Model, type ModelRequest, type ModelResponse, Usage } from '@openai/agents';
import { expect, it, vi } from 'vitest';

import { BudgetModel, DEFAULT_LIMITS, emptyUsage, StopError } from '../../../src/agents/budget.js';
import { CompletionModel } from '../../../src/agents/completion.js';
import { validateReportShape } from '../../../src/agents/reportValidation.js';
import { validReport } from '../../fixtures/agentFixtures.js';

const response = (text: string): ModelResponse => ({
  usage: new Usage({ inputTokens: 10, outputTokens: 10 }),
  output: [
    {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text }],
    },
  ],
});
function valid() {
  const r = validReport();
  return JSON.stringify({
    ...r,
    evidence: [{ id: 'e1', handle: 'read-1', startLine: null, endLine: null }],
  });
}
const request: ModelRequest = {
  input: 'Untrusted source context',
  systemInstructions: 'Trusted rules',
  modelSettings: {},
  tools: [],
  handoffs: [],
  outputType: 'text',
  tracing: false,
};
function setup(outputs: ModelResponse[], turns = 12, reserve: (usd: number) => void = () => {}) {
  const usage = emptyUsage(),
    events: { type: string; data: Record<string, unknown> }[] = [];
  const emit = (type: string, data: Record<string, unknown>) => {
    events.push({ type, data });
  };
  const getResponse = vi.fn<Model['getResponse']>(async () => outputs.shift()!);
  const delegate: Model = {
    getResponse,
    getStreamedResponse() {
      throw Error('unused');
    },
  };
  const limits = { ...DEFAULT_LIMITS, turns };
  const budget = new BudgetModel(
    delegate,
    limits,
    usage,
    reserve,
    () => {},
    () => {},
  );
  const model = new CompletionModel(
    budget,
    limits,
    usage,
    emit,
    undefined,
    undefined,
    undefined,
    (r) => validateReportShape(r, emit),
  );
  return { model, getResponse, usage, events };
}
it.each([
  '{bad JSON',
  JSON.stringify({
    ...validReport(),
    findings: [{ ...validReport().findings[0], evidenceIds: [] }],
  }),
])('corrects malformed shape once using the same budget and no tools', async (bad) => {
  const { model, getResponse, usage, events } = setup([response(bad), response(valid())]);
  await expect(model.getResponse(request)).resolves.toMatchObject({
    output: response(valid()).output,
  });
  expect(getResponse).toHaveBeenCalledTimes(2);
  expect(usage.requests).toBe(2);
  const correction = getResponse.mock.calls[1]![0];
  expect(correction.tools).toEqual([]);
  expect(correction.handoffs).toEqual([]);
  expect(correction.modelSettings.toolChoice).toBe('none');
  expect(correction.systemInstructions).toContain('untrusted data');
  expect(JSON.parse(String(correction.input)).rejectedReport).toBe(bad);
  expect(
    events.some((e) => e.type === 'report_correction' && e.data.status === 'shape_valid'),
  ).toBe(true);
  expect(events).not.toContainEqual(
    expect.objectContaining({ data: expect.objectContaining({ rejectedReport: bad }) }),
  );
});
it('rejects a second malformed response without a third call or leaking rejected text', async () => {
  const { model, getResponse, events } = setup([
    response('private rejected value'),
    response('private rejected value'),
  ]);
  await expect(model.getResponse(request)).rejects.toMatchObject({ code: 'INVALID_REPORT' });
  expect(getResponse).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(events)).not.toContain('private rejected value');
});
it('does not execute tool calls returned by a correction', async () => {
  const { model, getResponse } = setup([
    response('{}'),
    {
      usage: new Usage({ inputTokens: 10, outputTokens: 10 }),
      output: [{ type: 'function_call', name: 'read_file', callId: 'unexpected', arguments: '{}' }],
    },
  ]);
  await expect(model.getResponse(request)).rejects.toMatchObject({ code: 'INVALID_REPORT' });
  expect(getResponse).toHaveBeenCalledTimes(2);
});
it('blocks correction before the provider when the request limit is exhausted', async () => {
  const { model, getResponse, usage } = setup([response('{}')], 1);
  await expect(model.getResponse(request)).rejects.toMatchObject({
    code: 'BUDGET_EXCEEDED_REQUESTS',
  });
  expect(getResponse).toHaveBeenCalledTimes(1);
  expect(usage.requests).toBe(1);
});
it('uses the persistent lifetime reserve for correction too', async () => {
  let calls = 0;
  const { model, getResponse } = setup([response('{}')], 12, () => {
    if (++calls > 1) throw new StopError('BUDGET_EXCEEDED');
  });
  await expect(model.getResponse(request)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  expect(getResponse).toHaveBeenCalledTimes(1);
});
it('does not resend an oversized rejected report', async () => {
  const { model, getResponse, events } = setup([response('x'.repeat(30001))]);
  await expect(model.getResponse(request)).rejects.toMatchObject({ code: 'INVALID_REPORT' });
  expect(getResponse).toHaveBeenCalledTimes(1);
  expect(events.some((e) => e.data.reason === 'OUTPUT_TOO_LARGE')).toBe(true);
});
