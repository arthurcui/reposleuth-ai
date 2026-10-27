/** Verifies investigation lifecycle, persistence, cancellation, events, and budget handling. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Model } from '@openai/agents';
import { investigationModes, investigationRequestSchema } from '@reposleuth/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../../src/app.js';
import { RepositoryError } from '../../../src/github/RepositoryProvider.js';
import { InvestigationService } from '../../../src/services/investigationService.js';
import { InvestigationStore } from '../../../src/storage/sqlite.js';
import { fakeRepository, ScriptedModel, validReport } from '../../fixtures/agentFixtures.js';

const request = {
  repository: 'owner/repo',
  question: 'Investigate the slow endpoint',
  issueNumber: 42,
};
const resources: InvestigationService[] = [];
const directories: string[] = [];
afterEach(() => {
  resources.splice(0).forEach((service) => service.close());
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});
function make(model: () => Model = () => new ScriptedModel(), limits = {}) {
  const store = new InvestigationStore(':memory:');
  const service = new InvestigationService(store, async () => fakeRepository(), model, limits);
  resources.push(service);
  return service;
}
async function finish(service: InvestigationService, id: string) {
  for (let i = 0; i < 200; i++) {
    const record = service.store.get(id)!;
    if (!['queued', 'running'].includes(record.status)) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Fixture timed out');
}

describe('investigation lifecycle and API', () => {
  it('does not call the model after a timed-out issue preflight eventually resolves', async () => {
    const repository = fakeRepository();
    const original = repository.getIssue;
    let release!: () => void;
    repository.getIssue = async (number) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(number);
    };
    const model = vi.fn(() => new ScriptedModel());
    const service = new InvestigationService(
      new InvestigationStore(':memory:'),
      async () => repository,
      model,
      { timeoutMs: 30 },
    );
    resources.push(service);
    const id = service.start(request).id;
    expect(await finish(service, id)).toMatchObject({
      status: 'timed_out',
      usage: { requests: 0 },
    });
    const events = service.store.events(id).length;
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(model).not.toHaveBeenCalled();
    expect(service.store.events(id)).toHaveLength(events);
    expect(service.store.get(id)?.status).toBe('timed_out');
  });
  it('fails rate-limited model calls once and retains the conservative reservation', async () => {
    const getResponse = vi.fn(async () => {
      throw { status: 429, code: 'rate_limit_exceeded' };
    });
    const service = make(() => ({
      getResponse,
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    }));
    const run = await finish(service, service.start(request).id);
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'OPENAI_RATE_LIMIT',
      usage: { requests: 1, usageIncomplete: true },
    });
    expect(getResponse).toHaveBeenCalledTimes(1);
    expect(run.usage.reservedCostUsd).toBeGreaterThan(0);
    expect(run.report).toBeNull();
  });
  it.each(['NOT_FOUND', 'RATE_LIMITED'])(
    'checks the issue before using the model: %s',
    async (code) => {
      const repository = fakeRepository();
      repository.getIssue = vi
        .fn()
        .mockRejectedValue(new RepositoryError(code, 'Upstream details'));
      const model = vi.fn(() => new ScriptedModel());
      const service = new InvestigationService(
        new InvestigationStore(':memory:'),
        async () => repository,
        model,
      );
      resources.push(service);
      const run = await finish(service, service.start(request).id);
      expect(run).toMatchObject({
        status: 'failed',
        errorCode: code === 'NOT_FOUND' ? 'ISSUE_NOT_FOUND' : code,
        report: null,
        usage: {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          reservedCostUsd: 0,
          usageIncomplete: false,
        },
      });
      expect(model).not.toHaveBeenCalled();
      expect(repository.getIssue).toHaveBeenCalledWith(42);
      expect(service.store.reserved()).toBe(0);
    },
  );
  it('queues via HTTP, completes, persists usage and replays SSE after a cursor', async () => {
    const service = make();
    const app = buildApp(service);
    const started = await app.inject({
      method: 'POST',
      url: '/api/investigations',
      payload: request,
    });
    expect(started.statusCode).toBe(202);
    const id = started.json().id as string;
    expect((await finish(service, id)).status).toBe('completed');
    const state = await app.inject(`/api/investigations/${id}`);
    expect(state.json().usage.requests).toBe(4);
    const events = service.store.events(id);
    const cursor = events[1]!.id;
    const replay = await app.inject({
      url: `/api/investigations/${id}/events`,
      headers: { 'last-event-id': String(cursor) },
    });
    expect(replay.headers['content-type']).toBe('text/event-stream');
    expect(replay.body).not.toContain(`id: ${cursor}\n`);
    expect(replay.body).toContain('event: terminal');
    expect(replay.body).not.toContain('Untrusted issue text');
    await app.close();
  });

  it('returns an explicit failure for invented evidence', async () => {
    const report = validReport();
    report.evidence[0]!.endLine = 2;
    const service = make(() => new ScriptedModel(report));
    expect(await finish(service, service.start(request).id)).toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_EVIDENCE',
      report: null,
    });
  });

  it('persists budget exhaustion without making a model call', async () => {
    const model = new ScriptedModel();
    const service = make(() => model, { costUsd: 0.000001 });
    expect(await finish(service, service.start(request).id)).toMatchObject({
      status: 'budget_exceeded',
      errorCode: 'BUDGET_EXCEEDED_COST',
    });
    expect(model.requests).toHaveLength(0);
  });

  it('produces a partial report when the exploration tool budget ends', async () => {
    const service = make(() => new ScriptedModel(), { tools: 1 });
    expect(await finish(service, service.start(request).id)).toMatchObject({
      status: 'completed',
      report: {
        findings: [],
        unresolvedQuestions: expect.arrayContaining([
          expect.stringContaining('Partial investigation'),
        ]),
      },
    });
  });

  it('terminates a stalled model on timeout and preserves unknown usage', async () => {
    const service = make(
      () => ({
        getResponse: () => new Promise(() => {}),
        getStreamedResponse: () => {
          throw new Error('unused');
        },
      }),
      { timeoutMs: 30 },
    );
    expect(await finish(service, service.start(request).id)).toMatchObject({
      status: 'timed_out',
      usage: { requests: 1, usageIncomplete: true },
    });
  });

  it('cancels both queued and running investigations', async () => {
    const service = make(() => ({
      getResponse: () => new Promise(() => {}),
      getStreamedResponse: () => {
        throw new Error('unused');
      },
    }));
    const first = service.start(request);
    const second = service.start(request);
    service.cancel(second.id);
    expect(service.store.get(second.id)?.status).toBe('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 20));
    service.cancel(first.id);
    expect((await finish(service, first.id)).status).toBe('cancelled');
  });

  it('recovers interrupted runs and retains app-wide budget across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'reposleuth-test-'));
    directories.push(directory);
    const path = join(directory, 'test.sqlite');
    const service = make();
    const record = service.start(request);
    const store = new InvestigationStore(path);
    store.save({ ...record, status: 'running' });
    store.reserve(0.9, 1);
    store.close();
    const reopened = new InvestigationStore(path);
    const recovered = new InvestigationService(
      reopened,
      async () => fakeRepository(),
      () => new ScriptedModel(),
    );
    resources.push(recovered);
    expect(reopened.get(record.id)?.status).toBe('interrupted');
    expect(() => reopened.reserve(0.2, 1)).toThrow('BUDGET_EXCEEDED');
    expect(reopened.events(record.id).at(-1)?.type).toBe('terminal');
  });

  it('rejects bad input, nonlocal origins and missing runs without leaking details', async () => {
    const app = buildApp();
    expect(
      (await app.inject({ method: 'POST', url: '/api/investigations', payload: request }))
        .statusCode,
    ).toBe(503);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/investigations',
          payload: { ...request, repository: 'https://evil.test/repo' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/investigations',
          payload: request,
          headers: { origin: 'https://evil.test' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/api/health', headers: { host: 'evil.test' } })).statusCode,
    ).toBe(403);
    expect((await app.inject('/api/investigations/missing')).statusCode).toBe(404);
    await app.close();
  });
});

it.each(['quick', 'standard', 'deep'] as const)(
  'enforces and persists %s mode budgets and investigation policy',
  async (mode) => {
    const model = new ScriptedModel();
    const service = make(() => model);
    const run = await finish(service, service.start({ ...request, mode }).id);
    expect(run.status).toBe('completed');
    expect(run.request.mode).toBe(mode);
    const profile = investigationModes[mode];
    expect(run.limits).toMatchObject({
      costUsd: profile.costUsd,
      timeoutMs: profile.timeoutMs,
      turns: profile.turns,
      tools: profile.tools,
    });
    expect(
      service.store.events(run.id).find((event) => event.type === 'started')?.data,
    ).toMatchObject({ mode, limits: { costUsd: profile.costUsd } });
    expect(model.requests[0]?.systemInstructions).toContain(`${profile.label}:`);
    expect(model.requests[0]?.modelSettings.maxTokens).toBe(2000);
    if (mode === 'deep') {
      expect(model.requests[0]?.systemInstructions).toContain('counter-evidence');
      expect(model.requests[0]?.systemInstructions).toContain(
        'two plausible competing explanations',
      );
    }
  },
);
it('keeps explicit server ceilings below mode budgets and stops before a model call', async () => {
  const model = new ScriptedModel();
  const service = make(() => model, { costUsd: 0.000001, timeoutMs: 900000 });
  const run = await finish(service, service.start({ ...request, mode: 'deep' }).id);
  expect(run.status).toBe('budget_exceeded');
  expect(run.limits).toMatchObject({ costUsd: 0.000001, timeoutMs: 300000 });
  expect(model.requests).toHaveLength(0);
});
it('accepts legacy requests but rejects unknown modes and client-defined limits', () => {
  expect(investigationRequestSchema.safeParse(request).success).toBe(true);
  expect(investigationRequestSchema.safeParse({ ...request, mode: 'unlimited' }).success).toBe(
    false,
  );
  expect(investigationRequestSchema.safeParse({ ...request, costUsd: 100 }).success).toBe(false);
});
