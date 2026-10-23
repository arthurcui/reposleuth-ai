import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { InvestigationStore } from '../storage/sqlite.js';
import { InvestigationService } from '../services/investigationService.js';
import { liveModel } from './investigator.js';
import { fakeRepository } from '../tests/agentFixtures.js';
import { SOURCE } from '../github/fixtures.js';

// Explicit opt-in only; never runs in npm test/check. Uses synthetic source, not private code.
config({ path: fileURLToPath(new URL('../../../../.env.local', import.meta.url)), quiet: true });
if (process.argv[2] !== '--live' || !process.env.OPENAI_API_KEY) {
  console.error('Requires a saved key and explicit --live flag. This performs paid model calls.');
  process.exitCode = 1;
} else {
  const store = new InvestigationStore(fileURLToPath(new URL('../../../../data/live-smoke.sqlite', import.meta.url)));
  const provider = fakeRepository();
  provider.readFile = async () => ({ ...provider.revision, path: 'src/customers.ts', startLine: 1, endLine: 7, totalLines: 7,
    lines: SOURCE.trimEnd().split('\n').map((text, index) => ({ line: index + 1, text })) });
  const service = new InvestigationService(store, async () => provider, () => {
    const model = liveModel(process.env.OPENAI_API_KEY!);
    return {
      getStreamedResponse: model.getStreamedResponse.bind(model),
      getResponse: async (request: Parameters<typeof model.getResponse>[0]) => {
        try { return await model.getResponse(request); }
        catch (error) {
          // Diagnostic metadata only: never print messages, headers, requests, or credentials.
          const raw = error as { status?: unknown; code?: unknown; type?: unknown; error?: { code?: unknown; type?: unknown } };
          const safe = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(value) ? value : null;
          console.error(JSON.stringify({ status: typeof raw.status === 'number' ? raw.status : null,
            code: safe(raw.code), type: safe(raw.type), nestedCode: safe(raw.error?.code), nestedType: safe(raw.error?.type) }));
          throw error;
        }
      },
    };
  },
    { turns: 6, tools: 8, costUsd: 0.02, timeoutMs: 90000 }, 0.05);
  try {
    const run = service.start({ repository: 'owner/repo', question: 'Synthetic fixture: read src/customers.ts lines 1-7, investigate query scaling, and propose a fix. Cite exact source. No runtime evidence exists.' });
    while (true) {
      const record = store.get(run.id)!;
      if (!['queued', 'running'].includes(record.status)) {
        console.log(JSON.stringify({ id: record.id, status: record.status, errorCode: record.errorCode,
          model: record.model, durationMs: record.durationMs, usage: record.usage,
          findings: record.report?.findings.length ?? 0, evidence: record.report?.evidence.length ?? 0 }));
        if (record.status !== 'completed') process.exitCode = 1;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } finally { service.close(); }
}
