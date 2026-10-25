/** Verifies benchmark arguments, manifest validation, and repository verification behavior. */
import { expect, it, vi } from 'vitest';

import {
  benchmarkError,
  manifestSchema,
  parseArguments,
  readManifest,
  verificationRepositories,
} from '../../../evaluation/benchmarks/runner.js';
import { RepositoryError } from '../../../src/github/RepositoryProvider.js';
import { fakeRepository } from '../../fixtures/agentFixtures.js';
it('reuses each repository revision once for verification without mixing revisions', async () => {
  const connect = vi.fn(async () => fakeRepository());
  const load = verificationRepositories(connect);
  for (const test of readManifest().cases) await load(test.repository, test.commitSha);
  expect(connect).toHaveBeenCalledTimes(3);
  await load(readManifest().cases[0]!.repository, 'b'.repeat(40));
  expect(connect).toHaveBeenCalledTimes(4);
});
it('explains GitHub denial without blaming model keys or revealing upstream details', () => {
  const message = benchmarkError(
    new RepositoryError('RATE_LIMIT_OR_FORBIDDEN', 'secret upstream body'),
    true,
  );
  expect(message).toContain('GITHUB_TOKEN');
  expect(message).toContain('No model calls');
  expect(message).not.toContain('provider credentials');
  expect(message).not.toContain('secret upstream body');
});
it('lists without API calls and requires explicit bounded live selection', () => {
  expect(parseArguments([]).mode).toBe('list');
  expect(() => parseArguments(['--live'])).toThrow();
  expect(() => parseArguments(['--live', '--all', '--max-usd', '5'])).toThrow();
  expect(() => parseArguments(['--live', '--case', 'case-01', '--all'])).toThrow();
  expect(parseArguments(['--live', '--case', 'case-01', '--max-usd', '0.05'])).toMatchObject({
    mode: 'live',
    caseId: 'case-01',
    maxUsd: 0.05,
  });
});
it('has 15 unique issue references at three pinned revisions, with no answer fields', () => {
  const manifest = readManifest();
  expect(manifest.cases).toHaveLength(15);
  expect(new Set(manifest.cases.map((c) => c.repository)).size).toBe(3);
  expect(new Set(manifest.cases.map((c) => c.commitSha)).size).toBe(3);
  expect(new Set(manifest.cases.map((c) => c.issueUrl)).size).toBe(15);
  expect(
    manifestSchema.safeParse({ ...manifest, cases: [{ ...manifest.cases[0], answer: 'leaked' }] })
      .success,
  ).toBe(false);
});
