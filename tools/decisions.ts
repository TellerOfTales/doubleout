/**
 * Is there a decision in the loop?
 *
 * Written after the third playtest returned the same verdict three times over:
 * "picking the highest number until I get to a miss point and then missing on
 * purpose until I get the number I need." This measures whether that is true,
 * rather than arguing about it.
 *
 * Two questions:
 *   1. How often does the naive rule the player describes ("throw the biggest
 *      number that does not bust, otherwise walk") agree with the full
 *      expectimax planner? And how many darts have no real choice at all?
 *   2. When there IS a choice, does it matter? If the best card beats the
 *      second best by a wide margin on the only axis the game has, the turn
 *      answers itself.
 *
 * Results on the build at a97e245 are recorded in docs/decisions/design.md §1.
 * Re-run this after any change to the core loop: a loop worth playing should
 * push "no real choice" and "visits abandoned at the wall" toward zero.
 *
 *   npx vite-node tools/decisions.ts [--n=N]
 */
import { botShop, planVisit } from '../src/core/bot';
import { resolveThrow } from '../src/core/resolver';
import { beginLeg, commitCard, commitMiss, createNight, currentLeg, currentVisit, shopLeave } from '../src/core/state';

const arg = process.argv.find((a) => a.startsWith('--n='));
const NIGHTS = arg ? Number(arg.slice(4)) : 120;

// ---------------------------------------------------------------- 1. is it a choice?

let darts = 0;
let agree = 0;
let forced = 0;
let onlyOneLegal = 0;
let wallDarts = 0;
const handSizes: number[] = [];

for (let seed = 1; seed <= NIGHTS; seed++) {
  const n = createNight(seed, 'local');
  beginLeg(n);
  for (let guard = 0; guard < 4000 && n.status === 'ACTIVE'; guard++) {
    if (n.phase === 'SHOP') {
      botShop(n, 'optimal');
      shopLeave(n);
      continue;
    }
    if (n.phase !== 'LEG') break;
    const leg = currentLeg(n);
    const visit = currentVisit(leg);
    const ti = visit.throws.length as 0 | 1 | 2 | 3;
    let naive: string | null = null;
    let naiveVal = -1;
    let legal = 0;
    for (const c of leg.hand) {
      const r = resolveThrow(c, {
        chalk: n.chalk,
        rng: null,
        scoreBefore: leg.score,
        scoreAtVisitStart: visit.scoreAtVisitStart,
        visitThrowIndex: ti,
        forgivenessUsed: true,
      }).result;
      if (r.outcome === 'BUST') continue;
      legal++;
      if (r.totalValue > naiveVal) {
        naiveVal = r.totalValue;
        naive = c.id;
      }
    }
    const plan = planVisit(n, leg);
    const planId = 'card' in plan ? plan.card.id : null;
    darts++;
    handSizes.push(leg.hand.length);
    if (legal === 0) forced++;
    if (legal === 1) onlyOneLegal++;
    if (planId === null) wallDarts++;
    if ((naive === null && planId === null) || naive === planId) agree++;
    if (planId === null) commitMiss(n);
    else commitCard(n, planId);
  }
}

// ---------------------------------------------------------------- 2. does it matter?

const gaps: number[] = [];
let visits = 0;
let abandoned = 0;

for (let seed = 1; seed <= Math.min(NIGHTS, 80); seed++) {
  const n = createNight(seed, 'local');
  beginLeg(n);
  let lastVisitKey = '';
  for (let guard = 0; guard < 4000 && n.status === 'ACTIVE'; guard++) {
    if (n.phase === 'SHOP') {
      botShop(n, 'optimal');
      shopLeave(n);
      continue;
    }
    if (n.phase !== 'LEG') break;
    const leg = currentLeg(n);
    const visit = currentVisit(leg);
    const key = `${leg.index}:${visit.index}`;
    if (key !== lastVisitKey) {
      visits++;
      lastVisitKey = key;
    }
    const ti = visit.throws.length as 0 | 1 | 2 | 3;
    const vals: number[] = [];
    for (const c of leg.hand) {
      const r = resolveThrow(c, {
        chalk: n.chalk,
        rng: null,
        scoreBefore: leg.score,
        scoreAtVisitStart: visit.scoreAtVisitStart,
        visitThrowIndex: ti,
        forgivenessUsed: true,
      }).result;
      if (r.outcome !== 'BUST') vals.push(r.totalValue);
    }
    vals.sort((a, b) => b - a);
    if (vals.length >= 2 && vals[0] > 0) gaps.push((vals[0] - vals[1]) / vals[0]);
    const plan = planVisit(n, leg);
    if ('wall' in plan) {
      abandoned++;
      commitMiss(n);
    } else commitCard(n, plan.card.id);
  }
}

// ---------------------------------------------------------------- report

const pc = (x: number, of: number) => `${((100 * x) / of).toFixed(1)}%`.padStart(6);
gaps.sort((a, b) => a - b);
const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

console.log(`DOUBLE OUT - is there a decision? ${NIGHTS} nights\n`);
console.log(`  darts examined              ${String(darts).padStart(6)}`);
console.log(`  naive rule == planner       ${pc(agree, darts)}`);
console.log(`  no legal card (forced)      ${pc(forced, darts)}`);
console.log(`  exactly one legal card      ${pc(onlyOneLegal, darts)}`);
console.log(`  -> not a decision at all    ${pc(forced + onlyOneLegal, darts)}`);
console.log(`  planner threw at the wall   ${pc(wallDarts, darts)}`);
console.log(`  mean hand size              ${handSizes.length ? (handSizes.reduce((a, b) => a + b, 0) / handSizes.length).toFixed(2).padStart(6) : '     -'}`);
console.log('');
console.log(`  visits played               ${String(visits).padStart(6)}`);
console.log(`  visits ended at the wall    ${pc(abandoned, visits)}`);
console.log(`  median gap best vs second   ${`${(median * 100).toFixed(0)}%`.padStart(6)} of the best card's value`);
console.log(`  2nd within 10% of the best  ${pc(gaps.filter((g) => g < 0.1).length, gaps.length || 1)}`);
