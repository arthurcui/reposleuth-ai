/** Composes the investigation workspace and saved-history panel. */
import { useState } from 'react';

import { InvestigationHistory } from './features/history/InvestigationHistory';
import { InvestigationActivity } from './features/investigations/InvestigationActivity';
import { InvestigationForm } from './features/investigations/InvestigationForm';
import { InvestigationReport } from './features/investigations/InvestigationReport';
import { useInvestigationWorkspace } from './features/investigations/useInvestigationWorkspace';
export function App() {
  const [showHistory, setShowHistory] = useState(false);
  const workspace = useInvestigationWorkspace();
  const { select } = workspace;
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
        <InvestigationForm workspace={workspace} />
        <InvestigationActivity workspace={workspace} />
      </div>
      <InvestigationReport workspace={workspace} />
      <footer>Public repositories · Evidence-backed findings · No code execution</footer>
    </main>
  );
}
