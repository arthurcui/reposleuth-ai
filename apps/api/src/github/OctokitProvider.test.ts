import { Octokit } from '@octokit/rest';
import { describe, expect, it } from 'vitest';
import { OctokitProvider } from './OctokitProvider.js';
import { LIMITS, parseRepository, searchIndex, splitSource } from './repositoryIndex.js';
import { FIXTURE_SHA, TREE_SHA, BLOB_SHA, SOURCE, fixtureTree } from './fixtures.js';

type Override = (url: URL) => { status?: number; data: unknown; headers?: Record<string, string> } | undefined;
function fixture(override?: Override) {
  const calls: URL[] = [];
  const methods: string[] = [];
  const client = new Octokit({ request: { fetch: async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    calls.push(url);
    methods.push(init?.method ?? 'GET');
    const custom = override?.(url);
    if (custom) return Response.json(custom.data, { status: custom.status ?? 200, headers: custom.headers });
    const base = '/repos/owner/repo';
    let data: unknown;
    if (url.pathname === base) data = { private: false, visibility: 'public', default_branch: 'main' };
    else if (url.pathname === `${base}/commits/main`) data = { sha: FIXTURE_SHA, commit: { tree: { sha: TREE_SHA } } };
    else if (url.pathname === `${base}/git/trees/${TREE_SHA}`) data = fixtureTree();
    else if (url.pathname === `${base}/git/blobs/${BLOB_SHA}`) data = { size: Buffer.byteLength(SOURCE), encoding: 'base64', content: Buffer.from(SOURCE).toString('base64') };
    else if (url.pathname === `${base}/issues/42`) data = { title: 'Slow customer API', body: 'Slow with many customers', state: 'open', comments: 1 };
    else if (url.pathname === `${base}/issues/42/comments`) data = [{ body: 'Reproduces with 50 customers' }];
    else if (url.pathname === `${base}/commits`) data = [{ sha: FIXTURE_SHA, commit: { message: 'Add customer orders' } }];
    else if (url.pathname === `${base}/commits/${FIXTURE_SHA}`) data = { files: [{ filename: 'src/customers.ts', status: 'modified', patch: '@@ -1 +1 @@\n+customer.orders = await db.orders.findMany();' }] };
    else throw new Error(`Unexpected fixture request: ${url.pathname}`);
    return Response.json(data);
  } } });
  return { client, calls, methods, connect: () => OctokitProvider.connect('https://github.com/owner/repo.git', { client }) };
}

describe('repository selection', () => {
  it.each(['owner/repo', 'https://github.com/owner/repo', 'https://github.com/owner/repo.git/'])( 'accepts %s', input => {
    expect(parseRepository(input)).toEqual({ owner: 'owner', repo: 'repo' });
  });
  it.each(['https://evil.test/owner/repo', 'https://github.com@evil.test/a/b', 'https://user:secret@github.com/a/b', 'http://github.com/a/b', 'a/../b', 'https://github.com/a/b/issues/42', 'https://github.com/a/b?x=1', 'a/b\\c'])( 'rejects %s', input => {
    expect(() => parseRepository(input)).toThrow();
  });
});

describe('read-only provider', () => {
  it('runs all six operations with exact evidence and pinned GET requests', async () => {
    const f = fixture();
    const provider = await f.connect();
    expect(provider.revision.commitSha).toBe(FIXTURE_SHA);
    expect((await provider.getIssue(42)).comments).toEqual(['Reproduces with 50 customers']);
    const files = await provider.listFiles('src/');
    expect(files.items).toEqual(['src/customers.ts']);
    expect(files.warnings).toContain('2 files excluded by path, type, size, or tree limits.');
    const source = await provider.readFile('src/customers.ts', 3, 4);
    expect(source.lines[1]).toEqual({ line: 4, text: '    customer.orders = await db.orders.findMany({ customerId: customer.id });' });
    expect(source.commitSha).toBe(FIXTURE_SHA);
    expect((await provider.searchCode('db.orders')).items[0]?.line).toBe(4);
    expect((await provider.getCommits('src/customers.ts')).items[0]?.sha).toBe(FIXTURE_SHA);
    expect((await provider.getFileDiff(FIXTURE_SHA, 'src/customers.ts')).patch).toContain('db.orders');
    expect(f.methods.every(method => method === 'GET')).toBe(true);
    expect(f.calls.filter(url => url.pathname.endsWith(`/git/blobs/${BLOB_SHA}`))).toHaveLength(1);
    expect(f.calls.find(url => url.pathname.endsWith('/commits'))?.searchParams.get('sha')).toBe(FIXTURE_SHA);
    expect(f.calls.filter(url => url.pathname.endsWith('/commits/main'))).toHaveLength(1);
  });

  it('rejects private repositories before reading their content', async () => {
    const f = fixture(url => url.pathname === '/repos/owner/repo' ? { data: { private: true } } : undefined);
    await expect(f.connect()).rejects.toMatchObject({ code: 'PRIVATE_REPOSITORY' });
    expect(f.calls).toHaveLength(1);
  });

  it.each([[401, 'AUTHENTICATION'], [403, 'RATE_LIMIT_OR_FORBIDDEN'], [429, 'RATE_LIMIT_OR_FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'EMPTY_REPOSITORY'], [500, 'GITHUB_UNAVAILABLE']])('sanitizes GitHub %i errors', async (status, code) => {
    const f = fixture(() => ({ status: Number(status), data: { message: 'secret upstream details' } }));
    await expect(f.connect()).rejects.toMatchObject({ code });
    await expect(f.connect()).rejects.not.toThrow('secret upstream details');
  });

  it('reports partial trees and rejects excluded paths', async () => {
    const f = fixture(url => url.pathname.includes('/git/trees/') ? { data: { ...fixtureTree(), truncated: true } } : undefined);
    const provider = await f.connect();
    expect((await provider.listFiles()).warnings.join(' ')).toContain('GitHub truncated');
    await expect(provider.readFile('node_modules/lib.js', 1, 2)).rejects.toMatchObject({ code: 'FILE_UNAVAILABLE' });
    await expect(provider.readFile('link.ts', 1, 2)).rejects.toMatchObject({ code: 'FILE_UNAVAILABLE' });
  });

  it('validates paths, ranges, queries and issue numbers before requests', async () => {
    const f = fixture();
    const provider = await f.connect();
    await expect(provider.readFile('../secrets', 1, 2)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(provider.readFile('src/customers.ts', 1, 201)).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    await expect(provider.readFile('src/customers.ts', 2, 1)).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    await expect(provider.searchCode('x')).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(provider.getIssue(0)).rejects.toMatchObject({ code: 'INVALID_ISSUE' });
    expect(f.calls).toHaveLength(2);
  });

  it('handles EOF without inventing lines', async () => {
    const provider = await fixture().connect();
    expect((await provider.readFile('src/customers.ts', 6, 100)).endLine).toBe(7);
    await expect(provider.readFile('src/customers.ts', 8, 9)).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    expect(splitSource('')).toEqual([]);
    expect(splitSource('one\r\ntwo\r\n')).toEqual(['one', 'two']);
  });

  it('skips binary blobs and reports incomplete search', async () => {
    const f = fixture(url => url.pathname.includes('/git/blobs/') ? { data: { size: 3, encoding: 'base64', content: Buffer.from([0, 1, 2]).toString('base64') } } : undefined);
    const provider = await f.connect();
    await expect(provider.readFile('src/customers.ts', 1, 1)).rejects.toMatchObject({ code: 'BINARY_FILE' });
    const search = await provider.searchCode('orders');
    expect(search.items).toEqual([]);
    expect(search.truncated).toBe(true);
  });

  it('rejects oversized files before blob download and oversized read output', async () => {
    const f = fixture(url => url.pathname.includes('/git/trees/') ? { data: { tree: [{ ...fixtureTree().tree[0], size: LIMITS.fileBytes + 1 }], truncated: false } } : undefined);
    const provider = await f.connect();
    await expect(provider.readFile('src/customers.ts', 1, 1)).rejects.toMatchObject({ code: 'FILE_UNAVAILABLE' });
    expect(f.calls.some(url => url.pathname.includes('/git/blobs/'))).toBe(false);
    const long = fixture(url => url.pathname.includes('/git/blobs/') ? { data: { size: 24001, encoding: 'base64', content: Buffer.from('x'.repeat(24001)).toString('base64') } } : undefined);
    await expect((await long.connect()).readFile('src/customers.ts', 1, 1)).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
  });

  it('caps issue comments and text and rejects PRs', async () => {
    const provider = await fixture(url => url.pathname.endsWith('/issues/42') ? { data: { title: 'Issue', body: 'x'.repeat(9000), comments: 100, state: 'open' } }
      : url.pathname.endsWith('/comments') ? { data: Array.from({ length: 21 }, () => ({ body: 'comment' })) } : undefined).connect();
    const issue = await provider.getIssue(42);
    expect(issue.body).toHaveLength(8000);
    expect(issue.comments).toHaveLength(20);
    expect(issue.truncated).toBe(true);
    const pr = await fixture(url => url.pathname.endsWith('/issues/42') ? { data: { pull_request: {} } } : undefined).connect();
    await expect(pr.getIssue(42)).rejects.toMatchObject({ code: 'NOT_AN_ISSUE' });
  });

  it('limits search matches and treats regex syntax literally', () => {
    const index = new Map([['a.ts', Array.from({ length: 40 }, () => 'literal .* marker')]]);
    const result = searchIndex(index, '.*');
    expect(result.matches).toHaveLength(30);
    expect(result.truncated).toBe(true);
    expect(searchIndex(index, '^literal').matches).toHaveLength(0);
  });

  it('bounds indexing and caches repeated searches', async () => {
    const f = fixture(url => url.pathname.includes('/git/trees/') ? { data: { truncated: false, tree: Array.from({ length: 45 }, (_, i) => ({ path: `src/file${String(i).padStart(2, '0')}.ts`, type: 'blob', mode: '100644', sha: BLOB_SHA, size: 100 })) } } : undefined);
    const provider = await f.connect();
    const result = await provider.searchCode('missing');
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(' ')).toContain('40-file');
    const count = f.calls.length;
    await provider.searchCode('orders');
    expect(f.calls).toHaveLength(count);
  });

  it('limits total requests', async () => {
    const provider = await fixture().connect();
    for (let i = 0; i < LIMITS.requests; i++) await provider.getCommits('src/customers.ts');
    await expect(provider.getCommits('src/customers.ts')).rejects.toMatchObject({ code: 'REQUEST_LIMIT' });
  });

  it('rejects unrelated diffs and distinguishes unavailable patches', async () => {
    const provider = await fixture().connect();
    await expect(provider.getFileDiff('f'.repeat(40), 'src/customers.ts')).rejects.toMatchObject({ code: 'UNRELATED_COMMIT' });
    const noPatch = await fixture(url => url.pathname.endsWith(`/commits/${FIXTURE_SHA}`) ? { data: { files: [{ filename: 'src/customers.ts', status: 'modified' }] } } : undefined).connect();
    expect(await noPatch.getFileDiff(FIXTURE_SHA, 'src/customers.ts')).toMatchObject({ patch: null, truncated: true });
  });

  it('paginates changed files within a bounded commit response', async () => {
    const provider = await fixture(url => url.pathname.endsWith(`/commits/${FIXTURE_SHA}`) && url.searchParams.get('page') === '1'
      ? { data: { files: [] }, headers: { link: '<https://api.github.com/example?page=2>; rel="next"' } } : undefined).connect();
    expect((await provider.getFileDiff(FIXTURE_SHA, 'src/customers.ts')).patch).toContain('db.orders');
  });

  it('bounds listings and history and stops diff pagination at three pages', async () => {
    const f = fixture(url => url.pathname.includes('/git/trees/') ? { data: { truncated: false, tree: Array.from({ length: 501 }, (_, i) => ({ ...fixtureTree().tree[0], path: `file${i}.ts` })) } }
      : url.pathname.endsWith('/commits') ? { data: Array.from({ length: 11 }, () => ({ sha: FIXTURE_SHA, commit: { message: 'change' } })) }
      : url.pathname.endsWith(`/commits/${FIXTURE_SHA}`) ? { data: { files: [] }, headers: { link: '<https://api.github.com/example?page=99>; rel="next"' } } : undefined);
    const provider = await f.connect();
    expect(await provider.listFiles()).toMatchObject({ truncated: true, items: expect.arrayContaining(['file0.ts']) });
    expect((await provider.listFiles()).items).toHaveLength(500);
    expect((await provider.getCommits('file0.ts')).items).toHaveLength(10);
    await expect(provider.getFileDiff(FIXTURE_SHA, 'file0.ts')).rejects.toMatchObject({ code: 'DIFF_UNAVAILABLE' });
    expect(f.calls.filter(url => url.pathname.endsWith(`/commits/${FIXTURE_SHA}`))).toHaveLength(3);
  });

  it('enforces index byte limits independently of file count', async () => {
    const provider = await fixture(url => url.pathname.includes('/git/trees/') ? { data: { truncated: false, tree: Array.from({ length: 20 }, (_, i) => ({ ...fixtureTree().tree[0], path: `file${i}.ts`, size: LIMITS.fileBytes })) } } : undefined).connect();
    expect((await provider.searchCode('absent')).warnings.join(' ')).toContain('2 MiB');
  });

  it('sanitizes transport failures and invalid UTF-8', async () => {
    const f = fixture(() => { throw new Error('secret network detail'); });
    await expect(f.connect()).rejects.toMatchObject({ code: 'GITHUB_UNAVAILABLE', message: 'GitHub request failed or timed out. Retry later.' });
    const provider = await fixture(url => url.pathname.includes('/git/blobs/') ? { data: { size: 2, encoding: 'base64', content: Buffer.from([0xc3, 0x28]).toString('base64') } } : undefined).connect();
    await expect(provider.readFile('src/customers.ts', 1, 1)).rejects.toMatchObject({ code: 'BINARY_FILE' });
  });
});
