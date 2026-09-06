/**
 * TDD §17.7 — bust correctness. Every remaining score 2..501 × every one of
 * the 62 board targets is classified from first principles, and the
 * reference table is asserted against `classifyBase` (rules.ts) and against
 * the real pipeline (`resolveThrow`, no chalk). 31,000 cells, looped inside
 * a handful of tests. Plus the folk facts: which scores can be finished at
 * all under the base rules, derived by brute force.
 */
import { describe, expect, it } from 'vitest';
import { ALL_TARGETS, targetNotation } from '../src/core/board.ts';
import { classifyBase, isFinishableBase, type Classification } from '../src/core/rules.ts';
import { BED_ORDER, type Target } from '../src/core/types.ts';
import { resolve } from './helpers.ts';

// ---------------------------------------------------------------- reference, from first principles

const MULT = { S: 1, D: 2, T: 3, W: 0 } as const;

/** bed × multiplier; outer bull 25; inner bull 50 (TDD §3.1). */
function refValue(t: Target): number {
  if (t.region === 'OB') return 25;
  if (t.region === 'IB') return 50;
  return (t.bed as number) * MULT[t.region];
}

/** The double ring, or the inner bull (which is "double 25"). */
function refIsDouble(t: Target): boolean {
  return t.region === 'D' || t.region === 'IB';
}

/** TDD §3.4/§3.5: below 0 → BUST; exactly 1 → BUST; exactly 0 → CHECKOUT iff double, else BUST; else CONTINUE. */
function refClassify(score: number, t: Target): Classification {
  const after = score - refValue(t);
  if (after < 0) return 'BUST';
  if (after === 1) return 'BUST';
  if (after === 0) return refIsDouble(t) ? 'CHECKOUT' : 'BUST';
  return 'CONTINUE';
}

const SCORES: number[] = [];
for (let s = 2; s <= 501; s++) SCORES.push(s);

/** Reference table: score → target notation → classification. Built once. */
const TABLE = new Map<number, Map<string, Classification>>();
for (const s of SCORES) {
  const row = new Map<string, Classification>();
  for (const t of ALL_TARGETS) row.set(targetNotation(t), refClassify(s, t));
  TABLE.set(s, row);
}

function count(pred: (s: number, t: Target, c: Classification) => boolean): number {
  let n = 0;
  for (const s of SCORES) {
    const row = TABLE.get(s) as Map<string, Classification>;
    for (const t of ALL_TARGETS) if (pred(s, t, row.get(targetNotation(t)) as Classification)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- the table itself

describe('reference table shape', () => {
  it('covers 500 scores × 62 targets = 31,000 cells', () => {
    expect(SCORES).toHaveLength(500);
    expect(SCORES[0]).toBe(2);
    expect(SCORES[SCORES.length - 1]).toBe(501);
    expect(ALL_TARGETS).toHaveLength(62);
    expect(BED_ORDER).toHaveLength(20);
    expect(new Set(BED_ORDER).size).toBe(20);
    expect(count(() => true)).toBe(31000);
  });

  it('the 62 targets are 20 beds × S/D/T plus OB and IB, each once', () => {
    const names = ALL_TARGETS.map(targetNotation);
    expect(new Set(names).size).toBe(62);
    for (const bed of BED_ORDER) for (const r of ['S', 'D', 'T']) expect(names).toContain(`${r}${bed}`);
    expect(names).toContain('OB');
    expect(names).toContain('BULL');
  });

  it('exactly 21 cells are checkouts: one per double (2..40) and the bull from 50', () => {
    expect(count((_s, _t, c) => c === 'CHECKOUT')).toBe(21);
    for (let bed = 1; bed <= 20; bed++) expect(TABLE.get(bed * 2)?.get(`D${bed}`)).toBe('CHECKOUT');
    expect(TABLE.get(50)?.get('BULL')).toBe('CHECKOUT');
    expect(TABLE.get(25)?.get('OB')).toBe('BUST');
  });

  it('exactly-one busts: every target has one (score = value + 1)', () => {
    let exactlyOne = 0;
    for (const t of ALL_TARGETS) {
      const s = refValue(t) + 1;
      expect(s).toBeGreaterThanOrEqual(2);
      expect(TABLE.get(s)?.get(targetNotation(t))).toBe('BUST');
      exactlyOne++;
    }
    expect(exactlyOne).toBe(62);
    expect(count((s, t) => s - refValue(t) === 1)).toBe(62);
  });

  it('below-zero busts count = Σ max(0, value − 2) over targets', () => {
    let expected = 0;
    for (const t of ALL_TARGETS) expected += Math.max(0, refValue(t) - 2);
    expect(count((s, t) => s - refValue(t) < 0)).toBe(expected);
    expect(count((s, t) => s - refValue(t) < 0)).toBe(1212);
  });

  it('exact-zero non-double busts: every S, T and OB target with value ≥ 2 (S1 cannot land on 0 from 2+)', () => {
    const nonDoubleZero = count((s, t, c) => s - refValue(t) === 0 && c === 'BUST');
    expect(nonDoubleZero).toBe(20 + 20 + 1 - 1);
    expect(TABLE.get(2)?.get('S1')).toBe('BUST'); // 2 − 1 = 1
  });

  it('total BUST + CHECKOUT + CONTINUE = 31,000 and continues dominate', () => {
    const b = count((_s, _t, c) => c === 'BUST');
    const k = count((_s, _t, c) => c === 'CHECKOUT');
    const c = count((_s, _t, c2) => c2 === 'CONTINUE');
    expect(b + k + c).toBe(31000);
    expect(b).toBe(1212 + 62 + 40);
    expect(c).toBe(31000 - b - 21);
  });

  it('from 501 nothing busts and nothing checks out', () => {
    for (const t of ALL_TARGETS) expect(TABLE.get(501)?.get(targetNotation(t))).toBe('CONTINUE');
  });

  it('from 2 only D1 checks out; every other target busts', () => {
    for (const t of ALL_TARGETS) {
      const c = TABLE.get(2)?.get(targetNotation(t));
      expect(c).toBe(targetNotation(t) === 'D1' ? 'CHECKOUT' : 'BUST');
    }
  });
});

// ---------------------------------------------------------------- rules.ts agrees

describe('classifyBase (rules.ts) agrees with the reference on every cell', () => {
  it('all 31,000 cells', () => {
    let cells = 0;
    const mismatches: string[] = [];
    for (const s of SCORES) {
      const row = TABLE.get(s) as Map<string, Classification>;
      for (const t of ALL_TARGETS) {
        cells++;
        const want = row.get(targetNotation(t));
        const got = classifyBase(s, t);
        if (want !== got) mismatches.push(`${s} ${targetNotation(t)}: want ${want} got ${got}`);
      }
    }
    expect(cells).toBe(31000);
    expect(mismatches).toEqual([]);
  });

  it('spot checks from the folk rulebook', () => {
    expect(classifyBase(32, { region: 'D', bed: 16 })).toBe('CHECKOUT');
    expect(classifyBase(32, { region: 'S', bed: 16 })).toBe('CONTINUE');
    expect(classifyBase(16, { region: 'S', bed: 16 })).toBe('BUST');
    expect(classifyBase(17, { region: 'S', bed: 16 })).toBe('BUST');
    expect(classifyBase(50, { region: 'IB' })).toBe('CHECKOUT');
    expect(classifyBase(50, { region: 'OB' })).toBe('CONTINUE');
    expect(classifyBase(25, { region: 'OB' })).toBe('BUST');
    expect(classifyBase(60, { region: 'T', bed: 20 })).toBe('BUST');
    expect(classifyBase(61, { region: 'T', bed: 20 })).toBe('BUST');
    expect(classifyBase(62, { region: 'T', bed: 20 })).toBe('CONTINUE');
    expect(classifyBase(3, { region: 'D', bed: 1 })).toBe('BUST');
  });
});

// ---------------------------------------------------------------- the real pipeline agrees

describe('resolveThrow with no chalk agrees with the reference on every cell', () => {
  it('outcome matches for all 31,000 cells', () => {
    const mismatches: string[] = [];
    let cells = 0;
    for (const s of SCORES) {
      const row = TABLE.get(s) as Map<string, Classification>;
      for (const t of ALL_TARGETS) {
        cells++;
        const want = row.get(targetNotation(t));
        const r = resolve(t, s);
        if (r.outcome !== want) mismatches.push(`${s} ${targetNotation(t)}: want ${want} got ${r.outcome}`);
      }
    }
    expect(cells).toBe(31000);
    expect(mismatches).toEqual([]);
  });

  it('the committed score follows the outcome: CHECKOUT → 0, BUST → visit start, CONTINUE → the arithmetic', () => {
    const VISIT_START = 777;
    const bad: string[] = [];
    for (const s of SCORES) {
      for (const t of ALL_TARGETS) {
        const r = resolve(t, s, [], { scoreAtVisitStart: VISIT_START });
        const after = s - refValue(t);
        if (r.scoreAfter !== after) bad.push(`${s} ${targetNotation(t)} scoreAfter ${r.scoreAfter} ≠ ${after}`);
        if (r.totalValue !== refValue(t)) bad.push(`${s} ${targetNotation(t)} value ${r.totalValue}`);
        const want = r.outcome === 'CHECKOUT' ? 0 : r.outcome === 'BUST' ? VISIT_START : after;
        if (r.scoreCommitted !== want) bad.push(`${s} ${targetNotation(t)} committed ${r.scoreCommitted} ≠ ${want}`);
        if (r.firedChalk.length) bad.push(`${s} ${targetNotation(t)} fired ${r.firedChalk}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('countsAsDouble is exactly the double ring plus the inner bull, on every cell', () => {
    for (const t of ALL_TARGETS) {
      for (const s of [2, 40, 170, 501]) {
        const r = resolve(t, s);
        expect(r.hits[0].countsAsDouble).toBe(refIsDouble(t));
      }
    }
  });
});

// ---------------------------------------------------------------- finishability

/** Scores finishable in ≤ 3 darts under the base rules, by brute force over the 62 targets. */
function bruteFinishable(): Set<number> {
  const values = ALL_TARGETS.map(refValue);
  const doubles = ALL_TARGETS.filter(refIsDouble).map(refValue);
  const out = new Set<number>();
  for (const d of doubles) {
    out.add(d);
    for (const a of values) {
      out.add(a + d);
      for (const b of values) out.add(a + b + d);
    }
  }
  return out;
}

describe('isFinishableBase (rules.ts) matches the folk unfinishable set', () => {
  const KNOWN_UNFINISHABLE = [169, 168, 166, 165, 163, 162, 159];

  it('the famous seven bogey numbers under 170 are unfinishable', () => {
    for (const s of KNOWN_UNFINISHABLE) expect(isFinishableBase(s), String(s)).toBe(false);
  });

  it('every other score from 2 to 170 is finishable', () => {
    for (let s = 2; s <= 170; s++) {
      if (KNOWN_UNFINISHABLE.includes(s)) continue;
      expect(isFinishableBase(s), String(s)).toBe(true);
    }
  });

  it('above 170, and 0 and 1, are never finishable', () => {
    for (const s of [0, 1, 171, 172, 180, 200, 300, 501, 1000]) expect(isFinishableBase(s), String(s)).toBe(false);
    for (let s = 171; s <= 501; s++) expect(isFinishableBase(s)).toBe(false);
    expect(isFinishableBase(-1)).toBe(false);
  });

  it('brute force over the board reproduces exactly that set (2..170)', () => {
    const brute = bruteFinishable();
    const unfinishable: number[] = [];
    for (let s = 2; s <= 170; s++) if (!brute.has(s)) unfinishable.push(s);
    expect(unfinishable.sort((a, b) => a - b)).toEqual([...KNOWN_UNFINISHABLE].sort((a, b) => a - b));
    for (let s = 2; s <= 170; s++) expect(isFinishableBase(s), String(s)).toBe(brute.has(s));
    // 170 is the largest three-dart finish; 171+ are unreachable
    expect(brute.has(170)).toBe(true);
    for (let s = 171; s <= 180; s++) expect(brute.has(s)).toBe(false);
  });

  it('170 is T20 T20 BULL and nothing else needs more than 60 + 60 + 50', () => {
    const r1 = resolve('t20', 170);
    const r2 = resolve('t20', r1.scoreCommitted);
    const r3 = resolve('ib', r2.scoreCommitted);
    expect([r1.outcome, r2.outcome, r3.outcome]).toEqual(['CONTINUE', 'CONTINUE', 'CHECKOUT']);
    expect(resolve('d20', 110).outcome).toBe('CONTINUE');
  });
});
