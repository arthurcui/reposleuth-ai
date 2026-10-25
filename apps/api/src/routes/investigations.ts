/** Registers investigation lifecycle, report, source, and event-stream HTTP endpoints. */
import { historyQuerySchema, investigationRequestSchema } from '@reposleuth/shared';
import type { FastifyInstance } from 'fastify';

import { StopError } from '../agents/budget.js';
import type { ModelCatalogService } from '../agents/modelCatalog.js';
import { parseRepository } from '../github/repositoryIndex.js';
import type { InvestigationService } from '../services/investigationService.js';
import { exportMarkdown } from '../services/markdownExport.js';
import type { InvestigationStore } from '../storage/sqlite.js';

export function registerInvestigations(
  app: FastifyInstance,
  service?: InvestigationService,
  store: InvestigationStore | undefined = service?.store,
  catalog?: ModelCatalogService,
) {
  const streams = new Set<() => void>();
  app.get('/api/investigations/models', async (_req, reply) => {
    if (!catalog) return reply.code(503).send({ error: 'MODEL_DISCOVERY_UNAVAILABLE' });
    return catalog.list();
  });
  app.addHook('preClose', async () => {
    for (const close of streams) close();
  });
  app.addHook('onClose', async () => {
    service?.close();
    if (!service) store?.close();
  });
  app.get('/api/investigations', async (req, reply) => {
    const query = historyQuerySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'INVALID_HISTORY_QUERY' });
    if (!store) return reply.code(503).send({ error: 'HISTORY_UNAVAILABLE' });
    if (query.data.repository) {
      try {
        const parsed = parseRepository(query.data.repository);
        query.data.repository = `${parsed.owner}/${parsed.repo}`;
      } catch {
        return reply.code(400).send({ error: 'INVALID_REPOSITORY' });
      }
    }
    return store.list(query.data);
  });
  app.get<{ Params: { id: string } }>('/api/investigations/:id/export', async (req, reply) => {
    const run = store?.get(req.params.id);
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!run.report) return reply.code(409).send({ error: 'REPORT_NOT_AVAILABLE' });
    const filename = run.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return reply
      .header('Content-Disposition', `attachment; filename="investigation-${filename}.md"`)
      .header('Cache-Control', 'no-store')
      .type('text/markdown; charset=utf-8')
      .send(exportMarkdown(run));
  });
  app.post('/api/investigations', async (req, reply) => {
    const input = investigationRequestSchema.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    try {
      const parsed = parseRepository(input.data.repository);
      input.data.repository = `${parsed.owner}/${parsed.repo}`;
    } catch {
      return reply.code(400).send({ error: 'INVALID_REPOSITORY' });
    }
    if (!service) return reply.code(503).send({ error: 'AGENT_NOT_CONFIGURED' });
    try {
      let selected;
      if (catalog) {
        const selection = input.data.modelSelection ?? (await catalog.list()).defaultSelection;
        try {
          selected = await catalog.resolve(selection);
        } catch {
          return reply.code(400).send({ error: 'MODEL_UNAVAILABLE' });
        }
      } else if (input.data.modelSelection) {
        return reply.code(400).send({ error: 'MODEL_UNAVAILABLE' });
      }
      const run = service.start(input.data, selected);
      return reply
        .code(202)
        .send({ id: run.id, status: run.status, repository: run.request.repository });
    } catch (error) {
      return reply
        .code(429)
        .send({ error: error instanceof StopError ? error.code : 'UNAVAILABLE' });
    }
  });
  app.get<{ Params: { id: string } }>('/api/investigations/:id', async (req, reply) => {
    const record = store?.get(req.params.id);
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (record.status === 'running' && record.startedAt)
      record.durationMs = Date.now() - Date.parse(record.startedAt);
    return record;
  });
  app.post<{ Params: { id: string } }>('/api/investigations/:id/cancel', async (req, reply) => {
    if (!service?.store.get(req.params.id)) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { cancelled: service.cancel(req.params.id) };
  });
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/api/investigations/:id/events',
    async (req, reply) => {
      if (!store?.get(req.params.id)) return reply.code(404).send({ error: 'NOT_FOUND' });
      const cursor = req.headers['last-event-id'] ?? req.query.after ?? '0';
      if (
        typeof cursor !== 'string' ||
        !/^\d+$/.test(cursor) ||
        !Number.isSafeInteger(Number(cursor))
      )
        return reply.code(400).send({ error: 'INVALID_CURSOR' });
      if (streams.size >= 10) return reply.code(429).send({ error: 'TOO_MANY_STREAMS' });
      let after = Number(cursor);
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        clearTimeout(expiry);
        streams.delete(close);
        reply.raw.end();
      };
      const pump = () => {
        if (closed) return;
        for (const event of store.events(req.params.id, after)) {
          after = event.id;
          if (
            !reply.raw.write(
              `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
          ) {
            close();
            return;
          }
        }
        const state = store.get(req.params.id)?.status;
        if (state !== 'queued' && state !== 'running') close();
      };
      const poll = setInterval(pump, 200);
      const heartbeat = setInterval(() => {
        if (!reply.raw.write(': heartbeat\n\n')) close();
      }, 15000);
      const expiry = setTimeout(close, 180000);
      streams.add(close);
      reply.raw.once('close', close);
      pump();
    },
  );
}
