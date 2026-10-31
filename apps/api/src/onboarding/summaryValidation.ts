/** Validates overview and optional walkthrough independently; diagnostics retain structure, never rejected prose. */
import { type Briefing, briefingSummarySchema } from '@reposleuth/shared';

type Diagnostics = NonNullable<Briefing['summaryDiagnostics']>;
type Result = Pick<Briefing, 'summary' | 'summaryError' | 'walkthroughError'> & {
  diagnostic?: Pick<Diagnostics, 'stage' | 'code' | 'issues'>;
};
const overviewSchema = briefingSummarySchema.omit({ codeWalkthrough: true });
const knownFields = new Set([
  'sections',
  'uncertainties',
  'codeWalkthrough',
  'title',
  'text',
  'sources',
  'path',
  'startLine',
  'endLine',
  'overview',
  'trigger',
  'result',
  'steps',
  'explanation',
  'readingTip',
  'limitations',
]);
function issues(list: { path: PropertyKey[]; code: string }[]) {
  return list.slice(0, 8).map((issue) => ({
    path: issue.path
      .map((part) =>
        typeof part === 'number'
          ? String(part)
          : knownFields.has(String(part))
            ? String(part)
            : '[field]',
      )
      .join('.')
      .slice(0, 300),
    code: issue.code.slice(0, 100),
  }));
}

export function validateSummary(value: unknown, report: Briefing, sources: Set<string>): Result {
  const overview = overviewSchema.safeParse(value);
  if (!overview.success)
    return {
      summaryError:
        'The overview did not match the required format (INVALID_OVERVIEW_SCHEMA). Source details are preserved.',
      diagnostic: {
        stage: 'overview-schema',
        code: 'INVALID_OVERVIEW_SCHEMA',
        issues: issues(overview.error.issues),
      },
    };
  if (overview.data.sections.some((s) => s.sources.some((path) => !sources.has(path))))
    return {
      summaryError:
        'The overview referenced an unread source (UNKNOWN_SUMMARY_SOURCE). Source details are preserved.',
      diagnostic: { stage: 'overview-sources', code: 'UNKNOWN_SUMMARY_SOURCE', issues: [] },
    };
  const result: Result = { summary: overview.data };
  const reject = (
    stage: Diagnostics['stage'],
    code: string,
    details: Diagnostics['issues'] = [],
  ): Result => ({
    ...result,
    walkthroughError: `The optional walkthrough was rejected (${code}). The overview passed its own checks and remains available. No automatic retry was made.`,
    diagnostic: { stage, code, issues: details },
  });
  // safeParse above establishes an object; do not access arbitrary prototype properties.
  const raw = value as Record<string, unknown>;
  if (!Object.hasOwn(raw, 'codeWalkthrough') || raw.codeWalkthrough === undefined) return result;
  const parsed = briefingSummarySchema.shape.codeWalkthrough.safeParse(raw.codeWalkthrough);
  if (!parsed.success)
    return reject('walkthrough-schema', 'INVALID_WALKTHROUGH_SCHEMA', issues(parsed.error.issues));
  const walk = parsed.data!;
  if (!walk.trigger || !walk.result)
    return reject(
      'walkthrough-schema',
      'INCOMPLETE_CODE_EXAMPLE',
      ['trigger', 'result']
        .filter((key) => !walk[key as 'trigger' | 'result'])
        .map((path) => ({ path, code: 'required' })),
    );
  const cited = new Set<string>();
  for (const [stepIndex, step] of walk.steps.entries())
    for (const [sourceIndex, ref] of step.sources.entries()) {
      const source = report.codeSources?.find((s) => s.path === ref.path);
      const path = `steps.${stepIndex}.sources.${sourceIndex}`;
      if (
        !source ||
        ref.startLine < source.startLine ||
        ref.endLine > source.endLine ||
        ref.endLine < ref.startLine
      )
        return reject('walkthrough-citations', 'INVALID_CODE_CITATION', [
          { path, code: source ? 'range_outside_excerpt' : 'unread_source' },
        ]);
      cited.add(ref.path);
    }
  const connected = new Set([report.codeSources?.[0]?.path ?? '']);
  for (let i = 0; i < 6; i++)
    for (const edge of report.codeConnections ?? [])
      if (connected.has(edge.from)) connected.add(edge.to);
  if (cited.size < 2)
    return reject('walkthrough-route', 'UNSUPPORTED_CODE_ROUTE', [
      { path: 'steps', code: 'fewer_than_two_distinct_files' },
    ]);
  if ([...cited].some((p) => !connected.has(p)))
    return reject('walkthrough-route', 'UNSUPPORTED_CODE_ROUTE', [
      { path: 'steps', code: 'disconnected_source' },
    ]);
  return { summary: { ...overview.data, codeWalkthrough: walk } };
}
