// @vitest-environment jsdom
/** Checks line-linked code explanations, expandable excerpts and backward-compatible saved reports. */
import { type Briefing, briefingSchema } from '@reposleuth/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { BriefingReport } from '../../src/features/onboarding/BriefingReport';
import { CodeWalkthrough } from '../../src/features/onboarding/CodeWalkthrough';

afterEach(cleanup);

it('labels a failed requested overview instead of implying that source facts are the summary', () => {
  render(
    <BriefingReport
      report={{ ...report(), includeOverview: true, summaryError: 'The overview was rejected.' }}
    />,
  );
  expect(screen.getByRole('heading', { name: 'AI overview unavailable' })).toBeTruthy();
  expect(screen.getByText(/These details are not a generated summary/)).toBeTruthy();
  expect(screen.queryByText(/Generate with an enabled model/)).toBeNull();
});

it('keeps the accepted overview visible and separates walkthrough rejection details', () => {
  const saved = briefingSchema.parse({
    ...report(),
    codeSources: [],
    summary: {
      sections: ['Purpose', 'Setup'].map((title) => ({
        title,
        text: 'Accepted overview text.',
        sources: ['README.md'],
      })),
      uncertainties: [],
    },
    walkthroughError: 'The optional walkthrough was rejected (INVALID_CODE_CITATION).',
    summaryDiagnostics: {
      stage: 'walkthrough-citations',
      code: 'INVALID_CODE_CITATION',
      issues: [{ path: 'steps.1.sources.0', code: 'range_outside_excerpt' }],
      responseChars: 100,
      responseSha256: 'a'.repeat(64),
    },
  });
  render(<BriefingReport report={saved} />);
  expect(screen.getAllByText('Accepted overview text.')).toHaveLength(2);
  expect(screen.getByRole('status').textContent).toContain('walkthrough was rejected');
  expect(screen.getByText('Explanation validation details')).toBeTruthy();
  expect(screen.getByText('steps.1.sources.0: range_outside_excerpt')).toBeTruthy();
  expect(screen.queryByText(/source-facts view/)).toBeNull();
});
function report(): Briefing {
  return briefingSchema.parse({
    id: 'test',
    repository: 'owner/repo',
    commitSha: 'a'.repeat(40),
    createdAt: '',
    scope: '',
    status: 'completed',
    durationMs: 0,
    filesDiscovered: 0,
    filesRead: 0,
    languages: [],
    directories: [],
    packages: [],
    documents: [],
    manifests: [],
    readingOrder: [],
    testFiles: [],
    limitations: [],
  });
}
it('keeps older reports readable without manufacturing new source evidence', () => {
  const { container } = render(<CodeWalkthrough report={report()} />);
  expect(container.innerHTML).toBe('');
});
it('shows an honest no-flow state and safely renders numbered source text', () => {
  render(
    <CodeWalkthrough
      report={{
        ...report(),
        codeSources: [
          {
            path: 'main.ts',
            startLine: 1,
            endLine: 1,
            text: '<script>unsafe</script>',
            complete: true,
            reason: 'Entry candidate',
          },
        ],
        codeCoverage: ['Unresolved import.'],
      }}
    />,
  );
  expect(screen.getByText(/No supported code-flow explanation/)).toBeTruthy();
  expect(document.querySelector('pre')?.textContent).toBe('1  <script>unsafe</script>');
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText('Open pinned source ↗').getAttribute('href')).toContain('/main.ts#L1-L1');
});

it.each([true, false])('renders concrete and legacy examples (concrete: %s)', (concrete) => {
  const saved = briefingSchema.parse({
    ...report(),
    codeSources: [],
    summary: {
      sections: ['Purpose', 'Setup'].map((title) => ({
        title,
        text: 'Example',
        sources: ['README.md'],
      })),
      uncertainties: [],
      codeWalkthrough: {
        title: 'Select a customer',
        overview: 'Read a component interaction.',
        ...(concrete ? { trigger: 'Choose a customer.', result: 'The name is displayed.' } : {}),
        steps: ['main.tsx', 'Customer.tsx'].map((path) => ({
          title: path,
          explanation: 'Source explanation.',
          readingTip: 'Inspect the handler.',
          sources: [{ path, startLine: 2, endLine: 4 }],
        })),
        limitations: ['Static source only.'],
      },
    },
  });
  render(<CodeWalkthrough report={saved} />);
  expect(screen.getByText('Select a customer')).toBeTruthy();
  expect(screen.queryByText('Starts with:') !== null).toBe(concrete);
  expect(screen.queryByText('Leads to:') !== null).toBe(concrete);
  expect(screen.getByText('Customer.tsx:2–4 ↗').getAttribute('href')).toContain(
    '/Customer.tsx#L2-L4',
  );
});
