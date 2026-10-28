/** Enforces investigation limits and tracks model token usage, costs, and reservations. */
import type { Model, ModelRequest, ModelResponse } from '@openai/agents';
import type { InvestigationUsage } from '@reposleuth/shared';

import { estimateInputTokens } from './tokens.js';

export const MODEL = 'gpt-6-luna';
// Standard global rates checked 2026-10-22. Conservatively price every input as a cache write.
export const RATES = { input: 0.125 / 1_000_000, output: 0.5 / 1_000_000 };
export const DEFAULT_LIMITS = {
  turns: 12,
  tools: 24,
  tokens: 100000,
  outputTokens: 2000,
  timeoutMs: 120000,
  costUsd: 0.05,
};
export type RunLimits = typeof DEFAULT_LIMITS;
export class StopError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export const emptyUsage = (): InvestigationUsage => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  reservedCostUsd: 0,
  usageIncomplete: false,
});

/** Shared conservative input estimate for exploration planning and hard request admission. */
export function inputTokenBound(request: ModelRequest, model?: string): number {
  return estimateInputTokens(
    JSON.stringify({
      input: request.input,
      system: request.systemInstructions,
      tools: request.tools,
      output: request.outputType,
    }),
    model,
  );
}

export class BudgetModel implements Model {
  constructor(
    private readonly delegate: Model,
    private readonly limits: RunLimits,
    private readonly usage: InvestigationUsage,
    private readonly reserve: (usd: number) => void,
    private readonly save: () => void,
    private readonly check: () => void,
    private readonly rates = RATES,
    private readonly provider: 'openai' | 'gemini' = 'openai',
    private readonly modelName?: string,
    private readonly measured?: (estimated: number, actual: number) => void,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.check();
    // Full history is estimated with framing and safety padding; this is not a billing guarantee.
    const inputBound = inputTokenBound(request, this.modelName);
    const bound = inputBound * this.rates.input + this.limits.outputTokens * this.rates.output;
    if (this.usage.requests >= this.limits.turns) throw new StopError('BUDGET_EXCEEDED_REQUESTS');
    if (inputBound > 80000) throw new StopError('BUDGET_EXCEEDED_CONTEXT');
    if (
      this.usage.inputTokens + this.usage.outputTokens + inputBound + this.limits.outputTokens >
      this.limits.tokens
    )
      throw new StopError('BUDGET_EXCEEDED_TOKENS');
    if (this.usage.estimatedCostUsd + this.usage.reservedCostUsd + bound > this.limits.costUsd)
      throw new StopError('BUDGET_EXCEEDED_COST');
    this.reserve(bound); // Persist before external work; failures keep this reservation.
    this.usage.requests++;
    this.usage.reservedCostUsd += bound;
    this.usage.usageIncomplete = true;
    this.save();
    let response: ModelResponse;
    try {
      response = await this.delegate.getResponse({
        ...request,
        previousResponseId: undefined,
        conversationId: undefined,
        modelSettings: {
          ...request.modelSettings,
          maxTokens: this.limits.outputTokens,
          store: false,
          retry: { maxRetries: 0 },
        },
      });
    } catch (error) {
      this.check();
      const status =
        typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      const type =
        typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
      const prefix = this.provider.toUpperCase();
      if (status === 401) throw new StopError(`${prefix}_AUTHENTICATION`);
      if (
        type === 'insufficient_quota' ||
        code === 'insufficient_quota' ||
        code === 'credit_balance_exhausted' ||
        code === 'billing_hard_limit_reached'
      )
        throw new StopError(`${prefix}_QUOTA`);
      if (status === 429) throw new StopError(`${prefix}_RATE_LIMIT`);
      if (status === 403 || status === 404 || code === 'model_not_found')
        throw new StopError(`${prefix}_ACCESS`);
      if (status === 400) throw new StopError(`${prefix}_INVALID_REQUEST`);
      throw new StopError('MODEL_REQUEST_FAILED');
    }
    const input = response.usage.inputTokens;
    const output = response.usage.outputTokens;
    if (
      !Number.isSafeInteger(input) ||
      !Number.isSafeInteger(output) ||
      input < 0 ||
      output < 0 ||
      input + output === 0
    )
      throw new StopError('USAGE_UNAVAILABLE');
    this.measured?.(inputBound, input);
    this.usage.inputTokens += input;
    this.usage.outputTokens += output;
    this.usage.estimatedCostUsd += input * this.rates.input + output * this.rates.output;
    this.usage.reservedCostUsd = Math.max(0, this.usage.reservedCostUsd - bound);
    this.usage.usageIncomplete = false;
    this.save();
    this.check();
    if (this.usage.inputTokens + this.usage.outputTokens > this.limits.tokens)
      throw new StopError('BUDGET_EXCEEDED_TOKENS');
    if (this.usage.estimatedCostUsd > this.limits.costUsd)
      throw new StopError('BUDGET_EXCEEDED_COST');
    if (input > inputBound) throw new StopError('INPUT_ESTIMATE_EXCEEDED');
    return response;
  }
  getStreamedResponse(): ReturnType<Model['getStreamedResponse']> {
    throw new StopError('STREAMING_MODEL_DISABLED');
  }
}
