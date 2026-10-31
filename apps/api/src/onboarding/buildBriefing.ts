/** Builds a bounded repository inventory; explanatory labels come from deterministic rules, not model guesses. */
import { posix } from 'node:path';

import type { Briefing } from '@reposleuth/shared';
import { z } from 'zod';

import type { RepositoryProvider, SourceFile } from '../github/RepositoryProvider.js';

const manifestSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  engines: z.record(z.string(), z.string()).optional(),
  packageManager: z.string().optional(),
  main: z.string().optional(),
  module: z.string().optional(),
  types: z.string().optional(),
});
const languages: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.cs': 'C#',
  '.py': 'Python',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.css': 'CSS',
  '.html': 'HTML',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
};
const testPath = /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i;

export async function buildBriefing(
  repository: RepositoryProvider,
  initial: Briefing,
  check: () => void,
): Promise<Briefing> {
  const result = {
    ...initial,
    repository: repository.revision.repository,
    commitSha: repository.revision.commitSha,
  };
  const warnings = new Set(initial.limitations);
  const files: string[] = [];
  let offset: number | null = 0;
  for (let page = 0; page < 10 && offset !== null; page++) {
    check();
    const listed = await repository.listFiles(initial.scope ? `${initial.scope}/` : '', offset);
    files.push(...listed.items);
    listed.warnings
      .filter((w) => !w.startsWith('File listing capped at'))
      .forEach((w) => warnings.add(w));
    if (listed.nextOffset != null && listed.nextOffset <= offset) {
      warnings.add('Repository pagination did not advance; discovery stopped.');
      break;
    }
    offset = listed.nextOffset ?? null;
    if (listed.truncated && offset === null)
      warnings.add('Repository discovery is incomplete; counts describe only discovered files.');
  }
  if (offset !== null) warnings.add('Discovery stopped after ten pages.');
  const unique = [...new Set(files)].sort();
  result.filesDiscovered = unique.length;
  if (!unique.length)
    warnings.add('No eligible files were discovered in this scope. Check the directory path.');
  const counts = new Map<string, number>();
  const folders = new Map<string, number>();
  for (const file of unique) {
    const language = languages[posix.extname(file)];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
    const relative = initial.scope ? file.slice(initial.scope.length + 1) : file;
    const directory = relative.includes('/') ? relative.split('/')[0]! : '(root files)';
    folders.set(directory, (folders.get(directory) ?? 0) + 1);
  }
  result.languages = [...counts]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files);
  result.directories = [...folders].map(([path, files]) => ({ path, files })).slice(0, 60);
  if (folders.size > 60) warnings.add('Directory map shows the first 60 folders.');
  const manifests = unique
    .filter((p) => posix.basename(p) === 'package.json')
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  result.packages = manifests
    .map((p) => (posix.dirname(p) === '.' ? '' : posix.dirname(p)))
    .slice(0, 100);
  const docs = unique
    .filter((p) => /^(readme|contributing)(\.[^.]+)?$/i.test(posix.basename(p)))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  let readCalls = 0;
  const read = async (path: string, start: number): Promise<SourceFile | undefined> => {
    check();
    if (++readCalls > 24) {
      warnings.add('Source reading allowance exhausted.');
      return;
    }
    try {
      const source = await repository.readFile(path, start, start + 199);
      check();
      return source;
    } catch {
      check();
      warnings.add(`Could not read ${path}; it is not used for extracted facts.`);
      return;
    }
  };
  for (const path of docs.slice(0, 2)) {
    const source = await read(path, 1);
    if (!source?.lines.length) continue;
    result.filesRead++;
    result.documents.push({
      path,
      startLine: source.startLine,
      endLine: source.endLine,
      text: source.lines.map((l) => l.text).join('\n'),
      complete: source.endLine === source.totalLines,
    });
    result.readingOrder.push({
      path,
      reason:
        'Start with the repository’s own documentation. These are author statements, not verified runtime behavior.',
    });
  }
  if (!docs.length) warnings.add('No README or CONTRIBUTING file was discovered in this scope.');
  if (docs.length > 2)
    warnings.add(
      'Only two documentation files were excerpted; select a package to focus the briefing.',
    );
  for (const path of manifests.slice(0, 8)) {
    let source = await read(path, 1);
    if (!source) continue;
    const lines = [...source.lines];
    let endLine = source.endLine;
    while (endLine < source.totalLines && endLine < 1000) {
      source = await read(path, endLine + 1);
      if (!source || source.endLine <= endLine) break;
      lines.push(...source.lines);
      endLine = source.endLine;
    }
    result.filesRead++;
    if (!source || endLine < source.totalLines) {
      warnings.add(`${path} was incomplete and was not parsed.`);
      continue;
    }
    try {
      const value: unknown = JSON.parse(lines.map((l) => l.text).join('\n'));
      const m = manifestSchema.parse(value);
      result.manifests.push({
        path,
        startLine: 1,
        endLine,
        name: m.name ?? path,
        description: m.description ?? '',
        scripts: m.scripts ?? {},
        dependencies: m.dependencies ?? {},
        developmentDependencies: m.devDependencies ?? {},
        engines: m.engines ?? {},
        packageManager: m.packageManager ?? '',
        declaredEntries: {
          ...(m.main ? { main: m.main } : {}),
          ...(m.module ? { module: m.module } : {}),
          ...(m.types ? { types: m.types } : {}),
        },
      });
      result.readingOrder.push({
        path,
        reason: 'Inspect declared scripts, dependency versions and environment requirements.',
      });
      for (const [kind, entry] of Object.entries(result.manifests.at(-1)!.declaredEntries)) {
        const target = posix.normalize(posix.join(posix.dirname(path), entry));
        if (unique.includes(target))
          result.readingOrder.push({
            path: target,
            reason: `Declared ${kind} target in ${path}; not runtime-verified.`,
          });
        else
          warnings.add(
            `${path} declares ${kind}=${entry}; that target was not found in discovered files (it may be generated).`,
          );
      }
    } catch {
      warnings.add(`${path} could not be parsed as a supported package manifest.`);
    }
  }
  if (manifests.length > 8)
    warnings.add(
      'Only the first eight package.json files were parsed. Select a package for a focused briefing.',
    );
  if (!manifests.length)
    warnings.add(
      'No package.json discovered. Setup commands and dependencies for other ecosystems are not extracted in this version.',
    );
  const others = unique.filter((p) =>
    /\.(csproj|sln)$|(^|\/)(pyproject.toml|Cargo.toml|go.mod|pom.xml)$/.test(p),
  );
  for (const path of others.slice(0, 6))
    result.readingOrder.push({
      path,
      reason: 'Project manifest discovered by filename; contents have not been parsed.',
    });
  if (others.length)
    warnings.add(
      'Non-package.json manifests are linked for reading, but their requirements are not parsed.',
    );
  result.testFiles = unique.filter((p) => testPath.test(p)).slice(0, 30);
  if (!result.testFiles.length)
    warnings.add(
      'No conventional test filenames were found; this does not prove tests are absent.',
    );
  for (const path of result.testFiles.slice(0, 3))
    result.readingOrder.push({
      path,
      reason: 'Test location suggested by its filename; contents and results are not verified.',
    });
  result.readingOrder = result.readingOrder
    .filter((item, index, all) => all.findIndex((other) => other.path === item.path) === index)
    .slice(0, 24);
  warnings.add(
    'File counts exclude paths filtered by the repository provider, including generated files and lockfiles. Languages are inferred from extensions.',
  );
  warnings.add(
    'Commands are copied from manifests, not executed. Documentation is quoted, not independently verified. Any AI overview is a separately labeled interpretation.',
  );
  result.limitations = [...warnings];
  check();
  return result;
}
