/**
 * DOUBLE OUT — normative data types (TDD §6) plus the engine's event/phase
 * types. `/src/core` must never import from `/src/ui`, `/src/art` or
 * `/src/audio`; everything here is plain data so the engine runs headless.
 */

// ---------- Board ----------

/** Clockwise from the top of the board. Index is position, value is bed number. */
export const BED_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;

export type Bed = (typeof BED_ORDER)[number]; // 1..20
export type Region = 'S' | 'D' | 'T' | 'OB' | 'IB' | 'W'; // single, double, treble, outer bull, inner bull, wall (a deliberate miss)

export interface Target {
  region: Region;
  /** Undefined for OB and IB. */
  bed?: Bed;
}

// ---------- Interventions ----------

/**
 * The kit: one-shot modifiers spent on a dart the player has ALREADY chosen to
 * throw. They replaced the deck of dealt targets, and the difference is the
 * whole point — a dealt target tells you where you may aim, an intervention
 * changes what happens to the throw you were making anyway. There is no such
 * thing as a dead one. See docs/decisions/design.md §5.6.
 */
export interface InterventionDef {
  id: string;
  /** Printed on the kit strip. 9 characters at most. */
  name: string;
  /** One line. 46 characters at most. */
  blurb: string;
  /** Shop price in Pot. */
  cost: number;
  /** AIM: spend it before the dart flies. SLATE: spend it on the slate, before the visit. */
  when: 'AIM' | 'SLATE';
}

// ---------- The slate ----------

export type ContractOutcome = 'PAID' | 'LOST' | 'PULLED' | 'BANKED';

/** A contract the player has staked Pot on this visit. */
export interface TakenContract {
  defId: string;
  /** Pot staked. Doubles on every press. */
  stake: number;
  /** Price locked in when it was taken, after the night's decay. */
  price: number;
  /** How many darts had been thrown when it was taken. */
  takenAt: number;
  /** How many darts had been thrown when it first landed, or null if it has not. */
  madeAt: number | null;
  /** Times it has been pressed into a harder tier. */
  pressed: number;
  status: 'LIVE' | 'MADE' | 'DEAD';
  /** Once it is off the slate: what it paid back in total, and why. */
  settled: { pot: number; how: ContractOutcome } | null;
}

// ---------- Chalk ----------

export type ChalkStage = 'DEAL' | 'BOARD' | 'VALUE' | 'RULE';

export interface ChalkDef {
  id: string;
  name: string;
  stage: ChalkStage;
  cost: number;
  /** Short player-facing text. Max 64 chars. Must be readable at 5x7 font, 2 lines. */
  blurb: string;
}

export interface Chalk {
  def: ChalkDef;
  /** Acquisition index. Lower resolves first within a stage. */
  order: number;
}

// ---------- Throw resolution ----------

export interface ThrowIntent {
  /** Where the player aimed. Free aim: any of the 62 targets, or the wall. */
  target: Target;
  visitThrowIndex: 0 | 1 | 2 | 3; // 3 only reachable with fourth_dart
}

export interface ResolvedHit {
  /** May differ from the intent's target after BOARD-stage chalk. */
  target: Target;
  value: number;
  /** True if this hit satisfies checkout law, after RULE-stage chalk. */
  countsAsDouble: boolean;
}

export interface ThrowResult {
  intent: ThrowIntent;
  /** Usually length 1. Length 2 with split_tips. */
  hits: ResolvedHit[];
  totalValue: number;
  scoreBefore: number;
  /** Raw arithmetic result (may be negative or 1 on a bust). */
  scoreAfter: number;
  outcome: 'CONTINUE' | 'CHECKOUT' | 'BUST';
  /** Ordered list of chalk ids that fired. Drives commentary and the pipeline readout. */
  firedChalk: string[];
  /**
   * The leg score actually committed after bust/checkout consequences
   * (revert, cheap_chalk → 2, checkout → 0, forgiveness → scoreBefore).
   */
  scoreCommitted: number;
  /** True when forgiving_oche swallowed a bust on this throw. */
  forgiven: boolean;
  /** True when wired deflected the dart (for the `wire` sound). */
  deflected: boolean;
  /** True for a deliberate miss: the dart went at the wall, nothing resolved. */
  miss: boolean;
  /** Where the dart was aimed, before the odds and before any BOARD chalk. */
  aimed: Target;
  /** How the aim went: it hit, it drifted to a neighbour, it drifted somewhere better, or it went in the wall. */
  aim: 'hit' | 'drift' | 'lucky' | 'wall';
  /** The steadiness (percentage points added to every hit chance) the throw was made with. */
  steadiness: number;
  /**
   * Step-by-step readout of the pipeline for the UI: one entry per chalk that
   * fired, with the targets and values after that chalk applied. Cosmetic;
   * the numbers here are the same ones that produced `hits`.
   */
  trace: TraceStep[];
}

export interface TraceStep {
  chalkId: string;
  stage: ChalkStage;
  targets: Target[];
  values: number[];
  /** Human-readable note, e.g. "60 → 80". */
  note: string;
}

// ---------- Game state ----------

export interface VisitState {
  index: number;
  scoreAtVisitStart: number;
  throws: ThrowResult[];
  busted: boolean;
}

export interface LegState {
  index: number; // 0..7
  visitLimit: number;
  score: number; // remaining; starts at the leg's `start` (301 or 501)
  visits: VisitState[];
  bustsThisLeg: number;
  forgivenessUsed: boolean; // for forgiving_oche
  status: 'ACTIVE' | 'CHECKED_OUT' | 'TIMED_OUT';
  /** The three contracts chalked up for the current visit. Ids into CONTRACTS. */
  offer: string[];
  /** Next visit's offer, visible early with the Chalked Up chalk. */
  nextOffer: string[];
  /** Contracts taken this visit, in the order they were taken. */
  slate: TakenContract[];
  /** Everything settled this leg, oldest first, for the readout. */
  ledger: TakenContract[];
  /**
   * Consecutive visits ended without a bust, capped at HEAT_CAP. The crowd
   * warms up and the leg's Pot reward scales with it; a bust wipes it to 0.
   */
  heat: number;
  /** True once this leg has seen a bust: the clean sheet is off. */
  dirty: boolean;
  /** Pot awarded for this leg once checked out. */
  reward?: PotBreakdown;
}

export interface PotBreakdown {
  base: number;
  bigFinish: number;
  cleanLeg: number;
  nineDarter: number;
  /** Heat at checkout (0..HEAT_CAP). */
  heat: number;
  /** Extra Pot the heat multiplier added. */
  heatBonus: number;
  /** Clean-sheet streak this leg counts as (1 = first clean leg). 0 if the leg was dirty. */
  streak: number;
  /** Multiplier the clean sheet applied to everything above. */
  streakMult: number;
  /** Extra Pot the clean sheet added. */
  streakBonus: number;
  total: number;
  /** Score at the start of the finishing visit (the darts sense of "a 100 checkout"). */
  checkoutFrom: number;
  visitsUsed: number;
}

export type ServiceKind = 'STEADY' | 'CREDIT' | 'RUB_OUT';

export type ShopSlot =
  | { kind: 'KIT'; defId: string; cost: number; sold: boolean }
  | { kind: 'CHALK'; chalkId: string; cost: number; sold: boolean }
  | { kind: 'SERVICE'; service: ServiceKind; cost: number; sold: boolean };

export interface ShopState {
  slots: ShopSlot[];
  refreshed: boolean;
  /** Which leg (index) this shop followed. */
  afterLeg: number;
}

export type OcheId = 'local' | 'sharp' | 'steady' | 'wide' | 'thin';

export interface NightStats {
  oneEighties: number;
  busts: number;
  legsWon: number;
  bestVisit: number;
  bestCheckout: number;
  nineDarters: number;
  throwsMade: number;
  visitsPlayed: number;
  chalkFires: number;
  potEarned: number;
  potSpent: number;
  kitBought: number;
  /** Contracts taken, paid, and the Pot won and staked on them. */
  contractsTaken: number;
  contractsPaid: number;
  contractsPressed: number;
  potStaked: number;
  potWon: number;
  /** Best single contract payout of the night. */
  bestPayout: number;
  bigFinishes: number;
  cleanLegs: number;
  maxChalkHeld: number;
  /** Deliberate wall throws. */
  misses: number;
  /** Highest heat reached in the night. */
  bestHeat: number;
  /** Longest clean sheet of the night. */
  bestStreak: number;
}

export interface Rng {
  /** mulberry32 state (uint32). */
  s: number;
}

export type NightPhase = 'LEG' | 'SHOP' | 'OVER';

export interface NightState {
  seed: number;
  legIndex: number;
  pot: number;
  /** The kit: intervention def ids held, spendable at any oche. */
  kit: string[];
  /** Times each contract has paid tonight. The house shortens your price. */
  paid: Record<string, number>;
  chalk: Chalk[]; // max 5 (6 on The Wide)
  legs: LegState[];
  status: 'ACTIVE' | 'WON' | 'LOST';
  // --- implementation additions ---
  oche: OcheId;
  phase: NightPhase;
  rng: Rng;
  /** Next chalk acquisition index. */
  nextChalkOrder: number;
  chalkSlots: number;
  shop: ShopState | null;
  stats: NightStats;
  /** Oche unlock achievements earned this night (ids). */
  achievements: OcheId[];
  /** Consecutive busts across the night, for commentary escalation. Reset on a non-bust visit end. */
  consecutiveBusts: number;
  /** The clean sheet: consecutive legs won with no bust and no wall. */
  streak: number;
  /**
   * True aim: every dart lands where it is aimed. Off in play (the odds are the
   * game); on for the tutorial's scripted throws and for tests that pin
   * arithmetic rather than luck.
   */
  trueAim: boolean;
}

// ---------- Engine events ----------

export type EngineEvent =
  | { type: 'LEG_START'; legIndex: number }
  | { type: 'SLATE_OFFERED'; offer: string[]; visitIndex: number }
  | { type: 'CONTRACT_TAKEN'; contract: TakenContract }
  | { type: 'CONTRACT_SETTLED'; contract: TakenContract }
  | { type: 'CONTRACT_PRESSED'; contract: TakenContract; from: string }
  | { type: 'KIT_SPENT'; defId: string }
  | { type: 'THROW'; result: ThrowResult }
  | { type: 'VISIT_END'; visit: VisitState; total: number; busted: boolean; missed: boolean; heat: number }
  | { type: 'HEAT_LOST'; from: number; reason: 'BUST' | 'MISS' }
  | { type: 'STREAK_LOST'; from: number }
  | { type: 'ONE_EIGHTY'; total: number }
  | { type: 'CHECKOUT'; legIndex: number; reward: PotBreakdown | null }
  | { type: 'LEG_TIMEOUT'; legIndex: number }
  | { type: 'SHOP_OPEN'; shop: ShopState }
  | { type: 'SHOP_BUY'; slot: ShopSlot }
  | { type: 'SHOP_REFRESH' }
  | { type: 'ACHIEVEMENT'; oche: OcheId }
  | { type: 'NIGHT_WON' }
  | { type: 'NIGHT_LOST' };

// ---------- Commentary ----------

export interface BarkContext {
  throwResult?: ThrowResult;
  leg: LegState;
  night: NightState;
  visitTotal: number;
  consecutiveBusts: number;
  chalkFiredCount: number;
  /** The engine event that prompted this evaluation. */
  event: EngineEvent | { type: 'IDLE'; seconds: number } | { type: 'SHOP_ENTER'; pot: number };
}

export interface BarkTrigger {
  id: string;
  speaker: 'BARREL' | 'NOCK';
  /** Higher fires first when several match. */
  priority: number;
  /** Pure predicate over game state. No side effects. */
  when: (ctx: BarkContext) => boolean;
  /** Pool of variants. Chosen by the cosmetic RNG. */
  lines: string[];
  /** Do not repeat this trigger for N events. */
  cooldown: number;
  /** Optional follow-up from the other commentator, chosen from this pool. */
  reply?: { speaker: 'BARREL' | 'NOCK'; lines: string[] };
}
