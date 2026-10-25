/** Verifies legacy migration, full-text search, updates, filtering, and stable history pagination. */
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { historyQuerySchema } from '@reposleuth/shared';
import { InvestigationStore } from '../../../src/storage/sqlite.js';
import { savedInvestigation } from '../../fixtures/savedInvestigation.js';

const stores: InvestigationStore[] = [];
const directories: string[] = [];
function create(path = ':memory:') {
  const store = new InvestigationStore(path);
  stores.push(store);
  return store;
}
const query = (input = {}) => historyQuerySchema.parse(input);
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

describe('investigation history storage', () => {
  it('migrates existing records and keeps search synchronized across saves and reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'reposleuth-history-'));
    directories.push(directory);
    const path = join(directory, 'legacy.sqlite');
    const legacy = new DatabaseSync(path);
    legacy.exec('CREATE TABLE investigations (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    legacy
      .prepare('INSERT INTO investigations VALUES (?, ?)')
      .run('saved-run', JSON.stringify(savedInvestigation()));
    legacy.close();
    const store = create(path);
    for (const q of ['endpoint', 'database', 'lookups', 'src/customers.ts']) {
      expect(store.list(query({ q })).items.map((item) => item.id)).toEqual(['saved-run']);
    }
    expect(store.list(query({ q: 'database endpoint' })).total).toBe(1);
    store.save(savedInvestigation({ report: null, status: 'failed' }));
    expect(store.list(query({ q: 'database' })).total).toBe(0);
    expect(store.list(query({ q: 'endpoint' })).total).toBe(1);
    stores.pop()!.close();
    const reopened = create(path);
    expect(reopened.list(query()).total).toBe(1);
    expect(reopened.list(query({ q: 'database' })).total).toBe(0);
  });
  it('combines filters and paginates in deterministic newest-first order', () => {
    const store = create();
    store.save(savedInvestigation({ id: 'a' }));
    store.save(savedInvestigation({ id: 'b' }));
    store.save(
      savedInvestigation({
        id: 'c',
        status: 'failed',
        report: null,
        model: 'other',
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
    );
    store.save(
      savedInvestigation({
        id: 'd',
        request: { repository: 'another/repo', question: 'Investigate endpoint', issueNumber: 43 },
      }),
    );
    expect(store.list(query({ limit: 2 })).items.map((item) => item.id)).toEqual(['c', 'd']);
    expect(store.list(query({ limit: 2, offset: 2 })).items.map((item) => item.id)).toEqual([
      'b',
      'a',
    ]);
    const filtered = store.list(
      query({
        repository: 'OWNER/REPO',
        issueNumber: 42,
        model: 'test-model',
        status: 'completed',
        q: 'database',
      }),
    );
    expect(filtered.total).toBe(2);
    expect(filtered.items.map((item) => item.id)).toEqual(['b', 'a']);
    expect(store.list(query({ issueNumber: 43 })).items.map((item) => item.id)).toEqual(['d']);
    expect(store.list(query({ model: 'other', status: 'failed' })).items[0]?.hasReport).toBe(false);
    expect(store.list(query({ offset: 20 })).items).toEqual([]);
  });
  it('treats SQL and FTS operators as literal input and handles punctuation safely', () => {
    const store = create();
    store.save(savedInvestigation());
    for (const q of ['"', '*', '()', 'endpoint OR missing', "' OR 1=1 --", 'NEAR(endpoint)']) {
      expect(store.list(query({ q })).total).toBe(0);
    }
    expect(store.list(query()).total).toBe(1);
  });
});
