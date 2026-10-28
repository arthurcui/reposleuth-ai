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
    expect(list).toHaveBeenCalledWith('', 0);
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

it('passes model-selected scopes to discovery and search without guessing a package', async () => {
  const repo = fakeRepository();
  const list = vi.spyOn(repo, 'listFiles');
  const search = vi.spyOn(repo, 'searchCode');
  const tools = createTools(
    repo,
    [],
    () => {},
    () => {},
    10,
  );
  await tools
    .find((t) => t.name === 'find_files')!
    .invoke(new RunContext(), JSON.stringify({ query: 'Service', scope: 'packages/api' }));
  expect(list).toHaveBeenCalledWith('packages/api/');
  await tools
    .find((t) => t.name === 'search_code')!
    .invoke(new RunContext(), JSON.stringify({ query: 'enabled', scope: 'packages/client' }));
  expect(search).toHaveBeenCalledWith('enabled', 'packages/client');
  await tools
    .find((t) => t.name === 'search_code')!
    .invoke(new RunContext(), JSON.stringify({ query: 'enabled' }));
  expect(search).toHaveBeenLastCalledWith('enabled', '');
});

it('avoids repeating supplied issue content but still permits related issue reads', async () => {
  const repo = fakeRepository();
  const get = vi.spyOn(repo, 'getIssue');
  const tool = createTools(
    repo,
    [],
    () => {},
    () => {},
    10,
    undefined,
    1024,
    42,
  ).find((t) => t.name === 'get_issue')!;
  const result = String(await tool.invoke(new RunContext(), JSON.stringify({ number: 42 })));
  expect(JSON.parse(result)).toMatchObject({ number: 42, status: 'ALREADY_PROVIDED' });
  expect(get).not.toHaveBeenCalled();
  expect(Buffer.byteLength(result)).toBeLessThan(300);
  await tool.invoke(new RunContext(), JSON.stringify({ number: 43 }));
  expect(get).toHaveBeenCalledWith(43);
});
it('retrieves the issue normally when no preflight issue was supplied', async () => {
  const repo = fakeRepository();
  const get = vi.spyOn(repo, 'getIssue');
  const tool = createTools(
    repo,
    [],
    () => {},
    () => {},
    10,
  ).find((t) => t.name === 'get_issue')!;
  await tool.invoke(new RunContext(), JSON.stringify({ number: 42 }));
  expect(get).toHaveBeenCalledWith(42);
});
