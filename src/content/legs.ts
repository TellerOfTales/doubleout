/** TDD §4 — the eight legs of a night. */
export interface LegDef {
  name: string;
  visitLimit: number;
  /** Base pot reward for checking out. 0 on the last leg (the win is the reward). */
  reward: number;
  /**
   * Starting score. The first two legs are 301 — the pub's short game — so the
   * first win lands inside the first minute or two; the rest are the full 501.
   */
  start: number;
}

/**
 * Visit limits: the two 301 legs get ten, the 501 legs step down from eleven
 * to the Decider's four. Tuned by simulation — docs/decisions/balance.md.
 */
const LIMITS = [10, 10, 11, 10, 9, 8, 6, 4];
const STARTS = [301, 301, 501, 501, 501, 501, 501, 501];

export const LEGS: LegDef[] = [
  { name: 'First Round', visitLimit: LIMITS[0], reward: 4, start: STARTS[0] },
  { name: 'Second Round', visitLimit: LIMITS[1], reward: 6, start: STARTS[1] },
  { name: 'Quarter', visitLimit: LIMITS[2], reward: 8, start: STARTS[2] },
  { name: 'Interval', visitLimit: LIMITS[3], reward: 9, start: STARTS[3] },
  { name: 'Semi', visitLimit: LIMITS[4], reward: 11, start: STARTS[4] },
  { name: 'Last Four', visitLimit: LIMITS[5], reward: 13, start: STARTS[5] },
  { name: 'Final', visitLimit: LIMITS[6], reward: 15, start: STARTS[6] },
  { name: 'The Decider', visitLimit: LIMITS[7], reward: 0, start: STARTS[7] },
];

export const LEG_COUNT = LEGS.length;
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

/**
 * Shanghai (the pub rule): a single, a double and a treble of the called
 * number in one visit. Inside checkout range it wins the leg outright, whatever
 * the arithmetic says; above it, it pays the bonus and the leg goes on. Each
 * leg calls its number from this list at the start of the night, so the shop
 * can show the next one and sell a piece of it.
 */
export const SHANGHAI_NUMBERS = [20, 19, 18, 17, 16];
/** A Shanghai wins outright only when the visit began at or below this. */
export const SHANGHAI_RANGE = 170;
/** Pot for a Shanghai, on the leg's reward when it wins and straight to the Pot when it does not. */
export const SHANGHAI_BONUS = 6;

/** The bin will not thin a library below this many cards. */
export const LIBRARY_FLOOR = 14;

/**
 * The clean sheet: consecutive legs won without a bust. The second clean leg
 * in a row pays double, the third and every one after pays treble — on the
 * leg's base reward and its finish bonuses only, not on the visits it left
 * unused, so a fast leg does not compound into a flood. One bust and it is
 * gone. (Throwing at the wall keeps the sheet; it costs the visit and the
 * crowd instead.)
 */
export const STREAK_MULT = [1, 1, 2, 3];
export function streakMultiplier(streak: number): number {
  return STREAK_MULT[Math.min(STREAK_MULT.length - 1, Math.max(0, streak))];
}

/** Big-finish ladder: Pot for a checkout from at least this score. */
export const BIG_FINISH_LADDER: [number, number][] = [
  [170, 8],
  [130, 4],
  [100, 2],
];
