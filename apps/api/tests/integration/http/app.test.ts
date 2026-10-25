/** Verifies API health and request validation through Fastify injection. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../../src/app.js';

describe('local API foundation', () => {
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    app = buildApp();
  });
  afterEach(async () => {
    await app.close();
  });
  it('provides health without credentials or external requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'reposleuth-api',
      stage: 'foundation',
    });
  });
  it('rejects malformed investigation requests', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/investigations', payload: {} });
    expect(response.statusCode).toBe(400);
  });
});
