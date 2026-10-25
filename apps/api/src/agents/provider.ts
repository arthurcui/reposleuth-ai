import { MODEL, RATES } from './budget.js';

export type ProviderConfig = {
  provider: 'openai' | 'gemini'; model: string; keyVariable: string;
  rates: { input: number; output: number };
};
export const OPENAI: ProviderConfig = { provider: 'openai', model: MODEL, keyVariable: 'OPENAI_API_KEY', rates: RATES };
// Text-only standard paid-tier prices, checked 2026-10-24. Free-tier use is still
// conservatively estimated at paid rates; these estimates are not invoices.
export const GEMINI: ProviderConfig = { provider: 'gemini', model: 'gemini-3.5-flash-lite', keyVariable: 'GEMINI_API_KEY',
  rates: { input: 0.30 / 1_000_000, output: 2.50 / 1_000_000 } };

export function providerConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const provider = env.LLM_PROVIDER?.trim() || 'openai';
  if (provider === 'openai') return OPENAI;
  if (provider === 'gemini') return GEMINI;
  throw new Error('LLM_PROVIDER must be openai or gemini');
}
