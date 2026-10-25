// @vitest-environment jsdom
/** Verifies history filters, pagination, reopening, downloads, and loading/error recovery. */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvestigationHistory } from '../../src/features/history/InvestigationHistory';
import type { HistoryPage } from '@reposleuth/shared';

const page: HistoryPage = {
  total: 21,
  limit: 20,
  offset: 0,
  items: [
    {
      id: 'saved-1',
      request: { repository: 'owner/repo', issueNumber: 42, question: 'Why are customers slow?' },
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      model: 'test-model',
      summary: 'Repeated database calls',
      hasReport: true,
    },
  ],
};
const response = (body: unknown) => ({ ok: true, json: async () => body });
it('groups models from the full saved history, including models absent from the current page', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        response({ ...page, models: ['gemini-3.5-flash-lite', 'gpt-6-luna', 'custom-model'] }),
      ),
  );
  render(<InvestigationHistory onOpen={() => {}} />);
  await screen.findByText('Repeated database calls');
  const select = screen.getByLabelText('Model filter') as HTMLSelectElement;
  expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
    'OpenAI',
    'Google Gemini',
    'Other models',
  ]);
  expect(select.querySelector('optgroup[label="OpenAI"] option')?.textContent).toBe('gpt-6-luna');
  expect(select.querySelector('optgroup[label="Google Gemini"] option')?.textContent).toBe(
    'gemini-3.5-flash-lite',
  );
  expect(select.value).toBe('');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('lists saved runs, opens reports, and supplies a download link', async () => {
  const fetch = vi.fn().mockResolvedValue(response(page));
  vi.stubGlobal('fetch', fetch);
  const onOpen = vi.fn();
  render(<InvestigationHistory onOpen={onOpen} />);
  expect(screen.getByText('Loading history…')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Open report' }));
  expect(onOpen).toHaveBeenCalledWith('saved-1');
  expect(screen.getByRole('link', { name: 'Export Markdown' }).getAttribute('href')).toBe(
    '/api/investigations/saved-1/export',
  );
  expect(screen.getByText('Repeated database calls')).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('combines all filters, advances pages, and resets pagination when filters clear', async () => {
  const fetch = vi.fn().mockResolvedValue(response(page));
  vi.stubGlobal('fetch', fetch);
  render(<InvestigationHistory onOpen={() => {}} />);
  await screen.findByText('Repeated database calls');
  for (const [label, value] of [
    ['Search past investigations', 'cache key'],
    ['Repository filter', 'owner/repo'],
    ['Issue filter', '42'],
    ['Model filter', 'test-model'],
    ['Status filter', 'completed'],
  ]) {
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  const url = new URL(fetch.mock.calls[1]![0], 'http://localhost');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    q: 'cache key',
    repository: 'owner/repo',
    issueNumber: '42',
    model: 'test-model',
    status: 'completed',
    offset: '0',
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(fetch.mock.calls[2]![0]).toContain('offset=20');
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  const reset = new URL(fetch.mock.calls[3]![0], 'http://localhost').searchParams;
  expect(reset.get('offset')).toBe('0');
  expect(reset.has('q')).toBe(false);
  expect((screen.getByLabelText('Model filter') as HTMLInputElement).value).toBe('');
});

it('handles empty results, failures, retries, and runs with no report', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response({ ...page, items: [], total: 0 }))
    .mockResolvedValueOnce(
      response({
        ...page,
        total: 1,
        items: [{ ...page.items[0], status: 'failed', hasReport: false, summary: null }],
      }),
    );
  vi.stubGlobal('fetch', fetch);
  render(<InvestigationHistory onOpen={() => {}} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  expect(await screen.findByText('No saved investigations match your search.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByRole('button', { name: 'View investigation' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Export Markdown' })).toBeNull();
});

it('ignores an older response after a new search completes', async () => {
  let release!: (value: ReturnType<typeof response>) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(response({ ...page, items: [], total: 0 }));
  vi.stubGlobal('fetch', fetch);
  render(<InvestigationHistory onOpen={() => {}} />);
  fireEvent.change(screen.getByLabelText('Search past investigations'), {
    target: { value: 'missing' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText('No saved investigations match your search.');
  await act(async () => {
    release(response(page));
  });
  expect(screen.queryByText('Repeated database calls')).toBeNull();
});
