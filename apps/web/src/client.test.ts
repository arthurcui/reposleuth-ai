import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';

afterEach(() => vi.unstubAllGlobals());
describe('API response errors', () => {
  it.each([
    ['', 500],
    ['<html>Bad gateway</html>', 502],
    ['', 200],
  ])('explains an empty or non-JSON response without exposing raw content', async (body, status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(api('', { method: 'POST' })).rejects.toThrow(`empty or invalid response (HTTP ${status})`);
    expect(fetch).toHaveBeenCalledTimes(1); // Never automatically retry billable submissions.
  });
  it('explains an unreachable API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('')).rejects.toThrow('Start both apps with npm run dev');
  });
  it('preserves structured API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'AGENT_NOT_CONFIGURED' }, { status: 503 })));
    await expect(api('')).rejects.toThrow('Configure LLM_PROVIDER and its server API key');
  });
});
