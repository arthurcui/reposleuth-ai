/** Experimental two-phase runner: discovery/source dossier first, strictly validated report second. */
import {
  Agent,
  type JsonSchemaDefinition,
  type Model,
  type ModelRequest,
  Runner,
  tool,
} from '@openai/agents';
import { z } from 'zod';

import type { SourceFile } from '../github/RepositoryProvider.js';
import { draftReportSchema, materializeEvidence } from '../services/evidenceHandles.js';
import { EvidenceValidationError } from '../services/evidenceValidator.js';
import { BudgetModel, StopError } from './budget.js';
import { CompletionModel, ExplorationComplete } from './completion.js';
import { guidedExploration, guidedReporting } from './guidedInstructions.js';
import { modeInstructions } from './instructions.js';
import type { InvestigationOptions } from './investigator.js';
import { investigationModelSettings } from './models/settings.js';
import { validateReportShape } from './reportValidation.js';
import { createTools } from './tools.js';
import { WorkingContext, WorkingContextModel } from './workingContext.js';

// One explicit JSON schema is shared by forecasting and the actual reporter.
// Full Zod and evidence validation still run locally; non-strict provider mode
// avoids rewriting optional fields to fit a provider-specific strict subset.
const schema = z
  .object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.record(z.string(), z.unknown())),
    required: z.array(z.string()),
    additionalProperties: z.literal(false),
  })
  .passthrough()
  .parse(z.toJSONSchema(draftReportSchema));
const reportOutput: JsonSchemaDefinition = {
  type: 'json_schema',
  name: 'investigation_report',
  strict: false,
  schema,
};

export async function investigateGuided(options: InvestigationOptions) {
  const { request, repository, limits, usage, signal, emit } = options;
  const deadline = options.deadline ?? Date.now() + limits.timeoutMs;
  const check = () => {
    if (signal.aborted) throw new StopError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
    if (Date.now() >= deadline) throw new StopError('TIMEOUT');
  };
  check();
  const reads: SourceFile[] = [];
  const dossier = new WorkingContext(
    { ...request, pinnedRevision: repository.revision, preflightIssue: options.preflightIssue },
    reads,
    true,
  );
  const budget = new BudgetModel(
    options.model,
    limits,
    usage,
    options.reserve,
    options.saveUsage,
    check,
    options.provider?.rates,
    options.provider?.provider,
    options.provider?.model,
    (estimated, actual) => emit('token_estimate', { estimated, actual }),
    (details) => emit('model_request_failed', details),
  );
  const settings = investigationModelSettings(
    options.provider?.provider ?? 'openai',
    limits.outputTokens,
  );
  const reportingRequest = (): ModelRequest => ({
    input: JSON.stringify(dossier.snapshot()),
    systemInstructions: guidedReporting,
    tools: [],
    handoffs: [],
    outputType: reportOutput,
    modelSettings: { ...settings, toolChoice: 'none' },
    tracing: false,
  });
  const exploration = new CompletionModel(
    budget,
    limits,
    usage,
    emit,
    options.provider?.rates,
    options.remainingBudget,
    deadline,
    undefined,
    options.provider?.model,
    reportingRequest,
  );
  const runner = new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false });
  const finish = tool({
    name: 'finish_investigation',
    description:
      'End exploration and request a report from the dossier. Missing evidence is allowed; do not invent a diagnosis.',
    parameters: z.object({}),
    errorFunction: null,
    execute: () => {
      check();
      // Count a permitted finish action in the same tool allowance. If the
      // allowance has ended, transitioning to a partial report is still safe.
      exploration.allowTool();
      return 'Exploration finished. Reporting is separate.';
    },
  });
  const explorer = new Agent({
    name: 'Guided exploration',
    instructions: `${guidedExploration}\n${modeInstructions[request.mode ?? 'standard']}`,
    outputType: 'text',
    model: new WorkingContextModel(exploration, dossier, emit),
    modelSettings: settings,
    tools: [
      ...createTools(
        repository,
        reads,
        check,
        emit,
        limits.tools,
        () => exploration.allowTool(),
        () => exploration.toolOutputBytes,
        options.preflightIssue?.number,
        dossier,
      ),
      finish,
    ],
    toolUseBehavior: { stopAtToolNames: ['finish_investigation'] },
  });
  emit('phase', { phase: 'exploration', protocol: 'guided-v1' });
  try {
    // Any natural-language output ends exploration but is never used as a report.
    await runner.run(explorer, JSON.stringify(dossier.snapshot()), {
      maxTurns: limits.turns,
      signal,
    });
  } catch (error) {
    if (!(error instanceof ExplorationComplete)) throw error;
  }
  check();
  emit('phase', {
    phase: 'reporting',
    reason: exploration.reason ?? 'EXPLORATION_FINISHED',
    sourceRanges: reads.length,
    unreadRanges: dossier.pendingRanges().length,
  });
  const reporterModel: Model = {
    getResponse: async (sdkRequest) => {
      check();
      // Both forecasting and physical reporting use this exact dossier envelope.
      const response = await budget.getResponse({ ...sdkRequest, ...reportingRequest() });
      if (response.output.some((item) => item.type === 'function_call'))
        throw new StopError('INVALID_REPORT');
      validateReportShape(response, emit);
      return response;
    },
    getStreamedResponse: () => {
      throw new StopError('STREAMING_MODEL_DISABLED');
    },
  };
  const reporter = new Agent({
    name: 'Guided report',
    instructions: guidedReporting,
    tools: [],
    outputType: reportOutput,
    model: reporterModel,
    modelSettings: { ...settings, toolChoice: 'none' },
  });
  const result = await runner.run(reporter, JSON.stringify(dossier.snapshot()), {
    maxTurns: 1,
    signal,
  });
  check();
  emit('validating', {});
  try {
    const report = materializeEvidence(result.finalOutput, repository.revision, reads);
    const pending = dossier.pendingRanges();
    report.verification = {
      sourceCitations: reads.length && report.evidence.length ? 'validated' : 'none',
      diagnosis: 'unverified',
      runtime: 'not_executed',
      coverage: !report.evidence.length
        ? 'insufficient_evidence'
        : exploration.reason || pending.length
          ? 'partial'
          : 'generated',
      filesExamined: [...new Set(reads.map((f) => f.path))].slice(0, 48),
      rangesExamined: reads.length,
    };
    const gaps = pending
      .slice(0, 3)
      .map((r) => `${r.path}:${r.startLine}-${r.endLine}`)
      .join(', ');
    if (exploration.reason || gaps)
      report.unresolvedQuestions = [
        `Partial coverage: ${exploration.reason ? `exploration stopped (${exploration.reason}); ` : ''}${gaps ? `unread source: ${gaps}. ` : ''}Retrieved source does not establish runtime behavior.`,
        ...report.unresolvedQuestions.slice(0, 9),
      ];
    emit('coverage', { ...report.verification });
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
