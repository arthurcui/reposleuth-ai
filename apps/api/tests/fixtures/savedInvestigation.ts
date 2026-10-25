/** Creates saved investigation records for history, migration, and export tests. */
import type { Investigation } from '@reposleuth/shared';
import { validReport, SHA } from './agentFixtures.js';

export function savedInvestigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    id: 'saved-run',
    request: { repository: 'owner/repo', question: 'Why is the endpoint slow?', issueNumber: 42 },
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    commitSha: SHA,
    report: validReport(),
    errorCode: null,
    model: 'test-model',
    usage: {
      requests: 2,
      inputTokens: 200,
      outputTokens: 100,
      estimatedCostUsd: 0.001,
      reservedCostUsd: 0,
      usageIncomplete: false,
    },
    ...overrides,
  };
}
