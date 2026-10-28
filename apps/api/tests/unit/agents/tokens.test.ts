/** Covers padded tokenizer estimates, special text and unsupported-model fallback. */
import { expect, it } from 'vitest';

import { estimateInputTokens } from '../../../src/agents/tokens.js';
it('uses a padded GPT estimate and encodes special-looking source literally', () => {
  const source = 'const customer = await repository.findById(id); // lookup\n'.repeat(120);
  const estimated = estimateInputTokens(source, 'gpt-5.4-mini');
  expect(estimated).toBeGreaterThan(2048);
  expect(estimated).toBeLessThan(Buffer.byteLength(source));
  expect(() => estimateInputTokens('你好 🚀 <|endoftext|>', 'gpt-5.4-mini')).not.toThrow();
});
it.each([undefined, 'gemini-3.5-flash-lite', 'gpt-6-luna', 'unrecognized'])(
  'retains conservative fallback for %s',
  (model) => {
    const text = '你好 🚀';
    expect(estimateInputTokens(text, model)).toBe(Buffer.byteLength(text) + 4096);
  },
);
