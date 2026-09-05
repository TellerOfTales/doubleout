/**
 * The balance simulation (TDD §15). Prints the §15.2 target table and the
 * §15.3 anti-target sweep.
 *
 *   npx vite-node tools/balance.ts [--n=N] [--pairs]
 */
import { CHALK_DEFS } from '../src/content/chalkdefs';
import { seedRange, simulate } from '../src/core/bot';

const args = process.argv.slice(2);
const N = Number(args.find((a) => a.startsWith('--n='))?.slice(4) ?? 1000);
const PAIRS = args.includes('--pairs');

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function row(label: string, value: string, target: string, ok: boolean): void {
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${label.padEnd(38)} ${value.padStart(8)}   target ${target}`);
}

function timed<T>(label: string, fn: () => T): T {
  const t = Date.now();
  const out = fn();
  console.log(`  … ${label} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  return out;
}

const TYPICAL = ['heavy_tips', 'hot_twenty', 'fourth_dart', 'straight_out', 'wide_grip'];

console.log(`DOUBLE OUT — balance simulation, ${N} nights per metric\n`);
console.log('§15.2 targets');

const leg1 = timed('leg 1, greedy', () => simulate(seedRange(N * 2), 'greedy', { shop: false }));
row('leg 1 win rate (greedy)', pct(leg1.legWinRatesConditional[0]), '> 97%', leg1.legWinRatesConditional[0] > 0.97);

const leg1c = simulate(seedRange(N), 'checkout', { shop: false });
row('leg 1 win rate (checkout-aware)', pct(leg1c.legWinRatesConditional[0]), '(reference)', true);

const leg8bare = timed('leg 8, no chalk', () => simulate(seedRange(N), 'optimal', { startLeg: 7, shop: false }));
row('leg 8 win rate, no chalk (optimal)', pct(leg8bare.legWinRatesConditional[7]), '< 5%', leg8bare.legWinRatesConditional[7] < 0.05);

const leg8chalk = timed('leg 8, 5 chalk', () => simulate(seedRange(N), 'optimal', { startLeg: 7, startChalk: TYPICAL, shop: false }));
const r8 = leg8chalk.legWinRatesConditional[7];
row('leg 8 win rate, 5 chalk (optimal)', pct(r8), '45-60%', r8 >= 0.45 && r8 <= 0.6);

// the same, averaged over twenty random five-chalk sets
let sum = 0;
timed('leg 8, 20 random 5-chalk sets', () => {
  for (let i = 0; i < 20; i++) {
    const pool = CHALK_DEFS.map((c) => c.id);
    const pick: string[] = [];
    // deterministic spread through the pool, no RNG needed
    for (let k = 0; k < 5; k++) pick.push(pool[(i * 5 + k * 7) % pool.length]);
    sum += simulate(seedRange(Math.max(120, N / 6)), 'optimal', { startLeg: 7, startChalk: [...new Set(pick)], shop: false }).legWinRatesConditional[7];
  }
});
row('leg 8, random 5-chalk sets (mean)', pct(sum / 20), '45-60%', sum / 20 >= 0.45 && sum / 20 <= 0.6);

const nightOpt = timed('full night, optimal', () => simulate(seedRange(N * 2), 'optimal'));
row('full night win rate (optimal)', pct(nightOpt.winRate), '18-28%', nightOpt.winRate >= 0.18 && nightOpt.winRate <= 0.28);

const nightGreedy = timed('full night, greedy', () => simulate(seedRange(N * 2), 'greedy'));
row('full night win rate (greedy)', pct(nightGreedy.winRate), '< 8%', nightGreedy.winRate < 0.08);

const chalky = nightOpt.outcomes.filter((o) => o.chalkHeld.length >= 3);
const median180 = (() => {
  const xs = chalky.map((o) => o.oneEighties).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
})();
row('median 180s per night (3+ chalk)', String(median180), '4-9', median180 >= 4 && median180 <= 9);
row('busts per night (optimal)', nightOpt.meanBusts.toFixed(1), '3-7', nightOpt.meanBusts >= 3 && nightOpt.meanBusts <= 7);
console.log(`  (mean legs won: optimal ${nightOpt.meanLegsWon.toFixed(2)}, greedy ${nightGreedy.meanLegsWon.toFixed(2)})`);
console.log(`  (conditional leg win rates, optimal: ${nightOpt.legWinRatesConditional.map((x) => pct(x)).join(' ')})`);

console.log('\n§15.3 anti-targets — no single chalk may take leg 8 above 35%');
const single: [string, number][] = [];
for (const d of CHALK_DEFS) {
  const r = simulate(seedRange(300), 'optimal', { startLeg: 7, startChalk: [d.id], shop: false }).legWinRatesConditional[7];
  single.push([d.id, r]);
}
single.sort((a, b) => b[1] - a[1]);
for (const [id, r] of single.slice(0, 8)) console.log(`  ${r > 0.35 ? 'OVER' : 'ok  '} ${id.padEnd(18)} ${pct(r)}`);

if (PAIRS) {
  console.log('\n§15.3 anti-targets — no two-chalk pair may exceed 80%');
  const pairs: [string, number][] = [];
  for (let i = 0; i < CHALK_DEFS.length; i++) {
    for (let j = i + 1; j < CHALK_DEFS.length; j++) {
      const ids = [CHALK_DEFS[i].id, CHALK_DEFS[j].id];
      const r = simulate(seedRange(200), 'optimal', { startLeg: 7, startChalk: ids, shop: false }).legWinRatesConditional[7];
      pairs.push([ids.join(' + '), r]);
    }
  }
  pairs.sort((a, b) => b[1] - a[1]);
  for (const [ids, r] of pairs.slice(0, 12)) console.log(`  ${r > 0.8 ? 'OVER' : 'ok  '} ${ids.padEnd(36)} ${pct(r)}`);
}
