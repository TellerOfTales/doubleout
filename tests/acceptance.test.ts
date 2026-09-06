/**
 * THE FIVE ACCEPTANCE TESTS — docs/decisions/design.md §7.
 *
 * "The rebuild is not done because it compiles. It is done when these hold,
 * and they are written as tests." So here they are, in the order the document
 * lists them:
 *
 *   1. Naive-rule agreement falls below 35%.
 *   2. Visits ending at the wall fall below 10%.
 *   3. Median gap between best and second-best action falls below 10%.
 *   4. A bot that always banks sometimes wins; one that never banks almost
 *      always loses.
 *   5. A bot that ignores the slate entirely still finishes some nights.
 *
 * The measurements are the ones `tools/decisions.ts` prints, so a failure here
 * and a bad column there are the same fact. Four of them need the planner in
 * `src/core/bot.ts`; it is loaded dynamically inside each test so that a bot
 * mid-rewrite fails these five and nothing else in the suite.
 *
 * Run the full-size sweep with ACCEPTANCE_FULL=1.
 */
import { describe, expect, it } from 'vitest';
import { targetNotation } from '../src/core/board.ts';
import { beginLeg, commitMiss, commitThrow, createNight, currentLeg, currentVisit, shopLeave } from '../src/core/state.ts';
import type { Target } from '../src/core/types.ts';

const FULL = process.env.ACCEPTANCE_FULL === '1';
/** Nights walked dart by dart for the three measurements of §7.1–§7.3. */
const NIGHTS = FULL ? 120 : 20;
/** Nights per policy for the two press-your-luck tests of §7.4–§7.5. */
const POLICY_SEEDS = FULL ? 60 : 16;

type Action = { target: Target; use?: string } | { wall: true };

function sameAction(a: Action, b: Action): boolean {
  if ('wall' in a || 'wall' in b) return 'wall' in a && 'wall' in b;
  return targetNotation(a.target) === targetNotation(b.target);
}

interface Measurement {
  darts: number;
  /** Darts on which the naive rule picked what the planner picked. */
  agree: number;
  /** Darts the planner threw at the wall. */
  wallDarts: number;
  visits: number;
  /** Visits the planner ended at the wall. */
  wallVisits: number;
  /** (best − second) / best, over every dart with a real choice. Sorted. */
  gaps: number[];
}

let measured: Measurement | null = null;

/**
 * Walk NIGHTS nights dart by dart with the planner, recording what the naive
 * rule would have done, where the visit ended, and how far the best action
 * stood above the second best.
 */
async function measure(): Promise<Measurement> {
  if (measured) return measured;
  const { botShop, naiveAction, rankedActions } = await import('../src/core/bot.ts');
  const m: Measurement = { darts: 0, agree: 0, wallDarts: 0, visits: 0, wallVisits: 0, gaps: [] };
  for (let seed = 1; seed <= NIGHTS; seed++) {
    const n = createNight(seed, 'local');
    beginLeg(n);
    let lastVisit = '';
    for (let guard = 0; guard < 4000 && n.status === 'ACTIVE'; guard++) {
      if (n.phase === 'SHOP') {
        botShop(n);
        shopLeave(n);
        continue;
      }
      if (n.phase !== 'LEG') break;
      const leg = currentLeg(n);
      const visit = currentVisit(leg);
      const key = `${leg.index}:${visit.index}`;
      if (key !== lastVisit) {
        m.visits++;
        lastVisit = key;
      }
      const rated = rankedActions(n, leg);
      if (rated.length >= 2 && rated[0].value > 0) m.gaps.push((rated[0].value - rated[1].value) / Math.abs(rated[0].value));
      const plan = rated[0].action as Action;
      m.darts++;
      if (sameAction(plan, naiveAction(n, leg) as Action)) m.agree++;
      if ('wall' in plan) {
        m.wallDarts++;
        m.wallVisits++;
        commitMiss(n);
      } else {
        commitThrow(n, plan.target, plan.use ? { use: plan.use } : {});
      }
    }
  }
  m.gaps.sort((a, b) => a - b);
  measured = m;
  return m;
}

const pc = (x: number) => `${(100 * x).toFixed(1)}%`;

describe('§7 — the rebuild is done when these hold', () => {
  it('1. the naive rule agrees with the planner on fewer than 35% of darts', async () => {
    const m = await measure();
    expect(m.darts).toBeGreaterThan(200);
    const agreement = m.agree / m.darts;
    console.log(`§7.1 naive-rule agreement ${pc(agreement)} over ${m.darts} darts (target < 35%)`);
    expect(agreement, 'the "biggest number that does not bust" rule is still near-optimal').toBeLessThan(0.35);
  }, 600000);

  it('2. fewer than 10% of visits end at the wall', async () => {
    const m = await measure();
    expect(m.visits).toBeGreaterThan(50);
    const abandoned = m.wallVisits / m.visits;
    console.log(`§7.2 visits ended at the wall ${pc(abandoned)} of ${m.visits} (target < 10%); darts at the wall ${pc(m.wallDarts / m.darts)}`);
    expect(abandoned, 'throwing a visit away is still the default endgame').toBeLessThan(0.1);
  }, 600000);

  it('3. the best action beats the second best by a median of less than 10%', async () => {
    const m = await measure();
    expect(m.gaps.length).toBeGreaterThan(200);
    const median = m.gaps[Math.floor(m.gaps.length / 2)];
    const close = m.gaps.filter((g) => g < 0.1).length / m.gaps.length;
    console.log(`§7.3 median gap best vs second ${pc(median)} (target < 10%); ${pc(close)} of darts are close calls`);
    expect(median, 'the turn still answers itself').toBeLessThan(0.1);
  }, 600000);

  it('4. always banking sometimes wins; never banking almost always loses', async () => {
    const { seedRange, simulate } = await import('../src/core/bot.ts');
    const seeds = seedRange(POLICY_SEEDS);
    const always = simulate(seeds, 'always_bank');
    const never = simulate(seeds, 'never_bank');
    console.log(`§7.4 always-bank wins ${pc(always.winRate)}, never-bank wins ${pc(never.winRate)} over ${seeds.length} nights each`);
    // If never banking wins as often, the money on the table is never at risk
    // and greed is free; if always banking never wins, the wager is decoration.
    expect(always.winRate, 'a bot that always banks never wins: the wager is decoration').toBeGreaterThan(0);
    expect(never.winRate, 'a bot that never banks wins too often: greed is free').toBeLessThanOrEqual(0.2);
    expect(never.winRate).toBeLessThan(always.winRate);
  }, 600000);

  it('5. a bot that ignores the slate entirely still finishes some nights', async () => {
    const { seedRange, simulate } = await import('../src/core/bot.ts');
    const bare = simulate(seedRange(POLICY_SEEDS), 'no_slate');
    console.log(`§7.5 slate-blind bot wins ${pc(bare.winRate)}, ${bare.meanLegsWon.toFixed(2)} legs a night`);
    expect(bare.meanLegsWon, 'the darts game underneath does not stand up on its own').toBeGreaterThan(1);
    expect(bare.winRate, 'the slate is not optional decoration, it is the game').toBeGreaterThan(0);
  }, 600000);
});
