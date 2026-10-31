/** Renders declared facts, literal documentation and explicitly labeled reading suggestions. */
import { type Briefing, briefingSourceUrl } from '@reposleuth/shared';

import { CodeWalkthrough } from './CodeWalkthrough';
export function BriefingReport({ report }: { report: Briefing }) {
  const link = (path: string, start?: number, end?: number) => (
    <a href={briefingSourceUrl(report, path, start, end)} target="_blank" rel="noreferrer">
      {path}
      {start ? `:${start}–${end}` : ''} ↗
    </a>
  );
  return (
    <article className="panel onboarding-report" aria-label="Onboarding briefing">
      <p className="eyebrow">ONBOARDING BRIEFING</p>
      <h2>{report.repository}</h2>
      <details className="briefing-meta">
        <summary>Pinned sources, usage and export</summary>
        <p>
          Scope: {report.scope || 'whole repository'} · Commit{' '}
          <a
            href={`https://github.com/${report.repository}/commit/${report.commitSha}`}
            target="_blank"
            rel="noreferrer"
          >
            {report.commitSha.slice(0, 12)}
          </a>
        </p>
        <p>
          {report.filesDiscovered} eligible files discovered · {report.filesRead} files read ·{' '}
          {(report.durationMs / 1000).toFixed(1)}s ·{' '}
          {report.modelUsage
            ? `${report.model} · $${report.modelUsage.estimatedCostUsd.toFixed(4)} estimated`
            : 'No model charges'}
        </p>
        <a className="export-link" href={`/api/briefings/${report.id}/markdown`}>
          Export Markdown ↓
        </a>
      </details>
      {report.summary && (
        <section className="briefing-overview">
          <p className="eyebrow">AT A GLANCE · AI EXPLANATION</p>
          {report.summary.sections.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <p className="briefing-prose">{s.text}</p>
              <div className="briefing-citations">
                {s.sources.map((p) => (
                  <span key={p}>{link(p)} </span>
                ))}
              </div>
            </section>
          ))}
          <p>
            Based on linked documentation, declarations and any sampled source; runtime behavior is
            not verified.
          </p>
          {report.summary.uncertainties.length > 0 && (
            <details>
              <summary>What is still unclear</summary>
              <ul>
                {report.summary.uncertainties.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {report.summaryError && <p role="status">{report.summaryError}</p>}
      {report.summaryDiagnostics && (
        <details>
          <summary>Explanation validation details</summary>
          <p>
            Stage: {report.summaryDiagnostics.stage} · {report.summaryDiagnostics.code}
          </p>
          <ul>
            {report.summaryDiagnostics.issues.map((issue, index) => (
              <li key={index}>
                {issue.path}: {issue.code}
              </li>
            ))}
          </ul>
          <p>Rejected response text is not displayed or exported.</p>
        </details>
      )}
      {report.modelUsage?.usageIncomplete && (
        <p>
          Usage is incomplete; ${report.modelUsage.reservedCostUsd.toFixed(4)} remains reserved.
        </p>
      )}
      {!report.summary && (
        <section className="briefing-overview">
          <h3>{report.includeOverview ? 'AI overview unavailable' : 'Source details'}</h3>
          <p>
            {report.manifests.find((m) => m.description)?.description ||
              'Start with the project’s own documentation, then inspect the declared setup and packages below.'}
          </p>
          <p>
            {report.includeOverview
              ? 'This briefing collected source details, but did not produce an accepted AI overview. The reason is shown above. These details are not a generated summary.'
              : 'AI overview was not requested for this briefing. The source details below remain available.'}
          </p>
        </section>
      )}
      <CodeWalkthrough report={report} />
      <h3>Dive into the details</h3>
      <details className="briefing-deep">
        <summary>Project facts and languages</summary>
        <p>
          Languages by file extension:{' '}
          {report.languages.map((l) => `${l.name} (${l.files})`).join(', ') || 'None identified'}.
        </p>
        {report.manifests.map((m) => (
          <p key={m.path}>
            <strong>{m.name}</strong>
            {m.description ? ` — ${m.description}` : ' — no description declared'}.{' '}
            {link(m.path, m.startLine, m.endLine)}
          </p>
        ))}
      </details>
      <details className="briefing-deep">
        <summary>Repository map</summary>
        <p>Counts include only discovered files in the selected scope.</p>
        <div className="briefing-map">
          {report.directories.map((d) => (
            <div key={d.path}>
              <strong>{d.path}</strong>
              <span>{d.files} files</span>
            </div>
          ))}
        </div>
      </details>
      <details className="briefing-deep">
        <summary>Suggested reading order</summary>
        <p>
          Based on documentation, manifest declarations and filenames—not a verified execution path.
        </p>
        <ol>
          {report.readingOrder.map((r) => (
            <li key={r.path}>
              {link(r.path)}
              <p>{r.reason}</p>
            </li>
          ))}
        </ol>
      </details>
      <details className="briefing-deep">
        <summary>Getting started: requirements and scripts</summary>
        <p>
          Commands below are copied from manifests and have not been executed. Read project
          documentation before running them.
        </p>
        {!report.manifests.length && (
          <p>No supported manifests were parsed. See documentation and limitations below.</p>
        )}
        {report.manifests.map((m) => (
          <section key={m.path} className="briefing-package">
            <h4>{m.name}</h4>
            {link(m.path, m.startLine, m.endLine)}
            <p>
              Working directory:{' '}
              <code>
                {m.path.includes('/')
                  ? m.path.slice(0, m.path.lastIndexOf('/'))
                  : 'repository root'}
              </code>
            </p>
            <p>
              Package manager: {m.packageManager || 'not declared'} · Engine requirements:{' '}
              {Object.entries(m.engines)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ') || 'not declared'}
            </p>
            {!Object.keys(m.scripts).length && <p>No scripts declared.</p>}
            <dl>
              {Object.entries(m.scripts).map(([name, command]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    <code>{command}</code>
                  </dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>
                Declared dependencies ({Object.keys(m.dependencies).length}) and development
                dependencies ({Object.keys(m.developmentDependencies).length})
              </summary>
              <p>Declarations do not prove runtime use.</p>
              <h5>Dependencies</h5>
              <ul>
                {Object.entries(m.dependencies).map(([n, v]) => (
                  <li key={n}>
                    {n}: {v}
                  </li>
                ))}
              </ul>
              <h5>Development dependencies</h5>
              <ul>
                {Object.entries(m.developmentDependencies).map(([n, v]) => (
                  <li key={n}>
                    {n}: {v}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        ))}
      </details>
      <details className="briefing-deep">
        <summary>Read the source documentation</summary>
        <p>Literal repository documentation, not independently verified instructions.</p>
        {report.documents.map((d) => (
          <details key={d.path}>
            <summary>
              {d.path} {d.complete ? '(complete file)' : '(excerpt)'}
            </summary>
            {link(d.path, d.startLine, d.endLine)}
            <pre className="briefing-document">{d.text}</pre>
          </details>
        ))}
      </details>
      <details className="briefing-deep">
        <summary>Test locations</summary>
        <p>Detected by filename. No tests executed; at most 30 paths shown.</p>
        <ul>
          {report.testFiles.map((p) => (
            <li key={p}>{link(p)}</li>
          ))}
        </ul>
      </details>
      <details className="briefing-deep">
        <summary>Missing information and limits</summary>
        <ul>
          {report.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}
