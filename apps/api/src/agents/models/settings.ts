/** Defines provider-specific request settings shared by live and scripted investigations. */
import type { ModelSettings } from '@openai/agents';

export function investigationModelSettings(
  provider: 'openai' | 'gemini',
  outputTokens: number,
): ModelSettings {
  return {
    store: false,
    parallelToolCalls: false,
    maxTokens: outputTokens,
    reasoning: { effort: provider === 'gemini' ? 'minimal' : 'low' },
    retry: { maxRetries: 0 },
    providerData: provider === 'gemini' ? { store: undefined } : { service_tier: 'default' },
  };
}
