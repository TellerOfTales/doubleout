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
 * Visit limits. These used to be generous, which was fine when the only thing
 * a visit was worth was its score. Now every visit is three contracts you
 * could take, so a loose limit means "dawdle and milk the slate" with no
 * counterweight, and a tight one means "there is no time for any of this".
 * They sit at roughly one and a half times the visits a good scoring run
 * needs, so spending one on the slate is a real trade against the clock.
 * See docs/decisions/balance.md.
 */
const LIMITS = [10, 10, 13, 12, 12, 11, 9, 7];
const STARTS = [301, 301, 501, 501, 501, 501, 501, 501];

/**
 * Winning a leg pays little on purpose. It used to pay most of a night's Pot,
 * which made the slate a sideshow: the fastest route to a build was to throw
 * the treble twenty, close the leg and collect. The leg is now the ticket to
 * the next one and the contracts are where the money is, so a visit spent
 * working the slate is not a visit wasted. See docs/decisions/design.md §5.4.
 */
export const LEGS: LegDef[] = [
  { name: 'First Round', visitLimit: LIMITS[0], reward: 3, start: STARTS[0] },
  { name: 'Second Round', visitLimit: LIMITS[1], reward: 4, start: STARTS[1] },
  { name: 'Quarter', visitLimit: LIMITS[2], reward: 5, start: STARTS[2] },
  { name: 'Interval', visitLimit: LIMITS[3], reward: 6, start: STARTS[3] },
  { name: 'Semi', visitLimit: LIMITS[4], reward: 7, start: STARTS[4] },
  { name: 'Last Four', visitLimit: LIMITS[5], reward: 8, start: STARTS[5] },
  { name: 'Final', visitLimit: LIMITS[6], reward: 10, start: STARTS[6] },
  { name: 'The Decider', visitLimit: LIMITS[7], reward: 0, start: STARTS[7] },
];

export const LEG_COUNT = LEGS.length;
export const DEFAULT_THROWS_PER_VISIT = 3;
export const DEFAULT_CHALK_SLOTS = 5;
export const SHOP_REFRESH_COST = 1;
export const SERVICE_COST = { STEADY: 2, CREDIT: 3, RUB_OUT: 4 } as const;

/**
 * What the night starts with in the Pot. Enough to take two contracts in the
 * first visit, because a slate you cannot afford to touch is not a slate.
 */
export const STARTING_POT = 10;
/** Contracts chalked up at the start of every visit. */
export const SLATE_SIZE = 3;
/**
 * The interest. A contract pays this per dart it has survived — on top of the
 * stake when it is pulled out live, and on top of the price when it is left
 * riding after it has landed.
 *
 * The second half is what makes banking a decision rather than a formality.
 * Without it, taking the money early paid exactly what letting it settle paid,
 * so the only reason to bank was fear of a bust and the planner simply never
 * bothered: measured at 0.3% of press decisions. With it, banking is a real
 * discount you accept for certainty, and the arithmetic is legible at the
 * table — a contract worth ten banks for ten and settles for fourteen.
 */
export const PULL_PER_DART = 2;

/** Consecutive bust-free visits needed to double the leg's Pot. */
export const HEAT_CAP = 4;

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
