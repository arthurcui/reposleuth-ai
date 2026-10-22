import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { healthSchema } from '@reposleuth/shared';
import './styles.css';

function App() {
  const [status, setStatus] = useState('Checking local API…');
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    async function check() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal });
        if (!response.ok) throw new Error('Unavailable');
        healthSchema.parse(await response.json());
        setStatus('Local API connected');
      } catch { setStatus('API unavailable — start both apps with npm run dev'); }
      finally { clearTimeout(timeout); }
    }
    void check();
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);
  return <main>
    <header><a className="brand" href="/">◈ RepoSleuth <span>AI</span></a><span className="badge">LOCAL · READ ONLY</span></header>
    <section className="intro">
      <p className="eyebrow">AUTONOMOUS ISSUE & CODE INVESTIGATOR</p>
      <h1>Follow the code.<br /><span>Find the evidence.</span></h1>
      <p className="description">Investigate software defects with source references, clear hypotheses, and actionable engineering reports.</p>
    </section>
    <section className="panel" aria-labelledby="workspace-title">
      <div className="panel-heading"><h2 id="workspace-title">Investigation workspace</h2><span className="badge">STAGE 1 / 5</span></div>
      <p role="status" className="status">{status}</p>
      <p>The local foundation is ready. Repository selection and issue retrieval arrive in the next stage.</p>
      <ol className="stages">
        <li className="current"><strong>01</strong><span>Foundation<small>Local app & API</small></span></li>
        <li><strong>02</strong><span>GitHub<small>Read repository evidence</small></span></li>
        <li><strong>03</strong><span>Agent engine<small>Bounded investigation</small></span></li>
        <li><strong>04</strong><span>Investigation UI<small>Timeline & reports</small></span></li>
        <li><strong>05</strong><span>Reliability<small>Evaluation & demo</small></span></li>
      </ol>
    </section>
    <footer>Public repositories · Evidence-backed findings · No code execution</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
