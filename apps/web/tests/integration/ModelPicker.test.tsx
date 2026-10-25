// @vitest-environment jsdom
/** Verifies provider grouping, reviewed model selection, and zero discovery calls in demo mode. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { ModelPicker } from '../../src/features/investigations/ModelPicker';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('loads grouped options and disables models without pricing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            provider: 'openai',
            model: 'reviewed',
            selectable: true,
            reason: null,
            inputPerMillion: 1,
            outputPerMillion: 2,
          },
          {
            provider: 'gemini',
            model: 'unreviewed',
            selectable: false,
            reason: 'Needs review',
            inputPerMillion: null,
            outputPerMillion: null,
          },
        ],
        errors: [],
        defaultSelection: { provider: 'openai', model: 'reviewed' },
      }),
    }),
  );
  const change = vi.fn();
  render(<ModelPicker value="" onChange={change} disabled={false} />);
  expect(screen.queryByRole('button', { name: 'Load available models' })).toBeNull();
  const unavailable = await screen.findByRole('option', { name: 'unreviewed — not enabled' });
  expect((unavailable as HTMLOptionElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Investigation model'), {
    target: { value: 'openai:reviewed' },
  });
  expect(change).toHaveBeenCalledWith('openai:reviewed');
});
it('does not discover models while disabled for demo mode', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<ModelPicker value="" onChange={() => {}} disabled />);
  expect((screen.getByLabelText('Investigation model') as HTMLSelectElement).disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
