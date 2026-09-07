/**
 * THE BOT — a player that makes the three decisions the rebuilt loop asks for,
 * and the headless night simulator the balance targets are measured on.
 *
 *   planSlate  — which contracts to take, before the first dart of a visit.
 *   planVisit  — where to aim, weighed over every place the dart can land.
 *   planPress  — after each dart: take the money, let it ride, or double it.
 *
 * The aim search is expectimax to the end of the visit. Landings are never
 * pruned: the odds ARE the game (docs/decisions/design.md §5.2), and a planner
 * that throws the tail away is not playing the same game as the player.
 * Targets are pruned instead — sixty-two of them three darts deep is a quarter
 * of a million lines — so the second dart tries the ten best and the third the
 * five best, with anything that finishes the leg exempt from the cut.
 *
 * Score and Pot are weighed on one scale (`POT_IN_POINTS`), because the whole
 * point of the slate is that it competes with the scoring for the same darts.
 *
 * Everything is deterministic from the night's seed: the bot never draws from
 * the gameplay RNG — every hypothetical resolves with `rng: null` — so a bot
 * night replays exactly and the engine stays the only consumer of randomness.
 */
import { chalkDef } from '../content/chalkdefs';
import { KIT_CAP, interventionDef } from '../content/interventions';
import { ANOTHER_GO_CAP, anotherGoCost, HEAT_CAP, LEGS, LEG_COUNT, PULL_RETURN, SERVICE_COST, SHOP_REFRESH_COST } from '../content/legs';
import { ALL_TARGETS } from './board';
import { computeCheckoutHints } from './checkout';
import { STEADY_INTERVENTION, realSpread, resolveThrow, throwsPerVisitFor } from './resolver';
import { CONTRACTS, contractDef, pressStake } from './slate';
import type { ContractDef, VisitProgress } from './slate';
import {
  addChalk,
  beginLeg,
  commitMiss,
  commitThrow,
  createNight,
  currentLeg,
  currentPrice,
  currentVisit,
  hasChalk,
  kitCount,
  pressContract,
  pressable,
  pullContract,
  settleWorth,
  shopBuy,
  shopLeave,
  shopRefresh,
  slateSize,
  steadinessOf,
  takeContract,
  useRubOut,
  visitTotal,
  type BuyOptions,
} from './state';
import type { Chalk, LegState, NightState, OcheId, TakenContract, Target } from './types';

// ---------------------------------------------------------------- policies

/**
 * How the darts are chosen.
 *   naive    — the playtester's rule: the biggest number that does not bust,
 *              otherwise walk. The baseline the planner is measured against.
 *   greedy   — naive, and it never touches the slate or the shop either.
 *   checkout — naive until the finish is in range, then the shortest route.
 *   optimal  — the full planner: expectimax, the slate, the press.
 * The last three name the acceptance-test policies of §7: they aim like
 * `optimal` and differ only in what they do with the money on the table.
 */
export type Policy = 'naive' | 'greedy' | 'checkout' | 'optimal' | 'always_press' | 'never_press' | 'no_slate';

/** What the bot does with the contracts once the darts are in the air. */
/**
 * Fixed slate behaviours, for the press-your-luck invariant in
 * docs/decisions/design.md §7.3. Banking is automatic now — a contract pays
 * the moment it lands — so the greed lives entirely in the press.
 */
export type SlatePolicy = 'PLAN' | 'ALWAYS_PRESS' | 'NEVER_PRESS' | 'NO_SLATE';

/** The planner's answer: aim here (perhaps spending a one-shot), or walk. */
export type Action = { target: Target; use?: string } | { wall: true };

export interface RatedAction {
  action: Action;
  /** Expected points, Pot included at `POT_IN_POINTS`. Only comparable within one call. */
  value: number;
}

// ---------------------------------------------------------------- tunables

/**
 * What one Pot is worth in points of score. This is the exchange rate between
 * the two halves of the game and the single most load-bearing number here: too
 * high and the bot throws legs away chasing a three-Pot contract, too low and
 * the slate is wallpaper. Pot only matters because it buys chalk, so it is
 * worth much less on the last leg, where there is no shop left to spend it in.
 */
const POT_IN_POINTS = 10;
const POT_IN_POINTS_LAST_LEG = 2;

/** Winning the leg, in points. Larger than any leg, so a finish is never traded away. */
const CHECKOUT_VALUE = 2000;
/** Shaved off a checkout per dart used, so the planner finishes on the first dart it can. */
const CHECKOUT_PER_DART = 5;
/**
 * A bust costs the visit it wasted, in visits. The points it hands back are
 * counted separately, and so is the slate it takes with it.
 */
const BUST_VISITS = 1.2;
/** A pip of crowd heat, in points: four points of steadiness and a slice of the leg's Pot. */
const HEAT_PIP = 14;
/**
 * Walking away, over and above the darts it forfeits. The crowd notices, and a
 * visit thrown away is one the leg's clock does not hand back. Small: walking
 * IS sometimes right, and the planner should be allowed to say so.
 */
const WALL_TAX = 12;
/**
 * How much a point of score is worth, as a multiple of the pace the leg is
 * asking for. A leg gives about half again as many visits as a good scoring run
 * needs (content/legs.ts), and that slack is where the slate lives: with visits
 * in hand a point is cheap and a contract is worth changing the aim for, and
 * with the clock against you it is the other way round. Clamped at both ends so
 * that neither half of the game ever disappears.
 */
const PACE_MIN = 0.35;
const PACE_MAX = 1.8;
/** A forgiven bust still burns the dart and the one forgiveness the leg had. */
const FORGIVE_TAX = 30;
/** Worth of leaving a score that finishes in k darts. Index 0 is unused. */
const LEAVE_BONUS = [0, 130, 75, 35];
/** Leaving a number inside the finishing range that has no route at all (159, 163, 169…). */
const LEAVE_DEAD = -70;

/**
 * Targets tried at each depth. Sixty-two of them three darts deep is a quarter
 * of a million lines, so the tree bites deeper down — but never on a target
 * that finishes the leg. The narrow set is for the slate, which asks the same
 * question several times over and only needs to know which answer is bigger.
 */
interface Widths {
  root: number;
  second: number;
  third: number;
}
const FULL_WIDTHS: Widths = { root: 20, second: 10, third: 5 };
const SLATE_WIDTHS: Widths = { root: 8, second: 5, third: 3 };

/**
 * What one more visit in the next leg is worth, in the same Pot units the shop
 * uses. Scaled by how tight that leg already is, because a spare visit in the
 * First Round buys nothing and a spare visit in the Decider buys the night.
 */
const VISIT_WORTH = 9;

/**
 * Extra expected Pot a press has to clear before it is worth taking.
 *
 * The stake is not the whole cost. A press also commits the darts that are
 * left to a harder contract, which distorts the aim away from the leg, and
 * that cost does not appear anywhere in the arithmetic below. Measured, a
 * planner that pressed on any positive expectation did WORSE over a night
 * than one that never pressed at all; this is the margin that buys the
 * difference back.
 */
const PRESS_MARGIN = 2;

/** Sentinel score far above anything reachable: hypotheticals never bust or check out. */
const FAR = 100000;

// ---------------------------------------------------------------- results

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
  /** Pot left when the night ended. */
  potLeft: number;
  contractsTaken: number;
  contractsPaid: number;
  contractsPressed: number;
  potStaked: number;
  potWon: number;
  /** Visits where a bust or a dart off the board took the whole slate. */
  slatesWiped: number;
  /** Interventions held at the end, for reading a build back. */
  kitHeld: string[];
}

export interface PlayOptions {
  oche?: OcheId;
  /** Begin the night at this leg index (0..7). */
  startLeg?: number;
  /** Chalk ids granted before the first leg. */
  startChalk?: string[];
  /** false → walk through every shop without buying. */
  shop?: boolean;
  /** Override the policy's own slate behaviour (the §7 acceptance tests). */
  slate?: SlatePolicy;
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
  /** Pot staked on contracts and Pot won back, per night. */
  meanPotStaked: number;
  meanPotWon: number;
  outcomes: NightOutcome[];
}

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

/**
 * Expected sum of the top `k` of `h` values drawn without replacement. A value
 * is in the top k exactly when it is drawn and fewer than k of the values above
 * it are drawn. Used on the slate: an offer is a draw from the contract pool,
 * and the chalk that widens or narrows it is priced by what the extra draw adds.
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

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Caches are keyed by build, and a long sweep walks a lot of builds. */
function evict<K, V>(m: Map<K, V>, limit: number): void {
  if (m.size >= limit) m.clear();
}

/** Nothing on the slate, nothing to settle. Shared so the search allocates nothing. */
const NO_SETTLEMENT = { mask: 0, pot: 0 };

// ---------------------------------------------------------------- the board, as tables

/**
 * The search resolves millions of hypothetical darts, and the real pipeline
 * costs half a microsecond each. So the pipeline is run once per build over
 * every target and every throw index, and the search reads the answers out of
 * these tables. Nothing here decides anything; it is the same arithmetic the
 * engine does, precomputed.
 */

/** Index into ALL_TARGETS. -1 is the wall. */
const WALL_IDX = -1;
const WALL_TARGET: Target = { region: 'W' };

function keyOf(t: Target): string {
  return t.region === 'W' ? 'W' : `${t.region}${t.bed ?? ''}`;
}

const TARGET_IDX = new Map<string, number>(ALL_TARGETS.map((t, i) => [keyOf(t), i] as [string, number]));

function idxOf(t: Target): number {
  const i = TARGET_IDX.get(keyOf(t));
  return i === undefined ? WALL_IDX : i;
}

/** Where a dart aimed at one target can land, and with what chance. */
interface Spread {
  to: Int32Array;
  p: Float64Array;
}

const SPREAD_CACHE = new Map<string, Spread[]>();

function spreadTable(steadiness: number, use: string[]): Spread[] {
  const key = `${steadiness}|${use.join('+')}`;
  let table = SPREAD_CACHE.get(key);
  if (table) return table;
  evict(SPREAD_CACHE, 200);
  table = ALL_TARGETS.map((t) => {
    const dist = realSpread(t, steadiness, use);
    return {
      to: Int32Array.from(dist.map((l) => idxOf(l.target))),
      p: Float64Array.from(dist.map((l) => l.p)),
    };
  });
  SPREAD_CACHE.set(key, table);
  return table;
}

/** What a dart that LANDED on a target is worth, once the pipeline has had it. */
interface Shot {
  value: number;
  /** True if this throw satisfies checkout law (after wide_doubles, straight_out…). */
  double: boolean;
  /** The first resolved hit, which is what the contracts look at. */
  hit: Target | null;
}

const SHOT_CACHE = new Map<string, Shot[][]>();

/** [throwIndex][landed target] → the resolved throw. */
function shotTable(chalk: Chalk[], sig: string): Shot[][] {
  let table = SHOT_CACHE.get(sig);
  if (table) return table;
  evict(SHOT_CACHE, 200);
  table = [0, 1, 2, 3].map((ti) =>
    ALL_TARGETS.map((t) => {
      const r = resolveThrow(t, {
        chalk,
        rng: null,
        scoreBefore: FAR,
        scoreAtVisitStart: FAR,
        visitThrowIndex: ti as 0 | 1 | 2 | 3,
        forgivenessUsed: true,
      }).result;
      const last = r.hits[r.hits.length - 1];
      return { value: r.totalValue, double: !!last?.countsAsDouble, hit: r.hits[0] ? r.hits[0].target : null };
    }),
  );
  SHOT_CACHE.set(sig, table);
  return table;
}

// ---------------------------------------------------------------- per-leg context

interface Ctx {
  n: NightState;
  leg: LegState;
  /** Visits played when this was built: the pace moves as the leg runs out. */
  visits: number;
  perVisit: number;
  steadiness: number;
  sig: string;
  shots: Shot[][];
  spread: Spread[];
  /** Targets by descending expected points, per throw index. */
  order: Int32Array[];
  ev: Float64Array[];
  /** Highest score that can still be checked out with three darts. */
  ceiling: number;
  /** Share of the stake a pull returns: half, or all of it on On Tick. */
  pullShare: number;
  /** Darts needed to finish, per throw index and score. 0 = no route in three. */
  minDarts: Int32Array[];
  /** Targets that check the leg out, per throw index and score. */
  finishers: (Int32Array | null)[][];
  /** Candidate order for a score inside the finishing range, computed on demand. */
  ranked: Map<number, Int32Array>;
  /** Above this score nothing can bust and nothing can finish. */
  safeScore: number;
  maxDart: number;
  potWorth: number;
  /** What a good scoring visit is worth, in points. */
  typicalVisit: number;
  /** Points the leg needs per visit from here, and what that makes a point worth. */
  pace: number;
  weight: number;
  /** Points a bust costs on top of the score it gives back. */
  bustCost: number;
  onTick: boolean;
  cheapChalk: boolean;
  forgiving: boolean;
  overshoot: boolean;
  chalkDust: boolean;
}

const ROUTE_CACHE = new Map<string, Pick<Ctx, 'minDarts' | 'finishers' | 'ceiling' | 'maxDart'>>();
const ORDER_CACHE = new Map<string, { order: Int32Array[]; ev: Float64Array[] }>();
const RANKED_CACHE = new Map<string, Map<number, Int32Array>>();

let ctxCache: Ctx | null = null;

function chalkSig(n: NightState): string {
  return n.chalk
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => c.def.id)
    .join(',');
}

/** Points a Pot is worth right now. The last leg has no shop after it. */
function potWorth(n: NightState): number {
  return n.legIndex >= LEG_COUNT - 1 ? POT_IN_POINTS_LAST_LEG : POT_IN_POINTS;
}

function legCtx(n: NightState, leg: LegState): Ctx {
  const steadiness = steadinessOf(n, leg);
  const visits = leg.visits.length;
  if (ctxCache && ctxCache.n === n && ctxCache.leg === leg && ctxCache.steadiness === steadiness && ctxCache.visits === visits) return ctxCache;
  const sig = chalkSig(n);
  const perVisit = throwsPerVisitFor(n.chalk);
  const shots = shotTable(n.chalk, sig);
  const spread = spreadTable(steadiness, []);
  const routes = routeTables(shots, sig, perVisit, hasChalk(n, 'overshoot'));
  const orderKey = `${sig}|${steadiness}`;
  let order = ORDER_CACHE.get(orderKey);
  if (!order) {
    evict(ORDER_CACHE, 200);
    order = expectedOrder(shots, spread);
    ORDER_CACHE.set(orderKey, order);
  }
  let ranked = RANKED_CACHE.get(orderKey);
  if (!ranked) {
    evict(RANKED_CACHE, 40);
    ranked = new Map();
    RANKED_CACHE.set(orderKey, ranked);
  }
  const typicalVisit = Math.max(1, bestOf(order.ev[1]) * perVisit);
  const pace = leg.score / Math.max(1, leg.visitLimit - visits + 1);
  const weight = Math.max(PACE_MIN, Math.min(PACE_MAX, pace / typicalVisit));
  ctxCache = {
    n,
    leg,
    visits,
    perVisit,
    steadiness,
    sig,
    shots,
    spread,
    order: order.order,
    ev: order.ev,
    pullShare: hasChalk(n, 'on_tick') ? 1 : PULL_RETURN,
    ceiling: routes.ceiling,
    minDarts: routes.minDarts,
    finishers: routes.finishers,
    maxDart: routes.maxDart,
    ranked,
    // Above this, a whole visit cannot reach the finishing range, so nothing
    // that happens in it depends on the score at all.
    safeScore: routes.ceiling + routes.maxDart * perVisit,
    potWorth: potWorth(n),
    typicalVisit,
    pace,
    weight,
    // A bust costs the visit itself; what it hands back is priced by `weight`
    // along with every other point, and the slate it takes is priced on the slate.
    bustCost: weight * typicalVisit * BUST_VISITS + leg.heat * HEAT_PIP,
    onTick: hasChalk(n, 'on_tick'),
    cheapChalk: hasChalk(n, 'cheap_chalk'),
    forgiving: hasChalk(n, 'forgiving_oche'),
    overshoot: hasChalk(n, 'overshoot'),
    chalkDust: hasChalk(n, 'chalk_dust'),
  };
  return ctxCache;
}

function bestOf(row: Float64Array): number {
  let best = 0;
  for (let i = 0; i < row.length; i++) if (row[i] > best) best = row[i];
  return best;
}

/** Expected points of every target, and the order they rank in. */
function expectedOrder(shots: Shot[][], spread: Spread[]): { order: Int32Array[]; ev: Float64Array[] } {
  const ev: Float64Array[] = [];
  const order: Int32Array[] = [];
  for (let ti = 0; ti < 4; ti++) {
    const row = new Float64Array(ALL_TARGETS.length);
    for (let i = 0; i < ALL_TARGETS.length; i++) {
      const s = spread[i];
      let e = 0;
      for (let k = 0; k < s.to.length; k++) {
        const to = s.to[k];
        if (to >= 0) e += s.p[k] * shots[ti][to].value;
      }
      row[i] = e;
    }
    ev.push(row);
    const idx = Array.from({ length: ALL_TARGETS.length }, (_, i) => i).sort((a, b) => row[b] - row[a] || a - b);
    order.push(Int32Array.from(idx));
  }
  return { order, ev };
}

/**
 * The finish table, computed through this build's own pipeline: how many darts
 * a score needs, and which targets close it. This is the thing a pub player
 * carries in their head, and it is why leaving 32 is worth points and leaving
 * 33 is not.
 */
function routeTables(shots: Shot[][], sig: string, perVisit: number, overshoot: boolean): Pick<Ctx, 'minDarts' | 'finishers' | 'ceiling' | 'maxDart'> {
  const key = `${sig}|${perVisit}`;
  const hit = ROUTE_CACHE.get(key);
  if (hit) return hit;
  evict(ROUTE_CACHE, 60);
  let maxDart = 0;
  let maxFinisher = 0;
  for (let ti = 0; ti < 4; ti++) {
    for (const s of shots[ti]) {
      if (s.value > maxDart) maxDart = s.value;
      if (s.double && s.value > maxFinisher) maxFinisher = s.value;
    }
  }
  const ceiling = maxDart * 2 + maxFinisher;
  const size = ceiling + 1;
  const finishers: (Int32Array | null)[][] = [];
  const reach: Uint8Array[] = [];
  for (let ti = 0; ti < 4; ti++) {
    const fin: (Int32Array | null)[] = new Array(size).fill(null);
    const one = new Uint8Array(size);
    for (let score = 2; score < size; score++) {
      const list: number[] = [];
      for (let i = 0; i < ALL_TARGETS.length; i++) {
        const s = shots[ti][i];
        if (!s.double) continue;
        if (s.value === score || (overshoot && s.value > score && s.value - score <= 2)) list.push(i);
      }
      if (list.length) {
        fin[score] = Int32Array.from(list);
        one[score] = 1;
      }
    }
    finishers.push(fin);
    reach.push(one);
  }
  // Two darts, then three: a score is k darts away when one throw leaves a
  // score that is k-1 away at the next index.
  const minDarts = reach.map((r) => Int32Array.from(r, (x) => (x ? 1 : 0)));
  for (let depth = 2; depth <= 3; depth++) {
    const next = minDarts.map((m) => Int32Array.from(m));
    for (let ti = 0; ti < 4; ti++) {
      const after = (ti + 1) % Math.max(1, perVisit);
      for (let score = 2; score < size; score++) {
        if (minDarts[ti][score] > 0) continue;
        for (let i = 0; i < ALL_TARGETS.length; i++) {
          const v = shots[ti][i].value;
          const left = score - v;
          if (left < 2 || left >= size) continue;
          if (minDarts[after][left] === depth - 1) {
            next[ti][score] = depth;
            break;
          }
        }
      }
    }
    for (let ti = 0; ti < 4; ti++) minDarts[ti] = next[ti];
  }
  const out = { minDarts, finishers, ceiling, maxDart };
  ROUTE_CACHE.set(key, out);
  return out;
}

/**
 * A finishing route from a position, read back out of the route table: finish
 * it if one dart does, else the throw that leaves the shortest finish. Same
 * answer as the checkout hints the player is shown, without the search.
 */
function routeTargets(ctx: Ctx, score: number, ti: number, darts: number): number[] {
  const out: number[] = [];
  let s = score;
  let index = ti;
  for (let d = 0; d < darts; d++) {
    if (s > ctx.ceiling) break;
    const need = ctx.minDarts[index][s] ?? 0;
    if (need <= 0) break;
    if (need === 1) {
      const fin = ctx.finishers[index][s];
      if (!fin || fin.length === 0) break;
      out.push(fin[0]);
      break;
    }
    const after = (index + 1) % ctx.perVisit;
    let pick = -1;
    for (const i of ctx.order[index]) {
      const shot = ctx.shots[index][i];
      const left = s - shot.value;
      if (left < 2 || left > ctx.ceiling) continue;
      if (ctx.minDarts[after][left] === need - 1) {
        pick = i;
        break;
      }
    }
    if (pick < 0) break;
    out.push(pick);
    s -= ctx.shots[index][pick].value;
    index = after;
  }
  return out;
}

// ---------------------------------------------------------------- the rule stage, mirrored

interface Landed {
  outcome: 'CONTINUE' | 'CHECKOUT' | 'BUST';
  committed: number;
  forgiven: boolean;
}

/**
 * What a landed dart does to the score. This mirrors the RULE stage of
 * `resolveThrow` exactly — bust below zero, bust on one, bust on zero without
 * a double, then the consequences in order: insured, forgiveness, cheap chalk,
 * revert. It exists only because the search cannot afford to call the real
 * pipeline a million times a dart; if the resolver's rules move, this moves.
 */
function land(ctx: Ctx, score: number, from: number, value: number, double: boolean, forgiveLeft: boolean, insured: boolean): Landed {
  const after = score - value;
  let outcome: Landed['outcome'];
  if (after < 0) outcome = ctx.overshoot && after >= -2 && double ? 'CHECKOUT' : 'BUST';
  else if (after === 1) outcome = ctx.chalkDust ? 'CONTINUE' : 'BUST';
  else if (after === 0) outcome = double ? 'CHECKOUT' : 'BUST';
  else outcome = 'CONTINUE';

  if (outcome === 'CONTINUE') return { outcome, committed: after === 1 ? 2 : after, forgiven: false };
  if (outcome === 'CHECKOUT') return { outcome, committed: 0, forgiven: false };
  if (insured) return { outcome: 'BUST', committed: score, forgiven: false };
  if (ctx.forgiving && forgiveLeft) return { outcome: 'CONTINUE', committed: score, forgiven: true };
  if (ctx.cheapChalk) return { outcome: 'BUST', committed: 2, forgiven: false };
  return { outcome: 'BUST', committed: from, forgiven: false };
}

/**
 * What the position is worth once the darts stop. The leave bonus is not scaled
 * by the pace: down at the business end, whether the number left is a nice one
 * is the whole question, and it does not get less true because there are visits
 * in hand.
 */
function endValue(ctx: Ctx, score: number, busted: boolean, checkedOut: boolean, darts: number, walked: boolean, heat: number): number {
  if (checkedOut) return CHECKOUT_VALUE - darts * CHECKOUT_PER_DART;
  let v = 0;
  if (score <= ctx.ceiling) {
    const need = ctx.minDarts[0][score] ?? 0;
    v = need > 0 ? LEAVE_BONUS[need] : LEAVE_DEAD;
  }
  if (busted) v -= ctx.bustCost;
  else if (walked) v -= WALL_TAX + heat * HEAT_PIP;
  else if (heat < HEAT_CAP) v += HEAT_PIP;
  return v;
}

// ---------------------------------------------------------------- candidates

/**
 * Which targets are worth trying from a position. Above the finishing range it
 * is simply the biggest expected score; inside it, the order a darts player
 * would read off the board — finish it, else leave yourself something that
 * finishes, else score. Anything that closes the leg is always in the list,
 * however deep the search is, because that is the one thing pruning must never
 * throw away.
 */
function candidates(ctx: Ctx, score: number, ti: number, width: number, out: number[]): number[] {
  out.length = 0;
  const order = ctx.order[ti];
  if (score > ctx.ceiling) {
    for (let i = 0; i < width && i < order.length; i++) out.push(order[i]);
    return out;
  }
  const key = ti * 4096 + score;
  let list = ctx.ranked.get(key);
  if (!list) {
    const after = (ti + 1) % ctx.perVisit;
    const rank = new Float64Array(ALL_TARGETS.length);
    for (let i = 0; i < ALL_TARGETS.length; i++) {
      const s = ctx.shots[ti][i];
      const r = land(ctx, score, score, s.value, s.double, false, false);
      if (r.outcome === 'CHECKOUT') rank[i] = 0;
      else if (r.outcome === 'BUST') rank[i] = 9;
      else {
        const need = r.committed <= ctx.ceiling ? ctx.minDarts[after][r.committed] : 0;
        rank[i] = need > 0 ? need : 4;
      }
    }
    const idx = Array.from({ length: ALL_TARGETS.length }, (_, i) => i).sort(
      (a, b) => rank[a] - rank[b] || ctx.ev[ti][b] - ctx.ev[ti][a] || a - b,
    );
    list = Int32Array.from(idx);
    ctx.ranked.set(key, list);
  }
  const fin = ctx.finishers[ti][score];
  if (fin) for (let i = 0; i < fin.length; i++) out.push(fin[i]);
  for (let i = 0; i < list.length && out.length < width; i++) {
    if (!out.includes(list[i])) out.push(list[i]);
  }
  return out;
}

// ---------------------------------------------------------------- the aim search

/** What a one-shot does to the dart it is spent on, and to nothing else. */
interface Mods {
  spread: Spread[];
  doubled: boolean;
  insured: boolean;
}

/**
 * Expectimax over the rest of the visit. The state is the score, the darts
 * gone, the visit's own history (which is all the contracts can see) and which
 * contracts are still riding; the value is points at the pace this leg is
 * asking for, with Pot converted at `POT_IN_POINTS`.
 *
 * A contract is banked the moment it is made, because that is what `planPress`
 * will do with it, and because a made contract left riding into a bust is a
 * mistake the search should not be allowed to make on the player's behalf.
 *
 * Two states with the same score, the same darts gone and the same landings
 * behind them are the same position, so they are searched once. With nothing on
 * the slate the landings stop mattering and the tree collapses further: that is
 * the difference between a visit that is only arithmetic and one with money on
 * it.
 */
export function rankedActions(n: NightState, leg: LegState): RatedAction[] {
  return searchVisit(n, leg, ridingOn(leg), FULL_WIDTHS, true);
}

/** The contracts still on the table: unsettled and not yet gone. */
function ridingOn(leg: LegState): TakenContract[] {
  return leg.slate.filter((c) => !c.settled && c.status !== 'DEAD');
}

/**
 * The search proper. `riding` is passed in rather than read off the leg so the
 * slate can ask what a visit would be worth with a contract on it that has not
 * been taken yet.
 */
function searchVisit(n: NightState, leg: LegState, riding: TakenContract[], w: Widths, withKit: boolean): RatedAction[] {
  const ctx = legCtx(n, leg);
  const visit = currentVisit(leg);
  const from = visit.scoreAtVisitStart;
  const thrown = visit.throws.length;
  const perVisit = ctx.perVisit;
  if (thrown >= perVisit) return [{ action: { wall: true }, value: 0 }];

  // The visit so far, as the contracts see it. Forgiven darts never happened.
  const values: number[] = [];
  const hits: (Target | null)[] = [];
  for (const t of visit.throws) {
    if (t.forgiven) continue;
    values.push(t.totalValue);
    hits.push(t.hits[0] ? t.hits[0].target : null);
  }
  const fullMask = (1 << riding.length) - 1;
  const pot = ctx.potWorth;
  const weight = ctx.weight;

  const progress: VisitProgress = { values, hits, left: 0, from, now: 0, busted: false, checkedOut: false };
  const memo = new Map<number, number>();
  const scratch: number[][] = [[], [], [], [], []];
  const PLAIN: Mods = { spread: ctx.spread, doubled: false, insured: false };
  // The landings behind us, packed one target index to six bits. Everything the
  // contracts can see is a function of this and the score.
  let trail = 0;
  const trails: number[] = [];

  /** Settle what the last dart did to the slate: made contracts are money, dead ones are gone. */
  function settle(mask: number, darts: number, score: number, busted: boolean, checkedOut: boolean): { mask: number; pot: number } {
    if (mask === 0) return NO_SETTLEMENT;
    progress.left = Math.max(0, perVisit - darts);
    progress.now = score;
    progress.busted = busted;
    progress.checkedOut = checkedOut;
    let paid = 0;
    let m = mask;
    for (let i = 0; i < riding.length; i++) {
      if ((m & (1 << i)) === 0) continue;
      const c = riding[i];
      const status = contractDef(c.defId).check(progress);
      if (status === 'MADE') {
        if (!busted || ctx.onTick) paid += c.stake + c.price;
        m &= ~(1 << i);
      } else if (status === 'DEAD') {
        m &= ~(1 << i);
      }
    }
    return { mask: m, pot: paid };
  }

  const terminal = (score: number, busted: boolean, checkedOut: boolean, darts: number, walked: boolean) =>
    endValue(ctx, score, busted, checkedOut, darts, walked, leg.heat);

  /** Push a landing onto the line the search is walking. */
  function push(value: number, hit: Target | null, to: number): void {
    values.push(value);
    hits.push(hit);
    trails.push(trail);
    trail = trail * 64 + to + 1;
  }

  function pop(): void {
    values.pop();
    hits.pop();
    trail = trails.pop() as number;
  }

  /** Best play from a position, over the darts that are left. */
  function node(score: number, darts: number, mask: number, forgiveLeft: boolean, depth: number): number {
    if (darts >= perVisit) return terminal(score, false, false, darts, false);
    const key = (((score * 8 + darts) * 2 + (forgiveLeft ? 1 : 0)) * 64 + mask) * 1073741824 + (mask === 0 ? 0 : trail);
    const seen = memo.get(key);
    if (seen !== undefined) return seen;
    const width = depth <= 1 ? w.second : w.third;
    const list = candidates(ctx, score, Math.min(3, darts), width, scratch[Math.min(4, depth)]);
    // Walking away is on the table at every depth: a visit that can only make
    // things worse is a visit to end.
    let best = terminal(score, false, false, darts, true);
    for (let i = 0; i < list.length; i++) {
      const v = expect(list[i], score, darts, mask, forgiveLeft, depth, PLAIN);
      if (v > best) best = v;
    }
    memo.set(key, best);
    return best;
  }

  /** Expected value of aiming at one target, over everywhere it can land. */
  function expect(targetIdx: number, score: number, darts: number, mask: number, forgiveLeft: boolean, depth: number, mods: Mods): number {
    const ti = Math.min(3, darts);
    // A one-shot bends this dart and no others, so the spread it changes is
    // this dart's; everything deeper is thrown with the hand the player has.
    const s = mods.spread[targetIdx];
    const doubled = mods.doubled;
    const insured = mods.insured;
    const shots = ctx.shots[ti];
    let ev = 0;
    for (let k = 0; k < s.to.length; k++) {
      const p = s.p[k];
      if (p <= 0) continue;
      const to = s.to[k];
      let v: number;
      if (to === WALL_IDX) {
        // In the wall: the dart is spent and nothing is hit, but the visit goes on.
        push(0, null, to);
        const st = settle(mask, darts + 1, score, false, false);
        v = pot * st.pot + (darts + 1 >= perVisit ? terminal(score, false, false, darts + 1, false) : node(score, darts + 1, st.mask, forgiveLeft, depth + 1));
        pop();
      } else {
        const shot = shots[to];
        const value = doubled ? shot.value * 2 : shot.value;
        const r = land(ctx, score, from, value, shot.double, forgiveLeft, insured);
        if (r.forgiven) {
          v = -FORGIVE_TAX + (darts + 1 >= perVisit ? terminal(score, false, false, darts + 1, false) : node(score, darts + 1, mask, false, depth + 1));
        } else {
          push(value, shot.hit, to);
          const busted = r.outcome === 'BUST';
          const out = r.outcome === 'CHECKOUT';
          const st = settle(mask, darts + 1, r.committed, busted, out);
          v =
            weight * (score - r.committed) +
            pot * st.pot +
            (busted || out || darts + 1 >= perVisit
              ? terminal(r.committed, busted, out, darts + 1, false)
              : node(r.committed, darts + 1, st.mask, forgiveLeft, depth + 1));
          pop();
        }
      }
      ev += p * v;
    }
    return ev;
  }

  const rated: RatedAction[] = [];
  // Walking away ends the visit here: the darts left are forfeit and so is
  // anything on the slate that has not been made.
  push(0, null, WALL_IDX);
  const walkSettle = settle(fullMask, thrown + 1, leg.score, false, false);
  rated.push({
    action: { wall: true },
    value: pot * walkSettle.pot + terminal(leg.score, false, false, thrown + 1, true),
  });
  pop();

  const width = perVisit - thrown >= 3 ? w.root : ALL_TARGETS.length;
  const roots = candidates(ctx, leg.score, Math.min(3, thrown), width, []);
  for (const i of roots) {
    rated.push({ action: { target: { ...ALL_TARGETS[i] } }, value: expect(i, leg.score, thrown, fullMask, !leg.forgivenessUsed, 0, PLAIN) });
  }
  rated.sort((a, b) => b.value - a.value);

  // One-shots are worth trying only on the darts the planner already likes.
  const kit = withKit ? [...new Set(n.kit.filter((id) => interventionDef(id).when === 'AIM' && id !== 'again'))] : [];
  if (kit.length) {
    const tops = rated.filter((r) => 'target' in r.action).slice(0, 3);
    for (const top of tops) {
      const idx = idxOf((top.action as { target: Target }).target);
      for (const id of kit) {
        const mods: Mods = {
          spread: id === 'steady' ? spreadTable(ctx.steadiness + STEADY_INTERVENTION, []) : id === 'called' ? spreadTable(ctx.steadiness, ['called']) : ctx.spread,
          doubled: id === 'doubled',
          insured: id === 'insured',
        };
        const v = expect(idx, leg.score, thrown, fullMask, !leg.forgivenessUsed, 0, mods);
        rated.push({ action: { target: { ...ALL_TARGETS[idx] }, use: id }, value: v - KIT_RATING[id] * pot });
      }
    }
    rated.sort((a, b) => b.value - a.value);
  }
  return rated;
}

export function planVisit(n: NightState, leg: LegState): Action {
  return rankedActions(n, leg)[0].action;
}

// ---------------------------------------------------------------- the naive rule

/**
 * The rule the third playtest described: throw the biggest number that does
 * not bust, otherwise walk. It is the baseline every claim about the loop is
 * measured against (docs/decisions/design.md §1), so it stays in the build.
 */
export function naiveAction(n: NightState, leg: LegState): Action {
  const ctx = legCtx(n, leg);
  const visit = currentVisit(leg);
  const ti = Math.min(3, visit.throws.length);
  let best = -1;
  let bestValue = -1;
  for (let i = 0; i < ALL_TARGETS.length; i++) {
    const s = ctx.shots[ti][i];
    if (land(ctx, leg.score, visit.scoreAtVisitStart, s.value, s.double, false, false).outcome === 'BUST') continue;
    if (s.value > bestValue) {
      best = i;
      bestValue = s.value;
    }
  }
  return best < 0 ? { wall: true } : { target: ALL_TARGETS[best] };
}

/** Naive until the finish is in range, then the shortest route the table names. */
function checkoutAction(n: NightState, leg: LegState): Action {
  const hints = computeCheckoutHints(n, leg);
  if (hints.best) return { target: hints.best.targets[0] };
  return naiveAction(n, leg);
}

// ---------------------------------------------------------------- what a visit does to the slate

/**
 * Every way the rest of a visit can go under a fixed plan, exactly. Three darts
 * is at most a few hundred lines, so nothing is sampled and nothing is guessed:
 * the contract probabilities the slate decisions rest on are the real ones.
 */
function enumerateVisit(
  ctx: Ctx,
  leg: LegState,
  plan: (score: number, darts: number) => number,
  start: { score: number; darts: number; values: number[]; hits: (Target | null)[] },
  visit: (p: number, prog: VisitProgress, points: number) => void,
): void {
  const from = currentVisit(leg).scoreAtVisitStart;
  const values = start.values.slice();
  const hits = start.hits.slice();
  const prog: VisitProgress = { values, hits, left: 0, from, now: 0, busted: false, checkedOut: false };
  const end = (p: number, darts: number, score: number, busted: boolean, checkedOut: boolean, points: number) => {
    prog.left = Math.max(0, ctx.perVisit - darts);
    prog.now = score;
    prog.busted = busted;
    prog.checkedOut = checkedOut;
    visit(p, prog, points);
  };
  const step = (p: number, score: number, darts: number, points: number): void => {
    if (p <= 0) return;
    if (darts >= ctx.perVisit) {
      end(p, darts, score, false, false, points);
      return;
    }
    const ti = Math.min(3, darts);
    const targetIdx = plan(score, darts);
    const s = ctx.spread[targetIdx];
    for (let k = 0; k < s.to.length; k++) {
      const q = p * s.p[k];
      if (q <= 0) continue;
      const to = s.to[k];
      if (to === WALL_IDX) {
        values.push(0);
        hits.push(null);
        step(q, score, darts + 1, points);
        values.pop();
        hits.pop();
        continue;
      }
      const shot = ctx.shots[ti][to];
      const r = land(ctx, score, from, shot.value, shot.double, false, false);
      if (r.forgiven) {
        step(q, score, darts + 1, points);
        continue;
      }
      values.push(shot.value);
      hits.push(shot.hit);
      if (r.outcome === 'CONTINUE') step(q, r.committed, darts + 1, points + shot.value);
      else end(q, darts + 1, r.committed, r.outcome === 'BUST', r.outcome === 'CHECKOUT', points + (score - r.committed));
      values.pop();
      hits.pop();
    }
  };
  step(1, start.score, start.darts, 0);
}

/** The aim plans the slate is priced against. Each pulls the visit a different way. */
interface Plan {
  key: string;
  pick: (score: number, darts: number) => number;
}

/** The plan a visit is thrown on when nobody is chasing anything: score it. */
function scorerPlan(ctx: Ctx): Plan {
  const scratch: number[] = [];
  return {
    key: 'score',
    pick: (score, darts) => {
      const ti = Math.min(3, darts);
      const list = candidates(ctx, score, ti, 1, scratch);
      return list.length ? list[0] : ctx.order[ti][0];
    },
  };
}

/**
 * The shapes a visit can be thrown in, beyond throwing it at the treble twenty.
 * Each one is what some contract is actually asking for, which is the point:
 * a contract that nobody would ever change their aim for is decoration, and
 * the way to find out whether this one is worth changing aim for is to price
 * the visit both ways.
 */
const SHAPES: Record<string, string[]> = {
  safe: ['S20'],
  quiet: ['S1'],
  bull: ['IB'],
  doubles: ['D20'],
  odds: ['T19'],
  rings: ['T20', 'D20', 'S20'],
  ladder: ['S1', 'S19', 'T20'],
  downstairs: ['T20', 'S19', 'S1'],
};

/** Which shapes each contract is asking for. The scoring plan is always tried. */
const PLAN_HINTS: Record<string, string[]> = {
  bull: ['bull'],
  in_a_bed: ['safe', 'rings'],
  shanghai: ['rings'],
  three_ways: ['rings'],
  two_doubles: ['doubles'],
  nothing_cheap: ['safe'],
  nothing_cheaper: ['safe'],
  quiet_one: ['quiet'],
  clean_hands: ['safe'],
  plain_numbers: ['safe', 'quiet'],
  cheap_seats: ['quiet'],
  left_pretty: ['safe'],
  ladder_up: ['ladder'],
  ladder_down: ['downstairs'],
  odd_job: ['odds'],
};

function shapePlan(key: string): Plan {
  const idx = SHAPES[key].map((t) => idxOf(parse(t)));
  return { key, pick: (_s, d) => idx[Math.min(idx.length - 1, d)] };
}

/**
 * The plans worth pricing this visit against: scoring it, finishing it, and
 * whatever shapes the contracts on offer are asking for.
 */
function plansFor(ctx: Ctx, leg: LegState, offer: string[] = []): Plan[] {
  const plans: Plan[] = [scorerPlan(ctx)];
  const wanted = new Set<string>();
  for (const id of offer) for (const k of PLAN_HINTS[id] ?? []) wanted.add(k);
  for (const k of wanted) plans.push(shapePlan(k));
  const thrown = currentVisit(leg).throws.length;
  const route = routeTargets(ctx, leg.score, Math.min(3, thrown), ctx.perVisit - thrown);
  if (route.length) plans.push({ key: 'finish', pick: (_s, d) => route[Math.min(route.length - 1, Math.max(0, d - thrown))] });
  return plans;
}

function parse(s: string): Target {
  if (s === 'IB') return { region: 'IB' };
  if (s === 'OB') return { region: 'OB' };
  const m = /^([SDT])(\d+)$/.exec(s);
  if (!m) throw new Error(`bad target ${s}`);
  return { region: m[1] as Target['region'], bed: Number(m[2]) as NonNullable<Target['bed']> };
}

interface PlanReading {
  /** Chance each contract is made when the visit settles. */
  made: Map<string, number>;
  /** What the visit is worth thrown this way, in points, the leave included. */
  points: number;
}

const PLAN_CACHE = new Map<string, PlanReading>();

/**
 * What a plan does: the chance it makes each contract, and what it scores.
 * Above the finishing range neither depends on the score at all, so the answer
 * is cached per build and reused all night.
 */
function readPlan(ctx: Ctx, leg: LegState, plan: Plan, ids: string[]): PlanReading {
  const visit = currentVisit(leg);
  // Nothing in a visit depends on where it started once the finish is out of
  // reach, so those readings are shared by every visit of every night.
  const generic = leg.score > ctx.safeScore;
  const cacheable = visit.throws.length === 0;
  const key = `${ctx.sig}|${ctx.steadiness}|${ctx.perVisit}|${plan.key}|${leg.score}|${leg.heat}|${ctx.weight.toFixed(2)}|${generic ? '*' : ids.join('+')}`;
  if (cacheable) {
    const hit = PLAN_CACHE.get(key);
    if (hit) return hit;
    evict(PLAN_CACHE, 4000);
  }
  const defs = (generic ? CONTRACTS.filter((c) => c.weight > 0).map((c) => c.id) : ids).map(contractDef);
  const made = new Map<string, number>();
  for (const d of defs) made.set(d.id, 0);
  let points = 0;
  const values: number[] = [];
  const hits: (Target | null)[] = [];
  for (const t of visit.throws) {
    if (t.forgiven) continue;
    values.push(t.totalValue);
    hits.push(t.hits[0] ? t.hits[0].target : null);
  }
  enumerateVisit(ctx, leg, plan.pick, { score: leg.score, darts: visit.throws.length, values, hits }, (p, prog, pts) => {
    points += p * (ctx.weight * pts + endValue(ctx, prog.now, prog.busted, prog.checkedOut, ctx.perVisit - prog.left, false, leg.heat));
    for (const d of defs) {
      if (d.check(prog) === 'MADE' && (!prog.busted || ctx.onTick)) made.set(d.id, (made.get(d.id) as number) + p);
    }
  });
  const out = { made, points };
  if (cacheable) PLAN_CACHE.set(key, out);
  return out;
}

// ---------------------------------------------------------------- the slate

/**
 * Which contracts to take, before the first dart.
 *
 * A contract is a price against a probability: it costs the stake now and pays
 * the stake plus the price if it lands, so it is worth taking when the chance
 * clears `stake / (stake + price)`. But the chance depends on how the visit is
 * thrown, and a visit can only be thrown one way — so plan and contracts are
 * chosen together. Each candidate plan is scored on the Pot its contracts
 * would earn plus the points it would score, converted at the same rate the
 * aim search uses, and the best pairing wins.
 */
export function planSlate(n: NightState, leg: LegState): string[] {
  if (leg.status !== 'ACTIVE' || currentVisit(leg).throws.length > 0) return [];
  const offer = leg.offer.filter((id) => contractDef(id).stake <= n.pot);
  if (offer.length === 0) return [];
  const ctx = legCtx(n, leg);
  let bestIds: string[] = [];
  let bestValue = -Infinity;
  for (const plan of plansFor(ctx, leg, offer)) {
    const reading = readPlan(ctx, leg, plan, offer);
    const rated = offer
      .map((id) => {
        const def = contractDef(id);
        const p = reading.made.get(id) ?? 0;
        const price = currentPrice(n, id);
        return { id, stake: def.stake, ev: p * price - (1 - p) * def.stake };
      })
      .sort((a, b) => b.ev - a.ev);
    let spend = 0;
    const take: string[] = [];
    let ev = 0;
    for (const r of rated) {
      // Leave the Pot something to press or bank with; a slate taken to the
      // last coin cannot take the money when the money is there.
      if (r.ev <= 0 || spend + r.stake > n.pot - 1) continue;
      take.push(r.id);
      spend += r.stake;
      ev += r.ev;
    }
    // Plan and contracts are chosen together, in Pot: what the visit would earn
    // off the slate thrown this way, plus what it is worth on the board thrown
    // this way. A contract whose whole point is that you aim differently for it
    // can only be priced against the visit it would change.
    const value = ev + reading.points / ctx.potWorth;
    if (value > bestValue) {
      bestValue = value;
      bestIds = take;
    }
  }
  return bestIds;
}

/** The chance a contract still riding is made — and survives — if it is left alone. */
function ridingValue(ctx: Ctx, leg: LegState, c: TakenContract): number {
  const plan = scorerPlan(ctx);
  const visit = currentVisit(leg);
  const values: number[] = [];
  const hits: (Target | null)[] = [];
  for (const t of visit.throws) {
    if (t.forgiven) continue;
    values.push(t.totalValue);
    hits.push(t.hits[0] ? t.hits[0].target : null);
  }
  const def = contractDef(c.defId);
  let made = 0;
  // A bust takes everything unbanked with it, so the bust risk of the darts
  // still to come is already priced in here: those lines pay nothing.
  enumerateVisit(ctx, leg, plan.pick, { score: leg.score, darts: visit.throws.length, values, hits }, (p, prog) => {
    if (def.check(prog) === 'MADE' && (!prog.busted || ctx.onTick)) made += p;
  });
  return made;
}

/**
 * After every dart: take the money, let it ride, or double it.
 *
 * Banking is certain and pressing is not, so the only question is whether the
 * chance of the harder tier clears the money already on the table — and whether
 * the darts left can bust and take the lot. One action per call; the caller
 * keeps asking until there is nothing worth doing.
 */
export function planPress(n: NightState, leg: LegState): { index: number; act: 'PULL' | 'PRESS' } | null {
  if (leg.status !== 'ACTIVE') return null;
  const visit = currentVisit(leg);
  if (!visit || visit.throws.length === 0 || visit.busted) return null;
  const ctx = legCtx(n, leg);
  let best: { index: number; act: 'PULL' | 'PRESS' } | null = null;
  let bestGain = 0.01;
  for (let i = 0; i < leg.slate.length; i++) {
    const c = leg.slate[i];
    const def = contractDef(c.defId);
    if (!c.settled) {
      // A live contract: settle for what it is worth now, or ride it to the
      // end. Settling pays more the longer it has survived, so this is a real
      // comparison on every dart rather than a last resort.
      if (c.status === 'DEAD') continue;
      const leave = ridingValue(ctx, leg, c) * (c.stake + c.price);
      const now = settleWorth(n, leg, c);
      if (now - leave > bestGain) {
        bestGain = now - leave;
        best = { index: i, act: 'PULL' };
      }
      continue;
    }
    // A contract that has already paid. The only thing left to do with it is
    // put the winnings back up on something harder.
    if (!pressable(n, leg, c)) continue;
    // Not on the dart that could win the leg. Anywhere else the darts are
    // fair game; here they belong to the double.
    if (ctx.minDarts[Math.min(3, visit.throws.length)][leg.score] === 1) continue;
    const stake = pressStake(c.stake);
    if (n.pot < stake) continue;
    const harder = contractDef(def.pressTo as string);
    const price = currentPrice(n, harder.id);
    const fresh: TakenContract = { ...c, defId: harder.id, stake, price, takenAt: visit.throws.length, madeAt: null, status: 'LIVE', settled: null };
    const press = ridingValue(ctx, leg, fresh) * (stake + price) - stake - PRESS_MARGIN;
    if (press > bestGain) {
      bestGain = press;
      best = { index: i, act: 'PRESS' };
    }
  }
  return best;
}

// ---------------------------------------------------------------- the shop

/**
 * What a one-shot is worth in Pot, rated by how often it changes the outcome of
 * the dart it is spent on and by what that dart was worth.
 *
 *   STEADY  moves a quarter of the mass onto the target. On the double at the
 *           death that is a quarter of a leg, which is why it is the dearest.
 *   DOUBLED changes every dart it touches, but only by points.
 *   CALLED  only bites on a double, where a third of the misses are the wall.
 *   INSURED only bites on the darts that bust, and those are the ones you can
 *           see coming and aim around instead.
 *   AGAIN   re-rolls into the same distribution. It cannot change an
 *           expectation, so it is priced at nothing. (This looks like a bug in
 *           the intervention, not in the bot.)
 */
const KIT_RATING: Record<string, number> = { steady: 4, doubled: 3.5, called: 2, insured: 1.5, rubout: 2, again: 0.2 };

/**
 * Chalk that changes the numbers is measured against this build rather than
 * rated: the aim model means a chalk can be worth everything or nothing
 * depending on what is already on the board. Narrow Beds is the extreme — it
 * turns the 97% single into a treble — and it should read that way here.
 */
const MEASURED_CHALK = new Set([
  'hot_twenty',
  'feathered',
  'heavy_tips',
  'oiled',
  'even_keel',
  'cold_hands',
  'last_orders',
  'bullish',
  'magnetised',
  'wide_trebles',
  'mirrored',
  'wired',
  'split_tips',
  'tunnel_vision',
  'fourth_dart',
  'practice_board',
]);

/** Hand-set worth, in Pot, of the chalk whose value is not a number on the board. */
const CHALK_RATING: Record<string, number> = {
  wide_doubles: 10,
  cheap_chalk: 11,
  forgiving_oche: 9,
  straight_out: 14,
  overshoot: 8,
  chalk_dust: 3,
  short_price: 4,
  long_prices: 8,
  on_tick: 7,
  wide_grip: 6,
  chalked_up: 3,
};

/** How much a chalk that moves the numbers is worth: the visit total it adds, as a fraction. */
const MEASURE_SCALE = 30;
const MEASURE_CAP = 22;
/** Pot held back for a chalk while a chalk slot is still open. */
const CHALK_RESERVE = 10;

/** Expected points of the best dart on the board under a given build. */
function bestDartEV(chalk: Chalk[], steadiness: number): number {
  const sig = chalk
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => c.def.id)
    .join(',');
  const shots = shotTable(chalk, sig);
  const spread = spreadTable(steadiness, []);
  let best = 0;
  for (let i = 0; i < ALL_TARGETS.length; i++) {
    const s = spread[i];
    let e = 0;
    for (let k = 0; k < s.to.length; k++) {
      const to = s.to[k];
      if (to >= 0) e += s.p[k] * shots[1][to].value;
    }
    if (e > best) best = e;
  }
  return best * throwsPerVisitFor(chalk);
}

export function chalkRating(n: NightState, id: string, held = false): number {
  const steadiness = 0;
  if (MEASURED_CHALK.has(id)) {
    const withChalk = held ? n.chalk : [...n.chalk, { def: chalkDef(id), order: n.nextChalkOrder }];
    const without = held ? n.chalk.filter((c) => c.def.id !== id) : n.chalk;
    const base = bestDartEV(without, steadiness + (without.some((c) => c.def.id === 'practice_board') ? 8 : 0));
    const after = bestDartEV(withChalk, steadiness + (withChalk.some((c) => c.def.id === 'practice_board') ? 8 : 0));
    if (base <= 0) return 0;
    const gain = (after - base) / base;
    return Math.max(0, Math.min(MEASURE_CAP, gain * MEASURE_SCALE));
  }
  switch (id) {
    case 'split_tips':
      // The split single lands last, so it stops the dart counting as a double.
      return hasChalk(n, 'straight_out') ? 8 : 2;
    case 'wide_doubles':
      return hasChalk(n, 'straight_out') ? 1 : CHALK_RATING[id];
    case 'straight_out':
      return hasChalk(n, 'wide_doubles') ? 8 : CHALK_RATING[id];
    case 'wide_grip':
    case 'tunnel_vision':
      return slateWidthWorth(n, id);
    default:
      return CHALK_RATING[id] ?? 4;
  }
}

/**
 * What widening or narrowing the offer is worth. An offer is a draw from the
 * contract pool and the Pot only funds a couple of them, so the extra contract
 * is worth the difference between the best two of four and the best two of
 * three — an order statistic, not an average.
 */
function slateWidthWorth(n: NightState, id: string): number {
  const leg = currentLeg(n);
  if (!leg) return CHALK_RATING[id] ?? 4;
  const ctx = legCtx(n, leg);
  const reading = readPlan(ctx, leg, scorerPlan(ctx), []);
  const evs = CONTRACTS.filter((c) => c.weight > 0).map((c) => {
    const p = reading.made.get(c.id) ?? 0;
    return Math.max(0, p * c.price - (1 - p) * c.stake);
  });
  const size = slateSize(n);
  const now = expectedTopK(evs, size, 2);
  const then = expectedTopK(evs, id === 'wide_grip' ? size + 1 : Math.max(1, size - 1), 2);
  // A night has a few dozen visits left in it; the difference lands on all of them.
  const perVisit = (then - now) * Math.max(4, (LEG_COUNT - n.legIndex) * 8);
  return id === 'wide_grip' ? Math.max(0, perVisit) : Math.max(0, perVisit) + (CHALK_RATING.tunnel_vision ?? 0);
}

interface Purchase {
  slot: number;
  opts: BuyOptions;
  worth: number;
  cost: number;
}

function bestPurchase(n: NightState): Purchase | null {
  const shop = n.shop;
  if (!shop) return null;
  let best: Purchase | null = null;
  const reserve = n.chalk.length < n.chalkSlots ? CHALK_RESERVE : 0;
  const consider = (p: Purchase) => {
    if (p.worth <= 0 || p.worth < p.cost) return;
    if (n.pot - p.cost < reserve && p.worth < p.cost * 2) return;
    if (!best || p.worth - p.cost > best.worth - best.cost) best = p;
  };
  shop.slots.forEach((slot, i) => {
    if (slot.sold || slot.cost > n.pot) return;
    switch (slot.kind) {
      case 'KIT': {
        if (n.kit.length >= KIT_CAP) return;
        // The third copy of a one-shot is worth less than the first: they are
        // spent one dart at a time and a night has only so many darts that matter.
        const held = kitCount(n, slot.defId);
        consider({ slot: i, opts: {}, worth: (KIT_RATING[slot.defId] ?? 1) / (1 + held * 0.6), cost: slot.cost });
        break;
      }
      case 'CHALK': {
        if (hasChalk(n, slot.chalkId)) return;
        const worth = chalkRating(n, slot.chalkId);
        if (worth <= 0) return;
        if (n.chalk.length < n.chalkSlots) {
          consider({ slot: i, opts: {}, worth, cost: slot.cost });
        } else {
          let weakest: Chalk | null = null;
          let weakestR = Infinity;
          for (const c of n.chalk) {
            const r = chalkRating(n, c.def.id, true);
            if (r < weakestR) {
              weakest = c;
              weakestR = r;
            }
          }
          if (weakest && worth > weakestR + 2) consider({ slot: i, opts: { replaceChalkId: weakest.def.id }, worth: worth - weakestR, cost: slot.cost });
        }
        break;
      }
      case 'SERVICE': {
        if (slot.service === 'STEADY') {
          if (n.kit.length >= KIT_CAP) return;
          consider({ slot: i, opts: {}, worth: KIT_RATING.steady / (1 + kitCount(n, 'steady') * 0.6), cost: slot.cost });
        } else if (slot.service === 'CREDIT') {
          // The publican's advance pays back double what it costs. There is no
          // decision here at all, which is worth saying out loud.
          consider({ slot: i, opts: {}, worth: SERVICE_COST.CREDIT * 2, cost: slot.cost });
        } else if (slot.service === 'ANOTHER_GO') {
          // A visit is worth roughly what a visit scores, and it is worth far
          // more on the tight legs at the end of the night than on the two
          // short games at the start.
          if (n.extraVisits >= ANOTHER_GO_CAP) return;
          const next = LEGS[Math.min(LEG_COUNT - 1, n.legIndex + 1)];
          const pressure = next.start / Math.max(1, next.visitLimit + n.extraVisits) / 100;
          consider({ slot: i, opts: {}, worth: VISIT_WORTH * pressure, cost: anotherGoCost(n.extraVisits) });
        } else {
          // Rubbing out a paid contract puts its price back up, which is only
          // worth anything once the house has shortened it more than once.
          const worst = Object.values(n.paid).sort((a, b) => b - a)[0] ?? 0;
          consider({ slot: i, opts: {}, worth: worst * 1.5, cost: slot.cost });
        }
        break;
      }
    }
  });
  return best;
}

/**
 * Spend the Pot. Chalk is the leverage and is bought over anything else that
 * clears its price; the kit is topped up with what is cheap; the offer is
 * refreshed once when the shelf is bare.
 */
export function botShop(n: NightState): void {
  if (n.phase !== 'SHOP' || !n.shop) return;
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

function slatePolicyOf(policy: Policy, opts: PlayOptions): SlatePolicy {
  if (opts.slate) return opts.slate;
  switch (policy) {
    case 'always_press':
      return 'ALWAYS_PRESS';
    case 'never_press':
      return 'NEVER_PRESS';
    case 'no_slate':
    case 'naive':
    case 'greedy':
    case 'checkout':
      return 'NO_SLATE';
    default:
      return 'PLAN';
  }
}

function chooseAction(n: NightState, leg: LegState, policy: Policy): Action {
  switch (policy) {
    case 'naive':
    case 'greedy':
      return naiveAction(n, leg);
    case 'checkout':
      return checkoutAction(n, leg);
    default:
      return planVisit(n, leg);
  }
}

/** Take contracts for the visit about to be thrown. */
function runSlate(n: NightState, leg: LegState, policy: SlatePolicy): void {
  if (policy === 'NO_SLATE') return;
  let ids = planSlate(n, leg);
  // A slate with nothing on it worth taking is what RUB OUT is for.
  if (ids.length === 0 && n.kit.includes('rubout') && leg.offer.length > 0) {
    if (useRubOut(n).ok) ids = planSlate(n, leg);
  }
  for (const id of ids) takeContract(n, id);
}

/** Do whatever this policy does with the money on the table between darts. */
function runPress(n: NightState, leg: LegState, policy: SlatePolicy): void {
  if (policy === 'NO_SLATE' || policy === 'NEVER_PRESS') return;
  if (policy === 'ALWAYS_PRESS') {
    // Greed with no judgement: press everything that can be pressed, every time.
    for (let guard = 0; guard < 8; guard++) {
      let did = false;
      for (let i = 0; i < leg.slate.length; i++) {
        if (pressable(n, leg, leg.slate[i]) && pressContract(n, i).ok) {
          did = true;
          break;
        }
      }
      if (!did) return;
    }
    return;
  }
  for (let guard = 0; guard < 8; guard++) {
    const act = planPress(n, leg);
    if (!act) return;
    const out = act.act === 'PULL' ? pullContract(n, act.index) : pressContract(n, act.index);
    if (!out.ok) return;
  }
}

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

export function playNight(seed: number, policy: Policy = 'optimal', opts: PlayOptions = {}): NightOutcome {
  const n = createNight(seed, opts.oche ?? 'local');
  if (opts.startLeg !== undefined) n.legIndex = Math.max(0, Math.min(LEG_COUNT - 1, opts.startLeg));
  for (const id of opts.startChalk ?? []) if (!hasChalk(n, id)) addChalk(n, id);
  const slate = slatePolicyOf(policy, opts);
  beginLeg(n);
  let throws = 0;
  for (let guard = 0; guard < 100000 && n.status === 'ACTIVE'; guard++) {
    if (n.phase === 'LEG') {
      const leg = currentLeg(n);
      const visit = currentVisit(leg);
      if (visit.throws.length === 0) runSlate(n, leg, slate);
      const action = chooseAction(n, leg, policy);
      if ('wall' in action) commitMiss(n);
      else commitThrow(n, action.target, action.use ? { use: action.use } : {});
      throws++;
      // Between darts only: the engine settles the slate itself when the visit ends.
      if (n.phase === 'LEG' && currentLeg(n) === leg && leg.status === 'ACTIVE' && currentVisit(leg) === visit) runPress(n, leg, slate);
    } else if (n.phase === 'SHOP') {
      if (opts.shop !== false && policy !== 'greedy') botShop(n);
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
    bestStreak: n.stats.bestStreak,
    chalkHeld: n.chalk.map((c) => c.def.id),
    seed,
    throws,
    legs: n.legs.map(legOutcome),
    lastLeg: n.legs.length ? n.legs[n.legs.length - 1].index : n.legIndex,
    potEarned: n.stats.potEarned,
    potSpent: n.stats.potSpent,
    potLeft: n.pot,
    contractsTaken: n.stats.contractsTaken,
    contractsPaid: n.stats.contractsPaid,
    contractsPressed: n.stats.contractsPressed,
    slatesWiped: n.stats.slatesWiped,
    potStaked: n.stats.potStaked,
    potWon: n.stats.potWon,
    kitHeld: n.kit.slice(),
  };
}

export function simulate(seeds: number[], policy: Policy = 'optimal', opts: PlayOptions = {}): SimResult {
  const outcomes = seeds.map((s) => playNight(s, policy, opts));
  const N = outcomes.length || 1;
  const won = new Array<number>(LEG_COUNT).fill(0);
  const reached = new Array<number>(LEG_COUNT).fill(0);
  let wins = 0;
  let busts = 0;
  let legsWon = 0;
  let throws = 0;
  let oneEighties = 0;
  let staked = 0;
  let potWon = 0;
  for (const o of outcomes) {
    if (o.status === 'WON') wins++;
    busts += o.busts;
    legsWon += o.legsWon;
    throws += o.throws;
    oneEighties += o.oneEighties;
    staked += o.potStaked;
    potWon += o.potWon;
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
    meanPotStaked: staked / N,
    meanPotWon: potWon / N,
    outcomes,
  };
}

/** Seeds 1..n, the convention used by the balance tool and tests. */
export function seedRange(n: number, from = 1): number[] {
  return Array.from({ length: n }, (_, i) => from + i);
}
