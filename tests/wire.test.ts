/**
 * THE WIRE — money already won, put back up.
 *
 * The fourth playtest said "the gambling nature now feels entirely gone", and
 * the reason was structural: every staking decision in a visit was made in one
 * instant before any dart was thrown, and after that the money arrived and left
 * on its own. The wire is the answer that costs nothing to anybody who does not
 * want it. A contract that lands still pays into the Pot at once, safely. What
 * the wire adds is a verb on that safe money: put it back up, and it doubles
 * for every visit it survives.
 *
 * Everything below is the price of that doubling, because a carry that is free
 * is the trap measurement already found once (DECISIONS #72): the old one paid
 * interest for SURVIVING. This one pays for being FED — something has to land
 * every visit — and a bust, a dart off the board or a barren visit takes the
 * lot.
 */
import { describe, expect, it } from 'vitest';
import { WIRE_MULT, WIRE_RUNS, wireMultiplier } from '../src/content/legs.ts';
import {
  currentLeg,
  currentVisit,
  deserialiseNight,
  rideContract,
  rideable,
  serialiseNight,
  takeWireDown,
  wireNext,
  wireWorth,
} from '../src/core/state.ts';
import type { NightState } from '../src/core/types.ts';
import { ev, eventTypes, setScore, startNight, take, throwAll, throwAt, wallRng } from './helpers.ts';

/** A night with Pot to spare, so nothing is refused for want of money. */
function rich(seed = 1, chalk: string[] = []): NightState {
  const n = startNight(seed, 'local', chalk);
  n.pot = 60;
  return n;
}

/** Take A TREBLE, land it, and put the winnings up. Returns what went on the wire. */
function open(n: NightState): number {
  const c = take(n, 'treble');
  throwAt(n, 'T20');
  const i = currentLeg(n).slate.findIndex((x) => x.defId === 'treble');
  expect(rideContract(n, i).ok, 'a contract that paid should be rideable').toBe(true);
  return c.stake + c.price;
}

/** See the visit out with cheap darts. */
function seeOut(n: NightState): void {
  const per = 3;
  while (currentLeg(n).status === 'ACTIVE' && currentVisit(currentLeg(n)).throws.length > 0 && currentVisit(currentLeg(n)).throws.length < per) {
    throwAt(n, 'S1');
  }
}

describe('the ladder', () => {
  it('doubles, and stops', () => {
    expect([...WIRE_MULT]).toEqual([1, 2, 4, 8, 16]);
    expect(WIRE_RUNS).toBe(4);
    for (let i = 0; i <= WIRE_RUNS; i++) expect(wireMultiplier(i)).toBe(WIRE_MULT[i]);
    // and it clamps rather than reading off the end
    expect(wireMultiplier(-3)).toBe(1);
    expect(wireMultiplier(99)).toBe(WIRE_MULT[WIRE_RUNS]);
  });

  it('doubling is the only ladder that makes carrying a real choice', () => {
    // A carry gets through a visit a little better than half the time. At two
    // times a rung that is about even money, which is what a choice is. A
    // counting ladder (1, 2, 3, 4) would make the first rung break even and
    // every rung after it bad, so nothing would ever be carried twice.
    for (let i = 1; i <= WIRE_RUNS; i++) expect(WIRE_MULT[i] / WIRE_MULT[i - 1]).toBe(2);
  });
});

describe('putting winnings up', () => {
  it('takes the payout back out of the Pot and on to the wire', () => {
    const n = rich();
    const pot = n.pot;
    const up = open(n);
    const leg = currentLeg(n);
    // The stake left the Pot when the contract was taken; the payout went in
    // when it landed; putting it up takes exactly that payout out again.
    expect(leg.wire.amount).toBe(up);
    expect(n.pot).toBe(pot - 2);
    expect(wireWorth(leg)).toBe(up);
    expect(wireNext(leg)).toBe(up * 2);
  });

  it('is offered only on a contract that has paid, and only once', () => {
    const n = rich();
    const leg = currentLeg(n);
    take(n, 'treble');
    // Not while it is still going.
    expect(rideable(n, leg, leg.slate[0])).toBe(false);
    throwAt(n, 'T20');
    expect(rideable(n, leg, leg.slate[0])).toBe(true);
    expect(rideContract(n, 0).ok).toBe(true);
    // The money has gone up; there is none left on that card to put up again.
    expect(rideable(n, leg, leg.slate[0])).toBe(false);
    expect(rideContract(n, 0).ok).toBe(false);
  });

  it('a contract that lost pays nothing, so there is nothing to put up', () => {
    const n = rich();
    const leg = currentLeg(n);
    take(n, 'quiet_one');
    throwAt(n, 'T20'); // sixty: THE QUIET wanted under twenty-five
    throwAll(n, ['S1', 'S1']);
    for (const c of leg.slate) expect(rideable(n, leg, c)).toBe(false);
  });

  it('more than one payout can go up on the same wire', () => {
    const n = rich();
    const first = open(n);
    // A TON is still open after one treble, and two more make it.
    take(n, 'ton');
    throwAt(n, 'T20');
    const leg = currentLeg(n);
    const ton = leg.slate.findIndex((c) => c.defId === 'ton');
    expect(leg.slate[ton].settled?.how).toBe('PAID');
    expect(rideContract(n, ton).ok).toBe(true);
    expect(leg.wire.amount).toBeGreaterThan(first);
    expect(wireWorth(leg)).toBe(leg.wire.amount);
  });
});

describe('taking it down', () => {
  it('pays what is on it times what it has survived, and empties it', () => {
    const n = rich();
    const up = open(n);
    const pot = n.pot;
    const out = takeWireDown(n);
    expect(out.ok).toBe(true);
    const e = ev(out.events, 'WIRE_DOWN');
    expect(e).toMatchObject({ amount: up, run: 0, paid: up, reason: 'PLAYER' });
    expect(n.pot).toBe(pot + up);
    expect(currentLeg(n).wire).toEqual({ amount: 0, run: 0, fed: false, since: 0 });
    expect(n.stats.wiresTaken).toBe(1);
  });

  it('an empty wire is not a thing that can be taken down', () => {
    const n = rich();
    const out = takeWireDown(n);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('nothing on the wire');
    expect(out.events).toEqual([]);
  });

  it('winning the leg brings it down rather than losing it', () => {
    const n = rich();
    const up = open(n);
    const pot = n.pot;
    setScore(n, 40);
    const { events } = throwAt(n, 'D20');
    expect(eventTypes(events)).toContain('WIRE_DOWN');
    expect(ev(events, 'WIRE_DOWN').reason).toBe('LEG');
    expect(n.pot).toBeGreaterThanOrEqual(pot + up);
  });
});

describe('the carry, and what it costs', () => {
  it('the visit it goes up on is free: it cannot go barren the day it opens', () => {
    const n = rich();
    open(n);
    seeOut(n);
    const leg = currentLeg(n);
    expect(leg.wire.amount).toBeGreaterThan(0);
    expect(leg.wire.run).toBe(0);
  });

  it('a visit where something lands carries it, and it doubles', () => {
    const n = rich();
    const up = open(n);
    seeOut(n);
    // Next visit: land a contract, which feeds it.
    take(n, 'treble');
    const { events } = throwAt(n, 'T20');
    expect(eventTypes(events)).toContain('WIRE_FED');
    throwAll(n, ['S1', 'S1']);
    const leg = currentLeg(n);
    expect(leg.wire.run).toBe(1);
    expect(wireWorth(leg)).toBe(up * 2);
  });

  it('a visit where nothing lands takes the lot', () => {
    const n = rich();
    const up = open(n);
    seeOut(n);
    const pot = n.pot;
    // A whole visit with nothing taken and nothing landed.
    const { events } = throwAll(n, ['S1', 'S1', 'S1']);
    expect(eventTypes(events)).toContain('WIRE_LOST');
    expect(ev(events, 'WIRE_LOST')).toMatchObject({ amount: up, reason: 'BARREN' });
    expect(currentLeg(n).wire.amount).toBe(0);
    expect(n.pot).toBe(pot);
    expect(n.stats.wiresLost).toBe(1);
  });

  it('a bust takes it, and does not also report it barren', () => {
    const n = rich();
    open(n);
    setScore(n, 10);
    const { events } = throwAt(n, 'T20');
    const lost = events.filter((e) => e.type === 'WIRE_LOST');
    expect(lost).toHaveLength(1);
    expect((lost[0] as { reason: string }).reason).toBe('BUST');
    expect(currentLeg(n).wire.amount).toBe(0);
  });

  it('a dart off the board takes it, with the slate', () => {
    const n = rich();
    open(n);
    take(n, 'clean_hands');
    n.trueAim = false;
    n.rng = wallRng('D20');
    const { events } = throwAt(n, 'D20');
    const lost = events.filter((e) => e.type === 'WIRE_LOST');
    expect(lost).toHaveLength(1);
    expect((lost[0] as { reason: string }).reason).toBe('WALL');
    expect(currentLeg(n).wire.amount).toBe(0);
  });

  it('the top of the ladder comes down on its own rather than sitting there', () => {
    const n = rich();
    const leg = currentLeg(n);
    const up = open(n);
    seeOut(n);
    // Wind it to the top rung by hand, then feed one more visit: there is no
    // rung above the last one, so it pays out instead of sitting at a
    // multiplier that can no longer grow.
    leg.wire.run = WIRE_RUNS;
    const pot = n.pot;
    take(n, 'treble');
    throwAt(n, 'T20');
    const { events } = throwAll(n, ['S1', 'S1']);
    expect(eventTypes(events)).toContain('WIRE_DOWN');
    expect(ev(events, 'WIRE_DOWN').reason).toBe('FULL');
    expect(currentLeg(n).wire.amount).toBe(0);
    expect(n.pot).toBeGreaterThan(pot + up);
  });
});

describe('the wire and the save file', () => {
  it('round-trips through a save', () => {
    const n = rich();
    open(n);
    const back = deserialiseNight(serialiseNight(n));
    expect(back.legs[0].wire).toEqual(n.legs[0].wire);
    expect(serialiseNight(back)).toBe(serialiseNight(n));
  });

  it('a night saved before the wire existed loads with an empty one', () => {
    const n = rich();
    const raw = JSON.parse(serialiseNight(n)) as { legs: Record<string, unknown>[]; stats: Record<string, unknown> };
    for (const leg of raw.legs) delete leg.wire;
    delete raw.stats.bestWire;
    delete raw.stats.wiresTaken;
    delete raw.stats.wiresLost;
    const back = deserialiseNight(JSON.stringify(raw));
    expect(back.legs[0].wire).toEqual({ amount: 0, run: 0, fed: false, since: 0 });
    expect(back.stats.bestWire).toBe(0);
    expect(takeWireDown(back).ok).toBe(false);
  });
});
