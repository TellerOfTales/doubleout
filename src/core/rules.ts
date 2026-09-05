/**
 * Base ruleset helpers (TDD §3, §4): pot rewards and the unmodified
 * bust/checkout law used as the reference table in tests.
 */
import { HEAT_CAP, LEGS } from '../content/legs';
import { baseValue, isDoubleRegion } from './board';
import type { LegState, PotBreakdown, Target } from './types';

/**
 * Pot for a checked-out leg (TDD §4), plus the two additions this build makes:
 * the "left it right" bonuses banked during the leg, and the crowd heat, which
 * scales everything by up to ×2 and is wiped by a single bust.
 */
export function potReward(leg: LegState): PotBreakdown {
  const def = LEGS[leg.index];
  const visitsUsed = leg.visits.length;
  const finishing = leg.visits[leg.visits.length - 1];
  const checkoutFrom = finishing ? finishing.scoreAtVisitStart : 0;
  const base = def.reward;
  const unusedVisits = Math.max(0, leg.visitLimit - visitsUsed);
  const bigFinish = checkoutFrom >= 100 ? 2 : 0;
  const cleanLeg = leg.bustsThisLeg === 0 ? 3 : 0;
  const nineDarter = visitsUsed === 3 ? 5 : 0;
  const setup = leg.setupBonuses;
  const subtotal = base + unusedVisits + bigFinish + cleanLeg + nineDarter + setup;
  const heat = Math.min(HEAT_CAP, leg.heat);
  // ×1 at heat 0 rising to ×2 at the cap, in quarters so it stays integer.
  const heatBonus = Math.floor((subtotal * heat) / HEAT_CAP);
  return {
    base,
    unusedVisits,
    bigFinish,
    cleanLeg,
    nineDarter,
    setup,
    heat,
    heatBonus,
    total: subtotal + heatBonus,
    checkoutFrom,
    visitsUsed,
  };
}

export type Classification = 'CONTINUE' | 'CHECKOUT' | 'BUST';

/**
 * Reference classification of a throw under the base rules, no chalk:
 * bust if the result is below 0, exactly 1, or exactly 0 without a double.
 */
export function classifyBase(score: number, target: Target): Classification {
  const after = score - baseValue(target);
  if (after < 0) return 'BUST';
  if (after === 1) return 'BUST';
  if (after === 0) return isDoubleRegion(target) ? 'CHECKOUT' : 'BUST';
  return 'CONTINUE';
}

/** True if a remaining score can be finished at all under the base rules (2..170 except 169, 168, 166, 165, 163, 162, 159). */
export function isFinishableBase(score: number): boolean {
  if (score < 2 || score > 170) return false;
  return ![169, 168, 166, 165, 163, 162, 159].includes(score);
}
