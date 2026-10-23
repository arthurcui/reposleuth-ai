import type { Investigation } from '@reposleuth/shared';
import { sourceUrl } from './client';

export function Report({ run }: { run: Investigation }) {
  const report = run.report;
  if (!report) return null;
  return <section className="report" aria-labelledby="report-title">
    <div className="panel"><p className="eyebrow">ENGINEERING REPORT</p><h2 id="report-title">What the evidence tells us</h2><p>{report.summary}</p><p className="muted">Source references support the reasoning. Proposed fixes have not been applied or tested.</p></div>
    {report.findings.map((finding, index) => <article className="panel" key={index}>
      <div className="panel-heading"><h3>{finding.title}</h3><span className="badge">{finding.kind} · {finding.confidence} confidence</span></div>
      <p>{finding.explanation}</p><p className="muted"><strong>Uncertainty: </strong>{finding.uncertainty}</p>
      <div className="references">{finding.evidenceIds.map(id => <a key={id} href={`#evidence-${encodeURIComponent(id)}`}>{id} ↗</a>)}</div>
    </article>)}
    <section className="panel"><h3>Source evidence</h3>{report.evidence.map(evidence => {
      const url = run.id === 'demo' ? null : sourceUrl(run.request.repository, evidence.commitSha, evidence.path, evidence.startLine, evidence.endLine);
      return <details open key={evidence.id} id={`evidence-${encodeURIComponent(evidence.id)}`}>
        <summary>{evidence.id} · {evidence.path}:{evidence.startLine}–{evidence.endLine}</summary>
        <p className="muted">Commit {evidence.commitSha.slice(0, 12)} {url && <a href={url} target="_blank" rel="noreferrer">Open on GitHub ↗</a>}</p>
        <pre><code>{evidence.quote.split('\n').map((line, index) => <span className="code-line" key={index}><span className="line-number" aria-hidden="true">{evidence.startLine + index}</span>{line}{'\n'}</span>)}</code></pre>
      </details>;
    })}</section>
    <div className="report-grid">{([['Proposed fixes', report.recommendations], ['Suggested verification', report.testPlan], ['Risks', report.risks], ['Open questions', report.unresolvedQuestions]] as const).map(([title, items]) =>
      <section className="panel" key={title}><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">None reported.</p>}</section>)}</div>
  </section>;
}
