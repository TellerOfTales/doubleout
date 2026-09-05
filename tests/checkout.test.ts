/**
 * Checkout hints (TDD §3.5): the shortest finishing route from the current
 * score using the cards actually in this leg's pool, evaluated through the
 * real pipeline with the held chalk.
 */
import { describe, expect, it } from 'vitest';
import { computeCheckoutHints } from '../src/core/checkout.ts';
import { currentLeg, newCard } from '../src/core/state.ts';
import type { NightState } from '../src/core/types.ts';
import { resolve, startNight } from './helpers.ts';

/** Replace the leg pool with fresh cards of the given def ids (all in the deck) and set the score. */
function position(seed: number, score: number, pool: string[], chalk: string[] = [], hand: string[] = []): NightState {
  const n = startNight(seed, 'local', chalk);
  const leg = currentLeg(n);
  leg.deck = pool.map((d) => newCard(n, d));
  leg.discard = [];
  leg.hand = hand.map((d) => newCard(n, d));
  leg.score = score;
  leg.visits[0].scoreAtVisitStart = score;
  return n;
}

function best(seed: number, score: number, pool: string[], chalk: string[] = []): string[] | null {
  const n = position(seed, score, pool, chalk);
  const h = computeCheckoutHints(n, currentLeg(n));
  return h.best ? h.best.defIds : null;
}

describe('single-dart finishes', () => {
  it('from 32 with a D16 in the pool → [d16]', () => {
    expect(best(1, 32, ['s20', 's5', 'd16', 't20'])).toEqual(['d16']);
  });
  it('from 40 with only S20 and D20 → [d20]', () => {
    expect(best(1, 40, ['s20', 'd20'])).toEqual(['d20']);
  });
  it('from 50 with the bull → [ib]', () => {
    expect(best(1, 50, ['s20', 'ib', 'd20'])).toEqual(['ib']);
  });
  it('from 2 with D1 → [d1]', () => {
    expect(best(1, 2, ['s1', 'd1'])).toEqual(['d1']);
  });
  it('a one-dart finish is preferred to a two-dart finish', () => {
    // 40: d20 in one, or s20 + d10 in two
    expect(best(1, 40, ['s20', 'd10', 'd20'])).toEqual(['d20']);
  });
  it('the route records the resolved targets it hits', () => {
    const n = position(1, 32, ['d16', 's20']);
    const h = computeCheckoutHints(n, currentLeg(n));
    expect(h.best?.hits).toEqual([[{ region: 'D', bed: 16 }]]);
    expect(h.inRange).toBe(true);
  });
});

describe('two- and three-dart finishes', () => {
  it('from 100 with T20 and D20 → [t20, d20]', () => {
    expect(best(1, 100, ['t20', 'd20'])).toEqual(['t20', 'd20']);
  });
  it('from 170 with T20 and the bull → [t20, t20, ib]', () => {
    expect(best(1, 170, ['t20', 'ib'])).toEqual(['t20', 't20', 'ib']);
  });
  it('from 170 without the bull there is no route', () => {
    expect(best(1, 170, ['t20', 'd20', 'd16', 's20'])).toBeNull();
  });
  it('from 3 with no D1 → null (in range, no route)', () => {
    const n = position(1, 3, ['t20', 'ib', 's1', 'd2', 's20']);
    const h = computeCheckoutHints(n, currentLeg(n));
    expect(h.best).toBeNull();
    expect(h.inRange).toBe(true);
  });
  it('from 3 with S1 and D1 → [s1, d1]', () => {
    expect(best(1, 3, ['s1', 'd1'])).toEqual(['s1', 'd1']);
  });
  it('from 1 nothing finishes', () => {
    expect(best(1, 1, ['s1', 'd1', 'd20'])).toBeNull();
  });
  it('the route never passes through a bust or a dead number', () => {
    // 61 with only T20/S1/D20: T20 leaves 1 (bust). S1 → 60 → T20 busts (non-double zero) → S1 → 59... no.
    // With D20 too: 61 = S1 + D20 + D10? no D10. So: null.
    expect(best(1, 61, ['t20', 's1', 'd20'])).toBeNull();
    // 61 = T15 + D8 → route
    expect(best(1, 61, ['t15', 'd8', 's1'])).toEqual(['t15', 'd8']);
  });
  it('the reference maximum: every score 2..170 that the base rules can finish gets a route from a full board pool', () => {
    const fullPool: string[] = [];
    for (let b = 1; b <= 20; b++) fullPool.push(`s${b}`, `d${b}`, `t${b}`);
    fullPool.push('ob', 'ib');
    const n = position(1, 170, fullPool);
    const leg = currentLeg(n);
    const missing: number[] = [];
    for (let s = 2; s <= 170; s++) {
      leg.score = s;
      leg.visits[0].scoreAtVisitStart = s;
      const h = computeCheckoutHints(n, leg);
      if (!h.best) missing.push(s);
      else expect(h.best.defIds.length).toBeLessThanOrEqual(3);
    }
    expect(missing).toEqual([159, 162, 163, 165, 166, 168, 169]);
  });
});

describe('byHandCard', () => {
  it('marks the hand card that starts a route and nulls the rest', () => {
    const n = position(1, 100, ['t20', 'd20', 's5'], [], ['d20', 's5', 't20']);
    const leg = currentLeg(n);
    const h = computeCheckoutHints(n, leg);
    expect(h.byHandCard.size).toBe(3);
    const byDef = new Map(leg.hand.map((c) => [c.defId, h.byHandCard.get(c.id)]));
    expect(byDef.get('t20')?.defIds).toEqual(['t20', 'd20']);
    expect(byDef.get('d20')).toBeNull();
    expect(byDef.get('s5')).toBeNull();
    expect(h.best?.defIds).toEqual(['t20', 'd20']);
  });
  it('a hand card that finishes outright is a one-card route', () => {
    const n = position(1, 40, ['t20', 'd20', 's20'], [], ['s20', 'd20']);
    const leg = currentLeg(n);
    const h = computeCheckoutHints(n, leg);
    const byDef = new Map(leg.hand.map((c) => [c.defId, h.byHandCard.get(c.id)]));
    expect(byDef.get('d20')?.defIds).toEqual(['d20']);
    // S20 leaves 20 and there is no D10 in this pool
    expect(byDef.get('s20')).toBeNull();
  });
  it('has an entry for every hand card, even out of range', () => {
    const n = position(1, 501, ['t20', 'd20'], [], ['t20', 'd20', 's20']);
    const leg = currentLeg(n);
    const h = computeCheckoutHints(n, leg);
    expect(h.inRange).toBe(false);
    expect(h.byHandCard.size).toBe(3);
    for (const c of leg.hand) expect(h.byHandCard.get(c.id)).toBeNull();
  });
  it('routes starting from a hand card use the pool for the later darts', () => {
    const n = position(1, 100, ['t20', 'd20'], [], ['t20']);
    const leg = currentLeg(n);
    const h = computeCheckoutHints(n, leg);
    expect(h.byHandCard.get(leg.hand[0].id)?.defIds).toEqual(['t20', 'd20']);
  });
});

describe('hints respect chalk', () => {
  it('straight_out makes single finishes legal: from 20 with S20 → [s20]', () => {
    expect(best(1, 20, ['s20', 't20'], ['straight_out'])).toEqual(['s20']);
    expect(best(1, 20, ['s20', 't20'])).toBeNull();
  });
  it('cold_hands at throw index 0: the route starts with a 0-value throw and finishes on the doubled dart', () => {
    const n = position(1, 40, ['s20', 't20', 'd10', 'd20'], ['cold_hands']);
    const h = computeCheckoutHints(n, currentLeg(n));
    expect(h.best).not.toBeNull();
    const route = h.best?.defIds as string[];
    expect(route).toHaveLength(2);
    expect(route[1]).toBe('d10'); // 20 × 2 = 40 on the second dart
    expect(resolve(route[0], 40, ['cold_hands'], { throwIndex: 0 }).totalValue).toBe(0);
    // and d20 in one dart is impossible because the first dart of the visit is ×0
    expect(route).not.toEqual(['d20']);
  });
  it('cold_hands at throw index 1: the doubled dart finishes in one', () => {
    const n = position(1, 40, ['s20', 'd10', 'd20'], ['cold_hands']);
    const leg = currentLeg(n);
    leg.visits[0].throws.push(resolve('s1', 41, ['cold_hands']));
    const h = computeCheckoutHints(n, leg);
    expect(h.best?.defIds).toEqual(['d10']);
  });
  it('feathered: a double scores ×3 but still finishes (from 60 with D20 → [d20])', () => {
    expect(best(1, 60, ['d20', 't20'], ['feathered'])).toEqual(['d20']);
    expect(best(1, 40, ['d20', 't20'], ['feathered'])).toBeNull();
  });
  it('mirrored: the route is expressed in cards and the hits show where they land', () => {
    const n = position(1, 6, ['d20', 's20'], ['mirrored']);
    const h = computeCheckoutHints(n, currentLeg(n));
    expect(h.best?.defIds).toEqual(['d20']);
    expect(h.best?.hits).toEqual([[{ region: 'D', bed: 3 }]]);
  });
  it('wide_doubles: S20 finishes 20', () => {
    expect(best(1, 20, ['s20', 't20'], ['wide_doubles'])).toEqual(['s20']);
  });
  it('split_tips: the split single is the last hit, so a lone double does not finish', () => {
    // D20 + S5 = 45 from 45: exact zero on S5 → bust. From 45 with split_tips no one-dart route.
    const n = position(1, 45, ['d20', 's5', 's20'], ['split_tips']);
    const h = computeCheckoutHints(n, currentLeg(n));
    expect(h.best?.defIds ?? null).not.toEqual(['d20']);
  });
  it('wired never deflects inside the hint search (rng is null): from 32 with D16 → [d16]', () => {
    const n = position(1, 32, ['d16', 's20'], ['wired']);
    const before = n.rng.s;
    expect(computeCheckoutHints(n, currentLeg(n)).best?.defIds).toEqual(['d16']);
    expect(n.rng.s).toBe(before);
  });
  it('heavy_tips shifts every value: from 45 with D20 → [d20] (40 + 5)', () => {
    expect(best(1, 45, ['d20', 's20'], ['heavy_tips'])).toEqual(['d20']);
    expect(best(1, 40, ['d20', 's20'], ['heavy_tips'])).toBeNull();
  });
});

describe('range', () => {
  it('a score far beyond reach → inRange false, best null', () => {
    const n = position(1, 501, ['t20', 'd20', 'ib']);
    const h = computeCheckoutHints(n, currentLeg(n));
    expect(h.inRange).toBe(false);
    expect(h.best).toBeNull();
  });
  it('170 is in range with a plain pool; 171 is not (60 + 60 + bull is the folk maximum)', () => {
    expect(computeCheckoutHints(...pair(170)).inRange).toBe(true);
    expect(computeCheckoutHints(...pair(171)).inRange).toBe(false);
    expect(computeCheckoutHints(...pair(180)).inRange).toBe(false);
  });
  it('the range grows with value chalk (two scoring darts plus the best finisher)', () => {
    // hot_twenty + heavy_tips: T20 = 85 and D20 = 45, so 85 + 85 + 45 = 215 is the ceiling
    const n = position(1, 210, ['t20', 'd20'], ['hot_twenty', 'heavy_tips']);
    expect(computeCheckoutHints(n, currentLeg(n)).inRange).toBe(true);
    const m = position(1, 216, ['t20', 'd20'], ['hot_twenty', 'heavy_tips']);
    expect(computeCheckoutHints(m, currentLeg(m)).inRange).toBe(false);
  });
  it('a checked-out leg (score 0) is out of range', () => {
    const n = position(1, 0, ['t20', 'd20']);
    const h = computeCheckoutHints(n, currentLeg(n));
    expect(h.inRange).toBe(false);
    expect(h.best).toBeNull();
  });
  it('an empty pool is out of range', () => {
    const n = position(1, 40, []);
    const h = computeCheckoutHints(n, currentLeg(n));
    expect(h.inRange).toBe(false);
  });
  function pair(score: number): [NightState, ReturnType<typeof currentLeg>] {
    const n = position(1, score, ['t20', 'd20', 'ib']);
    return [n, currentLeg(n)];
  }
});

describe('the search is deterministic', () => {
  it('the same position always yields the same route', () => {
    const a = best(1, 100, ['t20', 'd20', 's20', 't16', 'd18', 'd12']);
    const b = best(2, 100, ['s20', 'd12', 'd18', 't20', 'd20', 't16']);
    expect(a).toEqual(b);
    expect(a).toEqual(['t20', 'd20']);
  });
  it('does not consume the gameplay RNG', () => {
    const n = position(1, 100, ['t20', 'd20', 's20'], ['wired', 'split_tips']);
    const before = n.rng.s;
    computeCheckoutHints(n, currentLeg(n));
    expect(n.rng.s).toBe(before);
  });
});
