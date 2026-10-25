/** Verifies production static serving and API routing in an isolated application. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { buildApp } from '../../../src/app.js';

it('serves the built site with API isolation and local-origin protections', async () => {
  const root = mkdtempSync(join(tmpdir(), 'reposleuth-static-'));
  const webRoot = join(root, 'public');
  mkdirSync(webRoot);
  writeFileSync(join(root, 'private.txt'), 'not public');
  writeFileSync(join(webRoot, 'index.html'), '<div id="root">demo</div>');
  writeFileSync(join(webRoot, 'app.js'), '/* built script */');
  const app = buildApp(undefined, { webRoot });
  try {
    expect((await app.inject('/?investigation=demo')).body).toContain('id="root"');
    expect((await app.inject('/app.js')).statusCode).toBe(200);
    expect((await app.inject('/api/health')).json().status).toBe('ok');
    for (const path of [
      '/api/missing',
      '/.env.local',
      '/data/investigations.sqlite',
      '/%2e%2e/private.txt',
    ]) {
      expect([403, 404]).toContain((await app.inject(path)).statusCode);
    }
    expect((await app.inject({ url: '/', headers: { host: 'evil.test' } })).statusCode).toBe(403);
    expect(
      (await app.inject({ url: '/api/health', headers: { origin: 'http://evil.test' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/investigations',
          payload: { repository: 'owner/repo', question: 'Investigate this' },
        })
      ).json().error,
    ).toBe('AGENT_NOT_CONFIGURED');
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
