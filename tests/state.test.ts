/**
 * The night state machine (TDD §2, §3.3, §3.4, §4, §4.1, §6.1, §9): library
 * per oche, legs and visit limits, dealing and the discard, bust, timeout,
 * checkout and the Pot breakdown, the shop, night end, achievements, stats.
 */
import { describe, expect, it } from 'vitest';
import { STARTING_LIBRARY, THIN_LIBRARY, cardCost, SHOP_CARD_POOL } from '../src/content/cards.ts';
import { CHALK_DEFS, chalkDef } from '../src/content/chalkdefs.ts';
import { LEGS, LEG_COUNT, SERVICE_COST, SHOP_REFRESH_COST, STARTING_SCORE } from '../src/content/legs.ts';
import { OCHES } from '../src/content/oches.ts';
import {
  generateShop,
  addChalk,
  beginLeg,
  cardPrice,
  commitCard,
  createNight,
  currentLeg,
  currentVisit,
  hasChalk,
  legName,
  shopBuy,
  shopLeave,
  shopRefresh,
  visitTotal,
} from '../src/core/state.ts';
import type { EngineEvent, NightState, OcheId, ShopSlot } from '../src/core/types.ts';
import { composition, dealFromPool, eventTypes, play, playAll, setScore, startNight } from './helpers.ts';

function expand(lib: [string, number][]): { defId: string }[] {
  const out: { defId: string }[] = [];
  for (const [d, n] of lib) for (let i = 0; i < n; i++) out.push({ defId: d });
  return out;
}

function ev<T extends EngineEvent['type']>(events: EngineEvent[], type: T): Extract<EngineEvent, { type: T }> {
  const e = events.find((x) => x.type === type);
  if (!e) throw new Error(`no ${type} in [${eventTypes(events)}]`);
  return e as Extract<EngineEvent, { type: T }>;
}

/** A night in the shop after a one-visit D20 checkout from 40 on leg 1, with `pot` Pot. */
function inShop(seed = 11, pot = 50): NightState {
  const n = startNight(seed);
  setScore(n, 40);
  play(n, 'd20');
  expect(n.phase).toBe('SHOP');
  n.pot = pot;
  return n;
}

function setSlot(n: NightState, i: number, slot: ShopSlot): void {
  (n.shop as NonNullable<NightState['shop']>).slots[i] = slot;
}

// ---------------------------------------------------------------- creation / oches

describe('starting library per oche (TDD §6.1, §9.4)', () => {
  it('The Local: the 24-card starting library (DECISIONS.md #45)', () => {
    const n = createNight(1, 'local');
    expect(n.library).toHaveLength(24);
    expect(composition(n.library)).toBe(composition(expand(STARTING_LIBRARY)));
    expect(composition(n.library)).toBe('d1×1 d16×1 d2×1 d20×1 d4×1 d8×1 ob×1 s1×1 s12×2 s16×2 s18×2 s19×2 s20×3 s3×1 s5×1 s7×1 t19×1 t20×1');
  });
  it('the default oche is The Local', () => {
    const n = createNight(1);
    expect(n.oche).toBe('local');
    expect(composition(n.library)).toBe(composition(createNight(1, 'local').library));
  });
  it('The Sharp: T18 and T17 replace the S1 (25 cards)', () => {
    const n = createNight(1, 'sharp');
    expect(n.library).toHaveLength(25);
    const c = composition(n.library);
    expect(c).not.toContain('s1×');
    expect(c).toContain('t18×1');
    expect(c).toContain('t17×1');
    const expected = expand(STARTING_LIBRARY).filter((x) => x.defId !== 's1').concat([{ defId: 't18' }, { defId: 't17' }]);
    expect(c).toBe(composition(expected));
  });
  it('The Thin: 12 cards', () => {
    const n = createNight(1, 'thin');
    expect(n.library).toHaveLength(12);
    expect(composition(n.library)).toBe(composition(expand(THIN_LIBRARY)));
    expect(n.library.some((c) => c.defId === 'd16')).toBe(true);
    expect(n.library.some((c) => c.defId === 'd20')).toBe(true);
  });
  it('The Steady: starts holding forgiving_oche, nothing else', () => {
    const n = createNight(1, 'steady');
    expect(n.chalk.map((c) => c.def.id)).toEqual(['forgiving_oche']);
    expect(hasChalk(n, 'forgiving_oche')).toBe(true);
    expect(n.chalk[0].order).toBe(1);
    expect(n.chalkSlots).toBe(5);
    expect(n.library).toHaveLength(24);
  });
  it('The Wide: 6 chalk slots and +2 on every card price', () => {
    const n = createNight(1, 'wide');
    expect(n.chalkSlots).toBe(6);
    expect(n.chalk).toEqual([]);
    for (const [id] of SHOP_CARD_POOL) expect(cardPrice(n, id)).toBe(cardCost(id) + 2);
    expect(cardPrice(createNight(1, 'local'), 't20')).toBe(cardCost('t20'));
  });
  it('The Wide shop offers are priced with the +2', () => {
    const n = startNight(3, 'wide');
    setScore(n, 40);
    play(n, 'd20');
    for (const s of (n.shop as NonNullable<NightState['shop']>).slots) if (s.kind === 'CARD') expect(s.cost).toBe(cardCost(s.defId) + 2);
  });
  it('every other oche has 5 chalk slots and no chalk', () => {
    for (const o of ['local', 'sharp', 'thin', 'wide'] as OcheId[]) {
      const n = createNight(1, o);
      expect(n.chalk).toEqual([]);
      if (o !== 'wide') expect(n.chalkSlots).toBe(5);
    }
  });
  it('fresh night invariants: pot 0, leg 0, ACTIVE, phase LEG, no legs yet, unique card ids, flights 0..3', () => {
    for (const o of OCHES) {
      const n = createNight(7, o.id);
      expect(n.pot).toBe(0);
      expect(n.legIndex).toBe(0);
      expect(n.status).toBe('ACTIVE');
      expect(n.phase).toBe('LEG');
      expect(n.legs).toEqual([]);
      expect(n.shop).toBeNull();
      expect(new Set(n.library.map((c) => c.id)).size).toBe(n.library.length);
      for (const c of n.library) expect([0, 1, 2, 3]).toContain(c.flight);
      expect(n.achievements).toEqual([]);
      expect(n.consecutiveBusts).toBe(0);
    }
  });
  it('the five oches are defined with the TDD names', () => {
    expect(OCHES.map((o) => o.name)).toEqual(['The Local', 'The Sharp', 'The Steady', 'The Wide', 'The Thin']);
  });
});

// ---------------------------------------------------------------- legs

describe('legs and visit limits (TDD §4)', () => {
  it('the LEGS table is the TDD table', () => {
    expect(LEG_COUNT).toBe(8);
    expect(LEGS.map((l) => l.visitLimit)).toEqual([12, 11, 10, 9, 8, 7, 6, 5]);
    expect(LEGS.map((l) => l.reward)).toEqual([4, 6, 8, 9, 11, 13, 15, 0]);
    expect(LEGS.map((l) => l.name)).toEqual(['First Round', 'Second Round', 'Quarter', 'Interval', 'Semi', 'Last Four', 'Final', 'The Decider']);
    expect(STARTING_SCORE).toBe(501);
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('leg %i takes its visit limit and name from LEGS', (i) => {
    const n = createNight(1);
    n.legIndex = i;
    beginLeg(n);
    const leg = currentLeg(n);
    expect(leg.index).toBe(i);
    expect(leg.visitLimit).toBe(LEGS[i].visitLimit);
    expect(legName(i)).toBe(LEGS[i].name);
  });
  it('beginLeg: 501, one visit, a 3-card hand from a 24-card shuffled copy of the library', () => {
    const n = createNight(5);
    const events = beginLeg(n);
    const leg = currentLeg(n);
    expect(eventTypes(events)).toEqual(['LEG_START', 'HAND_DEALT']);
    expect(ev(events, 'LEG_START').legIndex).toBe(0);
    const dealt = ev(events, 'HAND_DEALT');
    expect(dealt.visitIndex).toBe(0);
    expect(dealt.throwIndex).toBe(0);
    expect(dealt.hand.map((c) => c.id)).toEqual(leg.hand.map((c) => c.id));
    expect(leg.score).toBe(501);
    expect(leg.visits).toHaveLength(1);
    expect(leg.visits[0]).toMatchObject({ index: 0, scoreAtVisitStart: 501, throws: [], busted: false });
    expect(leg.hand).toHaveLength(3);
    expect(leg.deck).toHaveLength(21);
    expect(leg.discard).toEqual([]);
    expect(leg.status).toBe('ACTIVE');
    expect(leg.bustsThisLeg).toBe(0);
    expect(leg.forgivenessUsed).toBe(false);
    expect(composition([...leg.deck, ...leg.hand])).toBe(composition(n.library));
    expect(new Set([...leg.deck, ...leg.hand].map((c) => c.id))).toEqual(new Set(n.library.map((c) => c.id)));
    expect(n.stats.visitsPlayed).toBe(1);
  });
  it('the leg deck holds copies: mutating a deck card does not touch the library', () => {
    const n = startNight(5);
    const leg = currentLeg(n);
    const card = leg.deck[0];
    const lib = n.library.find((c) => c.id === card.id) as NonNullable<(typeof n.library)[number]>;
    expect(lib).not.toBe(card);
    card.target.bed = 1;
    expect(lib.target.bed).not.toBe(1);
  });
  it('hand size follows DEAL chalk: wide_grip 4, tunnel_vision 2', () => {
    expect(currentLeg(startNight(1, 'local', ['wide_grip'])).hand).toHaveLength(4);
    expect(currentLeg(startNight(1, 'local', ['tunnel_vision'])).hand).toHaveLength(2);
    expect(currentLeg(startNight(1, 'local', ['wide_grip', 'tunnel_vision'])).hand).toHaveLength(2);
  });
  it('the deck is reshuffled at the start of each leg', () => {
    const n = startNight(9);
    const first = currentLeg(n).deck.map((c) => c.id).join(',');
    setScore(n, 40);
    play(n, 'd20');
    shopLeave(n);
    const second = currentLeg(n).deck.map((c) => c.id).join(',');
    expect(second).not.toBe(first);
    expect(currentLeg(n).index).toBe(1);
  });
  it('beginLeg throws once the night is over', () => {
    const n = startNight(1);
    n.status = 'LOST';
    expect(() => beginLeg(n)).toThrow();
  });
});

// ---------------------------------------------------------------- dealing

describe('dealing and the discard (TDD §3.3)', () => {
  it('commit removes the card; the uncommitted cards go to the discard; a new hand is dealt', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    const [a, b, c] = leg.hand;
    const { events } = commitCard(n, b.id);
    expect(eventTypes(events)).toEqual(['THROW', 'HAND_DEALT']);
    expect(ev(events, 'HAND_DEALT').throwIndex).toBe(1);
    expect(leg.discard.map((x) => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(leg.hand).toHaveLength(3);
    expect(leg.deck).toHaveLength(18);
    expect(leg.hand.some((x) => x.id === b.id)).toBe(false);
    expect(composition([...leg.deck, ...leg.hand, ...leg.discard])).toBe(composition(n.library));
    expect(currentVisit(leg).throws[0].intent.card.id).toBe(b.id);
  });
  it('practice_board: the uncommitted cards go under the deck in hand order; only the committed card is discarded', () => {
    const n = startNight(2, 'local', ['practice_board']);
    const leg = currentLeg(n);
    const [a, b, c] = leg.hand;
    commitCard(n, a.id);
    expect(leg.discard.map((x) => x.id)).toEqual([a.id]);
    expect(leg.deck.slice(-2).map((x) => x.id)).toEqual([b.id, c.id]);
    expect(leg.deck).toHaveLength(20);
    expect(leg.hand).toHaveLength(3);
  });
  it('the hand is dealt from the front of the deck', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    const next = leg.deck.slice(0, 3).map((x) => x.id);
    commitCard(n, leg.hand[0].id);
    expect(leg.hand.map((x) => x.id)).toEqual(next);
  });
  it('the deck persists across visits and is reshuffled from the discard when it empties', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    setScore(n, 100000);
    let sawEmpty = false;
    let reshuffled = false;
    let prevDeck = leg.deck.length;
    for (let i = 0; i < 12; i++) {
      commitCard(n, leg.hand[0].id);
      if (leg.status !== 'ACTIVE') break;
      const pool = [...leg.deck, ...leg.hand, ...leg.discard];
      expect(pool).toHaveLength(24);
      expect(new Set(pool.map((c) => c.id)).size).toBe(24);
      if (leg.deck.length > prevDeck) reshuffled = true; // the discard came back
      if (leg.deck.length < 3) sawEmpty = true;
      prevDeck = leg.deck.length;
    }
    expect(sawEmpty).toBe(true);
    expect(reshuffled).toBe(true);
    // 8 throws × 3 cards = 24 dealt: the discard was shuffled in exactly when needed
    expect(leg.deck.length + leg.hand.length + leg.discard.length).toBe(24);
  });
  it('committing a card that is not in the hand throws', () => {
    const n = startNight(2);
    expect(() => commitCard(n, 'nope')).toThrow();
    const notInHand = currentLeg(n).deck[0];
    expect(() => commitCard(n, notInHand.id)).toThrow();
  });
  it('the hand is empty once the leg is over', () => {
    const n = startNight(2);
    setScore(n, 40);
    play(n, 'd20');
    expect(currentLeg(n).hand).toEqual([]);
  });
  it('a tiny library still deals what it has', () => {
    const n = startNight(2, 'local', ['practice_board']);
    const leg = currentLeg(n);
    leg.deck = [];
    leg.discard = [];
    leg.hand = leg.hand.slice(0, 2);
    setScore(n, 100000);
    commitCard(n, leg.hand[0].id);
    expect(leg.hand.length).toBeGreaterThanOrEqual(1);
    expect(leg.hand.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------- bust

describe('bust (TDD §3.4)', () => {
  it('reverts to the visit-start score, ends the visit and counts against the limit', () => {
    const n = startNight(5);
    setScore(n, 100);
    play(n, 't20');
    expect(currentLeg(n).score).toBe(40);
    const { result, events } = play(n, 't20');
    const leg = currentLeg(n);
    expect(result.outcome).toBe('BUST');
    expect(result.scoreAfter).toBe(-20);
    expect(leg.score).toBe(100);
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'HAND_DEALT']);
    expect(ev(events, 'VISIT_END').busted).toBe(true);
    expect(ev(events, 'VISIT_END').total).toBe(0);
    expect(leg.visits).toHaveLength(2);
    expect(leg.visits[0].busted).toBe(true);
    expect(leg.visits[0].throws).toHaveLength(2);
    expect(leg.visits[1].scoreAtVisitStart).toBe(100);
    expect(leg.visits[1].throws).toEqual([]);
    expect(leg.bustsThisLeg).toBe(1);
    expect(n.stats.busts).toBe(1);
    expect(n.consecutiveBusts).toBe(1);
    expect(visitTotal(leg.visits[0])).toBe(0);
  });
  it('exactly 1 is a bust', () => {
    const n = startNight(5);
    setScore(n, 21);
    expect(play(n, 's20').result.outcome).toBe('BUST');
    expect(currentLeg(n).score).toBe(21);
  });
  it('exactly 0 without a double is a bust: S20 from 20, T20 from 60, OB from 25', () => {
    for (const [card, score] of [
      ['s20', 20],
      ['t20', 60],
      ['ob', 25],
    ] as const) {
      const n = startNight(5);
      setScore(n, score);
      expect(play(n, card).result.outcome).toBe('BUST');
      expect(currentLeg(n).status).toBe('ACTIVE');
      expect(currentLeg(n).score).toBe(score);
    }
  });
  it('twelve busts on leg 1 use up the visit limit and lose the night', () => {
    const n = startNight(5);
    const leg = currentLeg(n);
    let last: { events: EngineEvent[] } | null = null;
    for (let v = 0; v < 12; v++) {
      expect(leg.visits).toHaveLength(v + 1);
      setScore(n, 10);
      last = play(n, 't20');
    }
    expect(leg.visits).toHaveLength(12);
    expect(leg.bustsThisLeg).toBe(12);
    expect(n.status).toBe('LOST');
    expect(eventTypes((last as { events: EngineEvent[] }).events)).toEqual(['THROW', 'VISIT_END', 'LEG_TIMEOUT', 'NIGHT_LOST']);
  });
  it('forgiving_oche: the first bust of the leg is ignored and the visit continues', () => {
    const n = startNight(5, 'local', ['forgiving_oche']);
    setScore(n, 100);
    play(n, 't20');
    const { result, events } = play(n, 't20');
    const leg = currentLeg(n);
    expect(result.outcome).toBe('CONTINUE');
    expect(result.forgiven).toBe(true);
    expect(leg.forgivenessUsed).toBe(true);
    expect(leg.score).toBe(40);
    expect(eventTypes(events)).toEqual(['THROW', 'HAND_DEALT']);
    expect(leg.visits).toHaveLength(1);
    expect(currentVisit(leg).throws).toHaveLength(2);
    expect(n.stats.busts).toBe(0);
    // the second bust is real
    const second = play(n, 't20');
    expect(second.result.outcome).toBe('BUST');
    expect(leg.score).toBe(100);
    expect(leg.visits).toHaveLength(2);
    expect(n.stats.busts).toBe(1);
    // forgiveness is per leg: a new leg gets it back
    setScore(n, 40);
    play(n, 'd20');
    shopLeave(n);
    expect(currentLeg(n).forgivenessUsed).toBe(false);
  });
  it('cheap_chalk: a bust drops the score to 2 and still ends the visit', () => {
    const n = startNight(5, 'local', ['cheap_chalk']);
    setScore(n, 100);
    play(n, 't20');
    const { result } = play(n, 't20');
    expect(result.outcome).toBe('BUST');
    expect(currentLeg(n).score).toBe(2);
    expect(currentLeg(n).visits).toHaveLength(2);
    expect(currentLeg(n).visits[1].scoreAtVisitStart).toBe(2);
  });
  it('a visit total counts the forgiven throw as 0 and a busted visit as 0', () => {
    const n = startNight(5, 'local', ['forgiving_oche']);
    setScore(n, 100);
    play(n, 't20');
    play(n, 't20'); // forgiven
    play(n, 's20');
    const v = currentLeg(n).visits[0];
    expect(v.throws).toHaveLength(3);
    expect(visitTotal(v)).toBe(80);
  });
});

// ---------------------------------------------------------------- timeout

describe('timeout (TDD §9.1)', () => {
  it('running out of visits with score > 0 loses the night: LOST, OVER, LEG_TIMEOUT + NIGHT_LOST', () => {
    const n = startNight(6);
    setScore(n, 100000);
    let last: { events: EngineEvent[] } | null = null;
    let throws = 0;
    while (n.status === 'ACTIVE') {
      last = play(n, 's1');
      throws++;
    }
    const leg = currentLeg(n);
    expect(throws).toBe(36);
    expect(leg.visits).toHaveLength(12);
    expect(leg.status).toBe('TIMED_OUT');
    expect(n.status).toBe('LOST');
    expect(n.phase).toBe('OVER');
    expect(n.shop).toBeNull();
    expect(leg.hand).toEqual([]);
    expect(eventTypes((last as { events: EngineEvent[] }).events)).toEqual(['THROW', 'VISIT_END', 'LEG_TIMEOUT', 'NIGHT_LOST']);
    expect(ev((last as { events: EngineEvent[] }).events, 'LEG_TIMEOUT').legIndex).toBe(0);
    expect(() => commitCard(n, 'x')).toThrow();
    expect(n.legs).toHaveLength(1);
  });
  it('a timeout on any leg ends the night (leg 3)', () => {
    const n = createNight(6);
    n.legIndex = 2;
    beginLeg(n);
    setScore(n, 100000);
    while (n.status === 'ACTIVE') play(n, 's1');
    expect(currentLeg(n).visits).toHaveLength(10);
    expect(n.status).toBe('LOST');
    expect(n.stats.legsWon).toBe(0);
  });
  it('the visit limit is not reached while the score can still be finished on the last visit', () => {
    const n = startNight(6);
    const leg = currentLeg(n);
    setScore(n, 100000);
    for (let i = 0; i < 33; i++) play(n, 's1');
    expect(leg.visits).toHaveLength(12);
    expect(n.status).toBe('ACTIVE');
    setScore(n, 40);
    play(n, 'd20');
    expect(n.status).toBe('ACTIVE');
    expect(leg.status).toBe('CHECKED_OUT');
  });
});

// ---------------------------------------------------------------- checkout and the pot

describe('checkout (TDD §9.2) and the Pot (TDD §4)', () => {
  it('D20 from 40 on visit 1 of leg 1: CHECKED_OUT, pot 4 + 11 unused + 3 clean = 18, shop opens', () => {
    const n = startNight(7);
    setScore(n, 40);
    const { result, events } = play(n, 'd20');
    const leg = currentLeg(n);
    expect(result.outcome).toBe('CHECKOUT');
    expect(leg.status).toBe('CHECKED_OUT');
    expect(leg.score).toBe(0);
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'CHECKOUT', 'ACHIEVEMENT', 'SHOP_OPEN']);
    expect(ev(events, 'VISIT_END').busted).toBe(false);
    expect(leg.reward).toEqual({ base: 4, unusedVisits: 11, bigFinish: 0, cleanLeg: 3, nineDarter: 0, total: 18, checkoutFrom: 40, visitsUsed: 1 });
    expect(ev(events, 'CHECKOUT').reward).toEqual(leg.reward);
    expect(ev(events, 'CHECKOUT').legIndex).toBe(0);
    expect(n.pot).toBe(18);
    expect(n.phase).toBe('SHOP');
    expect(n.status).toBe('ACTIVE');
    expect(n.stats.legsWon).toBe(1);
    expect(n.stats.potEarned).toBe(18);
    expect(n.stats.bestCheckout).toBe(40);
    expect(n.stats.cleanLegs).toBe(1);
    expect(n.stats.bigFinishes).toBe(0);
  });
  it('a big finish (checkout from ≥ 100) adds 2', () => {
    const n = startNight(7);
    setScore(n, 100);
    play(n, 't20');
    play(n, 'd20');
    expect(currentLeg(n).reward).toMatchObject({ base: 4, unusedVisits: 11, bigFinish: 2, cleanLeg: 3, nineDarter: 0, total: 20, checkoutFrom: 100 });
    expect(n.pot).toBe(20);
    expect(n.stats.bigFinishes).toBe(1);
  });
  it('checkoutFrom is the score at the start of the finishing visit, not the last dart', () => {
    const n = startNight(7);
    setScore(n, 99);
    play(n, 't20');
    play(n, 's7');
    play(n, 'd16');
    expect(currentLeg(n).reward?.checkoutFrom).toBe(99);
    expect(currentLeg(n).reward?.bigFinish).toBe(0);
    expect(n.achievements).not.toContain('sharp');
  });
  it('a bust in the leg forfeits the clean-leg bonus', () => {
    const n = startNight(7);
    setScore(n, 10);
    play(n, 't20'); // bust, visit 1
    setScore(n, 40);
    play(n, 'd20'); // visit 2
    expect(currentLeg(n).reward).toMatchObject({ base: 4, unusedVisits: 10, bigFinish: 0, cleanLeg: 0, nineDarter: 0, total: 14, visitsUsed: 2 });
    expect(n.stats.cleanLegs).toBe(0);
  });
  it('a nine-darter: 501 in three visits, +5, with two ONE_EIGHTY events on the way', () => {
    const n = startNight(8);
    const v1 = playAll(n, ['t20', 't20', 't20']);
    expect(eventTypes(v1.events)).toEqual(['THROW', 'VISIT_END', 'ONE_EIGHTY', 'HAND_DEALT']);
    expect(currentLeg(n).score).toBe(321);
    const v2 = playAll(n, ['t20', 't20', 't20']);
    expect(ev(v2.events, 'ONE_EIGHTY').total).toBe(180);
    expect(currentLeg(n).score).toBe(141);
    const v3 = playAll(n, ['t20', 't19', 'd12']);
    expect(eventTypes(v3.events)).toEqual(['THROW', 'VISIT_END', 'CHECKOUT', 'ACHIEVEMENT', 'ACHIEVEMENT', 'SHOP_OPEN']);
    expect(currentLeg(n).reward).toEqual({ base: 4, unusedVisits: 9, bigFinish: 2, cleanLeg: 3, nineDarter: 5, total: 23, checkoutFrom: 141, visitsUsed: 3 });
    expect(n.pot).toBe(23);
    expect(n.stats.nineDarters).toBe(1);
    expect(n.stats.oneEighties).toBe(2);
    expect(n.stats.bestVisit).toBe(180);
    expect(n.stats.throwsMade).toBe(9);
  });
  it.each([0, 1, 2, 3, 4, 5, 6])('leg %i: base reward from LEGS plus one unused visit per visit not used', (i) => {
    const n = createNight(9);
    n.legIndex = i;
    beginLeg(n);
    setScore(n, 40);
    play(n, 'd20');
    expect(currentLeg(n).reward).toMatchObject({ base: LEGS[i].reward, unusedVisits: LEGS[i].visitLimit - 1, cleanLeg: 3, total: LEGS[i].reward + LEGS[i].visitLimit - 1 + 3 });
    expect(n.pot).toBe(LEGS[i].reward + LEGS[i].visitLimit - 1 + 3);
  });
  it('the bull checks out from 50', () => {
    const n = startNight(7);
    setScore(n, 50);
    expect(play(n, 'ib').result.outcome).toBe('CHECKOUT');
    expect(n.phase).toBe('SHOP');
  });
  it('the pot accumulates across legs', () => {
    const n = startNight(7);
    setScore(n, 40);
    play(n, 'd20');
    shopLeave(n);
    setScore(n, 40);
    play(n, 'd20');
    expect(n.pot).toBe(18 + (6 + 10 + 3));
    expect(n.stats.legsWon).toBe(2);
    expect(n.legs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- shop

describe('the shop (TDD §4.1)', () => {
  it('SHOP_OPEN offers 4 slots: 2 cards, 1 chalk, 1 service, all priced from the tables', () => {
    const n = startNight(11);
    setScore(n, 40);
    const { events } = play(n, 'd20');
    const shop = ev(events, 'SHOP_OPEN').shop;
    expect(shop).toBe(n.shop);
    expect(shop.slots).toHaveLength(4);
    expect(shop.slots.map((s) => s.kind)).toEqual(['CARD', 'CARD', 'CHALK', 'SERVICE']);
    expect(shop.refreshed).toBe(false);
    expect(shop.afterLeg).toBe(0);
    for (const s of shop.slots) {
      expect(s.sold).toBe(false);
      if (s.kind === 'CARD') {
        expect(s.cost).toBe(cardPrice(n, s.defId));
        expect(SHOP_CARD_POOL.some((p) => p[0] === s.defId)).toBe(true);
      } else if (s.kind === 'CHALK') expect(s.cost).toBe(chalkDef(s.chalkId).cost);
      else expect(s.cost).toBe(SERVICE_COST[s.service]);
    }
  });
  it('the service costs are 2 / 4 / 5 (remove / duplicate / sharpen) and a refresh is 1', () => {
    expect(SERVICE_COST).toEqual({ REMOVE: 2, DUPLICATE: 4, SHARPEN: 5 });
    expect(SHOP_REFRESH_COST).toBe(1);
  });
  it('the offered chalk is never one already held', () => {
    const n = createNight(12);
    for (const d of CHALK_DEFS) if (d.id !== 'bullish') addChalk(n, d.id);
    // Only 'bullish' is unheld, so it is the only chalk the shop can offer.
    const shop = generateShop(n, 0);
    expect(shop.slots.find((s) => s.kind === 'CHALK')).toMatchObject({ kind: 'CHALK', chalkId: 'bullish' });
    // and with every chalk held there is no chalk slot at all
    addChalk(n, 'bullish');
    expect(generateShop(n, 0).slots.some((s) => s.kind === 'CHALK')).toBe(false);
  });
  it('buying a card adds it to the library and deducts the cost', () => {
    const n = inShop(11, 50);
    const slot = (n.shop as NonNullable<NightState['shop']>).slots[0];
    if (slot.kind !== 'CARD') throw new Error('slot 0 is a card');
    const before = composition(n.library);
    const out = shopBuy(n, 0);
    expect(out.ok).toBe(true);
    expect(eventTypes(out.events)).toEqual(['SHOP_BUY']);
    expect(ev(out.events, 'SHOP_BUY').slot).toBe(slot);
    expect(slot.sold).toBe(true);
    expect(n.library).toHaveLength(25);
    expect(composition(n.library)).toBe(composition([...before.split(' ').flatMap((x) => {
      const [d, k] = x.split('×');
      return new Array(Number(k)).fill({ defId: d }) as { defId: string }[];
    }), { defId: slot.defId }]));
    expect(n.pot).toBe(50 - slot.cost);
    expect(n.stats.potSpent).toBe(slot.cost);
    expect(n.stats.cardsBought).toBe(1);
    expect(new Set(n.library.map((c) => c.id)).size).toBe(25);
  });
  it('cannot buy without enough pot; the library and pot are untouched', () => {
    const n = inShop(11, 0);
    const out = shopBuy(n, 0);
    expect(out).toEqual({ ok: false, reason: 'not enough pot', events: [] });
    expect(n.library).toHaveLength(24);
    expect(n.pot).toBe(0);
    expect((n.shop as NonNullable<NightState['shop']>).slots[0].sold).toBe(false);
  });
  it('a sold slot, a missing slot, and buying outside the shop are refused', () => {
    const n = inShop(11, 50);
    expect(shopBuy(n, 0).ok).toBe(true);
    expect(shopBuy(n, 0)).toMatchObject({ ok: false, reason: 'already sold' });
    expect(shopBuy(n, 9)).toMatchObject({ ok: false, reason: 'no such slot' });
    const m = startNight(11);
    expect(shopBuy(m, 0)).toMatchObject({ ok: false, reason: 'not in shop' });
  });
  it('buying chalk adds it with the next acquisition order', () => {
    const n = inShop(11, 50);
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'hot_twenty', cost: 6, sold: false });
    const out = shopBuy(n, 2);
    expect(out.ok).toBe(true);
    expect(n.chalk.map((c) => c.def.id)).toEqual(['hot_twenty']);
    expect(n.chalk[0].order).toBe(1);
    expect(n.pot).toBe(44);
    expect(n.stats.maxChalkHeld).toBe(1);
    expect(eventTypes(out.events)).toEqual(['SHOP_BUY']);
  });
  it('a duplicate chalk is refused (TDD §5.5 rule 3)', () => {
    const n = inShop(11, 50);
    addChalk(n, 'hot_twenty');
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'hot_twenty', cost: 6, sold: false });
    expect(shopBuy(n, 2)).toMatchObject({ ok: false, reason: 'already held' });
    expect(n.chalk).toHaveLength(1);
    expect(n.pot).toBe(50);
  });
  it('chalk slot limit: a sixth needs replaceChalkId; the replaced chalk is gone and the new one is newest', () => {
    const n = inShop(11, 50);
    for (const id of ['hot_twenty', 'feathered', 'heavy_tips', 'oiled', 'even_keel']) addChalk(n, id);
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'bullish', cost: 5, sold: false });
    expect(shopBuy(n, 2)).toMatchObject({ ok: false, reason: 'chalk slots full' });
    expect(shopBuy(n, 2, { replaceChalkId: 'nope' })).toMatchObject({ ok: false, reason: 'no such chalk to replace' });
    expect(n.chalk).toHaveLength(5);
    const out = shopBuy(n, 2, { replaceChalkId: 'feathered' });
    expect(out.ok).toBe(true);
    expect(n.chalk.map((c) => c.def.id)).toEqual(['hot_twenty', 'heavy_tips', 'oiled', 'even_keel', 'bullish']);
    expect(n.chalk).toHaveLength(5);
    const bullish = n.chalk.find((c) => c.def.id === 'bullish') as NonNullable<(typeof n.chalk)[number]>;
    expect(Math.max(...n.chalk.map((c) => c.order))).toBe(bullish.order);
    expect(n.pot).toBe(45);
  });
  it('The Wide holds six chalk without replacing', () => {
    const n = startNight(11, 'wide');
    setScore(n, 40);
    play(n, 'd20');
    n.pot = 50;
    for (const id of ['hot_twenty', 'feathered', 'heavy_tips', 'oiled', 'even_keel']) addChalk(n, id);
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'bullish', cost: 5, sold: false });
    expect(shopBuy(n, 2).ok).toBe(true);
    expect(n.chalk).toHaveLength(6);
  });
  it('REMOVE takes a chosen card out of the library for 2', () => {
    const n = inShop(11, 50);
    setSlot(n, 3, { kind: 'SERVICE', service: 'REMOVE', cost: SERVICE_COST.REMOVE, sold: false });
    const s1 = n.library.find((c) => c.defId === 's1') as NonNullable<(typeof n.library)[number]>;
    expect(shopBuy(n, 3)).toMatchObject({ ok: false, reason: 'choose a card' });
    expect(shopBuy(n, 3, { cardId: 'nope' })).toMatchObject({ ok: false, reason: 'choose a card' });
    const out = shopBuy(n, 3, { cardId: s1.id });
    expect(out.ok).toBe(true);
    expect(n.library).toHaveLength(23);
    expect(n.library.some((c) => c.id === s1.id)).toBe(false);
    expect(composition(n.library)).not.toContain('s1×');
    expect(n.pot).toBe(48);
  });
  it('REMOVE refuses to shrink the library below 7 cards (engine choice)', () => {
    const n = inShop(11, 50);
    n.library = n.library.slice(0, 6);
    setSlot(n, 3, { kind: 'SERVICE', service: 'REMOVE', cost: 2, sold: false });
    expect(shopBuy(n, 3, { cardId: n.library[0].id })).toMatchObject({ ok: false, reason: 'library too small' });
    expect(n.library).toHaveLength(6);
  });
  it('DUPLICATE adds a fresh copy of a chosen card for 4', () => {
    const n = inShop(11, 50);
    setSlot(n, 3, { kind: 'SERVICE', service: 'DUPLICATE', cost: SERVICE_COST.DUPLICATE, sold: false });
    const t20 = n.library.find((c) => c.defId === 't20') as NonNullable<(typeof n.library)[number]>;
    expect(shopBuy(n, 3, { cardId: t20.id }).ok).toBe(true);
    expect(n.library).toHaveLength(25);
    expect(composition(n.library)).toContain('t20×2');
    expect(new Set(n.library.map((c) => c.id)).size).toBe(25);
    expect(n.pot).toBe(46);
  });
  it('SHARPEN upgrades S → T → D and then refuses; OB → IB; IB and D refused; costs 5 only when it works', () => {
    const n = inShop(11, 50);
    const slot: ShopSlot = { kind: 'SERVICE', service: 'SHARPEN', cost: SERVICE_COST.SHARPEN, sold: false };
    setSlot(n, 3, slot);
    const s20 = n.library.find((c) => c.defId === 's20') as NonNullable<(typeof n.library)[number]>;
    expect(shopBuy(n, 3, { cardId: s20.id }).ok).toBe(true);
    expect(s20.defId).toBe('t20');
    expect(s20.target).toEqual({ region: 'T', bed: 20 });
    expect(n.pot).toBe(45);
    slot.sold = false;
    expect(shopBuy(n, 3, { cardId: s20.id }).ok).toBe(true);
    expect(s20.defId).toBe('d20');
    expect(s20.target).toEqual({ region: 'D', bed: 20 });
    expect(n.pot).toBe(40);
    slot.sold = false;
    expect(shopBuy(n, 3, { cardId: s20.id })).toMatchObject({ ok: false, reason: 'cannot sharpen' });
    expect(s20.defId).toBe('d20');
    expect(n.pot).toBe(40);
    expect(slot.sold).toBe(false);
    const d16 = n.library.find((c) => c.defId === 'd16') as NonNullable<(typeof n.library)[number]>;
    expect(shopBuy(n, 3, { cardId: d16.id })).toMatchObject({ ok: false, reason: 'cannot sharpen' });
    const ob = n.library.find((c) => c.defId === 'ob') as NonNullable<(typeof n.library)[number]>;
    expect(shopBuy(n, 3, { cardId: ob.id }).ok).toBe(true);
    expect(ob.defId).toBe('ib');
    expect(ob.target).toEqual({ region: 'IB' });
    slot.sold = false;
    expect(shopBuy(n, 3, { cardId: ob.id })).toMatchObject({ ok: false, reason: 'cannot sharpen' });
    expect(n.pot).toBe(35);
    expect(n.library).toHaveLength(24);
  });
  it('a sharpened card carries into the next leg', () => {
    const n = inShop(11, 50);
    setSlot(n, 3, { kind: 'SERVICE', service: 'SHARPEN', cost: 5, sold: false });
    const s19 = n.library.find((c) => c.defId === 's19') as NonNullable<(typeof n.library)[number]>;
    shopBuy(n, 3, { cardId: s19.id });
    shopLeave(n);
    expect(composition([...currentLeg(n).deck, ...currentLeg(n).hand])).toBe(composition(n.library));
    expect(composition(n.library)).toContain('t19×2');
  });
  it('refresh: once per shop, for 1 pot, regenerates every slot', () => {
    const n = inShop(11, 50);
    const shop = n.shop as NonNullable<NightState['shop']>;
    shopBuy(n, 0);
    const out = shopRefresh(n);
    expect(out.ok).toBe(true);
    expect(eventTypes(out.events)).toEqual(['SHOP_REFRESH']);
    const fresh = n.shop as NonNullable<NightState['shop']>;
    expect(fresh).not.toBe(shop);
    expect(fresh.refreshed).toBe(true);
    expect(fresh.afterLeg).toBe(0);
    expect(fresh.slots).toHaveLength(4);
    expect(fresh.slots.map((s) => s.kind)).toEqual(['CARD', 'CARD', 'CHALK', 'SERVICE']);
    for (const s of fresh.slots) expect(s.sold).toBe(false);
    expect(n.pot).toBe(50 - shop.slots[0].cost - 1);
    expect(n.stats.potSpent).toBe(shop.slots[0].cost + 1);
    expect(shopRefresh(n)).toMatchObject({ ok: false, reason: 'already refreshed' });
  });
  it('refresh needs 1 pot and a shop', () => {
    const n = inShop(11, 0);
    expect(shopRefresh(n)).toMatchObject({ ok: false, reason: 'not enough pot' });
    expect(shopRefresh(startNight(11))).toMatchObject({ ok: false, reason: 'not in shop' });
  });
  it('refresh consumes the gameplay RNG deterministically', () => {
    const a = inShop(11, 50);
    const b = inShop(11, 50);
    shopRefresh(a);
    shopRefresh(b);
    expect(JSON.stringify(a.shop)).toBe(JSON.stringify(b.shop));
    expect(a.rng.s).toBe(b.rng.s);
  });
  it('shopLeave begins the next leg with the bought cards in the deck', () => {
    const n = inShop(11, 50);
    shopBuy(n, 0);
    const events = shopLeave(n);
    expect(eventTypes(events)).toEqual(['LEG_START', 'HAND_DEALT']);
    expect(ev(events, 'LEG_START').legIndex).toBe(1);
    expect(n.legIndex).toBe(1);
    expect(n.phase).toBe('LEG');
    expect(n.shop).toBeNull();
    const leg = currentLeg(n);
    expect(leg.index).toBe(1);
    expect(leg.visitLimit).toBe(11);
    expect(leg.score).toBe(501);
    expect(composition([...leg.deck, ...leg.hand])).toBe(composition(n.library));
    expect(leg.deck.length + leg.hand.length).toBe(25);
  });
  it('shopLeave outside the shop throws', () => {
    expect(() => shopLeave(startNight(11))).toThrow();
  });
});

// ---------------------------------------------------------------- night end

describe('night end (TDD §9.3)', () => {
  it('leg 8 checkout wins the night: WON, OVER, no shop, NIGHT_WON, no reward', () => {
    const n = createNight(13);
    n.legIndex = 7;
    beginLeg(n);
    expect(currentLeg(n).visitLimit).toBe(5);
    setScore(n, 40);
    const { events } = play(n, 'd20');
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'CHECKOUT', 'ACHIEVEMENT', 'ACHIEVEMENT', 'NIGHT_WON']);
    expect(eventTypes(events)).not.toContain('SHOP_OPEN');
    expect(ev(events, 'CHECKOUT').reward).toBeNull();
    expect(currentLeg(n).reward).toBeUndefined();
    expect(n.status).toBe('WON');
    expect(n.phase).toBe('OVER');
    expect(n.shop).toBeNull();
    expect(n.pot).toBe(0);
    expect(n.stats.legsWon).toBe(1);
    expect(n.achievements).toEqual(['thin', 'steady']);
    expect(() => commitCard(n, 'x')).toThrow();
    expect(() => shopLeave(n)).toThrow();
  });
  it('leg 8 checkout still records the folk stats (big finish, clean leg, nine-darter)', () => {
    const n = createNight(13);
    n.legIndex = 7;
    beginLeg(n);
    playAll(n, ['t20', 't20', 't20', 't20', 't20', 't20', 't20', 't19', 'd12']);
    expect(n.status).toBe('WON');
    expect(n.stats.nineDarters).toBe(1);
    expect(n.stats.bigFinishes).toBe(1);
    expect(n.stats.cleanLegs).toBe(1);
    expect(n.stats.oneEighties).toBe(2);
    expect(n.stats.bestCheckout).toBe(141);
  });
  it('a full night: seven shops then the win', () => {
    const n = startNight(14);
    for (let leg = 0; leg < 8; leg++) {
      expect(n.legIndex).toBe(leg);
      setScore(n, 40);
      play(n, 'd20');
      if (leg < 7) {
        expect(n.phase).toBe('SHOP');
        shopLeave(n);
      }
    }
    expect(n.status).toBe('WON');
    expect(n.legs).toHaveLength(8);
    expect(n.stats.legsWon).toBe(8);
    // every leg checked out on visit 1: base + (limit - 1) unused + 3 clean
    const expectedPot = LEGS.slice(0, 7).reduce((a, d) => a + d.reward + (d.visitLimit - 1) + 3, 0);
    expect(n.pot).toBe(expectedPot);
  });
});

// ---------------------------------------------------------------- achievements

describe('achievements (TDD §9.4 unlock conditions)', () => {
  it('sharp: a leg won with a 100+ checkout (100 exactly qualifies)', () => {
    const n = startNight(15);
    setScore(n, 100);
    play(n, 't20');
    const { events } = play(n, 'd20');
    expect(n.achievements).toContain('sharp');
    expect(events.filter((e) => e.type === 'ACHIEVEMENT').map((e) => (e as { oche: OcheId }).oche)).toEqual(['sharp', 'thin']);
  });
  it('sharp is not awarded for a 99 checkout', () => {
    const n = startNight(15);
    setScore(n, 99);
    playAll(n, ['t20', 's7', 'd16']);
    expect(n.achievements).not.toContain('sharp');
  });
  it('thin: a leg won in 6 visits or fewer (6 qualifies, 7 does not)', () => {
    const six = startNight(15);
    six.legs[0].score = 100000;
    six.legs[0].visits[0].scoreAtVisitStart = 100000;
    for (let i = 0; i < 15; i++) play(six, 's1');
    expect(currentLeg(six).visits).toHaveLength(6);
    setScore(six, 40);
    play(six, 'd20');
    expect(six.achievements).toContain('thin');

    const seven = startNight(15);
    setScore(seven, 100000);
    for (let i = 0; i < 18; i++) play(seven, 's1');
    expect(currentLeg(seven).visits).toHaveLength(7);
    setScore(seven, 40);
    play(seven, 'd20');
    expect(seven.achievements).not.toContain('thin');
    expect(currentLeg(seven).reward?.unusedVisits).toBe(5);
  });
  it('wide: holding 5 chalk at once, awarded on the shop purchase of the fifth', () => {
    const n = inShop(15, 50);
    for (const id of ['hot_twenty', 'feathered', 'heavy_tips', 'oiled']) addChalk(n, id);
    expect(n.achievements).not.toContain('wide');
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'bullish', cost: 5, sold: false });
    const out = shopBuy(n, 2);
    expect(eventTypes(out.events)).toEqual(['ACHIEVEMENT', 'SHOP_BUY']);
    expect(n.achievements).toContain('wide');
    expect(n.stats.maxChalkHeld).toBe(5);
  });
  it('wide is not awarded for four chalk', () => {
    const n = inShop(15, 50);
    for (const id of ['hot_twenty', 'feathered', 'heavy_tips']) addChalk(n, id);
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'bullish', cost: 5, sold: false });
    expect(eventTypes(shopBuy(n, 2).events)).toEqual(['SHOP_BUY']);
    expect(n.achievements).not.toContain('wide');
  });
  it('steady: a won night with zero busts; a single bust anywhere in the night forfeits it', () => {
    const clean = createNight(15);
    clean.legIndex = 7;
    beginLeg(clean);
    setScore(clean, 40);
    play(clean, 'd20');
    expect(clean.achievements).toContain('steady');

    const busted = createNight(15);
    busted.legIndex = 7;
    beginLeg(busted);
    setScore(busted, 10);
    play(busted, 't20');
    setScore(busted, 40);
    play(busted, 'd20');
    expect(busted.status).toBe('WON');
    expect(busted.achievements).not.toContain('steady');
  });
  it('steady is only judged at the night win, never on an earlier leg', () => {
    const n = startNight(15);
    setScore(n, 40);
    play(n, 'd20');
    expect(n.achievements).not.toContain('steady');
  });
  it('each achievement fires once per night', () => {
    const n = startNight(15);
    setScore(n, 100);
    play(n, 't20');
    play(n, 'd20');
    shopLeave(n);
    setScore(n, 100);
    play(n, 't20');
    const { events } = play(n, 'd20');
    expect(eventTypes(events)).not.toContain('ACHIEVEMENT');
    expect(n.achievements).toEqual(['sharp', 'thin']);
  });
});

// ---------------------------------------------------------------- stats and commentary counters

describe('stats counters and commentary state', () => {
  it('throwsMade, visitsPlayed, busts, bestVisit, chalkFires', () => {
    const n = startNight(16, 'local', ['heavy_tips']);
    setScore(n, 400);
    playAll(n, ['t20', 't20', 't20']); // 195
    expect(n.stats.throwsMade).toBe(3);
    expect(n.stats.visitsPlayed).toBe(2);
    expect(n.stats.bestVisit).toBe(195);
    expect(n.stats.chalkFires).toBe(3);
    setScore(n, 10);
    play(n, 't20'); // bust
    expect(n.stats.busts).toBe(1);
    expect(n.stats.throwsMade).toBe(4);
    expect(n.stats.visitsPlayed).toBe(3);
    expect(n.stats.chalkFires).toBe(4);
    expect(n.stats.bestVisit).toBe(195);
  });
  it('consecutiveBusts counts busts in a row and resets after a completed non-bust visit', () => {
    const n = startNight(16);
    setScore(n, 10);
    play(n, 't20');
    setScore(n, 10);
    play(n, 't20');
    expect(n.consecutiveBusts).toBe(2);
    setScore(n, 100000);
    play(n, 's1');
    play(n, 's1');
    expect(n.consecutiveBusts).toBe(2); // the visit is not over yet
    play(n, 's1');
    expect(n.consecutiveBusts).toBe(0);
    setScore(n, 10);
    play(n, 't20');
    expect(n.consecutiveBusts).toBe(1);
  });
  it('consecutiveBusts survives a leg boundary and resets on a checkout', () => {
    const n = startNight(16);
    setScore(n, 10);
    play(n, 't20');
    setScore(n, 40);
    play(n, 'd20');
    expect(n.consecutiveBusts).toBe(0);
    shopLeave(n);
    setScore(n, 10);
    play(n, 't20');
    setScore(n, 10);
    play(n, 't20');
    expect(n.consecutiveBusts).toBe(2);
  });
  it('ONE_EIGHTY fires on a 180 visit, after VISIT_END, and counts the 180', () => {
    const n = startNight(16);
    const { events } = playAll(n, ['t20', 't20', 't20']);
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'ONE_EIGHTY', 'HAND_DEALT']);
    expect(ev(events, 'VISIT_END').total).toBe(180);
    expect(ev(events, 'ONE_EIGHTY').total).toBe(180);
    expect(n.stats.oneEighties).toBe(1);
    expect(n.stats.bestVisit).toBe(180);
  });
  it('ONE_EIGHTY also fires above 180 (hot_twenty: 240) and not on 177', () => {
    const hot = startNight(16, 'local', ['hot_twenty']);
    const { events } = playAll(hot, ['t20', 't20', 't20']);
    expect(ev(events, 'ONE_EIGHTY').total).toBe(240);
    const n = startNight(16);
    const out = playAll(n, ['t20', 't20', 't19']);
    expect(eventTypes(out.events)).toEqual(['THROW', 'VISIT_END', 'HAND_DEALT']);
    expect(n.stats.oneEighties).toBe(0);
  });
  it('a busted 180 does not count', () => {
    const n = startNight(16);
    setScore(n, 179);
    playAll(n, ['t20', 't20', 't20']);
    expect(n.stats.oneEighties).toBe(0);
    expect(currentLeg(n).score).toBe(179);
  });
  it('chalked_up: the peek lists three deck card ids at every visit start (the top of the deck before the deal)', () => {
    const n = startNight(16, 'local', ['chalked_up']);
    const leg = currentLeg(n);
    expect(leg.peek).toHaveLength(3);
    const pool = [...leg.hand, ...leg.deck];
    for (const id of leg.peek) expect(pool.some((c) => c.id === id)).toBe(true);
    // the engine peeks before dealing: with a 3-card hand the peek is the hand about to be dealt
    expect(leg.peek).toEqual(leg.hand.map((c) => c.id));
    const first = leg.peek.slice();
    setScore(n, 100000);
    // A fresh hand is dealt for every throw, so commit whatever is in hand each time.
    for (let i = 0; i < 3; i++) commitCard(n, leg.hand[0].id);
    expect(leg.visits).toHaveLength(2);
    expect(leg.peek).toHaveLength(3);
    expect(leg.peek).not.toEqual(first);
    expect(leg.peek).toEqual(leg.hand.map((c) => c.id));
  });
  it('without chalked_up the peek is empty', () => {
    expect(currentLeg(startNight(16)).peek).toEqual([]);
  });
  it('pot earned and spent are tracked separately', () => {
    const n = inShop(16, 18);
    expect(n.stats.potEarned).toBe(18);
    setSlot(n, 0, { kind: 'CARD', defId: 't20', cost: 6, sold: false });
    shopBuy(n, 0);
    shopRefresh(n);
    expect(n.stats.potSpent).toBe(7);
    expect(n.pot).toBe(11);
  });
});
