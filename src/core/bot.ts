/**
 * Bot policies (TDD §15.1) and the headless night simulator behind the
 * balance targets (§15.2) and anti-targets (§15.3).
 *
 *   greedy    — highest base-value card that does not bust. No checkout sense.
 *   checkout  — greedy until 170, then plays the shortest finishing route the
 *               deck offers, or at least leaves a finishable number.
 *   optimal   — 2-ply lookahead: resolve every hand card, then value the
 *               resulting position by the expected best next throw over the
 *               remaining pool plus checkout / bust / dead-number terms.
 *
 * Everything here is deterministic given the night state: the bots never
 * consume the gameplay RNG (all hypothetical resolves pass `rng: null`), so a
 * bot night is reproducible from its seed and the engine stays the only
 * consumer of randomness.
 */
import { cardDef, makeCard, sharpenedDefId } from '../content/cards';
import { chalkDef } from '../content/chalkdefs';
import { LEG_COUNT, SHANGHAI_RANGE, SHOP_REFRESH_COST } from '../content/legs';
import { computeCheckoutHints } from './checkout';
import { landingDistribution, resolveThrow, throwsPerVisitFor, visitHandSizeFor } from './resolver';
import { addChalk, beginLeg, commitCard, commitMiss, completesShanghai, createNight, currentLeg, currentVisit, hasChalk, newCard, pocketCard, shanghaiProgress, shopBuy, shopLeave, shopRefresh, steadinessOf, type BuyOptions, visitTotal } from './state';
import type { Chalk, DartCard, LegState, NightState, OcheId, ThrowResult, VisitState } from './types';

export type Policy = 'greedy' | 'checkout' | 'optimal';

export interface LegOutcome {
  index: number;
  status: 'CHECKED_OUT' | 'TIMED_OUT';
  visitsUsed: number;
  /** Score at the start of the finishing visit (0 if the leg was not won). */
  checkoutFrom: number;
  busts: number;
  oneEighties: number;
  /** Pot awarded (0 on the last leg or a lost leg). */
  reward: number;
}

export interface NightOutcome {
  status: 'WON' | 'LOST';
  legsWon: number;
  oneEighties: number;
  busts: number;
  misses: number;
  shanghais: number;
  bestStreak: number;
  chalkHeld: string[];
  seed: number;
  throws: number;
  /** Per-leg results in play order. */
  legs: LegOutcome[];
  /** Index (0..7) of the last leg played. */
  lastLeg: number;
  potEarned: number;
  potSpent: number;
  /** Final library composition (def ids). */
  library: string[];
}

export interface PlayOptions {
  oche?: OcheId;
  /** Begin the night at this leg index (0..7). */
  startLeg?: number;
  /** Chalk ids granted before the first leg. */
  startChalk?: string[];
  /** false → walk through every shop without buying. */
  shop?: boolean;
  /** Extra card def ids added to the library before the first leg. */
  extraCards?: string[];
}

export interface SimResult {
  winRate: number;
  /** Fraction of ALL nights that won leg i. */
  legWinRates: number[];
  /** Fraction of the nights that REACHED leg i which won it. 0 when none reached it. */
  legWinRatesConditional: number[];
  /** Number of nights that reached leg i. */
  legReached: number[];
  median180s: number;
  mean180s: number;
  meanBusts: number;
  meanLegsWon: number;
  meanThrows: number;
  outcomes: NightOutcome[];
}

// ---------------------------------------------------------------- tunables

/** Weights of the optimal policy's position evaluation, in points. */
const OPT = {
  /** Added to the points of a ply-2 checkout. */
  finish: 250,
  /** Forfeited value of the rest of the visit when a ply-2 throw busts. */
  lostThrow: 25,
  /**
   * What a bust costs in the planner, in points: the visit, the crowd, the
   * sheet and the visit limit. Odds make it a cost to weigh, not a veto: a
   * one-in-twenty bust for sixty points is a throw, a coin flip is not.
   */
  bust: 420,
  /** What a pip of heat is worth when the wall would spend it. */
  heatPip: 20,
  /** Landing (ply 1) on an in-range number with no route in the pool. */
  unfinishable: 60,
  /** Route of length k reachable within the throws left in this visit. */
  finNow: [0, 50, 25, 10],
  /** Route of length k that needs the next visit. */
  finLater: [0, 30, 12, 4],
  /** Flat cost of spending a visit on a deliberate bust. */
  bustTax: 10,
  /** A forgiven bust wastes the throw and the one-per-leg forgiveness. */
  forgiveTax: 20,
};

/**
 * Shop weights, both in pot units, so a purchase is priced on the same scale
 * as its cost.
 *
 * Under the per-visit hand a card pulls two ways: a good one raises the
 * expected visit total, but EVERY extra card thins the odds of drawing a
 * finisher when the leg comes down to a double. Pricing only the first term
 * makes the bot buy its own deck to death (docs/decisions/balance.md), so
 * both are priced.
 */
/** Worth of +1 point of expected visit total. */
const K_SCORE = 0.25;
/** Worth of +1.00 (i.e. certainty) of holding a finisher in the visit's hand. */
const K_FINISH = 30;
/** Worth of covering the whole finishing band in two darts. */
const K_COVER = 20;
/**
 * Flat worth of each card NOT in the library. Measured, not derived: four free
 * T20s handed to the starting deck cost it 8 points of leg-1 win rate, and
 * cutting six filler cards is worth ten points of night win rate
 * (docs/decisions/balance.md). A visit's hand is drawn once and spent across
 * three darts, so a crowded library is a hand of trebles when the leg wants a
 * double — a cost the per-visit order statistic above cannot see.
 */
const K_BLOAT = 1.5;
/** Pot held back for a chalk while a chalk slot is still open. */
const CHALK_RESERVE = 12;
/** The band a leg actually ends in, which the coverage term scores over. */
const COVER_LO = 2;
const COVER_HI = 110;
/** Doubles the shop bot is happy to pay a premium for when the library lacks them. */
const PRIZED_DOUBLES = new Set(['d16', 'd20', 'd8', 'd4', 'ib']);

/**
 * Hand-written chalk ratings in pot units. Scoring chalk (VALUE, and the
 * BOARD/DEAL chalk that changes numbers) is additionally scaled by its
 * measured effect on the current library, so a chalk that would wreck the
 * deck (mirrored on a 20-heavy deck, narrow_beds on a treble deck) rates 0.
 */
const CHALK_RATING: Record<string, number> = {
  // VALUE
  hot_twenty: 12,
  feathered: 10,
  heavy_tips: 12,
  oiled: 10,
  even_keel: 10,
  cold_hands: 10,
  last_orders: 12,
  bullish: 8,
  // BOARD
  wired: 1,
  split_tips: 2,
  magnetised: 8,
  narrow_beds: 10,
  wide_doubles: 11,
  mirrored: 1,
  // RULE
  cheap_chalk: 2,
  forgiving_oche: 8,
  straight_out: 15,
  overshoot: 9,
  chalk_dust: 3,
  // DEAL
  wide_grip: 14,
  tunnel_vision: 8,
  fourth_dart: 16,
  practice_board: 4,
  chalked_up: 2,
};

const SCORING_CHALK = new Set([
  'hot_twenty',
  'feathered',
  'heavy_tips',
  'oiled',
  'even_keel',
  'cold_hands',
  'last_orders',
  'bullish',
  'magnetised',
  'narrow_beds',
  'mirrored',
  'wide_grip',
  'tunnel_vision',
  'fourth_dart',
]);

// ---------------------------------------------------------------- maths

const BINOM: number[][] = [[1]];

/** C(n, k) via a lazily extended Pascal triangle (n ≤ a few hundred). */
function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  while (BINOM.length <= n) {
    const prev = BINOM[BINOM.length - 1];
    const row = new Array<number>(prev.length + 1);
    row[0] = 1;
    row[prev.length] = 1;
    for (let i = 1; i < prev.length; i++) row[i] = prev[i - 1] + prev[i];
    BINOM.push(row);
  }
  return BINOM[n][k];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------- per-leg context

/** Sentinel score far above any reachable value: resolves never bust or check out. */
const FAR = 100000;

const FAKE_VISITS: VisitState[] = [0, 1, 2, 3].map((ti) => ({
  index: 0,
  scoreAtVisitStart: 0,
  throws: new Array(ti).fill(null) as unknown as ThrowResult[],
  busted: false,
}));

interface LegCtx {
  n: NightState;
  leg: LegState;
  perVisit: number;
  /** Cards dealt for a whole visit (per-visit hand). */
  handSize: number;
  /** Every card in the leg (deck + hand + discard): the multiset is constant within a leg. */
  pool: DartCard[];
  /** One representative card per distinct def id. */
  defs: DartCard[];
  /** defId → resolved value per throw index, away from the endgame. */
  plain: Map<string, number[]>;
  maxPlain: number;
  /** Scores above this are out of checkout-hint range. */
  threshold: number;
  /** (score*4 + ti) → shortest route length: -1 out of range, 0 none, k ≥ 1. Shared across nights via ROUTE_CACHE. */
  routes: Map<number, number>;
  /** Expected best plain value of a hand (throw index 1), for pricing forfeited throws. */
  avgBest: number;
}

/** Route lengths keyed by the pipeline signature (chalk in acquisition order + distinct defs). */
const ROUTE_CACHE = new Map<string, Map<number, number>>();
const ROUTE_CACHE_LIMIT = 4000;

let ctxCache: LegCtx | null = null;

function legCtx(n: NightState, leg: LegState): LegCtx {
  if (ctxCache && ctxCache.leg === leg && ctxCache.n === n) return ctxCache;
  const perVisit = throwsPerVisitFor(n.chalk);
  const pool = [...leg.deck, ...leg.hand, ...leg.discard];
  const seen = new Map<string, DartCard>();
  for (const c of pool) if (!seen.has(c.defId)) seen.set(c.defId, c);
  const defs = [...seen.values()].sort((a, b) => cardDef(b.defId).value - cardDef(a.defId).value || a.defId.localeCompare(b.defId));
  const plain = new Map<string, number[]>();
  let maxPlain = 0;
  for (const d of defs) {
    const vals: number[] = [];
    for (let ti = 0; ti < 4; ti++) {
      const v = expectedValue(n.chalk, d, ti as 0 | 1 | 2 | 3, 0);
      vals.push(v);
      if (v > maxPlain) maxPlain = v;
    }
    plain.set(d.defId, vals);
  }
  const chalkSig = n.chalk
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => c.def.id)
    .join(',');
  const sig = `${chalkSig}|${defs.map((d) => d.defId).join(',')}`;
  let routes = ROUTE_CACHE.get(sig);
  if (!routes) {
    if (ROUTE_CACHE.size >= ROUTE_CACHE_LIMIT) ROUTE_CACHE.clear();
    routes = new Map();
    ROUTE_CACHE.set(sig, routes);
  }
  const handSize = visitHandSizeFor(n.chalk);
  // Mean value of a dart in a visit: the best `perVisit` of a hand of `handSize`.
  const avgBest =
    expectedTopK(
      pool.map((c) => (plain.get(c.defId) as number[])[1]),
      handSize,
      perVisit,
    ) / perVisit;
  ctxCache = {
    n,
    leg,
    perVisit,
    handSize,
    pool,
    defs,
    plain,
    maxPlain,
    threshold: Math.max(170, maxPlain * 3),
    routes,
    avgBest,
  };
  return ctxCache;
}

/**
 * Shortest finishing route from a hypothetical position, via the real
 * checkout hints on a shallow copy of the leg with the score patched and a
 * synthetic visit carrying the throw index. -1 = out of hint range,
 * 0 = in range but no route with this pool, k = route length.
 */
function routeLen(ctx: LegCtx, score: number, ti: number): number {
  if (score <= 0) return 0;
  if (score > ctx.threshold) return -1;
  ti = ti % ctx.perVisit;
  const key = score * 4 + ti;
  const hit = ctx.routes.get(key);
  if (hit !== undefined) return hit;
  const fake: LegState = { ...ctx.leg, score, hand: [], deck: ctx.pool, discard: [], visits: [FAKE_VISITS[ti]] };
  const h = computeCheckoutHints(ctx.n, fake);
  const len = !h.inRange ? -1 : h.best ? h.best.defIds.length : 0;
  ctx.routes.set(key, len);
  return len;
}

/** Expected points of a card thrown far from the endgame, under the odds. */
function expectedValue(chalk: Chalk[], card: DartCard, ti: 0 | 1 | 2 | 3, steadiness: number): number {
  let ev = 0;
  for (const l of landingDistribution(card.target, steadiness)) {
    ev +=
      l.p *
      resolveThrow(card, { chalk, rng: null, landing: l.target, scoreBefore: FAR, scoreAtVisitStart: FAR, visitThrowIndex: ti, forgivenessUsed: true }).result
        .totalValue;
  }
  return ev;
}

/** Every way a throw can go from a position, with its chance. */
function outcomes(n: NightState, leg: LegState, card: DartCard, score: number, ti: 0 | 1 | 2 | 3): { p: number; r: ThrowResult }[] {
  const visit = currentVisit(leg);
  return landingDistribution(card.target, steadinessOf(leg)).map((l) => ({
    p: l.p,
    r: resolveThrow(card, {
      chalk: n.chalk,
      rng: null,
      landing: l.target,
      scoreBefore: score,
      scoreAtVisitStart: visit.scoreAtVisitStart,
      visitThrowIndex: ti,
      forgivenessUsed: leg.forgivenessUsed,
    }).result,
  }));
}

function classify(n: NightState, leg: LegState, card: DartCard, ti: number): ThrowResult {
  const visit = currentVisit(leg);
  return resolveThrow(card, {
    chalk: n.chalk,
    rng: null,
    scoreBefore: leg.score,
    scoreAtVisitStart: visit.scoreAtVisitStart,
    visitThrowIndex: ti as 0 | 1 | 2 | 3,
    forgivenessUsed: leg.forgivenessUsed,
  }).result;
}

// ---------------------------------------------------------------- greedy

function chooseGreedy(n: NightState, leg: LegState): DartCard {
  const ti = currentVisit(leg).throws.length;
  let best: DartCard | null = null;
  let bestV = -1;
  let worst: DartCard = leg.hand[0];
  let worstV = Infinity;
  for (const c of leg.hand) {
    const v = cardDef(c.defId).value;
    if (v < worstV) {
      worst = c;
      worstV = v;
    }
    if (classify(n, leg, c, ti).outcome === 'BUST') continue;
    if (v > bestV) {
      best = c;
      bestV = v;
    }
  }
  return best ?? worst;
}

// ---------------------------------------------------------------- checkout-aware

function chooseCheckout(n: NightState, leg: LegState): DartCard {
  if (leg.score > 170) return chooseGreedy(n, leg);
  const hints = computeCheckoutHints(n, leg);
  let best: DartCard | null = null;
  let bestLen = Infinity;
  let bestV = -1;
  for (const c of leg.hand) {
    const r = hints.byHandCard.get(c.id);
    if (!r) continue;
    const len = r.defIds.length;
    const v = cardDef(c.defId).value;
    if (len < bestLen || (len === bestLen && v > bestV)) {
      best = c;
      bestLen = len;
      bestV = v;
    }
  }
  if (best) return best;
  // Nothing in hand starts a route: at least leave a number the pool can finish.
  const ctx = legCtx(n, leg);
  const ti = currentVisit(leg).throws.length;
  let pick: DartCard | null = null;
  let pickV = -1;
  for (const c of leg.hand) {
    const r = classify(n, leg, c, ti);
    if (r.outcome !== 'CONTINUE') continue;
    if (routeLen(ctx, r.scoreCommitted, ti + 1) <= 0) continue;
    const v = cardDef(c.defId).value;
    if (v > pickV) {
      pick = c;
      pickV = v;
    }
  }
  return pick ?? chooseGreedy(n, leg);
}

// ---------------------------------------------------------------- optimal-ish



/**
 * Plan the whole visit, not one dart.
 *
 * The hand now lasts a visit, so the real decision is which cards to spend and
 * in what order — exactly what a player does when they look at the row and
 * work backwards from the finish. Search every ordering of the remaining
 * darts over the remaining hand (at most 6·5·4 = 120 lines) and play the first
 * card of the best one.
 */
/** The planner's answer: a card, or the wall. */
export type Action = { card: DartCard } | { wall: true };

function chooseOptimal(n: NightState, leg: LegState): DartCard {
  const a = planVisit(n, leg);
  return 'card' in a ? a.card : leg.hand[0];
}

/**
 * Expectimax over the rest of the visit: every card, every place it can land,
 * every card after that. A bust is a cost (OPT.bust) weighed against what the
 * throw could earn, a Shanghai in range is a win off any dart, and the wall is
 * on the table at every depth, priced at the crowd it spends.
 */
export function planVisit(n: NightState, leg: LegState): Action {
  const ctx = legCtx(n, leg);
  const visit = currentVisit(leg);
  const ti = visit.throws.length;
  const dartsLeft = ctx.perVisit - ti;
  const preferLow = hasChalk(n, 'practice_board');
  const inRange = visit.scoreAtVisitStart <= SHANGHAI_RANGE;
  const wallValue = visitValue(ctx, leg.score, 0, false) - leg.heat * OPT.heatPip;

  const pieceOf = (r: ThrowResult): 'S' | 'D' | 'T' | null => {
    const hit = r.hits[0];
    if (!hit || r.forgiven || hit.target.bed !== leg.shanghai) return null;
    const reg = hit.target.region;
    return reg === 'S' || reg === 'D' || reg === 'T' ? reg : null;
  };

  /**
   * Value of the best play from a position, over the darts left. Deeper than
   * the first dart the tree is pruned by card, never by landing: the second
   * dart tries the three cards with the best plain expected value plus any
   * finisher, the third tries two (a fourth dart and a wide grip would
   * otherwise explode it). Every landing of every tried card is still weighed.
   */
  const best = (score: number, throwIndex: number, remaining: DartCard[], spent: number, pieces: Set<string>): number => {
    const dartsGone = throwIndex - ti;
    if (dartsGone >= dartsLeft || remaining.length === 0) return visitValue(ctx, score, spent, false);
    const keep = dartsGone >= 2 ? 2 : 3;
    let pool = remaining;
    if (remaining.length > keep) {
      const ranked = remaining
        .map((c) => ({ c, v: (ctx.plain.get(c.defId) ?? [0])[Math.min(3, throwIndex)] }))
        .sort((a, b) => b.v - a.v)
        .slice(0, keep)
        .map((x) => x.c);
      // a double that could finish from here is never pruned away
      for (const c of remaining) if (!ranked.includes(c) && isDoubleDef(c.defId) && score <= 170) ranked.push(c);
      pool = ranked;
    }
    let top = -Infinity;
    for (const card of pool) {
      const v = expect(card, score, throwIndex, remaining.filter((x) => x !== card), spent, pieces);
      if (v > top) top = v;
    }
    return top;
  };

  /** Expected value of throwing `card` from a position. */
  const expect = (card: DartCard, score: number, throwIndex: number, rest: DartCard[], spent: number, pieces: Set<string>): number => {
    const dartsGone = throwIndex - ti;
    let ev = 0;
    for (const { p, r } of outcomes(n, leg, card, score, throwIndex as 0 | 1 | 2 | 3)) {
      const piece = pieceOf(r);
      const withPiece = piece && !pieces.has(piece) ? new Set(pieces).add(piece) : pieces;
      let v: number;
      if ((withPiece.size === 3 && inRange) || r.outcome === 'CHECKOUT') v = 1e6 - dartsGone;
      else if (r.outcome === 'BUST') v = -OPT.bust;
      else v = best(r.scoreCommitted, throwIndex + 1, rest, spent + r.totalValue, withPiece);
      ev += p * v;
    }
    return ev;
  };

  const already = shanghaiProgress(leg);
  let choice: Action = { wall: true };
  let choiceValue = wallValue;
  for (let i = 0; i < leg.hand.length; i++) {
    const card = leg.hand[i];
    const rest = leg.hand.slice(0, i).concat(leg.hand.slice(i + 1));
    const v = expect(card, leg.score, ti, rest, 0, new Set(already)) + cardDef(card.defId).value * (preferLow ? -1 : 1) * 1e-6;
    if (v > choiceValue) {
      choice = { card };
      choiceValue = v;
    }
  }
  return choice;
}

/**
 * How good a position is at the end of a planned visit: the points banked, plus
 * a large premium for leaving a score the deck can actually finish from.
 */
function visitValue(ctx: LegCtx, score: number, banked: number, busted: boolean): number {
  if (busted) return -1e6;
  let v = banked;
  if (score <= 1) return v - 500;
  const outs = routeLen(ctx, score, 0);
  if (outs > 0 && outs <= ctx.perVisit) v += 400 - outs * 60;
  else if (outs === 0) v -= 120;
  return v;
}

// ---------------------------------------------------------------- public: card choice

/**
 * Bank a finisher for later. A card is worth pocketing when it can close the
 * leg on its own from a score we are plausibly heading for, and we are not
 * about to use it this visit anyway.
 */
export function considerPocket(n: NightState, leg: LegState): void {
  if (leg.pocket || leg.hand.length === 0) return;
  const ctx = legCtx(n, leg);
  const visit = currentVisit(leg);
  if (!visit || visit.throws.length > 0) return;
  // Only worth a pocket while the finish is still out of reach this visit.
  if (routeLen(ctx, leg.score, 0) > 0) return;
  let best: DartCard | null = null;
  let bestValue = 0;
  for (const c of leg.hand) {
    const r = resolveThrow(c, {
      chalk: n.chalk,
      rng: null,
      scoreBefore: FAR,
      scoreAtVisitStart: FAR,
      visitThrowIndex: 0,
      forgivenessUsed: true,
    }).result;
    const last = r.hits[r.hits.length - 1];
    if (!last || !last.countsAsDouble) continue;
    // Prefer a small, flexible finisher: it closes the most positions.
    const value = 100 - r.totalValue;
    if (value > bestValue) {
      best = c;
      bestValue = value;
    }
  }
  if (best) pocketCard(n, best.id);
}

/** True if this card would complete a Shanghai that wins the leg (the visit began in range). */
export function completesInRange(n: NightState, leg: LegState, card: DartCard): boolean {
  const visit = leg.visits[leg.visits.length - 1];
  if (!visit || visit.scoreAtVisitStart > SHANGHAI_RANGE) return false;
  const r = resolveThrow(card, {
    chalk: n.chalk,
    rng: null,
    scoreBefore: leg.score,
    scoreAtVisitStart: visit.scoreAtVisitStart,
    visitThrowIndex: visit.throws.length as 0 | 1 | 2 | 3,
    forgivenessUsed: leg.forgivenessUsed,
  }).result;
  return completesShanghai(visit.throws, r, leg.shanghai);
}

/** True if committing this card resolves to a bust from the current position. */
export function wouldBust(n: NightState, leg: LegState, card: DartCard): boolean {
  const visit = leg.visits[leg.visits.length - 1];
  const ti = (visit ? visit.throws.length : 0) as 0 | 1 | 2 | 3;
  return (
    resolveThrow(card, {
      chalk: n.chalk,
      rng: null,
      scoreBefore: leg.score,
      scoreAtVisitStart: visit ? visit.scoreAtVisitStart : leg.score,
      visitThrowIndex: ti,
      forgivenessUsed: leg.forgivenessUsed,
    }).result.outcome === 'BUST'
  );
}

export function chooseCard(n: NightState, leg: LegState, policy: Policy): DartCard {
  if (leg.hand.length === 0) throw new Error('no hand to choose from');
  if (leg.hand.length === 1) return leg.hand[0];
  switch (policy) {
    case 'greedy':
      return chooseGreedy(n, leg);
    case 'checkout':
      return chooseCheckout(n, leg);
    case 'optimal':
      return chooseOptimal(n, leg);
  }
}

// ---------------------------------------------------------------- shop

/** defId → resolved value per throw index under `chalk`, away from the endgame. */
function valueTable(chalk: Chalk[], defIds: Iterable<string>): Map<string, number[]> {
  const perVisit = throwsPerVisitFor(chalk);
  const table = new Map<string, number[]>();
  for (const id of defIds) {
    if (table.has(id)) continue;
    const card = makeCard(id, 'x', 0);
    const vals: number[] = [];
    for (let ti = 0; ti < perVisit; ti++) vals.push(expectedValue(chalk, card, ti as 0 | 1 | 2 | 3, 0));
    table.set(id, vals);
  }
  return table;
}

/** Expected visit total: sum over throws of the expected best card in a hand drawn from `defIds`. */
/**
 * Expected sum of the top `k` of `h` cards drawn without replacement from
 * `values`. A value is in the visit's top k exactly when it is drawn and fewer
 * than k of the values above it are drawn.
 */
export function expectedTopK(values: number[], h: number, k: number): number {
  const m = values.length;
  if (m === 0 || k <= 0) return 0;
  h = Math.min(h, m);
  k = Math.min(k, h);
  const sorted = values.slice().sort((a, b) => b - a);
  const total = binom(m, h);
  if (total === 0) return 0;
  let e = 0;
  for (let j = 1; j <= m; j++) {
    let p = 0;
    for (let i = 0; i < k && i <= j - 1; i++) p += binom(j - 1, i) * binom(m - j, h - 1 - i);
    e += sorted[j - 1] * p;
  }
  return e / total;
}

/**
 * Expected points from one visit under the per-visit hand: `visitHandSizeFor`
 * cards are drawn ONCE and the best `throwsPerVisit` of them are spent, so this
 * is an order statistic over the whole visit, not a best-of-hand per dart.
 * Throw indices that pay more (last_orders, cold_hands) get the bigger cards.
 */
function expectedVisit(chalk: Chalk[], defIds: string[]): number {
  const table = valueTable(chalk, defIds);
  const perVisit = throwsPerVisitFor(chalk);
  const h = visitHandSizeFor(chalk);
  if (defIds.length === 0) return 0;
  // How much each throw index is worth relative to the visit's average.
  const perIndexTotal: number[] = [];
  for (let ti = 0; ti < perVisit; ti++) {
    perIndexTotal.push(defIds.reduce((a, d) => a + (table.get(d) as number[])[ti], 0));
  }
  const sumAll = perIndexTotal.reduce((a, b) => a + b, 0);
  if (sumAll <= 0) return 0;
  // Base values: the visit's average multiplier, so the order statistic is
  // taken once and then split across the indices by their share.
  const base = defIds.map((d) => {
    const vals = table.get(d) as number[];
    let t = 0;
    for (let ti = 0; ti < perVisit; ti++) t += vals[ti];
    return t / perVisit;
  });
  // Best card to the best-paying index, second best to the next, and so on.
  const shares = perIndexTotal.map((t) => (t * perVisit) / sumAll).sort((a, b) => b - a);
  let total = 0;
  let previous = 0;
  for (let k = 1; k <= perVisit; k++) {
    const topK = expectedTopK(base, h, k);
    const kth = topK - previous; // expected value of the k-th best card drawn
    previous = topK;
    total += kth * shares[k - 1];
  }
  return total;
}

function libraryDefIds(n: NightState): string[] {
  return n.library.map((c) => c.defId);
}

function isDoubleDef(defId: string): boolean {
  const r = cardDef(defId).target.region;
  return r === 'D' || r === 'IB';
}

function doubleBonus(n: NightState, defId: string): number {
  if (!isDoubleDef(defId) || hasChalk(n, 'straight_out')) return 0;
  const copies = n.library.filter((c) => c.defId === defId).length;
  const prized = PRIZED_DOUBLES.has(defId);
  if (copies === 0) return prized ? 3 : 1;
  if (copies === 1 && prized) return 1;
  return 0;
}

/**
 * Chance that a visit's hand holds at least one card that can close the leg.
 * Straight Out makes every card a finisher, so the term drops out entirely.
 */
function finishOdds(chalk: Chalk[], defIds: string[]): number {
  const m = defIds.length;
  if (m === 0) return 0;
  if (chalk.some((c) => c.def.id === 'straight_out')) return 1;
  const h = Math.min(visitHandSizeFor(chalk), m);
  let blanks = 0;
  for (const d of defIds) if (!isDoubleDef(d)) blanks++;
  return 1 - binom(blanks, h) / binom(m, h);
}

/**
 * Fraction of the finishing band the library can close in two darts. This is
 * what a scoring card is really bought for: a T19 barely moves the expected
 * visit, but it turns 141 into a finish. It is the one thing `expectedVisit`
 * cannot see, so without it the shop bot never buys a card. Chalk value
 * changes are ignored here — the routes matter more than the exact numbers.
 */
function coverage(chalk: Chalk[], defIds: string[]): number {
  const straight = chalk.some((c) => c.def.id === 'straight_out');
  const values = new Set<number>();
  const finishers: number[] = [];
  for (const d of new Set(defIds)) {
    const v = cardDef(d).value;
    values.add(v);
    if (straight || isDoubleDef(d)) finishers.push(v);
  }
  if (finishers.length === 0) return 0;
  let hit = 0;
  for (let s = COVER_LO; s <= COVER_HI; s++) {
    for (const f of finishers) {
      const rest = s - f;
      if (rest === 0 || values.has(rest)) {
        hit++;
        break;
      }
    }
  }
  return hit / (COVER_HI - COVER_LO + 1);
}

/** Pot-unit worth of changing the library from `before` to `after`. */
function purchaseWorth(n: NightState, base: number, before: string[], after: string[]): number {
  const score = (expectedVisit(n.chalk, after) - base) * K_SCORE;
  const finish = (finishOdds(n.chalk, after) - finishOdds(n.chalk, before)) * K_FINISH;
  const cover = (coverage(n.chalk, after) - coverage(n.chalk, before)) * K_COVER;
  const bloat = (before.length - after.length) * K_BLOAT;
  return score + finish + cover + bloat;
}

function cardWorth(n: NightState, base: number, defId: string): number {
  const lib = libraryDefIds(n);
  return purchaseWorth(n, base, lib, [...lib, defId]) + doubleBonus(n, defId);
}

/** Pot-unit rating of a chalk for this deck. `held` rates a chalk already owned (for replacement). */
export function chalkRating(n: NightState, id: string, held = false): number {
  const rating = CHALK_RATING[id] ?? 4;
  if (SCORING_CHALK.has(id)) {
    const withChalk = held ? n.chalk : [...n.chalk, { def: chalkDef(id), order: n.nextChalkOrder }];
    const without = held ? n.chalk.filter((c) => c.def.id !== id) : n.chalk;
    const lib = libraryDefIds(n);
    const gain = expectedVisit(withChalk, lib) - expectedVisit(without, lib);
    if (gain <= 0) return 0; // would kill (or not help) the deck
    let fit = Math.min(1.6, gain / 15);
    if (id === 'cold_hands') fit = Math.min(fit, 1); // the dead first dart is a real cost the table cannot see
    return rating * fit;
  }
  switch (id) {
    case 'split_tips':
      // The split single is the LAST hit, so doubles stop counting: only playable with a finish rule.
      return hasChalk(n, 'straight_out') ? 9 : hasChalk(n, 'wide_doubles') ? 4 : 2;
    case 'wide_doubles':
      return hasChalk(n, 'straight_out') ? 1 : rating;
    case 'straight_out':
      return hasChalk(n, 'wide_doubles') ? 8 : rating;
    case 'cheap_chalk':
      return hasChalk(n, 'straight_out') ? 4 : rating;
    default:
      return rating;
  }
}

interface Purchase {
  slot: number;
  opts: BuyOptions;
  worth: number;
  cost: number;
}

function lowestValueCard(n: NightState): DartCard | null {
  const table = valueTable(n.chalk, libraryDefIds(n));
  let best: DartCard | null = null;
  let bestV = Infinity;
  for (const c of n.library) {
    const vals = table.get(c.defId) as number[];
    const v = vals.reduce((a, b) => a + b, 0) / vals.length + (isDoubleDef(c.defId) ? 8 : 0);
    if (v < bestV) {
      best = c;
      bestV = v;
    }
  }
  return best;
}

function highestValueCard(n: NightState): DartCard | null {
  const table = valueTable(n.chalk, libraryDefIds(n));
  let best: DartCard | null = null;
  let bestV = -Infinity;
  for (const c of n.library) {
    const vals = table.get(c.defId) as number[];
    const v = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (v > bestV) {
      best = c;
      bestV = v;
    }
  }
  return best;
}

function bestSingle(n: NightState): DartCard | null {
  let best: DartCard | null = null;
  let bestV = -Infinity;
  for (const c of n.library) {
    if (c.target.region !== 'S') continue;
    const v = cardDef(c.defId).value;
    if (v > bestV) {
      best = c;
      bestV = v;
    }
  }
  return best;
}

function bestPurchase(n: NightState): Purchase | null {
  const shop = n.shop;
  if (!shop) return null;
  const lib = libraryDefIds(n);
  const base = expectedVisit(n.chalk, lib);
  let best: Purchase | null = null;
  // Pot buys nothing outside the shop, but a purchase still has to clear its
  // price: measurement says a marginal card is worse than the pot it costs,
  // and a bot that spends for the sake of spending buys its deck to death.
  // What it should hold pot back for is a chalk, which is where the leverage
  // is, so a below-price purchase is refused while a chalk slot is open.
  const reserve = n.chalk.length < n.chalkSlots ? CHALK_RESERVE : 0;
  const consider = (p: Purchase) => {
    if (p.worth <= 0) return;
    if (p.worth < p.cost || n.pot - p.cost < reserve) return;
    if (!best || p.worth - p.cost > best.worth - best.cost) best = p;
  };
  shop.slots.forEach((slot, i) => {
    if (slot.sold || slot.cost > n.pot) return;
    switch (slot.kind) {
      case 'CARD': {
        consider({ slot: i, opts: {}, worth: cardWorth(n, base, slot.defId), cost: slot.cost });
        break;
      }
      case 'CHALK': {
        if (hasChalk(n, slot.chalkId)) return;
        const worth = chalkRating(n, slot.chalkId);
        if (worth <= 0) return;
        if (n.chalk.length < n.chalkSlots) {
          consider({ slot: i, opts: {}, worth, cost: slot.cost });
        } else {
          // Slots full: swap out the weakest held chalk if the newcomer is clearly better.
          let weakest: Chalk | null = null;
          let weakestR = Infinity;
          for (const c of n.chalk) {
            const r = chalkRating(n, c.def.id, true);
            if (r < weakestR) {
              weakest = c;
              weakestR = r;
            }
          }
          if (weakest && worth > weakestR + 2) {
            consider({ slot: i, opts: { replaceChalkId: weakest.def.id }, worth: worth - weakestR, cost: slot.cost });
          }
        }
        break;
      }
      case 'SERVICE': {
        if (slot.service === 'REMOVE') {
          // A floor, so the bot cannot thin the library below a playable deck.
          if (n.library.length <= 14) return;
          const target = lowestValueCard(n);
          if (!target) return;
          const thinned = lib.filter((_, j) => n.library[j].id !== target.id);
          consider({ slot: i, opts: { cardId: target.id }, worth: purchaseWorth(n, base, lib, thinned), cost: slot.cost });
        } else if (slot.service === 'DUPLICATE') {
          const target = highestValueCard(n);
          if (!target) return;
          consider({ slot: i, opts: { cardId: target.id }, worth: cardWorth(n, base, target.defId), cost: slot.cost });
        } else {
          let target = bestSingle(n);
          if (!target) target = n.library.find((c) => c.defId === 'ob') ?? null;
          if (!target) return;
          const up = sharpenedDefId(target.defId);
          if (!up) return;
          const replaced = lib.map((d, j) => (n.library[j].id === target.id ? up : d));
          consider({ slot: i, opts: { cardId: target.id }, worth: purchaseWorth(n, base, lib, replaced) + doubleBonus(n, up), cost: slot.cost });
        }
        break;
      }
    }
  });
  return best;
}

function greedyShop(n: NightState): void {
  for (let guard = 0; guard < 8; guard++) {
    const shop = n.shop;
    if (!shop) return;
    let pick = -1;
    let pickCost = Infinity;
    shop.slots.forEach((s, i) => {
      if (s.kind !== 'CARD' || s.sold || s.cost > n.pot) return;
      if (s.cost < pickCost) {
        pick = i;
        pickCost = s.cost;
      }
    });
    if (pick < 0) return;
    if (!shopBuy(n, pick).ok) return;
  }
}

/**
 * Spend the pot in the open shop. Greedy buys the cheapest cards on offer;
 * the other policies buy whatever raises the expected visit total (or plugs
 * a missing double) by more than it costs, swap in better chalk, and refresh
 * once when nothing is worth having and the pot allows.
 */
export function botShop(n: NightState, policy: Policy): void {
  if (n.phase !== 'SHOP' || !n.shop) return;
  if (policy === 'greedy') {
    greedyShop(n);
    return;
  }
  for (let guard = 0; guard < 16; guard++) {
    const plan = bestPurchase(n);
    if (plan) {
      if (!shopBuy(n, plan.slot, plan.opts).ok) break;
      continue;
    }
    if (!n.shop.refreshed && n.pot >= Math.max(6, SHOP_REFRESH_COST)) {
      if (!shopRefresh(n).ok) break;
      continue;
    }
    break;
  }
}

// ---------------------------------------------------------------- nights

function legOutcome(leg: LegState): LegOutcome {
  const finishing = leg.visits[leg.visits.length - 1];
  let oneEighties = 0;
  for (const v of leg.visits) if (!v.busted && visitTotal(v) >= 180) oneEighties++;
  return {
    index: leg.index,
    status: leg.status === 'CHECKED_OUT' ? 'CHECKED_OUT' : 'TIMED_OUT',
    visitsUsed: leg.visits.length,
    checkoutFrom: leg.status === 'CHECKED_OUT' && finishing ? finishing.scoreAtVisitStart : 0,
    busts: leg.bustsThisLeg,
    oneEighties,
    reward: leg.reward?.total ?? 0,
  };
}

export function playNight(seed: number, policy: Policy, opts: PlayOptions = {}): NightOutcome {
  const n = createNight(seed, opts.oche ?? 'local');
  if (opts.startLeg !== undefined) n.legIndex = Math.max(0, Math.min(LEG_COUNT - 1, opts.startLeg));
  for (const id of opts.startChalk ?? []) if (!hasChalk(n, id)) addChalk(n, id);
  for (const defId of opts.extraCards ?? []) n.library.push(newCard(n, defId));
  beginLeg(n);
  let throws = 0;
  for (let guard = 0; guard < 100000 && n.status === 'ACTIVE'; guard++) {
    if (n.phase === 'LEG') {
      const leg = currentLeg(n);
      if (policy !== 'greedy') considerPocket(n, leg);
      if (policy === 'optimal') {
        // The planner weighs every throw against the wall under the odds.
        const a = planVisit(n, leg);
        if ('wall' in a) commitMiss(n);
        else commitCard(n, a.card.id);
      } else {
        const card = chooseCard(n, leg, policy);
        // Every card would bust on a hit: throw at the wall instead of wrecking
        // the visit — unless the "bust" is the third piece of an in-range Shanghai.
        const walk = policy !== 'greedy' && wouldBust(n, leg, card) && !completesInRange(n, leg, card);
        if (walk) commitMiss(n);
        else commitCard(n, card.id);
      }
      throws++;
    } else if (n.phase === 'SHOP') {
      if (opts.shop !== false) botShop(n, policy);
      shopLeave(n);
    } else {
      break;
    }
  }
  ctxCache = null;
  return {
    status: n.status === 'WON' ? 'WON' : 'LOST',
    legsWon: n.stats.legsWon,
    oneEighties: n.stats.oneEighties,
    busts: n.stats.busts,
    misses: n.stats.misses,
    shanghais: n.stats.shanghais,
    bestStreak: n.stats.bestStreak,
    chalkHeld: n.chalk.map((c) => c.def.id),
    seed,
    throws,
    legs: n.legs.map(legOutcome),
    lastLeg: n.legs.length ? n.legs[n.legs.length - 1].index : n.legIndex,
    potEarned: n.stats.potEarned,
    potSpent: n.stats.potSpent,
    library: n.library.map((c) => c.defId),
  };
}

export function simulate(seeds: number[], policy: Policy, opts: PlayOptions = {}): SimResult {
  const outcomes = seeds.map((s) => playNight(s, policy, opts));
  const N = outcomes.length || 1;
  const won = new Array<number>(LEG_COUNT).fill(0);
  const reached = new Array<number>(LEG_COUNT).fill(0);
  let wins = 0;
  let busts = 0;
  let legsWon = 0;
  let throws = 0;
  let oneEighties = 0;
  for (const o of outcomes) {
    if (o.status === 'WON') wins++;
    busts += o.busts;
    legsWon += o.legsWon;
    throws += o.throws;
    oneEighties += o.oneEighties;
    for (const l of o.legs) {
      reached[l.index]++;
      if (l.status === 'CHECKED_OUT') won[l.index]++;
    }
  }
  return {
    winRate: wins / N,
    legWinRates: won.map((w) => w / N),
    legWinRatesConditional: won.map((w, i) => (reached[i] ? w / reached[i] : 0)),
    legReached: reached,
    median180s: median(outcomes.map((o) => o.oneEighties)),
    mean180s: oneEighties / N,
    meanBusts: busts / N,
    meanLegsWon: legsWon / N,
    meanThrows: throws / N,
    outcomes,
  };
}

/** Seeds 1..n, the convention used by the balance tool and tests. */
export function seedRange(n: number, from = 1): number[] {
  return Array.from({ length: n }, (_, i) => from + i);
}
