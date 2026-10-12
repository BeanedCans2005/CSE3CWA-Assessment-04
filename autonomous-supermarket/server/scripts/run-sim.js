import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/init.js';
import { PRODUCTS } from '../src/sim/catalogue.js';
import { DEMAND_CONFIG } from '../src/sim/demandConfig.js';
import { BRAIN_CONFIG } from '../src/sim/brainConfig.js';
import { runSimulation } from '../src/sim/engine.js';

const dbPath = fileURLToPath(new URL('../src/db/supermarket.db', import.meta.url));
const seed = Number(process.argv[2]) || 2026;
const db = openDb(dbPath);

const t0 = Date.now();
const runId = runSimulation(db, { seed, products: PRODUCTS, demandCfg: DEMAND_CONFIG, brainCfg: BRAIN_CONFIG });
console.log(`${runId} completed in ${Date.now() - t0} ms`);

const one = (sql, ...a) => db.prepare(sql).get(...a);
const rev = one(`SELECT SUM(total_cents) v FROM transactions WHERE run_id=?`, runId).v;
const dailyRev = one(`SELECT SUM(revenue_cents) v FROM daily_summaries WHERE run_id=?`, runId).v;
const spend = one(`SELECT COALESCE(SUM(total_cost_cents),0) v FROM replenishment_orders WHERE run_id=?`, runId).v;
const cash = one(`SELECT closing_cash_cents v FROM daily_summaries WHERE run_id=? AND day=60`, runId).v;
const inv = db.prepare(`
  SELECT m.product_id, SUM(CASE WHEN m.type IN ('OPENING','RECEIVED') THEN m.qty ELSE -m.qty END) AS q,
         s.closing_qty AS snap
  FROM inventory_movements m
  JOIN daily_product_snapshots s ON s.run_id=m.run_id AND s.product_id=m.product_id AND s.day=60
  WHERE m.run_id=? GROUP BY m.product_id`).all(runId);
const expiredSold = one(`
  SELECT COUNT(*) v FROM inventory_movements m JOIN stock_batches b ON b.batch_id=m.batch_id
  WHERE m.run_id=? AND m.type='SOLD' AND b.expiry_day IS NOT NULL AND m.day >= b.expiry_day`, runId).v;

console.log('Revenue (txns = daily sums):', rev === dailyRev ? 'PASS' : 'FAIL', rev, dailyRev);
console.log('Cash (15000 + rev - spend):  ', cash === 1500000 + rev - spend ? 'PASS' : 'FAIL', cash);
console.log('Inventory (movements = closing):', inv.every((r) => r.q === r.snap) ? 'PASS' : 'FAIL');
console.log('Negative stock:', inv.some((r) => r.q < 0) ? 'FAIL' : 'PASS', '| expired sales:', expiredSold);
console.table(db.prepare(`SELECT event_type, COUNT(*) n FROM brain_events WHERE run_id=? GROUP BY event_type`).all(runId));
console.log('Lost to stockouts: A$',
  (one(`SELECT COALESCE(SUM(lost_revenue_cents),0) v FROM unmet_demand WHERE run_id=?`, runId).v / 100).toFixed(2));