/**
 * The night state machine (TDD §2, §3.4, §4, §4.1, §6.1, §9), rebuilt for free
 * aim and the slate (docs/decisions/design.md §5).
 *
 * There is no deck, no hand and no dealt target: the player aims anywhere on
 * the board, every dart, always. What this file pins is everything the visit
 * is wrapped in — the legs and their limits, the deliberate miss, bust, heat,
 * timeout, the checkout and its Pot, the shop, the kit, night end,
 * achievements and the stats counters. The slate's own rules live in
 * tests/slate.test.ts and the aim's in tests/aim.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CHALK_DEFS, chalkDef } from '../src/content/chalkdefs.ts';
import { INTERVENTIONS, KIT_CAP, STARTING_KIT, interventionDef } from '../src/content/interventions.ts';
import {
  DEFAULT_CHALK_SLOTS,
  DEFAULT_THROWS_PER_VISIT,
  HEAT_CAP,
  LEGS,
  LEG_COUNT,
  SERVICE_COST,
  SHOP_REFRESH_COST,
  SLATE_SIZE,
  STARTING_POT,
  streakMultiplier,
} from '../src/content/legs.ts';
import { OCHES } from '../src/content/oches.ts';
import { CONTRACTS } from '../src/core/slate.ts';
import { bigFinishBonus, potReward } from '../src/core/rules.ts';
import {
  addChalk,
  beginLeg,
  commitMiss,
  commitThrow,
  createNight as createNightRaw,
  currentLeg,
  currentVisit,
  generateShop,
  hasChalk,
  kitCount,
  kitPrice,
  legName,
  shopBuy,
  shopLeave,
  shopRefresh,
  slateSize,
  steadinessOf,
  throwsPerVisit,
  visitTotal,
} from '../src/core/state.ts';
import type { EngineEvent, NightState, OcheId, PotBreakdown, ShopSlot } from '../src/core/types.ts';
import { ev, eventTypes, setScore, startNight, take, target, throwAll, throwAt, throwThenMiss } from './helpers.ts';

/** These tests pin arithmetic and event order, not luck: every dart lands where it is aimed. */
const createNight = (seed: number, oche: OcheId = 'local') => createNightRaw(seed, oche, { trueAim: true });

/** A night parked at the start of leg `index` (0-based), with its first visit open. */
function nightAtLeg(index: number, seed = 1, chalk: string[] = []): NightState {
  const n = createNight(seed);
  for (const id of chalk) addChalk(n, id);
  n.legIndex = index;
  beginLeg(n);
  return n;
}

/** The parts of a Pot breakdown before the heat multiplier. */
function subtotalOf(r: PotBreakdown): number {
  return r.base + r.bigFinish + r.cleanLeg + r.nineDarter;
}

/** Every breakdown must add up: subtotal, plus the heat share, plus the clean sheet on the leg and its finish. */
function expectAddsUp(r: PotBreakdown): void {
  expect(r.heat).toBeGreaterThanOrEqual(0);
  expect(r.heat).toBeLessThanOrEqual(HEAT_CAP);
  expect(r.heatBonus).toBe(Math.floor((subtotalOf(r) * r.heat) / HEAT_CAP));
  expect(r.streakMult).toBe(streakMultiplier(r.streak));
  expect(r.streakBonus).toBe((r.base + r.bigFinish + r.nineDarter) * (r.streakMult - 1));
  expect(r.total).toBe(subtotalOf(r) + r.heatBonus + r.streakBonus);
}

/**
 * The Pot for a leg checked out on its first visit with no bust: the base plus
 * the clean leg, warmed by the single pip of heat the finishing visit itself
 * earns. Nothing is paid for the visits left unused — that paid the player to
 * throw the treble twenty and get out, which is the behaviour the rebuild
 * exists to stop (rules.ts). Derived from LEGS so retuning cannot rot it.
 */
function firstVisitPot(legIndex: number): number {
  const subtotal = LEGS[legIndex].reward + 3;
  return subtotal + Math.floor(subtotal / HEAT_CAP);
}

/** A night in the shop after a one-visit D20 checkout from 40 on leg 1, with `pot` Pot. */
function inShop(seed = 11, pot = 50): NightState {
  const n = startNight(seed);
  setScore(n, 40);
  throwAt(n, 'D20');
  expect(n.phase).toBe('SHOP');
  n.pot = pot;
  return n;
}

function setSlot(n: NightState, i: number, slot: ShopSlot): void {
  (n.shop as NonNullable<NightState['shop']>).slots[i] = slot;
}

// ---------------------------------------------------------------- creation / oches

describe('a fresh night (TDD §6.1, §9.4)', () => {
  it('The Local: the starting Pot, the starting kit, no chalk, five slots', () => {
    const n = createNight(1);
    expect(n.pot).toBe(STARTING_POT);
    expect(n.kit).toEqual(STARTING_KIT);
    expect(n.chalk).toEqual([]);
    expect(n.chalkSlots).toBe(DEFAULT_CHALK_SLOTS);
    expect(n.oche).toBe('local');
  });

  it('fresh night invariants: leg 0, ACTIVE, phase LEG, no legs yet, nothing paid, no achievements', () => {
    const n = createNight(7);
    expect(n.legIndex).toBe(0);
    expect(n.status).toBe('ACTIVE');
    expect(n.phase).toBe('LEG');
    expect(n.legs).toEqual([]);
    expect(n.paid).toEqual({});
    expect(n.achievements).toEqual([]);
    expect(n.streak).toBe(0);
    expect(n.consecutiveBusts).toBe(0);
    expect(n.shop).toBeNull();
    expect(n.trueAim).toBe(true);
    expect(Object.values(n.stats).every((v) => v === 0)).toBe(true);
  });

  it('the seed is stored as a uint32', () => {
    expect(createNight(1).seed).toBe(1);
    expect(createNightRaw(-1).seed).toBe(0xffffffff);
    expect(createNightRaw(0).rng.s).toBe(0);
  });

  it('The Sharp starts with DOUBLED in the kit', () => {
    const n = createNight(1, 'sharp');
    expect(n.kit).toEqual([...STARTING_KIT, 'doubled']);
    expect(kitCount(n, 'doubled')).toBe(1);
  });

  it('The Thin starts with AGAIN and a RUB OUT', () => {
    const n = createNight(1, 'thin');
    expect(n.kit).toEqual([...STARTING_KIT, 'again', 'rubout']);
  });

  it('The Steady starts holding forgiving_oche and nothing else', () => {
    const n = createNight(1, 'steady');
    expect(n.chalk.map((c) => c.def.id)).toEqual(['forgiving_oche']);
    expect(hasChalk(n, 'forgiving_oche')).toBe(true);
    expect(n.kit).toEqual(STARTING_KIT);
  });

  it('The Wide: six chalk slots, four more Pot, and +2 on every kit price', () => {
    const n = createNight(1, 'wide');
    expect(n.chalkSlots).toBe(DEFAULT_CHALK_SLOTS + 1);
    expect(n.pot).toBe(STARTING_POT + 4);
    for (const def of INTERVENTIONS) expect(kitPrice(n, def.id)).toBe(def.cost + 2);
    expect(kitPrice(createNight(1), 'steady')).toBe(interventionDef('steady').cost);
  });

  it('every other oche has five chalk slots and no chalk', () => {
    for (const oche of ['local', 'sharp', 'thin'] as OcheId[]) {
      const n = createNight(1, oche);
      expect(n.chalkSlots).toBe(DEFAULT_CHALK_SLOTS);
      expect(n.chalk).toEqual([]);
    }
  });

  it('the five oches are defined with the TDD names', () => {
    expect(OCHES.map((o) => o.id)).toEqual(['local', 'sharp', 'steady', 'wide', 'thin']);
    expect(OCHES.map((o) => o.name)).toEqual(['The Local', 'The Sharp', 'The Steady', 'The Wide', 'The Thin']);
  });

  it('the kit only ever holds real interventions', () => {
    for (const oche of OCHES.map((o) => o.id)) {
      for (const id of createNight(1, oche).kit) expect(() => interventionDef(id)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------- legs

describe('legs and visit limits (TDD §4)', () => {
  it('the LEGS table: eight named legs, the short game first, the Decider last', () => {
    expect(LEGS).toHaveLength(8);
    expect(LEG_COUNT).toBe(8);
    expect(LEGS.map((l) => l.name)).toEqual(['First Round', 'Second Round', 'Quarter', 'Interval', 'Semi', 'Last Four', 'Final', 'The Decider']);
    expect(LEGS.map((l) => l.start)).toEqual([301, 301, 501, 501, 501, 501, 501, 501]);
    expect(LEGS.map((_, i) => legName(i))).toEqual(LEGS.map((l) => l.name));
  });

  it('the reward ladder climbs, and the last leg pays in the win itself', () => {
    for (let i = 1; i < LEG_COUNT - 1; i++) expect(LEGS[i].reward, LEGS[i].name).toBeGreaterThan(LEGS[i - 1].reward);
    expect(LEGS[LEG_COUNT - 1].reward).toBe(0);
  });

  /**
   * The limits are tuned content (docs/decisions/balance.md), so this asserts
   * their shape rather than their values: every leg has to be winnable by a
   * good scoring run with visits to spare for the slate, and the Decider has
   * to be the tightest of the lot.
   */
  it('every visit limit leaves room for the slate, and the Decider is the tightest', () => {
    for (const leg of LEGS) {
      // more visits than a perfect run needs, and no more than three times what
      // an ordinary hundred-a-visit run needs
      const perfect = Math.ceil(leg.start / 180);
      const ordinary = Math.ceil(leg.start / 100);
      expect(leg.visitLimit, leg.name).toBeGreaterThan(perfect);
      expect(leg.visitLimit, leg.name).toBeLessThanOrEqual(3 * ordinary);
      expect(Number.isInteger(leg.visitLimit)).toBe(true);
    }
    expect(Math.min(...LEGS.map((l) => l.visitLimit))).toBe(LEGS[LEG_COUNT - 1].visitLimit);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('leg %i takes its limit, name and starting score from LEGS', (i) => {
    const n = nightAtLeg(i);
    const leg = currentLeg(n);
    expect(leg.index).toBe(i);
    expect(leg.visitLimit).toBe(LEGS[i].visitLimit);
    expect(leg.score).toBe(LEGS[i].start);
    expect(legName(i)).toBe(LEGS[i].name);
  });

  it('beginLeg opens one visit, a cold crowd, a clean sheet and a fresh slate', () => {
    const n = startNight(3);
    const leg = currentLeg(n);
    expect(leg.visits).toHaveLength(1);
    expect(currentVisit(leg).scoreAtVisitStart).toBe(LEGS[0].start);
    expect(currentVisit(leg).throws).toEqual([]);
    expect(leg.heat).toBe(0);
    expect(leg.dirty).toBe(false);
    expect(leg.bustsThisLeg).toBe(0);
    expect(leg.slate).toEqual([]);
    expect(leg.ledger).toEqual([]);
    expect(leg.status).toBe('ACTIVE');
  });

  it('LEG_START then SLATE_OFFERED, and the offer is this visit’s contracts', () => {
    const n = createNight(3);
    const events = beginLeg(n);
    expect(eventTypes(events)).toEqual(['LEG_START', 'SLATE_OFFERED']);
    expect(ev(events, 'LEG_START').legIndex).toBe(0);
    const offered = ev(events, 'SLATE_OFFERED');
    expect(offered.visitIndex).toBe(0);
    expect(offered.offer).toEqual(currentLeg(n).offer);
    expect(offered.offer).toHaveLength(slateSize(n));
  });

  it('beginLeg throws once the night is over', () => {
    const n = createNight(1);
    n.status = 'LOST';
    expect(() => beginLeg(n)).toThrow();
  });
});

// ---------------------------------------------------------------- the visit

describe('the visit: three darts, aimed anywhere (design.md §5.1)', () => {
  it('a dart at any of the 62 targets scores it, and the visit stays open', () => {
    const n = startNight(1);
    const { result, events } = throwAt(n, 'T20');
    expect(result.totalValue).toBe(60);
    expect(result.intent.target).toEqual({ region: 'T', bed: 20 });
    expect(result.intent.visitThrowIndex).toBe(0);
    expect(currentLeg(n).score).toBe(241);
    expect(eventTypes(events)).toEqual(['THROW']);
    expect(currentVisit(currentLeg(n)).throws).toHaveLength(1);
  });

  it('three darts end the visit and open the next one', () => {
    const n = startNight(1);
    throwAll(n, ['T20', 'T20']);
    const { events } = throwAt(n, 'T20');
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'ONE_EIGHTY', 'SLATE_OFFERED']);
    const end = ev(events, 'VISIT_END');
    expect(end.total).toBe(180);
    expect(end.busted).toBe(false);
    expect(end.missed).toBe(false);
    const leg = currentLeg(n);
    expect(leg.visits).toHaveLength(2);
    expect(leg.score).toBe(121);
    expect(currentVisit(leg).scoreAtVisitStart).toBe(121);
  });

  it('the throw index runs 0, 1, 2 within a visit and restarts', () => {
    const n = startNight(1);
    expect(throwAt(n, 'S1').result.intent.visitThrowIndex).toBe(0);
    expect(throwAt(n, 'S1').result.intent.visitThrowIndex).toBe(1);
    expect(throwAt(n, 'S1').result.intent.visitThrowIndex).toBe(2);
    expect(throwAt(n, 'S1').result.intent.visitThrowIndex).toBe(0);
  });

  it('fourth_dart: four darts come out of one visit', () => {
    const n = startNight(1, 'local', ['fourth_dart']);
    expect(throwsPerVisit(n)).toBe(4);
    throwAll(n, ['S1', 'S1', 'S1']);
    expect(currentLeg(n).visits).toHaveLength(1);
    const { events } = throwAt(n, 'S1');
    expect(eventTypes(events)).toContain('VISIT_END');
    expect(currentLeg(n).visits).toHaveLength(2);
    expect(DEFAULT_THROWS_PER_VISIT).toBe(3);
  });

  it('a throw outside a leg throws', () => {
    const n = startNight(1);
    n.phase = 'SHOP';
    expect(() => throwAt(n, 'T20')).toThrow();
    n.phase = 'LEG';
    currentLeg(n).status = 'CHECKED_OUT';
    expect(() => throwAt(n, 'T20')).toThrow();
  });
});

// ---------------------------------------------------------------- the deliberate miss

describe('the deliberate miss: the wall ends the visit', () => {
  it('commitMiss scores nothing and forfeits the rest of the visit', () => {
    const n = startNight(1);
    const { result, events } = commitMiss(n);
    expect(result.miss).toBe(true);
    expect(result.totalValue).toBe(0);
    expect(result.aim).toBe('wall');
    expect(result.hits).toEqual([]);
    expect(currentLeg(n).score).toBe(301);
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'SLATE_OFFERED']);
    expect(ev(events, 'VISIT_END').missed).toBe(true);
    expect(currentLeg(n).visits).toHaveLength(2);
    expect(n.stats.misses).toBe(1);
  });

  it('a miss after a scoring dart keeps what was scored and stops there', () => {
    const n = startNight(1);
    throwAt(n, 'T20');
    commitMiss(n);
    expect(currentLeg(n).score).toBe(241);
    expect(visitTotal(currentLeg(n).visits[0])).toBe(60);
  });

  it('a miss cannot bust, however tight the score', () => {
    const n = startNight(1);
    setScore(n, 2);
    const { result } = commitMiss(n);
    expect(result.outcome).toBe('CONTINUE');
    expect(currentLeg(n).score).toBe(2);
    expect(n.stats.busts).toBe(0);
  });

  it('a missed visit still counts against the visit limit', () => {
    const n = nightAtLeg(7);
    for (let i = 0; i < LEGS[7].visitLimit; i++) commitMiss(n);
    expect(currentLeg(n).status).toBe('TIMED_OUT');
    expect(n.status).toBe('LOST');
  });

  it('throwing at the wall by name is the same throw', () => {
    const n = startNight(1);
    const { result } = throwAt(n, 'WALL');
    expect(result.miss).toBe(true);
    expect(target('WALL')).toEqual({ region: 'W' });
  });
});

// ---------------------------------------------------------------- bust

describe('bust (TDD §3.4)', () => {
  it('reverts to the visit-start score, ends the visit and counts against the limit', () => {
    const n = startNight(1);
    setScore(n, 100);
    throwAt(n, 'T20'); // 40 left
    const { result, events } = throwAt(n, 'T20'); // −20
    expect(result.outcome).toBe('BUST');
    expect(result.scoreCommitted).toBe(100);
    expect(currentLeg(n).score).toBe(100);
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'SLATE_OFFERED']);
    expect(ev(events, 'VISIT_END').busted).toBe(true);
    expect(ev(events, 'VISIT_END').total).toBe(0);
    expect(currentLeg(n).bustsThisLeg).toBe(1);
    expect(currentLeg(n).dirty).toBe(true);
    expect(n.stats.busts).toBe(1);
    expect(currentLeg(n).visits).toHaveLength(2);
  });

  it('exactly 1 is a bust, and so is exactly 0 without a double', () => {
    for (const [score, t] of [[21, 'S20'], [20, 'S20'], [60, 'T20'], [25, 'OB']] as const) {
      const n = startNight(1);
      setScore(n, score);
      expect(throwAt(n, t).result.outcome, `${score} on ${t}`).toBe('BUST');
    }
  });

  it('a bust every visit uses up the limit and loses the night', () => {
    const n = nightAtLeg(7);
    for (let i = 0; i < LEGS[7].visitLimit; i++) {
      setScore(n, 10);
      throwAt(n, 'T20');
    }
    expect(n.status).toBe('LOST');
    expect(n.stats.busts).toBe(LEGS[7].visitLimit);
  });

  it('forgiving_oche: the first bust of the leg never happened and the visit goes on', () => {
    const n = startNight(1, 'local', ['forgiving_oche']);
    setScore(n, 30);
    const { result, events } = throwAt(n, 'T20');
    expect(result.outcome).toBe('CONTINUE');
    expect(result.forgiven).toBe(true);
    expect(currentLeg(n).forgivenessUsed).toBe(true);
    expect(currentLeg(n).score).toBe(30);
    expect(eventTypes(events)).toEqual(['THROW']);
    expect(n.stats.busts).toBe(0);
    // the second one is real
    expect(throwAt(n, 'T20').result.outcome).toBe('BUST');
    expect(n.stats.busts).toBe(1);
  });

  it('cheap_chalk: a bust drops the score to 2, still ends the visit, and keeps the sheet clean', () => {
    const n = startNight(1, 'local', ['cheap_chalk']);
    setScore(n, 30);
    const { result } = throwAt(n, 'T20');
    expect(result.outcome).toBe('BUST');
    expect(currentLeg(n).score).toBe(2);
    expect(currentLeg(n).dirty).toBe(false);
    expect(currentLeg(n).bustsThisLeg).toBe(1);
  });

  it('a visit total counts a forgiven throw as 0 and a busted visit as 0', () => {
    const n = startNight(1, 'local', ['forgiving_oche']);
    setScore(n, 70);
    throwAt(n, 'T20'); // 10 left
    throwAt(n, 'T20'); // forgiven
    commitMiss(n);
    expect(visitTotal(currentLeg(n).visits[0])).toBe(60);
  });
});

// ---------------------------------------------------------------- heat

describe('heat: the crowd warms up, a bust or a walk wipes it', () => {
  it('a visit thrown out without a bust is one pip of heat, reported on VISIT_END', () => {
    const n = startNight(1);
    const { events } = throwAll(n, ['S1', 'S1', 'S1']);
    expect(ev(events, 'VISIT_END').heat).toBe(1);
    expect(currentLeg(n).heat).toBe(1);
    expect(n.stats.bestHeat).toBe(1);
  });

  it('heat builds one per visit and stops at HEAT_CAP', () => {
    const n = startNight(1);
    for (let i = 0; i < HEAT_CAP + 3; i++) throwAll(n, ['S1', 'S1', 'S1']);
    expect(currentLeg(n).heat).toBe(HEAT_CAP);
  });

  it('a bust wipes the heat and says so', () => {
    const n = startNight(1);
    throwAll(n, ['S1', 'S1', 'S1']);
    expect(currentLeg(n).heat).toBe(1);
    setScore(n, 10);
    const { events } = throwAt(n, 'T20');
    expect(eventTypes(events)).toContain('HEAT_LOST');
    expect(ev(events, 'HEAT_LOST')).toMatchObject({ from: 1, reason: 'BUST' });
    expect(currentLeg(n).heat).toBe(0);
  });

  it('a bust from cold has nothing to lose and says nothing', () => {
    const n = startNight(1);
    setScore(n, 10);
    const { events } = throwAt(n, 'T20');
    expect(eventTypes(events)).not.toContain('HEAT_LOST');
  });

  it('walking away at the wall saves the score and costs the crowd', () => {
    const n = startNight(1);
    throwAll(n, ['S1', 'S1', 'S1']);
    const { events } = commitMiss(n);
    expect(ev(events, 'HEAT_LOST')).toMatchObject({ from: 1, reason: 'MISS' });
    expect(currentLeg(n).heat).toBe(0);
    expect(currentLeg(n).dirty).toBe(false);
  });

  it('every leg starts cold', () => {
    const n = startNight(1);
    throwAll(n, ['S1', 'S1', 'S1']);
    setScore(n, 40);
    throwAt(n, 'D20');
    shopLeave(n);
    expect(currentLeg(n).heat).toBe(0);
  });

  it('the crowd steadies the hand: steadiness is heat × STEADY_PER_HEAT, plus the practice board', () => {
    const n = startNight(1);
    const leg = currentLeg(n);
    expect(steadinessOf(n, leg)).toBe(0);
    leg.heat = 2;
    expect(steadinessOf(n, leg)).toBe(8);
    const p = startNight(1, 'local', ['practice_board']);
    expect(steadinessOf(p, currentLeg(p))).toBe(8);
    currentLeg(p).heat = HEAT_CAP;
    expect(steadinessOf(p, currentLeg(p))).toBe(HEAT_CAP * 4 + 8);
  });

  it('heat multiplies the whole leg subtotal: ×2 at the cap', () => {
    const n = startNight(1);
    const leg = currentLeg(n);
    leg.heat = HEAT_CAP - 1; // the finishing visit adds the last pip
    setScore(n, 40);
    const { events } = throwAt(n, 'D20');
    const reward = ev(events, 'CHECKOUT').reward as PotBreakdown;
    expect(reward.heat).toBe(HEAT_CAP);
    expect(reward.heatBonus).toBe(subtotalOf(reward));
    expect(reward.total).toBe(subtotalOf(reward) * 2);
    expectAddsUp(reward);
  });
});

// ---------------------------------------------------------------- timeout

describe('timeout (TDD §9.1)', () => {
  it('running out of visits with a score still up loses the night', () => {
    const n = nightAtLeg(7);
    let last: EngineEvent[] = [];
    for (let i = 0; i < LEGS[7].visitLimit; i++) last = throwAll(n, ['S1', 'S1', 'S1']).events;
    expect(eventTypes(last)).toContain('LEG_TIMEOUT');
    expect(eventTypes(last)).toContain('NIGHT_LOST');
    expect(eventTypes(last)).not.toContain('SLATE_OFFERED');
    expect(ev(last, 'LEG_TIMEOUT').legIndex).toBe(7);
    expect(n.status).toBe('LOST');
    expect(n.phase).toBe('OVER');
    expect(currentLeg(n).status).toBe('TIMED_OUT');
  });

  it('a timeout on any leg ends the night', () => {
    const n = nightAtLeg(2);
    for (let i = 0; i < LEGS[2].visitLimit; i++) commitMiss(n);
    expect(n.status).toBe('LOST');
    expect(n.legs).toHaveLength(1);
  });

  it('the last visit still gets to finish the leg', () => {
    const n = nightAtLeg(7);
    for (let i = 0; i < LEGS[7].visitLimit - 1; i++) commitMiss(n);
    expect(n.status).toBe('ACTIVE');
    setScore(n, 40);
    throwAt(n, 'D20');
    expect(currentLeg(n).status).toBe('CHECKED_OUT');
    expect(n.status).toBe('WON');
  });
});

// ---------------------------------------------------------------- checkout and the Pot

describe('checkout (TDD §9.2) and the Pot (TDD §4)', () => {
  it('D20 from 40 on visit 1 of leg 1: checked out, paid, and the shop opens', () => {
    const n = startNight(11);
    setScore(n, 40);
    const { result, events } = throwAt(n, 'D20');
    expect(result.outcome).toBe('CHECKOUT');
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'CHECKOUT', 'SHOP_OPEN']);
    const leg = currentLeg(n);
    expect(leg.status).toBe('CHECKED_OUT');
    expect(leg.score).toBe(0);
    expect(n.stats.legsWon).toBe(1);
    expect(n.phase).toBe('SHOP');
    expect(n.shop).not.toBeNull();
    const reward = ev(events, 'CHECKOUT').reward as PotBreakdown;
    expect(reward).toMatchObject({ base: LEGS[0].reward, cleanLeg: 3, nineDarter: 0, heat: 1, streak: 1, visitsUsed: 1 });
    expect(reward.total).toBe(firstVisitPot(0));
    expect(n.pot).toBe(STARTING_POT + firstVisitPot(0));
    expectAddsUp(reward);
  });

  it('a big finish adds to the ladder: 2 from a ton, 4 from 130, 8 from the big fish', () => {
    expect(bigFinishBonus(99)).toBe(0);
    expect(bigFinishBonus(100)).toBe(2);
    expect(bigFinishBonus(130)).toBe(4);
    expect(bigFinishBonus(170)).toBe(8);
    const n = nightAtLeg(2);
    setScore(n, 100);
    throwAll(n, ['T20', 'D20']);
    const reward = currentLeg(n).reward as PotBreakdown;
    expect(reward.checkoutFrom).toBe(100);
    expect(reward.bigFinish).toBe(2);
    expect(n.stats.bigFinishes).toBe(1);
    expectAddsUp(reward);
  });

  it('checkoutFrom is the score at the start of the finishing visit, not the last dart', () => {
    const n = nightAtLeg(2);
    setScore(n, 140);
    throwAll(n, ['T20', 'T20', 'D10']);
    const reward = currentLeg(n).reward as PotBreakdown;
    expect(reward.checkoutFrom).toBe(140);
    expect(reward.bigFinish).toBe(4);
    expect(n.stats.bestCheckout).toBe(140);
  });

  it('a bust anywhere in the leg forfeits the clean-leg bonus', () => {
    const n = startNight(1);
    setScore(n, 10);
    throwAt(n, 'T20'); // bust
    setScore(n, 40);
    throwAt(n, 'D20');
    const reward = currentLeg(n).reward as PotBreakdown;
    expect(reward.cleanLeg).toBe(0);
    expect(reward.streak).toBe(0);
    expectAddsUp(reward);
  });

  it('a nine-darter: 501 in three visits pays 5, with two 180s on the way', () => {
    const n = nightAtLeg(2);
    throwAll(n, ['T20', 'T20', 'T20']);
    throwAll(n, ['T20', 'T20', 'T20']);
    const { events } = throwAll(n, ['T20', 'T19', 'D12']);
    const reward = ev(events, 'CHECKOUT').reward as PotBreakdown;
    expect(reward.visitsUsed).toBe(3);
    expect(reward.nineDarter).toBe(5);
    expect(n.stats.oneEighties).toBe(2);
    expect(n.stats.nineDarters).toBe(1);
    expectAddsUp(reward);
  });

  it.each([0, 1, 2, 3, 4, 5, 6])('leg %i pays its own base, and nothing for the visits it did not need', (i) => {
    const n = nightAtLeg(i);
    setScore(n, 40);
    throwAt(n, 'D20');
    const reward = currentLeg(n).reward as PotBreakdown;
    expect(reward.base).toBe(LEGS[i].reward);
    expect(reward.total).toBe(firstVisitPot(i));
    expect(Object.keys(reward)).not.toContain('unusedVisits');
    expectAddsUp(reward);
  });

  it('the bull checks out from 50', () => {
    const n = startNight(1);
    setScore(n, 50);
    expect(throwAt(n, 'BULL').result.outcome).toBe('CHECKOUT');
  });

  it('the Pot accumulates across legs', () => {
    const n = startNight(5);
    setScore(n, 40);
    throwAt(n, 'D20');
    const afterOne = n.pot;
    shopLeave(n);
    setScore(n, 40);
    throwAt(n, 'D20');
    // the second clean leg in a row pays its base twice over
    expect((currentLeg(n).reward as PotBreakdown).total).toBe(firstVisitPot(1) + LEGS[1].reward);
    expect(n.pot).toBe(afterOne + (currentLeg(n).reward as PotBreakdown).total);
    expect(n.legs).toHaveLength(2);
  });

  it('potReward is a pure function of the leg and the streak', () => {
    const n = startNight(1);
    setScore(n, 40);
    throwAt(n, 'D20');
    const leg = currentLeg(n);
    expect(potReward(leg, 1)).toEqual(leg.reward);
    expect(potReward(leg, 2).total).toBeGreaterThan(potReward(leg, 1).total);
    expect(potReward(leg, 3).streakMult).toBe(3);
  });
});

// ---------------------------------------------------------------- the clean sheet

describe('the clean sheet: consecutive legs won without a bust multiply the Pot', () => {
  function winLeg(n: NightState, bustFirst = false): void {
    if (bustFirst) {
      setScore(n, 10);
      throwAt(n, 'T20');
    }
    setScore(n, 40);
    throwAt(n, 'D20');
  }

  it('the second clean leg in a row pays double on the leg and its finish, the third treble', () => {
    const n = startNight(2);
    winLeg(n);
    expect(n.streak).toBe(1);
    shopLeave(n);
    winLeg(n);
    expect(n.streak).toBe(2);
    const second = currentLeg(n).reward as PotBreakdown;
    expect(second.streakMult).toBe(2);
    expect(second.streakBonus).toBe(LEGS[1].reward);
    expectAddsUp(second);
    shopLeave(n);
    winLeg(n);
    const third = currentLeg(n).reward as PotBreakdown;
    expect(third.streakMult).toBe(3);
    expectAddsUp(third);
  });

  it('a bust takes the leg off the sheet and fires STREAK_LOST once', () => {
    const n = startNight(2);
    winLeg(n);
    shopLeave(n);
    setScore(n, 10);
    const { events } = throwAt(n, 'T20');
    expect(eventTypes(events)).toContain('STREAK_LOST');
    expect(ev(events, 'STREAK_LOST').from).toBe(1);
    expect(n.streak).toBe(0);
    setScore(n, 10);
    expect(eventTypes(throwAt(n, 'T20').events)).not.toContain('STREAK_LOST');
  });

  it('walking to the wall keeps the sheet: it costs the crowd instead', () => {
    const n = startNight(2);
    winLeg(n);
    shopLeave(n);
    commitMiss(n);
    winLeg(n);
    expect((currentLeg(n).reward as PotBreakdown).streakMult).toBe(2);
  });

  it('the multiplier table', () => {
    expect([0, 1, 2, 3, 4, 9].map(streakMultiplier)).toEqual([1, 1, 2, 3, 3, 3]);
  });
});

// ---------------------------------------------------------------- the shop

describe('the shop (TDD §4.1)', () => {
  it('SHOP_OPEN offers two kit slots, a chalk and a service, priced from the tables', () => {
    const n = inShop();
    const shop = n.shop as NonNullable<NightState['shop']>;
    expect(shop.slots.map((s) => s.kind)).toEqual(['KIT', 'KIT', 'CHALK', 'SERVICE']);
    expect(shop.refreshed).toBe(false);
    expect(shop.afterLeg).toBe(0);
    for (const slot of shop.slots) {
      if (slot.kind === 'KIT') expect(slot.cost).toBe(kitPrice(n, slot.defId));
      if (slot.kind === 'CHALK') expect(slot.cost).toBe(chalkDef(slot.chalkId).cost);
      if (slot.kind === 'SERVICE') expect(slot.cost).toBe(SERVICE_COST[slot.service]);
      expect(slot.sold).toBe(false);
    }
  });

  it('the service costs are 2 / 3 / 4 and a refresh is 1', () => {
    expect(SERVICE_COST).toEqual({ STEADY: 2, CREDIT: 3, RUB_OUT: 4 });
    expect(SHOP_REFRESH_COST).toBe(1);
  });

  it('the offered chalk is never one already held', () => {
    const n = inShop();
    for (let seed = 1; seed < 40; seed++) {
      n.rng.s = seed;
      addChalk(n, CHALK_DEFS[seed % CHALK_DEFS.length].id);
      const shop = generateShop(n, 0);
      for (const s of shop.slots) if (s.kind === 'CHALK') expect(hasChalk(n, s.chalkId)).toBe(false);
    }
  });

  it('buying kit adds the intervention and deducts the cost', () => {
    const n = inShop();
    setSlot(n, 0, { kind: 'KIT', defId: 'again', cost: 4, sold: false });
    const before = n.pot;
    const out = shopBuy(n, 0);
    expect(out.ok).toBe(true);
    expect(eventTypes(out.events)).toEqual(['SHOP_BUY']);
    expect(kitCount(n, 'again')).toBe(1);
    expect(n.pot).toBe(before - 4);
    expect(n.stats.kitBought).toBe(1);
    expect(n.stats.potSpent).toBe(4);
    expect((n.shop as NonNullable<NightState['shop']>).slots[0].sold).toBe(true);
  });

  it('the kit is capped: buying past KIT_CAP is refused', () => {
    const n = inShop();
    n.kit = new Array(KIT_CAP).fill('steady');
    setSlot(n, 0, { kind: 'KIT', defId: 'again', cost: 4, sold: false });
    const out = shopBuy(n, 0);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/full/);
    expect(n.kit).toHaveLength(KIT_CAP);
  });

  it('cannot buy without enough Pot; nothing moves', () => {
    const n = inShop(11, 1);
    setSlot(n, 0, { kind: 'KIT', defId: 'doubled', cost: 5, sold: false });
    expect(shopBuy(n, 0).ok).toBe(false);
    expect(n.pot).toBe(1);
    expect(kitCount(n, 'doubled')).toBe(0);
  });

  it('a sold slot, a missing slot and buying outside the shop are refused', () => {
    const n = inShop();
    setSlot(n, 0, { kind: 'KIT', defId: 'steady', cost: 3, sold: true });
    expect(shopBuy(n, 0).reason).toBe('already sold');
    expect(shopBuy(n, 99).reason).toBe('no such slot');
    n.phase = 'LEG';
    expect(shopBuy(n, 1).reason).toBe('not in shop');
  });

  it('buying chalk adds it with the next acquisition order; a duplicate is refused', () => {
    const n = inShop();
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'hot_twenty', cost: 6, sold: false });
    expect(shopBuy(n, 2).ok).toBe(true);
    expect(n.chalk.map((c) => c.def.id)).toEqual(['hot_twenty']);
    expect(n.chalk[0].order).toBe(1);
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'hot_twenty', cost: 6, sold: false });
    expect(shopBuy(n, 2).reason).toBe('already held');
  });

  it('chalk slots: a sixth needs a replacement, and the new one is the newest', () => {
    const n = inShop();
    for (const id of ['hot_twenty', 'feathered', 'heavy_tips', 'oiled', 'even_keel']) addChalk(n, id);
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'bullish', cost: 5, sold: false });
    expect(shopBuy(n, 2).reason).toBe('chalk slots full');
    expect(shopBuy(n, 2, { replaceChalkId: 'nope' }).reason).toBe('no such chalk to replace');
    expect(shopBuy(n, 2, { replaceChalkId: 'hot_twenty' }).ok).toBe(true);
    expect(hasChalk(n, 'hot_twenty')).toBe(false);
    expect(n.chalk).toHaveLength(5);
    expect(n.chalk[n.chalk.length - 1].def.id).toBe('bullish');
  });

  it('STEADY refills the kit and stays on the shelf until the kit is full', () => {
    const n = inShop();
    setSlot(n, 3, { kind: 'SERVICE', service: 'STEADY', cost: 2, sold: false });
    const before = kitCount(n, 'steady');
    expect(shopBuy(n, 3).ok).toBe(true);
    expect(kitCount(n, 'steady')).toBe(before + 1);
    expect((n.shop as NonNullable<NightState['shop']>).slots[3].sold).toBe(false);
    while (n.kit.length < KIT_CAP) shopBuy(n, 3);
    expect(n.kit).toHaveLength(KIT_CAP);
    expect((n.shop as NonNullable<NightState['shop']>).slots[3].sold).toBe(true);
  });

  it('CREDIT is the publican’s published policy: a flat advance, taken once', () => {
    const n = inShop(11, 10);
    setSlot(n, 3, { kind: 'SERVICE', service: 'CREDIT', cost: SERVICE_COST.CREDIT, sold: false });
    expect(shopBuy(n, 3).ok).toBe(true);
    expect(n.pot).toBe(10 + SERVICE_COST.CREDIT * 2 - SERVICE_COST.CREDIT);
    expect((n.shop as NonNullable<NightState['shop']>).slots[3].sold).toBe(true);
  });

  it('RUB_OUT wipes the house’s record of your best contract, so the price goes back up', () => {
    const n = inShop();
    setSlot(n, 3, { kind: 'SERVICE', service: 'RUB_OUT', cost: SERVICE_COST.RUB_OUT, sold: false });
    expect(shopBuy(n, 3).reason).toBe('nothing chalked against you yet');
    n.paid = { ton: 3, treble: 1 };
    expect(shopBuy(n, 3).ok).toBe(true);
    expect(n.paid).toEqual({ treble: 1 });
  });

  it('refresh: once per shop, for 1 Pot, regenerating every slot', () => {
    const n = inShop();
    const before = n.shop as NonNullable<NightState['shop']>;
    const pot = n.pot;
    const out = shopRefresh(n);
    expect(out.ok).toBe(true);
    expect(eventTypes(out.events)).toEqual(['SHOP_REFRESH']);
    expect(n.pot).toBe(pot - SHOP_REFRESH_COST);
    expect(n.shop).not.toBe(before);
    expect((n.shop as NonNullable<NightState['shop']>).refreshed).toBe(true);
    expect((n.shop as NonNullable<NightState['shop']>).afterLeg).toBe(0);
    expect(shopRefresh(n).reason).toBe('already refreshed');
  });

  it('refresh needs a shop and the Pot for it', () => {
    const n = inShop(11, 0);
    expect(shopRefresh(n).reason).toBe('not enough pot');
    n.phase = 'LEG';
    expect(shopRefresh(n).reason).toBe('not in shop');
  });

  it('the shop consumes the gameplay RNG in a fixed order: kit, kit, chalk, service', () => {
    const a = inShop();
    a.rng.s = 4242;
    const first = generateShop(a, 0);
    a.rng.s = 4242;
    expect(generateShop(a, 0)).toEqual(first);
    const before = a.rng.s;
    generateShop(a, 0);
    expect(a.rng.s).not.toBe(before);
  });

  it('shopLeave begins the next leg with everything bought still held', () => {
    const n = inShop();
    setSlot(n, 0, { kind: 'KIT', defId: 'insured', cost: 4, sold: false });
    shopBuy(n, 0);
    const events = shopLeave(n);
    expect(eventTypes(events)).toEqual(['LEG_START', 'SLATE_OFFERED']);
    expect(n.legIndex).toBe(1);
    expect(n.phase).toBe('LEG');
    expect(n.shop).toBeNull();
    expect(currentLeg(n).score).toBe(LEGS[1].start);
    expect(kitCount(n, 'insured')).toBe(1);
  });

  it('shopLeave outside the shop throws', () => {
    expect(() => shopLeave(startNight(1))).toThrow();
  });
});

// ---------------------------------------------------------------- the kit at the oche

describe('the kit: interventions spent on a dart already chosen (design.md §5.6)', () => {
  it('spending STEADY on a throw takes it out of the kit and says so', () => {
    const n = startNight(1);
    const { events } = throwAt(n, 'T20', { use: 'steady' });
    expect(eventTypes(events)).toEqual(['THROW', 'KIT_SPENT']);
    expect(ev(events, 'KIT_SPENT').defId).toBe('steady');
    expect(kitCount(n, 'steady')).toBe(0);
  });

  it('DOUBLED doubles what the dart lands on', () => {
    const n = startNight(1);
    n.kit.push('doubled');
    const { result } = throwAt(n, 'T20', { use: 'doubled' });
    expect(result.totalValue).toBe(120);
    expect(result.firedChalk).toContain('doubled');
    expect(kitCount(n, 'doubled')).toBe(0);
  });

  it('INSURED keeps the score through a bust', () => {
    const n = startNight(1);
    n.kit.push('insured');
    setScore(n, 100);
    throwAt(n, 'T20');
    const { result } = throwAt(n, 'T20', { use: 'insured' });
    expect(result.outcome).toBe('BUST');
    expect(currentLeg(n).score).toBe(40);
    expect(result.firedChalk).toContain('insured');
  });

  it('a kit item that is not held is simply not spent', () => {
    const n = startNight(1);
    n.kit = [];
    const { events } = throwAt(n, 'T20', { use: 'steady' });
    expect(eventTypes(events)).toEqual(['THROW']);
  });

  it('a SLATE intervention cannot be spent on a dart', () => {
    const n = startNight(1);
    n.kit.push('rubout');
    const { events } = throwAt(n, 'T20', { use: 'rubout' });
    expect(eventTypes(events)).toEqual(['THROW']);
    expect(kitCount(n, 'rubout')).toBe(1);
    expect(interventionDef('rubout').when).toBe('SLATE');
  });

  it('every intervention is one of the two kinds and carries a price', () => {
    for (const def of INTERVENTIONS) {
      expect(['AIM', 'SLATE']).toContain(def.when);
      expect(def.cost).toBeGreaterThan(0);
      expect(def.name.length).toBeLessThanOrEqual(9);
      expect(def.blurb.length).toBeLessThanOrEqual(46);
    }
  });
});

// ---------------------------------------------------------------- night end

describe('night end (TDD §9.3)', () => {
  it('the last leg checked out wins the night: no shop, no reward', () => {
    const n = nightAtLeg(LEG_COUNT - 1);
    setScore(n, 40);
    const { events } = throwAt(n, 'D20');
    // one visit on a 501 leg is both The Thin and, with no busts all night, The Steady
    expect(eventTypes(events)).toEqual(['THROW', 'VISIT_END', 'CHECKOUT', 'ACHIEVEMENT', 'ACHIEVEMENT', 'NIGHT_WON']);
    expect(n.achievements).toEqual(['thin', 'steady']);
    expect(ev(events, 'CHECKOUT').reward).toBeNull();
    expect(n.status).toBe('WON');
    expect(n.phase).toBe('OVER');
    expect(n.shop).toBeNull();
    expect(currentLeg(n).reward).toBeUndefined();
  });

  it('the last leg still records the folk stats', () => {
    const n = nightAtLeg(LEG_COUNT - 1);
    setScore(n, 100);
    throwAll(n, ['T20', 'D20']);
    expect(n.stats.bigFinishes).toBe(1);
    expect(n.stats.cleanLegs).toBe(1);
    expect(n.stats.legsWon).toBe(1);
    expect(n.status).toBe('WON');
  });

  it('a full night: seven shops, then the win', () => {
    const n = startNight(9);
    let shops = 0;
    for (let i = 0; i < LEG_COUNT; i++) {
      setScore(n, 40);
      throwAt(n, 'D20');
      if (n.phase === 'SHOP') {
        shops++;
        shopLeave(n);
      }
    }
    expect(shops).toBe(LEG_COUNT - 1);
    expect(n.status).toBe('WON');
    expect(n.legs).toHaveLength(LEG_COUNT);
    expect(n.stats.legsWon).toBe(LEG_COUNT);
  });
});

// ---------------------------------------------------------------- achievements

describe('achievements (TDD §9.4 unlock conditions)', () => {
  it('sharp: a leg won with a checkout from 100 or more', () => {
    const n = nightAtLeg(2);
    setScore(n, 100);
    throwAll(n, ['T20']);
    const { events } = throwAt(n, 'D20');
    expect(eventTypes(events)).toContain('ACHIEVEMENT');
    expect(ev(events, 'ACHIEVEMENT').oche).toBe('sharp');
    expect(n.achievements).toContain('sharp');
  });

  it('sharp is not awarded for a 99 checkout', () => {
    const n = nightAtLeg(2);
    setScore(n, 99);
    throwAll(n, ['T19', 'S2', 'D20']); // 57 + 2 + 40 = 99
    expect(currentLeg(n).status).toBe('CHECKED_OUT');
    expect((currentLeg(n).reward as PotBreakdown).checkoutFrom).toBe(99);
    expect(n.achievements).not.toContain('sharp');
  });

  it('thin: a 501 leg won in six visits or fewer', () => {
    const n = nightAtLeg(2);
    for (let v = 0; v < 5; v++) throwAll(n, ['T20', 'T20', 'T20']);
    setScore(n, 40);
    throwAt(n, 'D20');
    expect(n.achievements).toContain('thin');
  });

  it('thin is not awarded on the seventh visit', () => {
    const n = nightAtLeg(2);
    for (let v = 0; v < 6; v++) commitMiss(n);
    setScore(n, 40);
    throwAt(n, 'D20');
    expect(n.achievements).not.toContain('thin');
  });

  it('wide: the moment the fifth chalk is held, bought in the shop', () => {
    const n = inShop();
    for (const id of ['hot_twenty', 'feathered', 'heavy_tips', 'oiled']) addChalk(n, id);
    expect(n.achievements).not.toContain('wide');
    setSlot(n, 2, { kind: 'CHALK', chalkId: 'bullish', cost: 5, sold: false });
    const out = shopBuy(n, 2);
    expect(eventTypes(out.events)).toContain('ACHIEVEMENT');
    expect(n.achievements).toContain('wide');
  });

  it('steady: a won night with no busts at all; one bust anywhere forfeits it', () => {
    const clean = nightAtLeg(LEG_COUNT - 1);
    setScore(clean, 40);
    throwAt(clean, 'D20');
    expect(clean.achievements).toContain('steady');

    const dirty = nightAtLeg(LEG_COUNT - 1);
    setScore(dirty, 10);
    throwAt(dirty, 'T20'); // bust
    setScore(dirty, 40);
    throwAt(dirty, 'D20');
    expect(dirty.status).toBe('WON');
    expect(dirty.achievements).not.toContain('steady');
  });

  it('each achievement fires once per night', () => {
    const n = startNight(1);
    for (let i = 0; i < 3; i++) {
      setScore(n, 100);
      throwAll(n, ['T20', 'D20']);
      if (n.phase === 'SHOP') shopLeave(n);
    }
    expect(n.achievements.filter((a) => a === 'sharp')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- stats

describe('stats counters and commentary state', () => {
  it('throwsMade, visitsPlayed, busts, bestVisit, chalkFires', () => {
    const n = startNight(1, 'local', ['heavy_tips']);
    throwAll(n, ['T20', 'T20', 'T20']);
    expect(n.stats.throwsMade).toBe(3);
    expect(n.stats.visitsPlayed).toBe(2); // the next visit is already open
    expect(n.stats.bestVisit).toBe(195); // 65 × 3
    expect(n.stats.chalkFires).toBe(3);
    setScore(n, 10);
    throwAt(n, 'T20');
    expect(n.stats.busts).toBe(1);
  });

  it('consecutiveBusts counts busts in a row and resets on a completed visit', () => {
    const n = startNight(1);
    for (let i = 0; i < 3; i++) {
      setScore(n, 10);
      throwAt(n, 'T20');
    }
    expect(n.consecutiveBusts).toBe(3);
    setScore(n, 301);
    throwAll(n, ['S1', 'S1', 'S1']);
    expect(n.consecutiveBusts).toBe(0);
  });

  it('ONE_EIGHTY fires after VISIT_END, counts the 180, and never fires on a busted visit', () => {
    const n = startNight(1);
    const { events } = throwAll(n, ['T20', 'T20', 'T20']);
    expect(eventTypes(events).indexOf('ONE_EIGHTY')).toBeGreaterThan(eventTypes(events).indexOf('VISIT_END'));
    expect(ev(events, 'ONE_EIGHTY').total).toBe(180);
    expect(n.stats.oneEighties).toBe(1);

    const bust = startNight(1);
    setScore(bust, 190);
    throwAll(bust, ['T20', 'T20']);
    const out = throwAt(bust, 'T20'); // 70 − 60 = 10 … no: 190 − 120 = 70, then 10 left
    expect(out.result.outcome).toBe('CONTINUE');
  });

  it('a visit above 180 still counts as a 180', () => {
    const n = startNight(1, 'local', ['hot_twenty']);
    const { events } = throwAll(n, ['T20', 'T20', 'T20']);
    expect(ev(events, 'ONE_EIGHTY').total).toBe(240);
    expect(n.stats.oneEighties).toBe(1);
  });

  it('Pot earned and spent are tracked separately', () => {
    const n = startNight(1);
    setScore(n, 40);
    throwAt(n, 'D20');
    expect(n.stats.potEarned).toBe(firstVisitPot(0));
    expect(n.stats.potSpent).toBe(0);
    setSlot(n, 0, { kind: 'KIT', defId: 'steady', cost: 3, sold: false });
    shopBuy(n, 0);
    expect(n.stats.potSpent).toBe(3);
  });

  it('the slate stats move when a contract is taken', () => {
    const n = startNight(1);
    const before = n.pot;
    const c = take(n, 'ton');
    expect(n.stats.contractsTaken).toBe(1);
    expect(n.stats.potStaked).toBe(c.stake);
    expect(n.pot).toBe(before - c.stake);
  });
});

// ---------------------------------------------------------------- the slate, as the state machine sees it

describe('the slate is part of the visit', () => {
  it('every visit is offered contracts, and the offer is fresh each time', () => {
    const n = startNight(4);
    const first = currentLeg(n).offer.slice();
    expect(first).toHaveLength(SLATE_SIZE);
    const { events } = throwAll(n, ['S1', 'S1', 'S1']);
    expect(eventTypes(events)).toContain('SLATE_OFFERED');
    expect(currentLeg(n).offer).toHaveLength(SLATE_SIZE);
  });

  it('a taken contract comes off the offer and onto the slate', () => {
    const n = startNight(4);
    const id = currentLeg(n).offer[0];
    take(n, id);
    expect(currentLeg(n).offer).not.toContain(id);
    expect(currentLeg(n).slate.map((c) => c.defId)).toEqual([id]);
  });

  it('the slate is emptied at the start of each visit and the ledger keeps the record', () => {
    const n = startNight(4);
    take(n, 'clean_hands');
    throwAll(n, ['S1', 'S1', 'S1']);
    expect(currentLeg(n).slate).toEqual([]);
    expect(currentLeg(n).ledger).toHaveLength(1);
    expect(currentLeg(n).ledger[0].settled).not.toBeNull();
  });

  it('wide_grip chalks one more contract up, tunnel_vision one fewer', () => {
    expect(slateSize(startNight(1))).toBe(SLATE_SIZE);
    expect(slateSize(startNight(1, 'local', ['wide_grip']))).toBe(SLATE_SIZE + 1);
    expect(slateSize(startNight(1, 'local', ['tunnel_vision']))).toBe(SLATE_SIZE - 1);
    expect(slateSize(startNight(1, 'local', ['wide_grip', 'tunnel_vision']))).toBe(SLATE_SIZE);
    expect(currentLeg(startNight(1, 'local', ['wide_grip'])).offer).toHaveLength(SLATE_SIZE + 1);
  });

  it('chalked_up shows the next visit’s contracts early, and they are the ones that turn up', () => {
    const n = startNight(6, 'local', ['chalked_up']);
    const peek = currentLeg(n).nextOffer.slice();
    expect(peek).toHaveLength(SLATE_SIZE);
    throwAll(n, ['S1', 'S1', 'S1']);
    expect(currentLeg(n).offer).toEqual(peek);
  });

  it('without chalked_up nothing is shown early', () => {
    expect(currentLeg(startNight(6)).nextOffer).toEqual([]);
  });

  it('every offered contract is a real one that can still be offered', () => {
    const n = startNight(8);
    for (let i = 0; i < 30; i++) {
      for (const id of currentLeg(n).offer) {
        const def = CONTRACTS.find((c) => c.id === id);
        expect(def, id).toBeTruthy();
        expect(def!.weight).toBeGreaterThan(0);
      }
      throwAll(n, ['S1', 'S1', 'S1']);
      if (n.phase !== 'LEG') break;
    }
  });
});
