/** Verifies the agent tool loop, report validation, and failure handling using scripted responses. */
import { type Model, type ModelRequest, type ModelResponse, Usage } from '@openai/agents';
import type { InvestigationReport } from '@reposleuth/shared';
import { describe, expect, it } from 'vitest';

import { BudgetModel, DEFAULT_LIMITS, emptyUsage } from '../../../src/agents/budget.js';
import { investigate } from '../../../src/agents/investigator.js';
import { validateEvidence } from '../../../src/services/evidenceValidator.js';
import { fakeRepository, ScriptedModel, validReport } from '../../fixtures/agentFixtures.js';

describe('SDK investigation loop', () => {
  it('records a safe validation reason while rejecting the report without retrying', async () => {
    const report = validReport();
    report.evidence[0]!.quote = 'untrusted rejected text';
    const model = new ScriptedModel(report);
    const diagnostics: Record<string, unknown>[] = [];
    await expect(
      investigate({
        repository: fakeRepository(),
        request: { repository: 'owner/repo', question: 'Investigate the query' },
        model,
        limits: DEFAULT_LIMITS,
        usage: emptyUsage(),
        signal: new AbortController().signal,
        reserve: () => {},
        saveUsage: () => {},
        emit: (type, data) => {
          if (type === 'validation_failed') diagnostics.push(data);
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EVIDENCE', reason: 'QUOTE_MISMATCH' });
    expect(diagnostics).toEqual([{ reason: 'QUOTE_MISMATCH', evidenceIndex: 1 }]);
    expect(JSON.stringify(diagnostics)).not.toContain('untrusted rejected text');
    expect(model.requests).toHaveLength(4);
  });
  it('selects tools iteratively, returns validated evidence, aggregates usage, and emits safe steps', async () => {
    const model = new ScriptedModel();
    const usage = emptyUsage();
    const events: string[] = [];
    const report = await investigate({
      repository: fakeRepository(),
      request: { repository: 'owner/repo', question: 'Why is loading slow?', issueNumber: 42 },
      model,
      limits: DEFAULT_LIMITS,
      usage,
      signal: new AbortController().signal,
      reserve: () => {},
      saveUsage: () => {},
      emit: (type) => events.push(type),
    });
    expect(report.findings[0]?.kind).toBe('hypothesis');
    expect(usage).toMatchObject({
      requests: 4,
      inputTokens: 800,
      outputTokens: 400,
      usageIncomplete: false,
      reservedCostUsd: 0,
    });
    expect(events.filter((type) => type === 'tool_finished')).toHaveLength(3);
    expect(
      model.requests.every(
        (request) => request.tracing === false && request.modelSettings.store === false,
      ),
    ).toBe(true);
    expect(model.requests[3]?.input).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'function_call_result' })]),
    );
  });

  it('rejects forged quotes, ranges, SHAs and evidence IDs', () => {
    const repository = fakeRepository();
    const reads = [
      {
        ...repository.revision,
        path: 'src/customers.ts',
        startLine: 1,
        endLine: 1,
        totalLines: 1,
        lines: [{ line: 1, text: 'await db.orders.findMany();' }],
      },
    ];
    for (const mutate of [
      (r: InvestigationReport) => {
        r.evidence[0]!.quote = 'invented';
      },
      (r: InvestigationReport) => {
        r.evidence[0]!.endLine = 2;
      },
      (r: InvestigationReport) => {
        r.evidence[0]!.commitSha = 'f'.repeat(40);
      },
      (r: InvestigationReport) => {
        r.findings[0]!.evidenceIds = ['unknown'];
      },
      (r: InvestigationReport) => {
        r.evidence.push(r.evidence[0]!);
      },
    ]) {
      const report = validReport();
      mutate(report);
      expect(() => validateEvidence(report, repository.revision, reads)).toThrow(
        'INVALID_EVIDENCE',
      );
    }
    expect(() => validateEvidence(validReport(), repository.revision, [])).toThrow(
      'INVALID_EVIDENCE',
    );
  });

  it('stops before a model call when the cost budget cannot cover it', async () => {
    const model = new ScriptedModel();
    await expect(
      investigate({
        repository: fakeRepository(),
        request: { repository: 'owner/repo', question: 'Investigate this' },
        model,
        limits: { ...DEFAULT_LIMITS, costUsd: 0.000001 },
        usage: emptyUsage(),
        signal: new AbortController().signal,
        reserve: () => {},
        saveUsage: () => {},
        emit: () => {},
      }),
    ).rejects.toThrow('BUDGET_EXCEEDED');
    expect(model.requests).toHaveLength(0);
  });

  it('stops excess tool calls instead of swallowing the budget failure', async () => {
    await expect(
      investigate({
        repository: fakeRepository(),
        request: { repository: 'owner/repo', question: 'Investigate this' },
        model: new ScriptedModel(),
        limits: { ...DEFAULT_LIMITS, tools: 1 },
        usage: emptyUsage(),
        signal: new AbortController().signal,
        reserve: () => {},
        saveUsage: () => {},
        emit: () => {},
      }),
    ).rejects.toThrow();
  });

  it('retains a conservative reservation on an uncertain model failure', async () => {
    const usage = emptyUsage();
    const delegate: Model = {
      getResponse: async () => {
        throw new Error('transport failure');
      },
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    };
    const model = new BudgetModel(
      delegate,
      DEFAULT_LIMITS,
      usage,
      () => {},
      () => {},
      () => {},
    );
    const request: ModelRequest = {
      input: 'test',
      modelSettings: {},
      tools: [],
      handoffs: [],
      outputType: 'text',
      tracing: false,
    };
    await expect(model.getResponse(request)).rejects.toThrow();
    expect(usage.requests).toBe(1);
    expect(usage.usageIncomplete).toBe(true);
    expect(usage.reservedCostUsd).toBeGreaterThan(0);
  });

  it('blocks total token overrun after a provider response', async () => {
    const delegate: Model = {
      getResponse: async (): Promise<ModelResponse> => ({
        usage: new Usage({ inputTokens: 100001, outputTokens: 1 }),
        output: [],
      }),
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    };
    const model = new BudgetModel(
      delegate,
      DEFAULT_LIMITS,
      emptyUsage(),
      () => {},
      () => {},
      () => {},
    );
    await expect(
      model.getResponse({
        input: 'test',
        modelSettings: {},
        tools: [],
        handoffs: [],
        outputType: 'text',
        tracing: false,
      }),
    ).rejects.toThrow('BUDGET_EXCEEDED');
  });

  it.each([
    [{ status: 429, code: 'credit_balance_exhausted', type: 'insufficient_quota' }, 'OPENAI_QUOTA'],
    [{ status: 429, code: 'rate_limit_exceeded' }, 'OPENAI_RATE_LIMIT'],
    [{ status: 401 }, 'OPENAI_AUTHENTICATION'],
    [{ status: 404, code: 'model_not_found' }, 'OPENAI_ACCESS'],
  ])('classifies provider errors without exposing raw details', async (error, expected) => {
    const delegate: Model = {
      getResponse: async () => {
        throw error;
      },
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    };
    const model = new BudgetModel(
      delegate,
      DEFAULT_LIMITS,
      emptyUsage(),
      () => {},
      () => {},
      () => {},
    );
    await expect(
      model.getResponse({
        input: 'test',
        modelSettings: {},
        tools: [],
        handoffs: [],
        outputType: 'text',
        tracing: false,
      }),
    ).rejects.toThrow(expected);
  });
});
