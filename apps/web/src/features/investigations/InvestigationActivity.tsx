/** Renders investigation status, metrics, demo selection, and event activity. */
import { investigationModes } from '@reposleuth/shared';

import { demoCases } from '../demo/demo';
import { errorMessage } from './client';
import type { InvestigationWorkspace } from './useInvestigationWorkspace';
export function InvestigationActivity({ workspace }: { workspace: InvestigationWorkspace }) {
  const {
    run,
    error,
    id,
    setRetry,
    caseIndex,
    selectCase,
    caseId,
    connection,
    duration,
    active,
    cancel,
    cancelling,
    events,
    showingDemo,
  } = workspace;
  return (
    <>
      <section className="panel progress" aria-labelledby="progress-title">
        <div className="panel-heading">
          <h2 id="progress-title">Investigation activity</h2>
          <span className="badge" role="status">
            {run?.status.replaceAll('_', ' ') ?? 'Ready'}
          </span>
        </div>
        {error && (
          <div role="alert" className="notice error">
            {error}{' '}
            {id && id !== 'demo' && (
              <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
                Reconnect
              </button>
            )}
          </div>
        )}
        {!id && (
          <div className="empty">
            <span className="empty-icon">⌕</span>
            <h3>A question. A trail of evidence.</h3>
            <p>
              Select a repository to follow the agent as it searches code, checks hypotheses, and
              assembles its findings.
            </p>
            <p className="muted">Try the free demo to preview a complete report.</p>
          </div>
        )}
        {id === 'demo' && (
          <>
            <p className="notice">
              Illustrative demo · synthetic code and findings. No API requests or charges.
            </p>
            <label htmlFor="demo-case">Explore the 20 defect cases</label>
            <div className="case-navigation">
              <button
                type="button"
                className="case-arrow"
                aria-label="Previous demo case"
                title="Previous demo case"
                disabled={caseIndex === 0}
                onClick={() => selectCase(demoCases[caseIndex - 1]!.id)}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m14 6-6 6 6 6" />
                </svg>
              </button>
              <select
                id="demo-case"
                value={caseId}
                onChange={(event) => selectCase(event.target.value)}
              >
                {[...new Set(demoCases.map((item) => item.category))].map((category) => (
                  <optgroup key={category} label={category}>
                    {demoCases
                      .filter((item) => item.category === category)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.id} — {item.question}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                className="case-arrow"
                aria-label="Next demo case"
                title="Next demo case"
                disabled={caseIndex === demoCases.length - 1}
                onClick={() => selectCase(demoCases[caseIndex + 1]!.id)}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m10 6 6 6-6 6" />
                </svg>
              </button>
            </div>
            <p className="muted small" aria-live="polite">
              Case {caseIndex + 1} of {demoCases.length}. Each includes source evidence, an expected
              cause, a proposed fix, and a verification plan below.
            </p>
          </>
        )}
        {id && connection && (
          <p className="muted" role="status">
            {connection}
          </p>
        )}
        {run && (
          <>
            <p className="run-repo">
              {run.request.repository}
              {run.request.issueNumber && ` · Issue #${run.request.issueNumber}`}
            </p>
            <p className="muted">{run.request.question}</p>
            {!showingDemo && (
              <p className="muted small">
                {investigationModes[run.request.mode ?? 'standard'].label} mode
                {run.limits && (
                  <>
                    {' '}
                    · limit {run.limits.timeoutMs / 60000} min · ${run.limits.costUsd.toFixed(2)}
                  </>
                )}
              </p>
            )}
            {!showingDemo && run.report && (
              <a
                className="export-link"
                href={`/api/investigations/${encodeURIComponent(run.id)}/export`}
                download
              >
                Export Markdown
              </a>
            )}
            <div className="metrics">
              <div>
                <strong>{`${(duration / 1000).toFixed(1)}s`}</strong>
                <span>Duration</span>
              </div>
              <div>
                <strong>{(run.usage.inputTokens + run.usage.outputTokens).toLocaleString()}</strong>
                <span>Tokens</span>
              </div>
              <div>
                <strong>${run.usage.estimatedCostUsd.toFixed(4)}</strong>
                <span>Estimated cost</span>
              </div>
            </div>
            <p className="muted small">
              {run.usage.inputTokens.toLocaleString()} input ·{' '}
              {run.usage.outputTokens.toLocaleString()} output · {run.usage.requests} requests ·{' '}
              {run.model}
            </p>
            {run.usage.usageIncomplete && (
              <p className="notice">
                Usage is incomplete. ${run.usage.reservedCostUsd.toFixed(4)} remains reserved
                conservatively.
              </p>
            )}
            {run.errorCode && <p className="notice error">{errorMessage(run.errorCode)}</p>}
            {run.commitSha && (
              <p className="muted small">
                Pinned commit: <code>{run.commitSha.slice(0, 12)}</code>
              </p>
            )}
            {active && (
              <button className="secondary" onClick={() => void cancel()} disabled={cancelling}>
                {cancelling ? 'Stopping…' : 'Stop investigation'}
              </button>
            )}
          </>
        )}
        {events.length > 0 && (
          <ol className="timeline" aria-label="Investigation steps">
            {events.map((event) => (
              <li key={event.id}>
                <time>{new Date(event.at).toLocaleTimeString()}</time>
                <div>
                  <strong>{event.type.replaceAll('_', ' ')}</strong>
                  {typeof event.data.name === 'string' && (
                    <span>{event.data.name.replaceAll('_', ' ')}</span>
                  )}
                  {typeof event.data.reason === 'string' && (
                    <span>
                      {event.data.reason.toLowerCase().replaceAll('_', ' ')}
                      {typeof event.data.evidenceIndex === 'number'
                        ? ` (evidence #${event.data.evidenceIndex})`
                        : ''}
                    </span>
                  )}
                  {typeof event.data.outcome === 'string' && <span>{event.data.outcome}</span>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {run && !active && !run.report && (
          <p className="muted">
            No validated report was produced. Review the status above before starting another
            investigation.
          </p>
        )}
      </section>
    </>
  );
}
