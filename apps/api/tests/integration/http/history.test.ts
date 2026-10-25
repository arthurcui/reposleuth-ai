/** Verifies credential-free history, filters, report reopening, export, and existing access guards. */
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../../src/app.js';
import { InvestigationStore } from '../../../src/storage/sqlite.js';
import { savedInvestigation } from '../../fixtures/savedInvestigation.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
function create() {
  const store = new InvestigationStore(':memory:');
  store.save(savedInvestigation());
  store.save(savedInvestigation({ id: 'failed-run', status: 'failed', report: null }));
  const app = buildApp(undefined, { store });
  apps.push(app);
  return app;
}
describe('history HTTP API', () => {
  it('lists, filters by URL and status, reopens, and exports without a configured model', async () => {
    const app = create();
    const response = await app.inject({
      method: 'GET',
      url: '/api/investigations?repository=https%3A%2F%2Fgithub.com%2Fowner%2Frepo&status=completed&q=customers.ts',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      items: [{ id: 'saved-run', hasReport: true }],
    });
    expect(response.json().items[0]).not.toHaveProperty('report');
    const reopened = await app.inject('/api/investigations/saved-run');
    expect(reopened.json().report.summary).toContain('database');
    const exported = await app.inject('/api/investigations/saved-run/export');
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('text/markdown');
    expect(exported.headers['content-disposition']).toContain('investigation-saved-run.md');
    expect(exported.body).toContain('## Findings');
    expect(exported.body).toContain('await db.orders.findMany();');
    expect((await app.inject('/api/investigations/failed-run/export')).statusCode).toBe(409);
    expect((await app.inject('/api/investigations/missing/export')).statusCode).toBe(404);
  });
  it.each([
    'limit=0',
    'limit=101',
    'offset=-1',
    'issueNumber=0',
    'issueNumber=1.5',
    'status=anything',
    'unknown=1',
    'q=' + 'a'.repeat(301),
    'repository=invalid',
  ])('rejects invalid query %s', async (query) => {
    expect((await create().inject(`/api/investigations?${query}`)).statusCode).toBe(400);
  });
  it('retains host and origin restrictions for history and export', async () => {
    const app = create();
    for (const url of ['/api/investigations', '/api/investigations/saved-run/export']) {
      expect((await app.inject({ url, headers: { host: 'attacker.example' } })).statusCode).toBe(
        403,
      );
      expect(
        (await app.inject({ url, headers: { origin: 'https://attacker.example' } })).statusCode,
      ).toBe(403);
    }
  });
});
