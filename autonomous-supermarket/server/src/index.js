import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { openDb } from './db/init.js';
import { PRODUCTS } from './sim/catalogue.js';
import { DEMAND_CONFIG } from './sim/demandConfig.js';
import { BRAIN_CONFIG } from './sim/brainConfig.js';
import { runSimulation } from './sim/engine.js';
import * as R from './reports.js';

const db = openDb(fileURLToPath(new URL('./db/supermarket.db', import.meta.url)));
const app = express();
app.use(cors());
app.use(express.json());

app.param('runId', (req, res, next, id) => {
  if (!db.prepare('SELECT 1 FROM runs WHERE run_id=?').get(id)) return res.status(404).json({ error: 'Unknown run' });
  next();
});

const submitted = () => db.prepare(`SELECT value FROM app_settings WHERE key='submitted_run_id'`).get()?.value ?? null;

app.get('/api/submitted', (_q, res) => res.json({ run_id: submitted() }));
app.get('/api/runs', (_q, res) => res.json({ submitted: submitted(), runs: R.listRuns(db) }));
app.post('/api/runs', (req, res) => {                      // new runs only; history is never edited
  const seed = Number(req.body?.seed) || Math.floor(Math.random() * 1e6);
  const runId = runSimulation(db, { seed, products: PRODUCTS, demandCfg: DEMAND_CONFIG, brainCfg: BRAIN_CONFIG });
  res.status(201).json({ run_id: runId });
});
app.get('/api/runs/:runId/declaration', (q, res) => res.json(R.getDeclaration(db, q.params.runId)));
app.get('/api/runs/:runId/report', (q, res) => res.json(R.getReport(db, q.params.runId)));
app.get('/api/runs/:runId/assurance', (q, res) => res.json(R.getAssurance(db, q.params.runId)));
app.get('/api/runs/:runId/days/:day', (q, res) => {
  const d = R.getDay(db, q.params.runId, Number(q.params.day));
  d ? res.json(d) : res.status(404).json({ error: 'Unknown day' });
});
app.get('/api/runs/:runId/days/:day/transactions', (q, res) =>
  res.json(R.getDayTransactions(db, q.params.runId, Number(q.params.day),
    Math.min(Number(q.query.limit) || 50, 200), Number(q.query.offset) || 0)));
app.get('/api/runs/:runId/products/:pid', (q, res) => res.json(R.getProduct(db, q.params.runId, q.params.pid)));

app.use((err, _q, res, _n) => { console.error(err); res.status(500).json({ error: err.message }); });
const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API on http://localhost:${port}`));