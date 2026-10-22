import Fastify from 'fastify';
import { healthSchema } from '@reposleuth/shared';

export function buildApp() {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => healthSchema.parse({
    status: 'ok', service: 'reposleuth-api', stage: 'foundation',
  }));
  return app;
}
