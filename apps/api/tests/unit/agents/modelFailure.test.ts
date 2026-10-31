/** Checks that failure diagnostics distinguish useful categories without leaking provider payloads. */
import { expect, it } from 'vitest';

import { modelFailure } from '../../../src/agents/modelFailure.js';

it.each([
  [{ status: 503 }, 'http_response'],
  [{ name: 'APIConnectionTimeoutError' }, 'timeout'],
  [{ name: 'APIConnectionError', cause: { code: 'ECONNRESET' } }, 'connection'],
  [new SyntaxError('private response'), 'local_processing'],
  [new Error('unknown cause'), 'unknown'],
  [null, 'unknown'],
])('classifies a failure without guessing its root cause', (error, category) => {
  expect(modelFailure(error).category).toBe(category);
});

it('drops arbitrary messages, names, codes, headers and nested payloads', () => {
  const secret = 'secret-must-not-be-persisted';
  const details = modelFailure({
    status: 500,
    name: secret,
    code: secret,
    message: secret,
    headers: { authorization: secret },
    cause: { message: secret, body: secret },
  });
  expect(details).toEqual({
    status: 500,
    errorType: 'unknown',
    transportCode: null,
    category: 'http_response',
  });
  expect(JSON.stringify(details)).not.toContain(secret);
});
