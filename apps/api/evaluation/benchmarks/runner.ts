/** Verifies public benchmark inputs or runs budgeted live investigations and saves results. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Investigation } from '@reposleuth/shared';
import { config } from 'dotenv';
import { z } from 'zod';

import { DEFAULT_LIMITS } from '../../src/agents/budget.js';
import { liveModel } from '../../src/agents/models/createModel.js';
import { OPENAI, providerConfig } from '../../src/agents/provider.js';
import { OctokitProvider } from '../../src/github/OctokitProvider.js';
import { RepositoryError, type RepositoryProvider } from '../../src/github/RepositoryProvider.js';
import { InvestigationService } from '../../src/services/investigationService.js';
import { InvestigationStore } from '../../src/storage/sqlite.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const manifestSchema = z
  .strictObject({
    version: z.literal(1),
    cases: z
      .array(
        z.strictObject({
          id: z.string().regex(/^case-\d{2}$/),
          repository: z.string().regex(/^arthurcui\/reposleuth-bench-[a-z-]+$/),
          issueNumber: z.number().int().positive(),
          issueUrl: z.url(),
          title: z.string(),
          commitSha: z.string().regex(/^[a-f0-9]{40}$/),
        }),
      )
      .min(1),
  })
  .refine(
    (value) => new Set(value.cases.map((c) => c.id)).size === value.cases.length,
    'Case IDs must be unique',
  );
export function readManifest() {
  return manifestSchema.parse(
    JSON.parse(readFileSync(`${root}benchmarks/public-projects.json`, 'utf8')),
  );
}
export function verificationRepositories(
  connect: (repository: string, commitSha: string) => Promise<RepositoryProvider>,
) {
  const cache = new Map<string, Promise<RepositoryProvider>>();
  return (repository: string, commitSha: string) => {
    const key = `${repository}@${commitSha}`;
    if (!cache.has(key)) cache.set(key, connect(repository, commitSha));
    return cache.get(key)!;
  };
}
export function benchmarkError(error: unknown, verify: boolean) {
  const context = verify ? 'Verification stopped. No model calls were made.' : 'Benchmark stopped.';
  if (error instanceof RepositoryError) {
    const advice =
      error.code === 'RATE_LIMIT_OR_FORBIDDEN'
        ? 'GitHub returned 403/429: rate limit or access denial. Wait for the limit to reset, or configure a server-side GITHUB_TOKEN with read access to these public repositories. Repeated retries can consume more allowance.'
        : `GitHub error: ${error.code}. Check repository access and the configured GITHUB_TOKEN.`;
    return `${context} ${advice}`;
  }
  return `${context} Check arguments${verify ? ' and GitHub access' : ', provider credentials, GitHub access, and persistent budget'}.`;
}
export function parseArguments(args: string[]) {
  let mode: 'list' | 'verify' | 'live' = 'list';
  let explicitMode = false;
  let caseId: string | undefined;
  let all = false;
  let maxUsd = 0.1;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--list', '--verify', '--live'].includes(arg!)) {
      if (explicitMode) throw new Error('Choose one mode');
      explicitMode = true;
      mode = arg!.slice(2) as 'list' | 'verify' | 'live';
    } else if (arg === '--case') {
      caseId = args[++i];
      if (!caseId) throw new Error('Missing case');
    } else if (arg === '--all') all = true;
    else if (arg === '--max-usd') maxUsd = Number(args[++i]);
    else throw new Error('Unknown argument');
  }
  if (caseId && all) throw new Error('Choose --case or --all');
  if (mode === 'live' && !caseId && !all) throw new Error('Live runs require --case ID or --all');
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 1)
    throw new Error('--max-usd must be > 0 and <= 1');
  return { mode, caseId, maxUsd };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const cases = readManifest().cases.filter((c) => !options.caseId || options.caseId === c.id);
  if (!cases.length) throw new Error('Unknown case');
  if (options.mode === 'list') {
    console.log(JSON.stringify(cases, null, 2));
    return;
  }
  config({ path: `${root}.env.local`, quiet: true });
  const provider = options.mode === 'live' ? providerConfig() : OPENAI;
  const key = options.mode === 'live' ? process.env[provider.keyVariable] : undefined;
  if (options.mode === 'live' && !key) throw new Error('Selected provider key is missing');
  const directory = `${root}data/benchmarks/results/`;
  mkdirSync(directory, { recursive: true });
  const runId = randomUUID();
  const verified: { id: string; commitSha: string; issueNumber: number; issueHash: string }[] = [];
  const verificationPath = `${directory}${runId}.verify.json`;
  const saveVerification = () =>
    writeFileSync(
      verificationPath,
      JSON.stringify(
        {
          mode: 'verify',
          planned: cases.length,
          verified: verified.length,
          modelCalls: 0,
          results: verified,
        },
        null,
        2,
      ),
    );
  if (options.mode === 'verify') {
    saveVerification();
    console.log(`Verification progress: ${verificationPath}`);
  }
  const verifyRepository = verificationRepositories((repository, commitSha) =>
    OctokitProvider.connect(repository, { token: process.env.GITHUB_TOKEN, commitSha }),
  );
  const results: {
    caseId: string;
    issueUrl: string;
    issueHash: string;
    issue: unknown;
    validationDiagnostics: Record<string, unknown>[];
    run: Investigation;
  }[] = [];
  const save = () =>
    writeFileSync(
      `${directory}${runId}.json`,
      JSON.stringify(
        {
          runId,
          mode: 'live-github',
          generatedAt: new Date().toISOString(),
          model: provider.model,
          limits: DEFAULT_LIMITS,
          planned: cases.map((c) => c.id),
          completed: results.filter((r) => r.run.status === 'completed').length,
          estimatedCostUsd: results.reduce((sum, r) => sum + r.run.usage.estimatedCostUsd, 0),
          accuracy: null,
          note: 'Real model runs against pinned GitHub source. Accuracy requires independent private-answer review.',
          results,
        },
        null,
        2,
      ),
    );
  for (const test of cases) {
    // Reuse connections only in read-only verification. Live cases retain isolated
    // repository request budgets and caches for fair model comparisons.
    const repository =
      options.mode === 'verify'
        ? await verifyRepository(test.repository, test.commitSha)
        : await OctokitProvider.connect(test.repository, {
            token: process.env.GITHUB_TOKEN,
            commitSha: test.commitSha,
          });
    // Snapshot the reported symptoms; reuse that snapshot for every get_issue tool call.
    const issue = await repository.getIssue(test.issueNumber);
    const issueHash = createHash('sha256')
      .update(JSON.stringify({ title: issue.title, body: issue.body, comments: issue.comments }))
      .digest('hex');
    if (options.mode === 'verify') {
      const result = {
        id: test.id,
        commitSha: repository.revision.commitSha,
        issueNumber: issue.number,
        issueHash,
      };
      verified.push(result);
      saveVerification();
      console.log(JSON.stringify(result));
      continue;
    }
    const original = repository.getIssue.bind(repository);
    repository.getIssue = (number) =>
      number === test.issueNumber ? Promise.resolve(issue) : original(number);
    const service = new InvestigationService(
      new InvestigationStore(`${directory}live-budget.sqlite`),
      async () => repository,
      () => liveModel(key!, provider),
      {},
      options.maxUsd,
      provider,
    );
    try {
      const id = service.start({
        repository: test.repository,
        issueNumber: test.issueNumber,
        question: `Investigate GitHub issue #${test.issueNumber}. Find the relevant code, explain the likely root cause, and recommend a fix with source evidence.`,
      }).id;
      let run: Investigation;
      do {
        await new Promise((resolve) => setTimeout(resolve, 100));
        run = service.store.get(id)!;
      } while (['queued', 'running'].includes(run.status));
      const validationDiagnostics = service.store
        .events(id)
        .filter((event) => event.type === 'validation_failed')
        .map((event) => event.data);
      results.push({
        caseId: test.id,
        issueUrl: test.issueUrl,
        issueHash,
        issue,
        validationDiagnostics,
        run,
      });
      save();
      console.log(
        JSON.stringify({
          caseId: test.id,
          status: run.status,
          errorCode: run.errorCode,
          validationDiagnostics,
          usage: run.usage,
          durationMs: run.durationMs,
        }),
      );
      // Never silently retry failures or continue spending after a failed case.
      if (run.status !== 'completed') {
        process.exitCode = 1;
        break;
      }
    } finally {
      service.close();
    }
  }
  if (options.mode === 'live') {
    save();
    console.log(`Results: ${directory}${runId}.json`);
  } else
    console.log(`Verified ${verified.length}/${cases.length} cases. No model calls were made.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(benchmarkError(error, process.argv.includes('--verify')));
    process.exitCode = 1;
  });
}
