/** Exposes bounded, read-only repository tools to the investigating model. */
import { tool } from '@openai/agents';
import { z } from 'zod';

import { directoryScope } from '../github/repositoryIndex.js';
import {
  RepositoryError,
  type RepositoryProvider,
  type SourceFile,
  SourceRangeError,
} from '../github/RepositoryProvider.js';
import { StopError } from './budget.js';
import { listingPage } from './listingPage.js';
import { readRecovery } from './readRecovery.js';

export function createTools(
  repository: RepositoryProvider,
  reads: SourceFile[],
  check: () => void,
  emit: (type: string, data: Record<string, unknown>) => void,
  maxTools: number,
  allowTool?: () => boolean,
  maxOutputBytes: number | (() => number) = 120000,
) {
  const outputByteLimit = () =>
    typeof maxOutputBytes === 'number' ? maxOutputBytes : maxOutputBytes();
  let calls = 0;
  async function invoke(
    name: string,
    action: () => Promise<unknown>,
    details: Record<string, unknown> = {},
  ) {
    check();
    if (allowTool && !allowTool())
      return JSON.stringify({
        error: 'EXPLORATION_COMPLETE',
        message:
          'No further tools in this turn. Use existing results; if exploration has ended, report findings and uncertainties.',
      });
    if (++calls > maxTools) throw new StopError('BUDGET_EXCEEDED_TOOLS');
    emit('tool_started', { name, call: calls, ...details });
    try {
      const value = await action();
      check();
      const output = JSON.stringify(value);
      if (output.length > 30000 || Buffer.byteLength(output) > outputByteLimit()) {
        emit('tool_finished', { name, outcome: 'output_limit' });
        return JSON.stringify({
          error: 'OUTPUT_LIMIT',
          message: 'Result too large. Narrow the request; content was not returned.',
        });
      }
      emit('tool_finished', {
        name,
        outcome:
          typeof value === 'object' &&
          value !== null &&
          'error' in value &&
          value.error === 'OUTPUT_LIMIT'
            ? 'output_limit'
            : 'ok',
      });
      return output;
    } catch (error) {
      if (error instanceof StopError) throw error;
      const recovery =
        error instanceof SourceRangeError
          ? {
              reason: error.reason,
              maxLines: 200,
              ...(error.totalLines === undefined ? {} : { totalLines: error.totalLines }),
              message:
                'Use positive lines with startLine <= endLine and at most 200 requested lines. If totalLines is supplied, startLine must not exceed it.',
            }
          : {};
      emit('tool_finished', {
        name,
        outcome: 'error',
        ...recovery,
        code: error instanceof RepositoryError ? error.code : 'TOOL_FAILED',
      });
      return JSON.stringify({
        error: error instanceof RepositoryError ? error.code : 'TOOL_FAILED',
        ...recovery,
      });
    }
  }
  const scope = z.string().max(1024).nullable().optional();
  const path = z.string().min(1).max(1024);
  return [
    tool({
      name: 'get_issue',
      description: 'Read the issue and bounded comments (live metadata).',
      parameters: z.object({ number: z.number().int().positive() }),
      errorFunction: null,
      execute: ({ number }) => invoke('get_issue', () => repository.getIssue(number)),
    }),
    tool({
      name: 'list_files',
      description:
        'List source paths. Use prefix empty string for repository root, or an exact directory prefix from returned paths. Do not guess a src/ directory. For shortened results, continue with nextOffset as offset and the same prefix.',
      parameters: z.object({
        prefix: z.string().max(1024),
        offset: z.number().int().min(0).max(5000).nullable().optional(),
      }),
      errorFunction: null,
      execute: ({ prefix, offset }) =>
        invoke('list_files', async () =>
          listingPage(
            await repository.listFiles(
              prefix === '.' || prefix === './' ? '' : prefix,
              offset ?? 0,
            ),
            offset ?? 0,
            outputByteLimit(),
          ),
        ),
    }),
    tool({
      name: 'find_files',
      description:
        'Find source paths by case-insensitive filename or path substring, such as a class name seen in source. Set scope to a known package/directory (empty or null for root). Searches that bounded listing; incomplete results are marked. Read a returned path next.',
      parameters: z.object({ query: z.string().min(2).max(200), scope }),
      errorFunction: null,
      execute: ({ query, scope }) =>
        invoke('find_files', async () => {
          const directory = directoryScope(scope ?? '');
          const listing = await repository.listFiles(directory ? `${directory}/` : '');
          const matches = listing.items.filter((path) =>
            path.toLowerCase().includes(query.toLowerCase()),
          );
          return {
            ...listing,
            items: matches.slice(0, 40),
            truncated: listing.truncated || matches.length > 40,
            warnings: [
              ...listing.warnings,
              ...(matches.length > 40 ? ['Matching paths capped at 40; narrow the query.'] : []),
            ],
          };
        }),
    }),
    tool({
      name: 'search_code',
      description:
        'Bounded literal, case-sensitive source search. Set scope to a repository-relative package/directory, empty or null for root. Only that directory is indexed, up to 40 files / 2 MiB. May be incomplete.',
      parameters: z.object({ query: z.string().min(2).max(200), scope }),
      errorFunction: null,
      execute: ({ query, scope }) =>
        invoke('search_code', () => repository.searchCode(query, scope ?? '')),
    }),
    tool({
      name: 'read_file',
      description:
        'Read source and receive a run-scoped evidence handle. Cite that handle and a contained line range; at most 200 requested lines. End beyond EOF is clamped when start is valid; use returned startLine/endLine. Keep each cited excerpt under 4000 characters.',
      parameters: z.object({
        path,
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      }),
      errorFunction: null,
      execute: ({ path, startLine, endLine }) =>
        invoke(
          'read_file',
          async () => {
            const file = await repository.readFile(path, startLine, endLine);
            const result = { ...file, evidenceHandle: `read-${reads.length + 1}` };
            // Register only content actually returned to the model, including handle overhead.
            if (
              JSON.stringify(result).length <= 30000 &&
              Buffer.byteLength(JSON.stringify(result)) <= outputByteLimit()
            ) {
              check();
              reads.push(file);
              emit('source_read', {
                path: file.path,
                commitSha: file.commitSha,
                startLine: file.startLine,
                endLine: file.endLine,
                handle: result.evidenceHandle,
              });
            } else {
              return readRecovery(file, result.evidenceHandle, outputByteLimit());
            }
            return result;
          },
          { path, startLine, endLine },
        ),
    }),
    tool({
      name: 'get_commits',
      description: 'Recent file history anchored to the pinned commit.',
      parameters: z.object({ path }),
      errorFunction: null,
      execute: ({ path }) => invoke('get_commits', () => repository.getCommits(path)),
    }),
    tool({
      name: 'get_file_diff',
      description: 'Historical patch for a commit returned by get_commits. Not source evidence.',
      parameters: z.object({ commitSha: z.string().regex(/^[a-f0-9]{40}$/), path }),
      errorFunction: null,
      execute: ({ commitSha, path }) =>
        invoke('get_file_diff', () => repository.getFileDiff(commitSha, path)),
    }),
  ];
}
