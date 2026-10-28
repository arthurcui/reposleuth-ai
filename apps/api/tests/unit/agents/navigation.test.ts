/** Checks generic filename discovery and safe root aliases without repository-specific hints. */
import { RunContext } from '@openai/agents';
import { expect, it, vi } from 'vitest';

import { createTools } from '../../../src/agents/tools.js';
import { fakeRepository } from '../../fixtures/agentFixtures.js';

it.each(['.', './', ''])(
  'lists root for %s without relaxing other path validation',
  async (prefix) => {
    const repo = fakeRepository();
    const list = vi.spyOn(repo, 'listFiles');
    const tool = createTools(
      repo,
      [],
      () => {},
      () => {},
      10,
    ).find((t) => t.name === 'list_files')!;
    await tool.invoke(new RunContext(), JSON.stringify({ prefix }));
    expect(list).toHaveBeenCalledWith('');
  },
);
it('finds referenced names case-insensitively and preserves incomplete-list warnings', async () => {
  const repo = fakeRepository();
  repo.listFiles = async () => ({
    ...repo.revision,
    items: ['Core/InvoiceService.cs', 'Program.cs'],
    truncated: true,
    warnings: ['Tree incomplete'],
  });
  const tool = createTools(
    repo,
    [],
    () => {},
    () => {},
    10,
  ).find((t) => t.name === 'find_files')!;
  const result = JSON.parse(
    String(await tool.invoke(new RunContext(), JSON.stringify({ query: 'invoiceservice' }))),
  );
  expect(result).toMatchObject({
    items: ['Core/InvoiceService.cs'],
    truncated: true,
    warnings: ['Tree incomplete'],
  });
});
it('caps matching paths and marks omitted matches', async () => {
  const repo = fakeRepository();
  repo.listFiles = async () => ({
    ...repo.revision,
    items: Array.from({ length: 45 }, (_, i) => `src/Service${i}.ts`),
    truncated: false,
    warnings: [],
  });
  const tool = createTools(
    repo,
    [],
    () => {},
    () => {},
    10,
  ).find((t) => t.name === 'find_files')!;
  const result = JSON.parse(
    String(await tool.invoke(new RunContext(), JSON.stringify({ query: 'Service' }))),
  );
  expect(result.items).toHaveLength(40);
  expect(result.truncated).toBe(true);
});
