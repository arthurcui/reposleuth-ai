import { tool } from '@openai/agents';
import { z } from 'zod';
import { RepositoryError, type RepositoryProvider, type SourceFile } from '../github/RepositoryProvider.js';
import { StopError } from './budget.js';

export function createTools(repository: RepositoryProvider, reads: SourceFile[], check: () => void,
  emit: (type: string, data: Record<string, unknown>) => void, maxTools: number) {
  let calls = 0;
  async function invoke(name: string, action: () => Promise<unknown>) {
    check();
    if (++calls > maxTools) throw new StopError('BUDGET_EXCEEDED');
    emit('tool_started', { name, call: calls });
    try {
      const value = await action();
      check();
      const output = JSON.stringify(value);
      if (output.length > 30000) {
        emit('tool_finished', { name, outcome: 'output_limit' });
        return JSON.stringify({ error: 'OUTPUT_LIMIT', message: 'Result too large. Narrow the request; content was not returned.' });
      }
      emit('tool_finished', { name, outcome: 'ok' });
      return output;
    } catch (error) {
      if (error instanceof StopError) throw error;
      emit('tool_finished', { name, outcome: 'error', code: error instanceof RepositoryError ? error.code : 'TOOL_FAILED' });
      return JSON.stringify({ error: error instanceof RepositoryError ? error.code : 'TOOL_FAILED' });
    }
  }
  const path = z.string().min(1).max(1024);
  return [
    tool({ name: 'get_issue', description: 'Read the issue and bounded comments (live metadata).', parameters: z.object({ number: z.number().int().positive() }), errorFunction: null,
      execute: ({ number }) => invoke('get_issue', () => repository.getIssue(number)) }),
    tool({ name: 'list_files', description: 'List eligible source paths at the pinned commit; narrow with a prefix.', parameters: z.object({ prefix: z.string().max(1024) }), errorFunction: null,
      execute: ({ prefix }) => invoke('list_files', () => repository.listFiles(prefix)) }),
    tool({ name: 'search_code', description: 'Bounded literal, case-sensitive source search. May be incomplete.', parameters: z.object({ query: z.string().min(2).max(200) }), errorFunction: null,
      execute: ({ query }) => invoke('search_code', () => repository.searchCode(query)) }),
    tool({ name: 'read_file', description: 'Retrieve exact source lines for evidence; at most 200 lines.', parameters: z.object({ path, startLine: z.number().int().positive(), endLine: z.number().int().positive() }), errorFunction: null,
      execute: ({ path, startLine, endLine }) => invoke('read_file', async () => { const file = await repository.readFile(path, startLine, endLine); if (JSON.stringify(file).length <= 30000) reads.push(file); return file; }) }),
    tool({ name: 'get_commits', description: 'Recent file history anchored to the pinned commit.', parameters: z.object({ path }), errorFunction: null,
      execute: ({ path }) => invoke('get_commits', () => repository.getCommits(path)) }),
    tool({ name: 'get_file_diff', description: 'Historical patch for a commit returned by get_commits. Not source evidence.', parameters: z.object({ commitSha: z.string().regex(/^[a-f0-9]{40}$/), path }), errorFunction: null,
      execute: ({ commitSha, path }) => invoke('get_file_diff', () => repository.getFileDiff(commitSha, path)) }),
  ];
}
