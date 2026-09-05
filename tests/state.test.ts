/**
 * The night state machine (TDD §2, §3.3, §3.4, §4, §4.1, §6.1, §9): library
 * per oche, legs and visit limits, the per-visit hand and the discard, the
 * pocket, the deliberate miss, heat and the setup bonus, bust, timeout,
 * checkout and the Pot breakdown, the shop, night end, achievements, stats.
 */
import { describe, expect, it } from 'vitest';
import { STARTING_LIBRARY, THIN_LIBRARY, cardCost, libraryFor, SHOP_CARD_POOL } from '../src/content/cards.ts';
import { CHALK_DEFS, chalkDef } from '../src/content/chalkdefs.ts';
import {
  HEAT_CAP,
  LEGS,
  LEG_COUNT,
  SERVICE_COST,
  SETUP_BONUS,
  SETUP_BONUS_CAP,
  SHOP_REFRESH_COST,
  STARTING_SCORE,
} from '../src/content/legs.ts';
import { OCHES } from '../src/content/oches.ts';
import { WALL_CARD_ID } from '../src/core/board.ts';
import { VISIT_HAND_SPARE } from '../src/core/resolver.ts';
import { potReward } from '../src/core/rules.ts';
import {
  generateShop,
  addChalk,
  beginLeg,
  cardPrice,
  commitCard,
  commitMiss,
  createNight,
  currentLeg,
  currentVisit,
  hasChalk,
  legName,
  pocketCard,
  shopBuy,
  shopLeave,
  shopRefresh,
  throwsPerVisit,
  unpocketCard,
  visitHandSize,
  visitTotal,
} from '../src/core/state.ts';
import type { EngineEvent, NightState, OcheId, PotBreakdown, ShopSlot } from '../src/core/types.ts';
import {
  baseOf,
  composition,
  dealFromPool,
  eventTypes,
  handDefIds,
  handIds,
  play,
  playAll,
  playHeld,
  playPoolThenMiss,
  playVisit,
  poolIds,
  setScore,
  startNight,
} from './helpers.ts';

function expand(lib: [string, number][]): { defId: string }[] {
  const out: { defId: string }[] = [];
  for (const [d, n] of lib) for (let i = 0; i < n; i++) out.push({ defId: d });
  return out;
}

/** How many copies of a def id a card list holds. */
function countOf(cards: { defId: string }[], defId: string): number {
  return cards.filter((c) => c.defId === defId).length;
}

/** Throw the first card in hand that is not `keepId` — for spending a visit around a pocketed card. */
function throwOther(n: NightState, keepId: string): { events: EngineEvent[] } {
  const card = currentLeg(n).hand.find((c) => c.id !== keepId);
  if (!card) throw new Error('nothing else in hand');
  return commitCard(n, card.id);
}

function ev<T extends EngineEvent['type']>(events: EngineEvent[], type: T): Extract<EngineEvent, { type: T }> {
  const e = events.find((x) => x.type === type);
  if (!e) throw new Error(`no ${type} in [${eventTypes(events)}]`);
  return e as Extract<EngineEvent, { type: T }>;
}

/** The parts of a Pot breakdown before the heat multiplier. */
function subtotalOf(r: PotBreakdown): number {
  return r.base + r.unusedVisits + r.bigFinish + r.cleanLeg + r.nineDarter + r.setup;
}

/** Every breakdown must add up: subtotal, then × (1 + heat/HEAT_CAP), floored. */
function expectAddsUp(r: PotBreakdown): void {
  expect(r.heat).toBeGreaterThanOrEqual(0);
  expect(r.heat).toBeLessThanOrEqual(HEAT_CAP);
  expect(r.heatBonus).toBe(Math.floor((subtotalOf(r) * r.heat) / HEAT_CAP));
  expect(r.total).toBe(subtotalOf(r) + r.heatBonus);
}

/**
 * The Pot for a leg checked out on its first visit with no bust and no setup
 * bonus: base + every unused visit + the clean leg, warmed by the single visit
 * of heat the finishing visit itself earns. Derived from LEGS so retuning the
 * table cannot rot the expectation.
 */
function firstVisitPot(legIndex: number): number {
  const def = LEGS[legIndex];
  const subtotal = def.reward + (def.visitLimit - 1) + 3;
  return subtotal + Math.floor(subtotal / HEAT_CAP);
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
  it('The Local: one card instance per copy in STARTING_LIBRARY (DECISIONS.md #45)', () => {
    const n = createNight(1, 'local');
    // Derived from the table, not a frozen string: the list is a tuning knob.
    expect(n.library).toHaveLength(expand(STARTING_LIBRARY).length);
    expect(n.library).toHaveLength(24);
    expect(composition(n.library)).toBe(composition(expand(STARTING_LIBRARY)));
    // It has to be able to score and to finish: trebles, a ladder of doubles, a bull.
    expect(n.library.some((c) => c.defId === 't20')).toBe(true);
    expect(n.library.filter((c) => c.defId.startsWith('d')).length).toBeGreaterThanOrEqual(4);
    expect(n.library.some((c) => c.defId === 'ib')).toBe(true);
  });
  it('the default oche is The Local', () => {
    const n = createNight(1);
    expect(n.oche).toBe('local');
    expect(composition(n.library)).toBe(composition(createNight(1, 'local').library));
  });
  it('The Sharp: trebles in place of the weakest singles', () => {
    const n = createNight(1, 'sharp');
    const expected = expand(libraryFor('sharp'));
    expect(n.library).toHaveLength(expected.length);
    expect(composition(n.library)).toBe(composition(expected));
    const c = composition(n.library);
    expect(c).toContain('t18×');
    expect(c).toContain('t17×');
    const trebles = (lib: { defId: string }[]) => lib.filter((x) => x.defId.startsWith('t')).length;
    const singles = (lib: { defId: string }[]) => lib.filter((x) => x.defId.startsWith('s')).length;
    expect(trebles(n.library)).toBeGreaterThan(trebles(expand(STARTING_LIBRARY)));
    expect(singles(n.library)).toBeLessThan(singles(expand(STARTING_LIBRARY)));
  });
  it('The Thin: a short library, every card comes round again', () => {
    const n = createNight(1, 'thin');
    expect(n.library).toHaveLength(expand(THIN_LIBRARY).length);
    expect(n.library.length).toBeLessThan(createNight(1, 'local').library.length);
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
    expect(composition(n.library)).toBe(composition(createNight(1, 'local').library));
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
  it('the LEGS table: eight named legs, tightening visit limits, rising rewards, nothing for the last', () => {
    expect(LEG_COUNT).toBe(8);
    expect(LEGS).toHaveLength(8);
    expect(LEGS.map((l) => l.name)).toEqual(['First Round', 'Second Round', 'Quarter', 'Interval', 'Semi', 'Last Four', 'Final', 'The Decider']);
    expect(STARTING_SCORE).toBe(501);
    // The numbers themselves are tuning (they moved with the per-visit hand);
    // what must hold is the shape: every leg is tighter and worth more than
    // the last, and the win is its own reward on The Decider.
    for (let i = 1; i < LEG_COUNT; i++) {
      expect(LEGS[i].visitLimit, LEGS[i].name).toBeLessThanOrEqual(LEGS[i - 1].visitLimit);
      if (i < LEG_COUNT - 1) expect(LEGS[i].reward, LEGS[i].name).toBeGreaterThan(LEGS[i - 1].reward);
    }
    expect(LEGS[LEG_COUNT - 1].visitLimit).toBeLessThan(LEGS[0].visitLimit);
    expect(LEGS[LEG_COUNT - 1].reward).toBe(0);
    for (const l of LEGS) expect(l.visitLimit).toBeGreaterThanOrEqual(3);
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
  it('beginLeg: 501, one visit, one visit hand from a shuffled copy of the library, no heat and an empty pocket', () => {
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
    expect(leg.hand).toHaveLength(visitHandSize(n));
    expect(leg.deck).toHaveLength(n.library.length - visitHandSize(n));
    expect(leg.discard).toEqual([]);
    expect(leg.status).toBe('ACTIVE');
    expect(leg.bustsThisLeg).toBe(0);
    expect(leg.forgivenessUsed).toBe(false);
    expect(leg.pocket).toBeNull();
    expect(leg.heat).toBe(0);
    expect(leg.setupBonuses).toBe(0);
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
  it('the visit hand is throwsPerVisit + VISIT_HAND_SPARE, and DEAL chalk moves it', () => {
    const n = startNight(1);
    expect(VISIT_HAND_SPARE).toBe(2);
    expect(throwsPerVisit(n)).toBe(3);
    expect(visitHandSize(n)).toBe(throwsPerVisit(n) + VISIT_HAND_SPARE);
    expect(currentLeg(n).hand).toHaveLength(5);
    const dealt = (chalk: string[]) => currentLeg(startNight(1, 'local', chalk)).hand.length;
    expect(dealt(['wide_grip'])).toBe(6);
    expect(dealt(['tunnel_vision'])).toBe(4);
    // Unlike the old per-dart hand these two no longer overrule each other: the
    // extra card and the missing one cancel out.
    expect(dealt(['wide_grip', 'tunnel_vision'])).toBe(5);
    expect(dealt(['tunnel_vision', 'wide_grip'])).toBe(5);
    // A fourth dart brings a fourth card with it, keeping the same spare.
    expect(dealt(['fourth_dart'])).toBe(6);
    expect(visitHandSize(startNight(1, 'local', ['fourth_dart']))).toBe(throwsPerVisit(startNight(1, 'local', ['fourth_dart'])) + VISIT_HAND_SPARE);
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

describe('the per-visit hand and the discard (TDD §3.3)', () => {
  it('commit takes only that card: the rest of the hand stays for the next dart and nothing is dealt', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    const dealt = handIds(n);
    const deckBefore = leg.deck.length;
    const b = leg.hand[1];
    const { events } = commitCard(n, b.id);
    // No HAND_DEALT: the hand is a visit-long resource, not a per-dart draw.
    expect(eventTypes(events)).toEqual(['THROW']);
    expect(handIds(n)).toEqual(dealt.filter((id) => id !== b.id));
    expect(leg.hand).toHaveLength(visitHandSize(n) - 1);
    expect(leg.discard.map((x) => x.id)).toEqual([b.id]);
    expect(leg.deck).toHaveLength(deckBefore);
    expect(currentVisit(leg).throws[0].intent.card.id).toBe(b.id);
    // the second dart comes out of the same hand
    const c = leg.hand[0];
    expect(eventTypes(commitCard(n, c.id).events)).toEqual(['THROW']);
    expect(leg.hand).toHaveLength(visitHandSize(n) - 2);
    expect(leg.deck).toHaveLength(deckBefore);
    expect(leg.discard.map((x) => x.id)).toEqual([b.id, c.id]);
    expect(composition([...leg.deck, ...leg.hand, ...leg.discard])).toBe(composition(n.library));
  });
  it('spending the big card early costs the later darts: the hand only shrinks', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const sizes: number[] = [leg.hand.length];
    for (let i = 0; i < throwsPerVisit(n) - 1; i++) {
      commitCard(n, leg.hand[0].id);
      sizes.push(leg.hand.length);
    }
    expect(sizes).toEqual([visitHandSize(n), visitHandSize(n) - 1, visitHandSize(n) - 2]);
    // the last dart is thrown from what is left: exactly VISIT_HAND_SPARE + 1 cards
    expect(leg.hand).toHaveLength(VISIT_HAND_SPARE + 1);
  });
  it('the unspent cards are binned when the visit ends and one fresh hand is dealt', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const dealt = handIds(n);
    const thrown: string[] = [];
    let last: { events: EngineEvent[] } | null = null;
    for (let i = 0; i < throwsPerVisit(n); i++) {
      thrown.push(leg.hand[0].id);
      last = commitCard(n, leg.hand[0].id);
    }
    const spare = dealt.filter((id) => !thrown.includes(id));
    expect(spare).toHaveLength(VISIT_HAND_SPARE);
    expect(eventTypes((last as { events: EngineEvent[] }).events)).toEqual(['THROW', 'VISIT_END', 'HAND_DEALT']);
    // thrown and unspent alike: the whole hand is in the bin
    expect(leg.discard.map((x) => x.id).sort()).toEqual([...dealt].sort());
    expect(leg.visits).toHaveLength(2);
    expect(leg.hand).toHaveLength(visitHandSize(n));
    for (const id of dealt) expect(handIds(n)).not.toContain(id);
    expect(composition([...leg.deck, ...leg.hand, ...leg.discard])).toBe(composition(n.library));
  });
  it('HAND_DEALT fires once per visit, not once per dart', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const events: EngineEvent[] = [];
    for (let i = 0; i < throwsPerVisit(n) * 2; i++) events.push(...commitCard(n, leg.hand[0].id).events);
    const dealt = events.filter((e) => e.type === 'HAND_DEALT') as Extract<EngineEvent, { type: 'HAND_DEALT' }>[];
    expect(dealt).toHaveLength(2); // one at the end of each of the two visits
    expect(dealt.map((e) => e.visitIndex)).toEqual([1, 2]);
    expect(dealt.every((e) => e.throwIndex === 0)).toBe(true);
    expect(dealt.every((e) => e.hand.length === visitHandSize(n))).toBe(true);
    expect(leg.visits).toHaveLength(3);
  });
  it('practice_board: the unspent cards go under the deck in hand order at visit end; thrown cards are binned', () => {
    const n = startNight(2, 'local', ['practice_board']);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const dealt = handIds(n);
    const thrown: string[] = [];
    for (let i = 0; i < throwsPerVisit(n) - 1; i++) {
      thrown.push(leg.hand[0].id);
      commitCard(n, leg.hand[0].id);
    }
    // mid-visit nothing has been routed anywhere yet but the thrown cards
    expect(leg.discard.map((x) => x.id)).toEqual(thrown);
    const spare = leg.hand.slice(1).map((c) => c.id);
    thrown.push(leg.hand[0].id);
    commitCard(n, leg.hand[0].id);
    expect(leg.discard.map((x) => x.id)).toEqual(thrown);
    expect(spare).toEqual(dealt.filter((id) => !thrown.includes(id)));
    expect(leg.deck.slice(-VISIT_HAND_SPARE).map((x) => x.id)).toEqual(spare);
    for (const id of spare) expect(handIds(n)).not.toContain(id);
    // nothing is lost: the pool is still the library, only the routing differs
    expect(leg.deck).toHaveLength(n.library.length - leg.hand.length - leg.discard.length);
    expect(composition([...leg.deck, ...leg.hand, ...leg.discard])).toBe(composition(n.library));
  });
  it('the hand is dealt from the front of the deck', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    setScore(n, 100000);
    for (let i = 0; i < throwsPerVisit(n) - 1; i++) commitCard(n, leg.hand[0].id);
    const next = leg.deck.slice(0, visitHandSize(n)).map((x) => x.id);
    commitCard(n, leg.hand[0].id); // ends the visit and deals the next hand
    expect(handIds(n)).toEqual(next);
  });
  it('the deck persists across visits and is reshuffled from the discard when it empties', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const size = n.library.length;
    let sawShort = false;
    let reshuffled = false;
    let prevDeck = leg.deck.length;
    for (let v = 0; v < 6 && leg.status === 'ACTIVE'; v++) {
      if (leg.deck.length < visitHandSize(n)) sawShort = true;
      playVisit(n);
      const pool = [...leg.deck, ...leg.hand, ...leg.discard];
      expect(pool).toHaveLength(size);
      expect(new Set(pool.map((c) => c.id)).size).toBe(size);
      if (leg.deck.length > prevDeck) reshuffled = true; // the discard came back
      prevDeck = leg.deck.length;
    }
    expect(sawShort).toBe(true);
    expect(reshuffled).toBe(true);
    expect(leg.deck.length + leg.hand.length + leg.discard.length).toBe(size);
  });
  it('a visit hand dealt from the pool is spent card by card across the visit', () => {
    const n = startNight(26);
    const leg = currentLeg(n);
    const pool = poolIds(n);
    setScore(n, 100);
    dealFromPool(n, ['t20', 'd20', 's20']);
    expect(handDefIds(n)).toEqual(['t20', 'd20', 's20']);
    expect(poolIds(n)).toEqual(pool); // dealt from the deck, not conjured
    playHeld(n, 't20');
    expect(leg.score).toBe(40);
    expect(handDefIds(n)).toEqual(['d20', 's20']);
    expect(() => playHeld(n, 't20')).toThrow(); // spent, and there is no second one this visit
    playHeld(n, 'd20');
    expect(leg.status).toBe('CHECKED_OUT');
    expect(leg.score).toBe(0);
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
  it('a tiny pool still deals what it has', () => {
    const n = startNight(2);
    const leg = currentLeg(n);
    setScore(n, 100000);
    // Two cards in the whole leg: the visit hand can only be as big as the pool.
    leg.deck = [];
    leg.discard = [];
    leg.hand = leg.hand.slice(0, 2);
    const ids = handIds(n).sort();
    commitCard(n, leg.hand[0].id);
    commitCard(n, leg.hand[0].id);
    commitMiss(n); // ends the visit, so a new hand is dealt from a two-card pool
    expect(leg.hand.length).toBeGreaterThanOrEqual(1);
    expect(leg.hand.length).toBeLessThanOrEqual(visitHandSize(n));
    expect(leg.hand).toHaveLength(2);
    expect(handIds(n).sort()).toEqual(ids);
  });
});

// ---------------------------------------------------------------- the pocket

describe('the pocket: one card kept for a later visit', () => {
  it('pocketCard sets a card aside for free and says so; the card is still in the hand for this visit', () => {
    const n = startNight(21);
    const leg = currentLeg(n);
    const card = leg.hand[2];
    const { ok, events } = pocketCard(n, card.id);
    expect(ok).toBe(true);
    expect(eventTypes(events)).toEqual(['POCKETED']);
    expect(ev(events, 'POCKETED').card).toBe(card);
    expect(leg.pocket).toBe(card);
    // free: no dart spent, nothing dealt, the hand is untouched
    expect(currentVisit(leg).throws).toEqual([]);
    expect(leg.hand).toHaveLength(visitHandSize(n));
    expect(handIds(n)).toContain(card.id);
    expect(poolIds(n)).toEqual(n.library.map((c) => c.id).sort());
  });
  it('the pocket holds one card: a second is refused, and unpocketCard hands it back', () => {
    const n = startNight(21);
    const leg = currentLeg(n);
    const first = leg.hand[0];
    const second = leg.hand[1];
    expect(pocketCard(n, first.id).ok).toBe(true);
    expect(pocketCard(n, second.id)).toEqual({ ok: false, events: [] });
    expect(leg.pocket).toBe(first);
    expect(unpocketCard(n)).toBe(true);
    expect(leg.pocket).toBeNull();
    expect(unpocketCard(n)).toBe(false);
    // with the pocket empty the choice can be made again
    expect(pocketCard(n, second.id).ok).toBe(true);
    expect(leg.pocket).toBe(second);
  });
  it('only a card in the hand can be pocketed, and only during a leg', () => {
    const n = startNight(21);
    const leg = currentLeg(n);
    expect(pocketCard(n, 'nope')).toEqual({ ok: false, events: [] });
    expect(pocketCard(n, leg.deck[0].id)).toEqual({ ok: false, events: [] }); // in the deck, not the hand
    expect(leg.pocket).toBeNull();
    const shopping = inShop(21, 10);
    expect(pocketCard(shopping, 'anything')).toEqual({ ok: false, events: [] });
  });
  it('the kept card is not binned at visit end: it comes back every visit, one card bigger', () => {
    const n = startNight(21);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const kept = leg.hand[leg.hand.length - 1];
    pocketCard(n, kept.id);
    let last: { events: EngineEvent[] } | null = null;
    for (let i = 0; i < throwsPerVisit(n); i++) last = throwOther(n, kept.id);
    // the rest of the hand went to the bin; the kept card did not
    expect(leg.discard.some((c) => c.id === kept.id)).toBe(false);
    expect(leg.deck.some((c) => c.id === kept.id)).toBe(false);
    expect(leg.pocket).toBe(kept);
    expect(handIds(n)).toContain(kept.id);
    expect(leg.hand).toHaveLength(visitHandSize(n) + 1);
    expect(leg.hand[leg.hand.length - 1]).toBe(kept);
    expect(ev((last as { events: EngineEvent[] }).events, 'HAND_DEALT').hand.map((c) => c.id)).toContain(kept.id);
    // and again the visit after that
    for (let i = 0; i < throwsPerVisit(n); i++) throwOther(n, kept.id);
    expect(leg.pocket).toBe(kept);
    expect(leg.hand).toHaveLength(visitHandSize(n) + 1);
    expect(poolIds(n)).toEqual(n.library.map((c) => c.id).sort());
  });
  it('throwing the kept card empties the pocket and the hand goes back to normal', () => {
    const n = startNight(21);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const kept = leg.hand[0];
    pocketCard(n, kept.id);
    commitCard(n, kept.id);
    expect(leg.pocket).toBeNull();
    expect(leg.discard.map((c) => c.id)).toContain(kept.id);
    expect(handIds(n)).not.toContain(kept.id);
    for (let i = 0; i < throwsPerVisit(n) - 1; i++) commitCard(n, leg.hand[0].id);
    expect(leg.hand).toHaveLength(visitHandSize(n));
  });
  it('the pocket survives to the next visit but never into the next leg', () => {
    const n = startNight(21);
    const kept = currentLeg(n).hand[0];
    expect(pocketCard(n, kept.id).ok).toBe(true);
    setScore(n, 40);
    play(n, 'd20');
    expect(n.phase).toBe('SHOP');
    shopLeave(n);
    const next = currentLeg(n);
    expect(next.index).toBe(1);
    expect(next.pocket).toBeNull();
    // a fresh deck, a normal-sized hand: nothing carried over but the library itself
    expect(next.hand).toHaveLength(visitHandSize(n));
    expect(next.deck).toHaveLength(n.library.length - visitHandSize(n));
    // the pocket belongs to the leg that filled it
    expect(n.legs[0].pocket).toBe(kept);
  });
});

// ---------------------------------------------------------------- the deliberate miss

describe('the deliberate miss: the wall ends the visit', () => {
  it('commitMiss scores nothing and forfeits the rest of the visit', () => {
    const n = startNight(22);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const { result, events } = commitMiss(n);
    expect(result.miss).toBe(true);
    expect(result.totalValue).toBe(0);
    expect(result.outcome).toBe('CONTINUE');
    expect(result.firedChalk).toEqual([]);
    expect(leg.score).toBe(100000);
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'HAND_DEALT']);
    const end = ev(events, 'VISIT_END');
    expect(end.missed).toBe(true);
    expect(end.busted).toBe(false);
    expect(end.total).toBe(0);
    expect(end.visit.throws).toHaveLength(1); // the other darts are gone
    expect(leg.visits).toHaveLength(2);
    expect(n.stats.misses).toBe(1);
    expect(n.stats.throwsMade).toBe(1);
  });
  it('a miss after a scoring dart keeps what was scored and stops there', () => {
    const n = startNight(22);
    const leg = currentLeg(n);
    setScore(n, 400);
    play(n, 't20');
    const { events } = commitMiss(n);
    expect(leg.score).toBe(340);
    expect(ev(events, 'VISIT_END').total).toBe(60);
    expect(ev(events, 'VISIT_END').visit.throws).toHaveLength(2);
    expect(leg.visits).toHaveLength(2);
    expect(leg.visits[1].scoreAtVisitStart).toBe(340);
  });
  it('a miss cannot bust, however tight the score', () => {
    const n = startNight(22);
    const leg = currentLeg(n);
    setScore(n, 1);
    const { result, events } = commitMiss(n);
    expect(result.outcome).toBe('CONTINUE');
    expect(leg.score).toBe(1);
    expect(leg.bustsThisLeg).toBe(0);
    expect(n.stats.busts).toBe(0);
    expect(ev(events, 'VISIT_END').busted).toBe(false);
  });
  it('commitCard with the wall card id is the same throw', () => {
    const n = startNight(22);
    setScore(n, 100000);
    const { result } = commitCard(n, WALL_CARD_ID);
    expect(result.miss).toBe(true);
    expect(result.intent.card.defId).toBe(WALL_CARD_ID);
    expect(currentLeg(n).visits).toHaveLength(2);
    expect(n.stats.misses).toBe(1);
  });
  it('the unspent hand of a missed visit is binned like any other', () => {
    const n = startNight(22);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const dealt = handIds(n);
    commitMiss(n);
    expect(leg.discard.map((c) => c.id).sort()).toEqual([...dealt].sort());
    expect(leg.hand).toHaveLength(visitHandSize(n));
    for (const id of dealt) expect(handIds(n)).not.toContain(id);
  });
  it('a missed visit still counts against the visit limit', () => {
    const n = startNight(22);
    const leg = currentLeg(n);
    setScore(n, 100000);
    for (let v = 0; v < LEGS[0].visitLimit; v++) {
      expect(n.status).toBe('ACTIVE');
      commitMiss(n);
    }
    expect(leg.visits).toHaveLength(LEGS[0].visitLimit);
    expect(leg.status).toBe('TIMED_OUT');
    expect(n.status).toBe('LOST');
    expect(n.stats.misses).toBe(LEGS[0].visitLimit);
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
  it('a bust every visit uses up the visit limit and loses the night', () => {
    const n = startNight(5);
    const leg = currentLeg(n);
    const limit = LEGS[0].visitLimit;
    let last: { events: EngineEvent[] } | null = null;
    for (let v = 0; v < limit; v++) {
      expect(leg.visits).toHaveLength(v + 1);
      setScore(n, 10);
      last = play(n, 't20');
    }
    expect(leg.visits).toHaveLength(limit);
    expect(leg.bustsThisLeg).toBe(limit);
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
    expect(eventTypes(events)).toEqual(['THROW']); // the visit carries on with the hand it has
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

// ---------------------------------------------------------------- heat

describe('heat: the crowd warms up, a bust wipes it', () => {
  it('a visit thrown out without a bust is one heat, reported on VISIT_END', () => {
    const n = startNight(23);
    const leg = currentLeg(n);
    setScore(n, 100000);
    expect(leg.heat).toBe(0);
    const { events } = playVisit(n);
    expect(ev(events, 'VISIT_END').heat).toBe(1);
    expect(leg.heat).toBe(1);
    expect(n.stats.bestHeat).toBe(1);
  });
  it('heat builds one per visit and stops at HEAT_CAP', () => {
    const n = startNight(23);
    const leg = currentLeg(n);
    setScore(n, 100000);
    const seen: number[] = [];
    for (let v = 0; v < HEAT_CAP + 2; v++) {
      playVisit(n);
      seen.push(leg.heat);
    }
    const climbing = Array.from({ length: HEAT_CAP }, (_, i) => i + 1);
    expect(seen).toEqual([...climbing, HEAT_CAP, HEAT_CAP]);
    expect(n.stats.bestHeat).toBe(HEAT_CAP);
  });
  it('a bust wipes the heat and says so with HEAT_LOST', () => {
    const n = startNight(23);
    const leg = currentLeg(n);
    setScore(n, 100000);
    playVisit(n);
    playVisit(n);
    expect(leg.heat).toBe(2);
    setScore(n, 10);
    const { events } = play(n, 't20');
    expect(eventTypes(events)).toEqual(['THROW', 'HEAT_LOST', 'VISIT_END', 'HAND_DEALT']);
    expect(ev(events, 'HEAT_LOST').from).toBe(2);
    expect(leg.heat).toBe(0);
    expect(ev(events, 'VISIT_END').heat).toBe(0);
    expect(n.stats.bestHeat).toBe(2); // the night remembers the best
  });
  it('a bust from cold has nothing to lose and says nothing', () => {
    const n = startNight(23);
    setScore(n, 10);
    const { events } = play(n, 't20');
    expect(eventTypes(events)).not.toContain('HEAT_LOST');
    expect(currentLeg(n).heat).toBe(0);
  });
  it('walking away at the wall holds the heat where it is', () => {
    const n = startNight(23);
    const leg = currentLeg(n);
    setScore(n, 100000);
    playVisit(n);
    expect(leg.heat).toBe(1);
    const { events } = commitMiss(n);
    expect(ev(events, 'VISIT_END').missed).toBe(true);
    expect(ev(events, 'VISIT_END').heat).toBe(1);
    expect(leg.heat).toBe(1); // held, not raised
    playVisit(n);
    expect(leg.heat).toBe(2); // and it climbs again on a visit actually thrown out
  });
  it('heat multiplies the whole leg subtotal: ×2 at the cap', () => {
    const n = startNight(23);
    const leg = currentLeg(n);
    setScore(n, 100000);
    for (let v = 0; v < HEAT_CAP - 1; v++) playVisit(n);
    expect(leg.heat).toBe(HEAT_CAP - 1);
    setScore(n, 40);
    play(n, 'd20'); // the finishing visit takes it to the cap
    const r = currentLeg(n).reward as PotBreakdown;
    expect(r.heat).toBe(HEAT_CAP);
    expect(r.heatBonus).toBe(subtotalOf(r));
    expect(r.total).toBe(subtotalOf(r) * 2);
    expect(r.visitsUsed).toBe(HEAT_CAP);
    expectAddsUp(r);
    expect(r).toEqual(potReward(currentLeg(n)));
    expect(n.pot).toBe(r.total);
    expect(n.stats.bestHeat).toBe(HEAT_CAP);
  });
  it('every leg starts cold', () => {
    const n = startNight(23);
    setScore(n, 100000);
    playVisit(n);
    setScore(n, 40);
    play(n, 'd20');
    expect(currentLeg(n).heat).toBe(2);
    shopLeave(n);
    expect(currentLeg(n).heat).toBe(0);
    expect(n.stats.bestHeat).toBe(2);
  });
});

// ---------------------------------------------------------------- the setup bonus

describe('the setup bonus: leaving it right', () => {
  it('a visit that ends on a score the deck can still finish banks SETUP_BONUS', () => {
    const n = startNight(24);
    const leg = currentLeg(n);
    setScore(n, 140);
    const { events } = playPoolThenMiss(n, ['t20']); // leaves 80: D20, D20 finishes it
    expect(leg.score).toBe(80);
    const bonus = ev(events, 'SETUP_BONUS');
    expect(bonus.score).toBe(80);
    expect(bonus.pot).toBe(SETUP_BONUS);
    expect(leg.setupBonuses).toBe(SETUP_BONUS);
    expect(n.stats.setups).toBe(1);
    // banked, not paid on the spot: the Pot only moves when the leg is won
    expect(n.pot).toBe(0);
    const types = eventTypes(events);
    expect(types.indexOf('SETUP_BONUS')).toBeLessThan(types.indexOf('VISIT_END'));
  });
  it('nothing is banked when the score is out of reach', () => {
    const n = startNight(24);
    setScore(n, 400);
    const { events } = playPoolThenMiss(n, ['t20']); // 340 finishes nothing
    expect(currentLeg(n).score).toBe(340);
    expect(eventTypes(events)).not.toContain('SETUP_BONUS');
    expect(currentLeg(n).setupBonuses).toBe(0);
    expect(n.stats.setups).toBe(0);
  });
  it('a busted visit banks nothing, even though the reverted score is finishable', () => {
    const n = startNight(24);
    const leg = currentLeg(n);
    setScore(n, 40);
    const { events } = play(n, 't20'); // bust: back to 40, which D20 would finish
    expect(leg.score).toBe(40);
    expect(eventTypes(events)).not.toContain('SETUP_BONUS');
    expect(leg.setupBonuses).toBe(0);
    expect(n.stats.setups).toBe(0);
  });
  it('the bonus is capped at SETUP_BONUS_CAP per leg', () => {
    const n = startNight(24);
    const leg = currentLeg(n);
    const awards = SETUP_BONUS_CAP / SETUP_BONUS;
    for (let v = 0; v < awards + 2; v++) {
      setScore(n, 140);
      playPoolThenMiss(n, ['t20']);
    }
    expect(leg.setupBonuses).toBe(SETUP_BONUS_CAP);
    expect(n.stats.setups).toBe(awards);
  });
  it('the banked bonuses are paid inside the Pot at the checkout', () => {
    const n = startNight(24);
    const leg = currentLeg(n);
    setScore(n, 140);
    playPoolThenMiss(n, ['t20']); // banks one, leaves 80
    expect(leg.setupBonuses).toBe(SETUP_BONUS);
    playAll(n, ['d20', 'd20']); // 80 → 40 → 0
    const r = currentLeg(n).reward as PotBreakdown;
    expect(r.setup).toBe(SETUP_BONUS);
    expect(r.visitsUsed).toBe(2);
    expect(r.cleanLeg).toBe(3);
    expectAddsUp(r);
    expect(r).toEqual(potReward(currentLeg(n)));
    expect(n.pot).toBe(r.total);
    expect(n.stats.setups).toBe(1);
    // the same leg without the setup is worth exactly SETUP_BONUS less, before heat
    expect(subtotalOf(r) - SETUP_BONUS).toBe(r.base + r.unusedVisits + r.bigFinish + r.cleanLeg + r.nineDarter);
  });
  it('a leg won without ever leaving a finishable score pays no setup', () => {
    const n = startNight(24);
    setScore(n, 40);
    play(n, 'd20');
    expect((currentLeg(n).reward as PotBreakdown).setup).toBe(0);
    expect(n.stats.setups).toBe(0);
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
    expect(throws).toBe(LEGS[0].visitLimit * throwsPerVisit(n));
    expect(leg.visits).toHaveLength(LEGS[0].visitLimit);
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
    expect(currentLeg(n).visits).toHaveLength(LEGS[2].visitLimit);
    expect(n.status).toBe('LOST');
    expect(n.stats.legsWon).toBe(0);
  });
  it('the visit limit is not reached while the score can still be finished on the last visit', () => {
    const n = startNight(6);
    const leg = currentLeg(n);
    setScore(n, 100000);
    for (let i = 0; i < (LEGS[0].visitLimit - 1) * throwsPerVisit(n); i++) play(n, 's1');
    expect(leg.visits).toHaveLength(LEGS[0].visitLimit);
    expect(n.status).toBe('ACTIVE');
    setScore(n, 40);
    play(n, 'd20');
    expect(n.status).toBe('ACTIVE');
    expect(leg.status).toBe('CHECKED_OUT');
  });
});

// ---------------------------------------------------------------- checkout and the pot

describe('checkout (TDD §9.2) and the Pot (TDD §4)', () => {
  it('D20 from 40 on visit 1 of leg 1: CHECKED_OUT, base + unused + clean, warmed by the finishing visit, shop opens', () => {
    const n = startNight(7);
    setScore(n, 40);
    const { result, events } = play(n, 'd20');
    const leg = currentLeg(n);
    expect(result.outcome).toBe('CHECKOUT');
    expect(leg.status).toBe('CHECKED_OUT');
    expect(leg.score).toBe(0);
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'CHECKOUT', 'ACHIEVEMENT', 'SHOP_OPEN']);
    expect(ev(events, 'VISIT_END').busted).toBe(false);
    const subtotal = LEGS[0].reward + (LEGS[0].visitLimit - 1) + 3;
    expect(leg.reward).toEqual({
      base: LEGS[0].reward,
      unusedVisits: LEGS[0].visitLimit - 1,
      bigFinish: 0,
      cleanLeg: 3,
      nineDarter: 0,
      setup: 0,
      heat: 1, // the checkout visit itself is a visit ended without a bust
      heatBonus: Math.floor(subtotal / HEAT_CAP),
      total: firstVisitPot(0),
      checkoutFrom: 40,
      visitsUsed: 1,
    });
    expect(leg.reward).toEqual(potReward(leg));
    expectAddsUp(leg.reward as PotBreakdown);
    expect(ev(events, 'CHECKOUT').reward).toEqual(leg.reward);
    expect(ev(events, 'CHECKOUT').legIndex).toBe(0);
    expect(n.pot).toBe(firstVisitPot(0));
    expect(n.phase).toBe('SHOP');
    expect(n.status).toBe('ACTIVE');
    expect(n.stats.legsWon).toBe(1);
    expect(n.stats.potEarned).toBe(firstVisitPot(0));
    expect(n.stats.bestCheckout).toBe(40);
    expect(n.stats.cleanLegs).toBe(1);
    expect(n.stats.bigFinishes).toBe(0);
  });
  it('a big finish (checkout from ≥ 100) adds 2', () => {
    const n = startNight(7);
    setScore(n, 100);
    play(n, 't20');
    play(n, 'd20');
    const reward = currentLeg(n).reward as PotBreakdown;
    expect(reward).toMatchObject({ base: LEGS[0].reward, unusedVisits: LEGS[0].visitLimit - 1, bigFinish: 2, cleanLeg: 3, nineDarter: 0, heat: 1, checkoutFrom: 100 });
    expectAddsUp(reward);
    const sub = LEGS[0].reward + (LEGS[0].visitLimit - 1) + 2 + 3;
    expect(reward.total).toBe(sub + Math.floor(sub / HEAT_CAP));
    expect(n.pot).toBe(reward.total);
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
    const reward = currentLeg(n).reward as PotBreakdown;
    expect(reward).toMatchObject({ base: LEGS[0].reward, unusedVisits: LEGS[0].visitLimit - 2, bigFinish: 0, cleanLeg: 0, nineDarter: 0, visitsUsed: 2 });
    expectAddsUp(reward);
    // the bust wiped the heat, so only the finishing visit is warm
    expect(reward.heat).toBe(1);
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
    const reward = currentLeg(n).reward as PotBreakdown;
    expect(reward).toMatchObject({
      base: LEGS[0].reward,
      unusedVisits: LEGS[0].visitLimit - 3,
      bigFinish: 2,
      cleanLeg: 3,
      nineDarter: 5,
      setup: 0,
      heat: 3, // three visits, none of them busted
      checkoutFrom: 141,
      visitsUsed: 3,
    });
    expectAddsUp(reward);
    expect(n.pot).toBe(reward.total);
    expect(n.stats.nineDarters).toBe(1);
    expect(n.stats.oneEighties).toBe(2);
    expect(n.stats.bestVisit).toBe(180);
    expect(n.stats.throwsMade).toBe(9);
    expect(n.stats.bestHeat).toBe(3);
  });
  it.each([0, 1, 2, 3, 4, 5, 6])('leg %i: base reward from LEGS plus one unused visit per visit not used', (i) => {
    const n = createNight(9);
    n.legIndex = i;
    beginLeg(n);
    setScore(n, 40);
    play(n, 'd20');
    const reward = currentLeg(n).reward as PotBreakdown;
    expect(reward).toMatchObject({ base: LEGS[i].reward, unusedVisits: LEGS[i].visitLimit - 1, cleanLeg: 3, total: firstVisitPot(i) });
    expectAddsUp(reward);
    expect(n.pot).toBe(firstVisitPot(i));
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
    expect(n.pot).toBe(firstVisitPot(0));
    shopLeave(n);
    setScore(n, 40);
    play(n, 'd20');
    expect(n.pot).toBe(firstVisitPot(0) + firstVisitPot(1));
    expect(n.stats.legsWon).toBe(2);
    expect(n.legs).toHaveLength(2);
    // heat is a leg's own crowd: leg 2 started cold
    expect(n.legs[1].reward?.heat).toBe(1);
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
    const before = n.library.map((c) => ({ defId: c.defId }));
    const out = shopBuy(n, 0);
    expect(out.ok).toBe(true);
    expect(eventTypes(out.events)).toEqual(['SHOP_BUY']);
    expect(ev(out.events, 'SHOP_BUY').slot).toBe(slot);
    expect(slot.sold).toBe(true);
    expect(n.library).toHaveLength(before.length + 1);
    expect(composition(n.library)).toBe(composition([...before, { defId: slot.defId }]));
    expect(n.pot).toBe(50 - slot.cost);
    expect(n.stats.potSpent).toBe(slot.cost);
    expect(n.stats.cardsBought).toBe(1);
    expect(new Set(n.library.map((c) => c.id)).size).toBe(before.length + 1);
  });
  it('cannot buy without enough pot; the library and pot are untouched', () => {
    const n = inShop(11, 0);
    const out = shopBuy(n, 0);
    expect(out).toEqual({ ok: false, reason: 'not enough pot', events: [] });
    expect(n.library).toHaveLength(createNight(11).library.length);
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
    const before = n.library.length;
    // the filler you buy your way out of: the weakest single in the library
    const victim = n.library.filter((c) => c.defId.startsWith('s')).sort((a, b) => baseOf(a.defId) - baseOf(b.defId))[0];
    const held = countOf(n.library, victim.defId);
    expect(shopBuy(n, 3)).toMatchObject({ ok: false, reason: 'choose a card' });
    expect(shopBuy(n, 3, { cardId: 'nope' })).toMatchObject({ ok: false, reason: 'choose a card' });
    const out = shopBuy(n, 3, { cardId: victim.id });
    expect(out.ok).toBe(true);
    expect(n.library).toHaveLength(before - 1);
    expect(n.library.some((c) => c.id === victim.id)).toBe(false);
    expect(countOf(n.library, victim.defId)).toBe(held - 1);
    expect(n.pot).toBe(50 - SERVICE_COST.REMOVE);
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
    const before = n.library.length;
    const held = countOf(n.library, 't20');
    const t20 = n.library.find((c) => c.defId === 't20') as NonNullable<(typeof n.library)[number]>;
    expect(shopBuy(n, 3, { cardId: t20.id }).ok).toBe(true);
    expect(n.library).toHaveLength(before + 1);
    expect(countOf(n.library, 't20')).toBe(held + 1);
    expect(new Set(n.library.map((c) => c.id)).size).toBe(before + 1);
    expect(n.pot).toBe(50 - SERVICE_COST.DUPLICATE);
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
    expect(n.library).toHaveLength(createNight(11).library.length); // sharpening never changes the count
  });
  it('a sharpened card carries into the next leg', () => {
    const n = inShop(11, 50);
    setSlot(n, 3, { kind: 'SERVICE', service: 'SHARPEN', cost: 5, sold: false });
    const trebles = countOf(n.library, 't19');
    const s19 = n.library.find((c) => c.defId === 's19') as NonNullable<(typeof n.library)[number]>;
    shopBuy(n, 3, { cardId: s19.id });
    shopLeave(n);
    expect(composition([...currentLeg(n).deck, ...currentLeg(n).hand])).toBe(composition(n.library));
    expect(countOf(n.library, 't19')).toBe(trebles + 1);
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
    expect(leg.visitLimit).toBe(LEGS[1].visitLimit);
    expect(leg.score).toBe(501);
    expect(leg.hand).toHaveLength(visitHandSize(n));
    expect(composition([...leg.deck, ...leg.hand])).toBe(composition(n.library));
    expect(leg.deck.length + leg.hand.length).toBe(n.library.length);
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
    expect(currentLeg(n).visitLimit).toBe(LEGS[7].visitLimit);
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
    // every leg checked out on visit 1: (base + unused + clean) × the one visit of heat
    const expectedPot = LEGS.slice(0, 7).reduce((a, _d, i) => a + firstVisitPot(i), 0);
    expect(n.pot).toBe(expectedPot);
    expect(n.stats.bestHeat).toBe(1);
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
    expect(currentLeg(seven).reward?.unusedVisits).toBe(LEGS[0].visitLimit - 7);
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
    // The engine peeks before dealing, and the visit hand is dealt off the top,
    // so the peek is the first three cards of the hand about to be dealt.
    expect(leg.peek).toEqual(handIds(n).slice(0, 3));
    const first = leg.peek.slice();
    setScore(n, 100000);
    // One hand covers the visit: throw from it until the visit ends.
    playVisit(n);
    expect(leg.visits).toHaveLength(2);
    expect(leg.peek).toHaveLength(3);
    expect(leg.peek).not.toEqual(first);
    expect(leg.peek).toEqual(handIds(n).slice(0, 3));
  });
  it('without chalked_up the peek is empty', () => {
    expect(currentLeg(startNight(16)).peek).toEqual([]);
  });
  it('pot earned and spent are tracked separately', () => {
    const n = inShop(16, firstVisitPot(0));
    expect(n.stats.potEarned).toBe(firstVisitPot(0));
    expect(n.stats.potSpent).toBe(0);
    setSlot(n, 0, { kind: 'CARD', defId: 't20', cost: 6, sold: false });
    shopBuy(n, 0);
    shopRefresh(n);
    expect(n.stats.potSpent).toBe(6 + SHOP_REFRESH_COST);
    expect(n.pot).toBe(firstVisitPot(0) - 6 - SHOP_REFRESH_COST);
    expect(n.stats.potEarned).toBe(firstVisitPot(0));
  });
});
