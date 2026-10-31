/** Runs answer-blind reference/guided pairs; offline by default, live calls share the approved durable ledger. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

import { DEFAULT_LIMITS, emptyUsage, StopError } from '../../src/agents/budget.js';
import { investigateGuided } from '../../src/agents/guided.js';
import type { InvestigationOptions } from '../../src/agents/investigator.js';
import { liveModel } from '../../src/agents/models/createModel.js';
import type { ProviderConfig } from '../../src/agents/provider.js';
import { InvestigationStore } from '../../src/storage/sqlite.js';
import { reliabilityCases } from '../reliability/cases.js';
import { explorationAdmitted } from './admission.js';
import { corpusRepository } from './corpus.js';
import { investigateReference } from './investigate.js';
import { retrieveReference } from './retrieve.js';

const live = process.argv.includes('--live');
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);
if (!output)
  throw new Error('Pass --output=<new result directory>. Default is offline retrieval only.');
const directory = resolve(output);
if (existsSync(directory))
  throw new Error('Output directory already exists; refusing to overwrite or retry attempts.');
const ledger = resolve('data/reliability-comparison-2026-10-28/budget.sqlite');
if (live && !existsSync(ledger)) throw new Error('Approved campaign ledger missing.');
config({ path: '.env.local', quiet: true });
const provider: ProviderConfig = {
  provider: 'openai',
  model: 'gpt-5.4-mini',
  keyVariable: 'OPENAI_API_KEY',
  rates: { input: 0.75 / 1_000_000, output: 4.5 / 1_000_000 },
};
const key = process.env.OPENAI_API_KEY;
if (live && !key) throw new Error('Existing OpenAI credential unavailable.');
if (live) {
  for (const test of reliabilityCases) {
    if (!(await explorationAdmitted(test.question, provider, 0.025)))
      throw new Error(
        'Frozen allowance cannot admit guided exploration. Comparison not launched; revise the protocol before spending.',
      );
  }
}
const store = live ? new InvestigationStore(ledger) : undefined;
const prior = store?.reserved() ?? 0;
const totalCeiling = Math.min(5, prior + 0.2);
if (live && prior + 0.2 > 5) {
  store?.close();
  throw new Error('Insufficient remaining campaign allowance for the frozen plan.');
}
mkdirSync(directory, { recursive: true });
writeFileSync(
  resolve(directory, 'protocol.json'),
  JSON.stringify(
    {
      live,
      provider,
      prior,
      totalCeiling,
      perAttemptReservationUsd: 0.025,
      limits: DEFAULT_LIMITS,
      cases: reliabilityCases.map((c) => c.id),
      retries: 0,
      paidGrading: false,
      dependencyHash: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
    },
    null,
    2,
  ),
);
try {
  for (const [index, test] of reliabilityCases.entries()) {
    const repository = corpusRepository(test.id, test.files);
    if (!live) {
      const retrieval = await retrieveReference(
        repository,
        test.question,
        () => {},
        DEFAULT_LIMITS.tools,
      );
      writeFileSync(
        resolve(directory, `${test.id}.json`),
        JSON.stringify({ id: test.id, retrieval, qualityAssessed: false }, null, 2),
      );
      continue;
    }
    // Alternate order; both workflows see identical question/source and spending ceilings.
    for (const workflow of index % 2 ? ['guided', 'reference'] : ['reference', 'guided']) {
      const resultPath = resolve(directory, `${test.id}-${workflow}.json`);
      const usage = emptyUsage();
      const events: { type: string; data: Record<string, unknown> }[] = [];
      const started = Date.now();
      const deadline = started + DEFAULT_LIMITS.timeoutMs;
      const ceiling = Math.min(totalCeiling, store!.reserved() + 0.025);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('TIMEOUT'), DEFAULT_LIMITS.timeoutMs);
      const base = {
        id: test.id,
        workflow,
        question: test.question,
        revision: repository.revision,
        provider,
        limits: DEFAULT_LIMITS,
        ceiling,
        usage,
        events,
      };
      const save = (extra: Record<string, unknown>) =>
        writeFileSync(
          resultPath,
          JSON.stringify(
            {
              ...base,
              ...extra,
              campaignReservedUsd: store!.reserved(),
              durationMs: Date.now() - started,
            },
            null,
            2,
          ),
        );
      save({ status: 'started' });
      const options: InvestigationOptions = {
        repository,
        request: {
          repository: repository.revision.repository,
          question: test.question,
          mode: 'standard',
        },
        limits: DEFAULT_LIMITS,
        usage,
        deadline,
        signal: controller.signal,
        provider,
        model: liveModel(key!, provider),
        reserve: (usd) => store!.reserve(usd, ceiling),
        remainingBudget: () => ceiling - store!.reserved(),
        saveUsage: () => save({ status: 'started' }),
        emit: (type, data) => {
          events.push({ type, data });
          save({ status: 'started' });
        },
      };
      try {
        const result =
          workflow === 'reference'
            ? await investigateReference(options)
            : { report: await investigateGuided(options) };
        save({ status: 'completed', ...result });
        console.log(JSON.stringify({ id: test.id, workflow, status: 'completed', usage }));
      } catch (error) {
        const code = error instanceof StopError ? error.code : 'UNCLASSIFIED_FAILURE';
        save({ status: 'failed', code });
        console.log(JSON.stringify({ id: test.id, workflow, status: 'failed', code, usage }));
        if (/AUTHENTICATION|QUOTA|ACCESS|RATE_LIMIT/.test(code))
          throw new Error('Provider access stopped the comparison; no retry.', { cause: error });
      } finally {
        clearTimeout(timer);
      }
    }
  }
} finally {
  store?.close();
}
console.log(`Results saved to ${directory}`);
