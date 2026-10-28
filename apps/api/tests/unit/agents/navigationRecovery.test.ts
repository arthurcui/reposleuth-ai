/** Checks bounded page continuation and safe source-range recovery without model calls. */
import { RunContext } from '@openai/agents';
import { expect, it, vi } from 'vitest';

import { listingPage } from '../../../src/agents/listingPage.js';
import { createTools } from '../../../src/agents/tools.js';
import { type SourceFile, SourceRangeError } from '../../../src/github/RepositoryProvider.js';
import { fakeRepository } from '../../fixtures/agentFixtures.js';

it('pages multibyte paths without gaps inside the byte allowance', () => {
  const items = Array.from({ length: 90 }, (_, i) => `src/文件${i}.ts`);
  const seen: string[] = [];
  let offset = 0;
  for (let count = 0; count < 90; count++) {
    const page = listingPage(
      { ...fakeRepository().revision, items: items.slice(offset), truncated: false, warnings: [] },
      offset,
      600,
    );
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(600);
    expect(page.items.length).toBeGreaterThan(0);
    seen.push(...page.items);
    if (page.nextOffset === null) break;
    expect(page.nextOffset).toBeGreaterThan(offset);
    offset = page.nextOffset;
  }
  expect(seen).toEqual(items);
});
it('preserves upstream continuation and incomplete-tree warnings', () => {
  const input = {
    ...fakeRepository().revision,
    items: ['src/a.ts'],
    truncated: true,
    warnings: ['Tree incomplete'],
    nextOffset: 500,
  };
  expect(listingPage(input, 499, 1000)).toEqual(input);
  expect(() => listingPage(input, 499, 1)).toThrow('Narrow the listing prefix');
});
it('returns safe range metadata and requested arguments without registering evidence', async () => {
  const repo = fakeRepository();
  repo.readFile = async () => {
    throw new SourceRangeError('START_AFTER_EOF', 7);
  };
  const reads: SourceFile[] = [];
  const emit = vi.fn();
  const read = createTools(repo, reads, () => {}, emit, 5).find((t) => t.name === 'read_file')!;
  const result = await read.invoke(
    new RunContext(),
    JSON.stringify({ path: 'src/a.ts', startLine: 20, endLine: 40 }),
  );
  expect(JSON.parse(String(result))).toMatchObject({
    error: 'INVALID_RANGE',
    reason: 'START_AFTER_EOF',
    totalLines: 7,
    maxLines: 200,
  });
  expect(emit).toHaveBeenCalledWith('tool_started', {
    name: 'read_file',
    call: 1,
    path: 'src/a.ts',
    startLine: 20,
    endLine: 40,
  });
  expect(reads).toEqual([]);
  repo.readFile = async () => {
    throw new Error('private provider response');
  };
  expect(
    String(
      await read.invoke(
        new RunContext(),
        JSON.stringify({ path: 'src/a.ts', startLine: 1, endLine: 2 }),
      ),
    ),
  ).not.toContain('private');
});
