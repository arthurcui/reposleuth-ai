/** Coordinates the investigation form, run lifecycle, activity display, and demo navigation. */
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  investigationRequestSchema,
  type Investigation,
  type InvestigationEvent,
} from '@reposleuth/shared';
import {
  api,
  errorMessage,
  eventSchema,
  isActive,
  runSchema,
} from './features/investigations/client';
import { demoForCase, demoCases } from './features/demo/demo';
import { Report } from './features/investigations/Report';
import { InvestigationHistory } from './features/history/InvestigationHistory';

const currentId = () => new URLSearchParams(location.search).get('investigation');
const currentCase = () => {
  const selected = new URLSearchParams(location.search).get('case');
  return demoCases.find((item) => item.id === selected)?.id ?? demoCases[0]!.id;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to reach the local API.';
export function App() {
  const [showHistory, setShowHistory] = useState(false);
  const [id, setId] = useState(currentId);
  const [caseId, setCaseId] = useState(currentCase);
  const [run, setRun] = useState<Investigation | null>(null);
  const [events, setEvents] = useState<InvestigationEvent[]>([]);
  const [repository, setRepository] = useState('');
  const [issue, setIssue] = useState('');
  const [question, setQuestion] = useState(
    'Find the relevant code, explain the likely root cause, and recommend a fix.',
  );
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const active = Boolean(run && isActive(run.status));
  const busy = active || submitting || Boolean(id && id !== 'demo' && !run && !error);
  const showingDemo = id === 'demo';
  const caseIndex = demoCases.findIndex((item) => item.id === caseId);
  const formDisabled = busy || showingDemo;
  function leaveDemo() {
    const url = new URL(location.href);
    url.searchParams.delete('investigation');
    url.searchParams.delete('case');
    history.pushState(null, '', url);
    setId(null);
  }
  function select(next: string) {
    const url = new URL(location.href);
    url.searchParams.set('investigation', next);
    if (next === 'demo') url.searchParams.set('case', caseId);
    else url.searchParams.delete('case');
    history.pushState(null, '', url);
    setId(next);
  }
  function selectCase(next: string) {
    const url = new URL(location.href);
    url.searchParams.set('case', next);
    url.hash = '';
    history.pushState(null, '', url);
    setCaseId(next);
  }
  useEffect(() => {
    const pop = () => {
      setId(currentId());
      setCaseId(currentCase());
    };
    window.addEventListener('popstate', pop);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener('popstate', pop);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setRun(null);
    setEvents([]);
    setError('');
    setCancelling(false);
    if (!id) {
      setConnection('');
      return;
    }
    if (id === 'demo') {
      setRun(demoForCase(caseId));
      setConnection('');
      return;
    }
    let disposed = false;
    let loading = false;
    let terminal = false;
    let formLoaded = false;
    const source = new EventSource(`/api/investigations/${encodeURIComponent(id)}/events`);
    setConnection('Connecting…');
    async function refresh() {
      if (loading || disposed) return;
      loading = true;
      try {
        const result = runSchema.parse(await api(`/${encodeURIComponent(id!)}`));
        if (disposed) return;
        // Populate once when opening a saved run; later progress updates must preserve edits.
        if (!formLoaded) {
          setRepository(result.request.repository);
          setIssue(result.request.issueNumber?.toString() ?? '');
          setQuestion(result.request.question);
          formLoaded = true;
        }
        setRun(result);
        setError('');
        if (!isActive(result.status)) {
          terminal = true;
          setConnection('Saved locally');
        }
      } catch (cause) {
        if (!disposed) {
          setError(message(cause));
          setConnection('Connection interrupted · retrying');
        }
      } finally {
        loading = false;
      }
    }
    const receive = (event: MessageEvent<string>) => {
      try {
        const parsed = eventSchema.parse(JSON.parse(event.data));
        if (disposed || parsed.investigationId !== id) return;
        setEvents((previous) =>
          previous.some((item) => item.id === parsed.id)
            ? previous
            : [...previous, parsed].sort((a, b) => a.id - b.id).slice(-200),
        );
        if (parsed.type === 'terminal') source.close();
        void refresh();
      } catch {
        /* Polling restores authoritative state if an event is malformed. */
      }
    };
    for (const name of [
      'queued',
      'started',
      'revision',
      'tool_started',
      'tool_finished',
      'usage',
      'validating',
      'validation_failed',
      'terminal',
    ])
      source.addEventListener(name, receive as EventListener);
    source.onopen = () => {
      if (!disposed && !terminal) setConnection('Live updates');
    };
    source.onerror = () => {
      if (terminal) source.close();
      else if (!disposed) setConnection('Reconnecting · polling status');
    };
    void refresh();
    const poll = setInterval(() => {
      if (!terminal) void refresh();
    }, 2500);
    return () => {
      disposed = true;
      clearInterval(poll);
      source.close();
    };
  }, [id, caseId, retry]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (formDisabled) return;
    setError('');
    const parsed = investigationRequestSchema.safeParse({
      repository,
      ...(issue ? { issueNumber: Number(issue) } : {}),
      question,
    });
    if (!parsed.success) {
      setError(
        'Enter a repository, a positive issue number (optional), and a question of 5–2,000 characters.',
      );
      return;
    }
    setSubmitting(true);
    try {
      const result = z.object({ id: z.string().regex(/^[\w-]+$/) }).parse(
        await api('', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        }),
      );
      select(result.id);
    } catch (cause) {
      setError(
        `${message(cause)} If the connection failed after submission, the run may still have started; avoid submitting repeatedly.`,
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function cancel() {
    if (!id) return;
    setCancelling(true);
    try {
      await api(`/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    } catch (cause) {
      setError(message(cause));
      setCancelling(false);
    }
  }
  const duration = run
    ? active && run.startedAt
      ? Math.max(run.durationMs, now - Date.parse(run.startedAt))
      : run.durationMs
    : 0;
  return (
    <main>
      <header>
        <a className="brand" href="/">
          ◈ RepoSleuth <span>AI</span>
        </a>
        <button
          type="button"
          className="secondary compact-button"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((value) => !value)}
        >
          {showHistory ? 'Hide history' : 'Investigation history'}
        </button>
      </header>
      <section className="intro">
        <p className="eyebrow">AUTONOMOUS ISSUE & CODE INVESTIGATOR</p>
        <h1>
          Follow the code.
          <br />
          <span>Find the evidence.</span>
        </h1>
        <p className="description">
          Turn a GitHub issue into a source-backed explanation, with clear uncertainty and a
          practical plan to fix it.
        </p>
      </section>
      {showHistory && (
        <InvestigationHistory
          onClose={() => setShowHistory(false)}
          onOpen={(next) => {
            select(next);
            setShowHistory(false);
          }}
        />
      )}
      <div className="workspace">
        <section className={`panel${showingDemo ? ' demo-mode' : ''}`}>
          <div className="panel-heading">
            <h2>{showingDemo ? 'Demo investigation' : 'Start an investigation'}</h2>
            {showingDemo && <span className="badge">DEMO MODE</span>}
          </div>
          {showingDemo && (
            <p className="notice" role="status">
              You’re viewing curated examples. Live inputs are disabled. Choose one of the 20 cases
              in the activity panel.
            </p>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor="repository">Public GitHub repository</label>
            <input
              id="repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder="https://github.com/owner/repository"
              required
              maxLength={250}
              disabled={formDisabled}
            />
            <label htmlFor="issue">
              Issue number <span className="muted">(optional)</span>
            </label>
            <input
              id="issue"
              type="number"
              min="1"
              step="1"
              value={issue}
              onChange={(event) => setIssue(event.target.value)}
              placeholder="42"
              disabled={formDisabled}
            />
            <label htmlFor="question">What should we investigate?</label>
            <textarea
              id="question"
              rows={5}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              minLength={5}
              maxLength={2000}
              required
              disabled={formDisabled}
            />
            <p className="muted small">
              {showingDemo
                ? 'Demo mode makes no API requests and uses no credits. Your live form entries are preserved.'
                : run && !active
                  ? 'Run again creates a new investigation using these inputs and may incur API costs. The saved report stays unchanged.'
                  : 'Live investigations use your configured provider’s API credits and budget limits. Repository code is read, never executed.'}
            </p>
            {showingDemo ? (
              <button
                key="leave-demo"
                type="button"
                onClick={(event) => {
                  // Cancel this click before React replaces the demo control with a submit button.
                  event.preventDefault();
                  leaveDemo();
                }}
              >
                Start a real investigation →
              </button>
            ) : (
              <button key="submit-investigation" type="submit" disabled={busy}>
                {submitting
                  ? 'Starting…'
                  : active
                    ? 'Investigation in progress'
                    : busy
                      ? 'Loading investigation…'
                      : run
                        ? 'Run again'
                        : 'Investigate →'}
              </button>
            )}
            <button
              type="button"
              className={`demo-button${showingDemo ? ' selected' : ''}`}
              aria-pressed={showingDemo}
              disabled={busy}
              onClick={() => select('demo')}
            >
              {showingDemo ? '✓ Showing demo investigation' : 'Show demo investigation'}
            </button>
          </form>
        </section>
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
                Case {caseIndex + 1} of {demoCases.length}. Each includes source evidence, an
                expected cause, a proposed fix, and a verification plan below.
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
                  <strong>
                    {(run.usage.inputTokens + run.usage.outputTokens).toLocaleString()}
                  </strong>
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
      </div>
      {run &&
        (showingDemo ? (
          <div className="report-navigation">
            <div className="report-navigation-side">
              <button
                type="button"
                className="case-arrow"
                aria-label="Previous report case"
                title="Previous case"
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
            </div>
            <Report run={run} />
            <div className="report-navigation-side">
              <button
                type="button"
                className="case-arrow"
                aria-label="Next report case"
                title="Next case"
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
          </div>
        ) : (
          <Report run={run} />
        ))}
      <footer>Public repositories · Evidence-backed findings · No code execution</footer>
    </main>
  );
}
