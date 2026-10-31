/** Handles explicit briefing creation, polling, package focus, reopening and saved-briefing search. */
import { type Briefing, briefingSchema } from '@reposleuth/shared';
import { useEffect, useState } from 'react';

import { WorkspaceNavigation } from '../../WorkspaceNavigation';
import { ModelPicker } from '../investigations/ModelPicker';
import { BriefingReport } from './BriefingReport';
import { briefingRequest, getBriefing } from './client';

export function Onboarding() {
  const [repository, setRepository] = useState('');
  const [scope, setScope] = useState('');
  const [explain, setExplain] = useState(true);
  const [model, setModel] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [page, setPage] = useState(0);
  const [report, setReport] = useState<Briefing>();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<Briefing[]>([]);
  const [search, setSearch] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [id, setId] = useState(new URLSearchParams(location.search).get('briefing') ?? '');
  const busy = submitting || report?.status === 'running';
  const select = (next: Briefing) => {
    setReport(next);
    setRepository(next.repository);
    setScope(next.scope);
    setExplain(next.includeOverview ?? Boolean(next.summary || next.summaryError || next.model));
    setModel(
      next.requestedModel ? `${next.requestedModel.provider}:${next.requestedModel.model}` : '',
    );
    setId(next.id);
    setError('');
    history.replaceState(null, '', `?briefing=${encodeURIComponent(next.id)}`);
  };
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getBriefing(id);
        if (cancelled) return;
        setReport(next);
        setRepository(next.repository);
        setScope(next.scope);
        setExplain(
          next.includeOverview ?? Boolean(next.summary || next.summaryError || next.model),
        );
        setModel(
          next.requestedModel ? `${next.requestedModel.provider}:${next.requestedModel.model}` : '',
        );
        if (next.status === 'running')
          timer = setTimeout(() => {
            poll().catch(() => {});
          }, 1000);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to reopen briefing.');
      }
    };
    poll().catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);
  const loadHistory = async (query: string) => {
    try {
      setSaved(
        briefingSchema
          .array()
          .parse(await briefingRequest(`/api/briefings?q=${encodeURIComponent(query)}`)),
      );
      setHistoryError('');
      setPage(0);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'History unavailable.');
    }
  };
  useEffect(() => {
    if (showHistory) loadHistory(search).catch(() => {});
  }, [report?.status, showHistory]);
  const start = async () => {
    setSubmitting(true);
    setError('');
    try {
      select(
        briefingSchema.parse(
          await briefingRequest('/api/briefings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repository,
              scope,
              explain,
              ...(model
                ? {
                    selection: {
                      provider: model.split(':')[0],
                      model: model.slice(model.indexOf(':') + 1),
                    },
                  }
                : {}),
            }),
          }),
        ),
      );
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : 'Unable to create briefing.'} If submission lost its connection, check saved briefings before trying again.`,
      );
    } finally {
      setSubmitting(false);
    }
  };
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
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? 'Close history' : 'Briefing history'}
        </button>
      </header>
      <WorkspaceNavigation active="onboarding" />
      {report?.status !== 'completed' && (
        <section className="intro">
          <p className="eyebrow">REPOSITORY ONBOARDING</p>
          <h1>
            Find your way
            <br />
            <span>through the code.</span>
          </h1>
          <p className="description">
            A source-linked guide to a public GitHub repository: project structure, declared setup,
            packages, and where to start reading.
          </p>
        </section>
      )}
      <div className="onboarding-workspace">
        <details className="panel briefing-form" open={report?.status !== 'completed'}>
          <summary>
            {report?.status === 'completed'
              ? 'Create another briefing or focus a package'
              : 'Create an onboarding briefing'}
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start().catch(() => {});
            }}
          >
            <label htmlFor="briefing-repository">Public GitHub repository</label>
            <input
              id="briefing-repository"
              required
              placeholder="https://github.com/owner/repository"
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              disabled={busy}
            />
            <label htmlFor="briefing-scope">Package or directory (optional)</label>
            <input
              id="briefing-scope"
              placeholder="packages/example"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={busy}
            />
            <label className="briefing-explain">
              <input
                type="checkbox"
                checked={explain}
                disabled={busy}
                onChange={(e) => setExplain(e.target.checked)}
              />
              Include a readable AI overview
            </label>
            {explain && (
              <ModelPicker
                value={model}
                onChange={setModel}
                disabled={busy}
                label="Briefing model"
              />
            )}
            <p>
              {explain
                ? 'One model request, capped at $0.03 estimated usage, within the server budget. Source details are retained if the overview fails.'
                : 'Source facts only. No model calls or charges.'}{' '}
              Commands are never executed.
            </p>
            <button disabled={busy || !repository.trim()}>
              {busy ? 'Building briefing…' : 'Generate briefing →'}
            </button>
          </form>
          {report?.status === 'running' && (
            <p role="status">
              Reading documentation, manifests and a bounded source route. You can reopen this
              briefing from history.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {report?.status === 'failed' && <p role="alert">{report.error}</p>}
          {!!report?.packages.length && (
            <>
              <label htmlFor="briefing-package">Focus a discovered package</label>
              <select
                id="briefing-package"
                value={report.packages.includes(scope) ? scope : ''}
                disabled={busy}
                onChange={(e) => {
                  setRepository(report.repository);
                  setScope(e.target.value);
                }}
              >
                <option value="">Whole repository</option>
                {report.packages.filter(Boolean).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <p>Selecting a package only fills the form. Generate a briefing when ready.</p>
            </>
          )}
        </details>
        {showHistory && (
          <section className="panel briefing-history">
            <h2>Saved briefings</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                loadHistory(search).catch(() => {});
              }}
            >
              <label htmlFor="briefing-search">Repository or directory</label>
              <input
                id="briefing-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="secondary">Search</button>
            </form>
            {historyError && <p role="alert">{historyError}</p>}
            {!saved.length && <p>No saved briefings found.</p>}
            <ul className="history-list">
              {saved.slice(page * 5, page * 5 + 5).map((item) => (
                <li key={item.id}>
                  <strong>{item.repository}</strong>
                  <p>
                    {item.scope || 'Whole repository'} · {item.status} ·{' '}
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy && report?.id !== item.id}
                    onClick={() => {
                      select(item);
                      setShowHistory(false);
                    }}
                  >
                    Open briefing
                  </button>
                </li>
              ))}
            </ul>
            <div className="history-actions">
              <button
                type="button"
                className="secondary compact-button"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                ← Previous
              </button>
              <span>
                Page {page + 1} of {Math.max(1, Math.ceil(saved.length / 5))}
              </span>
              <button
                type="button"
                className="secondary compact-button"
                disabled={(page + 1) * 5 >= saved.length}
                onClick={() => setPage(page + 1)}
              >
                Next →
              </button>
            </div>
            <p>Five at a time · up to 50 recent matches.</p>
          </section>
        )}
      </div>
      {report?.status === 'completed' && <BriefingReport report={report} />}
      <footer>Public repositories · Pinned source links · No code execution</footer>
    </main>
  );
}
