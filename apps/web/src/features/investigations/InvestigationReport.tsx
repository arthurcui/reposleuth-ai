/** Renders an engineering report with navigation between illustrative demo cases. */
import { demoCases } from '../demo/demo';
import { Report } from './Report';
import type { InvestigationWorkspace } from './useInvestigationWorkspace';
export function InvestigationReport({ workspace }: { workspace: InvestigationWorkspace }) {
  const { run, showingDemo, caseIndex, selectCase } = workspace;
  return (
    <>
      {' '}
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
    </>
  );
}
