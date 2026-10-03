import Database from 'better-sqlite3';
import fs from 'node:fs';

const HISTORY_TABLES = [
  'run_products', 'stock_batches', 'customers', 'transactions',
  'transaction_items', 'inventory_movements', 'replenishment_orders',
  'replenishment_lines', 'cash_ledger', 'brain_events',
  'daily_product_snapshots', 'daily_summaries',
];

export function initDb(path) {
  const db = new Database(path);
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

  for (const t of HISTORY_TABLES) {
    db.exec(`
      CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t}
      BEGIN SELECT RAISE(ABORT, '${t} is append-only: UPDATE blocked'); END;

      CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t}
      BEGIN SELECT RAISE(ABORT, '${t} is append-only: DELETE blocked'); END;

      CREATE TRIGGER ${t}_no_insert_after_complete BEFORE INSERT ON ${t}
      WHEN (SELECT status FROM runs WHERE run_id = NEW.run_id) = 'COMPLETED'
      BEGIN SELECT RAISE(ABORT, 'run is COMPLETED: no new history allowed'); END;
    `);
  }

  db.exec(`
    -- runs: the only permitted change is RUNNING -> COMPLETED (+ completed_at)
    CREATE TRIGGER runs_no_delete BEFORE DELETE ON runs
    BEGIN SELECT RAISE(ABORT, 'runs cannot be deleted'); END;

    CREATE TRIGGER runs_frozen BEFORE UPDATE ON runs
    WHEN NOT (
      OLD.status = 'RUNNING' AND NEW.status = 'COMPLETED'
      AND NEW.run_id = OLD.run_id
      AND NEW.config_json = OLD.config_json
      AND NEW.rng_seed = OLD.rng_seed
      AND NEW.opening_cash_cents = OLD.opening_cash_cents
      AND NEW.inventory_budget_cents = OLD.inventory_budget_cents
    )
    BEGIN SELECT RAISE(ABORT, 'run configuration is frozen'); END;
  `);
  return db;
}