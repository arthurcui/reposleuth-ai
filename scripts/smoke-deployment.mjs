/** Checks a running deployment for health, static UI delivery, and API behavior. */
// Read-only deployment checks. Deliberately never starts a model investigation.
import assert from 'node:assert/strict';
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:5174';
const url = new URL(base);
assert(['localhost', '127.0.0.1'].includes(url.hostname), 'Smoke target must be local');
const get = (path) => fetch(new URL(path, base), { signal: AbortSignal.timeout(5000) });
const health = await get('/api/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
const page = await get('/?investigation=demo');
assert.equal(page.status, 200);
const html = await page.text();
assert(html.includes('<div id="root">'));
const asset = html.match(/src="([^"]+\.js)"/);
assert(asset, 'Built script must be referenced');
const script = await get(asset[1]);
assert.equal(script.status, 200);
const scriptText = await script.text();
assert(scriptText.includes('Illustrative demo'));
assert(scriptText.includes('Explore the 20 defect cases'), 'Demo case selector must be included');
assert(!/sk-proj-[A-Za-z0-9_-]{20,}/.test(scriptText), 'Credential-like value in browser bundle');
for (const path of [
  '/.env.local',
  '/data/investigations.sqlite',
  '/src/server.ts',
  '/api/does-not-exist',
]) {
  assert([403, 404].includes((await get(path)).status), `Unexpected exposure: ${path}`);
}
console.log(
  'Deployment smoke passed: API health, built UI/demo assets, and private-path exclusions. No model calls.',
);
