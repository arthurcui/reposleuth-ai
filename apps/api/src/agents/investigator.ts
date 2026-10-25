/** Runs the tool-using investigation with the selected model and validates its final evidence. */
import { Agent, type Model, Runner } from '@openai/agents';
import {
  type InvestigationRequest,
  type InvestigationUsage,
  reportSchema,
} from '@reposleuth/shared';

import type { RepositoryProvider, SourceFile } from '../github/RepositoryProvider.js';
import { EvidenceValidationError, validateEvidence } from '../services/evidenceValidator.js';
import { BudgetModel, type RunLimits, StopError } from './budget.js';
import { instructions } from './instructions.js';
import { investigationModelSettings } from './models/settings.js';
import { type ProviderConfig } from './provider.js';
import { createTools } from './tools.js';

export async function investigate(options: {
  provider?: ProviderConfig;
  repository: RepositoryProvider;
  request: InvestigationRequest;
  model: Model;
  limits: RunLimits;
  usage: InvestigationUsage;
  signal: AbortSignal;
  reserve: (usd: number) => void;
  saveUsage: () => void;
  emit: (type: string, data: Record<string, unknown>) => void;
}) {
  const { repository, request, limits, signal, emit } = options;
  const check = () => {
    if (signal.aborted) throw new StopError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
  };
  check();
  const reads: SourceFile[] = [];
  const model = new BudgetModel(
    options.model,
    limits,
    options.usage,
    options.reserve,
    options.saveUsage,
    check,
    options.provider?.rates,
    options.provider?.provider,
  );
  const agent = new Agent({
    name: 'Engineering Investigator',
    instructions,
    model,
    modelSettings: investigationModelSettings(
      options.provider?.provider ?? 'openai',
      limits.outputTokens,
    ),
    tools: createTools(repository, reads, check, emit, limits.tools),
    outputType: reportSchema,
  });
  const runner = new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false });
  const result = await runner.run(
    agent,
    JSON.stringify({ ...request, pinnedRevision: repository.revision }),
    { maxTurns: limits.turns, signal },
  );
  check();
  emit('validating', {});
  try {
    return validateEvidence(result.finalOutput, repository.revision, reads);
  } catch (error) {
    if (error instanceof EvidenceValidationError)
      emit('validation_failed', {
        reason: error.reason,
        evidenceIndex: error.evidenceIndex ?? null,
      });
    throw error;
  }
}
