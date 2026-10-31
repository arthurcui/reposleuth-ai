/** Explains stopped runs from saved events without treating retrieved source as validated findings. */
import type { Investigation, InvestigationEvent } from '@reposleuth/shared';

import { errorMessage, isActive, sourceUrl } from './client';

const tools: Record<string, string> = {
  get_issue: 'Read GitHub issue',
  list_files: 'Discover repository files',
  search_code: 'Search source code',
  read_file: 'Read source file',
  get_commits: 'Read file history',
  get_file_diff: 'Read historical diff',
};
const reasons: Record<string, string> = {
  REQUEST_RESERVE: 'The remaining model requests were reserved for reporting.',
  TOKEN_RESERVE: 'The remaining token allowance was reserved for reporting.',
  COST_RESERVE: 'The remaining run cost allowance was reserved for reporting.',
  LIFETIME_COST_RESERVE: 'The remaining persistent spending allowance was reserved for reporting.',
  CONTEXT_RESERVE: 'Exploration stopped to keep the final request within the context allowance.',
  TIME_RESERVE: 'The remaining time was reserved for reporting.',
  TOOL_LIMIT: 'The repository tool allowance was reached.',
};
const validationReasons: Record<string, string> = {
  UNKNOWN_HANDLE: 'The report referenced a source handle that was not retrieved in this run.',
  INVALID_LINE_RANGE: 'A citation used a line range outside the retrieved source.',
  UNKNOWN_EVIDENCE_ID: 'A finding or reasoning summary referenced an unknown evidence ID.',
  INVALID_REPORT_JSON: 'The model did not return valid report JSON.',
  INVALID_REPORT_SCHEMA: 'The model response did not match the required report structure.',
  DUPLICATE_ID: 'The report assigned the same evidence ID to multiple citations.',
  COMMIT_MISMATCH: 'A citation referenced a different commit from this investigation.',
  SOURCE_NOT_READ: 'A citation referenced source that was not read in this investigation.',
  QUOTE_MISMATCH: 'A quoted excerpt did not match the retrieved source.',
};

function limitText(run: Investigation): string | undefined {
  if (!run.limits) return undefined;
  switch (run.errorCode) {
    case 'BUDGET_EXCEEDED_REQUESTS':
      return `${run.limits.turns} model requests`;
    case 'BUDGET_EXCEEDED_TOOLS':
      return `${run.limits.tools} repository tool calls`;
    case 'BUDGET_EXCEEDED_TOKENS':
      return `${run.limits.tokens.toLocaleString()} total tokens`;
    case 'BUDGET_EXCEEDED_COST':
      return `$${run.limits.costUsd.toFixed(4)} per investigation`;
    case 'TIMEOUT':
      return `${Math.round(run.limits.timeoutMs / 1000)} seconds`;
    default:
      return undefined;
  }
}

function actionText(event: InvestigationEvent | undefined): string {
  if (!event) return 'No action recorded in the available activity log.';
  if (event.type === 'reporting') return 'Prepare final report';
  if (event.type === 'report_correction') return 'Correct report format';
  if (event.type === 'validating' || event.type === 'validation_failed')
    return 'Validate report and citations';
  const name =
    typeof event.data.name === 'string'
      ? (tools[event.data.name] ?? 'Repository tool')
      : 'Repository tool';
  if (event.type === 'tool_started') return `${name} · started; completion not recorded`;
  const outcome =
    event.data.outcome === 'error'
      ? 'failed'
      : event.data.outcome === 'output_limit'
        ? 'result too large'
        : 'finished';
  return `${name} · ${outcome}`;
}

export function InvestigationDiagnostics({
  run,
  events,
}: {
  run: Investigation;
  events: InvestigationEvent[];
}) {
  const recorded = events
    .filter((event) => event.investigationId === run.id)
    .sort((a, b) => b.id - a.id);
  const reporting = recorded.find((event) => event.type === 'reporting');
  const correction = recorded.find((event) => event.type === 'report_correction');
  const partial = !!reporting || run.report?.verification?.coverage === 'partial';
  if (isActive(run.status) || (run.status === 'completed' && !partial && !correction)) return null;
  const last = recorded.find((event) =>
    [
      'tool_started',
      'tool_finished',
      'validating',
      'validation_failed',
      'reporting',
      'report_correction',
    ].includes(event.type),
  );
  const validation = recorded.find((event) => event.type === 'validation_failed');
  const corrected =
    run.status === 'completed' &&
    correction?.data.status === 'shape_valid' &&
    validation &&
    correction.id > validation.id;
  const files = new Map<string, { url: string | null }>();
  for (const event of recorded) {
    const { path, startLine, endLine, commitSha } = event.data;
    if (
      event.type !== 'source_read' ||
      typeof path !== 'string' ||
      path.length > 1024 ||
      typeof startLine !== 'number' ||
      typeof endLine !== 'number' ||
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine ||
      !run.commitSha ||
      commitSha !== run.commitSha
    )
      continue;
    const key = `${path}:${startLine}-${endLine}`;
    files.set(key, {
      url: sourceUrl(
        run.request.repository
          .replace(/^https:\/\/github\.com\//, '')
          .replace(/\/$/, '')
          .replace(/\.git$/, ''),
        run.commitSha,
        path,
        startLine,
        endLine,
      ),
    });
  }
  const limit = limitText(run);
  const reason =
    typeof reporting?.data.reason === 'string' ? reasons[reporting.data.reason] : undefined;
  const rejected =
    typeof validation?.data.reason === 'string'
      ? validationReasons[validation.data.reason]
      : undefined;
  return (
    <section className="investigation-diagnostics" aria-labelledby="diagnostics-title">
      <h3 id="diagnostics-title">
        {run.status === 'completed'
          ? partial
            ? 'Partial investigation'
            : 'Investigation details'
          : 'Why this investigation stopped'}
      </h3>
      {run.errorCode && <p className="notice error">{errorMessage(run.errorCode)}</p>}
      {limit && (
        <p>
          <strong>Configured limit:</strong> {limit}
        </p>
      )}
      {reason && <p>{reason}</p>}
      <p>
        <strong>Last tool or reporting action:</strong> {actionText(last)}
      </p>
      {corrected && (
        <p>The earlier response was rejected. The corrected report passed validation.</p>
      )}
      {rejected && !corrected && (
        <p>
          <strong>Validation:</strong> {rejected}
        </p>
      )}
      {run.report ? (
        <p>
          {run.report.findings.length} {run.report.findings.length === 1 ? 'finding' : 'findings'}{' '}
          available in the accepted report. Citations were validated; runtime behavior and proposed
          fixes have not been tested. Unchecked paths and uncertainties are listed in the report.
        </p>
      ) : (
        <p>
          No validated report or findings are available. Retrieved source alone is not a diagnosis.
          Any rejected model response was not published as an accepted report.
        </p>
      )}
      <details>
        <summary>Recorded source reads ({files.size})</summary>
        {files.size ? (
          <ul>
            {[...files].map(([label, file]) => (
              <li key={label}>
                {file.url ? (
                  <a href={file.url} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                ) : (
                  <span>{label}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No source-read details are available in this log. Older runs may not have recorded them.
          </p>
        )}
        <p className="muted small">
          These are retrieved source ranges, not a list of confirmed defects. Search snippets and
          historical diffs are not included.
        </p>
      </details>
    </section>
  );
}
