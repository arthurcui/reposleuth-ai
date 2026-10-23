// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { demo } from './demo';
import { Report } from './Report';
import { sourceUrl } from './client';

class Stream extends EventTarget {
  static latest: Stream;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() { super(); Stream.latest = this; }
  emit(type: string, id = 1) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify({ id, investigationId: 'run-1', at: demo.createdAt, type, data: { name: 'read_file' } }) })); }
}
beforeEach(() => { history.replaceState(null, '', '/'); vi.stubGlobal('EventSource', Stream); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('investigation UI', () => {
  it('opens the clearly labeled demo without network requests and restores it from the URL', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const view = render(<App />); fireEvent.click(screen.getByText('Explore free demo'));
    expect(await screen.findByText('Possible N+1 database reads')).toBeTruthy();
    expect(screen.getByText(/synthetic code and findings/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    view.unmount(); render(<App />);
    expect(await screen.findByText('Possible N+1 database reads')).toBeTruthy();
  });
  it('submits the form, shows live events once, and cancels a run', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST' ? { id: 'run-1', cancelled: true } : { ...demo, id: 'run-1', status: 'running', report: null } }));
    vi.stubGlobal('fetch', fetch); render(<App />);
    fireEvent.change(screen.getByLabelText('Public GitHub repository'), { target: { value: 'owner/repo' } });
    fireEvent.change(screen.getByLabelText(/Issue number/), { target: { value: '42' } });
    fireEvent.click(screen.getByText('Investigate →'));
    await screen.findByText('Stop investigation');
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({ repository: 'owner/repo', issueNumber: 42 });
    act(() => { Stream.latest.emit('tool_started'); Stream.latest.emit('tool_started'); });
    expect(screen.getAllByText('read file')).toHaveLength(1);
    fireEvent.click(screen.getByText('Stop investigation'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/investigations/run-1/cancel', expect.objectContaining({ method: 'POST' })));
  });
  it('restores a saved quota failure with actionable guidance and no report', async () => {
    history.replaceState(null, '', '/?investigation=run-1');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...demo, id: 'run-1', status: 'failed', report: null, errorCode: 'OPENAI_QUOTA' }) })));
    render(<App />);
    expect(await screen.findByText(/API credits are exhausted/)).toBeTruthy();
    expect(screen.getByText(/No validated report/)).toBeTruthy();
  });
  it('recovers terminal status by polling if the terminal event arrives during a fetch', async () => {
    vi.useFakeTimers(); history.replaceState(null, '', '/?investigation=run-1');
    let release!: (value: unknown) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ ok: true, json: async () => ({ ...demo, id: 'run-1' }) });
    vi.stubGlobal('fetch', fetch); render(<App />);
    act(() => Stream.latest.emit('terminal'));
    await act(async () => { release({ ok: true, json: async () => ({ ...demo, id: 'run-1', status: 'running', report: null }) }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(screen.getByText('Possible N+1 database reads')).toBeTruthy();
  });
  it('escapes source text and only links immutable GitHub paths', () => {
    const run = structuredClone(demo); run.id = 'real'; run.report!.evidence[0]!.quote = '<script>alert(1)</script>';
    const { container } = render(<Report run={run} />);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
    expect(screen.getByText('Open on GitHub ↗').getAttribute('href')).toContain(`/blob/${'a'.repeat(40)}/src/customers.ts#L42-L44`);
    expect(sourceUrl('owner/repo', 'a'.repeat(40), '../secret', 1, 2)).toBeNull();
    expect(sourceUrl('https://evil.test', 'a'.repeat(40), 'x', 1, 2)).toBeNull();
  });
});
