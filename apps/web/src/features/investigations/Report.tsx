/** Renders findings, cited evidence, proposed fixes, and uncertainty for an investigation. */
import type { Investigation } from '@reposleuth/shared';

import { demoDetails } from '../demo/demoDetails';
import { sourceUrl } from './client';

export function Report({ run }: { run: Investigation }) {
  const report = run.report;
  if (!report) return null;
  const caseId = run.request.repository.split('/')[1] ?? '';
  const detail = run.id === 'demo' ? demoDetails[caseId] : undefined;
  const evidenceLabel = (id: string) =>
    `#${report.evidence.findIndex((item) => item.id === id) + 1}`;
  return (
    <section className="report" aria-labelledby="report-title">
      <div className="panel">
        <p className="eyebrow">ENGINEERING REPORT</p>
        <h2 id="report-title">What the evidence tells us</h2>
        <p>{report.summary}</p>
        <div aria-label="Report verification">
          <p>
            <strong>
              {report.verification?.coverage === 'insufficient_evidence'
                ? 'Insufficient evidence'
                : report.verification?.coverage === 'partial'
                  ? 'Partial investigation'
                  : 'Generated report'}
            </strong>{' '}
            � Diagnosis unverified � Runtime not tested
          </p>
          <p className="muted">
            {report.verification
              ? `${report.verification.filesExamined.length} files examined � ${report.verification.rangesExamined} source ranges � ${report.verification.sourceCitations === 'validated' ? 'Citations matched retrieved source' : 'No source citations'}`
              : 'Verification details were not recorded for this saved report.'}
          </p>
        </div>
        <p className="muted">
          Citations identify retrieved source; they do not independently verify the diagnosis.
          Proposed fixes have not been applied or tested.
        </p>
      </div>
      {report.reasoningSummary && (
        <section className="panel" aria-label="Evidence-based reasoning summary">
          <h3>Evidence-based reasoning summary</h3>
          {(
            [
              [
                'Assessment',
                [
                  {
                    explanation: report.reasoningSummary.assessment,
                    evidenceIds: report.reasoningSummary.evidenceIds,
                  },
                ],
              ],
              ['Alternatives considered', report.reasoningSummary.alternatives],
              ['Counter-evidence checked', report.reasoningSummary.counterEvidence],
            ] as const
          ).map(([title, entries]) => (
            <div key={title}>
              <h4>{title}</h4>
              {!entries.length && <p className="muted">No assessment recorded.</p>}
              {entries.map((entry, index) => (
                <div key={index}>
                  <p>{entry.explanation}</p>
                  {!entry.evidenceIds.length && (
                    <p className="muted small">Unverified · no source citation</p>
                  )}
                  <div className="references">
                    {entry.evidenceIds.map((id) => (
                      <a key={id} href={`#evidence-${encodeURIComponent(id)}`}>
                        View evidence {evidenceLabel(id)} ↓
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <p className="muted">
            <strong>Limitations: </strong>
            {report.reasoningSummary.limitations}
          </p>
        </section>
      )}
      {report.findings.map((finding, index) => (
        <article className="panel" key={index}>
          <div className="panel-heading">
            <h3>{finding.title}</h3>
            <span className="badge">
              {finding.kind} · {finding.confidence} confidence
            </span>
          </div>
          <p>{finding.explanation}</p>
          <p className="muted">
            <strong>Uncertainty: </strong>
            {finding.uncertainty}
          </p>
          <div className="references">
            {finding.evidenceIds.map((id) => (
              <a key={id} href={`#evidence-${encodeURIComponent(id)}`}>
                View evidence {evidenceLabel(id)} ↓
              </a>
            ))}
          </div>
        </article>
      ))}
      <section className="panel">
        <h3>Source evidence</h3>
        {report.evidence.map((evidence) => {
          const url =
            run.id === 'demo'
              ? null
              : sourceUrl(
                  run.request.repository,
                  evidence.commitSha,
                  evidence.path,
                  evidence.startLine,
                  evidence.endLine,
                );
          return (
            <details open key={evidence.id} id={`evidence-${encodeURIComponent(evidence.id)}`}>
              <summary>
                {evidenceLabel(evidence.id)} · {evidence.path}:{evidence.startLine}–
                {evidence.endLine}
              </summary>
              <p className="muted">
                Commit {evidence.commitSha.slice(0, 12)}{' '}
                {url && (
                  <a href={url} target="_blank" rel="noreferrer">
                    Open on GitHub ↗
                  </a>
                )}
              </p>
              {detail && (
                <p className="muted small">
                  Implement {caseId.replaceAll('-', ' ')} handler ·{' '}
                  {new Date(run.createdAt).toISOString().slice(0, 10)}
                </p>
              )}
              <pre>
                <code>
                  {evidence.quote.split('\n').map((line, index) => (
                    <span className="code-line" key={index}>
                      <span className="line-number" aria-hidden="true">
                        {evidence.startLine + index}
                      </span>
                      {line}
                      {'\n'}
                    </span>
                  ))}
                </code>
              </pre>
            </details>
          );
        })}
      </section>
      <section className="panel">
        <h3>Proposed fixes</h3>
        <ul>
          {report.recommendations.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
        {detail && (
          <>
            <p>{detail.explanation}</p>
            <pre aria-label="Proposed fix code">
              <code>{detail.code}</code>
            </pre>
          </>
        )}
      </section>
      <div className="report-grid">
        {(
          [
            ['Suggested verification', report.testPlan],
            ['Risks', report.risks],
            ['Open questions', report.unresolvedQuestions],
          ] as const
        ).map(([title, items]) => (
          <section className="panel" key={title}>
            <h3>{title}</h3>
            {items.length ? (
              <ul>
                {items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">None reported.</p>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
