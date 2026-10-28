// @vitest-environment jsdom
/** Verifies form interactions, demo navigation, reports, and reconnection behavior in jsdom. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/App';
import { demo, demoCases } from '../../src/features/demo/demo';
import { sourceUrl } from '../../src/features/investigations/client';
import { Report } from '../../src/features/investigations/Report';
// Provider discovery interactions are covered independently in ModelPicker.test.tsx.
vi.mock('../../src/features/investigations/ModelPicker', () => ({ ModelPicker: () => null }));

class Stream extends EventTarget {
  static latest: Stream;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    super();
    Stream.latest = this;
  }
  emit(type: string, id = 1) {
    this.dispatchEvent(
      new MessageEvent(type, {
        data: JSON.stringify({
          id,
          investigationId: 'run-1',
          at: demo.createdAt,
          type,
          data: { name: 'read_file' },
        }),
      }),
    );
  }
}
beforeEach(() => {
  history.replaceState(null, '', '/');
  vi.stubGlobal('EventSource', Stream);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('investigation UI', () => {
  it('reopens a saved report from history without starting another investigation', async () => {
    const saved = { ...demo, id: 'saved-run' };
    const fetch = vi.fn(async (path: string) => ({
      ok: true,
      json: async () =>
        path.includes('?')
          ? {
              total: 1,
              limit: 20,
              offset: 0,
              items: [
                {
                  id: saved.id,
                  request: saved.request,
                  status: saved.status,
                  createdAt: saved.createdAt,
                  model: saved.model,
                  summary: saved.report?.summary,
                  hasReport: true,
                },
              ],
            }
          : saved,
    }));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Investigation history' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open report' }));
    await waitFor(() => expect(location.search).toContain('investigation=saved-run'));
    expect(await screen.findByRole('link', { name: 'Export Markdown' })).toBeTruthy();
    expect(fetch.mock.calls.every(([path]) => path.startsWith('/api/investigations'))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText('Public GitHub repository') as HTMLInputElement).value).toBe(
      saved.request.repository,
    );
    expect((screen.getByLabelText(/Issue number/) as HTMLInputElement).value).toBe(
      String(saved.request.issueNumber),
    );
    expect(
      (screen.getByLabelText('What should we investigate?') as HTMLTextAreaElement).value,
    ).toBe(saved.request.question);
    expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy();
  });
  it('loads a direct report link, clears an absent issue, and preserves edits across events', async () => {
    history.replaceState(null, '', '/?investigation=run-1');
    const saved = {
      ...demo,
      id: 'run-1',
      request: { repository: 'owner/saved', question: 'Investigate the saved question' },
    };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => saved });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await screen.findByRole('button', { name: 'Run again' });
    expect((screen.getByLabelText(/Issue number/) as HTMLInputElement).value).toBe('');
    const question = screen.getByLabelText('What should we investigate?') as HTMLTextAreaElement;
    expect(question.value).toBe(saved.request.question);
    fireEvent.change(question, { target: { value: 'My revised question' } });
    await act(async () => {
      Stream.latest.emit('usage');
    });
    expect(question.value).toBe('My revised question');
  });
  it('visibly selects demo mode, disables live inputs, and restores the draft on exit', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    const repository = screen.getByLabelText('Public GitHub repository') as HTMLInputElement;
    fireEvent.change(repository, { target: { value: 'owner/draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show demo investigation' }));
    expect(await screen.findByText('DEMO MODE')).toBeTruthy();
    expect(screen.queryByText(/aaaaaaaaaaaa/)).toBeNull();
    expect(screen.queryByText('Synthetic example · no GitHub commit')).toBeNull();
    expect(screen.queryByText('LOCAL · READ ONLY')).toBeNull();
    expect(screen.queryByText('Curated example · no investigation was run')).toBeNull();
    expect(screen.getByText(/Issue #42/)).toBeTruthy();
    expect(repository.disabled).toBe(true);
    expect((screen.getByLabelText(/Issue number/) as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText('What should we investigate?') as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: '✓ Showing demo investigation' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByRole('button', { name: 'Investigate →' })).toBeNull();
    const leaveButton = screen.getByRole('button', { name: 'Start a real investigation →' });
    const leaveClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(leaveButton, leaveClick);
    expect(leaveClick.defaultPrevented).toBe(true);
    expect(leaveButton.isConnected).toBe(false);
    expect(screen.getByRole('button', { name: 'Investigate →' })).not.toBe(leaveButton);
    expect(repository.disabled).toBe(false);
    expect(repository.value).toBe('owner/draft');
    expect(location.search).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('browses all 20 cases without API calls and restores selection from the URL', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    history.replaceState(null, '', '/?investigation=demo');
    const view = render(<App />);
    expect(
      (screen.getByLabelText('Explore the 20 defect cases') as HTMLSelectElement).options,
    ).toHaveLength(20);
    expect(
      (screen.getByRole('button', { name: 'Previous demo case' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next demo case' }));
    expect((screen.getByLabelText('Explore the 20 defect cases') as HTMLSelectElement).value).toBe(
      'n1-authors',
    );
    expect(await screen.findByText('N+1: n1-authors')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous demo case' }));
    expect((screen.getByLabelText('Explore the 20 defect cases') as HTMLSelectElement).value).toBe(
      'n1-orders',
    );
    expect(screen.getByRole('link', { name: 'View evidence #1 ↓' }).getAttribute('href')).toBe(
      '#evidence-E1',
    );
    expect(
      (screen.getByRole('button', { name: 'Previous report case' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next report case' }));
    expect(await screen.findByText('N+1: n1-authors')).toBeTruthy();
    expect((screen.getByLabelText('Explore the 20 defect cases') as HTMLSelectElement).value).toBe(
      'n1-authors',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous report case' }));
    expect(await screen.findByText('N+1: n1-orders')).toBeTruthy();
    for (const test of demoCases) {
      fireEvent.change(screen.getByLabelText('Explore the 20 defect cases'), {
        target: { value: test.id },
      });
      expect(await screen.findByText(`${test.category}: ${test.id}`)).toBeTruthy();
      expect(screen.getByText(test.fix)).toBeTruthy();
      expect(screen.getByText(test.verification)).toBeTruthy();
    }
    expect(location.search).toContain('case=page-order');
    expect(
      (screen.getByRole('button', { name: 'Next demo case' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Next report case' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    view.unmount();
    render(<App />);
    expect(await screen.findByText('pagination: page-order')).toBeTruthy();
    act(() => {
      history.replaceState(null, '', '/?investigation=demo&case=cache-key');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByText('cache-invalidation: cache-key')).toBeTruthy();
    expect(screen.queryByText('Open on GitHub ↗')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('opens the clearly labeled demo without network requests and restores it from the URL', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const view = render(<App />);
    fireEvent.click(screen.getByText('Show demo investigation'));
    expect(await screen.findByText('N+1: n1-orders')).toBeTruthy();
    expect(screen.getByText(/synthetic code and findings/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    view.unmount();
    render(<App />);
    expect(await screen.findByText('N+1: n1-orders')).toBeTruthy();
  });
  it('submits the form, shows live events once, and cancels a run', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        init?.method === 'POST'
          ? { id: 'run-1', cancelled: true }
          : { ...demo, id: 'run-1', status: 'running', report: null },
    }));
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    fireEvent.change(screen.getByLabelText('Public GitHub repository'), {
      target: { value: 'owner/repo' },
    });
    fireEvent.change(screen.getByLabelText(/Issue number/), { target: { value: '42' } });
    fireEvent.click(screen.getByText('Investigate →'));
    await screen.findByText('Stop investigation');
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({
      repository: 'owner/repo',
      issueNumber: 42,
    });
    act(() => {
      Stream.latest.emit('tool_started');
      Stream.latest.emit('tool_started');
    });
    expect(screen.getAllByText('read file')).toHaveLength(1);
    fireEvent.click(screen.getByText('Stop investigation'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/investigations/run-1/cancel',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
  it('restores a saved quota failure with actionable guidance and no report', async () => {
    history.replaceState(null, '', '/?investigation=run-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ...demo,
          id: 'run-1',
          status: 'failed',
          report: null,
          errorCode: 'OPENAI_QUOTA',
        }),
      })),
    );
    render(<App />);
    expect(await screen.findByText(/API credits are exhausted/)).toBeTruthy();
    expect(screen.getByText(/No validated report/)).toBeTruthy();
    act(() => {
      Stream.latest.dispatchEvent(
        new MessageEvent('source_read', {
          data: JSON.stringify({
            id: 30,
            investigationId: 'run-1',
            at: demo.createdAt,
            type: 'source_read',
            data: { path: 'src/example.ts', startLine: 2, endLine: 5, commitSha: demo.commitSha },
          }),
        }),
      );
      Stream.latest.emit('tool_started', 31);
      Stream.latest.emit('terminal', 32);
    });
    expect(await screen.findByText('Recorded source reads (1)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'src/example.ts:2-5', hidden: true })).toBeTruthy();
    expect(screen.getByText(/Read source file · started; completion not recorded/)).toBeTruthy();
  });
  it('recovers terminal status by polling if the terminal event arrives during a fetch', async () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/?investigation=run-1');
    let release!: (value: unknown) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue({ ok: true, json: async () => ({ ...demo, id: 'run-1' }) });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    act(() => Stream.latest.emit('terminal'));
    await act(async () => {
      release({
        ok: true,
        json: async () => ({ ...demo, id: 'run-1', status: 'running', report: null }),
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText('Possible N+1 database reads')).toBeTruthy();
  });
  it('escapes source text and only links immutable GitHub paths', () => {
    const run = structuredClone(demo);
    run.id = 'real';
    run.report!.evidence[0]!.quote = '<script>alert(1)</script>';
    const { container } = render(<Report run={run} />);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
    expect(screen.getByText('Open on GitHub ↗').getAttribute('href')).toContain(
      `/blob/${'a'.repeat(40)}/src/customers.ts#L42-L44`,
    );
    expect(sourceUrl('owner/repo', 'a'.repeat(40), '../secret', 1, 2)).toBeNull();
    expect(sourceUrl('https://evil.test', 'a'.repeat(40), 'x', 1, 2)).toBeNull();
  });
});

it('shows mode limits and preserves the selected mode across a demo visit without submitting', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  const picker = screen.getByLabelText('Investigation mode') as HTMLSelectElement;
  expect(picker.value).toBe('standard');
  fireEvent.change(picker, { target: { value: 'deep' } });
  expect(screen.getByRole('option', { name: 'Deep · up to 5 min · $0.15' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show demo investigation' }));
  expect(picker.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Start a real investigation →' }));
  expect(picker.value).toBe('deep');
  expect(picker.disabled).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it('restores a saved mode and renders cited reasoning without launching a run', async () => {
  history.replaceState(null, '', '/?investigation=saved-run');
  const saved = structuredClone(demo);
  saved.id = 'saved-run';
  saved.request.mode = 'deep';
  saved.report!.reasoningSummary = {
    assessment: 'Evidence suggests a repeated call.',
    evidenceIds: [saved.report!.evidence[0]!.id],
    alternatives: [{ explanation: 'Network behavior is unmeasured.', evidenceIds: [] }],
    counterEvidence: [],
    limitations: 'No runtime measurement.',
  };
  const fetch = vi.fn(async () => ({ ok: true, json: async () => saved }));
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  await screen.findByRole('heading', { name: 'Evidence-based reasoning summary' });
  expect((screen.getByLabelText('Investigation mode') as HTMLSelectElement).value).toBe('deep');
  expect(screen.getByText('Unverified · no source citation')).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});
