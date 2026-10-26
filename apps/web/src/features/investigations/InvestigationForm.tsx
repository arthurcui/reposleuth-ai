/** Renders the live/demo investigation form and explicit submission controls. */
import { investigationModes, investigationModeSchema } from '@reposleuth/shared';

import { ModelPicker } from './ModelPicker';
import type { InvestigationWorkspace } from './useInvestigationWorkspace';
export function InvestigationForm({ workspace }: { workspace: InvestigationWorkspace }) {
  const {
    mode,
    setMode,
    showingDemo,
    repository,
    setRepository,
    issue,
    setIssue,
    question,
    setQuestion,
    modelSelection,
    setModelSelection,
    formDisabled,
    submit,
    run,
    active,
    leaveDemo,
    busy,
    submitting,
    select,
  } = workspace;
  return (
    <>
      <section className={`panel${showingDemo ? ' demo-mode' : ''}`}>
        <div className="panel-heading">
          <h2>{showingDemo ? 'Demo investigation' : 'Start an investigation'}</h2>
          {showingDemo && <span className="badge">DEMO MODE</span>}
        </div>
        {showingDemo && (
          <p className="notice" role="status">
            You’re viewing curated examples. Live inputs are disabled. Choose one of the 20 cases in
            the activity panel.
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
          <label htmlFor="investigation-mode">Investigation mode</label>
          <select
            id="investigation-mode"
            value={mode}
            disabled={formDisabled}
            aria-describedby="mode-description"
            onChange={(event) => setMode(investigationModeSchema.parse(event.target.value))}
          >
            {Object.entries(investigationModes).map(([key, profile]) => (
              <option key={key} value={key}>
                {profile.label} · up to {profile.timeoutMs / 60000} min · $
                {profile.costUsd.toFixed(2)}
              </option>
            ))}
          </select>
          <p id="mode-description" className="muted small">
            {investigationModes[mode].description} Limits: {investigationModes[mode].turns} model
            requests, {investigationModes[mode].tools} tool calls and{' '}
            {investigationModes[mode].tokens.toLocaleString()} tokens. Cost is estimated;
            conservative reservations and the server budget may stop a run earlier.
          </p>
          <ModelPicker
            value={modelSelection}
            onChange={setModelSelection}
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
    </>
  );
}
