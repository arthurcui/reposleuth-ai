/** Creates the Fastify application, registers API routes, and serves the built web UI. */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { healthSchema } from '@reposleuth/shared';
import { registerInvestigations } from './routes/investigations.js';
import type { InvestigationService } from './services/investigationService.js';
import type { InvestigationStore } from './storage/sqlite.js';

export function buildApp(
  service?: InvestigationService,
  options: { webRoot?: string; store?: InvestigationStore } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 16384 });
  app.addHook('onRequest', async (req, reply) => {
    // Loopback-only API: reject DNS rebinding and browser cross-origin requests.
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? ''))
      return reply.code(403).send({ error: 'LOCAL_ONLY' });
    const origin = req.headers.origin;
    if (origin) {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        return reply.code(403).send({ error: 'ORIGIN_DENIED' });
      }
      if (
        url.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        ![req.headers.host, 'localhost:5173', '127.0.0.1:5173'].includes(url.host)
      )
        return reply.code(403).send({ error: 'ORIGIN_DENIED' });
    }
    reply.header('Cache-Control', 'no-store');
  });
  registerInvestigations(app, service, options.store);
  if (options.webRoot) {
    void app.register(fastifyStatic, {
      root: options.webRoot,
      dotfiles: 'deny',
      index: ['index.html'],
    });
  }
  app.get('/api/health', async () =>
    healthSchema.parse({
      status: 'ok',
      service: 'reposleuth-api',
      stage: 'foundation',
    }),
  );
  return app;
}
