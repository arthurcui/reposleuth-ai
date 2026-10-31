/** Presents a source-cited explanation and expandable excerpts without implying runtime verification. */
import { type Briefing, briefingSourceUrl } from '@reposleuth/shared';

export function CodeWalkthrough({ report }: { report: Briefing }) {
  if (!report.codeSources) return null;
  const walk = report.summary?.codeWalkthrough;
  return (
    <section className="briefing-overview" aria-label="How this project works">
      <h3>How this project works</h3>
      {report.walkthroughError && <p role="status">{report.walkthroughError}</p>}
      {walk ? (
        <>
          <h4>{walk.title}</h4>
          <p className="briefing-prose">{walk.overview}</p>
          {walk.trigger && (
            <p>
              <strong>Starts with:</strong> {walk.trigger}
            </p>
          )}
          {walk.result && (
            <p>
              <strong>Leads to:</strong> {walk.result}
            </p>
          )}
          <ol>
            {walk.steps.map((step, index) => (
              <li key={index}>
                <h4>{step.title}</h4>
                <p className="briefing-prose">{step.explanation}</p>
                <p>
                  <strong>As you read:</strong> {step.readingTip}
                </p>
                <div className="briefing-citations">
                  {step.sources.map((s, i) => (
                    <a
                      key={i}
                      href={briefingSourceUrl(report, s.path, s.startLine, s.endLine)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.path}:{s.startLine}–{s.endLine} ↗
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <p>AI interpretation of static source excerpts; this route has not been executed.</p>
          <ul>
            {walk.limitations.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          No supported code-flow explanation is available for this briefing. The source coverage
          below shows what was read.
        </p>
      )}
      <details className="briefing-deep">
        <summary>Explore the source and coverage ({report.codeSources.length} files)</summary>
        {report.codeSources.map((s) => (
          <details key={s.path}>
            <summary>
              {s.path} · lines {s.startLine}–{s.endLine}
            </summary>
            <p>{s.reason}</p>
            <a
              href={briefingSourceUrl(report, s.path, s.startLine, s.endLine)}
              target="_blank"
              rel="noreferrer"
            >
              Open pinned source ↗
            </a>
            <pre className="briefing-document">
              {s.text
                .split('\n')
                .map((line, i) => `${s.startLine + i}  ${line}`)
                .join('\n')}
            </pre>
          </details>
        ))}
        <ul>
          {report.codeCoverage?.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
