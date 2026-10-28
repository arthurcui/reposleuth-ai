// @vitest-environment jsdom
/** Verifies actionable stop diagnostics, pinned source links, and separation of reads from accepted findings. */
import type { Investigation, InvestigationEvent } from '@reposleuth/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { demo } from '../../src/features/demo/demo';
import { InvestigationDiagnostics } from '../../src/features/investigations/InvestigationDiagnostics';

afterEach(cleanup);
const run: Investigation = {
  ...demo,
  id: 'saved-run',
  request: { repository: 'https://github.com/owner/repo', question: 'Investigate a failure' },
  status: 'budget_exceeded',
  errorCode: 'BUDGET_EXCEEDED_TOKENS',
  report: null,
  limits: {
    turns: 12,
    tools: 24,
    tokens: 100000,
    outputTokens: 2000,
    timeoutMs: 120000,
    costUsd: 0.05,
  },
};
const event = (
  id: number,
  type: string,
  data: Record<string, unknown> = {},
): InvestigationEvent => ({ id, type, data, investigationId: run.id, at: demo.createdAt });
const read = event(2, 'source_read', {
  path: 'src/customers.ts',
  startLine: 1,
  endLine: 3,
  commitSha: run.commitSha,
});

it('shows the exact limit, last unfinished tool and deduplicated pinned source reads', () => {
  render(
    <InvestigationDiagnostics
      run={run}
      events={[
        read,
        { ...read, id: 3 },
        event(4, 'tool_started', { name: 'search_code' }),
        event(5, 'terminal'),
      ]}
    />,
  );
  expect(screen.getByText(/100,000 total tokens/)).toBeTruthy();
  expect(screen.getByText(/Search source code · started; completion not recorded/)).toBeTruthy();
  expect(screen.getByText('Recorded source reads (1)')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'src/customers.ts:1-3', hidden: true }).getAttribute('href'),
  ).toBe(`https://github.com/owner/repo/blob/${run.commitSha}/src/customers.ts#L1-L3`);
  expect(screen.getByText(/No validated report or findings are available/)).toBeTruthy();
});

it('shows a safe rejection reason without presenting rejected content as findings', () => {
  render(
    <InvestigationDiagnostics
      run={{ ...run, status: 'failed', errorCode: 'INVALID_EVIDENCE' }}
      events={[
        read,
        event(3, 'validation_failed', {
          reason: 'UNKNOWN_EVIDENCE_ID',
          rejectedText: 'untrusted secret draft',
        }),
      ]}
    />,
  );
  expect(screen.getByText(/referenced an unknown evidence ID/)).toBeTruthy();
  expect(screen.queryByText(/untrusted secret draft/)).toBeNull();
  expect(screen.getByText(/Validate report and citations/)).toBeTruthy();
});

it('labels an accepted partial report and retains its findings without claiming tests ran', () => {
  render(
    <InvestigationDiagnostics
      run={{ ...run, status: 'completed', errorCode: null, report: demo.report }}
      events={[
        read,
        event(4, 'reporting', { reason: 'LIFETIME_COST_RESERVE' }),
        event(5, 'validating'),
      ]}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Partial investigation' })).toBeTruthy();
  expect(screen.getByText(/persistent spending allowance was reserved/)).toBeTruthy();
  expect(screen.getByText(/available in the accepted report/)).toBeTruthy();
  expect(screen.getByText(/proposed fixes have not been tested/)).toBeTruthy();
});

it('does not invent history or leak source records from another run or revision', () => {
  render(
    <InvestigationDiagnostics
      run={{ ...run, limits: undefined, status: 'failed', errorCode: 'OPENAI_QUOTA' }}
      events={[
        { ...read, investigationId: 'other' },
        { ...read, data: { ...read.data, commitSha: 'b'.repeat(40) } },
      ]}
    />,
  );
  expect(screen.getByText(/OpenAI API credits are exhausted/)).toBeTruthy();
  expect(screen.getByText(/No source-read details are available/)).toBeTruthy();
  expect(screen.queryByText(/Configured limit/)).toBeNull();
  expect(screen.queryByRole('link', { hidden: true })).toBeNull();
});

it.each(['running', 'completed'] as const)('keeps ordinary %s runs uncluttered', (status) => {
  const { container } = render(
    <InvestigationDiagnostics run={{ ...run, status, errorCode: null }} events={[]} />,
  );
  expect(container.innerHTML).toBe('');
});
