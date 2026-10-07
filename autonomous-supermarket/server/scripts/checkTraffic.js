// server/scripts/checkTraffic.js
import { DEMAND_CONFIG as cfg } from '../src/sim/demandConfig.js';
import { mulberry32, buildDayContext, hourlyArrivals, poisson } from '../src/sim/demandModel.js';

// 1. Is poisson() unbiased?
const r1 = mulberry32(1);
for (const lam of [2, 10, 25, 40]) {
  let s = 0; const N = 100000;
  for (let i = 0; i < N; i++) s += poisson(r1, lam);
  console.log(`poisson(${lam}) mean = ${(s / N).toFixed(2)}`);
}

// 2. Does the configured expectation match realised arrivals?
const rng = mulberry32(42);
const byDow = Array.from({ length: 7 }, () => ({ exp: 0, real: 0, n: 0 }));
for (let rep = 0; rep < 200; rep++) for (let day = 1; day <= 60; day++) {
  const ctx = buildDayContext(rng, cfg, day);
  const real = hourlyArrivals(rng, cfg, ctx).reduce((a, b) => a + b, 0);
  const d = byDow[ctx.weekdayIdx];
  d.exp += ctx.expectedVisitors; d.real += real; d.n++;
}
byDow.forEach((d, i) => console.log(
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i],
  'expected', (d.exp / d.n).toFixed(1), 'realised', (d.real / d.n).toFixed(1)));