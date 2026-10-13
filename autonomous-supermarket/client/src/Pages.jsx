import { useEffect, useState } from 'react';
import { get, money, num, DOW, detail, Bars, Table, Card, Kpi } from './util.jsx';
import { FINDINGS, LIMITATIONS } from './findings.js';

const useLoad = (path, deps) => {
  const [data, setData] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { setData(null); setErr(null); get(path).then(setData).catch((e) => setErr(e.message)); }, deps); // eslint-disable-line
  return [data, err];
};
const Loading = ({ err }) => <p className="muted">{err ? `Error: ${err}` : 'Loading…'}</p>;

/* ---------------- Model Declaration ---------------- */
export function Declaration({ runId }) {
  const [d, err] = useLoad(`/runs/${runId}/declaration`, [runId]);
  if (!d) return <Loading err={err} />;
  const { config: c, run, products } = d;
  const b = c.brain, dm = c.demand;
  return (
    <>
      <Card title="Run and client constraints">
        <p><b>Run ID:</b> {run.run_id} · <b>Seed:</b> {run.rng_seed} · <b>Status:</b> {run.status}</p>
        <div className="kpis">
          <Kpi label="Opening inventory budget (max)" value={money(run.inventory_budget_cents)} />
          <Kpi label="Opening inventory (at cost)" value={money(d.opening_inventory_cents)} sub="Unused budget is not operating cash" />
          <Kpi label="Opening operating cash" value={money(run.opening_cash_cents)} />
          <Kpi label="Products" value={products.length} />
        </div>
        <p className="muted">Outside the model: premises, rent, fit-out, refrigeration, utilities, insurance, hardware, corporate overhead, wages. Profit figures are therefore gross (before these costs).</p>
      </Card>
      <Card title="Customer and demand model">
        <ul>
          <li><b>Arrivals.</b> Expected visitors per day = {dm.baseVisitorsPerDay} × weekday factor ({dm.weekdayFactor.join(', ')} for Mon–Sun) × log-normal daily noise (σ={dm.dayNoiseSigma}) × rain factor × event factor. Visitors are then spread over 24 hours using separate weekday and weekend hourly curves (commuter peaks at 8am, 12–1pm and 5–6pm on weekdays; a broad midday bulge on weekends) and drawn as Poisson counts.</li>
          <li><b>Context.</b> Rain occurs on {dm.rainProbability * 100}% of days (traffic ×{dm.rainTrafficFactor}, umbrella popularity ×{dm.rainUmbrellaFactor}). One scheduled event, {dm.events[0].tag} on day {dm.events[0].day}, raises traffic ×{dm.events[0].trafficFactor} and boosts Drinks and Snacks.</li>
          <li><b>Missions.</b> Each visitor has a {dm.browseOnlyProbability * 100}% chance of buying nothing, otherwise a shopping mission (Grab and Go, Lunch Run, Top-up, Dinner, Essentials, Urgent Need) chosen by time block, with weekend adjustments. The mission sets the number of lines and the category preferences.</li>
          <li><b>Product choice.</b> Within a category, products are weighted by popularity tier (A={dm.tierWeight.A}, B={dm.tierWeight.B}, C={dm.tierWeight.C}), so daily-use items sell far more than occasional ones. Each line is 1–3 units.</li>
          <li><b>Availability.</b> A customer buys only what is in stock and unexpired. If short, with probability {dm.substituteProbability} they substitute a product in the same category; otherwise the sale is lost. Every shortfall is stored in the unmet-demand table.</li>
        </ul>
      </Card>
      <Card title="Perishables and expiry">
        <p>Each received lot is stored as its own batch with a received day and expiry day (received day + shelf life). A batch is sellable from its received day to the day before its expiry day and is removed from sale and written off (at cost) at the start of the expiry day. Stock is sold earliest-expiry-first. Opening stock is treated as received on day 1.</p>
      </Card>
      <Card title="Store Brain rules">
        <ul>
          <li><b>Daily cycle.</b> Start of day: receive yesterday's order, remove expired stock. Trading. End of day: the Brain reviews closing stock and orders; the cost leaves cash immediately; stock arrives before customers the next day (fixed one-day lead time). No order is placed after day 60.</li>
          <li><b>Demand estimate.</b> Average daily units sold over the last {b.trailingDays} days (floor {b.minDemandFloor}/day).</li>
          <li><b>Sold out</b> = zero stock. <b>Low stock</b> = days of cover below {b.lowStockCoverDays.perishable} (perishable) or {b.lowStockCoverDays.nonPerishable} (other).</li>
          <li><b>Expiry warning.</b> For perishable batches expiring within {b.expiryWarnWithinDays} days, units that expected sales cannot clear before expiry are flagged as at risk.</li>
          <li><b>Slow mover.</b> Non-perishable stock above {b.slowMoverCoverDays} days of sales (after {b.slowMoverMinDays} days of data). Response: reorder held.</li>
          <li><b>Replenishment.</b> Perishables are ordered up to {b.targetCover.perishableMin}–{b.targetCover.perishableMax} days of expected sales (half the shelf life, ×{b.perishableSafety} safety) counting only stock that will still be sellable tomorrow. Other products reorder when cover falls to {b.reorderPointCoverDays} days, up to {b.targetCover.nonPerishable} days of sales.</li>
          <li><b>Cash constraint.</b> Orders are funded in urgency order (sold-out first, then lowest cover) until cash runs out; unfunded quantity is recorded as cash-constrained. Orders can never exceed available cash.</li>
        </ul>
      </Card>
      <Card title="Other assumptions that affect results">
        <ul>
          <li>Unit cost and price are constant for the run (COGS = units × unit cost); no discounts or markdowns.</li>
          <li>Opening stock was set at about 21 days of expected demand for most non-perishables, 1.5–7 days for perishables, and deliberately overstocked for a few occasional lines (olive oil, tea, coffee, batteries, umbrella, charging cable, gum).</li>
          <li>Supplier availability is unlimited and delivery is always on time; stock shelf-filling is not modelled.</li>
          <li>Demand parameters are plausible assumptions, not calibrated to real data. Real operating data would be needed for validation.</li>
        </ul>
      </Card>
      <Card title="Opening product data">
        <Table cols={[
          { h: 'ID', k: 'product_id' }, { h: 'Product', k: 'name' }, { h: 'Category', k: 'category' },
          { h: 'Cost', f: (p) => money(p.unit_cost_cents), right: true }, { h: 'Price', f: (p) => money(p.unit_price_cents), right: true },
          { h: 'Opening qty', k: 'initial_qty', right: true }, { h: 'Opening value', f: (p) => money(p.opening_value_cents), right: true },
          { h: 'Shelf life', f: (p) => (p.is_perishable ? `${p.shelf_life_days} d` : '—'), right: true },
        ]} rows={products} />
      </Card>
    </>
  );
}

/* ---------------- Runs ---------------- */
export function Runs({ runs, submitted, runId, setRunId, refresh }) {
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const r = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json());
    await refresh(); setRunId(r.run_id); setBusy(false);
  };
  return (
    <Card title="Simulation runs">
      <p>Each run is a complete, frozen 60-day history. Existing runs cannot be edited or deleted. Creating a new run stores a separate history (a different random seed gives different results).</p>
      <button onClick={create} disabled={busy}>{busy ? 'Running…' : 'Create and run a new 60-day simulation'}</button>
      <Table onRow={(r) => setRunId(r.run_id)} cols={[
        { h: 'Run ID', f: (r) => <>{r.run_id} {r.run_id === submitted && <span className="badge ok">Submitted Run</span>} {r.run_id === runId && <span className="badge">viewing</span>}</> },
        { h: 'Status', k: 'status' }, { h: 'Days', k: 'days', right: true }, { h: 'Seed', k: 'rng_seed', right: true },
        { h: 'Revenue', f: (r) => money(r.revenue_cents), right: true }, { h: 'Closing cash', f: (r) => money(r.closing_cash_cents), right: true },
      ]} rows={runs} />
    </Card>
  );
}

/* ---------------- 60-Day Report ---------------- */
const EVENT_LABEL = { LOW_STOCK: 'Low-stock decisions', SOLD_OUT: 'Sold-out responses', EXPIRY_WARNING: 'Expiry warnings',
  EXPIRY_REMOVAL: 'Expiry removals (actions)', SLOW_MOVER: 'Slow-mover responses', REORDER: 'Replenishment lines ordered',
  CASH_CONSTRAINED: 'Cash-constrained replenishment' };

export function Report({ runId, go }) {
  const [r, err] = useLoad(`/runs/${runId}/report`, [runId]);
  const [drill, setDrill] = useState(null);
  const [drillData, setDrillData] = useState(null);
  useEffect(() => { if (drill) { setDrillData(null); get(`/runs/${runId}/products/${drill}`).then(setDrillData); } }, [drill, runId]);
  if (!r) return <Loading err={err} />;
  const t = r.totals;
  const pname = (p) => <a href="#p" onClick={(e) => { e.preventDefault(); setDrill(p.product_id); }}>{p.name}</a>;
  const days = r.daily.map((d) => ({ label: `Day ${d.day}`, value: d.customers, color: d.weekday >= 5 ? '#f59e0b' : '#2563eb',
    title: `Day ${d.day} (${DOW[d.weekday]}): ${d.customers} customers, ${money(d.revenue_cents)}${d.is_rain ? ', rain' : ''}${d.event_tag ? ', ' + d.event_tag : ''}`,
    onClick: () => go('daily', d.day) }));
  const slow = r.products.filter((p) => p.slow_mover_events > 0).sort((a, b) => b.closing_qty * b.unit_cost_cents - a.closing_qty * a.unit_cost_cents);
  const stockouts = r.products.filter((p) => p.stockout_events > 0).sort((a, b) => b.lost_revenue_cents - a.lost_revenue_cents).slice(0, 10);
  const writeoffs = r.products.filter((p) => p.expired_units > 0).sort((a, b) => b.writeoff_cents - a.writeoff_cents).slice(0, 10);

  return (
    <>
      <h2>Part 1 — Business performance</h2>
      <Card title="Store performance">
        <div className="kpis">
          <Kpi label="Customers" value={num(t.customers)} /><Kpi label="Transactions" value={num(t.transactions)} />
          <Kpi label="Units sold" value={num(t.units_sold)} /><Kpi label="Sales revenue" value={money(t.revenue_cents)} />
          <Kpi label="COGS" value={money(t.cogs_cents)} /><Kpi label="Gross profit" value={money(t.gross_profit_cents)}
            sub={`${((t.gross_profit_cents / t.revenue_cents) * 100).toFixed(1)}% margin`} />
          <Kpi label="Expiry / write-off" value={money(t.writeoff_cents)} sub={`${num(t.writeoff_units)} units`} />
          <Kpi label="Closing operating cash" value={money(t.closing_cash_cents)} />
          <Kpi label="Closing inventory (cost)" value={money(t.closing_inventory_cents)} />
        </div>
      </Card>
      <Card title="Shoppers and baskets">
        <div className="kpis">
          <Kpi label="Avg customers / day" value={t.avg_customers_per_day} />
          <Kpi label="Avg basket (units)" value={t.avg_units_per_txn} />
          <Kpi label="Avg transaction value" value={money(t.avg_txn_value_cents)} />
        </div>
        <Table cols={[{ h: 'Day type', k: 'kind' }, { h: 'Days', k: 'days', right: true }, { h: 'Avg customers', k: 'avg_customers', right: true },
          { h: 'Avg transactions', k: 'avg_txns', right: true }, { h: 'Avg revenue', f: (x) => money(x.avg_revenue_cents), right: true }]} rows={r.weekdayVsWeekend} />
        <p className="muted">Customers per day (blue = weekday, amber = weekend). Click a bar to open that Daily Report.</p>
        <Bars data={days} height={110} />
      </Card>
      <Card title="Category performance">
        <Table cols={[{ h: 'Category', k: 'category' }, { h: 'Units', f: (c) => num(c.units), right: true },
          { h: 'Revenue', f: (c) => money(c.revenue_cents), right: true }, { h: 'Gross profit', f: (c) => money(c.gross_profit_cents), right: true },
          { h: 'Margin', f: (c) => ((c.gross_profit_cents / c.revenue_cents) * 100).toFixed(1) + '%', right: true }]} rows={r.categories} />
      </Card>
      <Card title="Top-selling and weakest products (click a product to trace it)">
        <div className="two">
          <div><h4>Top 10 by units</h4><Table cols={[{ h: 'Product', f: pname }, { h: 'Units', f: (p) => num(p.units), right: true }, { h: 'Revenue', f: (p) => money(p.revenue_cents), right: true }]} rows={r.topProducts} /></div>
          <div><h4>Weakest 10 by units</h4><Table cols={[{ h: 'Product', f: pname }, { h: 'Units', f: (p) => num(p.units), right: true }, { h: 'Revenue', f: (p) => money(p.revenue_cents), right: true }]} rows={r.weakProducts} /></div>
        </div>
      </Card>
      {drill && (
        <Card title={`Product trace: ${drill}`}>
          {!drillData ? <Loading /> : <>
            <p>{drillData.product.name} · cost {money(drillData.product.unit_cost_cents)} · price {money(drillData.product.unit_price_cents)} · <a href="#x" onClick={(e) => { e.preventDefault(); setDrill(null); }}>close</a></p>
            <Table onRow={(d) => go('daily', d.day)} cols={[{ h: 'Day', k: 'day' }, { h: 'Opening', k: 'opening_qty', right: true }, { h: 'Received', k: 'received_qty', right: true },
              { h: 'Sold', k: 'sold_qty', right: true }, { h: 'Expired', k: 'expired_qty', right: true }, { h: 'Closing', k: 'closing_qty', right: true }]} rows={drillData.days} />
          </>}
        </Card>
      )}

      <h2>Part 2 — Inventory and autonomous operations</h2>
      <Card title="Store Brain activity (zero reported where none occurred)">
        <Table cols={[{ h: 'Event type', f: ([k]) => EVENT_LABEL[k] ?? k }, { h: 'Count', f: ([, n]) => num(n), right: true }]} rows={Object.entries(r.eventCounts)} />
        <p>Replenishment: <b>{r.replenishment.orders}</b> orders, {num(r.replenishment.units)} units, <b>{money(r.replenishment.spend_cents)}</b> spent.
          Orders cut back by insufficient cash: <b>{r.replenishment.constrained_orders}</b>. Lowest cash after any order: {money(r.replenishment.min_cash_after_cents)}.</p>
        <p>Unmet demand: {r.unmet.events} shortfall events, {r.unmet.substituted} substituted, <b>{money(r.unmet.lost_cents)}</b> of sales lost.</p>
      </Card>
      <Card title="Inventory health by category">
        <Table cols={[{ h: 'Category', k: 'category' }, { h: 'Stockouts', k: 'stockout_events', right: true }, { h: 'Low-stock', k: 'low_stock_events', right: true },
          { h: 'Expired units', f: (c) => num(c.expired_units), right: true }, { h: 'Write-off', f: (c) => money(c.writeoff_cents), right: true },
          { h: 'Lost sales', f: (c) => money(c.lost_revenue_cents), right: true }, { h: 'Units ordered', f: (c) => num(c.units_ordered), right: true },
          { h: 'Closing stock (cost)', f: (c) => money(c.closing_value_cents), right: true }]} rows={r.inventoryByCategory} />
      </Card>
      <Card title="Products behind the problems">
        <h4>Largest write-offs</h4>
        <Table cols={[{ h: 'Product', f: pname }, { h: 'Expired units', f: (p) => num(p.expired_units), right: true }, { h: 'Write-off', f: (p) => money(p.writeoff_cents), right: true }]} rows={writeoffs} />
        <h4>Stockouts (by lost sales)</h4>
        <Table cols={[{ h: 'Product', f: pname }, { h: 'Sold-out events', k: 'stockout_events', right: true }, { h: 'Lost sales', f: (p) => money(p.lost_revenue_cents), right: true }]} rows={stockouts} />
        <h4>Slow movers (closing stock held)</h4>
        <Table cols={[{ h: 'Product', f: pname }, { h: 'Opening qty', k: 'initial_qty', right: true }, { h: 'Units sold', f: (p) => num(p.units), right: true },
          { h: 'Closing qty', k: 'closing_qty', right: true }, { h: 'Closing value', f: (p) => money(p.closing_qty * p.unit_cost_cents), right: true }]} rows={slow} />
      </Card>
      <Card title="Condition → action → outcome (examples; click a row to open that day)">
        {Object.entries(r.examples).map(([type, rows]) => (
          <div key={type}><h4>{EVENT_LABEL[type] ?? type}</h4>
            <Table onRow={(e) => go('daily', e.day)} empty="None occurred in this run (0)" cols={[{ h: 'Day', k: 'day' }, { h: 'Product', k: 'name' },
              { h: 'Detected', f: (e) => detail(e.detail_json) }, { h: 'Action', k: 'action_taken' }, { h: 'Outcome', k: 'outcome' }]} rows={rows} />
          </div>))}
      </Card>

      <h2>Part 3 — Diagnosis and recommendations</h2>
      {FINDINGS.map((f, i) => (
        <Card key={i} title={`Finding ${i + 1}: ${f.title}`}>
          {[['Observation', f.observation], ['Evidence', f.evidence], ['Diagnosis', f.diagnosis], ['Business implication', f.implication], ['Recommendation', f.recommendation]]
            .map(([h, v]) => <p key={h}><b>{h}.</b> {v || <span className="muted">pending</span>}</p>)}
        </Card>))}
      {LIMITATIONS.length > 0 && <Card title="Model limitations affecting these conclusions"><ul>{LIMITATIONS.map((l, i) => <li key={i}>{l}</li>)}</ul></Card>}
    </>
  );
}

/* ---------------- Daily Report ---------------- */
export function Daily({ runId, day, setDay }) {
  const [d, err] = useLoad(`/runs/${runId}/days/${day}`, [runId, day]);
  const [txns, setTxns] = useState(null);
  useEffect(() => setTxns(null), [runId, day]);
  const showTx = () => get(`/runs/${runId}/days/${day}/transactions?limit=50`).then(setTxns);
  return (
    <>
      <Card title={`Daily Report — Day ${day}`}>
        <div className="daybar">
          <button onClick={() => setDay(Math.max(1, day - 1))}>◀</button>
          <input type="range" min="1" max="60" value={day} onChange={(e) => setDay(Number(e.target.value))} />
          <button onClick={() => setDay(Math.min(60, day + 1))}>▶</button>
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}>{Array.from({ length: 60 }, (_, i) => <option key={i} value={i + 1}>Day {i + 1}</option>)}</select>
        </div>
        {!d ? <Loading err={err} /> : (
          <>
            <p>{DOW[d.summary.weekday]}{d.context?.is_rain ? ' · rain' : ''}{d.context?.event_tag ? ` · ${d.context.event_tag}` : ''} · expected visitors {d.context ? Math.round(d.context.expected_visitors) : '—'}</p>
            <div className="kpis">
              <Kpi label="Customers" value={d.summary.customers} /><Kpi label="Transactions" value={d.summary.transactions} />
              <Kpi label="Units sold" value={d.summary.units_sold} /><Kpi label="Revenue" value={money(d.summary.revenue_cents)} />
              <Kpi label="COGS" value={money(d.summary.cogs_cents)} /><Kpi label="Write-off" value={money(d.summary.writeoff_cents)} />
              <Kpi label="Order spend (evening)" value={money(d.summary.order_spend_cents)} /><Kpi label="Closing cash" value={money(d.summary.closing_cash_cents)} />
              <Kpi label="Closing inventory" value={money(d.summary.closing_inventory_cents)} />
            </div>
            <h4>Customers by hour</h4>
            <Bars data={Array.from({ length: 24 }, (_, h) => { const x = d.hourly.find((r) => r.hour === h); return { label: h, value: x?.customers ?? 0, title: `${h}:00 — ${x?.customers ?? 0} customers, ${money(x?.revenue_cents)}` }; })} />
          </>
        )}
      </Card>
      {d && <>
        <Card title="Store Brain decisions and alerts">
          <Table cols={[{ h: 'Type', k: 'event_type' }, { h: 'Product', f: (e) => e.name ?? '—' }, { h: 'Detected', f: (e) => detail(e.detail_json) },
            { h: 'Action', k: 'action_taken' }, { h: 'Outcome', k: 'outcome' }, { h: 'Order #', f: (e) => e.order_id ?? '' }]} rows={d.events} />
        </Card>
        <Card title="Replenishment (today's evening order and the order that arrived this morning)">
          <Table cols={[{ h: 'Order #', k: 'order_id' }, { h: 'Placed', k: 'placed_day' }, { h: 'Arrives', k: 'arrival_day' }, { h: 'Product', k: 'name' },
            { h: 'Wanted', k: 'qty_wanted', right: true }, { h: 'Ordered', k: 'qty_ordered', right: true }, { h: 'Rule', k: 'reason' }]} rows={d.orderLines} />
          <h4>Cash ledger</h4>
          <Table cols={[{ h: 'Entry', k: 'entry_id' }, { h: 'Type', k: 'type' }, { h: 'Amount', f: (c) => money(c.amount_cents), right: true }, { h: 'Balance after', f: (c) => money(c.balance_after_cents), right: true }]} rows={d.cash} />
        </Card>
        <Card title="Stock movement by product (opening + received − sold − expired = closing)">
          <Table cols={[{ h: 'Product', k: 'name' }, { h: 'Category', k: 'category' }, { h: 'Opening', k: 'opening_qty', right: true }, { h: 'Received', k: 'received_qty', right: true },
            { h: 'Sold', k: 'sold_qty', right: true }, { h: 'Expired', k: 'expired_qty', right: true }, { h: 'Closing', k: 'closing_qty', right: true }]} rows={d.products} />
        </Card>
        <Card title="Transactions (stored records)">
          {!txns ? <button onClick={showTx}>Load first 50 transactions for Day {day}</button> :
            <Table cols={[{ h: 'Txn #', k: 'txn_id' }, { h: 'Hour', k: 'hour' }, { h: 'Units', k: 'units', right: true }, { h: 'Total', f: (t) => money(t.total_cents), right: true }, { h: 'Items', k: 'items' }]} rows={txns} />}
        </Card>
      </>}
    </>
  );
}

/* ---------------- Commercial Assurance ---------------- */
export function Assurance({ runId, submitted }) {
  const [a, err] = useLoad(`/runs/${runId}/assurance`, [runId]);
  if (!a) return <Loading err={err} />;
  const groups = [...new Set(a.checks.map((c) => c.group))];
  return (
    <>
      <Card title="Commercial Assurance">
        <p><b>Run:</b> {a.run_id} {a.run_id === submitted && <span className="badge ok">Submitted Run</span>} · <b>Overall:</b> <span className={`badge ${a.overall === 'PASS' ? 'ok' : 'bad'}`}>{a.overall}</span></p>
        <p className="muted">Every check is recalculated from the stored history each time this page loads.</p>
        {a.failures.length > 0 && <p className="bad-text"><b>Disclosed integrity failures:</b> {a.failures.map((f) => f.label).join('; ')}</p>}
        {a.failures.length === 0 && <p>No integrity failures or unexplained exceptions were found.</p>}
      </Card>
      {groups.map((g) => (
        <Card key={g} title={`${g} checks`}>
          <Table cols={[{ h: 'Check', k: 'label' }, { h: 'Expected', f: (c) => String(c.expected), right: true }, { h: 'Actual', f: (c) => String(c.actual), right: true },
            { h: 'Detail', k: 'note' }, { h: 'Status', f: (c) => <span className={`badge ${c.pass ? 'ok' : 'bad'}`}>{c.pass ? 'PASS' : 'FAIL'}</span> }]}
            rows={a.checks.filter((c) => c.group === g)} />
        </Card>))}
      <Card title="Records retained for audit">
        <Table cols={[{ h: 'Table', f: ([k]) => k }, { h: 'Rows', f: ([, n]) => num(n), right: true }]} rows={Object.entries(a.counts)} />
        <p className="muted">History tables are append-only: database triggers block UPDATE and DELETE, and block new rows once a run is COMPLETED.</p>
      </Card>
      <Card title="Business outcomes (not integrity failures)">
        <ul>
          <li>Stockout events: {a.business.stockout_events} · Low-stock events: {a.business.low_stock_events}</li>
          <li>Expired units written off: {num(a.business.expired_units)} · Slow-mover events: {a.business.slow_mover_events}</li>
          <li>Cash-constrained orders: {a.business.cash_constrained_orders}</li>
        </ul>
        <p className="muted">{a.business.note}</p>
      </Card>
    </>
  );
}