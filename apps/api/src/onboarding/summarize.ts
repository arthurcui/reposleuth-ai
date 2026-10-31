/** Produces one bounded, source-referenced onboarding narrative; preserves the inventory on model failure. */
import { createHash } from 'node:crypto';

import { type Model, NoopTrace, withTrace } from '@openai/agents';
import { type Briefing, briefingSummarySchema } from '@reposleuth/shared';
import { z } from 'zod';

import { BudgetModel, DEFAULT_LIMITS, emptyUsage, StopError } from '../agents/budget.js';
import { investigationModelSettings } from '../agents/models/settings.js';
import type { ProviderConfig } from '../agents/provider.js';
import { reportText } from '../agents/reportResponse.js';
import { onboardingInstructions } from './onboardingInstructions.js';
import { validateSummary } from './summaryValidation.js';

export async function summarizeBriefing(
  report: Briefing,
  model: Model,
  provider: ProviderConfig,
  reserve: (usd: number) => void,
): Promise<Briefing> {
  const cleanReport = {
    ...report,
    summary: undefined,
    summaryError: undefined,
    walkthroughError: undefined,
    summaryDiagnostics: undefined,
  };
  const usage = emptyUsage();
  const documents = report.documents.map((d) => ({
    ...d,
    text: d.text.slice(0, 7000),
    complete: d.complete && d.text.length <= 7000,
  }));
  const sources = new Set([
    ...documents.map((d) => d.path),
    ...report.manifests.map((m) => m.path),
    ...(report.codeSources ?? []).map((s) => s.path),
  ]);
  if (!sources.size)
    return {
      ...cleanReport,
      summaryError: 'Not enough retrieved source to explain this repository.',
    };
  const facts = {
    repository: report.repository,
    scope: report.scope,
    documents,
    manifests: report.manifests,
    directories: report.directories,
    limitations: report.limitations,
    codeSources: (report.codeSources ?? []).map(({ text, ...source }) => ({
      ...source,
      lines: text.split('\n').map((text, index) => ({ line: source.startLine + index, text })),
    })),
    codeConnections: report.codeConnections ?? [],
    codeCoverage: report.codeCoverage ?? [],
  };
  const limits = { ...DEFAULT_LIMITS, turns: 1, outputTokens: 1800, costUsd: 0.03 };
  const budget = new BudgetModel(
    model,
    limits,
    usage,
    reserve,
    () => {},
    () => {},
    provider.rates,
    provider.provider,
    provider.model,
  );
  let stage: NonNullable<Briefing['summaryDiagnostics']>['stage'] = 'request';
  let responseText = '';
  const metadata = () => ({
    responseChars: responseText.length,
    responseSha256: createHash('sha256').update(responseText).digest('hex'),
  });
  try {
    const response = await withTrace(new NoopTrace(), () =>
      budget.getResponse({
        input: JSON.stringify(facts),
        systemInstructions: `${onboardingInstructions}\nReturn one JSON object matching this schema (the schema is not the answer):\n${JSON.stringify(z.toJSONSchema(briefingSummarySchema))}`,
        tools: [],
        handoffs: [],
        outputType: 'text',
        modelSettings: {
          ...investigationModelSettings(provider.provider, limits.outputTokens),
          toolChoice: 'none',
        },
        tracing: false,
      }),
    );
    stage = 'response';
    responseText = reportText(response);
    if (response.output.some((i) => i.type === 'function_call'))
      throw new StopError('UNEXPECTED_TOOL_CALL');
    if (responseText.length > 32000) throw new StopError('RESPONSE_TOO_LARGE');
    stage = 'json';
    const value: unknown = JSON.parse(responseText);
    const { diagnostic, ...validated } = validateSummary(value, report, sources);
    return {
      ...cleanReport,
      ...validated,
      model: provider.model,
      modelUsage: usage,
      ...(diagnostic ? { summaryDiagnostics: { ...diagnostic, ...metadata() } } : {}),
    };
  } catch (error) {
    const reason =
      error instanceof StopError
        ? error.code
        : stage === 'json'
          ? 'INVALID_SUMMARY_JSON'
          : stage === 'response'
            ? 'INVALID_SUMMARY_RESPONSE'
            : 'MODEL_REQUEST_FAILED';
    return {
      ...cleanReport,
      model: provider.model,
      modelUsage: usage,
      summaryDiagnostics: { stage, code: reason, issues: [], ...metadata() },
      summaryError: `AI overview could not be completed (${reason}). The source details are preserved. No automatic retry was made.`,
    };
  }
}
