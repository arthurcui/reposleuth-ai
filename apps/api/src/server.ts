import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { buildApp } from './app.js';

// Resolves to the workspace root in both src/ and dist/.
config({ path: fileURLToPath(new URL('../../../.env.local', import.meta.url)), quiet: true });
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const app = buildApp();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close(); });
}
try {
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`RepoSleuth API listening at http://127.0.0.1:${port}`);
} catch {
  console.error('Could not start the API. Check PORT and whether it is already in use.');
  process.exitCode = 1;
}
