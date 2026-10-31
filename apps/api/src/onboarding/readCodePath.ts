/** Reads one bounded static source route; imports and type-name matches are not a runtime call graph. */
import { posix } from 'node:path';

import type { Briefing } from '@reposleuth/shared';

import type { SourceFile } from '../github/RepositoryProvider.js';
import { sourceOutline } from '../github/sourceNavigation.js';

const eligible = (path: string) =>
  /\.(?:[cm]?[jt]sx?|cs)$/.test(path) &&
  !/\.d\.ts$|(^|\/)(tests?|__tests__|specs?|obj|bin)(\/|$)|\.(test|spec)\./i.test(path);

export async function readCodePath(
  report: Briefing,
  discovered: string[],
  read: (path: string, start: number) => Promise<SourceFile | undefined>,
): Promise<void> {
  const files = discovered.filter(eligible);
  const declared = report.manifests.flatMap((m) =>
    Object.entries(m.declaredEntries)
      .filter(([kind]) => kind !== 'types')
      .map(([, entry]) => posix.normalize(posix.join(posix.dirname(m.path), entry))),
  );
  const rank = (p: string) =>
    declared.includes(p)
      ? 0
      : /(^|\/)(Program\.cs|main\.[jt]sx?|server\.[jt]s)$/.test(p)
        ? 1
        : /(^|\/)(index\.[jt]sx?|App\.tsx|app\.[jt]s)$/.test(p)
          ? 2
          : 3;
  const entry = [...files]
    .sort(
      (a, b) =>
        rank(a) - rank(b) || a.split('/').length - b.split('/').length || a.localeCompare(b),
    )
    .find((p) => rank(p) < 3);
  report.codeSources = [];
  report.codeConnections = [];
  report.codeCoverage = [
    'Static reading only: imports and type-name candidates do not prove calls, execution order, dependency injection bindings or runtime behavior.',
  ];
  if (!entry) {
    report.codeCoverage.push(
      'No supported entry candidate found. Select a package or consult the documentation; no code flow was invented.',
    );
    return;
  }
  const queue = [
    {
      path: entry,
      reason: declared.includes(entry)
        ? 'Declared entry target; start with its source.'
        : 'Conventional entry filename; verify its role in the source.',
    },
  ];
  const seen = new Set<string>();
  while (queue.length && seen.size < 6) {
    const item = queue.shift()!;
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    const source = await read(item.path, 1);
    if (!source?.lines.length) {
      report.codeCoverage.push(`Source unavailable: ${item.path}.`);
      continue;
    }
    // Keep whole lines so every model-visible range maps to exact retrieved source.
    const lines: typeof source.lines = [];
    let characters = 0;
    for (const line of source.lines.slice(0, 120)) {
      if (characters + line.text.length + 1 > 2400) break;
      lines.push(line);
      characters += line.text.length + 1;
    }
    if (!lines.length) {
      report.codeCoverage.push(`Source line exceeds excerpt allowance: ${item.path}.`);
      continue;
    }
    const text = lines.map((l) => l.text).join('\n');
    const endLine = lines.at(-1)!.line;
    report.filesRead++;
    report.codeSources.push({
      path: item.path,
      startLine: lines[0]!.line,
      endLine,
      text,
      complete: endLine === source.totalLines,
      reason: item.reason,
    });
    if (endLine < source.totalLines)
      report.codeCoverage.push(
        `${item.path}: read through line ${endLine} of ${source.totalLines}; later code is not covered.`,
      );
    const next: typeof queue = [];
    const add = (target: string, line: number, kind: 'relative import' | 'type-name candidate') => {
      if (report.codeConnections!.some((edge) => edge.from === item.path && edge.to === target))
        return;
      report.codeConnections!.push({ from: item.path, to: target, line, kind });
      if (!seen.has(target) && !next.some((q) => q.path === target))
        next.push({
          path: target,
          reason: `Read after ${item.path}:${line}: ${kind}; inspect how the files relate.`,
        });
    };
    if (item.path.endsWith('.cs')) {
      for (const line of lines) {
        // Deliberately conservative lexical candidates; ambiguous filenames are not resolved.
        const names = [...line.text.matchAll(/\b[A-Z]\w+\b/g)].map((m) => m[0]);
        for (const name of new Set(names)) {
          const candidates = files.filter(
            (p) => p !== item.path && posix.basename(p) === `${name}.cs`,
          );
          if (candidates.length === 1) add(candidates[0]!, line.line, 'type-name candidate');
        }
      }
    } else {
      const outline = sourceOutline(report, item.path, text);
      for (const imported of outline.imports) {
        if (!imported.specifier.startsWith('.')) continue;
        const base = posix.normalize(posix.join(posix.dirname(item.path), imported.specifier));
        const stem = base.replace(/\.[cm]?jsx?$/, '');
        const candidates = [
          ...new Set([
            base,
            ...[
              '.ts',
              '.tsx',
              '.js',
              '.jsx',
              '.mts',
              '.cts',
              '/index.ts',
              '/index.tsx',
              '/index.js',
            ].map((ext) => stem + ext),
          ]),
        ].filter((p) => files.includes(p));
        if (candidates.length === 1) add(candidates[0]!, imported.line, 'relative import');
        else
          report.codeCoverage.push(
            `Unresolved or ambiguous import ${imported.specifier} in ${item.path}:${imported.line}.`,
          );
      }
    }
    // Follow this branch before siblings, including targets already waiting in the queue.
    const promoted = new Set(next.map((candidate) => candidate.path));
    queue.splice(
      0,
      queue.length,
      ...next,
      ...queue.filter((candidate) => !promoted.has(candidate.path)),
    );
  }
  if (queue.length)
    report.codeCoverage.push(
      'Stopped after six source reads; further references remain unexplored.',
    );
  const readPaths = new Set(report.codeSources.map((s) => s.path));
  report.codeConnections = report.codeConnections.filter(
    (c) => readPaths.has(c.from) && readPaths.has(c.to),
  );
  report.codeCoverage.push(
    'One entry candidate is sampled depth-first; references from each excerpt take priority over waiting siblings. Other packages, aliases, external dependencies, reflection and dynamic dispatch are not followed.',
  );
}
