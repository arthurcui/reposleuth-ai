import { Agent, Runner, OpenAIResponsesModel, OpenAIChatCompletionsModel, type Model } from '@openai/agents';
import OpenAI from 'openai';
import { reportSchema, type InvestigationRequest, type InvestigationUsage } from '@reposleuth/shared';
import type { RepositoryProvider, SourceFile } from '../github/RepositoryProvider.js';
import { BudgetModel, StopError, type RunLimits } from './budget.js';
import { createTools } from './tools.js';
import { OPENAI, type ProviderConfig } from './provider.js';
import { instructions } from './instructions.js';
import { validateEvidence, EvidenceValidationError } from '../services/evidenceValidator.js';

export function liveModel(apiKey: string, config: ProviderConfig = OPENAI): Model {
  const client = new OpenAI({ apiKey, baseURL: config.provider === 'gemini'
    ? 'https://generativelanguage.googleapis.com/v1beta/openai/' : 'https://api.openai.com/v1', maxRetries: 0, timeout: 30000 });
  if (config.provider !== 'gemini') return new OpenAIResponsesModel(client, config.model);
  const delegate = new OpenAIChatCompletionsModel(client, config.model);
  return {
    getResponse: request => delegate.getResponse({ ...request,
      // Use JSON-object mode with function tools; the strict JSON-schema request
      // is rejected by Gemini. The SDK still validates the final report schema.
      systemInstructions: `${request.systemInstructions ?? ''}\nWhen finished, return only JSON matching this schema:\n${JSON.stringify(request.outputType)}`,
      outputType: 'text',
      modelSettings: { ...request.modelSettings, providerData: {
        ...request.modelSettings.providerData, response_format: { type: 'json_object' },
      } },
    }),
    getStreamedResponse: () => { throw new StopError('STREAMING_MODEL_DISABLED'); },
  };
}

export async function investigate(options: {
  provider?: ProviderConfig; repository: RepositoryProvider; request: InvestigationRequest; model: Model;
  limits: RunLimits; usage: InvestigationUsage; signal: AbortSignal;
  reserve: (usd: number) => void; saveUsage: () => void;
  emit: (type: string, data: Record<string, unknown>) => void;
}) {
  const { repository, request, limits, signal, emit } = options;
  const check = () => { if (signal.aborted) throw new StopError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED'); };
  check();
  const reads: SourceFile[] = [];
  const model = new BudgetModel(options.model, limits, options.usage, options.reserve, options.saveUsage, check, options.provider?.rates, options.provider?.provider);
  const agent = new Agent({ name: 'Engineering Investigator', instructions, model,
    modelSettings: { store: false, parallelToolCalls: false, maxTokens: limits.outputTokens,
      reasoning: { effort: options.provider?.provider === 'gemini' ? 'minimal' : 'low' }, retry: { maxRetries: 0 },
      providerData: options.provider?.provider === 'gemini' ? { store: undefined } : { service_tier: 'default' } },
    tools: createTools(repository, reads, check, emit, limits.tools), outputType: reportSchema });
  const runner = new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false });
  const result = await runner.run(agent, JSON.stringify({ ...request, pinnedRevision: repository.revision }), { maxTurns: limits.turns, signal });
  check();
  emit('validating', {});
  try { return validateEvidence(result.finalOutput, repository.revision, reads); }
  catch (error) {
    if (error instanceof EvidenceValidationError) emit('validation_failed', { reason: error.reason, evidenceIndex: error.evidenceIndex ?? null });
    throw error;
  }
}
