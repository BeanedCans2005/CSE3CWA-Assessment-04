const A = (db, sql, p) => db.prepare(sql).all(p);
const G = (db, sql, p) => db.prepare(sql).get(p);

export function listRuns(db) {
  return A(db, `
    SELECT r.run_id, r.status, r.created_at, r.completed_at, r.rng_seed,
      (SELECT COUNT(*) FROM daily_summaries d WHERE d.run_id=r.run_id) AS days,
      (SELECT COALESCE(SUM(revenue_cents),0) FROM daily_summaries d WHERE d.run_id=r.run_id) AS revenue_cents,
      (SELECT closing_cash_cents FROM daily_summaries d WHERE d.run_id=r.run_id AND d.day=60) AS closing_cash_cents
    FROM runs r ORDER BY r.created_at DESC`, {});
}

export function getDeclaration(db, r) {
  const run = G(db, `SELECT * FROM runs WHERE run_id=@r`, { r });
  const products = A(db, `SELECT *, unit_cost_cents*initial_qty AS opening_value_cents
                          FROM run_products WHERE run_id=@r ORDER BY category, product_id`, { r });
  return {
    run: { ...run, config_json: undefined },
    config: JSON.parse(run.config_json),
    products,
    opening_inventory_cents: products.reduce((s, p) => s + p.opening_value_cents, 0),
  };
}

export function getReport(db, r) {
  const g = (sql) => G(db, sql, { r }).v;
  const a = (sql) => A(db, sql, { r });

  const totals = {
    customers: g(`SELECT COUNT(*) v FROM customers WHERE run_id=@r`),
    transactions: g(`SELECT COUNT(*) v FROM transactions WHERE run_id=@r`),
    units_sold: g(`SELECT COALESCE(SUM(qty),0) v FROM transaction_items WHERE run_id=@r`),
    revenue_cents: g(`SELECT COALESCE(SUM(total_cents),0) v FROM transactions WHERE run_id=@r`),
    cogs_cents: g(`SELECT COALESCE(SUM(qty*unit_cost_cents),0) v FROM inventory_movements WHERE run_id=@r AND type='SOLD'`),
    writeoff_units: g(`SELECT COALESCE(SUM(qty),0) v FROM inventory_movements WHERE run_id=@r AND type='EXPIRED'`),
    writeoff_cents: g(`SELECT COALESCE(SUM(qty*unit_cost_cents),0) v FROM inventory_movements WHERE run_id=@r AND type='EXPIRED'`),
    replenishment_spend_cents: g(`SELECT COALESCE(SUM(total_cost_cents),0) v FROM replenishment_orders WHERE run_id=@r`),
    closing_cash_cents: g(`SELECT balance_after_cents v FROM cash_ledger WHERE run_id=@r ORDER BY entry_id DESC LIMIT 1`),
    closing_inventory_cents: g(`SELECT COALESCE(SUM(s.closing_qty*p.unit_cost_cents),0) v
      FROM daily_product_snapshots s JOIN run_products p ON p.run_id=s.run_id AND p.product_id=s.product_id
      WHERE s.run_id=@r AND s.day=60`),
  };
  totals.gross_profit_cents = totals.revenue_cents - totals.cogs_cents;
  totals.avg_units_per_txn = +(totals.units_sold / totals.transactions).toFixed(2);
  totals.avg_txn_value_cents = Math.round(totals.revenue_cents / totals.transactions);
  totals.avg_customers_per_day = +(totals.customers / 60).toFixed(1);

  const daily = a(`SELECT d.day, d.weekday, d.customers, d.transactions, d.units_sold, d.revenue_cents,
      d.writeoff_cents, d.closing_cash_cents, c.is_rain, c.event_tag
    FROM daily_summaries d LEFT JOIN day_context c ON c.run_id=d.run_id AND c.day=d.day
    WHERE d.run_id=@r ORDER BY d.day`);
  const weekdayVsWeekend = a(`SELECT CASE WHEN weekday>=5 THEN 'Weekend' ELSE 'Weekday' END AS kind,
      COUNT(*) AS days, ROUND(AVG(customers),1) AS avg_customers, ROUND(AVG(transactions),1) AS avg_txns,
      ROUND(AVG(revenue_cents)) AS avg_revenue_cents
    FROM daily_summaries WHERE run_id=@r GROUP BY kind`);

  const categories = a(`SELECT p.category, SUM(i.qty) AS units, SUM(i.line_total_cents) AS revenue_cents,
      SUM(i.line_total_cents - i.qty*p.unit_cost_cents) AS gross_profit_cents
    FROM transaction_items i JOIN run_products p ON p.run_id=i.run_id AND p.product_id=i.product_id
    WHERE i.run_id=@r GROUP BY p.category ORDER BY revenue_cents DESC`);

  const products = a(`SELECT p.product_id, p.name, p.category, p.is_perishable,
      COALESCE((SELECT SUM(qty) FROM transaction_items i WHERE i.run_id=p.run_id AND i.product_id=p.product_id),0) AS units,
      COALESCE((SELECT SUM(line_total_cents) FROM transaction_items i WHERE i.run_id=p.run_id AND i.product_id=p.product_id),0) AS revenue_cents,
      COALESCE((SELECT SUM(line_total_cents - qty*p.unit_cost_cents) FROM transaction_items i WHERE i.run_id=p.run_id AND i.product_id=p.product_id),0) AS gross_profit_cents,
      (SELECT COUNT(*) FROM brain_events e WHERE e.run_id=p.run_id AND e.product_id=p.product_id AND e.event_type='SOLD_OUT') AS stockout_events,
      (SELECT COUNT(*) FROM brain_events e WHERE e.run_id=p.run_id AND e.product_id=p.product_id AND e.event_type='LOW_STOCK') AS low_stock_events,
      (SELECT COUNT(*) FROM brain_events e WHERE e.run_id=p.run_id AND e.product_id=p.product_id AND e.event_type='SLOW_MOVER') AS slow_mover_events,
      COALESCE((SELECT SUM(qty) FROM inventory_movements m WHERE m.run_id=p.run_id AND m.product_id=p.product_id AND m.type='EXPIRED'),0) AS expired_units,
      COALESCE((SELECT SUM(qty*unit_cost_cents) FROM inventory_movements m WHERE m.run_id=p.run_id AND m.product_id=p.product_id AND m.type='EXPIRED'),0) AS writeoff_cents,
      COALESCE((SELECT SUM(lost_revenue_cents) FROM unmet_demand u WHERE u.run_id=p.run_id AND u.product_id=p.product_id),0) AS lost_revenue_cents,
      COALESCE((SELECT SUM(qty_ordered) FROM replenishment_lines l WHERE l.run_id=p.run_id AND l.product_id=p.product_id),0) AS units_ordered,
      (SELECT closing_qty FROM daily_product_snapshots s WHERE s.run_id=p.run_id AND s.product_id=p.product_id AND s.day=60) AS closing_qty,
      p.unit_cost_cents, p.initial_qty
    FROM run_products p WHERE p.run_id=@r`);
  const byUnits = [...products].sort((x, y) => y.units - x.units);

  const inventoryByCategory = {};
  for (const p of products) {
    const c = (inventoryByCategory[p.category] ??= { category: p.category, stockout_events: 0, low_stock_events: 0,
      expired_units: 0, writeoff_cents: 0, lost_revenue_cents: 0, units_ordered: 0, closing_value_cents: 0 });
    c.stockout_events += p.stockout_events; c.low_stock_events += p.low_stock_events;
    c.expired_units += p.expired_units; c.writeoff_cents += p.writeoff_cents;
    c.lost_revenue_cents += p.lost_revenue_cents; c.units_ordered += p.units_ordered;
    c.closing_value_cents += p.closing_qty * p.unit_cost_cents;
  }

  const eventCounts = Object.fromEntries(['LOW_STOCK','SOLD_OUT','EXPIRY_WARNING','EXPIRY_REMOVAL','SLOW_MOVER','REORDER','CASH_CONSTRAINED']
    .map((t) => [t, 0]));
  for (const e of a(`SELECT event_type t, COUNT(*) n FROM brain_events WHERE run_id=@r GROUP BY event_type`)) eventCounts[e.t] = e.n;

  const examples = {};
  for (const t of ['SOLD_OUT', 'EXPIRY_WARNING', 'EXPIRY_REMOVAL', 'SLOW_MOVER', 'CASH_CONSTRAINED']) {
    examples[t] = A(db, `SELECT e.day, e.product_id, p.name, e.detail_json, e.action_taken, e.outcome, e.order_id
      FROM brain_events e JOIN run_products p ON p.run_id=e.run_id AND p.product_id=e.product_id
      WHERE e.run_id=@r AND e.event_type=@t ORDER BY e.day LIMIT 8`, { r, t });
  }

  const replenishment = G(db, `SELECT COUNT(*) AS orders, COALESCE(SUM(total_cost_cents),0) AS spend_cents,
      COALESCE(SUM(was_constrained),0) AS constrained_orders, COALESCE(MIN(cash_after_cents),0) AS min_cash_after_cents
    FROM replenishment_orders WHERE run_id=@r`, { r });
  replenishment.lines = g(`SELECT COUNT(*) v FROM replenishment_lines WHERE run_id=@r AND qty_ordered>0`);
  replenishment.units = g(`SELECT COALESCE(SUM(qty_ordered),0) v FROM replenishment_lines WHERE run_id=@r`);

  const unmet = G(db, `SELECT COUNT(*) AS events, COALESCE(SUM(lost_revenue_cents),0) AS lost_cents,
      COALESCE(SUM(outcome='SUBSTITUTED'),0) AS substituted FROM unmet_demand WHERE run_id=@r`, { r });

  return {
    run_id: r, totals, daily, weekdayVsWeekend, categories,
    topProducts: byUnits.slice(0, 10), weakProducts: byUnits.slice(-10).reverse(),
    products, inventoryByCategory: Object.values(inventoryByCategory),
    eventCounts, examples, replenishment, unmet,
  };
}

export function getDay(db, r, d) {
  const p = { r, d, d1: d - 1 };
  const summary = G(db, `SELECT * FROM daily_summaries WHERE run_id=@r AND day=@d`, p);
  if (!summary) return null;
  return {
    summary,
    context: G(db, `SELECT * FROM day_context WHERE run_id=@r AND day=@d`, p),
    hourly: A(db, `SELECT c.hour, COUNT(*) AS customers, SUM(c.made_purchase) AS buyers,
        COALESCE((SELECT SUM(total_cents) FROM transactions t WHERE t.run_id=c.run_id AND t.day=c.day AND t.hour=c.hour),0) AS revenue_cents
      FROM customers c WHERE c.run_id=@r AND c.day=@d GROUP BY c.hour ORDER BY c.hour`, p),
    products: A(db, `SELECT s.product_id, p.name, p.category, s.opening_qty, s.received_qty, s.sold_qty, s.expired_qty, s.closing_qty
      FROM daily_product_snapshots s JOIN run_products p ON p.run_id=s.run_id AND p.product_id=s.product_id
      WHERE s.run_id=@r AND s.day=@d ORDER BY p.category, p.product_id`, p),
    events: A(db, `SELECT e.event_id, e.event_type, e.product_id, p.name, e.detail_json, e.action_taken, e.outcome, e.order_id
      FROM brain_events e LEFT JOIN run_products p ON p.run_id=e.run_id AND p.product_id=e.product_id
      WHERE e.run_id=@r AND e.day=@d ORDER BY e.event_type, e.event_id`, p),
    orders: A(db, `SELECT * FROM replenishment_orders WHERE run_id=@r AND placed_day=@d`, p),
    orderLines: A(db, `SELECT o.order_id, o.placed_day, o.arrival_day, l.product_id, pr.name, l.qty_wanted, l.qty_ordered, l.reason
      FROM replenishment_orders o JOIN replenishment_lines l ON l.order_id=o.order_id
      JOIN run_products pr ON pr.run_id=l.run_id AND pr.product_id=l.product_id
      WHERE o.run_id=@r AND o.placed_day IN (@d, @d1) AND l.qty_ordered>0 ORDER BY o.placed_day, l.product_id`, p),
    cash: A(db, `SELECT * FROM cash_ledger WHERE run_id=@r AND day=@d ORDER BY entry_id`, p),
  };
}

export function getDayTransactions(db, r, d, limit = 50, offset = 0) {
  return A(db, `SELECT t.txn_id, t.hour, t.units, t.total_cents,
      (SELECT group_concat(i.product_id||' x'||i.qty, ', ') FROM transaction_items i WHERE i.txn_id=t.txn_id) AS items
    FROM transactions t WHERE t.run_id=@r AND t.day=@d ORDER BY t.txn_id LIMIT @limit OFFSET @offset`,
    { r, d, limit, offset });
}

export function getProduct(db, r, pid) {
  const p = { r, pid };
  return {
    product: G(db, `SELECT * FROM run_products WHERE run_id=@r AND product_id=@pid`, p),
    days: A(db, `SELECT day, opening_qty, received_qty, sold_qty, expired_qty, closing_qty
      FROM daily_product_snapshots WHERE run_id=@r AND product_id=@pid ORDER BY day`, p),
    events: A(db, `SELECT day, event_type, detail_json, action_taken, outcome, order_id
      FROM brain_events WHERE run_id=@r AND product_id=@pid ORDER BY day, event_id`, p),
  };
}

export function getAssurance(db, r) {
  const run = G(db, `SELECT * FROM runs WHERE run_id=@r`, { r });
  const n = (sql, extra = {}) => G(db, sql, { r, ...extra }).v;
  const checks = [];
  const add = (group, label, expected, actual, note = '') =>
    checks.push({ group, label, expected, actual, note, pass: expected === actual });

  const counts = {};
  for (const t of ['customers','transactions','transaction_items','inventory_movements','stock_batches',
                   'replenishment_orders','replenishment_lines','cash_ledger','brain_events','unmet_demand',
                   'daily_summaries','daily_product_snapshots'])
    counts[t] = n(`SELECT COUNT(*) v FROM ${t} WHERE run_id=@r`);

  add('History', 'Run status', 'COMPLETED', run.status);
  add('History', 'Days retained', '60/60', `${n(`SELECT COUNT(DISTINCT day) v FROM daily_summaries WHERE run_id=@r`)}/60`);
  add('History', 'Audit tables populated (transactions, movements, orders, ledger, brain events)', true,
    counts.transactions > 0 && counts.inventory_movements > 0 && counts.replenishment_orders > 0 &&
    counts.cash_ledger > 0 && counts.brain_events > 0);
  add('History', 'Opening inventory within A$40,000 budget', true,
    n(`SELECT SUM(unit_cost_cents*initial_qty) v FROM run_products WHERE run_id=@r`) <= run.inventory_budget_cents);

  // ---- inventory ----
  const mv = (type) => n(`SELECT COALESCE(SUM(qty),0) v FROM inventory_movements WHERE run_id=@r AND type='${type}'`);
  const opening = mv('OPENING'), received = mv('RECEIVED'), sold = mv('SOLD'), expired = mv('EXPIRED');
  const closing = n(`SELECT COALESCE(SUM(closing_qty),0) v FROM daily_product_snapshots WHERE run_id=@r AND day=60`);
  add('Inventory', 'Opening stock = catalogue initial quantities', n(`SELECT SUM(initial_qty) v FROM run_products WHERE run_id=@r`), opening);
  add('Inventory', 'Opening + received − sold − expired = closing (all products, units)', closing, opening + received - sold - expired,
    `${opening} + ${received} − ${sold} − ${expired}`);
  add('Inventory', 'Products where movement-derived stock ≠ Day 60 closing', 0, n(`
    SELECT COUNT(*) v FROM (SELECT product_id, SUM(CASE WHEN type IN ('OPENING','RECEIVED') THEN qty ELSE -qty END) q
      FROM inventory_movements WHERE run_id=@r GROUP BY product_id) x
    JOIN daily_product_snapshots s ON s.run_id=@r AND s.product_id=x.product_id AND s.day=60 WHERE x.q <> s.closing_qty`));
  add('Inventory', 'Daily snapshot rows that do not balance', 0, n(`SELECT COUNT(*) v FROM daily_product_snapshots
    WHERE run_id=@r AND opening_qty+received_qty-sold_qty-expired_qty <> closing_qty`));
  add('Inventory', 'Day-to-day stock continuity breaks', 0, n(`SELECT COUNT(*) v FROM daily_product_snapshots a
    JOIN daily_product_snapshots b ON b.run_id=a.run_id AND b.product_id=a.product_id AND b.day=a.day+1
    WHERE a.run_id=@r AND a.closing_qty <> b.opening_qty`));
  add('Inventory', 'Negative stock (daily snapshots)', 0, n(`SELECT COUNT(*) v FROM daily_product_snapshots WHERE run_id=@r AND closing_qty<0`));
  add('Inventory', 'Negative stock (batch level)', 0, n(`SELECT COUNT(*) v FROM (
      SELECT b.batch_id, b.qty_received - COALESCE(SUM(CASE WHEN m.type IN ('SOLD','EXPIRED') THEN m.qty END),0) AS rem
      FROM stock_batches b LEFT JOIN inventory_movements m ON m.batch_id=b.batch_id
      WHERE b.run_id=@r GROUP BY b.batch_id) WHERE rem<0`));
  add('Inventory', 'Overselling (transaction lines not matched by sold movements)', 0, n(`
    WITH sm AS (SELECT txn_id, product_id, SUM(qty) q FROM inventory_movements WHERE run_id=@r AND type='SOLD' GROUP BY txn_id, product_id)
    SELECT COUNT(*) v FROM transaction_items i LEFT JOIN sm ON sm.txn_id=i.txn_id AND sm.product_id=i.product_id
    WHERE i.run_id=@r AND COALESCE(sm.q,-1) <> i.qty`));
  add('Inventory', 'Expired products sold', 0, n(`SELECT COUNT(*) v FROM inventory_movements m JOIN stock_batches b ON b.batch_id=m.batch_id
    WHERE m.run_id=@r AND m.type='SOLD' AND b.expiry_day IS NOT NULL AND m.day >= b.expiry_day`));
  add('Inventory', 'Ordered units = received units', n(`SELECT COALESCE(SUM(qty_ordered),0) v FROM replenishment_lines WHERE run_id=@r`), received);

  // ---- revenue ----
  const txRev = n(`SELECT COALESCE(SUM(total_cents),0) v FROM transactions WHERE run_id=@r`);
  add('Revenue', 'Transactions whose total ≠ sum of their lines', 0, n(`SELECT COUNT(*) v FROM transactions t WHERE t.run_id=@r
    AND t.total_cents <> (SELECT SUM(line_total_cents) FROM transaction_items i WHERE i.txn_id=t.txn_id)`));
  add('Revenue', 'Days where daily revenue ≠ sum of transaction totals', 0, n(`SELECT COUNT(*) v FROM daily_summaries d WHERE d.run_id=@r
    AND d.revenue_cents <> COALESCE((SELECT SUM(total_cents) FROM transactions t WHERE t.run_id=d.run_id AND t.day=d.day),0)`));
  add('Revenue', '60-day revenue = sum of daily revenue (cents)', txRev,
    n(`SELECT COALESCE(SUM(revenue_cents),0) v FROM daily_summaries WHERE run_id=@r`));

  // ---- cash ----
  const spend = n(`SELECT COALESCE(SUM(total_cost_cents),0) v FROM replenishment_orders WHERE run_id=@r`);
  const ledgerClose = n(`SELECT balance_after_cents v FROM cash_ledger WHERE run_id=@r ORDER BY entry_id DESC LIMIT 1`);
  add('Cash', 'Closing cash = opening cash + revenue − replenishment spend (cents)',
    run.opening_cash_cents + txRev - spend, ledgerClose, `${run.opening_cash_cents} + ${txRev} − ${spend}`);
  add('Cash', 'Day 60 summary cash = ledger closing balance', ledgerClose,
    n(`SELECT closing_cash_cents v FROM daily_summaries WHERE run_id=@r AND day=60`));
  add('Cash', 'Ledger running-balance breaks', 0, n(`SELECT COUNT(*) v FROM (
      SELECT balance_after_cents b, amount_cents a, LAG(balance_after_cents, 1, @open) OVER (ORDER BY entry_id) prev
      FROM cash_ledger WHERE run_id=@r) WHERE prev + a <> b`, { open: run.opening_cash_cents }));
  add('Cash', 'Daily SALE ledger entries ≠ daily revenue (days)', 0, n(`SELECT COUNT(*) v FROM daily_summaries d WHERE d.run_id=@r
    AND d.revenue_cents <> COALESCE((SELECT SUM(amount_cents) FROM cash_ledger c WHERE c.run_id=d.run_id AND c.day=d.day AND c.type='SALE'),0)`));
  add('Cash', 'Orders exceeding cash available when placed', 0, n(`SELECT COUNT(*) v FROM replenishment_orders WHERE run_id=@r AND total_cost_cents > cash_before_cents`));
  add('Cash', 'Negative cash balance entries', 0, n(`SELECT COUNT(*) v FROM cash_ledger WHERE run_id=@r AND balance_after_cents<0`));
  add('Cash', 'Orders not arriving the next day (lead-time breaks)', 0, n(`SELECT COUNT(*) v FROM replenishment_orders WHERE run_id=@r AND arrival_day<>placed_day+1`) +
    n(`SELECT COUNT(*) v FROM inventory_movements m JOIN replenishment_orders o ON o.order_id=m.order_id
       WHERE m.run_id=@r AND m.type='RECEIVED' AND m.day<>o.arrival_day`));

  const failures = checks.filter((c) => !c.pass);
  const business = {
    stockout_events: n(`SELECT COUNT(*) v FROM brain_events WHERE run_id=@r AND event_type='SOLD_OUT'`),
    low_stock_events: n(`SELECT COUNT(*) v FROM brain_events WHERE run_id=@r AND event_type='LOW_STOCK'`),
    expired_units: expired,
    slow_mover_events: n(`SELECT COUNT(*) v FROM brain_events WHERE run_id=@r AND event_type='SLOW_MOVER'`),
    cash_constrained_orders: n(`SELECT COALESCE(SUM(was_constrained),0) v FROM replenishment_orders WHERE run_id=@r`),
    note: 'Business outcomes, not integrity failures. They are recorded correctly and analysed in the report.',
  };
  return { run_id: r, status: run.status, counts, checks, overall: failures.length ? 'FAIL' : 'PASS', failures, business };
}