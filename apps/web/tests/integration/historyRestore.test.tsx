// @vitest-environment jsdom
/** Verifies history restores every input with the real model picker, independent of today's default. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { demo } from '../../src/features/demo/demo';
import { InvestigationApp as App } from '../../src/InvestigationApp';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
class Stream extends EventTarget {
  close() {}
}

it.each(['legacy-gpt', 'explicit-gemini', 'unknown'] as const)(
  'restores %s without defaulting or submitting on open',
  async (kind) => {
    history.replaceState(null, '', '/');
    vi.stubGlobal('EventSource', Stream);
    const saved = structuredClone(demo);
    saved.id = 'saved-history';
    saved.request = {
      repository: 'owner/saved-repo',
      issueNumber: 73,
      question: 'Explain why the saved endpoint fails',
      ...(kind === 'explicit-gemini' ? { mode: 'deep' as const } : {}),
    };
    saved.model =
      kind === 'legacy-gpt'
        ? 'gpt-6-luna'
        : kind === 'explicit-gemini'
          ? 'gemini-3.5-flash-lite'
          : 'custom-legacy';
    delete saved.provider;
    if (kind === 'explicit-gemini') saved.provider = 'gemini';
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('Submission captured; no live request');
      const data = path.endsWith('/models')
        ? {
            models: [
              {
                provider: 'openai',
                model: 'gpt-6-luna',
                selectable: true,
                reason: null,
                inputPerMillion: 1,
                outputPerMillion: 1,
              },
              {
                provider: 'gemini',
                model: 'gemini-3.5-flash-lite',
                selectable: true,
                reason: null,
                inputPerMillion: 1,
                outputPerMillion: 1,
              },
            ],
            defaultSelection: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
            errors: [],
          }
        : path.includes('?')
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
          : saved;
      return { ok: true, json: async () => data };
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Investigation history' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open report' }));
    await screen.findByRole('button', { name: 'Run again' });
    const expected =
      kind === 'legacy-gpt'
        ? 'openai:gpt-6-luna'
        : kind === 'explicit-gemini'
          ? 'gemini:gemini-3.5-flash-lite'
          : 'unknown:custom-legacy';
    await waitFor(() =>
      expect((screen.getByLabelText('Investigation model') as HTMLSelectElement).value).toBe(
        expected,
      ),
    );
    expect((screen.getByLabelText('Public GitHub repository') as HTMLInputElement).value).toBe(
      saved.request.repository,
    );
    expect((screen.getByLabelText(/Issue number/) as HTMLInputElement).value).toBe('73');
    expect(
      (screen.getByLabelText('What should we investigate?') as HTMLTextAreaElement).value,
    ).toBe(saved.request.question);
    expect((screen.getByLabelText('Investigation mode') as HTMLSelectElement).value).toBe(
      saved.request.mode ?? 'standard',
    );
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    if (kind === 'unknown') {
      await screen.findByText(/The saved model’s provider is unknown/);
      expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    } else {
      await waitFor(() =>
        expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
      );
      const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')![1]!;
      expect(JSON.parse(String(post.body))).toEqual({
        ...saved.request,
        mode: saved.request.mode ?? 'standard',
        modelSelection: {
          provider: kind === 'legacy-gpt' ? 'openai' : 'gemini',
          model: saved.model,
        },
      });
    }
  },
);
