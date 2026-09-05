/**
 * Checkout hints (TDD §3.5). For a remaining score within reach, find the
 * shortest finishing route using cards the player actually holds in this
 * leg's pool, evaluated through the real pipeline (without wired deflection).
 */
import { cardDef } from '../content/cards';
import { legPool } from './deck';
import { resolveThrow, throwsPerVisitFor } from './resolver';
import type { DartCard, LegState, NightState, Target } from './types';

export interface CheckoutRoute {
  /** Card def ids in throw order, e.g. ["t20", "d20"]. */
  defIds: string[];
  /** Resolved targets actually hit (after BOARD chalk), for display. */
  hits: Target[][];
}

export interface CheckoutHints {
  /** Shortest route overall from the current position, or null. */
  best: CheckoutRoute | null;
  /** For each card in hand: the shortest route that begins with it, or null. */
  byHandCard: Map<string, CheckoutRoute | null>;
  /** True if the score is within the range where hints are computed. */
  inRange: boolean;
}

/**
 * The largest score that could still be checked out: two maximum-scoring
 * throws plus the best finishing throw. With the base deck that is
 * 60 + 60 + 50 = 170, the folk maximum, exactly as the TDD requires; it
 * grows on its own when chalk inflates values.
 */
function checkoutCeiling(n: NightState, defs: DartCard[]): number {
  let bestAny = 0;
  let bestFinisher = 0;
  for (const c of defs) {
    for (const ti of [0, 1, 2, 3] as const) {
      const r = resolveThrow(c, {
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

function distinctDefs(leg: LegState): DartCard[] {
  const seen = new Map<string, DartCard>();
  for (const c of legPool(leg)) if (!seen.has(c.defId)) seen.set(c.defId, c);
  // Deterministic order: by value descending then id, so ties resolve the same way every time.
  return [...seen.values()].sort((a, b) => cardDef(b.defId).value - cardDef(a.defId).value || a.defId.localeCompare(b.defId));
}

export function computeCheckoutHints(n: NightState, leg: LegState, maxDepth = 3): CheckoutHints {
  const visit = leg.visits[leg.visits.length - 1];
  const throwIndex = visit ? visit.throws.length : 0;
  const perVisit = throwsPerVisitFor(n.chalk);
  const defs = distinctDefs(leg);
  const byHandCard = new Map<string, CheckoutRoute | null>();
  const threshold = checkoutCeiling(n, defs);
  if (leg.score > threshold || leg.score <= 0 || defs.length === 0) {
    for (const c of leg.hand) byHandCard.set(c.id, null);
    return { best: null, byHandCard, inRange: false };
  }

  const memo = new Map<string, CheckoutRoute | null>();

  // Shortest route from `score` with `depth` throws left, throw index `ti`.
  function search(score: number, ti: number, depth: number, restrictFirst?: DartCard): CheckoutRoute | null {
    const key = `${score}|${ti}|${depth}|${restrictFirst?.defId ?? ''}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best: CheckoutRoute | null = null;
    const candidates = restrictFirst ? [restrictFirst] : defs;
    // Iterative deepening: try 1-throw finishes first, then longer.
    for (let d = 1; d <= depth && !best; d++) {
      for (const c of candidates) {
        const r = resolveThrow(c, {
          chalk: n.chalk,
          rng: null,
          scoreBefore: score,
          scoreAtVisitStart: score,
          visitThrowIndex: (ti % perVisit) as 0 | 1 | 2 | 3,
          forgivenessUsed: true,
        }).result;
        if (r.outcome === 'CHECKOUT') {
          if (d === 1) {
            best = { defIds: [c.defId], hits: [r.hits.map((h) => h.target)] };
            break;
          }
          continue;
        }
        if (r.outcome !== 'CONTINUE' || d === 1) continue;
        const rest = search(r.scoreCommitted, ti + 1, d - 1);
        if (rest && rest.defIds.length === d - 1) {
          best = { defIds: [c.defId, ...rest.defIds], hits: [r.hits.map((h) => h.target), ...rest.hits] };
          break;
        }
      }
    }
    memo.set(key, best);
    return best;
  }

  const best = search(leg.score, throwIndex, maxDepth);
  for (const c of leg.hand) byHandCard.set(c.id, search(leg.score, throwIndex, maxDepth, c));
  return { best, byHandCard, inRange: true };
}
