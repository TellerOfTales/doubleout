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
 *   2. When there IS a choice, does it matter? If the best action beats the
 *      second best by a wide margin, the turn answers itself.
 *
 * The numbers that condemned the old loop are in docs/decisions/design.md §1,
 * and §7 sets the thresholds the rebuild has to clear: naive agreement under
 * 35%, visits abandoned at the wall under 10%, median gap under 10%.
 * Re-run this after any change to the core loop.
 *
 *   npx vite-node tools/decisions.ts [--n=N]
 */
import { botShop, naiveAction, planPress, planSlate, planVisit, rankedActions } from '../src/core/bot';
import { sameTarget } from '../src/core/board';
import {
  beginLeg,
  commitMiss,
  commitThrow,
  createNight,
  currentLeg,
  currentVisit,
  pressContract,
  pullContract,
  pressable as pressableNow,
  shopLeave,
  takeContract,
} from '../src/core/state';
import type { Action } from '../src/core/bot';
import type { NightState } from '../src/core/types';

const arg = process.argv.find((a) => a.startsWith('--n='));
const NIGHTS = arg ? Number(arg.slice(4)) : 120;

const same = (a: Action, b: Action) => ('wall' in a ? 'wall' in b : !('wall' in b) && sameTarget(a.target, b.target));

/** Take what the planner fancies, then throw and work the slate between darts. */
function step(n: NightState, record: (leg: ReturnType<typeof currentLeg>) => void): void {
  const leg = currentLeg(n);
  const visit = currentVisit(leg);
  if (visit.throws.length === 0) for (const id of planSlate(n, leg)) takeContract(n, id);
  record(leg);
  const plan = planVisit(n, leg);
  if ('wall' in plan) {
    commitMiss(n);
    return;
  }
  commitThrow(n, plan.target, plan.use ? { use: plan.use } : {});
  if (n.phase !== 'LEG') return;
  const after = currentLeg(n);
  if (after.status !== 'ACTIVE') return;
  for (let guard = 0; guard < 8; guard++) {
    const act = planPress(n, after);
    if (!act) {
      if (after.slate.some((c) => !c.settled || pressableNow(n, after, c))) onPress('LEAVE');
      break;
    }
    onPress(act.act);
    if (act.act === 'PRESS') pressContract(n, act.index);
    else pullContract(n, act.index);
  }
}

/** Set by each pass so `step` can report the press decisions it makes. */
let onPress: (act: 'PRESS' | 'PULL' | 'LEAVE') => void = () => {};

// ---------------------------------------------------------------- 1. is it a choice?

let darts = 0;
let agree = 0;
let onlyOneGood = 0;
let wallDarts = 0;
let contractsOffered = 0;
let contractsTaken = 0;
let slateSteered = 0;
let slateDarts = 0;
/** What the planner does when a contract is sitting there made, or live. */
const pressActs = { PRESS: 0, PULL: 0, LEAVE: 0 };

onPress = (act) => {
  pressActs[act]++;
};

for (let seed = 1; seed <= NIGHTS; seed++) {
  const n = createNight(seed, 'local');
  beginLeg(n);
  for (let guard = 0; guard < 6000 && n.status === 'ACTIVE'; guard++) {
    if (n.phase === 'SHOP') {
      botShop(n);
      shopLeave(n);
      continue;
    }
    if (n.phase !== 'LEG') break;
    step(n, (leg) => {
      const visit = currentVisit(leg);
      if (visit.throws.length === 0) {
        contractsOffered += leg.offer.length + leg.slate.length;
        contractsTaken += leg.slate.length;
      }
      const ranked = rankedActions(n, leg);
      const plan = ranked[0].action;
      const naive = naiveAction(n, leg);
      darts++;
      if (same(naive, plan)) agree++;
      // The measurement this design actually lives or dies by. In real darts
      // the treble twenty IS the right answer most of the leg, so agreeing
      // with "throw the biggest number" is not by itself a fault. What must
      // be true is that the contracts on the slate change where the dart
      // goes. Replay the same dart with the slate emptied and see.
      if (leg.slate.some((c) => !c.settled)) {
        slateDarts++;
        const held = leg.slate;
        leg.slate = [];
        const without = rankedActions(n, leg)[0].action;
        leg.slate = held;
        if (!same(without, plan)) slateSteered++;
      }
      if ('wall' in plan) wallDarts++;
      // "No real choice" now means the field is a landslide rather than empty:
      // with free aim every target is always legal, so the question is whether
      // anything else was within touching distance of the best.
      const spread = ranked.filter((r) => r.value >= ranked[0].value - Math.abs(ranked[0].value) * 0.1 - 1);
      if (spread.length <= 1) onlyOneGood++;
    });
  }
}

// ---------------------------------------------------------------- 2. does it matter?

const gaps: number[] = [];
let visits = 0;
let abandoned = 0;
onPress = () => {};

for (let seed = 1; seed <= Math.min(NIGHTS, 80); seed++) {
  const n = createNight(seed, 'local');
  beginLeg(n);
  let lastVisitKey = '';
  for (let guard = 0; guard < 6000 && n.status === 'ACTIVE'; guard++) {
    if (n.phase === 'SHOP') {
      botShop(n);
      shopLeave(n);
      continue;
    }
    if (n.phase !== 'LEG') break;
    step(n, (leg) => {
      const visit = currentVisit(leg);
      const key = `${leg.index}:${visit.index}`;
      if (key !== lastVisitKey) {
        visits++;
        lastVisitKey = key;
      }
      const ranked = rankedActions(n, leg);
      if (ranked.length >= 2) {
        const best = ranked[0].value;
        const second = ranked[1].value;
        const scale = Math.max(1, Math.abs(best));
        gaps.push(Math.min(1, Math.abs(best - second) / scale));
      }
      if ('wall' in ranked[0].action) abandoned++;
    });
  }
}

// ---------------------------------------------------------------- report

const pressTotal = pressActs.PRESS + pressActs.PULL + pressActs.LEAVE;
const pc = (x: number, of: number) => `${((100 * x) / Math.max(1, of)).toFixed(1)}%`.padStart(6);
gaps.sort((a, b) => a - b);
const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

const rows: [string, string, string][] = [
  ['darts examined', String(darts).padStart(6), ''],
  ['naive rule == planner', pc(agree, darts), 'want < 35%'],
  ['-> only one good action', pc(onlyOneGood, darts), 'want < 20%'],
  ['planner threw at the wall', pc(wallDarts, darts), ''],
  ['contracts taken of offered', pc(contractsTaken, contractsOffered), ''],
  ['darts with a live contract', pc(slateDarts, darts), ''],
  ['-> slate changed the aim', pc(slateSteered, slateDarts), 'want > 35%'],
  ['', '', ''],
  ['press decisions made', String(pressTotal).padStart(6), ''],
  ['  pressed', pc(pressActs.PRESS, pressTotal), ''],
  ['  pulled', pc(pressActs.PULL, pressTotal), ''],
  ['  left riding', pc(pressActs.LEAVE, pressTotal), 'no verb over 70%'],
  ['', '', ''],
  ['visits played', String(visits).padStart(6), ''],
  ['visits ended at the wall', pc(abandoned, visits), 'want < 10%'],
  ['median gap best vs second', `${(median * 100).toFixed(0)}%`.padStart(6), 'want < 10%'],
  ['2nd within 10% of the best', pc(gaps.filter((g) => g < 0.1).length, gaps.length || 1), ''],
];

console.log(`DOUBLE OUT - is there a decision? ${NIGHTS} nights\n`);
for (const [label, value, note] of rows) {
  if (!label) {
    console.log('');
    continue;
  }
  console.log(`  ${label.padEnd(28)}${value}  ${note}`);
}
