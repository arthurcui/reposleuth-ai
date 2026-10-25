/** Lists, filters, and searches saved investigations, with report reopening and Markdown downloads. */
import { type HistoryPage, historyPageSchema, investigationStatusSchema } from '@reposleuth/shared';
import { type FormEvent, useEffect, useState } from 'react';

import { api } from '../investigations/client';

const emptyFilters = { q: '', repository: '', issueNumber: '', model: '', status: '' };
const pageSize = 20;
const modelGroup = (model: string) => {
  if (/^gemini-/i.test(model)) return 'Google Gemini';
  if (/^(gpt-|chatgpt-|o[1-9](?:-|$))/i.test(model)) return 'OpenAI';
  return 'Other models';
};

export function InvestigationHistory({
  onOpen,
  onClose,
}: {
  onOpen: (id: string) => void;
  onClose?: () => void;
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    setPage(null);
    async function load() {
      try {
        const result = historyPageSchema.parse(
          await api(`?${query}&limit=${pageSize}&offset=${offset}`),
        );
        if (!disposed) {
          setPage(result);
          setModels(
            [...new Set(result.models ?? result.items.map((item) => item.model))].sort((a, b) =>
              a.localeCompare(b, undefined, { numeric: true }),
            ),
          );
        }
      } catch (cause) {
        if (!disposed)
          setError(
            cause instanceof Error ? cause.message : 'Unable to load investigation history.',
          );
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    load().catch(() => {
      if (!disposed) setError('Unable to load data. Please retry.');
    });
    return () => {
      disposed = true;
    };
  }, [query, offset, refresh]);
  function apply(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value.trim()) params.set(key, value.trim());
    setQuery(params.toString());
    setOffset(0);
    setRefresh((value) => value + 1);
  }
  function clear() {
    setFilters(emptyFilters);
    setQuery('');
    setOffset(0);
    setRefresh((value) => value + 1);
  }
  return (
    <section className="panel history-panel" aria-labelledby="history-title">
      <div className="panel-heading">
        <h2 id="history-title">Investigation history</h2>
        <div className="history-actions">
          {onClose && (
            <button
              type="button"
              className="secondary compact-button"
              onClick={onClose}
              aria-label="Close history"
              title="Close history"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <p className="muted">
        Search saved questions, summaries, findings, and file paths. All search words must match.
        Most recent runs appear first.
      </p>
      <form onSubmit={apply} className="history-filters">
        <div className="history-search">
          <label htmlFor="history-search">Search past investigations</label>
          <input
            id="history-search"
            maxLength={300}
            placeholder="e.g. cache key or src/customers.ts"
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          />
        </div>
        <div>
          <label htmlFor="history-repository">Repository filter</label>
          <input
            id="history-repository"
            maxLength={250}
            placeholder="owner/repository or GitHub URL"
            value={filters.repository}
            onChange={(event) => setFilters({ ...filters, repository: event.target.value })}
          />
        </div>
        <div>
          <label htmlFor="history-issue">Issue filter</label>
          <input
            id="history-issue"
            type="number"
            min="1"
            step="1"
            value={filters.issueNumber}
            onChange={(event) => setFilters({ ...filters, issueNumber: event.target.value })}
          />
        </div>
        <div>
          <label htmlFor="history-model">Model filter</label>
          <select
            id="history-model"
            value={filters.model}
            onChange={(event) => setFilters({ ...filters, model: event.target.value })}
          >
            <option value="">All models</option>
            {['OpenAI', 'Google Gemini', 'Other models'].map((group) => {
              const options = models.filter((model) => modelGroup(model) === group);
              return (
                options.length > 0 && (
                  <optgroup key={group} label={group}>
                    {options.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
          </select>
        </div>
        <div>
          <label htmlFor="history-status">Status filter</label>
          <select
            id="history-status"
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">All statuses</option>
            {investigationStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="history-actions">
          <button type="submit">Search</button>
          <button type="button" className="secondary" onClick={clear}>
            Clear filters
          </button>
        </div>
      </form>
      {loading && <p role="status">Loading history…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => setRefresh((value) => value + 1)}>
            Retry history
          </button>
        </p>
      )}
      {page && (
        <>
          <p className="muted" role="status">
            {page.total === 0
              ? 'No saved investigations match your search.'
              : `${offset + 1}–${Math.min(offset + page.items.length, page.total)} of ${page.total} investigations`}
          </p>
          <ul className="history-list" aria-label="Saved investigations">
            {page.items.map((item) => (
              <li key={item.id}>
                <div className="panel-heading">
                  <strong>
                    {item.request.repository}
                    {item.request.issueNumber ? ` · Issue #${item.request.issueNumber}` : ''}
                  </strong>
                  <span className="badge">{item.status.replaceAll('_', ' ')}</span>
                </div>
                <h3>{item.request.question}</h3>
                <p className="muted small">
                  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>{' '}
                  · {item.model}
                </p>
                <p className="history-summary">
                  {item.summary ?? 'No validated report available.'}
                </p>
                <div className="history-actions">
                  <button className="secondary compact-button" onClick={() => onOpen(item.id)}>
                    {item.hasReport ? 'Open report' : 'View investigation'}
                  </button>
                  {item.hasReport && (
                    <a
                      className="export-link"
                      href={`/api/investigations/${encodeURIComponent(item.id)}/export`}
                      download
                    >
                      Export Markdown
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <nav className="history-actions" aria-label="History pages">
            <button
              className="secondary compact-button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - pageSize))}
            >
              Previous page
            </button>
            <button
              className="secondary compact-button"
              disabled={offset + page.items.length >= page.total}
              onClick={() => setOffset(offset + pageSize)}
            >
              Next page
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
