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
 * They also carry the whole difficulty of the night now. Under the old deck a
 * leg was hard because the right card might not come; with free aim a player
 * simply throws the treble twenty, so the only thing standing between them and
 * a checkout is the clock. Measured at the looser numbers, a bot with no chalk
 * at all won the Decider every single time, which is not a decider.
 *
 * These are not tuned to a win rate. They are tuned to the one property the
 * whole design rests on: that working the slate has to beat ignoring it.
 *
 * Every leg can be extended by buying visits from the publican, so the base
 * numbers are lower than they look. Measured over eighty nights
 * (`npx vite-node tools/cmp.ts`), a planner that works the slate wins 46% of
 * nights, one that never presses 36%, one that presses everything 34%, and one
 * that ignores the slate entirely 33%. Loosen these by a single visit and that
 * ordering inverts — never pressing starts winning, because with time to spare
 * the safe route home is free. Tighten them by one and it inverts the other
 * way, because the slate becomes unaffordable and ignoring it wins.
 *
 * 46% is above the TDD's 18-28% band and stays there on purpose: an expectimax
 * planner is not a person, and a band written for the old dealt-card model is
 * worth less than a loop where the interesting system is the winning one.
 * See docs/decisions/balance.md and docs/decisions/design.md §7.
 */
const LIMITS = [6, 6, 5, 4, 4, 3, 3, 3];
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
export const SERVICE_COST = { STEADY: 2, CREDIT: 3, RUB_OUT: 4, ANOTHER_GO: 5 } as const;
/** Most visits the publican will sell you for one leg. */
export const ANOTHER_GO_CAP = 2;

/**
 * What the publican charges for the next visit. His price goes up every time
 * you ask, which is the point: with a flat price the Pot hits a wall the
 * moment the chalk slots are full and every coin after that is worth nothing,
 * so earning more of it stops being worth a single dart. A rising price gives
 * the Pot somewhere to go for ever, at worse and worse value, which is how an
 * economy should taper rather than stop.
 */
export function anotherGoCost(bought: number): number {
  return SERVICE_COST.ANOTHER_GO * (bought + 1);
}

/**
 * What the night starts with in the Pot. Enough to take two contracts in the
 * first visit, because a slate you cannot afford to touch is not a slate.
 */
export const STARTING_POT = 10;
/** Contracts chalked up at the start of every visit. */
export const SLATE_SIZE = 3;
/**
 * Pulling out returns this share of the stake, rounded down — half of it.
 * Taking a contract has to cost something you cannot get back, or the right
 * play is to take every contract on the slate and pull out of the ones going
 * badly, which is not a decision, it is a formality with extra steps.
 */
export const PULL_RETURN = 0.5;

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
