/** Reviews existing benchmark results without launching investigations; AI judging is explicitly opt-in. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { z } from 'zod';

import { liveModel } from '../../src/agents/models/createModel.js';
import { providerConfig } from '../../src/agents/provider.js';
import { InvestigationStore } from '../../src/storage/sqlite.js';
import {
  answerSchema,
  gradeAttempt,
  GRADER_VERSION,
  type SavedRun,
  savedRunSchema,
} from './grading.js';
import { createJudge } from './judge.js';
import { readManifest } from './runner.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
function readJson(path: string): unknown {
  if (statSync(path).size > 8_000_000) throw new Error('INPUT_TOO_LARGE');
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
export function gradingArguments(args: string[]) {
  let judge = false;
  let maxUsd: number | undefined;
  let input: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--judge' && !judge) judge = true;
    else if (args[i] === '--max-usd' && maxUsd === undefined) maxUsd = Number(args[++i]);
    else if (args[i] === '--input' && !input) {
      input = args[++i];
      if (!input) throw new Error('Missing input');
    } else throw new Error('Unknown or duplicate option');
  }
  if (
    judge !== (maxUsd !== undefined) ||
    (maxUsd !== undefined && (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 1))
  )
    throw new Error('--judge requires explicit --max-usd > 0 and <= 1');
  return { judge, maxUsd, input };
}
export function pinnedSource(repository: string, commit: string, path: string) {
  if (
    !/^arthurcui\/reposleuth-bench-[a-z-]+$/.test(repository) ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    !/^[a-zA-Z0-9_./-]+$/.test(path) ||
    path.startsWith('/') ||
    path.split('/').includes('..')
  )
    throw new Error('Invalid source locator');
  return execFileSync(
    'git',
    [
      '--no-replace-objects',
      '-C',
      resolve(root, 'data/benchmarks/repos', repository.split('/')[1]!),
      'show',
      `${commit}:${path}`,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 500000,
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}
async function main() {
  const options = gradingArguments(process.argv.slice(2));
  const manifest = readManifest();
  const answers = z
    .array(answerSchema)
    .parse(readJson(resolve(root, 'data/benchmarks/private/cases.json')));
  if (new Set(answers.map((a) => a.id)).size !== answers.length)
    throw new Error('Duplicate answers');
  for (const a of answers) {
    const c = manifest.cases.find((c) => c.id === a.id);
    if (
      !c ||
      c.repository !== a.repository ||
      c.issueNumber !== a.issueNumber ||
      c.commitSha !== a.commitSha
    )
      throw new Error('Answer manifest mismatch');
  }
  const runs = new Map<string, SavedRun>();
  const sources = new Map<string, string[]>();
  const examined = new Map<string, string[]>();
  const add = (value: unknown, path: string, events?: unknown) => {
    const run = savedRunSchema.parse(value);
    if (!manifest.cases.some((c) => c.repository === run.request.repository)) return;
    const previous = runs.get(run.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(run))
      throw new Error('Conflicting snapshots for run ID');
    runs.set(run.id, run);
    sources.set(run.id, [...(sources.get(run.id) ?? []), path]);
    const parsed = z
      .array(z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) }))
      .safeParse(events);
    if (parsed.success) {
      const paths = parsed.data
        .filter((event) => event.type === 'source_read' && event.data.commitSha === run.commitSha)
        .flatMap((event) => (typeof event.data.path === 'string' ? [event.data.path] : []));
      if (paths.length)
        examined.set(run.id, [...new Set([...(examined.get(run.id) ?? []), ...paths])]);
    }
  };
  const readResult = (path: string) => {
    const data = z
      .object({
        mode: z.string(),
        results: z.array(z.object({ run: z.unknown(), events: z.unknown().optional() })).optional(),
      })
      .parse(readJson(path));
    if (data.mode === 'live-github')
      for (const row of data.results ?? []) add(row.run, path, row.events);
  };
  if (options.input) readResult(resolve(options.input));
  else {
    const dir = resolve(root, 'data/benchmarks/results');
    if (existsSync(dir))
      for (const name of readdirSync(dir).filter(
        (name) => name.endsWith('.json') && !name.endsWith('.verify.json'),
      ))
        readResult(resolve(dir, name));
    const path = resolve(root, 'data/investigations.sqlite');
    if (existsSync(path)) {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        for (const row of db.prepare('SELECT id,body FROM investigations').all()) {
          const events = db
            .prepare('SELECT type,data FROM events WHERE investigation_id=? ORDER BY id')
            .all(String(row.id))
            .map((event) => ({
              type: String(event.type),
              data: JSON.parse(String(event.data)) as unknown,
            }));
          add(JSON.parse(String(row.body)) as unknown, path, events);
        }
      } finally {
        db.close();
      }
    }
  }
  if (!runs.size || runs.size > 200) throw new Error('Expected 1 to 200 saved benchmark attempts');
  const directory = resolve(root, 'data/benchmarks/reviews', `automated-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  let ledger: InvestigationStore | undefined;
  let evaluator: ReturnType<typeof createJudge> | undefined;
  let judgeModel: string | null = null;
  const results: Awaited<ReturnType<typeof gradeAttempt>>[] = [];
  const checkpoint = () => {
    const body = {
      graderVersion: GRADER_VERSION,
      generatedAt: new Date().toISOString(),
      mode: options.judge ? 'ai-assisted' : 'offline-mechanical',
      judgeModel,
      answerHash: createHash('sha256').update(JSON.stringify(answers)).digest('hex'),
      note: 'Citation checks are mechanical. Semantic scores are AI judgments, not ground truth. Missing judgments remain unscored. No investigation is launched.',
      plannedRunIds: [...runs.keys()],
      sources: Object.fromEntries(sources),
      coverage: manifest.cases.map((c) => ({
        caseId: c.id,
        attempts: [...runs.values()].filter(
          (r) => r.request.repository === c.repository && r.request.issueNumber === c.issueNumber,
        ).length,
      })),
      judgeUsage: evaluator?.usage ?? null,
      results,
    };
    writeFileSync(resolve(directory, 'grades.json'), JSON.stringify(body, null, 2));
    const csv = (v: unknown) => {
      const raw = String(v ?? '');
      const safe = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const fields = [
      'caseId',
      'runId',
      'model',
      'mode',
      'status',
      'citations',
      'depthStatus',
      'investigationCostUsd',
      'durationMs',
      'error',
      'flags',
    ] as const;
    const scores = ['rootCause', 'evidenceRelevance', 'fix', 'uncertainty'] as const;
    writeFileSync(
      resolve(directory, 'scorecard.csv'),
      [
        [...fields, ...scores, 'rationale'].join(','),
        ...results.map((r) =>
          [
            ...fields.map((k) => csv(Array.isArray(r[k]) ? JSON.stringify(r[k]) : r[k])),
            ...scores.map((k) =>
              csv(['pass', 'fail'].includes(r.status) ? r.judgments[0]?.[k] : ''),
            ),
            csv(r.judgments.map((j) => j.rationale).join(' | ')),
          ].join(','),
        ),
      ].join('\n'),
    );
  };
  try {
    if (options.judge) {
      config({ path: resolve(root, '.env.local'), quiet: true });
      const provider = providerConfig();
      const key = process.env[provider.keyVariable];
      if (!key) throw new Error('Judge credentials unavailable');
      judgeModel = provider.model;
      ledger = new InvestigationStore(resolve(root, 'data/benchmarks/reviews/judge-budget.sqlite'));
      const budget = ledger;
      evaluator = createJudge(liveModel(key, provider), provider, options.maxUsd!, (usd) =>
        budget.reserve(usd, options.maxUsd!),
      );
    }
    checkpoint();
    for (const run of runs.values()) {
      const answer = answers.find(
        (a) => a.repository === run.request.repository && a.issueNumber === run.request.issueNumber,
      );
      if (!answer) throw new Error('No matching private answer');
      results.push(
        await gradeAttempt(run, answer, pinnedSource, evaluator?.judge, examined.get(run.id)),
      );
      checkpoint();
      if (results.at(-1)?.error === 'JUDGE_FAILED_OR_BUDGET_STOPPED') {
        process.exitCode = 1;
        break;
      }
    }
    console.log(
      JSON.stringify(
        {
          output: directory,
          attempts: runs.size,
          graded: results.length,
          statuses: results.map((r) => ({ runId: r.runId, status: r.status, flags: r.flags })),
          judgeUsage: evaluator?.usage ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    ledger?.close();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    console.error(
      'Grading stopped. Check saved inputs, private answer manifest, local pinned repositories, and explicit judge budget/credentials. No investigation was launched.',
    );
    process.exitCode = 1;
  });
}
