/**
 * THE AIM — docs/decisions/design.md §5.2 and §5.3.
 *
 * Free aim gave the player back the only decision darts has: where to throw.
 * That decision is only a decision if the odds are honest and legible, and if
 * the safe end of the board is genuinely safe. This file pins the model:
 *
 *   - every landing spread is a probability distribution (it sums to one);
 *   - a single is near certain, a treble is a real gamble, and no amount of
 *     steadiness may flatten the gap between them — the risk dial;
 *   - the interventions bend the spread in exactly the ways they say they do.
 */
import { describe, expect, it } from 'vitest';
import { ALL_TARGETS, parseTarget, targetNotation } from '../src/core/board.ts';
import {
  AIM_BASE,
  AIM_CAP,
  STEADY_INTERVENTION,
  STEADY_MAX,
  STEADY_PER_HEAT,
  hitChance,
  landingDistribution,
  resolveThrow,
  rollLanding,
  spreadFor,
  withoutTheWall,
} from '../src/core/resolver.ts';
import { createRng } from '../src/core/rng.ts';
import { HEAT_CAP } from '../src/content/legs.ts';
import type { Landing } from '../src/core/resolver.ts';
import { mkChalk, resolve } from './helpers.ts';

/** Steadiness values worth checking: none, a warm crowd, the kit, and absurdity. */
const STEADINESS = [0, 1, 4, 8, 12, 16, 24, 25, 30, 45, 100, -5, -1000];

const total = (dist: Landing[]) => dist.reduce((a, l) => a + l.p, 0);
const at = (dist: Landing[], notation: string) => dist.find((l) => targetNotation(l.target) === notation);

/** The most steadiness the game can ever put behind one dart. */
const MAX_STEADINESS = HEAT_CAP * STEADY_PER_HEAT + 8 + STEADY_INTERVENTION;

// ---------------------------------------------------------------- it is a distribution

describe('every landing spread is a probability distribution', () => {
  it('sums to 1 for all 62 targets at every steadiness', () => {
    const bad: string[] = [];
    for (const t of ALL_TARGETS) {
      for (const s of STEADINESS) {
        const sum = total(landingDistribution(t, s));
        if (Math.abs(sum - 1) > 1e-9) bad.push(`${targetNotation(t)} @${s}: ${sum}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every landing has a non-negative chance and no spot is listed twice', () => {
    for (const t of ALL_TARGETS) {
      for (const s of [0, 12, 30]) {
        const dist = landingDistribution(t, s);
        const names = dist.map((l) => targetNotation(l.target));
        expect(new Set(names).size, `${targetNotation(t)} @${s}: ${names}`).toBe(names.length);
        for (const l of dist) expect(l.p, `${targetNotation(t)} → ${targetNotation(l.target)}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('the aimed target comes first, is the "hit", and carries exactly its hit chance', () => {
    for (const t of ALL_TARGETS) {
      for (const s of [0, 9, 30, 100]) {
        const dist = landingDistribution(t, s);
        expect(dist[0].kind).toBe('hit');
        expect(targetNotation(dist[0].target)).toBe(targetNotation(t));
        expect(dist[0].p).toBeCloseTo(hitChance(t, s) / 100, 12);
      }
    }
  });

  it('the miss mass is exactly what the hit chance left over', () => {
    for (const t of ALL_TARGETS) {
      const dist = landingDistribution(t, 7);
      const miss = total(dist.slice(1));
      expect(miss).toBeCloseTo(1 - hitChance(t, 7) / 100, 12);
    }
  });

  it('a certainty has no miss mass at all: the wall is a single outcome', () => {
    expect(landingDistribution({ region: 'W' })).toEqual([{ target: { region: 'W' }, p: 1, kind: 'wall' }]);
    expect(hitChance({ region: 'W' })).toBe(100);
  });
});

// ---------------------------------------------------------------- the risk dial (§5.2)

describe('the risk dial: the safe end is safe and the paying end is not', () => {
  it('the base chances rank single > double > treble, with the bull the hardest of all', () => {
    expect(AIM_BASE.S).toBeGreaterThan(AIM_BASE.OB);
    expect(AIM_BASE.OB).toBeGreaterThan(AIM_BASE.D);
    expect(AIM_BASE.D).toBeGreaterThan(AIM_BASE.T);
    expect(AIM_BASE.T).toBeGreaterThan(AIM_BASE.IB);
  });

  it('a single is at least 95% to land, at any steadiness, on every bed', () => {
    for (const t of ALL_TARGETS) {
      if (t.region !== 'S') continue;
      for (const s of STEADINESS) {
        expect(hitChance(t, s), `S${t.bed} @${s}`).toBeGreaterThanOrEqual(95);
        expect(landingDistribution(t, s)[0].p, `S${t.bed} @${s}`).toBeGreaterThanOrEqual(0.95);
      }
    }
  });

  /**
   * design.md §5.2: "A treble is a real gamble." The gap between the safe
   * single and the paying treble IS the game's risk dial, so no amount of
   * steadiness may flatten it. A treble the player can lift into the
   * three-quarters is not a gamble any more, and the visit answers itself
   * again — which is the failure the whole rebuild exists to undo.
   */
  it('a treble is at most 60% to land, even with every point of steadiness the game can give', () => {
    const over: string[] = [];
    for (const t of ALL_TARGETS) {
      if (t.region !== 'T') continue;
      for (const s of [0, 16, 24, STEADY_MAX, MAX_STEADINESS, 1000]) {
        if (hitChance(t, s) > 60) over.push(`T${t.bed} @${s} = ${hitChance(t, s)}%`);
        // and the gap to the safe dart stays a gap the player can feel
        if (hitChance(parseTarget(`S${t.bed}`), s) - hitChance(t, s) < 35) over.push(`S${t.bed}−T${t.bed} @${s} = ${hitChance(parseTarget(`S${t.bed}`), s) - hitChance(t, s)} points`);
      }
    }
    // AIM_BASE.T + STEADY_MAX is the ceiling the tuning actually allows.
    expect(over.slice(0, 4), `AIM_BASE.T ${AIM_BASE.T} + STEADY_MAX ${STEADY_MAX} = ${AIM_BASE.T + STEADY_MAX}%`).toEqual([]);
  });

  /**
   * Steadiness closes a fraction of the gap between a target and certainty
   * rather than adding a flat number of points. A flat addition is what let a
   * treble reach three quarters, which flattens the risk dial; proportionally,
   * the same points are worth a lot on the bull and almost nothing on a single
   * you were going to hit anyway.
   */
  it('steadiness closes a fraction of the gap to certainty, capped by STEADY_MAX and AIM_CAP', () => {
    for (const t of ALL_TARGETS) {
      const base = AIM_BASE[t.region as Exclude<typeof t.region, 'W'>];
      for (const s of STEADINESS) {
        const points = Math.min(STEADY_MAX, Math.max(0, s));
        expect(hitChance(t, s), `${targetNotation(t)} @${s}`).toBeCloseTo(Math.min(AIM_CAP, base + (points * (100 - base)) / 100), 9);
      }
    }
  });

  it('the same steadiness is worth most where there is most to gain', () => {
    const gain = (t: string) => hitChance(parseTarget(t), STEADY_MAX) - hitChance(parseTarget(t), 0);
    expect(gain('BULL')).toBeGreaterThan(gain('T20'));
    expect(gain('T20')).toBeGreaterThan(gain('D20'));
    expect(gain('D20')).toBeGreaterThan(gain('S20'));
    expect(gain('S20')).toBeLessThan(1);
    for (const t of ALL_TARGETS) expect(hitChance(t, 5)).toBeGreaterThan(hitChance(t, 0) - 1e-9);
  });

  it('no hand is ever certain: nothing on the board reaches 100%', () => {
    for (const t of ALL_TARGETS) expect(hitChance(t, 1000)).toBeLessThanOrEqual(AIM_CAP);
    expect(AIM_CAP).toBeLessThan(100);
  });

  it('a warm crowd alone cannot reach the cap on a treble', () => {
    expect(HEAT_CAP * STEADY_PER_HEAT).toBeLessThan(AIM_CAP - AIM_BASE.T);
  });
});

// ---------------------------------------------------------------- where a miss goes

describe('where a miss goes, and why', () => {
  it('a treble mostly drops into its own single, sometimes the neighbours, rarely the wall', () => {
    const t = landingDistribution(parseTarget('T20'));
    expect(t.map((l) => targetNotation(l.target)).sort()).toEqual(['S1', 'S20', 'S5', 'T1', 'T20', 'T5', 'WALL']);
    expect(at(t, 'S20')!.p).toBeGreaterThan(at(t, 'S5')!.p + at(t, 'S1')!.p);
    expect(at(t, 'WALL')!.p).toBeLessThan(at(t, 'S20')!.p);
    expect(at(t, 'T1')!.kind).toBe('drift');
  });

  it('a double is the expensive shot: most of its miss mass is off the board', () => {
    const d = landingDistribution(parseTarget('D16'));
    expect(d.filter((l) => l.target.region !== 'W').map((l) => targetNotation(l.target)).sort()).toEqual(['D16', 'D7', 'D8', 'S16', 'S7', 'S8']);
    const wall = at(d, 'WALL')!;
    expect(wall.kind).toBe('wall');
    expect(wall.p).toBeGreaterThan(0);
    // the wall takes more of a missed double than any single other landing
    for (const l of d.slice(1)) if (l !== wall) expect(wall.p).toBeGreaterThanOrEqual(l.p);
    // and a single never risks it
    expect(landingDistribution(parseTarget('S16')).some((l) => l.target.region === 'W')).toBe(false);
  });

  it('a single that misses can find the treble underneath it, which is luck, not skill', () => {
    const s = landingDistribution(parseTarget('S20'));
    expect(s.map((l) => targetNotation(l.target)).sort()).toEqual(['D20', 'S1', 'S20', 'S5', 'T20']);
    expect(at(s, 'T20')!.kind).toBe('lucky');
    expect(at(s, 'D20')!.kind).toBe('lucky');
    expect(at(s, 'S1')!.kind).toBe('drift');
  });

  it('the bulls stray to the top of the board, and the outer bull can drop in', () => {
    const ob = landingDistribution(parseTarget('OB'));
    expect(at(ob, 'BULL')!.kind).toBe('lucky');
    expect(ob.filter((l) => l.target.region === 'S').map((l) => l.target.bed).sort((a, b) => (a as number) - (b as number))).toEqual([1, 5, 20]);
    const ib = landingDistribution(parseTarget('BULL'));
    expect(at(ib, 'OB')!.kind).toBe('drift');
    // the inner bull is the hardest target on the board: most misses stay in the outer
    expect(at(ib, 'OB')!.p).toBeGreaterThan(at(ib, 'S20')!.p);
    expect(ob.some((l) => l.target.region === 'W')).toBe(false);
  });

  it('steadiness moves the mass from the misses to the hit, and nowhere else', () => {
    const cold = landingDistribution(parseTarget('T20'), 0);
    const warm = landingDistribution(parseTarget('T20'), 12);
    expect(warm[0].p).toBeGreaterThan(cold[0].p);
    for (let i = 1; i < cold.length; i++) {
      expect(targetNotation(warm[i].target)).toBe(targetNotation(cold[i].target));
      expect(warm[i].p).toBeLessThan(cold[i].p);
      // the shape of the miss is unchanged: only its total shrinks
      expect(warm[i].p / total(warm.slice(1))).toBeCloseTo(cold[i].p / total(cold.slice(1)), 12);
    }
  });
});

// ---------------------------------------------------------------- withoutTheWall

describe('withoutTheWall: CALLED does not improve the dart, it just keeps it on the board', () => {
  it('removes every wall landing and renormalises the rest to one', () => {
    for (const t of ALL_TARGETS) {
      for (const s of [0, 11, 30]) {
        const dist = landingDistribution(t, s);
        const kept = withoutTheWall(dist);
        expect(kept.some((l) => l.kind === 'wall' || l.target.region === 'W')).toBe(false);
        expect(total(kept)).toBeCloseTo(1, 12);
      }
    }
  });

  it('shares the wall mass out in proportion: the odds between the survivors are untouched', () => {
    const dist = landingDistribution(parseTarget('D16'));
    const kept = withoutTheWall(dist);
    const wall = at(dist, 'WALL')!.p;
    expect(kept).toHaveLength(dist.length - 1);
    for (const l of kept) {
      const before = at(dist, targetNotation(l.target))!.p;
      expect(l.p).toBeCloseTo(before / (1 - wall), 12);
      expect(l.p).toBeGreaterThan(before);
    }
    expect(at(kept, 'D16')!.p / at(kept, 'S16')!.p).toBeCloseTo(at(dist, 'D16')!.p / at(dist, 'S16')!.p, 12);
  });

  it('is a no-op on a spread that never reaches the wall', () => {
    for (const t of [parseTarget('S20'), parseTarget('OB'), parseTarget('BULL')]) {
      const dist = landingDistribution(t);
      expect(withoutTheWall(dist)).toEqual(dist);
    }
  });

  it('a called dart is still a gamble: the hit chance rises only by the wall it gave up', () => {
    const plain = landingDistribution(parseTarget('T20'));
    const called = withoutTheWall(plain);
    expect(called[0].p).toBeGreaterThan(plain[0].p);
    expect(called[0].p).toBeLessThan(0.6);
  });
});

// ---------------------------------------------------------------- spreadFor

describe('spreadFor honours the interventions spent on the dart', () => {
  it('with nothing spent it is the plain distribution', () => {
    for (const t of ALL_TARGETS) expect(spreadFor(t, 6)).toEqual(landingDistribution(t, 6));
  });

  it('steady is worth STEADY_INTERVENTION points on this dart alone', () => {
    for (const t of ALL_TARGETS) {
      expect(spreadFor(t, 0, ['steady'])).toEqual(landingDistribution(t, STEADY_INTERVENTION));
      expect(spreadFor(t, 5, ['steady'])).toEqual(landingDistribution(t, 5 + STEADY_INTERVENTION));
    }
    expect(spreadFor(parseTarget('T20'), 0, ['steady'])[0].p).toBeCloseTo(hitChance(parseTarget('T20'), STEADY_INTERVENTION) / 100, 12);
  });

  it('steady cannot push a target past the cap on the lift', () => {
    const t = parseTarget('T20');
    expect(spreadFor(t, STEADY_MAX, ['steady'])[0].p).toBeCloseTo(hitChance(t, STEADY_MAX) / 100, 12);
  });

  it('called drops the wall and renormalises', () => {
    const t = parseTarget('D16');
    expect(spreadFor(t, 0, ['called'])).toEqual(withoutTheWall(landingDistribution(t, 0)));
    expect(spreadFor(t, 0, ['called']).some((l) => l.target.region === 'W')).toBe(false);
    expect(total(spreadFor(t, 0, ['called']))).toBeCloseTo(1, 12);
  });

  it('steady and called together: steadier first, then no wall', () => {
    const t = parseTarget('D16');
    const both = spreadFor(t, 4, ['steady', 'called']);
    expect(both).toEqual(withoutTheWall(landingDistribution(t, 4 + STEADY_INTERVENTION)));
    expect(total(both)).toBeCloseTo(1, 12);
    expect(both[0].p).toBeGreaterThan(spreadFor(t, 4, ['steady'])[0].p);
  });

  it('an intervention that is not about the aim changes nothing', () => {
    const t = parseTarget('T20');
    expect(spreadFor(t, 3, ['doubled', 'insured', 'rubout'])).toEqual(landingDistribution(t, 3));
  });

  it('every spread stays a distribution, whatever is spent on it', () => {
    for (const use of [[], ['steady'], ['called'], ['steady', 'called'], ['again']]) {
      for (const t of ALL_TARGETS) expect(total(spreadFor(t, 9, use)), `${targetNotation(t)} ${use}`).toBeCloseTo(1, 12);
    }
  });
});

// ---------------------------------------------------------------- rolling it

describe('rolling the landing', () => {
  it('consumes exactly one float and follows the spread over many rolls', () => {
    const rng = createRng(7);
    const counts = new Map<string, number>();
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const before = rng.s;
      const l = rollLanding(parseTarget('T20'), 0, rng);
      expect(rng.s).not.toBe(before);
      counts.set(targetNotation(l.target), (counts.get(targetNotation(l.target)) ?? 0) + 1);
    }
    const hit = (counts.get('T20') ?? 0) / N;
    expect(hit).toBeGreaterThan(AIM_BASE.T / 100 - 0.04);
    expect(hit).toBeLessThan(AIM_BASE.T / 100 + 0.04);
    expect((counts.get('S20') ?? 0) / N).toBeGreaterThan((1 - AIM_BASE.T / 100) * 0.5 - 0.04);
    expect(counts.size).toBeLessThanOrEqual(landingDistribution(parseTarget('T20')).length);
  });

  it('the same seed lands the same way; a steadier hand lands the aimed target more often', () => {
    const roll = (seed: number, steady: number) => targetNotation(rollLanding(parseTarget('D16'), steady, createRng(seed)).target);
    expect(roll(11, 9)).toBe(roll(11, 9));
    let cold = 0;
    let warm = 0;
    for (let seed = 1; seed <= 600; seed++) {
      if (roll(seed, 0) === 'D16') cold++;
      if (roll(seed, STEADY_MAX) === 'D16') warm++;
    }
    expect(warm).toBeGreaterThan(cold);
  });

  it('a called dart never lands in the wall over many rolls', () => {
    const rng = createRng(3);
    for (let i = 0; i < 2000; i++) expect(rollLanding(parseTarget('D20'), 0, rng, ['called']).target.region).not.toBe('W');
  });
});

// ---------------------------------------------------------------- the aim inside the pipeline

describe('the aim inside resolveThrow', () => {
  it('a hypothetical (no RNG) lands where it is aimed', () => {
    const plain = resolve('T20', 501);
    expect(plain.aim).toBe('hit');
    expect(targetNotation(plain.hits[0].target)).toBe('T20');
    expect(plain.steadiness).toBe(0);
  });

  it('true aim skips the roll and leaves the RNG alone', () => {
    const rng = createRng(3);
    const before = rng.s;
    const r = resolveThrow(parseTarget('T20'), { chalk: [], rng, trueAim: true, scoreBefore: 501, scoreAtVisitStart: 501, visitThrowIndex: 0, forgivenessUsed: true }).result;
    expect(r.aim).toBe('hit');
    expect(rng.s).toBe(before);
  });

  it('a forced landing resolves that target through the chalk, and records the drift', () => {
    const forced = resolveThrow(parseTarget('T20'), {
      chalk: mkChalk(['heavy_tips']),
      rng: null,
      scoreBefore: 501,
      scoreAtVisitStart: 501,
      visitThrowIndex: 0,
      forgivenessUsed: true,
      landing: parseTarget('S20'),
    }).result;
    expect(forced.aim).toBe('drift');
    expect(targetNotation(forced.aimed)).toBe('T20');
    expect(targetNotation(forced.hits[0].target)).toBe('S20');
    expect(forced.totalValue).toBe(25); // S20 + heavy tips
    expect(forced.firedChalk).toEqual(['heavy_tips']);
  });

  it('a dart in the wall scores nothing, fires no chalk, and is not a deliberate miss', () => {
    const r = resolveThrow(parseTarget('D16'), {
      chalk: mkChalk(['heavy_tips', 'split_tips']),
      rng: null,
      scoreBefore: 32,
      scoreAtVisitStart: 32,
      visitThrowIndex: 0,
      forgivenessUsed: true,
      landing: { region: 'W' },
    }).result;
    expect(r.aim).toBe('wall');
    expect(r.hits).toEqual([]);
    expect(r.totalValue).toBe(0);
    expect(r.outcome).toBe('CONTINUE');
    expect(r.scoreCommitted).toBe(32);
    expect(r.firedChalk).toEqual([]);
    expect(r.miss).toBe(false);
  });

  it('the steadiness the dart was thrown with is recorded on the result', () => {
    const a = resolveThrow(parseTarget('D16'), { chalk: [], rng: createRng(11), steadiness: 9, scoreBefore: 100, scoreAtVisitStart: 100, visitThrowIndex: 0, forgivenessUsed: true }).result;
    const b = resolveThrow(parseTarget('D16'), { chalk: [], rng: createRng(11), steadiness: 9, scoreBefore: 100, scoreAtVisitStart: 100, visitThrowIndex: 0, forgivenessUsed: true }).result;
    expect(a.steadiness).toBe(9);
    expect(targetNotation(a.hits[0]?.target ?? { region: 'W' })).toBe(targetNotation(b.hits[0]?.target ?? { region: 'W' }));
  });

  it('AGAIN throws the dart a second time and the second one stands: two floats, one landing', () => {
    const rng = createRng(21);
    const twin = createRng(21);
    const r = resolveThrow(parseTarget('T20'), { chalk: [], rng, steadiness: 0, use: ['again'], scoreBefore: 501, scoreAtVisitStart: 501, visitThrowIndex: 0, forgivenessUsed: true }).result;
    rollLanding(parseTarget('T20'), 0, twin, ['again']);
    const second = rollLanding(parseTarget('T20'), 0, twin, ['again']);
    expect(targetNotation(r.hits[0]?.target ?? { region: 'W' })).toBe(targetNotation(second.target));
    expect(r.firedChalk).toContain('again');
  });
});
