/**
 * Checkout routes (TDD §3.5), rebuilt for free aim.
 *
 * When the player was dealt their targets this had to search a hand. Now that
 * the whole board is available every dart, this is the real thing: the darts
 * finish table, computed through this night's actual pipeline so that chalk
 * changes it. Hot Twenty makes 170 reachable in different ways; Straight Out
 * removes the double entirely; Overshoot legalises finishes that would bust.
 *
 * Showing the route is deliberate. A press-your-luck decision is only a
 * decision if the player can see what they are giving up, and half the skill
 * of pub darts is knowing that 32 is a nice number and 33 is a horrible one.
 * The game should teach that rather than gate on it.
 */
import { ALL_TARGETS, baseValue, targetNotation } from './board';
import { resolveThrow, throwsPerVisitFor } from './resolver';
import type { LegState, NightState, Target } from './types';

export interface CheckoutRoute {
  /** Targets in throw order, e.g. T20, D20. */
  targets: Target[];
  /** What each throw resolves to after BOARD chalk, for display. */
  hits: Target[][];
}

export interface CheckoutHints {
  /** Shortest route from the current position, or null. */
  best: CheckoutRoute | null;
  /** Every route of the shortest length, most-likely-first. Up to 3. */
  routes: CheckoutRoute[];
  /** True if the score is within finishing range at all. */
  inRange: boolean;
}

/** Player-facing notation for a route: "T20 T20 D10". */
export function routeNotation(r: CheckoutRoute): string {
  return r.targets.map(targetNotation).join(' ');
}

/**
 * Candidates, ordered so the search finds the route a darts player would name
 * first: trebles then bull then doubles then singles, high to low. Order is
 * fixed, so the same score always yields the same route.
 */
const CANDIDATES: Target[] = (() => {
  const rank = (t: Target) => (t.region === 'T' ? 0 : t.region === 'IB' ? 1 : t.region === 'D' ? 2 : t.region === 'OB' ? 3 : 4);
  return ALL_TARGETS.slice().sort((a, b) => rank(a) - rank(b) || baseValue(b) - baseValue(a) || (a.bed ?? 0) - (b.bed ?? 0));
})();

/**
 * The largest score that could still be checked out: two maximum throws plus
 * the best finishing throw. On the base rules that is 60 + 60 + 50 = 170, the
 * folk maximum, and it grows on its own when chalk inflates values.
 */
function checkoutCeiling(n: NightState): number {
  let bestAny = 0;
  let bestFinisher = 0;
  for (const t of CANDIDATES) {
    for (const ti of [0, 1, 2, 3] as const) {
      const r = resolveThrow(t, {
        chalk: n.chalk,
        rng: null,
        scoreBefore: 1000,
        scoreAtVisitStart: 1000,
        visitThrowIndex: ti,
        forgivenessUsed: true,
      }).result;
      bestAny = Math.max(bestAny, r.totalValue);
      const last = r.hits[r.hits.length - 1];
      if (last && last.countsAsDouble) bestFinisher = Math.max(bestFinisher, r.totalValue);
    }
  }
  return bestAny * 2 + bestFinisher;
}

/**
 * Cache the ceiling per chalk set: it only moves when the build does. The key
 * starts as null rather than the empty string, because the empty string is the
 * real key of a night with no chalk — the commonest night there is.
 */
let ceilingKey: string | null = null;
let ceilingValue = 0;
function ceilingFor(n: NightState): number {
  const key = n.chalk.map((c) => c.def.id).sort().join(',');
  if (key !== ceilingKey) {
    ceilingKey = key;
    ceilingValue = checkoutCeiling(n);
  }
  return ceilingValue;
}

export function computeCheckoutHints(n: NightState, leg: LegState, maxDepth = 3): CheckoutHints {
  const visit = leg.visits[leg.visits.length - 1];
  const throwIndex = visit ? visit.throws.length : 0;
  const perVisit = throwsPerVisitFor(n.chalk);
  const darts = Math.min(maxDepth, perVisit - throwIndex);
  if (leg.score <= 0 || darts <= 0 || leg.score > ceilingFor(n)) {
    return { best: null, routes: [], inRange: false };
  }

  const memo = new Map<string, CheckoutRoute | null>();
  const found: CheckoutRoute[] = [];

  function throwAt(target: Target, score: number, ti: number) {
    return resolveThrow(target, {
      chalk: n.chalk,
      rng: null,
      scoreBefore: score,
      scoreAtVisitStart: score,
      visitThrowIndex: (ti % perVisit) as 0 | 1 | 2 | 3,
      forgivenessUsed: true,
    }).result;
  }

  /** Shortest route from `score` using exactly `depth` darts, or null. */
  function search(score: number, ti: number, depth: number, collect = false): CheckoutRoute | null {
    const key = `${score}|${ti}|${depth}`;
    if (!collect) {
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
    }
    let best: CheckoutRoute | null = null;
    for (const t of CANDIDATES) {
      const r = throwAt(t, score, ti);
      if (depth === 1) {
        if (r.outcome !== 'CHECKOUT') continue;
        const route = { targets: [t], hits: [r.hits.map((h) => h.target)] };
        if (collect && found.length < 3) found.push(route);
        if (!best) best = route;
        if (!collect) break;
        continue;
      }
      if (r.outcome !== 'CONTINUE') continue;
      const rest = search(r.scoreCommitted, ti + 1, depth - 1);
      if (!rest) continue;
      const route = { targets: [t, ...rest.targets], hits: [r.hits.map((h) => h.target), ...rest.hits] };
      if (collect && found.length < 3) found.push(route);
      if (!best) best = route;
      if (!collect) break;
    }
    if (!collect) memo.set(key, best);
    return best;
  }

  for (let d = 1; d <= darts; d++) {
    const hit = search(leg.score, throwIndex, d);
    if (hit) {
      found.length = 0;
      search(leg.score, throwIndex, d, true);
      return { best: found[0] ?? hit, routes: found.length ? found : [hit], inRange: true };
    }
  }
  return { best: null, routes: [], inRange: true };
}
