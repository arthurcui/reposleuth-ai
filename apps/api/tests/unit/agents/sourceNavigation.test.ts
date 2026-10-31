/** Exercises syntax navigation and bounded evidence delivery without repository execution. */
import { RunContext } from '@openai/agents';
import { expect, it } from 'vitest';

import { createTools } from '../../../src/agents/tools.js';
import type { SourceFile } from '../../../src/github/RepositoryProvider.js';
import { sourceOutline } from '../../../src/github/sourceNavigation.js';
import { fakeRepository } from '../../fixtures/agentFixtures.js';
const revision = fakeRepository().revision;
it('reads around a late call inside a large definition without fetching its prefix', async () => {
  const repo = fakeRepository();
  const lines = [
    'export function render() {',
    ...Array.from({ length: 230 }, () => '  // setup'),
    '  return createResource(fetcher);',
    '}',
  ];
  repo.outlineFile = async (path, query) => sourceOutline(revision, path, lines.join('\n'), query);
  const requested: number[] = [];
  repo.readFile = async (path, startLine, endLine) => {
    requested.push(startLine);
    return {
      ...revision,
      path,
      startLine,
      endLine,
      totalLines: lines.length,
      lines: lines.slice(startLine - 1, endLine).map((text, i) => ({ line: startLine + i, text })),
    };
  };
  const reads: SourceFile[] = [];
  const tool = createTools(
    repo,
    reads,
    () => {},
    () => {},
    5,
  ).find((t) => t.name === 'read_definition')!;
  const value = JSON.parse(
    String(
      await tool.invoke(
        new RunContext(),
        JSON.stringify({ path: 'adapter.ts', name: 'render', focus: 'createResource' }),
      ),
    ),
  );
  expect(requested).toEqual([224]);
  expect(value.startLine).toBe(224);
  expect(value.definitionStartLine).toBe(1);
  expect(value.definitionEndLine).toBe(233);
  expect(reads[0]!.lines.some((l) => l.line === 232 && l.text.includes('createResource'))).toBe(
    true,
  );
});
it('does not choose arbitrarily between repeated focus call sites', async () => {
  const repo = fakeRepository();
  repo.outlineFile = async (path, query) =>
    sourceOutline(revision, path, 'function run() { load(); load(); }', query);
  const reads: SourceFile[] = [];
  const tool = createTools(
    repo,
    reads,
    () => {},
    () => {},
    5,
  ).find((t) => t.name === 'read_definition')!;
  const result = JSON.parse(
    String(
      await tool.invoke(
        new RunContext(),
        JSON.stringify({ path: 'file.ts', name: 'run', focus: 'load' }),
      ),
    ),
  );
  expect(result.error).toBe('AMBIGUOUS_FOCUS');
  expect(reads).toHaveLength(0);
});
it('never redirects a declaration into a sibling scope starting on the same line', async () => {
  const repo = fakeRepository();
  repo.outlineFile = async (path, query) =>
    sourceOutline(
      revision,
      path,
      'declare namespace A { function load(): void; } namespace B {\nexport function load() {}\n}',
      query,
    );
  const reads: SourceFile[] = [];
  const tool = createTools(
    repo,
    reads,
    () => {},
    () => {},
    5,
  ).find((t) => t.name === 'read_definition')!;
  const result = JSON.parse(
    String(
      await tool.invoke(
        new RunContext(),
        JSON.stringify({ path: 'file.ts', name: 'load', startLine: 1 }),
      ),
    ),
  );
  expect(result.error).toBe('IMPLEMENTATION_NOT_FOUND');
  expect(reads).toHaveLength(0);
});
it('recognizes JavaScript getter implementations and static function properties', () => {
  const outline = sourceOutline(
    revision,
    'request.js',
    `
defineGetter(req, 'subdomains', function subdomains() { return this.hostname.split('.'); });
req.load = function () { return database.read(); };
const handlers = { save: () => store.write() };
class Request { get hostname() { return this.host; } }
`,
  );
  for (const name of ['subdomains', 'load', 'save', 'hostname'])
    expect(outline.definitions.find((d) => d.name === name)?.implementation).toBe(true);
});
it('keeps declarations distinguishable from bodies and same-named implementations ambiguous', async () => {
  const repo = fakeRepository();
  repo.outlineFile = async (path, query) =>
    sourceOutline(
      revision,
      path,
      'class A { load(): void {} }\nclass B { load(): void {} }\ninterface C { load(): void }',
      query,
    );
  const reads: SourceFile[] = [];
  const tool = createTools(
    repo,
    reads,
    () => {},
    () => {},
    5,
  ).find((t) => t.name === 'read_definition')!;
  const result = JSON.parse(
    String(await tool.invoke(new RunContext(), JSON.stringify({ path: 'file.ts', name: 'load' }))),
  );
  expect(result.error).toBe('AMBIGUOUS_DEFINITION');
  expect(reads).toHaveLength(0);
});
it('finds late TS definitions, TSX components and imports without interpreting strings as code', () => {
  const source =
    Array.from({ length: 90 }, (_, i) => `function f${i}() { return ${i}; }`).join('\n') +
    "\nimport {x} from './other.js';\nexport const View = () => <div>text</div>;\nconst decoy = 'function fake() {}';";
  const outline = sourceOutline(revision, 'file.tsx', source);
  expect(outline.truncated).toBe(true);
  expect(outline.imports[0]?.specifier).toBe('./other.js');
  expect(sourceOutline(revision, 'file.tsx', source, 'View').definitions).toEqual([
    expect.objectContaining({ name: 'View', startLine: 92 }),
  ]);
  expect(sourceOutline(revision, 'file.tsx', source, 'fake').definitions).toEqual([]);
});
it('marks unsupported, malformed and C# fallback results honestly', () => {
  expect(sourceOutline(revision, 'file.py', 'def x(): pass').parser).toBe('unsupported');
  expect(sourceOutline(revision, 'file.ts', 'function x( {').warnings.join(' ')).toContain(
    'Parse errors',
  );
  const outline = sourceOutline(revision, 'Service.cs', 'public Task Load() { return null; }');
  expect(outline.parser).toBe('lexical');
  expect(outline.definitions[0]).toMatchObject({ name: 'Load', startLine: 1, endLine: 1 });
});
it('prefers an implementation over overload declarations and returns fitted evidence', async () => {
  const repo = fakeRepository();
  const source =
    'function load(x: string): void;\nfunction load(x: number): void;\nfunction load(x: unknown) {\n' +
    Array.from({ length: 20 }, () => "  const text = '" + 'é'.repeat(60) + "';").join('\n') +
    '\n}';
  const lines = source.split('\n');
  repo.outlineFile = async (path, query) => sourceOutline(revision, path, source, query);
  repo.readFile = async (path, startLine, endLine) => ({
    ...revision,
    path,
    startLine,
    endLine: Math.min(endLine, lines.length),
    totalLines: lines.length,
    lines: lines.slice(startLine - 1, endLine).map((text, i) => ({ line: startLine + i, text })),
  });
  const reads: SourceFile[] = [];
  const tool = createTools(
    repo,
    reads,
    () => {},
    () => {},
    5,
    undefined,
    1024,
  ).find((t) => t.name === 'read_definition')!;
  const invoke = (startLine?: number) =>
    tool.invoke(new RunContext(), JSON.stringify({ path: 'file.ts', name: 'load', startLine }));
  expect(JSON.parse(String(await invoke())).startLine).toBe(3);
  expect(reads).toHaveLength(1);
  const result = String(await invoke(1));
  expect(Buffer.byteLength(result)).toBeLessThanOrEqual(1024);
  const parsed = JSON.parse(result);
  expect(parsed.startLine).toBe(3);
  expect(parsed.resolvedFromDeclaration).toBe(true);
  expect(parsed.nextStartLine).toBe(parsed.endLine + 1);
  expect(parsed.endLine).toBeLessThan(lines.length);
  expect(reads[0]!.lines.map((l) => l.text)).toEqual(lines.slice(2, parsed.endLine));
});

it('finds a late call site without pretending it is the called implementation', () => {
  const source =
    '// header\n'.repeat(230) +
    'export function render() {\n  return createResource(() => enabled(), fetcher);\n}';
  const outline = sourceOutline(revision, 'adapter.ts', source, 'createResource');
  expect(outline.definitions).toEqual([]);
  expect(outline.calls).toEqual([{ name: 'createResource', line: 232 }]);
  expect(outline.warnings.join(' ')).toContain('not resolved');
});
