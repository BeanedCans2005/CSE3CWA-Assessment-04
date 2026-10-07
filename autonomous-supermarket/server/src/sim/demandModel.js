// --- seeded RNG so a run is reproducible from rng_seed ---
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

export function poisson(rng, lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rng)));
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

export function pickWeighted(rng, items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// --- layer 1: day context (stored in day_context for the audit trail) ---
export function buildDayContext(rng, cfg, day) {
  const idx = (day - 1) % 7;
  const event = cfg.events.find(e => e.day === day) ?? null;
  const isRain = rng() < cfg.rainProbability;
  let mult = cfg.weekdayFactor[idx] * Math.exp(cfg.dayNoiseSigma * normal(rng));
  const expectedVisitors = cfg.baseVisitorsPerDay * mult;
  if (isRain) mult *= cfg.rainTrafficFactor;
  if (event) mult *= event.trafficFactor;
  if (!Number.isFinite(expectedVisitors)) {
    throw new Error(`expectedVisitors is ${expectedVisitors} on day ${day}; check demandConfig keys`);
  }
  return {
    day, weekdayIdx: idx, isWeekend: idx >= 5, isRain,
    eventTag: event?.tag ?? null,
    categoryBoost: event?.categoryBoost ?? {},
    expectedVisitors,
  };
}

// --- layer 2: arrivals per hour ---
export function hourlyArrivals(rng, cfg, ctx) {
  const w = ctx.isWeekend ? cfg.hourlyWeights.weekend : cfg.hourlyWeights.weekday;
  const total = w.reduce((a, b) => a + b, 0);
  return w.map(x => poisson(rng, (ctx.expectedVisitors * x) / total));
}

// --- layer 3: mission ---
const blockOf = (h) =>
  h >= 5 && h <= 10 ? 'morning' :
  h >= 11 && h <= 14 ? 'lunch' :
  h >= 15 && h <= 16 ? 'afternoon' :
  h >= 17 && h <= 20 ? 'evening' : 'late';

export function pickMission(rng, cfg, hour, isWeekend) {
  const mix = cfg.missionMix[blockOf(hour)];
  const names = Object.keys(mix);
  const weights = names.map(n => mix[n] * (isWeekend ? cfg.weekendMissionFactor[n] : 1));
  return pickWeighted(rng, names, weights);
}

// --- layer 4: what the customer WANTS (before availability) ---
const popularity = (cfg, ctx, p) =>
  cfg.tierWeight[cfg.tier[p.product_id]] *
  (ctx.isRain && p.product_id === 'P06' ? cfg.rainUmbrellaFactor : 1);

export function drawWantedBasket(rng, cfg, ctx, mission, byCategory) {
  const m = cfg.missions[mission];
  const cats = Object.keys(m.categories);
  const catWeights = cats.map(c => m.categories[c] * (ctx.categoryBoost[c] ?? 1));
  const nLines = Math.min(cfg.maxLines, 1 + poisson(rng, m.meanLines - 1));
  const seen = new Set();
  const lines = [];
  for (let i = 0; i < nLines; i++) {
    const cat = pickWeighted(rng, cats, catWeights);
    const pool = byCategory[cat].filter(p => !seen.has(p.product_id));
    if (!pool.length) continue;
    const p = pickWeighted(rng, pool, pool.map(x => popularity(cfg, ctx, x)));
    seen.add(p.product_id);
    const qty = 1 + (rng() < cfg.extraUnitProb[0] ? 1 : 0) + (rng() < cfg.extraUnitProb[1] ? 1 : 0);
    lines.push({ product_id: p.product_id, qty });
  }
  return lines;
}