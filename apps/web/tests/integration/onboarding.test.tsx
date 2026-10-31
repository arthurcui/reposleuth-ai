// @vitest-environment jsdom
/** Checks default routing, reopening without submission, package focus and safe documentation rendering. */
import { type Briefing } from '@reposleuth/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { App } from '../../src/App';
vi.mock('../../src/features/investigations/ModelPicker', () => ({ ModelPicker: () => null }));

const report: Briefing = {
  id: 'brief-1',
  repository: 'owner/repo',
  scope: '',
  commitSha: 'a'.repeat(40),
  createdAt: '2026-10-30T12:00:00Z',
  durationMs: 100,
  status: 'completed',
  filesDiscovered: 2,
  filesRead: 1,
  languages: [{ name: 'TypeScript', files: 1 }],
  directories: [{ path: 'src', files: 1 }],
  packages: ['packages/web'],
  documents: [
    {
      path: 'README.md',
      startLine: 1,
      endLine: 1,
      complete: true,
      text: '<script>unsafe()</script>',
    },
  ],
  manifests: [],
  readingOrder: [],
  testFiles: [],
  limitations: ['No code execution.'],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});
it('keeps history closed and pages five briefings without a long scrolling column', async () => {
  history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(Array.from({ length: 7 }, (_, i) => ({ ...report, id: `brief-${i}` }))),
    ),
  );
  render(<App />);
  expect(screen.queryByText('Saved briefings')).toBeNull();
  fireEvent.click(screen.getByText('Briefing history'));
  await waitFor(() => expect(screen.getAllByText('Open briefing')).toHaveLength(5));
  fireEvent.click(screen.getByText('Next →'));
  expect(screen.getAllByText('Open briefing')).toHaveLength(2);
  fireEvent.click(screen.getByText('Close history'));
  expect(screen.queryByText('Saved briefings')).toBeNull();
});
it('opens onboarding by default and creates only on explicit submission', async () => {
  history.replaceState(null, '', '/');
  const fetch = vi.fn(async (path: string, options?: RequestInit) =>
    Response.json(options?.method === 'POST' ? report : path.includes('?q=') ? [] : report),
  );
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  await screen.findByText('Create an onboarding briefing');
  expect(fetch.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  fireEvent.change(screen.getByLabelText('Public GitHub repository'), {
    target: { value: 'owner/repo' },
  });
  fireEvent.click(screen.getByText('Generate briefing →'));
  await screen.findByRole('article', { name: 'Onboarding briefing' });
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(screen.getByText('<script>unsafe()</script>')).toBeTruthy();
  expect(document.querySelector('article script')).toBeNull();
  fireEvent.change(screen.getByLabelText('Focus a discovered package'), {
    target: { value: 'packages/web' },
  });
  expect((screen.getByLabelText('Package or directory (optional)') as HTMLInputElement).value).toBe(
    'packages/web',
  );
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});
it('restores a saved briefing and its inputs without starting another job', async () => {
  history.replaceState(null, '', '/?briefing=brief-1');
  const fetch = vi.fn(async (path: string, options?: RequestInit) => {
    expect(options?.method).not.toBe('POST');
    return Response.json(path.includes('?q=') ? [report] : { ...report, scope: 'packages/web' });
  });
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  await screen.findByRole('article', { name: 'Onboarding briefing' });
  await waitFor(() =>
    expect((screen.getByLabelText('Public GitHub repository') as HTMLInputElement).value).toBe(
      'owner/repo',
    ),
  );
  expect((screen.getByLabelText('Package or directory (optional)') as HTMLInputElement).value).toBe(
    'packages/web',
  );
  expect(fetch.mock.calls.every((args) => args.length === 1 || !args[1])).toBe(true);
});
