/** Exposes bounded, read-only repository tools to the investigating model. */
import { tool } from '@openai/agents';
import { z } from 'zod';

import {
  RepositoryError,
  type RepositoryProvider,
  type SourceFile,
  SourceRangeError,
} from '../github/RepositoryProvider.js';
import { StopError } from './budget.js';
import { listingPage } from './listingPage.js';
import { sourceWindow } from './sourceWindow.js';
import { type WorkingContext, workingPlanSchema } from './workingContext.js';

export function createTools(
  repository: RepositoryProvider,
  reads: SourceFile[],
  check: () => void,
  emit: (type: string, data: Record<string, unknown>) => void,
  maxTools: number,
  allowTool?: () => boolean,
  maxOutputBytes: number | (() => number) = 120000,
  preflightIssueNumber?: number,
  working?: WorkingContext,
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
    emit('tool_started', { ...details, name, call: calls });
    try {
      const value = await action();
      check();
      const output = JSON.stringify(value);
      if (output.length > 30000 || Buffer.byteLength(output) > outputByteLimit()) {
        emit('tool_finished', { name, outcome: 'output_limit' });
        const withheld = JSON.stringify({
          error: 'OUTPUT_LIMIT',
          message: 'Result too large. Narrow the request; content was not returned.',
        });
        working?.record(name, withheld);
        return withheld;
      }
      const resultError = typeof value === 'object' && value !== null && 'error' in value;
      emit('tool_finished', {
        name,
        outcome: resultError ? (value.error === 'OUTPUT_LIMIT' ? 'output_limit' : 'error') : 'ok',
      });
      working?.record(name, output, details);
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
      const output = JSON.stringify({
        error: error instanceof RepositoryError ? error.code : 'TOOL_FAILED',
        ...recovery,
      });
      working?.record(name, output);
      return output;
    }
  }
  let readQueue: Promise<unknown> = Promise.resolve();
  function readWindow(
    path: string,
    startLine: number,
    endLine: number,
    metadata: Record<string, unknown> = {},
  ) {
    const pending = readQueue.then(async () => {
      const handle = `read-${reads.length + 1}`;
      const window = await sourceWindow(
        repository,
        path,
        startLine,
        endLine,
        handle,
        outputByteLimit(),
        check,
        metadata,
      );
      if (!window)
        return {
          error: 'OUTPUT_LIMIT',
          message:
            'One whole source line cannot fit the quote/output allowance. Choose another range; no evidence was registered.',
        };
      reads.push(window.file);
      emit('source_read', {
        path: window.file.path,
        commitSha: window.file.commitSha,
        startLine: window.file.startLine,
        endLine: window.file.endLine,
        handle,
      });
      return window.value;
    });
    readQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
  const scope = z.string().max(1024).nullable().optional();
  const path = z.string().min(1).max(1024);
  return [
    tool({
      name: 'get_issue',
      description: 'Read the issue and bounded comments (live metadata).',
      parameters: z.object({ number: z.number().int().positive() }),
      errorFunction: null,
      execute: ({ number }) =>
        invoke('get_issue', async () => {
          if (number === preflightIssueNumber)
            return {
              number,
              status: 'ALREADY_PROVIDED',
              message:
                'This issue is already supplied as preflightIssue in the investigation input. Use that data and read relevant source next.',
            };
          return repository.getIssue(number);
        }),
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
        invoke(
          'list_files',
          async () =>
            listingPage(
              await repository.listFiles(
                prefix === '.' || prefix === './' ? '' : prefix,
                offset ?? 0,
              ),
              offset ?? 0,
              outputByteLimit(),
            ),
          { prefix, offset: offset ?? 0 },
        ),
    }),
    tool({
      name: 'find_files',
      description:
        'Find source paths by case-insensitive filename or path substring, such as a class name seen in source. Set scope to a known package/directory (empty or null for root). Searches all eligible paths in the bounded tree (up to 5000) before returning at most 40 matches; incomplete results are marked. Read a returned path next.',
      parameters: z.object({ query: z.string().min(2).max(200), scope }),
      errorFunction: null,
      execute: ({ query, scope }) =>
        invoke('find_files', () => repository.findFiles(query, scope ?? ''), {
          query,
          scope: scope ?? '',
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
        'Read an exact source window and receive an evidence handle. Oversized requests are shortened automatically to at most 200 lines and 4000 quote characters, within budget. Cite returned startLine/endLine, never requested bounds. Continue from nextStartLine when non-null.',
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
            return readWindow(path, startLine, endLine);
          },
          { path, startLine, endLine },
        ),
    }),
    tool({
      name: 'outline_file',
      description:
        'Bounded declaration/import/call-site locations; not evidence. Optional query filters names before caps. Calls are syntax sites, not resolved references. TS/JS uses syntax parsing; C# is labeled lexical. Follow imports to implementations. Use read_definition or read_file for evidence.',
      parameters: z.object({ path, query: z.string().max(120).nullable().optional() }),
      errorFunction: null,
      execute: ({ path, query }) =>
        invoke('outline_file', () => repository.outlineFile(path, query ?? '')),
    }),
    tool({
      name: 'read_definition',
      description:
        'Read a named TS/JS implementation. Optional focus selects a matching call inside that body (for example a callee seen in an outline), instead of repeatedly reading its beginning. Specify startLine for duplicate implementations. Returns exact evidence and continuation; C# anchors require read_file.',
      parameters: z.object({
        path,
        name: z.string().min(1).max(120),
        startLine: z.number().int().positive().nullable().optional(),
        focus: z.string().min(1).max(120).nullable().optional(),
      }),
      errorFunction: null,
      execute: ({ path, name, startLine, focus }) =>
        invoke(
          'read_definition',
          async () => {
            const outline = await repository.outlineFile(path, name);
            if (outline.parser !== 'typescript')
              return {
                error: 'UNSUPPORTED_DEFINITION',
                message: 'Use read_file around an outline anchor.',
              };
            const named = outline.definitions.filter((d) => d.name === name);
            const selected =
              startLine == null ? named : named.filter((d) => d.startLine === startLine);
            const implementations = named.filter(
              (d) =>
                d.implementation &&
                (startLine == null ||
                  selected.some((s) => s.scopeStartOffset === d.scopeStartOffset)),
            );
            const matches = selected.some((d) => d.implementation)
              ? selected.filter((d) => d.implementation)
              : implementations;
            if (matches.length !== 1)
              return {
                error: matches.length ? 'AMBIGUOUS_DEFINITION' : 'IMPLEMENTATION_NOT_FOUND',
                candidates: matches.length ? matches : selected,
                message:
                  'Choose an implementation startLine or use outline/search. Declarations are not executable bodies.',
              };
            const definition = matches[0]!;
            let from = definition.startLine;
            let to = definition.endLine;
            if (focus) {
              const focused = await repository.outlineFile(path, focus);
              const locations = focused.calls.filter(
                (call) => call.line >= definition.startLine && call.line <= definition.endLine,
              );
              if (locations.length !== 1)
                return {
                  error: locations.length ? 'AMBIGUOUS_FOCUS' : 'FOCUS_NOT_FOUND',
                  candidates: locations,
                  truncated: focused.truncated,
                  message:
                    'Choose a returned location with read_file, or a more specific focus. No source was read.',
                };
              from = Math.max(definition.startLine, locations[0]!.line - 8);
              to = Math.min(definition.endLine, locations[0]!.line + 50);
            }
            return readWindow(path, from, to, {
              definitionStartLine: definition.startLine,
              definitionEndLine: definition.endLine,
              resolvedFromDeclaration: startLine != null && startLine !== definition.startLine,
            });
          },
          { path, name },
        ),
    }),
    ...(working
      ? [
          tool({
            name: 'update_plan',
            description:
              'Record compact unverified hypotheses, source handles, missing evidence and next paths. Preserve gaps; do not record private chain-of-thought. Use after meaningful source progress, not every turn.',
            parameters: workingPlanSchema,
            errorFunction: null,
            execute: (plan) => invoke('update_plan', async () => working.update(plan)),
          }),
        ]
      : []),
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
