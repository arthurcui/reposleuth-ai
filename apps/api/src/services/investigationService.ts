import { randomUUID } from 'node:crypto';
import { ToolCallError, type Model } from '@openai/agents';
import type { Investigation, InvestigationRequest, InvestigationStatus } from '@reposleuth/shared';
import type { RepositoryProvider } from '../github/RepositoryProvider.js';
import { RepositoryError } from '../github/RepositoryProvider.js';
import { DEFAULT_LIMITS, MODEL, emptyUsage, StopError, type RunLimits } from '../agents/budget.js';
import { investigate } from '../agents/investigator.js';
import { InvestigationStore } from '../storage/sqlite.js';

export class InvestigationService {
  private queue: string[] = [];
  private active?: { id: string; controller: AbortController };
  private closed = false;
  private readonly limits: RunLimits;
  constructor(readonly store: InvestigationStore, private readonly repository: (input: string) => Promise<RepositoryProvider>,
    private readonly model: () => Model, limits: Partial<RunLimits> = {}, private readonly lifetimeBudgetUsd = 1) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const record of store.active()) {
      record.status = 'interrupted'; record.errorCode = 'PROCESS_RESTARTED'; record.finishedAt = new Date().toISOString();
      record.durationMs = record.startedAt ? Date.now() - Date.parse(record.startedAt) : 0;
      store.save(record); store.append(record.id, 'terminal', { status: record.status, code: record.errorCode });
    }
  }
  start(request: InvestigationRequest): Investigation {
    if (this.closed) throw new StopError('SERVICE_STOPPED');
    if (this.queue.length + (this.active ? 1 : 0) >= 5) throw new StopError('QUEUE_FULL');
    if (this.store.reserved() >= this.lifetimeBudgetUsd) throw new StopError('BUDGET_EXCEEDED');
    const record: Investigation = { id: randomUUID(), request, status: 'queued', createdAt: new Date().toISOString(),
      startedAt: null, finishedAt: null, durationMs: 0, commitSha: null, report: null, errorCode: null, usage: emptyUsage(), model: MODEL };
    this.store.save(record); this.store.append(record.id, 'queued', {});
    this.queue.push(record.id);
    setImmediate(() => { void this.drain(); });
    return record;
  }
  cancel(id: string): boolean {
    const record = this.store.get(id);
    if (!record || !['queued', 'running'].includes(record.status)) return false;
    if (this.active?.id === id) this.active.controller.abort('CANCELLED');
    else {
      this.queue = this.queue.filter(item => item !== id);
      record.status = 'cancelled'; record.finishedAt = new Date().toISOString(); record.errorCode = 'CANCELLED';
      this.store.save(record); this.store.append(id, 'terminal', { status: record.status, code: record.errorCode });
    }
    return true;
  }
  private async drain() {
    if (this.closed || this.active || !this.queue.length) return;
    const id = this.queue.shift()!;
    const record = this.store.get(id)!;
    const controller = new AbortController();
    this.active = { id, controller };
    record.status = 'running'; record.startedAt = new Date().toISOString();
    this.store.save(record); this.store.append(id, 'started', { model: MODEL, limits: this.limits });
    let terminal = false;
    const save = () => { if (!this.closed && !terminal) this.store.save(record); };
    const emit = (type: string, data: Record<string, unknown>) => { if (!this.closed && !terminal) this.store.append(id, type, data); };
    const timer = setTimeout(() => controller.abort('TIMEOUT'), this.limits.timeoutMs);
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new StopError(controller.signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const work = async () => {
        const repository = await this.repository(record.request.repository);
        if (controller.signal.aborted) throw new StopError('CANCELLED');
        record.commitSha = repository.revision.commitSha; save();
        emit('revision', { commitSha: record.commitSha });
        return investigate({ repository, request: record.request, model: this.model(), limits: this.limits,
          usage: record.usage, signal: controller.signal,
          reserve: usd => { if (controller.signal.aborted || this.closed) throw new StopError('CANCELLED'); this.store.reserve(usd, this.lifetimeBudgetUsd); },
          saveUsage: () => { save(); emit('usage', { ...record.usage }); }, emit });
      };
      record.report = await Promise.race([work(), cancelled]);
      record.status = 'completed';
    } catch (error) {
      const cause = error instanceof ToolCallError ? error.error : error;
      const code = cause instanceof StopError || cause instanceof RepositoryError ? cause.code
        : cause instanceof Error && cause.name === 'MaxTurnsExceededError' ? 'BUDGET_EXCEEDED' : 'INVESTIGATION_FAILED';
      const states: Record<string, InvestigationStatus> = { BUDGET_EXCEEDED: 'budget_exceeded', TIMEOUT: 'timed_out', CANCELLED: 'cancelled' };
      record.status = states[code] ?? 'failed'; record.errorCode = code;
    } finally {
      terminal = true; clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
      record.finishedAt = new Date().toISOString(); record.durationMs = Date.now() - Date.parse(record.startedAt!);
      if (!this.closed) { this.store.save(record); this.store.append(id, 'terminal', { status: record.status, code: record.errorCode, durationMs: record.durationMs }); }
      this.active = undefined;
      if (!this.closed) setImmediate(() => { void this.drain(); });
    }
  }
  close() {
    if (this.closed) return;
    // Persist interruption synchronously before closing; late SDK/tool callbacks are ignored.
    this.closed = true;
    this.active?.controller.abort('CANCELLED');
    for (const record of this.store.active()) {
      record.status = 'interrupted'; record.errorCode = 'SERVICE_STOPPED'; record.finishedAt = new Date().toISOString();
      this.store.save(record); this.store.append(record.id, 'terminal', { status: record.status, code: record.errorCode });
    }
    this.queue = []; this.store.close();
  }
}
