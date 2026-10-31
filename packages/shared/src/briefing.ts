/** Validates source-backed onboarding briefings independently of the archived investigation contract. */
import { z } from 'zod';

export const briefingRequestSchema = z.object({
  explain: z.boolean().default(false),
  selection: z
    .object({ provider: z.enum(['openai', 'gemini']), model: z.string().min(1).max(150) })
    .optional(),
  repository: z.string().trim().min(3).max(250),
  scope: z.string().trim().max(500).default(''),
});
const codeCitation = z.object({
  path: z.string().min(1).max(1024),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export const briefingSummarySchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(100),
        text: z.string().min(1).max(1800),
        sources: z.array(z.string().min(1).max(1024)).min(1).max(6),
      }),
    )
    .min(1)
    .max(5),
  codeWalkthrough: z
    .object({
      title: z.string().min(1).max(120),
      overview: z.string().min(1).max(1000),
      trigger: z.string().min(1).max(500).optional(),
      result: z.string().min(1).max(500).optional(),
      steps: z
        .array(
          z.object({
            title: z.string().min(1).max(120),
            explanation: z.string().min(1).max(1200),
            readingTip: z.string().min(1).max(500),
            sources: z.array(codeCitation).min(1).max(3),
          }),
        )
        .min(2)
        .max(5),
      limitations: z.array(z.string().min(1).max(500)).min(1).max(5),
    })
    .optional(),
  uncertainties: z.array(z.string().min(1).max(600)).max(6),
});
const source = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export const briefingSchema = z.object({
  codeSources: z
    .array(codeCitation.extend({ text: z.string(), complete: z.boolean(), reason: z.string() }))
    .optional(),
  codeConnections: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        line: z.number().int().positive(),
        kind: z.enum(['relative import', 'type-name candidate']),
      }),
    )
    .optional(),
  codeCoverage: z.array(z.string()).optional(),
  includeOverview: z.boolean().optional(),
  summary: briefingSummarySchema.optional(),
  summaryError: z.string().optional(),
  walkthroughError: z.string().optional(),
  summaryDiagnostics: z
    .object({
      stage: z.enum([
        'request',
        'response',
        'json',
        'overview-schema',
        'overview-sources',
        'walkthrough-schema',
        'walkthrough-citations',
        'walkthrough-route',
      ]),
      code: z.string().max(100),
      issues: z.array(z.object({ path: z.string().max(300), code: z.string().max(100) })).max(8),
      responseChars: z.number().int().nonnegative(),
      responseSha256: z.string().max(64),
    })
    .optional(),
  requestedModel: z
    .object({ provider: z.enum(['openai', 'gemini']), model: z.string() })
    .optional(),
  model: z.string().optional(),
  modelUsage: z
    .object({
      requests: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      estimatedCostUsd: z.number(),
      reservedCostUsd: z.number(),
      usageIncomplete: z.boolean(),
    })
    .optional(),
  id: z.string(),
  createdAt: z.string(),
  repository: z.string(),
  commitSha: z.string(),
  scope: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  error: z.string().optional(),
  durationMs: z.number(),
  filesDiscovered: z.number(),
  filesRead: z.number(),
  languages: z.array(z.object({ name: z.string(), files: z.number() })),
  directories: z.array(z.object({ path: z.string(), files: z.number() })),
  packages: z.array(z.string()),
  documents: z.array(source.extend({ text: z.string(), complete: z.boolean() })),
  manifests: z.array(
    source.extend({
      name: z.string(),
      description: z.string(),
      scripts: z.record(z.string(), z.string()),
      dependencies: z.record(z.string(), z.string()),
      developmentDependencies: z.record(z.string(), z.string()),
      engines: z.record(z.string(), z.string()),
      packageManager: z.string(),
      declaredEntries: z.record(z.string(), z.string()),
    }),
  ),
  readingOrder: z.array(z.object({ path: z.string(), reason: z.string() })),
  testFiles: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type Briefing = z.infer<typeof briefingSchema>;
export type BriefingRequest = z.infer<typeof briefingRequestSchema>;

export function briefingSourceUrl(
  briefing: Pick<Briefing, 'repository' | 'commitSha'>,
  path: string,
  startLine?: number,
  endLine?: number,
) {
  return `https://github.com/${briefing.repository}/blob/${briefing.commitSha}/${path.split('/').map(encodeURIComponent).join('/')}${startLine ? `#L${startLine}${endLine ? `-L${endLine}` : ''}` : ''}`;
}

/** Exports literal repository content without treating it as Markdown instructions or HTML. */
export function briefingMarkdown(briefing: Briefing) {
  const safe = (text: string) =>
    text.replace(/[\\`*_{}[\]()<>#!|]/g, '\\$&').replace(/[\r\n]+/g, ' ');
  const link = (path: string, start?: number, end?: number) =>
    `[${safe(path)}](${briefingSourceUrl(briefing, path, start, end)})`;
  const out = [
    `# Onboarding: ${safe(briefing.repository)}`,
    `Commit: ${briefing.commitSha}`,
    `Scope: ${safe(briefing.scope || 'whole repository')}`,
    'Repository facts and documentation excerpts; commands have not been executed. AI explanations, when included, are interpretations of linked sources.',
    '## Repository map',
    ...briefing.directories.map((d) => `- ${safe(d.path)}: ${d.files} discovered files`),
    '## Suggested reading order',
    ...briefing.readingOrder.map((r) => `- ${link(r.path)} — ${safe(r.reason)}`),
    '## Declared setup and packages',
  ];
  if (briefing.summary)
    out.splice(
      4,
      0,
      '## At a glance',
      ...briefing.summary.sections.flatMap((s) => [
        `### ${safe(s.title)}`,
        safe(s.text),
        s.sources.map((p) => link(p)).join(' · '),
      ]),
      ...briefing.summary.uncertainties.map((s) => `Uncertainty: ${safe(s)}`),
    );
  if (briefing.summary?.codeWalkthrough) {
    const walk = briefing.summary.codeWalkthrough;
    out.push('## How this project works', safe(walk.title), safe(walk.overview));
    if (walk.trigger) out.push(`Trigger: ${safe(walk.trigger)}`);
    if (walk.result) out.push(`Result: ${safe(walk.result)}`);
    walk.steps.forEach((step, index) =>
      out.push(
        `### ${index + 1}. ${safe(step.title)}`,
        safe(step.explanation),
        `Reading tip: ${safe(step.readingTip)}`,
        ...step.sources.map((s) => link(s.path, s.startLine, s.endLine)),
      ),
    );
    out.push(...walk.limitations.map((s) => `Limitation: ${safe(s)}`));
  }
  if (briefing.codeSources)
    out.push(
      '## Source reading coverage',
      ...briefing.codeSources.map(
        (s) => `- ${link(s.path, s.startLine, s.endLine)} — ${safe(s.reason)}`,
      ),
      ...(briefing.codeCoverage ?? []).map((s) => `- ${safe(s)}`),
    );
  if (briefing.walkthroughError)
    out.push('## Walkthrough unavailable', safe(briefing.walkthroughError));
  if (briefing.summaryError) out.push('## Overview unavailable', safe(briefing.summaryError));
  if (briefing.summaryDiagnostics) {
    const d = briefing.summaryDiagnostics;
    out.push(
      '## Validation details',
      `Stage: ${safe(d.stage)}; code: ${safe(d.code)}`,
      ...d.issues.map((issue) => `- ${safe(issue.path)}: ${safe(issue.code)}`),
    );
  }
  for (const m of briefing.manifests)
    out.push(
      `### ${safe(m.name)}`,
      link(m.path, m.startLine, m.endLine),
      safe(m.description),
      `Package manager: ${safe(m.packageManager || 'not declared')}`,
      ...Object.entries(m.engines).map(([k, v]) => `- Required ${safe(k)}: ${safe(v)}`),
      ...Object.entries(m.scripts).map(([k, v]) => `- Script ${safe(k)}: ${safe(v)} (unexecuted)`),
      'Dependencies:',
      ...Object.entries(m.dependencies).map(([k, v]) => `- ${safe(k)}: ${safe(v)}`),
      'Development dependencies:',
      ...Object.entries(m.developmentDependencies).map(([k, v]) => `- ${safe(k)}: ${safe(v)}`),
    );
  for (const doc of briefing.documents)
    out.push(
      '## Documentation excerpt',
      link(doc.path, doc.startLine, doc.endLine),
      ...doc.text.split('\n').map((line) => `> ${safe(line)}`),
    );
  out.push(
    '## Tests found by filename',
    ...briefing.testFiles.map((p) => `- ${link(p)}`),
    '## Missing information and limits',
    ...briefing.limitations.map((text) => `- ${safe(text)}`),
  );
  return out.join('\n\n');
}
