/** Exercises onboarding through HTTP, persistence, pinned source facts and unsupported-input boundaries. */
import { briefingSchema } from '@reposleuth/shared';
import { expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { BriefingService } from '../../src/onboarding/BriefingService.js';
import { fakeRepository } from '../fixtures/agentFixtures.js';

function repository() {
  const repo = fakeRepository();
  const files: Record<string, string> = {
    'README.md': '# Example\n<script>alert(1)</script>\nRun the declared scripts.',
    'package.json': JSON.stringify(
      {
        name: 'root',
        scripts: { test: 'vitest run' },
        engines: { node: '>=22' },
        dependencies: { react: '19' },
        main: 'src/index.ts',
      },
      null,
      2,
    ),
    'src/index.ts': 'export const value = 1;',
    'tests/index.test.ts': 'test placeholder',
    'packages/web/package.json': JSON.stringify({ name: 'web', scripts: { build: 'vite build' } }),
    'packages/web/src/main.tsx': 'export const App = () => null;',
    'packages/web-extra/package.json': JSON.stringify({ name: 'wrong-neighbor' }),
  };
  repo.listFiles = vi.fn(async (prefix = '', offset = 0) => {
    const paths = Object.keys(files).filter((p) => p.startsWith(prefix));
    return {
      ...repo.revision,
      items: paths.slice(offset, offset + 2),
      nextOffset: offset + 2 < paths.length ? offset + 2 : null,
      truncated: offset + 2 < paths.length,
      warnings: [],
    };
  });
  repo.readFile = vi.fn(async (path, start, end) => {
    const lines = files[path]!.split('\n');
    return {
      ...repo.revision,
      path,
      startLine: start,
      endLine: Math.min(end, lines.length),
      totalLines: lines.length,
      lines: lines.slice(start - 1, end).map((text, index) => ({ line: start + index, text })),
    };
  });
  return repo;
}
it('builds, reopens, searches and exports a briefing with declarations traced to pinned source', async () => {
  const repo = repository();
  const service = new BriefingService(':memory:', async () => repo);
  const app = buildApp(undefined, { briefings: service });
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/briefings',
      payload: { repository: 'https://github.com/owner/repo' },
    });
    expect(created.statusCode).toBe(202);
    const run = briefingSchema.parse(created.json());
    await vi.waitFor(() => expect(service.get(run.id)?.status).toBe('completed'));
    const report = briefingSchema.parse((await app.inject(`/api/briefings/${run.id}`)).json());
    expect(report.filesDiscovered).toBe(7);
    expect(report.manifests[0]?.scripts.test).toBe('vitest run');
    expect(report.readingOrder.some((r) => r.path === 'src/index.ts')).toBe(true);
    expect(report.documents[0]?.text).toContain('<script>');
    expect(report.commitSha).toBe(repo.revision.commitSha);
    expect((await app.inject('/api/briefings?q=owner')).json()).toHaveLength(1);
    expect((await app.inject('/api/briefings?q=missing')).json()).toHaveLength(0);
    const markdown = await app.inject(`/api/briefings/${run.id}/markdown`);
    expect(markdown.body).toContain('vitest run');
    expect(markdown.body).toContain(`/blob/${repo.revision.commitSha}/package.json#L1`);
    expect(markdown.body).not.toContain('<script>');
    expect(markdown.headers['content-disposition']).toContain('onboarding-briefing.md');
  } finally {
    await app.close();
  }
});
it('keeps package scope separate from similarly named neighbors and rejects traversal', async () => {
  const repo = repository();
  const service = new BriefingService(':memory:', async () => repo);
  const app = buildApp(undefined, { briefings: service });
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/briefings',
          payload: { repository: 'owner/repo', scope: '../private' },
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({
      method: 'POST',
      url: '/api/briefings',
      payload: { repository: 'owner/repo', scope: 'packages/web' },
    });
    const run = briefingSchema.parse(response.json());
    await vi.waitFor(() => expect(service.get(run.id)?.status).toBe('completed'));
    expect(service.get(run.id)?.manifests.map((m) => m.name)).toEqual(['web']);
    expect(service.get(run.id)?.filesDiscovered).toBe(2);
  } finally {
    await app.close();
  }
});
it('limits concurrent jobs and preserves safe failure messages', async () => {
  let finish: (value: ReturnType<typeof fakeRepository>) => void = () => {};
  const service = new BriefingService(
    ':memory:',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const run = service.start({ repository: 'owner/repo', scope: '', explain: false });
  expect(() => service.start({ repository: 'owner/repo', scope: '', explain: false })).toThrow(
    'already running',
  );
  const repo = repository();
  repo.listFiles = () => Promise.reject(new Error('private provider payload'));
  finish(repo);
  await vi.waitFor(() => expect(service.get(run.id)?.status).toBe('failed'));
  expect(service.get(run.id)?.error).not.toContain('private provider payload');
  await service.close();
});
