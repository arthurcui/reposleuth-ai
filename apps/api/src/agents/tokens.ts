/** Estimates supported text-model inputs locally; unknown models retain a byte-based fallback. */
import { getEncoding } from 'js-tiktoken';

let encoder: ReturnType<typeof getEncoding> | undefined;

/** GPT-5 uses o200k_base (OpenAI tiktoken/model.py); no guessed mapping for newer families. */
export function estimateInputTokens(text: string, model?: string): number {
  if (!model || !/^gpt-5(?:[.-]|$)/.test(model)) return Buffer.byteLength(text) + 4096;
  encoder ??= getEncoding('o200k_base');
  // Encode special-token-looking repository text literally. Include schema, framing and a 30% margin.
  return Math.ceil(encoder.encode(text, [], []).length * 1.3) + 2048;
}
