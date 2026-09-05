/** TDD §4 — the eight legs of a night. */
export interface LegDef {
  name: string;
  visitLimit: number;
  /** Base pot reward for checking out. 0 on the last leg (the win is the reward). */
  reward: number;
}

/**
 * Visit limits, recalibrated for the per-visit hand: one hand of five spent
 * across three darts scores less than a fresh best-of-three every dart did, so
 * every leg gets one more visit than TDD §4. See docs/decisions/balance.md.
 */
const LIMITS = [13, 12, 11, 10, 9, 8, 6, 4];

export const LEGS: LegDef[] = [
  { name: 'First Round', visitLimit: LIMITS[0], reward: 4 },
  { name: 'Second Round', visitLimit: LIMITS[1], reward: 6 },
  { name: 'Quarter', visitLimit: LIMITS[2], reward: 8 },
  { name: 'Interval', visitLimit: LIMITS[3], reward: 9 },
  { name: 'Semi', visitLimit: LIMITS[4], reward: 11 },
  { name: 'Last Four', visitLimit: LIMITS[5], reward: 13 },
  { name: 'Final', visitLimit: LIMITS[6], reward: 15 },
  { name: 'The Decider', visitLimit: LIMITS[7], reward: 0 },
];

export const LEG_COUNT = LEGS.length;
export const STARTING_SCORE = 501;
export const DEFAULT_HAND_SIZE = 3;
export const DEFAULT_THROWS_PER_VISIT = 3;
export const DEFAULT_CHALK_SLOTS = 5;
export const SHOP_REFRESH_COST = 1;
export const SERVICE_COST = { REMOVE: 2, DUPLICATE: 4, SHARPEN: 5 } as const;

/** Consecutive bust-free visits needed to double the leg's Pot. */
export const HEAT_CAP = 4;
/** Pot paid the moment a visit leaves a score you can actually finish. */
export const SETUP_BONUS = 1;
/** Most "left it right" bonuses payable in one leg. */
export const SETUP_BONUS_CAP = 4;
