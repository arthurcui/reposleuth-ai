/** Runs the tool-using investigation with the selected model and validates its final evidence. */
import { Agent, type Model, Runner } from '@openai/agents';
import { type InvestigationRequest, type InvestigationUsage } from '@reposleuth/shared';
import { z } from 'zod';

import type { IssueDetails, RepositoryProvider, SourceFile } from '../github/RepositoryProvider.js';
import { draftReportSchema, materializeEvidence } from '../services/evidenceHandles.js';
import { EvidenceValidationError } from '../services/evidenceValidator.js';
import { BudgetModel, type RunLimits, StopError } from './budget.js';
import { CompletionModel } from './completion.js';
import { investigateGuided } from './guided.js';
import { instructions, modeInstructions, summaryInstructions } from './instructions.js';
import { investigationModelSettings } from './models/settings.js';
import { type ProviderConfig } from './provider.js';
import { validateReportShape } from './reportValidation.js';
import { createTools } from './tools.js';
import { WorkingContext, WorkingContextModel } from './workingContext.js';

export type InvestigationOptions = {
  /** Explicit experiment opt-in; existing application behavior remains the baseline. */
  workflow?: 'guided';
  provider?: ProviderConfig;
  preflightIssue?: IssueDetails;
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
};

export async function investigate(options: InvestigationOptions) {
  if (options.workflow === 'guided') return investigateGuided(options);
  const { repository, request, limits, signal, emit } = options;
  const check = () => {
    if (signal.aborted) throw new StopError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
  };
  check();
  const reads: SourceFile[] = [];
  const working = new WorkingContext(
    { ...request, pinnedRevision: repository.revision, preflightIssue: options.preflightIssue },
    reads,
  );
  const budgetModel = new BudgetModel(
    options.model,
    limits,
    options.usage,
    options.reserve,
    options.saveUsage,
    check,
    options.provider?.rates,
    options.provider?.provider,
    options.provider?.model,
    (estimated, actual) => emit('token_estimate', { estimated, actual }),
    (details) => emit('model_request_failed', details),
  );
  const model = new CompletionModel(
    budgetModel,
    limits,
    options.usage,
    emit,
    options.provider?.rates,
    options.remainingBudget,
    options.deadline,
    (response) => validateReportShape(response, emit),
    options.provider?.model,
  );
  const agent = new Agent({
    name: 'Engineering Investigator',
    instructions: `${instructions}\n${modeInstructions[request.mode ?? 'standard']}\n${summaryInstructions}`,
    model: new WorkingContextModel(model, working, emit),
    modelSettings: investigationModelSettings(
      options.provider?.provider ?? 'openai',
      limits.outputTokens,
    ),
    tools: createTools(
      repository,
      reads,
      check,
      emit,
      limits.tools,
      () => model.allowTool(),
      () => model.toolOutputBytes,
      options.preflightIssue?.number,
      working,
    ),
    outputType: draftReportSchema,
  });
  const runner = new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false });
  const result = await runner
    .run(
      agent,
      JSON.stringify({
        ...request,
        pinnedRevision: repository.revision,
        preflightIssue: options.preflightIssue,
      }),
      {
        maxTurns: limits.turns,
        signal,
      },
    )
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
    const pending = working.pendingRanges();
    report.verification = {
      sourceCitations: report.evidence.length ? 'validated' : 'none',
      diagnosis: 'unverified',
      runtime: 'not_executed',
      coverage: !report.evidence.length
        ? 'insufficient_evidence'
        : model.reason || pending.length
          ? 'partial'
          : 'generated',
      filesExamined: [...new Set(reads.map((file) => file.path))].slice(0, 48),
      rangesExamined: reads.length,
    };
    emit('coverage', { ...report.verification });
    if (model.reason) {
      report.unresolvedQuestions = [
        `Partial investigation: exploration stopped to reserve the final report (${model.reason.toLowerCase().replaceAll('_', ' ')}). Remaining paths and alternatives may be unchecked.`,
        ...report.unresolvedQuestions.slice(0, 9),
      ];
    }
    if (pending.length) {
      const ranges = pending
        .slice(0, 3)
        .map((range) => `${range.path}:${range.startLine}-${range.endLine}`)
        .join(', ');
      report.unresolvedQuestions = [
        `Requested source remains unread: ${ranges}${pending.length > 3 ? ` (+${pending.length - 3} more ranges)` : ''}. These are coverage gaps, not proof of a defect.`,
        ...report.unresolvedQuestions.slice(0, 9),
      ];
    }
    return report;
  } catch (error) {
    if (error instanceof EvidenceValidationError)
      emit('validation_failed', {
        reason: error.reason,
        evidenceIndex: error.evidenceIndex ?? null,
        ...(error.rangeDiagnostic ? { range: error.rangeDiagnostic } : {}),
      });
    throw error;
  }
}
