/** Exercises SDK-compatible report selection without repairing invalid output or retaining content. */
import { type ModelResponse, Usage } from '@openai/agents';
import { expect, it } from 'vitest';

import { reportDiagnostics, reportText } from '../../../src/agents/reportResponse.js';
const message = (text: string): ModelResponse['output'][number] => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text }],
});
const response = (...output: ModelResponse['output']): ModelResponse => ({
  output,
  usage: new Usage({ inputTokens: 10, outputTokens: 20 }),
});
it('does not rescue a malformed final message using an earlier valid JSON message', () => {
  const r = response(message('{"valid":true}'), message('{broken'));
  expect(reportText(r)).toBe('{broken');
  expect(() => JSON.parse(reportText(r))).toThrow();
});
it('preserves text segments surrounding reasoning items', () => {
  const r = response(message('{"value":'), { type: 'reasoning', content: [] }, message('1}'));
  expect(JSON.parse(reportText(r))).toEqual({ value: 1 });
});
it('does not silently pick one of two JSON objects in a segmented response', () => {
  const r = response({ type: 'reasoning', content: [] }, message('{}'), message('{}'));
  expect(() => JSON.parse(reportText(r))).toThrow();
});
it('records structural diagnostics and recognized termination reasons without raw content', () => {
  const r = response(message('private source marker'), message('{"secret":"not logged"}'));
  r.providerData = {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    error: { message: 'private error' },
    choices: [{ finish_reason: 'length' }],
  };
  const diagnostic = reportDiagnostics(r);
  expect(diagnostic).toMatchObject({
    messageCount: 2,
    messageJsonValid: [false, true],
    providerStatus: 'incomplete',
    incompleteReason: 'max_output_tokens',
    finishReasons: ['length'],
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(/private|secret|not logged/);
});
it('handles empty responses without assuming they are valid JSON', () => {
  expect(reportText(response())).toBe('');
  expect(reportDiagnostics(response()).messageCount).toBe(0);
});
