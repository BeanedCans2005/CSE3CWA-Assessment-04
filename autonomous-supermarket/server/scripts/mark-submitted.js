import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/init.js';

const runId = process.argv[2];
const db = openDb(fileURLToPath(new URL('../src/db/supermarket.db', import.meta.url)));
const run = runId && db.prepare('SELECT status FROM runs WHERE run_id=?').get(runId);
if (!run || run.status !== 'COMPLETED') { console.error('Usage: npm run mark-submitted -- <RUN-ID of a COMPLETED run>'); process.exit(1); }
db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('submitted_run_id', ?)`).run(runId);
console.log('Submitted Run set to', runId);