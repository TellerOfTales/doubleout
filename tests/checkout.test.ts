/**
 * Checkout routes (TDD §3.5), rebuilt for free aim.
 *
 * There is no pool of dealt cards to search any more: the whole board is
 * available every dart, so this is the darts finish table itself, computed
 * through the night's own pipeline so that chalk moves it. The route is shown
 * to the player on purpose — half the skill of pub darts is knowing that 32 is
 * a nice number and 33 is a horrible one, and the game teaches that rather
 * than gating on it (docs/decisions/design.md §4).
 */
import { describe, expect, it } from 'vitest';
import { targetNotation } from '../src/core/board.ts';
import { computeCheckoutHints, routeNotation } from '../src/core/checkout.ts';
import { currentLeg, currentVisit } from '../src/core/state.ts';
import type { LegState, NightState } from '../src/core/types.ts';
import { resolve, startNight } from './helpers.ts';

/** A night parked at `score` with `chalk` held and `thrown` darts already gone this visit. */
function position(score: number, chalk: string[] = [], thrown = 0): NightState {
  const n = startNight(1, 'local', chalk);
  const leg = currentLeg(n);
  const visit = currentVisit(leg);
  for (let i = 0; i < thrown; i++) visit.throws.push(resolve('S1', 500 + i, chalk, { throwIndex: i as 0 | 1 | 2 }));
  leg.score = score;
  visit.scoreAtVisitStart = score;
  return n;
}

function hints(score: number, chalk: string[] = [], thrown = 0) {
  const n = position(score, chalk, thrown);
  return computeCheckoutHints(n, currentLeg(n));
}

/** The shortest route from a score, in darts notation: "T20 D20". */
function best(score: number, chalk: string[] = [], thrown = 0): string | null {
  const h = hints(score, chalk, thrown);
  return h.best ? routeNotation(h.best) : null;
}

const pair = (n: NightState): [NightState, LegState] => [n, currentLeg(n)];

describe('single-dart finishes', () => {
  it('from 32 the route is D16, the number every darts player wants', () => {
    expect(best(32)).toBe('D16');
  });
  it('from 40 it is D20, from 2 it is D1', () => {
    expect(best(40)).toBe('D20');
    expect(best(2)).toBe('D1');
  });
  it('from 50 it is the bull', () => {
    expect(best(50)).toBe('BULL');
  });
  it('every even number to 40 finishes in one dart, on its own double', () => {
    for (let d = 1; d <= 20; d++) expect(best(d * 2), `from ${d * 2}`).toBe(`D${d}`);
  });
  it('a one-dart finish always beats a two-dart one', () => {
    for (const s of [32, 40, 36, 24, 50]) expect(hints(s).best?.targets).toHaveLength(1);
  });
  it('the route records what each dart resolves to', () => {
    const h = hints(32);
    expect(h.best?.hits).toEqual([[{ region: 'D', bed: 16 }]]);
    expect(h.inRange).toBe(true);
  });
});

describe('two- and three-dart finishes', () => {
  it('from 100: T20 then D20', () => {
    expect(best(100)).toBe('T20 D20');
  });
  it('from 170: the big fish, T20 T20 BULL', () => {
    expect(best(170)).toBe('T20 T20 BULL');
  });
  it('from 60 the treble twenty is a bust, so the table takes a different road', () => {
    const route = hints(60).best;
    expect(route?.targets).toHaveLength(2);
    expect(routeNotation(route!)).not.toContain('T20 ');
    // whatever it picks, it must actually finish
    const first = resolve(route!.targets[0], 60);
    expect(first.outcome).toBe('CONTINUE');
    expect(resolve(route!.targets[1], first.scoreCommitted, [], { throwIndex: 1 }).outcome).toBe('CHECKOUT');
  });
  it('from 3 the road is S1 then D1: free aim can always find the odd number', () => {
    expect(best(3)).toBe('S1 D1');
  });
  it('a bogey number is in range and still has no route: 159 cannot be done', () => {
    const h = hints(159);
    expect(h.best).toBeNull();
    expect(h.routes).toEqual([]);
    expect(h.inRange).toBe(true);
  });
  it('from 1 nothing finishes', () => {
    expect(best(1)).toBeNull();
  });
  it('the route never passes through a bust or a dead number', () => {
    for (let s = 2; s <= 170; s++) {
      const route = hints(s).best;
      if (!route) continue;
      let score = s;
      route.targets.forEach((t, i) => {
        const r = resolve(t, score, [], { throwIndex: i as 0 | 1 | 2 });
        expect(r.outcome, `${s} via ${routeNotation(route)} dart ${i + 1}`).toBe(i === route.targets.length - 1 ? 'CHECKOUT' : 'CONTINUE');
        score = r.scoreCommitted;
      });
      expect(score).toBe(0);
    }
  });
  it('the reference maximum: every score 2..170 the base rules can finish gets a route in three darts', () => {
    const missing: number[] = [];
    for (let s = 2; s <= 170; s++) {
      const h = hints(s);
      if (!h.best) missing.push(s);
      else expect(h.best.targets.length, `from ${s}`).toBeLessThanOrEqual(3);
    }
    expect(missing).toEqual([159, 162, 163, 165, 166, 168, 169]);
  });
});

describe('the darts already thrown shorten the route', () => {
  it('with one dart left, only a one-dart finish counts', () => {
    expect(best(32, [], 2)).toBe('D16');
    expect(best(100, [], 2)).toBeNull();
    expect(hints(100, [], 2).inRange).toBe(true);
  });
  it('with two darts left, two-dart finishes are back', () => {
    expect(best(100, [], 1)).toBe('T20 D20');
    expect(best(170, [], 1)).toBeNull();
  });
  it('with no darts left there is nothing to plan', () => {
    const h = hints(32, [], 3);
    expect(h.best).toBeNull();
    expect(h.routes).toEqual([]);
    expect(h.inRange).toBe(false);
  });
  it('fourth_dart gives the route another dart', () => {
    expect(best(170, ['fourth_dart'], 1)).toBe('T20 T20 BULL');
  });
});

describe('the alternatives', () => {
  it('routes are all of the shortest length, best first, at most three of them', () => {
    const h = hints(100);
    expect(h.routes.length).toBeGreaterThan(1);
    expect(h.routes.length).toBeLessThanOrEqual(3);
    expect(h.routes[0]).toEqual(h.best);
    for (const r of h.routes) expect(r.targets).toHaveLength(h.best!.targets.length);
    expect(new Set(h.routes.map(routeNotation)).size).toBe(h.routes.length);
  });
  it('a one-dart finish lists only the doubles that do it', () => {
    const h = hints(40);
    for (const r of h.routes) {
      expect(r.targets).toHaveLength(1);
      expect(resolve(r.targets[0], 40).outcome).toBe('CHECKOUT');
    }
  });
  it('every listed route really finishes', () => {
    for (const s of [170, 141, 100, 81, 60, 32, 8]) {
      for (const r of hints(s).routes) {
        let score = s;
        r.targets.forEach((t, i) => {
          score = resolve(t, score, [], { throwIndex: i as 0 | 1 | 2 }).scoreCommitted;
        });
        expect(score, `${s} via ${routeNotation(r)}`).toBe(0);
      }
    }
  });
});

describe('hints respect chalk', () => {
  it('straight_out: any exact zero finishes, so 60 is one dart', () => {
    expect(best(60, ['straight_out'])).toBe('T20');
    expect(best(60)).not.toBe('T20');
  });
  it('wide_doubles: anything in the 20 bed finishes, so T20 takes 60 out', () => {
    expect(best(60, ['wide_doubles'])).toBe('T20');
  });
  it('feathered: a double scores ×3 and still counts as a double', () => {
    expect(best(60, ['feathered'])).toBe('D20');
    expect(best(40, ['feathered'])).not.toBe('D20');
  });
  it('heavy_tips shifts every value: 45 comes out on D20 (40 + 5)', () => {
    expect(best(45, ['heavy_tips'])).toBe('D20');
    expect(best(40, ['heavy_tips'])).not.toBe('D20');
  });
  it('hot_twenty stretches the table: the treble twenty is 80, so 130 comes out in two', () => {
    expect(hints(180, ['hot_twenty']).inRange).toBe(true);
    expect(best(130, ['hot_twenty'])).toBe('T20 BULL');
    expect(best(130)).not.toBe('T20 BULL');
  });
  it('cold_hands: the first dart of the visit scores nothing, so the route spends it', () => {
    const h = hints(40, ['cold_hands']);
    const route = h.best!;
    expect(route.targets).toHaveLength(2);
    expect(resolve(route.targets[0], 40, ['cold_hands'], { throwIndex: 0 }).totalValue).toBe(0);
    expect(resolve(route.targets[1], 40, ['cold_hands'], { throwIndex: 1 }).outcome).toBe('CHECKOUT');
  });
  it('cold_hands on the second dart: the doubled dart finishes in one', () => {
    expect(best(40, ['cold_hands'], 1)).toBe('D10');
  });
  it('mirrored: the route is expressed in where you aim, the hits show where it lands', () => {
    const h = hints(6, ['mirrored']);
    const route = h.best!;
    expect(route.targets).toHaveLength(1);
    const landed = route.hits[0][0];
    expect(targetNotation(landed)).not.toBe(targetNotation(route.targets[0]));
    expect(resolve(route.targets[0], 6, ['mirrored']).outcome).toBe('CHECKOUT');
  });
  it('split_tips: the split single is the last hit, so a lone double does not finish an exact zero', () => {
    // D20 + S5 = 45 from 45 lands exactly on zero, but on a single: a bust.
    expect(resolve('D20', 45, ['split_tips']).outcome).toBe('BUST');
    const route = hints(45, ['split_tips']).best;
    expect(route ? routeNotation(route) : null).not.toBe('D20');
  });
  it('wired never deflects inside the search, and the search never touches the gameplay RNG', () => {
    const n = position(32, ['wired']);
    const before = n.rng.s;
    expect(routeNotation(computeCheckoutHints(n, currentLeg(n)).best!)).toBe('D16');
    expect(n.rng.s).toBe(before);
  });
});

describe('range', () => {
  it('170 is in range with the base rules; 171 and up are not', () => {
    expect(computeCheckoutHints(...pair(position(170))).inRange).toBe(true);
    expect(computeCheckoutHints(...pair(position(171))).inRange).toBe(false);
    expect(computeCheckoutHints(...pair(position(501))).inRange).toBe(false);
  });
  it('a checked-out leg (score 0) is out of range', () => {
    const h = hints(0);
    expect(h.inRange).toBe(false);
    expect(h.best).toBeNull();
  });
  it('the range grows with value chalk: two scoring darts plus the best finisher', () => {
    // hot_twenty then heavy_tips: T20 = 80 + 5 = 85, and the best finisher is
    // the bull at 50 + 5 = 55, so the ceiling is 85 + 85 + 55 = 225.
    const chalk = ['hot_twenty', 'heavy_tips'];
    expect(computeCheckoutHints(...pair(position(225, chalk))).inRange).toBe(true);
    expect(computeCheckoutHints(...pair(position(226, chalk))).inRange).toBe(false);
    // and the base ceiling is the folk maximum, 60 + 60 + 50
    expect(computeCheckoutHints(...pair(position(170))).inRange).toBe(true);
  });
  it('out of range means no routes at all', () => {
    const h = hints(300);
    expect(h.routes).toEqual([]);
    expect(h.best).toBeNull();
  });
});

describe('the search is deterministic', () => {
  it('the same position always yields the same route, whatever the seed', () => {
    const a = computeCheckoutHints(...pair(startNightAt(1, 141)));
    const b = computeCheckoutHints(...pair(startNightAt(999, 141)));
    expect(routeNotation(a.best!)).toBe(routeNotation(b.best!));
    expect(a.routes.map(routeNotation)).toEqual(b.routes.map(routeNotation));
  });
  it('computing the hints twice changes nothing', () => {
    const n = position(100);
    const first = computeCheckoutHints(n, currentLeg(n));
    const second = computeCheckoutHints(n, currentLeg(n));
    expect(second).toEqual(first);
    expect(currentLeg(n).score).toBe(100);
  });

  function startNightAt(seed: number, score: number): NightState {
    const n = startNight(seed);
    const leg = currentLeg(n);
    leg.score = score;
    currentVisit(leg).scoreAtVisitStart = score;
    return n;
  }
});
