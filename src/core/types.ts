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

// ---------- Cards ----------

export interface DartCard {
  id: string; // unique per instance (deterministic counter, see state.ts)
  defId: string; // e.g. "t20" — shared by all copies
  target: Target;
  /** Cosmetic only. Drives flight-trail palette index. */
  flight: 0 | 1 | 2 | 3;
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
  card: DartCard;
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
  score: number; // remaining, starts at 501
  visits: VisitState[];
  deck: DartCard[];
  discard: DartCard[];
  hand: DartCard[];
  bustsThisLeg: number;
  forgivenessUsed: boolean; // for forgiving_oche
  status: 'ACTIVE' | 'CHECKED_OUT' | 'TIMED_OUT';
  /** Cards peeked by chalked_up at the start of the current visit (ids). */
  peek: string[];
  /** Pot awarded for this leg once checked out. */
  reward?: PotBreakdown;
}

export interface PotBreakdown {
  base: number;
  unusedVisits: number;
  bigFinish: number;
  cleanLeg: number;
  nineDarter: number;
  total: number;
  /** Score at the start of the finishing visit (the darts sense of "a 100 checkout"). */
  checkoutFrom: number;
  visitsUsed: number;
}

export type ServiceKind = 'REMOVE' | 'DUPLICATE' | 'SHARPEN';

export type ShopSlot =
  | { kind: 'CARD'; defId: string; cost: number; sold: boolean }
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
  cardsBought: number;
  bigFinishes: number;
  cleanLegs: number;
  maxChalkHeld: number;
  /** Deliberate wall throws. */
  misses: number;
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
  library: DartCard[]; // the persistent throw deck across legs
  chalk: Chalk[]; // max 5 (6 on The Wide)
  legs: LegState[];
  status: 'ACTIVE' | 'WON' | 'LOST';
  // --- implementation additions ---
  oche: OcheId;
  phase: NightPhase;
  rng: Rng;
  /** Next card instance id counter (deterministic ids). */
  nextCardId: number;
  /** Next chalk acquisition index. */
  nextChalkOrder: number;
  chalkSlots: number;
  shop: ShopState | null;
  stats: NightStats;
  /** Oche unlock achievements earned this night (ids). */
  achievements: OcheId[];
  /** Consecutive busts across the night, for commentary escalation. Reset on a non-bust visit end. */
  consecutiveBusts: number;
}

// ---------- Engine events ----------

export type EngineEvent =
  | { type: 'LEG_START'; legIndex: number }
  | { type: 'HAND_DEALT'; hand: DartCard[]; visitIndex: number; throwIndex: number }
  | { type: 'THROW'; result: ThrowResult }
  | { type: 'VISIT_END'; visit: VisitState; total: number; busted: boolean }
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
