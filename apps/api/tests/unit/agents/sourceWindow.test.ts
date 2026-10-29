/** Replays oversized reads, provider limits, continuation and concurrent handle allocation offline. */
import { RunContext } from '@openai/agents';
import { expect, it, vi } from 'vitest';

import { createTools } from '../../../src/agents/tools.js';
import { RepositoryError, type SourceFile } from '../../../src/github/RepositoryProvider.js';
import { materializeEvidence } from '../../../src/services/evidenceHandles.js';
import { fakeRepository, validReport } from '../../fixtures/agentFixtures.js';

function fixture(text = 'const value = 123;', count = 300) {
  const repo = fakeRepository();
  repo.readFile = vi.fn(async (path, startLine, endLine) => {
    if (endLine - startLine >= 200) throw new Error('Provider limit bypassed');
    return {
      ...repo.revision,
      path,
      startLine,
      endLine: Math.min(endLine, count),
      totalLines: count,
      lines: Array.from(
        { length: Math.max(0, Math.min(endLine, count) - startLine + 1) },
        (_, i) => ({ line: startLine + i, text }),
      ),
    };
  });
  const reads: SourceFile[] = [];
  const read = createTools(
    repo,
    reads,
    () => {},
    () => {},
    24,
    undefined,
    8000,
  ).find((t) => t.name === 'read_file')!;
  const invoke = async (startLine: number, endLine: number) =>
    JSON.parse(
      String(
        await read.invoke(
          new RunContext(),
          JSON.stringify({ path: 'src/customers.ts', startLine, endLine }),
        ),
      ),
    );
  return { repo, reads, invoke };
}
it('normalizes a 260-line request and continues without gaps or invented evidence', async () => {
  const { repo, reads, invoke } = fixture();
  const first = await invoke(1, 260);
  expect(first.startLine).toBe(1);
  expect(first.endLine).toBeLessThanOrEqual(200);
  expect(first.nextStartLine).toBe(first.endLine + 1);
  const second = await invoke(first.nextStartLine, 260);
  expect(second.startLine).toBe(first.endLine + 1);
  expect(second.endLine).toBe(260);
  expect(second.nextStartLine).toBeNull();
  const report = materializeEvidence(
    {
      ...validReport(),
      evidence: [{ id: 'e1', handle: first.evidenceHandle, startLine: null, endLine: null }],
    },
    repo.revision,
    reads,
  );
  expect(report.evidence[0]!.quote).toBe(
    first.lines.map((l: { text: string }) => l.text).join('\n'),
  );
});
it('fits every returned window within the quote limit even with a large output allowance', async () => {
  const { invoke } = fixture('é'.repeat(100), 140);
  const value = await invoke(1, 140);
  expect(value.lines.map((l: { text: string }) => l.text).join('\n').length).toBeLessThanOrEqual(
    4000,
  );
  expect(value.nextStartLine).toBeLessThan(140);
  expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(8000);
});
it('retries bounded provider output limits within the same tool invocation', async () => {
  const { repo, invoke } = fixture();
  const original = repo.readFile;
  repo.readFile = vi.fn(async (path, start, end) => {
    if (end - start > 20) throw new RepositoryError('OUTPUT_LIMIT', 'too much');
    return original(path, start, end);
  });
  const value = await invoke(1, 260);
  expect(value.evidenceHandle).toBe('read-1');
  expect(value.nextStartLine).toBe(value.endLine + 1);
  expect(vi.mocked(repo.readFile).mock.calls.length).toBeLessThanOrEqual(9);
});
it('does not retry access failures or register oversized single lines', async () => {
  const { repo, reads, invoke } = fixture('x'.repeat(4001));
  expect((await invoke(1, 1)).error).toBe('OUTPUT_LIMIT');
  expect(reads).toHaveLength(0);
  repo.readFile = vi.fn(async () => {
    throw new RepositoryError('NOT_FOUND', 'missing');
  });
  expect((await invoke(1, 260)).error).toBe('NOT_FOUND');
  expect(repo.readFile).toHaveBeenCalledTimes(1);
});
it('allocates distinct evidence handles for concurrent source calls', async () => {
  const { reads, invoke } = fixture();
  const values = await Promise.all([invoke(1, 10), invoke(11, 20)]);
  expect(values.map((v) => v.evidenceHandle)).toEqual(['read-1', 'read-2']);
  expect(reads.map((r) => r.startLine)).toEqual([1, 11]);
});
