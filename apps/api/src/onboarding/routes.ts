/** Exposes onboarding creation, saved history, reopening and Markdown export. */
import { briefingMarkdown, briefingRequestSchema } from '@reposleuth/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { RepositoryError } from '../github/RepositoryProvider.js';
import type { BriefingService } from './BriefingService.js';

export function registerBriefings(app: FastifyInstance, service?: BriefingService) {
  app.post('/api/briefings', async (request, reply) => {
    if (!service)
      return reply.code(503).send({ error: 'Briefings are unavailable on this server.' });
    const parsed = briefingRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Enter a repository and an optional directory scope.' });
    try {
      return reply.code(202).send(service.start(parsed.data));
    } catch (error) {
      return reply
        .code(error instanceof RepositoryError && error.code === 'BUSY' ? 409 : 400)
        .send({
          error: error instanceof RepositoryError ? error.message : 'Could not create briefing.',
        });
    }
  });
  app.get('/api/briefings', async (request, reply) => {
    if (!service)
      return reply.code(503).send({ error: 'Briefings are unavailable on this server.' });
    const query = z.object({ q: z.string().max(250).default('') }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid search.' });
    return service.list(query.data.q);
  });
  app.get<{ Params: { id: string } }>('/api/briefings/:id', async (request, reply) => {
    const result = service?.get(request.params.id);
    return result ?? reply.code(404).send({ error: 'Briefing not found.' });
  });
  app.get<{ Params: { id: string } }>('/api/briefings/:id/markdown', async (request, reply) => {
    const result = service?.get(request.params.id);
    if (!result) return reply.code(404).send({ error: 'Briefing not found.' });
    if (result.status !== 'completed')
      return reply.code(409).send({ error: 'Briefing has not completed.' });
    return reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="onboarding-briefing.md"')
      .send(briefingMarkdown(result));
  });
  if (service) app.addHook('onClose', async () => service.close());
}
