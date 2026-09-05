/**
 * Resolution pipeline (TDD §3, §5, §7). Every chalk in isolation with exact
 * numbers, acquisition-order effects, the four ordering hazards of §7, and
 * the firedChalk contract.
 */
import { describe, expect, it } from 'vitest';
import { CHALK_DEFS } from '../src/content/chalkdefs.ts';
import { ALL_TARGETS, anticlockwiseAdjacent, clockwiseAdjacent, oppositeBed, targetNotation } from '../src/core/board.ts';
import { handSizeFor, resolveThrow, throwsPerVisitFor } from '../src/core/resolver.ts';
import { nextFloat } from '../src/core/rng.ts';
import { BED_ORDER, type Bed, type Target } from '../src/core/types.ts';
import { baseOf, defIdOf, deflectingRng, mkCard, mkChalk, nonDeflectingRng, resolve, value } from './helpers.ts';

const MULT = { S: 1, D: 2, T: 3, W: 0 } as const;
function expectedBase(t: Target): number {
  if (t.region === 'OB') return 25;
  if (t.region === 'IB') return 50;
  return (t.bed as number) * MULT[t.region];
}
const ALL_CHALK_IDS = CHALK_DEFS.map((c) => c.id);
const TARGET_ROWS = ALL_TARGETS.map((t) => [targetNotation(t), t] as const);

// ---------------------------------------------------------------- base values

describe('base values, no chalk (TDD §3.1)', () => {
  it('there are exactly 62 board targets', () => {
    expect(ALL_TARGETS).toHaveLength(62);
    expect(new Set(ALL_TARGETS.map(targetNotation)).size).toBe(62);
  });

  it.each(TARGET_ROWS)('%s resolves to bed × multiplier', (_n, t) => {
    const r = resolve(defIdOf(t), 501);
    expect(r.totalValue).toBe(expectedBase(t));
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].target).toEqual(t);
    expect(r.hits[0].value).toBe(expectedBase(t));
    expect(r.hits[0].countsAsDouble).toBe(t.region === 'D' || t.region === 'IB');
    expect(r.firedChalk).toEqual([]);
    expect(r.outcome).toBe('CONTINUE');
    expect(r.scoreBefore).toBe(501);
    expect(r.scoreAfter).toBe(501 - expectedBase(t));
    expect(r.scoreCommitted).toBe(501 - expectedBase(t));
    expect(r.deflected).toBe(false);
    expect(r.forgiven).toBe(false);
    expect(r.forgivenessConsumed).toBe(false);
  });

  it('the card table agrees with the pipeline for every target', () => {
    for (const t of ALL_TARGETS) expect(baseOf(defIdOf(t))).toBe(expectedBase(t));
  });

  it('maximum single throw is 60 and the intent is echoed', () => {
    const r = resolve('t20', 501, [], { throwIndex: 2 });
    expect(r.totalValue).toBe(60);
    expect(r.intent.visitThrowIndex).toBe(2);
    expect(r.intent.card.defId).toBe('t20');
  });
});

// ---------------------------------------------------------------- VALUE chalk

describe('hot_twenty (VALUE)', () => {
  it('T20 = 80', () => expect(value('t20', ['hot_twenty'])).toBe(80));
  it('fires on T20', () => expect(resolve('t20', 501, ['hot_twenty']).firedChalk).toEqual(['hot_twenty']));
  it('S20 = 20, not fired', () => {
    const r = resolve('s20', 501, ['hot_twenty']);
    expect(r.totalValue).toBe(20);
    expect(r.firedChalk).toEqual([]);
  });
  it('D20 = 40, not fired', () => expect(resolve('d20', 501, ['hot_twenty']).firedChalk).toEqual([]));
  it('T19 = 57, not fired', () => {
    const r = resolve('t19', 501, ['hot_twenty']);
    expect(r.totalValue).toBe(57);
    expect(r.firedChalk).toEqual([]);
  });
  it('only the 20 bed treble is affected across all targets', () => {
    for (const t of ALL_TARGETS) {
      const v = value(defIdOf(t), ['hot_twenty']);
      expect(v).toBe(t.region === 'T' && t.bed === 20 ? 80 : expectedBase(t));
    }
  });
});

describe('feathered (VALUE)', () => {
  it('D20 = 60', () => expect(value('d20', ['feathered'])).toBe(60));
  it('D20 from 60 is still a double: CHECKOUT', () => {
    const r = resolve('d20', 60, ['feathered']);
    expect(r.outcome).toBe('CHECKOUT');
    expect(r.hits[0].countsAsDouble).toBe(true);
    expect(r.firedChalk).toEqual(['feathered']);
  });
  it('D16 = 48, D1 = 3', () => {
    expect(value('d16', ['feathered'])).toBe(48);
    expect(value('d1', ['feathered'])).toBe(3);
  });
  it('singles and trebles untouched, not fired', () => {
    expect(resolve('s20', 501, ['feathered']).firedChalk).toEqual([]);
    expect(value('t20', ['feathered'])).toBe(60);
  });
  it('inner bull is not region D: 50, not fired (engine choice, see decisions)', () => {
    const r = resolve('ib', 501, ['feathered']);
    expect(r.totalValue).toBe(50);
    expect(r.firedChalk).toEqual([]);
  });
});

describe('heavy_tips (VALUE)', () => {
  it('S1 = 6', () => expect(value('s1', ['heavy_tips'])).toBe(6));
  it('T20 = 65, OB = 30, IB = 55', () => {
    expect(value('t20', ['heavy_tips'])).toBe(65);
    expect(value('ob', ['heavy_tips'])).toBe(30);
    expect(value('ib', ['heavy_tips'])).toBe(55);
  });
  it('fires on every throw', () => {
    for (const t of ALL_TARGETS) {
      const r = resolve(defIdOf(t), 501, ['heavy_tips']);
      expect(r.totalValue).toBe(expectedBase(t) + 5);
      expect(r.firedChalk).toEqual(['heavy_tips']);
    }
  });
});

describe('oiled (VALUE, odd beds +50% floored)', () => {
  it('S19 = 28 (28.5 floored)', () => expect(value('s19', ['oiled'])).toBe(28));
  it('T19 = 85 (85.5 floored)', () => expect(value('t19', ['oiled'])).toBe(85));
  it('D19 = 57', () => expect(value('d19', ['oiled'])).toBe(57));
  it('S1 = 1 (1.5 floored)', () => expect(value('s1', ['oiled'])).toBe(1));
  it('S20 untouched, not fired', () => {
    const r = resolve('s20', 501, ['oiled']);
    expect(r.totalValue).toBe(20);
    expect(r.firedChalk).toEqual([]);
  });
  it('bulls have no bed: untouched, not fired', () => {
    expect(resolve('ob', 501, ['oiled']).firedChalk).toEqual([]);
    expect(value('ib', ['oiled'])).toBe(50);
  });
  it('every odd bed target is floor(base × 1.5)', () => {
    for (const t of ALL_TARGETS) {
      const odd = t.bed !== undefined && t.bed % 2 === 1;
      expect(value(defIdOf(t), ['oiled'])).toBe(odd ? Math.floor(expectedBase(t) * 1.5) : expectedBase(t));
    }
  });
});

describe('even_keel (VALUE, even beds +50% floored)', () => {
  it('D20 = 60', () => expect(value('d20', ['even_keel'])).toBe(60));
  it('S20 = 30, T20 = 90', () => {
    expect(value('s20', ['even_keel'])).toBe(30);
    expect(value('t20', ['even_keel'])).toBe(90);
  });
  it('S2 = 3', () => expect(value('s2', ['even_keel'])).toBe(3));
  it('S19 untouched, not fired', () => expect(resolve('s19', 501, ['even_keel']).firedChalk).toEqual([]));
  it('bulls untouched', () => expect(value('ob', ['even_keel'])).toBe(25));
  it('every even bed target is floor(base × 1.5)', () => {
    for (const t of ALL_TARGETS) {
      const even = t.bed !== undefined && t.bed % 2 === 0;
      expect(value(defIdOf(t), ['even_keel'])).toBe(even ? Math.floor(expectedBase(t) * 1.5) : expectedBase(t));
    }
  });
});

describe('cold_hands (VALUE, by throw index)', () => {
  it('index 0 → 0', () => {
    const r = resolve('t20', 501, ['cold_hands'], { throwIndex: 0 });
    expect(r.totalValue).toBe(0);
    expect(r.scoreCommitted).toBe(501);
    expect(r.firedChalk).toEqual(['cold_hands']);
  });
  it('index 1 → ×2', () => expect(value('t20', ['cold_hands'], { throwIndex: 1 })).toBe(120));
  it('index 2 → ×2', () => expect(value('t20', ['cold_hands'], { throwIndex: 2 })).toBe(120));
  it('index 3 (fourth dart) → ×1, not fired', () => {
    const r = resolve('t20', 501, ['cold_hands'], { throwIndex: 3 });
    expect(r.totalValue).toBe(60);
    expect(r.firedChalk).toEqual([]);
  });
  it('a 0-value first dart is CONTINUE, never a bust or a checkout', () => {
    expect(resolve('d1', 2, ['cold_hands'], { throwIndex: 0 }).outcome).toBe('CONTINUE');
  });
});

describe('last_orders (VALUE, third throw only)', () => {
  it('index 2 → ×2', () => expect(value('t20', ['last_orders'], { throwIndex: 2 })).toBe(120));
  it.each([0, 1, 3] as const)('index %i → ×1, not fired', (i) => {
    const r = resolve('t20', 501, ['last_orders'], { throwIndex: i });
    expect(r.totalValue).toBe(60);
    expect(r.firedChalk).toEqual([]);
  });
});

describe('bullish (VALUE)', () => {
  it('OB = 75', () => expect(value('ob', ['bullish'])).toBe(75));
  it('IB = 75 and is still a double: CHECKOUT from 75', () => {
    const r = resolve('ib', 75, ['bullish']);
    expect(r.totalValue).toBe(75);
    expect(r.outcome).toBe('CHECKOUT');
    expect(r.firedChalk).toEqual(['bullish']);
  });
  it('OB from 75 is not a double: BUST', () => expect(resolve('ob', 75, ['bullish']).outcome).toBe('BUST'));
  it('beds untouched, not fired', () => {
    const r = resolve('t20', 501, ['bullish']);
    expect(r.totalValue).toBe(60);
    expect(r.firedChalk).toEqual([]);
  });
});

// ---------------------------------------------------------------- BOARD chalk

describe('wired (BOARD, 25% clockwise deflection)', () => {
  it('deflects T20 → T1 with a seeded rng that rolls < 0.25', () => {
    const r = resolve('t20', 501, ['wired'], { rng: deflectingRng() });
    expect(r.hits[0].target).toEqual({ region: 'T', bed: 1 });
    expect(r.totalValue).toBe(3);
    expect(r.deflected).toBe(true);
    expect(r.firedChalk).toEqual(['wired']);
  });
  it('wraps 5 → 20 (clockwise from the last bed back to the top)', () => {
    const r = resolve('s5', 501, ['wired'], { rng: deflectingRng() });
    expect(r.hits[0].target).toEqual({ region: 'S', bed: 20 });
    expect(r.totalValue).toBe(20);
  });
  it('keeps the region (D20 → D1 stays a double)', () => {
    const r = resolve('d1', 2, ['wired'], { rng: nonDeflectingRng() });
    expect(r.outcome).toBe('CHECKOUT');
    const d = resolve('d20', 2, ['wired'], { rng: deflectingRng() });
    expect(d.hits[0].target).toEqual({ region: 'D', bed: 1 });
    expect(d.outcome).toBe('CHECKOUT');
  });
  it('does not deflect when the roll is ≥ 0.25', () => {
    const r = resolve('t20', 501, ['wired'], { rng: nonDeflectingRng() });
    expect(r.hits[0].target).toEqual({ region: 'T', bed: 20 });
    expect(r.deflected).toBe(false);
    expect(r.firedChalk).toEqual([]);
  });
  it('never deflects without an rng (hints, bots)', () => {
    const r = resolve('t20', 501, ['wired'], { rng: null });
    expect(r.totalValue).toBe(60);
    expect(r.deflected).toBe(false);
    expect(r.firedChalk).toEqual([]);
  });
  it('consumes exactly one float per bed throw', () => {
    const rng = deflectingRng();
    const twin = { s: rng.s };
    resolve('t20', 501, ['wired'], { rng });
    nextFloat(twin);
    expect(rng.s).toBe(twin.s);
  });
  it('bulls cannot deflect and do not consume the rng (engine choice)', () => {
    const rng = deflectingRng();
    const before = rng.s;
    const r = resolve('ib', 501, ['wired'], { rng });
    expect(r.hits[0].target).toEqual({ region: 'IB' });
    expect(r.deflected).toBe(false);
    expect(rng.s).toBe(before);
  });
  it('every bed deflects to BED_ORDER[i+1]', () => {
    for (let i = 0; i < 20; i++) {
      const bed = BED_ORDER[i];
      const r = resolve(`s${bed}`, 501, ['wired'], { rng: deflectingRng() });
      expect(r.hits[0].target.bed).toBe(BED_ORDER[(i + 1) % 20]);
      expect(clockwiseAdjacent(bed)).toBe(BED_ORDER[(i + 1) % 20]);
    }
  });
  it('no other chalk consumes the rng', () => {
    for (const id of ALL_CHALK_IDS) {
      if (id === 'wired') continue;
      const rng = deflectingRng();
      const before = rng.s;
      resolve('t20', 501, [id], { rng });
      expect(rng.s, id).toBe(before);
    }
  });
});

describe('split_tips (BOARD, adds the anticlockwise single)', () => {
  it('T20 → T20 + S5 = 65', () => {
    const r = resolve('t20', 501, ['split_tips']);
    expect(r.hits.map((h) => h.target)).toEqual([
      { region: 'T', bed: 20 },
      { region: 'S', bed: 5 },
    ]);
    expect(r.hits.map((h) => h.value)).toEqual([60, 5]);
    expect(r.totalValue).toBe(65);
    expect(r.firedChalk).toEqual(['split_tips']);
  });
  it('D20 from 45 is a BUST: both values subtract and the last hit (S5) is not a double', () => {
    const r = resolve('d20', 45, ['split_tips']);
    expect(r.scoreAfter).toBe(0);
    expect(r.outcome).toBe('BUST');
    expect(r.hits[0].countsAsDouble).toBe(false);
    expect(r.hits[1].countsAsDouble).toBe(false);
    expect(r.scoreCommitted).toBe(45);
  });
  it('D20 from 40 busts too (goes to -5)', () => expect(resolve('d20', 40, ['split_tips']).outcome).toBe('BUST'));
  it('D16 → D16 + S7 = 39', () => {
    expect(anticlockwiseAdjacent(16)).toBe(7);
    expect(value('d16', ['split_tips'])).toBe(39);
  });
  it('the second hit is always the anticlockwise neighbour from BED_ORDER', () => {
    for (let i = 0; i < 20; i++) {
      const bed = BED_ORDER[i];
      const r = resolve(`t${bed}`, 501, ['split_tips']);
      expect(r.hits[1].target).toEqual({ region: 'S', bed: BED_ORDER[(i + 19) % 20] });
    }
  });
  it('bulls have no neighbour: single hit, not fired', () => {
    for (const id of ['ob', 'ib']) {
      const r = resolve(id, 501, ['split_tips']);
      expect(r.hits).toHaveLength(1);
      expect(r.firedChalk).toEqual([]);
    }
  });
  it('IB from 50 still checks out (single hit, last hit is the bull)', () => {
    expect(resolve('ib', 50, ['split_tips']).outcome).toBe('CHECKOUT');
  });
});

describe('magnetised (BOARD, base value < 10 → S20)', () => {
  it('S5 → S20 = 20', () => {
    const r = resolve('s5', 501, ['magnetised']);
    expect(r.hits[0].target).toEqual({ region: 'S', bed: 20 });
    expect(r.totalValue).toBe(20);
    expect(r.firedChalk).toEqual(['magnetised']);
  });
  it('uses the BASE value: S5 with heavy_tips → S20 + 5 = 25, not 10', () => {
    const r = resolve('s5', 501, ['heavy_tips', 'magnetised']);
    expect(r.totalValue).toBe(25);
    expect(r.firedChalk).toEqual(['magnetised', 'heavy_tips']);
    // acquisition order of a VALUE chalk cannot matter to a BOARD chalk
    expect(value('s5', ['magnetised', 'heavy_tips'])).toBe(25);
  });
  it('uses the BASE value even when cold_hands would zero the throw', () => {
    // base S20 = 20 is not under 10, so it stays S20 and cold_hands then zeroes it
    const r = resolve('s20', 501, ['cold_hands', 'magnetised'], { throwIndex: 0 });
    expect(r.hits[0].target).toEqual({ region: 'S', bed: 20 });
    expect(r.totalValue).toBe(0);
    // S1 base 1 is under 10 even though cold_hands ×2 at index 1 would make T3=9 into 18
    const s = resolve('t3', 501, ['cold_hands', 'magnetised'], { throwIndex: 1 });
    expect(s.hits[0].target).toEqual({ region: 'S', bed: 20 });
    expect(s.totalValue).toBe(40);
  });
  it('S9, D4 (8) and T3 (9) are redirected; S10, D5 (10) and T4 (12) are not', () => {
    for (const id of ['s9', 'd4', 't3', 's1', 'd1', 't1']) expect(resolve(id, 501, ['magnetised']).hits[0].target).toEqual({ region: 'S', bed: 20 });
    for (const id of ['s10', 'd5', 't4', 'ob', 'ib']) {
      const r = resolve(id, 501, ['magnetised']);
      expect(r.hits[0].target).toEqual(resolve(id, 501).hits[0].target);
      expect(r.firedChalk).toEqual([]);
    }
  });
  it('threshold is exactly 10 across all targets', () => {
    for (const t of ALL_TARGETS) {
      const r = resolve(defIdOf(t), 501, ['magnetised']);
      if (expectedBase(t) < 10) expect(r.totalValue).toBe(20);
      else expect(r.totalValue).toBe(expectedBase(t));
    }
  });
  it('a redirected S20 counts as a double only with wide_doubles', () => {
    expect(resolve('s5', 20, ['magnetised']).outcome).toBe('BUST');
    expect(resolve('s5', 20, ['magnetised', 'wide_doubles']).outcome).toBe('CHECKOUT');
  });
});

describe('narrow_beds (BOARD, S ↔ T)', () => {
  it('S20 → T20 = 60', () => {
    const r = resolve('s20', 501, ['narrow_beds']);
    expect(r.hits[0].target).toEqual({ region: 'T', bed: 20 });
    expect(r.totalValue).toBe(60);
    expect(r.firedChalk).toEqual(['narrow_beds']);
  });
  it('T20 → S20 = 20', () => expect(value('t20', ['narrow_beds'])).toBe(20));
  it('doubles and bulls untouched, not fired', () => {
    for (const id of ['d20', 'd1', 'ob', 'ib']) {
      const r = resolve(id, 501, ['narrow_beds']);
      expect(r.totalValue).toBe(baseOf(id));
      expect(r.firedChalk).toEqual([]);
    }
  });
  it('swaps every single and treble', () => {
    for (const t of ALL_TARGETS) {
      const r = resolve(defIdOf(t), 501, ['narrow_beds']);
      const want = t.region === 'S' ? 'T' : t.region === 'T' ? 'S' : t.region;
      expect(r.hits[0].target.region).toBe(want);
    }
  });
  it('hot_twenty sees the swapped target (S20 → T20 → 80)', () => expect(value('s20', ['narrow_beds', 'hot_twenty'])).toBe(80));
});

describe('wide_doubles (RULE-evaluated BOARD chalk)', () => {
  it('S16 from 16 checks out', () => {
    const r = resolve('s16', 16, ['wide_doubles']);
    expect(r.outcome).toBe('CHECKOUT');
    expect(r.hits[0].countsAsDouble).toBe(true);
    expect(r.firedChalk).toEqual(['wide_doubles']);
  });
  it('T18 from 54 checks out', () => expect(resolve('t18', 54, ['wide_doubles']).outcome).toBe('CHECKOUT'));
  it('S20 from 20 checks out', () => expect(resolve('s20', 20, ['wide_doubles']).outcome).toBe('CHECKOUT'));
  it('S19 from 19 still busts', () => {
    const r = resolve('s19', 19, ['wide_doubles']);
    expect(r.outcome).toBe('BUST');
    expect(r.firedChalk).toEqual([]);
  });
  it('a real double is not re-flagged (not fired)', () => {
    const r = resolve('d20', 40, ['wide_doubles']);
    expect(r.outcome).toBe('CHECKOUT');
    expect(r.firedChalk).toEqual([]);
  });
  it('values are unchanged', () => {
    for (const t of ALL_TARGETS) expect(value(defIdOf(t), ['wide_doubles'])).toBe(expectedBase(t));
  });
  it('only the 16, 18 and 20 beds count', () => {
    for (const t of ALL_TARGETS) {
      const r = resolve(defIdOf(t), 501, ['wide_doubles']);
      const wide = t.bed === 16 || t.bed === 18 || t.bed === 20;
      expect(r.hits[0].countsAsDouble).toBe(wide || t.region === 'D' || t.region === 'IB');
    }
  });
  it('with split_tips, the split single is the last hit: T20 from 65 → S5 is not wide → BUST', () => {
    expect(resolve('t20', 65, ['split_tips', 'wide_doubles']).outcome).toBe('BUST');
    // but T5 splits to S12... no; S18's anticlockwise neighbour is 1, T1's is 20: T1 from 23 → S20 last → CHECKOUT
    expect(anticlockwiseAdjacent(1)).toBe(20);
    expect(resolve('t1', 23, ['split_tips', 'wide_doubles']).outcome).toBe('CHECKOUT');
  });
});

describe('mirrored (BOARD, opposite bed)', () => {
  it('T20 → T3 = 9', () => {
    const r = resolve('t20', 501, ['mirrored']);
    expect(r.hits[0].target).toEqual({ region: 'T', bed: 3 });
    expect(r.totalValue).toBe(9);
    expect(r.firedChalk).toEqual(['mirrored']);
  });
  it('S3 → S20', () => expect(resolve('s3', 501, ['mirrored']).hits[0].target).toEqual({ region: 'S', bed: 20 }));
  it('D20 → D3 keeps the region: CHECKOUT from 6', () => expect(resolve('d20', 6, ['mirrored']).outcome).toBe('CHECKOUT'));
  it('bulls untouched, not fired', () => {
    for (const id of ['ob', 'ib']) {
      const r = resolve(id, 501, ['mirrored']);
      expect(r.totalValue).toBe(baseOf(id));
      expect(r.firedChalk).toEqual([]);
    }
  });
  it('opposite is BED_ORDER[i+10] and is an involution', () => {
    for (let i = 0; i < 20; i++) {
      const bed = BED_ORDER[i];
      expect(resolve(`s${bed}`, 501, ['mirrored']).hits[0].target.bed).toBe(BED_ORDER[(i + 10) % 20]);
      expect(oppositeBed(oppositeBed(bed))).toBe(bed);
    }
  });
});

// ---------------------------------------------------------------- RULE chalk

describe('cheap_chalk (RULE)', () => {
  it('a bust commits 2 instead of reverting', () => {
    const r = resolve('t20', 50, ['cheap_chalk'], { scoreAtVisitStart: 150 });
    expect(r.outcome).toBe('BUST');
    expect(r.scoreAfter).toBe(-10);
    expect(r.scoreCommitted).toBe(2);
    expect(r.firedChalk).toEqual(['cheap_chalk']);
  });
  it('applies to every bust kind (below zero, exactly 1, zero without a double)', () => {
    expect(resolve('t20', 50, ['cheap_chalk']).scoreCommitted).toBe(2);
    expect(resolve('s20', 21, ['cheap_chalk']).scoreCommitted).toBe(2);
    expect(resolve('s20', 20, ['cheap_chalk']).scoreCommitted).toBe(2);
  });
  it('does nothing on CONTINUE or CHECKOUT (not fired)', () => {
    const c = resolve('t20', 100, ['cheap_chalk']);
    expect(c.scoreCommitted).toBe(40);
    expect(c.firedChalk).toEqual([]);
    const k = resolve('d20', 40, ['cheap_chalk']);
    expect(k.outcome).toBe('CHECKOUT');
    expect(k.firedChalk).toEqual([]);
  });
});

describe('forgiving_oche (RULE)', () => {
  it('first bust → CONTINUE, score = scoreBefore (not the visit start), forgiveness consumed', () => {
    const r = resolve('t20', 50, ['forgiving_oche'], { scoreAtVisitStart: 80 });
    expect(r.outcome).toBe('CONTINUE');
    expect(r.forgiven).toBe(true);
    expect(r.forgivenessConsumed).toBe(true);
    expect(r.scoreCommitted).toBe(50);
    expect(r.scoreAfter).toBe(-10);
    expect(r.firedChalk).toEqual(['forgiving_oche']);
  });
  it('second bust is real: reverts to the visit start', () => {
    const r = resolve('t20', 50, ['forgiving_oche'], { scoreAtVisitStart: 80, forgivenessUsed: true });
    expect(r.outcome).toBe('BUST');
    expect(r.forgiven).toBe(false);
    expect(r.forgivenessConsumed).toBe(false);
    expect(r.scoreCommitted).toBe(80);
    expect(r.firedChalk).toEqual([]);
  });
  it('forgives a 1 and a non-double zero as well', () => {
    expect(resolve('s20', 21, ['forgiving_oche']).outcome).toBe('CONTINUE');
    expect(resolve('s20', 20, ['forgiving_oche']).outcome).toBe('CONTINUE');
  });
  it('is not consumed by a non-bust', () => {
    const r = resolve('t20', 100, ['forgiving_oche']);
    expect(r.forgivenessConsumed).toBe(false);
    expect(r.firedChalk).toEqual([]);
  });
  it.each([
    ['cheap_chalk', 'forgiving_oche'],
    ['forgiving_oche', 'cheap_chalk'],
  ])('with cheap_chalk (%s then %s): forgiveness is checked first and cheap chalk does not fire', (a, b) => {
    const first = resolve('t20', 50, [a, b], { scoreAtVisitStart: 80 });
    expect(first.outcome).toBe('CONTINUE');
    expect(first.scoreCommitted).toBe(50);
    expect(first.firedChalk).toEqual(['forgiving_oche']);
    const second = resolve('t20', 50, [a, b], { scoreAtVisitStart: 80, forgivenessUsed: true });
    expect(second.outcome).toBe('BUST');
    expect(second.scoreCommitted).toBe(2);
    expect(second.firedChalk).toEqual(['cheap_chalk']);
  });
});

describe('straight_out (RULE)', () => {
  it('any exact zero is a checkout: S20 from 20', () => {
    const r = resolve('s20', 20, ['straight_out']);
    expect(r.outcome).toBe('CHECKOUT');
    expect(r.hits[0].countsAsDouble).toBe(true);
    expect(r.firedChalk).toEqual(['straight_out']);
  });
  it('T20 from 60 and OB from 25 check out', () => {
    expect(resolve('t20', 60, ['straight_out']).outcome).toBe('CHECKOUT');
    expect(resolve('ob', 25, ['straight_out']).outcome).toBe('CHECKOUT');
  });
  it('a real double still checks out and straight_out is not fired', () => {
    const r = resolve('d20', 40, ['straight_out']);
    expect(r.outcome).toBe('CHECKOUT');
    expect(r.firedChalk).toEqual([]);
  });
  it('does not make 1 or negatives legal', () => {
    expect(resolve('s20', 21, ['straight_out']).outcome).toBe('BUST');
    expect(resolve('s20', 19, ['straight_out']).outcome).toBe('BUST');
  });
  it('not fired on a plain CONTINUE', () => expect(resolve('s20', 100, ['straight_out']).firedChalk).toEqual([]));
  it('every target checks out from exactly its value', () => {
    for (const t of ALL_TARGETS) expect(resolve(defIdOf(t), expectedBase(t), ['straight_out']).outcome).toBe('CHECKOUT');
  });
});

describe('overshoot (RULE)', () => {
  it('-1 is a checkout', () => {
    const r = resolve('t20', 59, ['overshoot']);
    expect(r.scoreAfter).toBe(-1);
    expect(r.outcome).toBe('CHECKOUT');
    expect(r.scoreCommitted).toBe(0);
    expect(r.firedChalk).toEqual(['overshoot']);
  });
  it('-2 is a checkout', () => expect(resolve('t20', 58, ['overshoot']).outcome).toBe('CHECKOUT'));
  it('-3 is a bust that reverts', () => {
    const r = resolve('t20', 57, ['overshoot'], { scoreAtVisitStart: 90 });
    expect(r.outcome).toBe('BUST');
    expect(r.scoreCommitted).toBe(90);
    expect(r.firedChalk).toEqual([]);
  });
  it('does not make an exact non-double zero legal', () => expect(resolve('t20', 60, ['overshoot']).outcome).toBe('BUST'));
  it('does not make 1 legal', () => expect(resolve('t20', 61, ['overshoot']).outcome).toBe('BUST'));
  it('an exact double checkout does not fire overshoot', () => expect(resolve('d20', 40, ['overshoot']).firedChalk).toEqual([]));
  it('the overshoot checkout does not need a double (engine choice, see decisions)', () => {
    expect(resolve('s20', 19, ['overshoot']).outcome).toBe('CHECKOUT');
  });
});

describe('chalk_dust (RULE)', () => {
  it('landing on 1 → CONTINUE at 2', () => {
    const r = resolve('s20', 21, ['chalk_dust']);
    expect(r.outcome).toBe('CONTINUE');
    expect(r.scoreCommitted).toBe(2);
    expect(r.firedChalk).toEqual(['chalk_dust']);
  });
  it('landing on 2 is untouched (not fired)', () => {
    const r = resolve('s20', 22, ['chalk_dust']);
    expect(r.scoreCommitted).toBe(2);
    expect(r.firedChalk).toEqual([]);
  });
  it('zero without a double is still a bust', () => expect(resolve('s20', 20, ['chalk_dust']).outcome).toBe('BUST'));
  it('below zero is still a bust', () => expect(resolve('s20', 19, ['chalk_dust']).outcome).toBe('BUST'));
});

// ---------------------------------------------------------------- DEAL chalk

describe('DEAL chalk', () => {
  it('default hand size 3 and 3 throws per visit', () => {
    expect(handSizeFor([])).toBe(3);
    expect(throwsPerVisitFor([])).toBe(3);
  });
  it('wide_grip → hand size 4', () => expect(handSizeFor(mkChalk(['wide_grip']))).toBe(4));
  it('tunnel_vision → hand size 2', () => expect(handSizeFor(mkChalk(['tunnel_vision']))).toBe(2));
  it('wide_grip then tunnel_vision → 2 (later acquisition wins)', () => expect(handSizeFor(mkChalk(['wide_grip', 'tunnel_vision']))).toBe(2));
  it('tunnel_vision then wide_grip → 4 (later acquisition wins)', () => expect(handSizeFor(mkChalk(['tunnel_vision', 'wide_grip']))).toBe(4));
  it('acquisition order, not array position, decides', () => {
    const chalk = mkChalk(['wide_grip', 'tunnel_vision']).reverse(); // same orders, reversed array
    expect(handSizeFor(chalk)).toBe(2);
  });
  it('other chalk leaves hand size at 3', () => {
    for (const id of ALL_CHALK_IDS) if (id !== 'wide_grip' && id !== 'tunnel_vision') expect(handSizeFor(mkChalk([id]))).toBe(3);
  });
  it('fourth_dart → 4 throws per visit', () => expect(throwsPerVisitFor(mkChalk(['fourth_dart']))).toBe(4));
  it('other chalk leaves throws per visit at 3', () => {
    for (const id of ALL_CHALK_IDS) if (id !== 'fourth_dart') expect(throwsPerVisitFor(mkChalk([id]))).toBe(3);
  });
  it('tunnel_vision +20%: T20 = 72', () => {
    const r = resolve('t20', 501, ['tunnel_vision']);
    expect(r.totalValue).toBe(72);
    expect(r.firedChalk).toEqual(['tunnel_vision']);
  });
  it('tunnel_vision applies after VALUE chalk regardless of acquisition order', () => {
    expect(value('t20', ['heavy_tips', 'tunnel_vision'])).toBe(78); // (60+5)×1.2 = 78
    expect(value('t20', ['tunnel_vision', 'heavy_tips'])).toBe(78); // not 72+5 = 77
    expect(value('t20', ['tunnel_vision', 'hot_twenty'])).toBe(96); // 80×1.2
    expect(resolve('t20', 501, ['tunnel_vision', 'heavy_tips']).firedChalk).toEqual(['heavy_tips', 'tunnel_vision']);
  });
  it('tunnel_vision floors: S1 = 1, S4 = 4, S9 = 10', () => {
    expect(value('s1', ['tunnel_vision'])).toBe(1);
    expect(value('s4', ['tunnel_vision'])).toBe(4);
    expect(value('s9', ['tunnel_vision'])).toBe(10);
  });
  it.each(['wide_grip', 'fourth_dart', 'practice_board', 'chalked_up'])('%s has no value effect and never fires', (id) => {
    for (const t of ALL_TARGETS) {
      const r = resolve(defIdOf(t), 501, [id]);
      expect(r.totalValue).toBe(expectedBase(t));
      expect(r.hits[0].target).toEqual(t);
      expect(r.firedChalk).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------- acquisition order

describe('acquisition order within a stage (TDD §5.5)', () => {
  it('heavy_tips then hot_twenty on T20 = 86; hot_twenty then heavy_tips = 85', () => {
    expect(value('t20', ['heavy_tips', 'hot_twenty'])).toBe(86); // floor(65 × 4/3) = 86
    expect(value('t20', ['hot_twenty', 'heavy_tips'])).toBe(85); // 80 + 5
  });
  it('the Chalk.order field decides, not the array position', () => {
    const chalk = mkChalk(['heavy_tips', 'hot_twenty']).reverse();
    const r = resolve('t20', 501, []);
    expect(r.totalValue).toBe(60);
    const out = resolve('t20', 501, ['heavy_tips', 'hot_twenty']);
    expect(out.totalValue).toBe(86);
    // same orders, reversed array → same answer
    const rr = resolveThrow(out.intent.card, {
      chalk,
      rng: null,
      scoreBefore: 501,
      scoreAtVisitStart: 501,
      visitThrowIndex: 0,
      forgivenessUsed: false,
    }).result;
    expect(rr.totalValue).toBe(86);
    expect(rr.firedChalk).toEqual(['heavy_tips', 'hot_twenty']);
  });
  it('heavy_tips then feathered on D20 = 67; feathered then heavy_tips = 65', () => {
    expect(value('d20', ['heavy_tips', 'feathered'])).toBe(67); // floor(45 × 1.5)
    expect(value('d20', ['feathered', 'heavy_tips'])).toBe(65);
  });
  it('heavy_tips then oiled on S19 = 36; oiled then heavy_tips = 33', () => {
    expect(value('s19', ['heavy_tips', 'oiled'])).toBe(36); // floor(24 × 1.5)
    expect(value('s19', ['oiled', 'heavy_tips'])).toBe(33); // 28 + 5
  });
  it('cold_hands then heavy_tips at index 0 = 5; heavy_tips then cold_hands = 0', () => {
    expect(value('t20', ['cold_hands', 'heavy_tips'], { throwIndex: 0 })).toBe(5);
    expect(value('t20', ['heavy_tips', 'cold_hands'], { throwIndex: 0 })).toBe(0);
  });
  it('BOARD: magnetised then narrow_beds on S3 = 60; narrow_beds then magnetised = 20', () => {
    const a = resolve('s3', 501, ['magnetised', 'narrow_beds']);
    expect(a.hits[0].target).toEqual({ region: 'T', bed: 20 });
    expect(a.totalValue).toBe(60);
    expect(a.firedChalk).toEqual(['magnetised', 'narrow_beds']);
    const b = resolve('s3', 501, ['narrow_beds', 'magnetised']);
    expect(b.hits[0].target).toEqual({ region: 'S', bed: 20 });
    expect(b.totalValue).toBe(20);
    expect(b.firedChalk).toEqual(['narrow_beds', 'magnetised']);
  });
  it('BOARD: mirrored then magnetised on S3 = 20 (S20 is not under 10); magnetised then mirrored = 3', () => {
    const a = resolve('s3', 501, ['mirrored', 'magnetised']);
    expect(a.totalValue).toBe(20);
    expect(a.firedChalk).toEqual(['mirrored']);
    const b = resolve('s3', 501, ['magnetised', 'mirrored']);
    expect(b.totalValue).toBe(3);
    expect(b.firedChalk).toEqual(['magnetised', 'mirrored']);
  });
  it('BOARD: wired then split_tips on a deflected T20 = T1 + S20 = 23; split_tips then wired = T1 + S5 = 8', () => {
    const a = resolve('t20', 501, ['wired', 'split_tips'], { rng: deflectingRng() });
    expect(a.hits.map((h) => h.target)).toEqual([
      { region: 'T', bed: 1 },
      { region: 'S', bed: 20 },
    ]);
    expect(a.totalValue).toBe(23);
    expect(a.firedChalk).toEqual(['wired', 'split_tips']);
    const b = resolve('t20', 501, ['split_tips', 'wired'], { rng: deflectingRng() });
    expect(b.hits.map((h) => h.target)).toEqual([
      { region: 'T', bed: 1 },
      { region: 'S', bed: 5 },
    ]);
    expect(b.totalValue).toBe(8);
    expect(b.firedChalk).toEqual(['split_tips', 'wired']);
  });
  it('BOARD: split_tips then magnetised pulls the split single too (T20 + S5 → T20 + S20 = 80)', () => {
    const r = resolve('t20', 501, ['split_tips', 'magnetised']);
    expect(r.hits.map((h) => h.target)).toEqual([
      { region: 'T', bed: 20 },
      { region: 'S', bed: 20 },
    ]);
    expect(r.totalValue).toBe(80);
    // magnetised then split_tips: the split is added after the pull and is not re-evaluated
    expect(value('t20', ['magnetised', 'split_tips'])).toBe(65);
  });
  it('stages resolve BOARD → VALUE → RULE whatever the acquisition order', () => {
    // RULE chalk acquired first, then VALUE, then BOARD: fired order is still pipeline order
    const r = resolve('t20', 50, ['cheap_chalk', 'heavy_tips', 'split_tips']);
    expect(r.firedChalk).toEqual(['split_tips', 'heavy_tips', 'cheap_chalk']);
    expect(r.totalValue).toBe(75); // (60+5) + (5+5)
    expect(r.outcome).toBe('BUST');
    expect(r.scoreCommitted).toBe(2);
  });
  it('fired VALUE chalk is listed in acquisition order', () => {
    expect(resolve('t20', 501, ['heavy_tips', 'hot_twenty']).firedChalk).toEqual(['heavy_tips', 'hot_twenty']);
    expect(resolve('t20', 501, ['hot_twenty', 'heavy_tips']).firedChalk).toEqual(['hot_twenty', 'heavy_tips']);
  });
});

// ---------------------------------------------------------------- §7 ordering hazards

describe('§7 ordering hazards', () => {
  it('split_tips: checkout law applies to the LAST hit only; both values subtract', () => {
    // D20 + S5 = 45 from 45: exact zero, last hit S5 → BUST
    expect(resolve('d20', 45, ['split_tips']).outcome).toBe('BUST');
    // S18's anticlockwise neighbour is 1; D1's anticlockwise neighbour is 20 → last hit S20 not a double
    expect(resolve('d1', 22, ['split_tips']).outcome).toBe('BUST');
    // the first hit being a double does not help
    const r = resolve('d16', 39, ['split_tips']);
    expect(r.scoreAfter).toBe(0);
    expect(r.outcome).toBe('BUST');
    // and a checkout from a split pair is possible only through the last hit (straight_out / wide_doubles)
    expect(resolve('d16', 39, ['split_tips', 'straight_out']).outcome).toBe('CHECKOUT');
  });
  it('magnetised evaluates the BASE value, not the VALUE-stage result', () => {
    // S5 base 5 → S20; heavy_tips afterwards: 25 (not 10, and not "S5+5 = 10 ≥ 10 so no pull")
    expect(value('s5', ['heavy_tips', 'magnetised'])).toBe(25);
    // S8 base 8 → S20 even though even_keel would make it 12
    expect(value('s8', ['even_keel', 'magnetised'])).toBe(30); // S20 even → 30
    // T4 base 12 stays T4 even though cold_hands at index 0 makes it 0
    expect(resolve('t4', 501, ['cold_hands', 'magnetised'], { throwIndex: 0 }).hits[0].target).toEqual({ region: 'T', bed: 4 });
  });
  it('cheap_chalk and forgiving_oche stack: forgiveness first, then cheap chalk', () => {
    const first = resolve('t20', 50, ['cheap_chalk', 'forgiving_oche']);
    expect(first.outcome).toBe('CONTINUE');
    expect(first.firedChalk).not.toContain('cheap_chalk');
    const second = resolve('t20', 50, ['cheap_chalk', 'forgiving_oche'], { forgivenessUsed: true });
    expect(second.outcome).toBe('BUST');
    expect(second.scoreCommitted).toBe(2);
    expect(second.firedChalk).not.toContain('forgiving_oche');
  });
  it('a VALUE chalk applies once per hit, never twice: oiled on a split pair', () => {
    const acw = anticlockwiseAdjacent(19); // 3, from BED_ORDER (both odd)
    expect(acw).toBe(3);
    const r = resolve('t19', 501, ['split_tips', 'oiled']);
    expect(r.hits.map((h) => h.target)).toEqual([
      { region: 'T', bed: 19 },
      { region: 'S', bed: acw },
    ]);
    expect(r.hits.map((h) => h.value)).toEqual([85, Math.floor(acw * 1.5)]); // 57×1.5 = 85.5 → 85; 3×1.5 = 4.5 → 4
    expect(r.totalValue).toBe(85 + Math.floor(acw * 1.5));
    expect(r.firedChalk).toEqual(['split_tips', 'oiled']);
  });
  it('heavy_tips on a split pair: +5 to each hit exactly once', () => {
    const r = resolve('t20', 501, ['split_tips', 'heavy_tips']);
    expect(r.hits.map((h) => h.value)).toEqual([65, 10]);
    expect(r.totalValue).toBe(75);
    expect(r.firedChalk.filter((id) => id === 'heavy_tips')).toHaveLength(1);
  });
  it('hot_twenty on a split pair only touches the T20 hit', () => {
    const r = resolve('t20', 501, ['split_tips', 'hot_twenty']);
    expect(r.hits.map((h) => h.value)).toEqual([80, 5]);
  });
  it('bust conditions are evaluated in order: below zero before exactly-1 before non-double zero', () => {
    // overshoot (below zero) wins over chalk_dust at -1
    const a = resolve('t20', 59, ['chalk_dust', 'overshoot']);
    expect(a.outcome).toBe('CHECKOUT');
    expect(a.firedChalk).toEqual(['overshoot']);
    // exactly 1 with chalk_dust is a CONTINUE even with straight_out held
    const b = resolve('s20', 21, ['straight_out', 'chalk_dust']);
    expect(b.outcome).toBe('CONTINUE');
    expect(b.scoreCommitted).toBe(2);
    // non-double zero with straight_out is a CHECKOUT even with chalk_dust held
    const c = resolve('s20', 20, ['chalk_dust', 'straight_out']);
    expect(c.outcome).toBe('CHECKOUT');
  });
  it('countsAsDouble is decided on the final hit after BOARD chalk', () => {
    // mirrored D20 → D3: still a double; narrow_beds turns S16 into T16: wide_doubles still applies to the 16 bed
    expect(resolve('d20', 6, ['mirrored']).hits[0].countsAsDouble).toBe(true);
    expect(resolve('s16', 48, ['narrow_beds', 'wide_doubles']).outcome).toBe('CHECKOUT');
    // mirrored S20 → S3: no longer in a wide bed
    expect(resolve('s20', 3, ['mirrored', 'wide_doubles']).outcome).toBe('BUST');
  });
  it('scoreAfter is the raw arithmetic; scoreCommitted is the consequence', () => {
    const r = resolve('t20', 10, [], { scoreAtVisitStart: 70 });
    expect(r.scoreAfter).toBe(-50);
    expect(r.scoreCommitted).toBe(70);
    const k = resolve('d20', 40);
    expect(k.scoreAfter).toBe(0);
    expect(k.scoreCommitted).toBe(0);
  });
});

// ---------------------------------------------------------------- flooring

describe('flooring (TDD §7 4.3): values are integers and never round up', () => {
  const VALUE_MULTIPLIERS: Record<string, (t: Target, base: number, ti: number) => number> = {
    hot_twenty: (t, b) => (t.region === 'T' && t.bed === 20 ? (b * 4) / 3 : b),
    feathered: (t, b) => (t.region === 'D' ? b * 1.5 : b),
    heavy_tips: (_t, b) => b + 5,
    oiled: (t, b) => (t.bed !== undefined && t.bed % 2 === 1 ? b * 1.5 : b),
    even_keel: (t, b) => (t.bed !== undefined && t.bed % 2 === 0 ? b * 1.5 : b),
    cold_hands: (_t, b, ti) => (ti === 0 ? 0 : ti === 3 ? b : b * 2),
    last_orders: (_t, b, ti) => (ti === 2 ? b * 2 : b),
    bullish: (t, b) => (t.region === 'OB' || t.region === 'IB' ? 75 : b),
    tunnel_vision: (_t, b) => b * 1.2,
  };

  it.each(Object.keys(VALUE_MULTIPLIERS))('%s: engine value = floor(exact value) for every target and throw index', (id) => {
    const f = VALUE_MULTIPLIERS[id];
    for (const t of ALL_TARGETS) {
      for (const ti of [0, 1, 2, 3] as const) {
        const exact = f(t, expectedBase(t), ti);
        const v = value(defIdOf(t), [id], { throwIndex: ti });
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBe(Math.floor(exact + 1e-9));
        expect(v).toBeLessThanOrEqual(exact + 1e-9);
      }
    }
  });

  it('half values floor down: S19 oiled 28, T19 oiled 85, S3 oiled 4, S2 even_keel 3, S6 even_keel 9', () => {
    expect(value('s19', ['oiled'])).toBe(28);
    expect(value('t19', ['oiled'])).toBe(85);
    expect(value('s3', ['oiled'])).toBe(4);
    expect(value('s2', ['even_keel'])).toBe(3);
    expect(value('s6', ['even_keel'])).toBe(9);
  });

  it('every chalk on every target at every throw index yields a non-negative integer', () => {
    for (const id of ALL_CHALK_IDS) {
      for (const t of ALL_TARGETS) {
        for (const ti of [0, 1, 2, 3] as const) {
          const r = resolve(defIdOf(t), 501, [id], { throwIndex: ti, rng: deflectingRng() });
          expect(Number.isInteger(r.totalValue)).toBe(true);
          expect(r.totalValue).toBeGreaterThanOrEqual(0);
          for (const h of r.hits) expect(Number.isInteger(h.value)).toBe(true);
          expect(r.totalValue).toBe(r.hits.reduce((a, h) => a + h.value, 0));
        }
      }
    }
  });

  it('all 24 chalk held at once still produce integer totals with no duplicate fired ids', () => {
    for (const t of ALL_TARGETS) {
      for (const ti of [0, 1, 2, 3] as const) {
        const r = resolve(defIdOf(t), 501, ALL_CHALK_IDS, { throwIndex: ti, rng: deflectingRng() });
        expect(Number.isInteger(r.totalValue)).toBe(true);
        expect(new Set(r.firedChalk).size).toBe(r.firedChalk.length);
      }
    }
  });
});

// ---------------------------------------------------------------- firedChalk contract

describe('firedChalk', () => {
  it('is empty with no chalk for every target', () => {
    for (const t of ALL_TARGETS) expect(resolve(defIdOf(t), 501).firedChalk).toEqual([]);
  });
  it.each([
    ['hot_twenty', 's20', 501],
    ['feathered', 't20', 501],
    ['oiled', 's20', 501],
    ['even_keel', 's19', 501],
    ['bullish', 't20', 501],
    ['narrow_beds', 'd20', 501],
    ['mirrored', 'ib', 501],
    ['magnetised', 't20', 501],
    ['split_tips', 'ob', 501],
    ['wired', 't20', 501],
    ['cheap_chalk', 't20', 501],
    ['forgiving_oche', 't20', 501],
    ['straight_out', 't20', 501],
    ['overshoot', 't20', 501],
    ['chalk_dust', 't20', 501],
    ['wide_doubles', 't19', 501],
    ['wide_grip', 't20', 501],
    ['fourth_dart', 't20', 501],
    ['practice_board', 't20', 501],
    ['chalked_up', 't20', 501],
  ])('%s is not listed when it changed nothing (%s from %i)', (id, defId, score) => {
    expect(resolve(defId, score, [id]).firedChalk).toEqual([]);
  });
  it('cold_hands at index 3 and last_orders at index 0 are not listed', () => {
    expect(resolve('t20', 501, ['cold_hands'], { throwIndex: 3 }).firedChalk).toEqual([]);
    expect(resolve('t20', 501, ['last_orders'], { throwIndex: 0 }).firedChalk).toEqual([]);
  });
  it('lists every chalk that fired, in pipeline order, once each', () => {
    // BOARD (acq order) → VALUE (acq order) → tunnel_vision → wide_doubles → RULE
    const ids = ['straight_out', 'tunnel_vision', 'heavy_tips', 'mirrored', 'split_tips', 'wide_doubles', 'hot_twenty'];
    // T3 → mirrored → T20, split → +S5; hot_twenty 80, heavy +5 each; tunnel ×1.2; last hit S5 is not wide
    const r = resolve('t3', 1000, ids);
    expect(r.firedChalk).toEqual(['mirrored', 'split_tips', 'heavy_tips', 'hot_twenty', 'tunnel_vision']);
    // T20: 60 → +5 = 65 → ×4/3 floored = 86 → ×1.2 floored = 103. S5: 5 → +5 = 10 → ×1.2 = 12. Floor at every step.
    const t20 = Math.floor((Math.floor(((60 + 5) * 4) / 3) * 6) / 5);
    expect(t20).toBe(103);
    expect(r.hits.map((h) => h.value)).toEqual([t20, Math.floor(((5 + 5) * 6) / 5)]);
    expect(r.totalValue).toBe(115);
  });
  it('the fired ids are all real chalk ids the throw was resolved with', () => {
    for (const t of ALL_TARGETS) {
      const r = resolve(defIdOf(t), 100, ALL_CHALK_IDS, { rng: deflectingRng() });
      for (const id of r.firedChalk) expect(ALL_CHALK_IDS).toContain(id);
    }
  });
  it('wired listed only when it actually deflected', () => {
    expect(resolve('t20', 501, ['wired'], { rng: deflectingRng() }).firedChalk).toEqual(['wired']);
    expect(resolve('t20', 501, ['wired'], { rng: nonDeflectingRng() }).firedChalk).toEqual([]);
  });
});

// ---------------------------------------------------------------- misc invariants

describe('pipeline invariants', () => {
  it('hits[i].countsAsDouble is false for every non-final hit', () => {
    for (const t of ALL_TARGETS) {
      const r = resolve(defIdOf(t), 501, ['split_tips', 'wide_doubles', 'straight_out']);
      for (let i = 0; i < r.hits.length - 1; i++) expect(r.hits[i].countsAsDouble).toBe(false);
    }
  });
  it('totalValue is always the sum of the hits', () => {
    for (const id of ALL_CHALK_IDS) {
      for (const t of ALL_TARGETS) {
        const r = resolve(defIdOf(t), 501, [id, 'split_tips'], { rng: deflectingRng() });
        expect(r.totalValue).toBe(r.hits.reduce((a, h) => a + h.value, 0));
        expect(r.scoreAfter === r.scoreBefore - r.totalValue || r.firedChalk.includes('chalk_dust')).toBe(true);
      }
    }
  });
  it('the input card is never mutated by BOARD chalk', () => {
    const card = mkCard('t20');
    resolveThrow(card, { chalk: mkChalk(['mirrored', 'narrow_beds', 'split_tips']), rng: null, scoreBefore: 501, scoreAtVisitStart: 501, visitThrowIndex: 0, forgivenessUsed: false });
    expect(card.target).toEqual({ region: 'T', bed: 20 });
  });
  it('a checkout always commits 0 and a plain bust always commits the visit start', () => {
    for (const t of ALL_TARGETS) {
      const v = expectedBase(t);
      const k = resolve(defIdOf(t), v, ['straight_out'], { scoreAtVisitStart: 300 });
      expect(k.outcome).toBe('CHECKOUT');
      expect(k.scoreCommitted).toBe(0);
      const b = resolve(defIdOf(t), v - 1, [], { scoreAtVisitStart: 300 });
      expect(b.outcome).toBe('BUST');
      expect(b.scoreCommitted).toBe(300);
    }
  });
  it('the neighbour helpers agree with BED_ORDER', () => {
    for (let i = 0; i < 20; i++) {
      const bed: Bed = BED_ORDER[i];
      expect(clockwiseAdjacent(anticlockwiseAdjacent(bed))).toBe(bed);
      expect(anticlockwiseAdjacent(clockwiseAdjacent(bed))).toBe(bed);
    }
  });
});
