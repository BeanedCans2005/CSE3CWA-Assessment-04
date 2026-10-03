PRAGMA foreign_keys = ON;

-- ============ CONFIGURATION (frozen once the run starts) ============
CREATE TABLE runs (
  run_id              TEXT PRIMARY KEY,           -- e.g. RUN-2026-10-03-0001
  status              TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED')),
  created_at          TEXT NOT NULL,
  completed_at        TEXT,
  sim_days            INTEGER NOT NULL DEFAULT 60,
  rng_seed            INTEGER NOT NULL,
  opening_cash_cents  INTEGER NOT NULL,
  inventory_budget_cents INTEGER NOT NULL,
  config_json         TEXT NOT NULL               -- demand model + brain rules snapshot
);

CREATE TABLE run_products (
  run_id            TEXT NOT NULL REFERENCES runs(run_id),
  product_id        TEXT NOT NULL,
  name              TEXT NOT NULL,                -- includes pack size, e.g. "Full Cream Milk 2L"
  category          TEXT NOT NULL,
  unit_cost_cents   INTEGER NOT NULL CHECK (unit_cost_cents > 0),
  unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents > 0),
  initial_qty       INTEGER NOT NULL CHECK (initial_qty >= 0),
  is_perishable     INTEGER NOT NULL CHECK (is_perishable IN (0,1)),
  shelf_life_days   INTEGER,
  PRIMARY KEY (run_id, product_id),
  CHECK ((is_perishable = 0 AND shelf_life_days IS NULL)
      OR (is_perishable = 1 AND shelf_life_days > 0))
);

-- ============ HISTORY (append-only) ============
-- One row per received lot. Remaining stock is NOT stored here;
-- it is derived from inventory_movements.
CREATE TABLE stock_batches (
  batch_id          INTEGER PRIMARY KEY,
  run_id            TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  received_day      INTEGER NOT NULL,
  qty_received      INTEGER NOT NULL CHECK (qty_received > 0),
  unit_cost_cents   INTEGER NOT NULL,
  expiry_day        INTEGER,                      -- first day it is NOT sellable; NULL if non-perishable
  source            TEXT NOT NULL CHECK (source IN ('OPENING','ORDER')),
  order_id          INTEGER,
  FOREIGN KEY (run_id, product_id) REFERENCES run_products(run_id, product_id)
);

CREATE TABLE customers (
  customer_id       INTEGER PRIMARY KEY,
  run_id            TEXT NOT NULL,
  day               INTEGER NOT NULL,
  hour              INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  mission           TEXT NOT NULL,
  made_purchase     INTEGER NOT NULL CHECK (made_purchase IN (0,1))
);

CREATE TABLE transactions (
  txn_id            INTEGER PRIMARY KEY,
  run_id            TEXT NOT NULL,
  customer_id       INTEGER NOT NULL REFERENCES customers(customer_id),
  day               INTEGER NOT NULL,
  hour              INTEGER NOT NULL,
  units             INTEGER NOT NULL CHECK (units > 0),
  total_cents       INTEGER NOT NULL CHECK (total_cents > 0)
);

CREATE TABLE transaction_items (
  item_id           INTEGER PRIMARY KEY,
  run_id            TEXT NOT NULL,
  txn_id            INTEGER NOT NULL REFERENCES transactions(txn_id),
  product_id        TEXT NOT NULL,
  qty               INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents  INTEGER NOT NULL,
  line_total_cents  INTEGER NOT NULL,
  FOREIGN KEY (run_id, product_id) REFERENCES run_products(run_id, product_id)
);

-- Every stock change. qty is always positive; type gives the direction.
CREATE TABLE inventory_movements (
  movement_id       INTEGER PRIMARY KEY,
  run_id            TEXT NOT NULL,
  day               INTEGER NOT NULL,
  product_id        TEXT NOT NULL,
  batch_id          INTEGER NOT NULL REFERENCES stock_batches(batch_id),
  type              TEXT NOT NULL CHECK (type IN ('OPENING','RECEIVED','SOLD','EXPIRED')),
  qty               INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_cents   INTEGER NOT NULL,
  txn_id            INTEGER REFERENCES transactions(txn_id),   -- for SOLD
  order_id          INTEGER                                     -- for RECEIVED
);

CREATE TABLE replenishment_orders (
  order_id            INTEGER PRIMARY KEY,
  run_id              TEXT NOT NULL,
  placed_day          INTEGER NOT NULL,
  arrival_day         INTEGER NOT NULL,           -- always placed_day + 1
  total_cost_cents    INTEGER NOT NULL,
  cash_before_cents   INTEGER NOT NULL,           -- cash available when placed
  cash_after_cents    INTEGER NOT NULL,
  was_constrained     INTEGER NOT NULL CHECK (was_constrained IN (0,1)),
  CHECK (total_cost_cents <= cash_before_cents)
);

CREATE TABLE replenishment_lines (
  line_id           INTEGER PRIMARY KEY,
  run_id            TEXT NOT NULL,
  order_id          INTEGER NOT NULL REFERENCES replenishment_orders(order_id),
  product_id        TEXT NOT NULL,
  qty_wanted        INTEGER NOT NULL,             -- what the rules asked for
  qty_ordered       INTEGER NOT NULL,             -- what cash allowed
  unit_cost_cents   INTEGER NOT NULL,
  reason            TEXT NOT NULL,
  FOREIGN KEY (run_id, product_id) REFERENCES run_products(run_id, product_id)
);

-- Daily SALE entry + ORDER entries. amount is signed.
CREATE TABLE cash_ledger (
  entry_id            INTEGER PRIMARY KEY,
  run_id              TEXT NOT NULL,
  day                 INTEGER NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('SALE','ORDER')),
  amount_cents        INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  order_id            INTEGER REFERENCES replenishment_orders(order_id)
);

CREATE TABLE brain_events (
  event_id          INTEGER PRIMARY KEY,
  run_id            TEXT NOT NULL,
  day               INTEGER NOT NULL,
  product_id        TEXT,
  event_type        TEXT NOT NULL CHECK (event_type IN
    ('LOW_STOCK','SOLD_OUT','EXPIRY_WARNING','EXPIRY_REMOVAL',
     'SLOW_MOVER','REORDER','CASH_CONSTRAINED')),
  detail_json       TEXT NOT NULL,                -- the numbers that triggered it
  action_taken      TEXT NOT NULL,
  outcome           TEXT,
  order_id          INTEGER REFERENCES replenishment_orders(order_id)
);

-- Per-product per-day closing record (written by the engine, checked by assurance)
CREATE TABLE daily_product_snapshots (
  run_id            TEXT NOT NULL,
  day               INTEGER NOT NULL,
  product_id        TEXT NOT NULL,
  opening_qty       INTEGER NOT NULL,
  received_qty      INTEGER NOT NULL,
  sold_qty          INTEGER NOT NULL,
  expired_qty       INTEGER NOT NULL,
  closing_qty       INTEGER NOT NULL,
  PRIMARY KEY (run_id, day, product_id)
);

CREATE TABLE daily_summaries (
  run_id              TEXT NOT NULL,
  day                 INTEGER NOT NULL,
  weekday             INTEGER NOT NULL,
  customers           INTEGER NOT NULL,
  transactions        INTEGER NOT NULL,
  units_sold          INTEGER NOT NULL,
  revenue_cents       INTEGER NOT NULL,
  cogs_cents          INTEGER NOT NULL,
  writeoff_cents      INTEGER NOT NULL,
  order_spend_cents   INTEGER NOT NULL,
  closing_cash_cents  INTEGER NOT NULL,
  closing_inventory_cents INTEGER NOT NULL,
  PRIMARY KEY (run_id, day)
);

-- NOT history: a pointer to which run is the Submitted Run
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_txn_run_day     ON transactions(run_id, day);
CREATE INDEX idx_items_txn       ON transaction_items(txn_id);
CREATE INDEX idx_mov_run_day     ON inventory_movements(run_id, day, product_id);
CREATE INDEX idx_mov_batch       ON inventory_movements(batch_id);
CREATE INDEX idx_events_run_day  ON brain_events(run_id, day, event_type);
CREATE INDEX idx_cust_run_day    ON customers(run_id, day);