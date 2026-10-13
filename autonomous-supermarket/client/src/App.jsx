import { useEffect, useState } from 'react';
import { get } from './util.jsx';
import { Declaration, Runs, Report, Daily, Assurance } from './Pages.jsx';

const TABS = [['declaration', 'Model Declaration'], ['runs', 'Runs'], ['report', '60-Day Report'], ['daily', 'Daily Report'], ['assurance', 'Assurance']];

export default function App() {
  const [tab, setTab] = useState('report');
  const [runs, setRuns] = useState([]);
  const [submitted, setSubmitted] = useState(null);
  const [runId, setRunId] = useState(null);
  const [day, setDay] = useState(1);

  const refresh = () => get('/runs').then((d) => { setRuns(d.runs); setSubmitted(d.submitted); setRunId((cur) => cur ?? d.submitted ?? d.runs[0]?.run_id ?? null); });
  useEffect(() => { refresh(); }, []);                      // eslint-disable-line
  const go = (t, d) => { if (d) setDay(d); setTab(t); window.scrollTo(0, 0); };

  return (
    <div className="app">
      <header>
        <h1>Autonomous Supermarket — Swanston St</h1>
        <div className="runpick">
          <label>Run: </label>
          <select value={runId ?? ''} onChange={(e) => setRunId(e.target.value)}>
            {runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.run_id}{r.run_id === submitted ? ' (Submitted Run)' : ''}</option>)}
          </select>
          {runId && runId !== submitted && <span className="badge bad">not the Submitted Run</span>}
        </div>
        <nav>{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      </header>
      <main>
        {!runId ? <p>No runs yet. Run <code>npm run sim</code> in /server.</p> : <>
          {tab === 'declaration' && <Declaration runId={runId} />}
          {tab === 'runs' && <Runs runs={runs} submitted={submitted} runId={runId} setRunId={setRunId} refresh={refresh} />}
          {tab === 'report' && <Report runId={runId} go={go} />}
          {tab === 'daily' && <Daily runId={runId} day={day} setDay={setDay} />}
          {tab === 'assurance' && <Assurance runId={runId} submitted={submitted} />}
        </>}
      </main>
    </div>
  );
}