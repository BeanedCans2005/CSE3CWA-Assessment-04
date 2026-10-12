import {
  mulberry32, buildDayContext, hourlyArrivals, pickMission, pickWeighted, drawWantedBasket,
} from './demandModel.js';

const OPENING_CASH = 1_500_000;
const BUDGET = 4_000_000;
const DAYS = 60;

export function runSimulation(db, { seed, products, demandCfg: cfg, brainCfg: B }) {
  const openingCost = products.reduce((s, p) => s + p.unit_cost_cents * p.initial_qty, 0);
  if (openingCost > BUDGET) throw new Error(`Opening inventory ${openingCost} exceeds budget`);

  const runId = 'RUN-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + seed;
  const rng = mulberry32(seed);

  const P = (sql) => db.prepare(sql);
  const q = {
    run: P(`INSERT INTO runs (run_id,status,created_at,sim_days,rng_seed,opening_cash_cents,inventory_budget_cents,config_json)
            VALUES (?,?,?,?,?,?,?,?)`),
    done: P(`UPDATE runs SET status='COMPLETED', completed_at=? WHERE run_id=?`),
    prod: P(`INSERT INTO run_products (run_id,product_id,name,category,unit_cost_cents,unit_price_cents,initial_qty,is_perishable,shelf_life_days)
             VALUES (?,?,?,?,?,?,?,?,?)`),
    batch: P(`INSERT INTO stock_batches (run_id,product_id,received_day,qty_received,unit_cost_cents,expiry_day,source,order_id)
              VALUES (?,?,?,?,?,?,?,?)`),
    mov: P(`INSERT INTO inventory_movements (run_id,day,product_id,batch_id,type,qty,unit_cost_cents,txn_id,order_id)
            VALUES (?,?,?,?,?,?,?,?,?)`),
    ctx: P(`INSERT INTO day_context (run_id,day,weekday,is_rain,event_tag,expected_visitors) VALUES (?,?,?,?,?,?)`),
    cust: P(`INSERT INTO customers (run_id,day,hour,mission,made_purchase) VALUES (?,?,?,?,?)`),
    txn: P(`INSERT INTO transactions (run_id,customer_id,day,hour,units,total_cents) VALUES (?,?,?,?,?,?)`),
    item: P(`INSERT INTO transaction_items (run_id,txn_id,product_id,qty,unit_price_cents,line_total_cents) VALUES (?,?,?,?,?,?)`),
    unmet: P(`INSERT INTO unmet_demand (run_id,day,hour,customer_id,product_id,qty_wanted,outcome,substitute_product_id,lost_revenue_cents)
              VALUES (?,?,?,?,?,?,?,?,?)`),
    order: P(`INSERT INTO replenishment_orders (run_id,placed_day,arrival_day,total_cost_cents,cash_before_cents,cash_after_cents,was_constrained)
              VALUES (?,?,?,?,?,?,?)`),
    line: P(`INSERT INTO replenishment_lines (run_id,order_id,product_id,qty_wanted,qty_ordered,unit_cost_cents,reason) VALUES (?,?,?,?,?,?,?)`),
    cash: P(`INSERT INTO cash_ledger (run_id,day,type,amount_cents,balance_after_cents,order_id) VALUES (?,?,?,?,?,?)`),
    evt: P(`INSERT INTO brain_events (run_id,day,product_id,event_type,detail_json,action_taken,outcome,order_id) VALUES (?,?,?,?,?,?,?,?)`),
    snap: P(`INSERT INTO daily_product_snapshots (run_id,day,product_id,opening_qty,received_qty,sold_qty,expired_qty,closing_qty) VALUES (?,?,?,?,?,?,?,?)`),
    sum: P(`INSERT INTO daily_summaries (run_id,day,weekday,customers,transactions,units_sold,revenue_cents,cogs_cents,writeoff_cents,order_spend_cents,closing_cash_cents,closing_inventory_cents)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  };

  const state = {};                                   // product_id -> live state
  const byCategory = {};
  for (const p of products) {
    state[p.product_id] = { p, batches: [], soldHist: [], prevClosing: p.initial_qty };
    (byCategory[p.category] ??= []).push(p);
  }
  const all = Object.values(state);
  const onHand = (s) => s.batches.reduce((a, b) => a + b.remaining, 0);
  const popularity = (id) => cfg.tierWeight[cfg.tier[id]];

  const tx = db.transaction(() => {
    q.run.run(runId, 'RUNNING', new Date().toISOString(), DAYS, seed, OPENING_CASH, BUDGET,
      JSON.stringify({ demand: cfg, brain: B, model: 'v1' }));
    for (const p of products)
      q.prod.run(runId, p.product_id, p.name, p.category, p.unit_cost_cents, p.unit_price_cents,
        p.initial_qty, p.is_perishable, p.shelf_life_days);

    let cash = OPENING_CASH;
    let pending = null;                               // order placed last evening
    const slowLastEmit = {};

    const addBatch = (s, day, qty, source, orderId) => {
      const p = s.p;
      const expiry = p.is_perishable ? day + p.shelf_life_days : null;
      const batchId = q.batch.run(runId, p.product_id, day, qty, p.unit_cost_cents, expiry, source, orderId).lastInsertRowid;
      s.batches.push({ id: batchId, remaining: qty, expiry, received: day });
      s.batches.sort((a, b) => (a.expiry ?? 1e9) - (b.expiry ?? 1e9) || a.received - b.received);
      q.mov.run(runId, day, p.product_id, batchId, source === 'OPENING' ? 'OPENING' : 'RECEIVED',
        qty, p.unit_cost_cents, null, orderId);
    };

    const event = (day, pid, type, detail, action, outcome, orderId = null) =>
      q.evt.run(runId, day, pid, type, JSON.stringify(detail), action, outcome, orderId);

    for (let day = 1; day <= DAYS; day++) {
      const c = Object.fromEntries(all.map((s) => [s.p.product_id, { recv: 0, sold: 0, exp: 0 }]));
      let writeoff = 0;

      // ---------- START OF DAY ----------
      if (day === 1) {
        for (const s of all) if (s.p.initial_qty > 0) addBatch(s, 1, s.p.initial_qty, 'OPENING', null);
      }
      if (pending) {
        for (const l of pending.lines) {
          if (l.qty <= 0) continue;
          addBatch(state[l.pid], day, l.qty, 'ORDER', pending.orderId);
          c[l.pid].recv += l.qty;
        }
        pending = null;
      }
      for (const s of all) {
        for (const b of s.batches) {
          if (b.expiry != null && b.expiry <= day && b.remaining > 0) {
            q.mov.run(runId, day, s.p.product_id, b.id, 'EXPIRED', b.remaining, s.p.unit_cost_cents, null, null);
            const val = b.remaining * s.p.unit_cost_cents;
            c[s.p.product_id].exp += b.remaining;
            writeoff += val;
            event(day, s.p.product_id, 'EXPIRY_REMOVAL',
              { units: b.remaining, value_cents: val, batch_id: b.id, expiry_day: b.expiry },
              'Expired stock removed from sale', `Written off ${b.remaining} units`);
            b.remaining = 0;
          }
        }
        s.batches = s.batches.filter((b) => b.remaining > 0);
      }

      // ---------- TRADING ----------
      const ctx = buildDayContext(rng, cfg, day);
      q.ctx.run(runId, day, ctx.weekdayIdx, ctx.isRain ? 1 : 0, ctx.eventTag, ctx.expectedVisitors);
      const arrivals = hourlyArrivals(rng, cfg, ctx);
      let visitors = 0, txns = 0, units = 0, revenue = 0, cogs = 0;

      for (let hour = 0; hour < 24; hour++) {
        for (let i = 0; i < arrivals[hour]; i++) {
          visitors++;
          const mission = pickMission(rng, cfg, hour, ctx.isWeekend);
          const basket = new Map();                   // product_id -> {qty, allocs[]}
          const unmet = [];

          const add = (pid, qty) => {
            const s = state[pid];
            let need = qty;
            const e = basket.get(pid) ?? { qty: 0, allocs: [] };
            for (const b of s.batches) {
              if (need <= 0) break;
              const t = Math.min(b.remaining, need);
              if (t > 0) { b.remaining -= t; need -= t; e.qty += t; e.allocs.push({ b, qty: t }); }
            }
            basket.set(pid, e);
          };

          if (rng() >= cfg.browseOnlyProbability) {
            const wanted = drawWantedBasket(rng, cfg, ctx, mission, byCategory);
            for (const w of wanted) {
              const s = state[w.product_id];
              const give = Math.min(w.qty, onHand(s));
              if (give > 0) add(w.product_id, give);
              const short = w.qty - give;
              if (short <= 0) continue;
              let outcome = 'LOST', subId = null, subQty = 0;
              if (rng() < cfg.substituteProbability) {
                const pool = byCategory[s.p.category].filter(
                  (x) => x.product_id !== w.product_id && !basket.has(x.product_id) && onHand(state[x.product_id]) > 0);
                if (pool.length) {
                  const sub = pickWeighted(rng, pool, pool.map((x) => popularity(x.product_id)));
                  subQty = Math.min(short, onHand(state[sub.product_id]));
                  add(sub.product_id, subQty);
                  outcome = 'SUBSTITUTED'; subId = sub.product_id;
                }
              }
              unmet.push({ pid: w.product_id, qty: short, outcome, subId,
                lost: (short - subQty) * s.p.unit_price_cents });
            }
          }

          const lines = [...basket.entries()].filter(([, e]) => e.qty > 0);
          const custId = q.cust.run(runId, day, hour, mission, lines.length ? 1 : 0).lastInsertRowid;
          for (const u of unmet)
            q.unmet.run(runId, day, hour, custId, u.pid, u.qty, u.outcome, u.subId, u.lost);
          if (!lines.length) continue;

          let tUnits = 0, tTotal = 0;
          for (const [pid, e] of lines) { tUnits += e.qty; tTotal += e.qty * state[pid].p.unit_price_cents; }
          const txnId = q.txn.run(runId, custId, day, hour, tUnits, tTotal).lastInsertRowid;
          for (const [pid, e] of lines) {
            const p = state[pid].p;
            q.item.run(runId, txnId, pid, e.qty, p.unit_price_cents, e.qty * p.unit_price_cents);
            for (const a of e.allocs)
              q.mov.run(runId, day, pid, a.b.id, 'SOLD', a.qty, p.unit_cost_cents, txnId, null);
            c[pid].sold += e.qty;
            cogs += e.qty * p.unit_cost_cents;
          }
          txns++; units += tUnits; revenue += tTotal;
        }
      }
      for (const s of all) s.soldHist.push(c[s.p.product_id].sold);

      // ---------- END OF DAY: cash in ----------
      cash += revenue;
      if (revenue > 0) q.cash.run(runId, day, 'SALE', revenue, cash, null);

      // ---------- END OF DAY: Store Brain ----------
      const last = day === DAYS;
      const decisions = [];
      for (const s of all) {
        const p = s.p;
        const hist = s.soldHist.slice(-B.trailingDays);
        const avg = hist.reduce((a, b) => a + b, 0) / Math.max(1, hist.length);
        const avgEff = Math.max(avg, B.minDemandFloor);
        const stock = onHand(s);
        const usable = s.batches.filter((b) => b.expiry == null || b.expiry > day + 1)
                                .reduce((a, b) => a + b.remaining, 0);
        const cover = stock / avgEff;
        const d = { s, p, avg, avgEff, stock, usable, cover, want: 0, reason: '', atRisk: 0 };
        d.soldOut = stock === 0;
        d.low = !d.soldOut && cover < (p.is_perishable ? B.lowStockCoverDays.perishable : B.lowStockCoverDays.nonPerishable);
        d.slow = !p.is_perishable && day >= B.slowMoverMinDays && cover > B.slowMoverCoverDays;

        if (p.is_perishable) {                         // expected-unsold units in near-expiry batches
          let before = 0;
          for (const b of s.batches) {
            if (b.expiry != null && b.expiry - day <= B.expiryWarnWithinDays) {
              const sellDays = Math.max(0, b.expiry - day - 1);
              d.atRisk += Math.max(0, b.remaining - Math.max(0, avgEff * sellDays - before));
            }
            before += b.remaining;
          }
        }

        if (!last) {
          if (p.is_perishable) {
            const td = Math.min(B.targetCover.perishableMax, Math.max(B.targetCover.perishableMin, p.shelf_life_days * 0.5));
            const target = Math.ceil(avgEff * td * B.perishableSafety);
            d.want = Math.max(0, target - usable);
            d.reason = `perishable target ${target} (${td.toFixed(1)}d cover x${B.perishableSafety}) minus usable ${usable}`;
          } else if (!d.slow && cover <= B.reorderPointCoverDays) {
            const target = Math.ceil(avgEff * B.targetCover.nonPerishable);
            d.want = Math.max(0, target - stock);
            d.reason = `cover ${cover.toFixed(1)}d <= ${B.reorderPointCoverDays}d reorder point; order up to ${target}`;
          }
        }
        decisions.push(d);
      }

      // fund by urgency under the cash limit
      let cashLeft = cash;
      const funded = [...decisions].filter((d) => d.want > 0)
        .sort((a, b) => (a.soldOut ? -1 : a.usable / a.avgEff) - (b.soldOut ? -1 : b.usable / b.avgEff));
      let constrained = false;
      for (const d of funded) {
        const afford = Math.floor(cashLeft / d.p.unit_cost_cents);
        d.ordered = Math.min(d.want, afford);
        cashLeft -= d.ordered * d.p.unit_cost_cents;
        if (d.ordered < d.want) constrained = true;
      }
      const spend = cash - cashLeft;
      let orderId = null;
      if (spend > 0) {
        orderId = q.order.run(runId, day, day + 1, spend, cash, cashLeft, constrained ? 1 : 0).lastInsertRowid;
        pending = { orderId, lines: [] };
        for (const d of funded) {
          q.line.run(runId, orderId, d.p.product_id, d.want, d.ordered, d.p.unit_cost_cents, d.reason);
          if (d.ordered > 0) pending.lines.push({ pid: d.p.product_id, qty: d.ordered });
        }
        cash = cashLeft;
        q.cash.run(runId, day, 'ORDER', -spend, cash, orderId);
      }

      // record events with the action taken and the outcome
      for (const d of decisions) {
        const pid = d.p.product_id;
        const detail = { stock: d.stock, avg7: +d.avg.toFixed(2), cover_days: +d.cover.toFixed(2) };
        const resp = last ? ['Reported only (no Day 61 orders)', 'Closing position']
          : d.ordered > 0 ? [`Ordered ${d.ordered} units (wanted ${d.want})`, `Arrives day ${day + 1}${d.ordered < d.want ? ' - cut back by cash limit' : ''}`]
          : d.want > 0 ? [`Wanted ${d.want} units`, 'Not funded: insufficient cash']
          : ['No order needed', 'Stock judged sufficient'];
        if (d.soldOut) event(day, pid, 'SOLD_OUT', detail, resp[0], resp[1], orderId);
        else if (d.low) event(day, pid, 'LOW_STOCK', detail, resp[0], resp[1], orderId);
        if (d.atRisk >= 1)
          event(day, pid, 'EXPIRY_WARNING', { ...detail, at_risk_units: Math.round(d.atRisk) },
            'Order sized to expected sales; at-risk units may be written off',
            `${Math.round(d.atRisk)} units at risk of expiry`);
        if (d.slow && (slowLastEmit[pid] == null || day - slowLastEmit[pid] >= B.slowMoverReemitDays)) {
          slowLastEmit[pid] = day;
          event(day, pid, 'SLOW_MOVER', detail, 'Reorder held', `Holding ${d.stock} units = ${d.cover.toFixed(0)} days of sales`);
        }
        if (d.ordered > 0)
          event(day, pid, 'REORDER', { ...detail, reason: d.reason, qty_wanted: d.want },
            `Placed order for ${d.ordered} units`, `Arrives day ${day + 1}`, orderId);
        if (d.want > 0 && d.ordered < d.want)
          event(day, pid, 'CASH_CONSTRAINED', { ...detail, qty_wanted: d.want, qty_ordered: d.ordered, cash_left: cashLeft },
            'Order reduced to fit available cash', `Ordered ${d.ordered} of ${d.want}`, orderId);
      }

      // ---------- DAILY RECORDS ----------
      let invValue = 0;
      for (const s of all) {
        const pid = s.p.product_id, closing = onHand(s);
        const opening = day === 1 ? s.p.initial_qty : s.prevClosing;
        q.snap.run(runId, day, pid, opening, c[pid].recv, c[pid].sold, c[pid].exp, closing);
        s.prevClosing = closing;
        invValue += closing * s.p.unit_cost_cents;
      }
      q.sum.run(runId, day, ctx.weekdayIdx, visitors, txns, units, revenue, cogs, writeoff, spend, cash, invValue);
    }
    q.done.run(new Date().toISOString(), runId);
  });

  tx();
  return runId;
}