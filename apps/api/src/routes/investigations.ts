/** Registers investigation lifecycle, report, source, and event-stream HTTP endpoints. */
import type { FastifyInstance } from 'fastify';
import { investigationRequestSchema } from '@reposleuth/shared';
import { parseRepository } from '../github/repositoryIndex.js';
import { StopError } from '../agents/budget.js';
import type { InvestigationService } from '../services/investigationService.js';

export function registerInvestigations(app: FastifyInstance, service?: InvestigationService) {
  const streams = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of streams) close();
  });
  app.addHook('onClose', async () => {
    service?.close();
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
      const run = service.start(input.data);
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
    const record = service?.store.get(req.params.id);
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
      if (!service?.store.get(req.params.id)) return reply.code(404).send({ error: 'NOT_FOUND' });
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
        for (const event of service.store.events(req.params.id, after)) {
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
        const state = service.store.get(req.params.id)?.status;
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
