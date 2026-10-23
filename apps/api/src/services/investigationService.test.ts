import { afterEach, describe, expect, it } from 'vitest';
import type { Model } from '@openai/agents';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvestigationStore } from '../storage/sqlite.js';
import { InvestigationService } from './investigationService.js';
import { fakeRepository, ScriptedModel, validReport } from '../tests/agentFixtures.js';
import { buildApp } from '../app.js';

const request = { repository: 'owner/repo', question: 'Investigate the slow endpoint', issueNumber: 42 };
const resources: InvestigationService[] = [];
const directories: string[] = [];
afterEach(() => { resources.splice(0).forEach(service => service.close()); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function make(model: () => Model = () => new ScriptedModel(), limits = {}) {
  const store = new InvestigationStore(':memory:');
  const service = new InvestigationService(store, async () => fakeRepository(), model, limits);
  resources.push(service); return service;
}
async function finish(service: InvestigationService, id: string) {
  for (let i = 0; i < 200; i++) {
    const record = service.store.get(id)!;
    if (!['queued', 'running'].includes(record.status)) return record;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Fixture timed out');
}

describe('investigation lifecycle and API', () => {
  it('queues via HTTP, completes, persists usage and replays SSE after a cursor', async () => {
    const service = make(); const app = buildApp(service);
    const started = await app.inject({ method: 'POST', url: '/api/investigations', payload: request });
    expect(started.statusCode).toBe(202);
    const id = started.json().id as string;
    expect((await finish(service, id)).status).toBe('completed');
    const state = await app.inject(`/api/investigations/${id}`);
    expect(state.json().usage.requests).toBe(4);
    const events = service.store.events(id);
    const cursor = events[1]!.id;
    const replay = await app.inject({ url: `/api/investigations/${id}/events`, headers: { 'last-event-id': String(cursor) } });
    expect(replay.headers['content-type']).toBe('text/event-stream');
    expect(replay.body).not.toContain(`id: ${cursor}\n`);
    expect(replay.body).toContain('event: terminal');
    expect(replay.body).not.toContain('Untrusted issue text');
    await app.close();
  });

  it('returns an explicit failure for invented evidence', async () => {
    const report = validReport(); report.evidence[0]!.quote = 'invented';
    const service = make(() => new ScriptedModel(report));
    expect(await finish(service, service.start(request).id)).toMatchObject({ status: 'failed', errorCode: 'INVALID_EVIDENCE', report: null });
  });

  it('persists budget exhaustion without making a model call', async () => {
    const model = new ScriptedModel(); const service = make(() => model, { costUsd: 0.000001 });
    expect(await finish(service, service.start(request).id)).toMatchObject({ status: 'budget_exceeded', errorCode: 'BUDGET_EXCEEDED' });
    expect(model.requests).toHaveLength(0);
  });

  it('records tool-budget exhaustion as a budget terminal state', async () => {
    const service = make(() => new ScriptedModel(), { tools: 1 });
    expect(await finish(service, service.start(request).id)).toMatchObject({ status: 'budget_exceeded', errorCode: 'BUDGET_EXCEEDED' });
  });

  it('terminates a stalled model on timeout and preserves unknown usage', async () => {
    const service = make(() => ({ getResponse: () => new Promise(() => {}), getStreamedResponse: () => { throw new Error('unused'); } }), { timeoutMs: 30 });
    expect(await finish(service, service.start(request).id)).toMatchObject({ status: 'timed_out', usage: { requests: 1, usageIncomplete: true } });
  });

  it('cancels both queued and running investigations', async () => {
    const service = make(() => ({ getResponse: () => new Promise(() => {}), getStreamedResponse: () => { throw new Error('unused'); } }));
    const first = service.start(request); const second = service.start(request);
    service.cancel(second.id);
    expect(service.store.get(second.id)?.status).toBe('cancelled');
    await new Promise(resolve => setTimeout(resolve, 20));
    service.cancel(first.id);
    expect((await finish(service, first.id)).status).toBe('cancelled');
  });

  it('recovers interrupted runs and retains app-wide budget across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'reposleuth-test-')); directories.push(directory);
    const path = join(directory, 'test.sqlite');
    const service = make(); const record = service.start(request);
    const store = new InvestigationStore(path); store.save({ ...record, status: 'running' }); store.reserve(0.9, 1); store.close();
    const reopened = new InvestigationStore(path);
    const recovered = new InvestigationService(reopened, async () => fakeRepository(), () => new ScriptedModel()); resources.push(recovered);
    expect(reopened.get(record.id)?.status).toBe('interrupted');
    expect(() => reopened.reserve(0.2, 1)).toThrow('BUDGET_EXCEEDED');
    expect(reopened.events(record.id).at(-1)?.type).toBe('terminal');
  });

  it('rejects bad input, nonlocal origins and missing runs without leaking details', async () => {
    const app = buildApp();
    expect((await app.inject({ method: 'POST', url: '/api/investigations', payload: request })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/investigations', payload: { ...request, repository: 'https://evil.test/repo' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/investigations', payload: request, headers: { origin: 'https://evil.test' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/health', headers: { host: 'evil.test' } })).statusCode).toBe(403);
    expect((await app.inject('/api/investigations/missing')).statusCode).toBe(404);
    await app.close();
  });
});
