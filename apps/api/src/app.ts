import Fastify from 'fastify';
import { healthSchema } from '@reposleuth/shared';
import { registerInvestigations } from './routes/investigations.js';
import type { InvestigationService } from './services/investigationService.js';

export function buildApp(service?: InvestigationService) {
  const app = Fastify({ logger: false, bodyLimit: 16384 });
  app.addHook('onRequest', async (req, reply) => {
    // Loopback-only API: reject DNS rebinding and browser cross-origin requests.
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '')) return reply.code(403).send({ error: 'LOCAL_ONLY' });
    const origin = req.headers.origin;
    if (origin) {
      let url: URL;
      try { url = new URL(origin); } catch { return reply.code(403).send({ error: 'ORIGIN_DENIED' }); }
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
        || ![req.headers.host, 'localhost:5173', '127.0.0.1:5173'].includes(url.host)) return reply.code(403).send({ error: 'ORIGIN_DENIED' });
    }
    reply.header('Cache-Control', 'no-store');
  });
  registerInvestigations(app, service);
  app.get('/api/health', async () => healthSchema.parse({
    status: 'ok', service: 'reposleuth-api', stage: 'foundation',
  }));
  return app;
}
