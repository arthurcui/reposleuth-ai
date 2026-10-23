import { Agent, Runner, OpenAIResponsesModel, type Model } from '@openai/agents';
import OpenAI from 'openai';
import { reportSchema, type InvestigationRequest, type InvestigationUsage } from '@reposleuth/shared';
import type { RepositoryProvider, SourceFile } from '../github/RepositoryProvider.js';
import { BudgetModel, MODEL, StopError, type RunLimits } from './budget.js';
import { createTools } from './tools.js';
import { instructions } from './instructions.js';
import { validateEvidence } from '../services/evidenceValidator.js';

export function liveModel(apiKey: string): Model {
  return new OpenAIResponsesModel(new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 30000 }), MODEL);
}

export async function investigate(options: {
  repository: RepositoryProvider; request: InvestigationRequest; model: Model;
  limits: RunLimits; usage: InvestigationUsage; signal: AbortSignal;
  reserve: (usd: number) => void; saveUsage: () => void;
  emit: (type: string, data: Record<string, unknown>) => void;
}) {
  const { repository, request, limits, signal, emit } = options;
  const check = () => { if (signal.aborted) throw new StopError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED'); };
  check();
  const reads: SourceFile[] = [];
  const model = new BudgetModel(options.model, limits, options.usage, options.reserve, options.saveUsage, check);
  const agent = new Agent({ name: 'Engineering Investigator', instructions, model,
    modelSettings: { store: false, parallelToolCalls: false, maxTokens: limits.outputTokens,
      reasoning: { effort: 'low' }, retry: { maxRetries: 0 }, providerData: { service_tier: 'default' } },
    tools: createTools(repository, reads, check, emit, limits.tools), outputType: reportSchema });
  const runner = new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false });
  const result = await runner.run(agent, JSON.stringify({ ...request, pinnedRevision: repository.revision }), { maxTurns: limits.turns, signal });
  check();
  emit('validating', {});
  return validateEvidence(result.finalOutput, repository.revision, reads);
}
