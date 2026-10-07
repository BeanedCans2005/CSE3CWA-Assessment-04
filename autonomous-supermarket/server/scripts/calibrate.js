import fs from 'node:fs';
import { PRODUCTS, openingInventoryCostCents } from '../src/sim/catalogue.js';
import { DEMAND_CONFIG as cfg, tierIds } from '../src/sim/demandConfig.js';
import {
  mulberry32, buildDayContext, hourlyArrivals, pickMission, drawWantedBasket,
} from '../src/sim/demandModel.js';

const RUNS = 20;
const DAYS = 60;
const TARGET_BUDGET_CENTS = 3_800_000;   // aim just under the A$40,000 cap
const MAX_COVER_DAYS = 21;               // cap on non-perishable cover
const WRITE = process.argv.includes('--write');

const aud = (c) => `A$${(c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// 1. consistency checks between catalogue and config 
function sanityChecks() {
  const errors = [];
  const ids = new Set(PRODUCTS.map((p) => p.product_id));
  const cats = new Set(PRODUCTS.map((p) => p.category));

  if (ids.size !== PRODUCTS.length) errors.push('Duplicate product IDs in catalogue');

  const seen = new Map();
  for (const [tier, list] of Object.entries(tierIds)) {
    for (const id of list) {
      if (!ids.has(id)) errors.push(`Tier ${tier} lists unknown product ${id}`);
      if (seen.has(id)) errors.push(`${id} appears in tiers ${seen.get(id)} and ${tier}`);
      seen.set(id, tier);
    }
  }
  for (const id of ids) if (!seen.has(id)) errors.push(`${id} has no popularity tier`);

  for (const [m, def] of Object.entries(cfg.missions))
    for (const c of Object.keys(def.categories))
      if (!cats.has(c)) errors.push(`Mission ${m} references unknown category "${c}"`);
  for (const e of cfg.events)
    for (const c of Object.keys(e.categoryBoost))
      if (!cats.has(c)) errors.push(`Event ${e.tag} references unknown category "${c}"`);

  for (const p of PRODUCTS)
    if (p.unit_price_cents <= p.unit_cost_cents) errors.push(`${p.product_id} sells at or below cost`);

  for (const k of ['weekday', 'weekend'])
    if (cfg.hourlyWeights[k].length !== 24) errors.push(`hourlyWeights.${k} must have 24 entries`);
  if (cfg.weekdayFactor.length !== 7) errors.push('weekdayFactor must have 7 entries');
  if (!ids.has('P06')) errors.push('Rain rule references P06 (umbrella) which is not in the catalogue');

  return errors;
}

const errors = sanityChecks();
if (errors.length) {
  console.error('CONFIG / CATALOGUE PROBLEMS:\n - ' + errors.join('\n - '));
  process.exit(1);
}
console.log('Sanity checks passed.\n');

// 2. unconstrained demand simulation
const byCategory = {};
for (const p of PRODUCTS) (byCategory[p.category] ??= []).push(p);
const byId = Object.fromEntries(PRODUCTS.map((p) => [p.product_id, p]));

const dailyUnits = Object.fromEntries(PRODUCTS.map((p) => [p.product_id, []]));  // one entry per run-day
const hourly = { weekday: Array(24).fill(0), weekend: Array(24).fill(0) };
const dayCount = { weekday: 0, weekend: 0 };
const missionCount = {};
const totals = { visitors: 0, txns: 0, units: 0, revenue: 0, cogs: 0, lines: 0,
                 wkdayVisitors: 0, wkendVisitors: 0, rainDays: 0, eventVisitors: 0 };
const catStats = {};

for (let run = 1; run <= RUNS; run++) {
  const rng = mulberry32(run * 7919);
  for (let day = 1; day <= DAYS; day++) {
    const ctx = buildDayContext(rng, cfg, day);
    const arrivals = hourlyArrivals(rng, cfg, ctx);
    const kind = ctx.isWeekend ? 'weekend' : 'weekday';
    dayCount[kind]++;
    if (ctx.isRain) totals.rainDays++;

    const dayUnits = {};
    let dayVisitors = 0;

    arrivals.forEach((n, hour) => {
      for (let i = 0; i < n; i++) {
        dayVisitors++;
        hourly[kind][hour]++;
        if (rng() < cfg.browseOnlyProbability) continue;

        const mission = pickMission(rng, cfg, hour, ctx.isWeekend);
        const lines = drawWantedBasket(rng, cfg, ctx, mission, byCategory);
        if (!lines.length) continue;

        missionCount[mission] ??= { n: 0, lines: 0, units: 0 };
        missionCount[mission].n++;
        totals.txns++;
        for (const { product_id, qty } of lines) {
          const p = byId[product_id];
          dayUnits[product_id] = (dayUnits[product_id] ?? 0) + qty;
          totals.units += qty;
          totals.lines++;
          totals.revenue += qty * p.unit_price_cents;
          totals.cogs += qty * p.unit_cost_cents;
          missionCount[mission].lines++;
          missionCount[mission].units += qty;
          const cs = (catStats[p.category] ??= { units: 0, revenue: 0, gp: 0 });
          cs.units += qty;
          cs.revenue += qty * p.unit_price_cents;
          cs.gp += qty * (p.unit_price_cents - p.unit_cost_cents);
        }
      }
    });

    totals.visitors += dayVisitors;
    if (ctx.isWeekend) totals.wkendVisitors += dayVisitors; else totals.wkdayVisitors += dayVisitors;
    if (ctx.eventTag) totals.eventVisitors += dayVisitors;
    for (const p of PRODUCTS) dailyUnits[p.product_id].push(dayUnits[p.product_id] ?? 0);
  }
}

const totalDays = RUNS * DAYS;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))];

// ---------- 3. headline numbers ----------
console.log(`=== Headline (avg per day over ${RUNS} runs x ${DAYS} days, unconstrained demand) ===`);
console.table({
  'Visitors / day':            +(totals.visitors / totalDays).toFixed(1),
  'Weekday visitors / day':    +(totals.wkdayVisitors / dayCount.weekday).toFixed(1),
  'Weekend visitors / day':    +(totals.wkendVisitors / dayCount.weekend).toFixed(1),
  'Transactions / day':        +(totals.txns / totalDays).toFixed(1),
  'Units / day':               +(totals.units / totalDays).toFixed(1),
  'Units / transaction':       +(totals.units / totals.txns).toFixed(2),
  'Lines / transaction':       +(totals.lines / totals.txns).toFixed(2),
  'Avg transaction value':     aud(totals.revenue / totals.txns),
  'Revenue / day':             aud(totals.revenue / totalDays),
  'COGS / day':                aud(totals.cogs / totalDays),
  'Gross margin %':            +(100 * (1 - totals.cogs / totals.revenue)).toFixed(1),
  'Event-day (day 20) visitors': +(totals.eventVisitors / RUNS).toFixed(0),
});

console.log('\n=== Hourly average customers (weekday | weekend) ===');
const hourRows = {};
for (let h = 0; h < 24; h++) {
  hourRows[String(h).padStart(2, '0') + ':00'] = {
    weekday: +(hourly.weekday[h] / dayCount.weekday).toFixed(1),
    weekend: +(hourly.weekend[h] / dayCount.weekend).toFixed(1),
  };
}
console.table(hourRows);

console.log('\n=== Missions ===');
const missionRows = {};
for (const [m, s] of Object.entries(missionCount)) {
  missionRows[m] = {
    share_pct: +(100 * s.n / totals.txns).toFixed(1),
    lines_per_txn: +(s.lines / s.n).toFixed(2),
    units_per_txn: +(s.units / s.n).toFixed(2),
  };
}
console.table(missionRows);

console.log('\n=== Categories (avg per day) ===');
const catRows = {};
for (const [c, s] of Object.entries(catStats)) {
  catRows[c] = {
    units_day: +(s.units / totalDays).toFixed(1),
    revenue_day: aud(s.revenue / totalDays),
    revenue_share_pct: +(100 * s.revenue / totals.revenue).toFixed(1),
    margin_pct: +(100 * s.gp / s.revenue).toFixed(1),
  };
}
console.table(catRows);

// ---------- 4. opening quantities ----------
const perishableCover = (shelf) => (shelf <= 3 ? 1.5 : shelf <= 7 ? 2.5 : shelf <= 14 ? 4 : 7);

function suggestQty(p, meanDaily, nonPerishCover) {
  if (p.is_perishable) return Math.max(4, Math.ceil(meanDaily * perishableCover(p.shelf_life_days)));
  return Math.max(10, Math.ceil(meanDaily * nonPerishCover));
}
const meanDaily = Object.fromEntries(PRODUCTS.map((p) => [p.product_id, mean(dailyUnits[p.product_id])]));
const totalCost = (cover) =>
  PRODUCTS.reduce((s, p) => s + p.unit_cost_cents * suggestQty(p, meanDaily[p.product_id], cover), 0);

let bestCover = 3;
for (let c = 3; c <= MAX_COVER_DAYS; c += 0.25) {
  if (totalCost(c) <= TARGET_BUDGET_CENTS) bestCover = c; else break;
}
if (totalCost(3) > TARGET_BUDGET_CENTS) {
  console.warn('\nWARNING: even 3 days of cover exceeds the target budget. Reduce traffic or prices/costs.');
}

console.log(`\n=== Per product (cover chosen for non-perishables: ${bestCover} days) ===`);
const productRows = {};
const newQty = {};
for (const p of PRODUCTS) {
  const m = meanDaily[p.product_id];
  const q = suggestQty(p, m, bestCover);
  newQty[p.product_id] = q;
  productRows[`${p.product_id} ${p.name}`] = {
    perish: p.is_perishable ? `${p.shelf_life_days}d` : '-',
    mean_day: +m.toFixed(1),
    p90_day: pct(dailyUnits[p.product_id], 0.9),
    old_qty: p.initial_qty,
    new_qty: q,
    cover_days: +(q / Math.max(m, 0.001)).toFixed(1),
    cost: aud(q * p.unit_cost_cents),
  };
}
console.table(productRows);

const newTotal = totalCost(bestCover);
console.log(`\nOpening inventory with draft quantities: ${aud(openingInventoryCostCents())}`);
console.log(`Opening inventory with suggested quantities: ${aud(newTotal)}  (budget ${aud(4_000_000)})`);

if (WRITE) {
  const out = new URL('../src/sim/openingQty.json', import.meta.url);
  fs.writeFileSync(out, JSON.stringify(newQty, null, 2));
  console.log(`\nWrote ${out.pathname}`);
} else {
  console.log('\nDry run only. Re-run with:  npm run calibrate -- --write');
}