/** Checks bounded discovery facts and repeated-query identity survive journal rotation. */
import { expect, it } from 'vitest';

import { DiscoveryState } from '../../../src/agents/discoveryState.js';
import { WorkingContext } from '../../../src/agents/workingContext.js';

it('retains discovered paths independently of the last four tool outcomes', () => {
  const context = new WorkingContext({}, [], true);
  const result = JSON.stringify({ items: ['src/Service.ts'], truncated: false });
  context.record('find_files', result, { query: 'Service', scope: 'src' });
  for (let i = 0; i < 5; i++) context.record('outline_file', JSON.stringify({ definitions: [] }));
  expect(JSON.stringify(context.snapshot())).toContain('src/Service.ts');
  context.record('find_files', result, { query: 'Service', scope: 'src' });
  expect(context.snapshot().discovery?.queries[0]?.attempts).toBe(2);
  context.record('find_files', result, { query: 'Service', scope: 'other' });
  expect(context.snapshot().discovery?.queries).toHaveLength(2);
});

it('bounds path metadata and retains explicit truncation/omission signals', () => {
  const state = new DiscoveryState();
  for (let i = 0; i < 20; i++)
    state.record(
      'find_files',
      { query: `query-${i}` },
      { items: Array.from({ length: 40 }, (_, j) => `${j}-${'x'.repeat(500)}`), truncated: false },
    );
  expect(Buffer.byteLength(JSON.stringify(state.snapshot()))).toBeLessThan(6100);
  expect(state.snapshot().omittedQueries).toBeGreaterThan(0);
});

it('does not turn failed searches or snippets into discovered path facts', () => {
  const state = new DiscoveryState();
  state.record('find_files', {}, { error: 'OUTPUT_LIMIT' });
  state.record(
    'search_code',
    {},
    { items: [{ path: 'x.ts', snippet: 'not source' }], truncated: false },
  );
  expect(state.snapshot().queries).toEqual([]);
});
