/** Evaluation-only baseline: deterministic retrieval and exactly one budgeted, tool-free model call. */
import { type JsonSchemaDefinition, NoopTrace, withTrace } from '@openai/agents';
import { z } from 'zod';

import { BudgetModel, StopError } from '../../src/agents/budget.js';
import { guidedReporting } from '../../src/agents/guidedInstructions.js';
import type { InvestigationOptions } from '../../src/agents/investigator.js';
import { investigationModelSettings } from '../../src/agents/models/settings.js';
import { reportText } from '../../src/agents/reportResponse.js';
import { validateReportShape } from '../../src/agents/reportValidation.js';
import { draftReportSchema, materializeEvidence } from '../../src/services/evidenceHandles.js';
import { retrieveReference } from './retrieve.js';

export async function investigateReference(options: InvestigationOptions) {
  const { request, repository, limits, usage, emit, signal } = options;
  const deadline = options.deadline ?? Date.now() + limits.timeoutMs;
  const check = () => {
    if (signal.aborted) throw new StopError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
    if (Date.now() >= deadline) throw new StopError('TIMEOUT');
  };
  check();
  emit('phase', { phase: 'retrieval', protocol: 'fixed-reference-v1' });
  const issue = options.preflightIssue;
  if (request.issueNumber && !issue) throw new StopError('PREFLIGHT_ISSUE_REQUIRED');
  const retrieval = await retrieveReference(
    repository,
    `${issue?.title ?? ''}\n${request.question}\n${issue?.body ?? ''}`,
    check,
    limits.tools,
  );
  for (const source of retrieval.reads)
    emit('source_read', {
      path: source.path,
      startLine: source.startLine,
      endLine: source.endLine,
    });
  emit('reference_retrieval', {
    terms: retrieval.terms,
    calls: retrieval.calls,
    bytes: retrieval.bytes,
    gaps: retrieval.gaps,
  });
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
  const schema = z
    .object({
      type: z.literal('object'),
      properties: z.record(z.string(), z.record(z.string(), z.unknown())),
      required: z.array(z.string()),
      additionalProperties: z.literal(false),
    })
    .passthrough()
    .parse(z.toJSONSchema(draftReportSchema));
  const outputType: JsonSchemaDefinition = {
    type: 'json_schema',
    name: 'investigation_report',
    strict: false,
    schema,
  };
  emit('phase', { phase: 'reporting', protocol: 'fixed-reference-v1' });
  const response = await withTrace(new NoopTrace(), () =>
    budget.getResponse({
      input: JSON.stringify({
        task: request,
        issue,
        revision: repository.revision,
        sourceEvidence: retrieval.reads.map((source, index) => ({
          handle: `read-${index + 1}`,
          source,
        })),
        retrievalLimitations: [
          'Fixed lexical retrieval; no exhaustive call-path or runtime analysis.',
          ...retrieval.gaps,
        ],
      }),
      systemInstructions: guidedReporting,
      tools: [],
      handoffs: [],
      outputType,
      modelSettings: {
        ...investigationModelSettings(options.provider?.provider ?? 'openai', limits.outputTokens),
        toolChoice: 'none',
      },
      tracing: false,
    }),
  );
  if (response.output.some((item) => item.type === 'function_call'))
    throw new StopError('INVALID_REPORT');
  validateReportShape(response, emit);
  const parsed: unknown = JSON.parse(reportText(response));
  const report = materializeEvidence(parsed, repository.revision, retrieval.reads);
  report.verification = {
    sourceCitations: report.evidence.length ? 'validated' : 'none',
    diagnosis: 'unverified',
    runtime: 'not_executed',
    coverage: report.evidence.length ? 'partial' : 'insufficient_evidence',
    filesExamined: [...new Set(retrieval.reads.map((read) => read.path))],
    rangesExamined: retrieval.reads.length,
  };
  check();
  return { report, retrieval };
}
