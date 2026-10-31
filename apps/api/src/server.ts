/** Starts the API server with environment configuration, persistence, and shutdown handling. */
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

import { ModelCatalogService, modelProfiles } from './agents/modelCatalog.js';
import { liveModel } from './agents/models/createModel.js';
import { providerConfig } from './agents/provider.js';
import { buildApp } from './app.js';
import { OctokitProvider } from './github/OctokitProvider.js';
import { BriefingService } from './onboarding/BriefingService.js';
import { summarizeBriefing } from './onboarding/summarize.js';
import { InvestigationService } from './services/investigationService.js';
import { InvestigationStore } from './storage/sqlite.js';

// Resolves to the workspace root in both src/ and dist/.
config({ path: fileURLToPath(new URL('../../../.env.local', import.meta.url)), quiet: true });
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const appBudget = Number(process.env.APP_BUDGET_USD ?? 1);
if (!Number.isFinite(appBudget) || appBudget <= 0 || appBudget > 5)
  throw new Error('APP_BUDGET_USD must be greater than zero and at most 5');
const provider = providerConfig();
const apiKey = process.env.DEMO_ONLY === '1' ? undefined : process.env[provider.keyVariable];
const keys =
  process.env.DEMO_ONLY === '1'
    ? {}
    : { openai: process.env.OPENAI_API_KEY, gemini: process.env.GEMINI_API_KEY };
const catalog = new ModelCatalogService(
  keys,
  modelProfiles(process.env.MODEL_PROFILES_JSON),
  provider,
);
const store = new InvestigationStore(
  fileURLToPath(new URL('../../../data/investigations.sqlite', import.meta.url)),
);
const service =
  apiKey || keys.openai || keys.gemini
    ? new InvestigationService(
        store,
        (repository) => OctokitProvider.connect(repository, { token: process.env.GITHUB_TOKEN }),
        (selected) => liveModel(keys[selected.provider]!, selected),
        {},
        appBudget,
        provider,
      )
    : undefined;
const app = buildApp(service, {
  briefings:
    process.env.DEMO_ONLY === '1'
      ? undefined
      : new BriefingService(
          fileURLToPath(new URL('../../../data/briefings.sqlite', import.meta.url)),
          (repository) => OctokitProvider.connect(repository, { token: process.env.GITHUB_TOKEN }),
          async (report, request) => {
            try {
              const selected = request.selection
                ? await catalog.resolve(request.selection)
                : provider;
              const key = keys[selected.provider];
              if (!key)
                return {
                  ...report,
                  summaryError:
                    'Configure a model API key on the server to generate the readable overview. Source details remain available.',
                };
              return await summarizeBriefing(report, liveModel(key, selected), selected, (usd) =>
                store.reserve(usd, appBudget),
              );
            } catch {
              return {
                ...report,
                summaryError:
                  'Selected model is unavailable. Choose an enabled model and generate a new briefing.',
              };
            }
          },
        ),
  store,
  catalog,
  ...(process.env.SERVE_WEB === '1'
    ? { webRoot: fileURLToPath(new URL('../../web/dist/', import.meta.url)) }
    : {}),
});
// Container ingress requires a wildcard bind inside the container. Compose publishes loopback only.
const host = process.env.CONTAINER_MODE === '1' ? '0.0.0.0' : '127.0.0.1';
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().catch(() => {
      console.error('API shutdown failed.');
      process.exitCode = 1;
    });
  });
}
try {
  await app.listen({ port, host });
  console.log(`RepoSleuth API listening at http://127.0.0.1:${port}`);
} catch {
  console.error('Could not start the API. Check PORT and whether it is already in use.');
  process.exitCode = 1;
}
