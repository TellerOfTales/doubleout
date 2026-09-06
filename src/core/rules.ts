/**
 * Base ruleset helpers (TDD §3, §4): pot rewards and the unmodified
 * bust/checkout law used as the reference table in tests.
 */
import { BIG_FINISH_LADDER, HEAT_CAP, LEGS, streakMultiplier } from '../content/legs';
import { baseValue, isDoubleRegion } from './board';
import type { LegState, PotBreakdown, Target } from './types';

/** Pot for a checkout from `score` on the big-finish ladder (0 below a ton). */
export function bigFinishBonus(score: number): number {
  for (const [from, pot] of BIG_FINISH_LADDER) if (score >= from) return pot;
  return 0;
}

/**
 * Pot for a checked-out leg (TDD §4), plus this build's additions: the crowd
 * heat, which scales everything by up to ×2 and is wiped by a bust or a walk to
 * the wall; and the clean sheet, which multiplies the lot when this is the
 * second or later clean leg in a row. `streak` is the night's clean-sheet count
 * INCLUDING this leg (0 when the leg was dirty).
 *
 * There is deliberately NO bonus for finishing with visits to spare. It paid a
 * Pot for every unused visit, which is a direct reward for throwing the treble
 * twenty and getting out — the exact behaviour the fourth playtest called
 * dreadfully boring. Without it, a spare visit is worth whatever you can take
 * off the slate in it, and the leg carries its own press-your-luck question:
 * how long can you milk the contracts before you have to close this out.
 */
export function potReward(leg: LegState, streak = 0): PotBreakdown {
  const def = LEGS[leg.index];
  const visitsUsed = leg.visits.length;
  const finishing = leg.visits[leg.visits.length - 1];
  const checkoutFrom = finishing ? finishing.scoreAtVisitStart : 0;
  const base = def.reward;
  const bigFinish = bigFinishBonus(checkoutFrom);
  const cleanLeg = leg.bustsThisLeg === 0 ? 3 : 0;
  const nineDarter = visitsUsed === 3 && (def.start >= 501 || (leg.visits[0]?.scoreAtVisitStart ?? 0) >= 501) ? 5 : 0;
  const subtotal = base + bigFinish + cleanLeg + nineDarter;
  const heat = Math.min(HEAT_CAP, leg.heat);
  // ×1 at heat 0 rising to ×2 at the cap, in quarters so it stays integer.
  const heatBonus = Math.floor((subtotal * heat) / HEAT_CAP);
  const withHeat = subtotal + heatBonus;
  // The clean sheet multiplies the leg and its finish, not the visits it left
  // unused or the crowd: a fast clean leg is worth more, not everything.
  const streakMult = streakMultiplier(streak);
  const streakBonus = (base + bigFinish + nineDarter) * (streakMult - 1);
  return {
    base,
    bigFinish,
    cleanLeg,
    nineDarter,
    heat,
    heatBonus,
    streak,
    streakMult,
    streakBonus,
    total: withHeat + streakBonus,
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
