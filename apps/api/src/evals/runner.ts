import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { Investigation } from '@reposleuth/shared';
import { cases, type EvalCase } from './cases.js';
import { fixtureRepository, ReplayModel } from './fixtures.js';
import { InvestigationService } from '../services/investigationService.js';
import { InvestigationStore } from '../storage/sqlite.js';
import { liveModel } from '../agents/investigator.js';
import { validateEvidence } from '../services/evidenceValidator.js';

export async function runCase(test: EvalCase, options: { key?: string; budgetUsd?: number; ledgerPath?: string } = {}) {
  const repository = fixtureRepository(test);
  const store = new InvestigationStore(options.ledgerPath ?? ':memory:');
  const service = new InvestigationService(store, async () => repository,
    () => options.key ? liveModel(options.key) : new ReplayModel(test),
    { costUsd: 0.02, timeoutMs: 60000 }, options.budgetUsd ?? 1);
  const started = performance.now();
  try {
    const id = service.start({ repository: repository.revision.repository, issueNumber: 1, question: test.question }).id;
    let run: Investigation;
    do { await new Promise(resolve => setTimeout(resolve, 5)); run = store.get(id)!; } while (['queued', 'running'].includes(run.status));
    const evidence = await repository.readFile(test.path, 1, 200);
    let citationsValid = false;
    if (run.report?.evidence.length) {
      try { validateEvidence(run.report, repository.revision, [evidence]); citationsValid = true; } catch { /* Recorded as a failed evaluation. */ }
    }
    const tools = store.events(id).filter(event => event.type === 'tool_started').map(event => String(event.data.name));
    const allowed = ['get_issue', 'list_files', 'search_code', 'read_file', 'get_commits', 'get_file_diff'];
    return { caseId: test.id, category: test.category, durationMs: Math.round(performance.now() - started),
      status: run.status, errorCode: run.errorCode, usage: run.usage, citationsValid,
      forbiddenToolCalls: tools.filter(name => !allowed.includes(name)), tools, report: run.report,
      rubric: { rootCause: test.rootCause, supportingFile: test.path, supportingLines: [1, test.source.split('\n').length], fix: test.fix, verification: test.verification } };
  } finally { service.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const caseIndex = args.indexOf('--case');
  const selected = caseIndex >= 0 ? cases.filter(test => test.id === args[caseIndex + 1]) : cases;
  if (!selected.length) throw new Error('Unknown case. See apps/api/src/evals/cases.ts.');
  if (live && caseIndex < 0 && !args.includes('--all')) throw new Error('Live evaluation requires --case ID or --all.');
  const budgetIndex = args.indexOf('--max-usd');
  const budgetUsd = budgetIndex >= 0 ? Number(args[budgetIndex + 1]) : 0.1;
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 1) throw new Error('--max-usd must be > 0 and <= 1.');
  if (live) config({ path: fileURLToPath(new URL('../../../../.env.local', import.meta.url)), quiet: true });
  const key = live ? process.env.OPENAI_API_KEY : undefined;
  if (live && !key) throw new Error('Live evaluation requires the existing server OPENAI_API_KEY.');
  const directory = fileURLToPath(new URL('../../../../data/evals/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  const runId = randomUUID();
  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  let blocked: string | null = null;
  for (const test of selected) {
    try {
      const result = await runCase(test, { key, budgetUsd, ledgerPath: live ? `${directory}live-budget.sqlite` : undefined });
      results.push(result);
      if (live && ['OPENAI_QUOTA', 'OPENAI_AUTHENTICATION', 'OPENAI_ACCESS', 'BUDGET_EXCEEDED'].includes(result.errorCode ?? '')) { blocked = result.errorCode; break; }
    } catch { blocked = 'EVALUATION_STOPPED_OR_LEDGER_BUDGET_EXCEEDED'; break; }
  }
  const completed = results.filter(result => result.status === 'completed');
  const durations = results.map(result => result.durationMs).sort((a, b) => a - b);
  const summary = { runId, mode: live ? 'live-model' : 'scripted-replay', generatedAt: new Date().toISOString(),
    planned: selected.length, attempted: results.length, completed: completed.length, blocked,
    completionRate: completed.length / selected.length,
    citationValidityRate: completed.length ? completed.filter(result => result.citationsValid).length / completed.length : null,
    rootCauseAccuracy: null, accuracyNote: 'Requires independent human review of live-model reports against the rubric; replay is not a reasoning benchmark.',
    forbiddenToolCalls: results.reduce((sum, result) => sum + result.forbiddenToolCalls.length, 0),
    totalDurationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    p95DurationMs: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : null,
    estimatedCostUsd: live ? results.reduce((sum, result) => sum + result.usage.estimatedCostUsd, 0) : 0,
    usageNote: live ? 'Reported usage and estimates; reservations persist and are not invoice amounts.' : 'Tokens and per-case costs are synthetic SDK test values. No network calls or charges.', results };
  writeFileSync(`${directory}${runId}.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${directory}latest.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
  if (summary.completionRate < 0.95 || summary.citationValidityRate !== 1 || summary.forbiddenToolCalls > 0) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch(() => { console.error('Evaluation could not start. Check arguments, local credentials for --live, and the data directory. No automatic retry was made.'); process.exitCode = 1; });
}
