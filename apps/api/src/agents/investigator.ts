/** Runs the tool-using investigation with the selected model and validates its final evidence. */
import { Agent, type Model, Runner } from '@openai/agents';
import { type InvestigationRequest, type InvestigationUsage } from '@reposleuth/shared';
import { z } from 'zod';

import type { RepositoryProvider, SourceFile } from '../github/RepositoryProvider.js';
import { draftReportSchema, materializeEvidence } from '../services/evidenceHandles.js';
import { EvidenceValidationError } from '../services/evidenceValidator.js';
import { BudgetModel, type RunLimits, StopError } from './budget.js';
import { CompletionModel } from './completion.js';
import { instructions, modeInstructions, summaryInstructions } from './instructions.js';
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
  remainingBudget?: () => number;
  deadline?: number;
  emit: (type: string, data: Record<string, unknown>) => void;
}) {
  const { repository, request, limits, signal, emit } = options;
  const check = () => {
    if (signal.aborted) throw new StopError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
  };
  check();
  const reads: SourceFile[] = [];
  const budgetModel = new BudgetModel(
    options.model,
    limits,
    options.usage,
    options.reserve,
    options.saveUsage,
    check,
    options.provider?.rates,
    options.provider?.provider,
  );
  const model = new CompletionModel(
    budgetModel,
    limits,
    options.usage,
    emit,
    options.provider?.rates,
    options.remainingBudget,
    options.deadline,
    (response) => {
      const text = response.output
        .flatMap((item) =>
          item.type === 'message' && Array.isArray(item.content)
            ? item.content.flatMap((part) => (part.type === 'output_text' ? [part.text] : []))
            : [],
        )
        .join('');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        const metadata = z
          .object({ choices: z.array(z.object({ finish_reason: z.string() })).optional() })
          .safeParse(response.providerData);
        emit('validation_failed', {
          reason: 'INVALID_REPORT_JSON',
          characters: text.length,
          fenced: text.trimStart().startsWith('```'),
          endsObject: text.trimEnd().endsWith('}'),
          finishReasons: metadata.success
            ? metadata.data.choices?.map((choice) => choice.finish_reason)
            : [],
        });
        throw new StopError('INVALID_REPORT');
      }
      const validated = draftReportSchema.safeParse(parsed);
      if (!validated.success) {
        emit('validation_failed', {
          reason: 'INVALID_REPORT_SCHEMA',
          fields: validated.error.issues.map((issue) => ({ code: issue.code, path: issue.path })),
        });
        throw new StopError('INVALID_REPORT');
      }
    },
  );
  const agent = new Agent({
    name: 'Engineering Investigator',
    instructions: `${instructions}\n${modeInstructions[request.mode ?? 'standard']}\n${summaryInstructions}`,
    model,
    modelSettings: investigationModelSettings(
      options.provider?.provider ?? 'openai',
      limits.outputTokens,
    ),
    tools: createTools(repository, reads, check, emit, limits.tools, () => model.allowTool(), 8000),
    outputType: draftReportSchema,
  });
  const runner = new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false });
  const result = await runner
    .run(agent, JSON.stringify({ ...request, pinnedRevision: repository.revision }), {
      maxTurns: limits.turns,
      signal,
    })
    .catch((error: unknown) => {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        emit('validation_failed', {
          reason: error instanceof SyntaxError ? 'INVALID_REPORT_JSON' : 'INVALID_REPORT_SCHEMA',
          ...(error instanceof z.ZodError
            ? {
                fields: error.issues.map((issue) => ({
                  code: issue.code,
                  path: issue.path.filter(
                    (part) => typeof part === 'string' || typeof part === 'number',
                  ),
                })),
              }
            : {}),
        });
        throw new StopError('INVALID_REPORT');
      }
      throw error;
    });
  check();
  emit('validating', {});
  try {
    const report = materializeEvidence(result.finalOutput, repository.revision, reads);
    if (model.reason) {
      report.unresolvedQuestions = [
        `Partial investigation: exploration stopped to reserve the final report (${model.reason.toLowerCase().replaceAll('_', ' ')}). Remaining paths and alternatives may be unchecked.`,
        ...report.unresolvedQuestions.slice(0, 9),
      ];
    }
    return report;
  } catch (error) {
    if (error instanceof EvidenceValidationError)
      emit('validation_failed', {
        reason: error.reason,
        evidenceIndex: error.evidenceIndex ?? null,
      });
    throw error;
  }
}
