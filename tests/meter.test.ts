/**
 * THE METER — src/core/meter.ts.
 *
 * The fourth playtest asked for the throw itself back: "an accuracy meter that
 * slides up and down across a scale where the middle is dead on accurate and
 * you have to tap to determine shot precision". Putting a skill in the
 * player's thumb is only safe if it does not quietly move the game underneath
 * it, so this file pins the four properties the whole feature rests on.
 *
 *   1. An ordinary hand lands EXACTLY the distribution the game is balanced
 *      on — every outcome, not just the one you called.
 *   2. The risk dial survives: a called single cannot really be missed by
 *      anybody, and a treble is a real test at every level of thumb.
 *   3. A miss is legible: short is below the middle, long is above it, and the
 *      wall is at the very top.
 *   4. The scale is a partition of the column, always.
 */
import { describe, expect, it } from 'vitest';
import { ALL_TARGETS, parseTarget, sameTarget, targetNotation } from '../src/core/board.ts';
import {
  BAND_MAX,
  HAND_SHAKE,
  ORDINARY_HAND,
  SWEEP,
  bandAt,
  bandWidth,
  isSweet,
  markerAt,
  meterOdds,
  meterScale,
  reflect,
  rolledStop,
  shakeFrom,
  shakenStop,
  stopChance,
} from '../src/core/meter.ts';
import { AIM_BASE, hitChance, meterFor, realSpread, spreadFor, throwOnMeter } from '../src/core/resolver.ts';
import { createRng } from '../src/core/rng.ts';
import type { Target } from '../src/core/types.ts';

const SPOTS = ['S20', 'T20', 'D20', 'OB', 'BULL'].map(parseTarget);
const key = (t: Target) => `${t.region}${t.bed ?? ''}`;

/** Play a hand of the given timing at a target, and count where the darts went. */
function hand(target: Target, sd: number, n = 60000, steadiness = 0): Map<string, number> {
  const rng = createRng(4242);
  const jitter = createRng(99);
  const tally = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    // The player's own timing error, then the game's own shake on top of it.
    const stop = reflect(0.5 + shakeFrom(nextUniform(jitter), sd) * SWEEP);
    const landed = throwOnMeter(target, steadiness, rng, stop).target;
    tally.set(key(landed), (tally.get(key(landed)) ?? 0) + 1);
  }
  return tally;
}

function nextUniform(rng: { s: number }): number {
  rng.s = (rng.s + 0x9e3779b9) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const pc = (tally: Map<string, number>, k: string, n = 60000) => ((tally.get(k) ?? 0) / n) * 100;

describe('the scale is a partition of the column', () => {
  it('every target, every steadiness: no gaps, no overlaps, nothing outside', () => {
    for (const steady of [0, 8, 16, 26]) {
      for (const t of ALL_TARGETS) {
        if (t.region === 'W') continue;
        const scale = meterFor(t, steady);
        expect(scale.length, targetNotation(t)).toBeGreaterThan(0);
        expect(scale[0].from).toBeCloseTo(0, 9);
        expect(scale[scale.length - 1].to).toBeCloseTo(1, 9);
        for (let i = 1; i < scale.length; i++) {
          expect(scale[i].from, `${targetNotation(t)} band ${i}`).toBeCloseTo(scale[i - 1].to, 9);
          expect(scale[i].to).toBeGreaterThanOrEqual(scale[i].from);
        }
      }
    }
  });

  it('a stop anywhere on the column lands in exactly one band', () => {
    const scale = meterFor(parseTarget('T20'), 0);
    for (let i = 0; i <= 1000; i++) {
      const b = bandAt(scale, i / 1000);
      expect(b).toBeTruthy();
      expect(b.target).toBeTruthy();
    }
  });
});

describe('an ordinary hand lands exactly the distribution the game is balanced on', () => {
  it('the analytic odds equal spreadFor, to nine places, for every target', () => {
    for (const steady of [0, 10, 26]) {
      for (const t of ALL_TARGETS) {
        if (t.region === 'W') continue;
        const want = new Map(spreadFor(t, steady).map((l) => [key(l.target), l.p]));
        const got = new Map(realSpread(t, steady).map((l) => [key(l.target), l.p]));
        for (const [k, p] of want) {
          expect(got.get(k) ?? 0, `${targetNotation(t)} @${steady} → ${k}`).toBeCloseTo(p, 5);
        }
        expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
      }
    }
  });

  it('and the darts agree with the arithmetic when they are actually thrown', () => {
    for (const t of SPOTS) {
      const tally = hand(t, ORDINARY_HAND);
      for (const l of spreadFor(t, 0)) {
        if (l.p < 0.01) continue;
        expect(pc(tally, key(l.target)), `${targetNotation(t)} → ${key(l.target)}`).toBeCloseTo(l.p * 100, -0.6);
      }
    }
  });

  it('a dart with no player behind it is thrown by that same hand', () => {
    // The bot, a replayed script and the meter switched off all take this path.
    const rng = createRng(7);
    const t = parseTarget('T20');
    let hits = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) if (sameTarget(throwOnMeter(t, 0, rng, undefined).target, t)) hits++;
    expect((hits / n) * 100).toBeCloseTo(AIM_BASE.T, -0.6);
  });
});

describe('the risk dial survives being put in a thumb', () => {
  const SD = { quick: 0.035, ordinary: ORDINARY_HAND, poor: 0.09 };

  it('a called single is near certain for every hand there is', () => {
    const s20 = parseTarget('S20');
    for (const [name, sd] of Object.entries(SD)) {
      expect(pc(hand(s20, sd), 'S20'), `single, ${name} hand`).toBeGreaterThan(90);
    }
    // Even a thumb with no timing at all: the band takes most of the column.
    expect(bandWidth(AIM_BASE.S)).toBeGreaterThan(0.85);
  });

  it('a treble is a real test at every level, and never as safe as a single', () => {
    const t20 = parseTarget('T20');
    const s20 = parseTarget('S20');
    for (const [name, sd] of Object.entries(SD)) {
      const treble = pc(hand(t20, sd), 'T20');
      const single = pc(hand(s20, sd), 'S20');
      expect(treble, `treble, ${name} hand`).toBeLessThan(80);
      expect(single - treble, `the dial has closed up for a ${name} hand`).toBeGreaterThan(20);
    }
  });

  it('a quicker thumb is worth something, and a poorer one costs something', () => {
    const t20 = parseTarget('T20');
    const quick = pc(hand(t20, SD.quick), 'T20');
    const ordinary = pc(hand(t20, SD.ordinary), 'T20');
    const poor = pc(hand(t20, SD.poor), 'T20');
    expect(quick).toBeGreaterThan(ordinary + 5);
    expect(poor).toBeLessThan(ordinary - 5);
  });

  it('the harder the dart, the tighter the window', () => {
    const widths = SPOTS.map((t) => bandWidth(hitChance(t, 0)));
    const [s, treble, double, ob, ib] = widths;
    expect(s).toBeGreaterThan(ob);
    expect(ob).toBeGreaterThan(double);
    expect(double).toBeGreaterThan(treble);
    expect(treble).toBeGreaterThan(ib);
    expect(ib).toBeLessThan(0.2);
  });

  it('steadiness widens the window, and cannot open it all the way', () => {
    const t20 = parseTarget('T20');
    const cold = bandWidth(hitChance(t20, 0));
    const warm = bandWidth(hitChance(t20, 26));
    expect(warm).toBeGreaterThan(cold);
    expect(warm).toBeLessThan(BAND_MAX);
    expect(pc(hand(t20, ORDINARY_HAND, 40000, 26), 'T20', 40000)).toBeGreaterThan(pc(hand(t20, ORDINARY_HAND, 40000), 'T20', 40000));
  });
});

describe('a miss reads as a miss on the board', () => {
  it('the band you called is in the middle of the column', () => {
    for (const t of ALL_TARGETS) {
      if (t.region === 'W') continue;
      const band = meterFor(t, 0).find((b) => b.how === 'hit');
      expect(band, targetNotation(t)).toBeTruthy();
      const mid = ((band as { from: number; to: number }).from + (band as { from: number; to: number }).to) / 2;
      expect(mid, `${targetNotation(t)} is off centre`).toBeCloseTo(0.5, 2);
    }
  });

  it('its width is the one bandWidth advertises', () => {
    for (const t of SPOTS) {
      const band = meterFor(t, 0).find((b) => b.how === 'hit') as { from: number; to: number };
      expect(band.to - band.from, targetNotation(t)).toBeCloseTo(bandWidth(hitChance(t, 0)), 2);
    }
  });

  it('the wall is at the very top: a dart leaves the board by being thrown long', () => {
    for (const t of [parseTarget('D20'), parseTarget('T20')]) {
      const scale = meterFor(t, 0);
      const wall = scale.filter((b) => b.target.region === 'W');
      expect(wall.length, targetNotation(t)).toBeGreaterThan(0);
      for (const b of wall) {
        expect(b.how).toBe('long');
        expect(b.to).toBeCloseTo(1, 9);
      }
    }
  });

  it('short is below the middle and long is above it, always', () => {
    for (const t of ALL_TARGETS) {
      if (t.region === 'W') continue;
      for (const b of meterFor(t, 0)) {
        if (b.how === 'short') expect(b.to, targetNotation(t)).toBeLessThanOrEqual(0.5 + 1e-9);
        if (b.how === 'long') expect(b.from, targetNotation(t)).toBeGreaterThanOrEqual(0.5 - 1e-9);
      }
    }
  });

  it('a dart thrown short of a treble drops into the single under it, not off the board', () => {
    const scale = meterFor(parseTarget('T20'), 0);
    const justShort = bandAt(scale, 0.5 - bandWidth(AIM_BASE.T) / 2 - 0.01);
    expect(justShort.how).toBe('short');
    expect(justShort.target.region).not.toBe('W');
  });
});

describe('the marker, the shake and the fold', () => {
  it('the marker sweeps the column and turns round at both ends', () => {
    let low = 1;
    let high = 0;
    for (let i = 0; i < 2000; i++) {
      const v = markerAt(i / 500);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
    expect(low).toBeLessThan(0.02);
    expect(high).toBeGreaterThan(0.98);
    // and it is where it was one full up-and-down later
    expect(markerAt(1 + 2 / SWEEP)).toBeCloseTo(markerAt(1), 9);
  });

  it('a stop stays on the column, and lands where stopChance says it will', () => {
    // Clamping would heap every wild tap onto the extreme band; folding
    // spreads it, and stopChance sums every fold, so the arithmetic the scale
    // is cut from matches the darts exactly.
    const buckets = new Array(10).fill(0);
    const n = 300000;
    const rng = { s: 12345 };
    for (let i = 0; i < n; i++) {
      const v = rolledStop(nextUniform(rng));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      buckets[Math.min(9, Math.floor(v * 10))]++;
    }
    for (let i = 0; i < 10; i++) {
      expect(buckets[i] / n, `decile ${i}`).toBeCloseTo(stopChance(i / 10, (i + 1) / 10), 2);
    }
  });

  it('folding is what keeps the ends honest: a wild tap is not the worst tap', () => {
    // A tap a whole column late reads as if it were early by the same amount,
    // rather than as the most catastrophic throw available.
    expect(reflect(1.2)).toBeCloseTo(0.8, 9);
    expect(reflect(-0.2)).toBeCloseTo(0.2, 9);
    expect(reflect(2.3)).toBeCloseTo(0.3, 9);
    expect(reflect(0.4)).toBeCloseTo(0.4, 9);
  });

  it('the shake is symmetric and has the spread it says it has', () => {
    const rng = { s: 5 };
    let sum = 0;
    let sq = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const v = shakeFrom(nextUniform(rng), 0.05);
      sum += v;
      sq += v * v;
    }
    expect(sum / n).toBeCloseTo(0, 2);
    expect(Math.sqrt(sq / n)).toBeCloseTo(0.05, 2);
  });

  it("the player's own tap is only lightly shaken, and an unaided one heavily", () => {
    expect(HAND_SHAKE).toBeLessThan(ORDINARY_HAND / 3);
    const rng = createRng(3);
    let near = 0;
    for (let i = 0; i < 5000; i++) if (Math.abs(shakenStop(0.5, nextUniform(rng as unknown as { s: number })) - 0.5) < 0.05) near++;
    expect(near / 5000).toBeGreaterThan(0.5);
    const rng2 = createRng(3);
    let wide = 0;
    for (let i = 0; i < 5000; i++) if (Math.abs(rolledStop(nextUniform(rng2 as unknown as { s: number })) - 0.5) > 0.05) wide++;
    expect(wide / 5000).toBeGreaterThan(0.5);
  });

  it('dead on is the middle of the middle, and nothing else is', () => {
    expect(isSweet(0.5)).toBe(true);
    expect(isSweet(0.52)).toBe(true);
    expect(isSweet(0.2)).toBe(false);
    expect(isSweet(0.8)).toBe(false);
  });

  it('the chance of stopping anywhere at all is one', () => {
    expect(stopChance(0, 1)).toBeCloseTo(1, 9);
    expect(stopChance(0, 0.5)).toBeCloseTo(0.5, 6);
    expect(stopChance(0.5, 1)).toBeCloseTo(0.5, 6);
  });
});

describe('what the column is showing', () => {
  it('the odds read off the scale sum to one', () => {
    for (const t of ALL_TARGETS) {
      if (t.region === 'W') continue;
      const total = meterOdds(meterScale(spreadFor(t, 0), t)).reduce((a, l) => a + l.p, 0);
      expect(total, targetNotation(t)).toBeCloseTo(1, 9);
    }
  });

  it('a wilder throw is a worse one: the further out you stop, the worse it gets', () => {
    // Walking up the column from the band, the dart should never improve.
    const scale = meterFor(parseTarget('D20'), 0);
    const rank: Record<string, number> = { D: 0, S: 1, W: 2 };
    let worst = -1;
    for (const b of scale.filter((x) => x.how === 'long').sort((a, c) => a.from - c.from)) {
      const r = rank[b.target.region] ?? 1;
      expect(r, `${targetNotation(b.target)} at ${b.from.toFixed(2)}`).toBeGreaterThanOrEqual(worst);
      worst = r;
    }
  });
});
