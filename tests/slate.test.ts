/**
 * THE SLATE — docs/decisions/design.md §5.4.
 *
 * The deck of dealt targets decided where the player was allowed to aim, which
 * is the one decision darts has. The slate decides what a visit is *worth*
 * instead, which is what every pub darts variant in existence actually
 * modifies. This file pins the contract:
 *
 *   - every contract reaches MADE on a visit that satisfies it and DEAD on one
 *     that cannot, so the slate is always telling the truth;
 *   - nothing is ever chalked up that the position has already killed — the
 *     "no dead cards" guarantee that the whole rebuild exists to deliver;
 *   - a bust takes everything still riding and nothing that was banked, which
 *     is the entire reason to bank;
 *   - press, pull and the price decay pay exactly what they print.
 */
import { describe, expect, it } from 'vitest';
import { PULL_PER_DART, SLATE_SIZE, STARTING_POT } from '../src/content/legs.ts';
import { CONTRACTS, CONTRACT_BY_ID, PRICE_FLOOR, contractDef, pressStake, priceOf, pullValue, settleValue } from '../src/core/slate.ts';
import {
  addChalk,
  bankContract,
  commitMiss,
  currentLeg,
  currentPrice,
  currentVisit,
  interestOn,
  pressContract,
  pullContract,
  takeContract,
  useRubOut,
  visitProgress,
} from '../src/core/state.ts';
import type { NightState, TakenContract } from '../src/core/types.ts';
import { bank, checkVisit, ev, eventTypes, press, pull, setScore, slateOf, startNight, statusOf, take, throwAll, throwAt, wallRng } from './helpers.ts';

/** The visit that makes each contract, and one the contract cannot survive. */
const TABLE: Record<string, { made: (string | null)[]; dead: (string | null)[]; from?: number; checkedOut?: boolean }> = {
  ton: { made: ['T20', 'T20'], dead: ['S1', 'S1'] },
  fish: { made: ['T20', 'T20', 'T20'], dead: ['S1', 'S1'] },
  maximum: { made: ['T20', 'T20', 'T20'], dead: ['S1'] },
  treble: { made: ['T5'], dead: ['S1', 'S1', 'S1'] },
  two_trebles: { made: ['T5', 'T5'], dead: ['S1', 'S1'] },
  three_trebles: { made: ['T5', 'T5', 'T5'], dead: ['S1'] },
  bull: { made: ['BULL'], dead: ['S1', 'S1', 'S1'] },
  in_a_bed: { made: ['S5', 'D5', 'T5'], dead: ['S5', 'S6'] },
  shanghai: { made: ['S5', 'D5', 'T5'], dead: ['S5', 'S6'] },
  nothing_cheap: { made: ['S15', 'S15', 'S15'], dead: ['S1'] },
  nothing_cheaper: { made: ['S20', 'S20', 'S20'], dead: ['S15'] },
  quiet_one: { made: ['S1', 'S1', 'S1'], dead: ['T20'] },
  clean_hands: { made: ['S1', 'S1', 'S1'], dead: [null] },
  plain_numbers: { made: ['S1', 'S2', 'S3'], dead: ['T20'] },
  cheap_seats: { made: ['S1', 'S2', 'S3'], dead: ['S20'] },
  two_doubles: { made: ['D1', 'D2'], dead: ['S1', 'S1'] },
  game_shot: { made: ['D20'], dead: ['S1', 'S1', 'S1'], from: 40, checkedOut: true },
  left_pretty: { made: ['T20', 'S5', 'S3'], dead: ['S1', 'S1', 'S1'], from: 100 },
  ladder_up: { made: ['S1', 'S2', 'S3'], dead: ['S3', 'S2'] },
  ladder_down: { made: ['S3', 'S2', 'S1'], dead: ['S1', 'S2'] },
  odd_job: { made: ['S1', 'S3', 'S5'], dead: ['S2'] },
  three_ways: { made: ['S1', 'D1', 'T1'], dead: ['S1', 'S1'] },
};

/** A night with a full purse, so the tests are never refused for want of Pot. */
function rich(seed = 1, chalk: string[] = []): NightState {
  const n = startNight(seed, 'local', chalk);
  n.pot = 100;
  return n;
}

// ---------------------------------------------------------------- the pool

describe('the contract pool', () => {
  it('every contract is named, priced and readable on the strip', () => {
    for (const c of CONTRACTS) {
      expect(c.name.length, c.id).toBeLessThanOrEqual(13);
      expect(c.blurb.length, c.id).toBeLessThanOrEqual(30);
      expect(c.stake, c.id).toBeGreaterThan(0);
      expect(c.price, c.id).toBeGreaterThanOrEqual(PRICE_FLOOR);
      expect(c.weight, c.id).toBeGreaterThanOrEqual(0);
      expect(['SCORE', 'PRECISION', 'RESTRAINT', 'FINISH', 'SHAPE']).toContain(c.pull);
      expect(CONTRACT_BY_ID[c.id]).toBe(c);
    }
    expect(new Set(CONTRACTS.map((c) => c.id)).size).toBe(CONTRACTS.length);
    expect(() => contractDef('no_such_contract')).toThrow();
  });

  it('a press always leads somewhere harder: double the stake, a longer price', () => {
    for (const c of CONTRACTS) {
      if (!c.pressTo) continue;
      const harder = contractDef(c.pressTo);
      expect(harder.price, `${c.id} → ${harder.id}`).toBeGreaterThan(c.price);
      expect(harder.stake, `${c.id} → ${harder.id}`).toBe(pressStake(c.stake));
    }
  });

  it('a contract that is never printed cold can still be reached by pressing', () => {
    for (const c of CONTRACTS) {
      if (c.weight > 0) continue;
      expect(CONTRACTS.some((x) => x.pressTo === c.id), `${c.id} is unreachable`).toBe(true);
    }
  });

  it('the pool pulls in every direction, so a visit has a plan to make', () => {
    const pulls = new Set(CONTRACTS.filter((c) => c.weight > 0).map((c) => c.pull));
    expect(pulls.size).toBe(5);
  });
});

// ---------------------------------------------------------------- MADE and DEAD

describe('every contract reads its own visit correctly', () => {
  it('the table covers every contract in the pool', () => {
    expect(Object.keys(TABLE).sort()).toEqual(CONTRACTS.map((c) => c.id).sort());
  });

  it.each(CONTRACTS.map((c) => [c.id] as const))('%s is MADE by the visit that satisfies it', (id) => {
    const row = TABLE[id];
    expect(checkVisit(id, row.made, { from: row.from, checkedOut: row.checkedOut })).toBe('MADE');
  });

  it.each(CONTRACTS.map((c) => [c.id] as const))('%s is DEAD on a visit that cannot get there', (id) => {
    const row = TABLE[id];
    expect(checkVisit(id, row.dead, { from: row.from })).toBe('DEAD');
  });

  it('a contract is LIVE while the visit could still go either way', () => {
    expect(checkVisit('ton', ['T20'])).toBe('LIVE');
    expect(checkVisit('treble', ['S1'])).toBe('LIVE');
    expect(checkVisit('in_a_bed', ['S5', 'T5'])).toBe('LIVE');
    expect(checkVisit('nothing_cheap', ['T20', 'T20'])).toBe('LIVE');
    expect(checkVisit('three_ways', ['S1', 'D1'])).toBe('LIVE');
  });

  it('once MADE it stays MADE for the rest of the visit', () => {
    expect(checkVisit('treble', ['T5', 'S1', 'S1'])).toBe('MADE');
    expect(checkVisit('ton', ['T20', 'T20', 'S1'])).toBe('MADE');
    expect(checkVisit('bull', ['BULL', null, 'S1'])).toBe('MADE');
  });

  it('a dart in the wall is a nothing on the slate, not a zero-scoring hit', () => {
    expect(checkVisit('clean_hands', ['S1', null])).toBe('DEAD');
    expect(checkVisit('nothing_cheap', ['S20', null])).toBe('DEAD');
    expect(checkVisit('in_a_bed', ['S5', null, 'S5'])).toBe('DEAD');
    expect(checkVisit('odd_job', ['S2', 'S1'])).toBe('DEAD');
  });

  /**
   * The one that matters. A contract the visit has already killed must stay
   * killed: if it comes back to life on the last dart, the slate paid out on a
   * visit that never satisfied it, which is a loss dressed as a win
   * (design.md §6) and free money for anyone who notices.
   */
  it('a contract that has gone DEAD stays dead to the end of the visit', () => {
    const risen: string[] = [];
    for (const c of CONTRACTS) {
      const row = TABLE[c.id];
      const padded = [...row.dead];
      while (padded.length < 3) padded.push('S1');
      const early = checkVisit(c.id, row.dead, { from: row.from });
      const late = checkVisit(c.id, padded, { from: row.from });
      if (early === 'DEAD' && late !== 'DEAD') risen.push(`${c.id}: ${early} after ${row.dead.length} darts, ${late} after three`);
    }
    expect(risen).toEqual([]);
  });

  it('and the engine pays that reading, not a kinder one', () => {
    const n = rich();
    const c = take(n, 'nothing_cheap');
    const pot = n.pot;
    throwAll(n, ['S1', 'S1', 'S1']); // three darts, none of them fifteen
    expect(currentLeg(n).ledger[0].settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(pot);
    expect(c.stake).toBeGreaterThan(0);
  });

  it('the engine wires the same reading onto the slate as each dart lands', () => {
    const n = rich();
    take(n, 'treble');
    take(n, 'ton');
    expect(statusOf(n, 'treble')).toBe('LIVE');
    throwAt(n, 'T20');
    expect(statusOf(n, 'treble')).toBe('MADE');
    expect(statusOf(n, 'ton')).toBe('LIVE');
    throwAt(n, 'T20');
    expect(statusOf(n, 'ton')).toBe('MADE');
  });

  it('a contract taken mid-air is refused: the slate is set before the first dart', () => {
    const n = rich();
    throwAt(n, 'S1');
    currentLeg(n).offer.push('treble');
    expect(takeContract(n, 'treble').reason).toBe('the visit has started');
    expect(useRubOut(n).reason).toBe('the visit has started');
  });
});

// ---------------------------------------------------------------- no dead cards

describe('the no-dead-cards guarantee (design.md §5.4)', () => {
  it('nothing on the offer is already DEAD, over a long night of offers', () => {
    let offers = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const n = startNight(seed, 'local', [], false);
      for (let visit = 0; visit < 12 && n.phase === 'LEG'; visit++) {
        const leg = currentLeg(n);
        const progress = visitProgress(n, leg);
        for (const id of leg.offer) {
          offers++;
          expect(contractDef(id).check(progress), `${id} offered at ${leg.score}`).not.toBe('DEAD');
        }
        commitMiss(n);
      }
    }
    expect(offers).toBeGreaterThan(500);
  });

  it('an offer is never made of pressed tiers, which are never printed cold', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const n = startNight(seed, 'local', [], false);
      for (const id of currentLeg(n).offer) expect(contractDef(id).weight).toBeGreaterThan(0);
    }
  });

  it('a contract no three darts could reach is never chalked up either', () => {
    // GAME SHOT at 501 and LEFT PRETTY at 501 are dead the moment they are
    // printed: three darts cannot take 501 out, and cannot leave 40 or less
    // either. The engine says so itself in rollOffer — "a dead contract on the
    // slate is exactly the dead card the deck used to deal".
    const impossible: string[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const n = startNight(seed, 'local', [], false);
      const leg = currentLeg(n);
      const darts = 3;
      for (const id of leg.offer) {
        if (id === 'game_shot' && leg.score > 60 * darts) impossible.push(`GAME SHOT at ${leg.score} (seed ${seed})`);
        if (id === 'left_pretty' && leg.score > 40 + 60 * darts) impossible.push(`LEFT PRETTY at ${leg.score} (seed ${seed})`);
      }
    }
    expect(impossible.slice(0, 3)).toEqual([]);
  });

  it('the offer is the printed size and holds no duplicates', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const offer = currentLeg(startNight(seed)).offer;
      expect(offer).toHaveLength(SLATE_SIZE);
      expect(new Set(offer).size).toBe(offer.length);
    }
  });

  it('RUB OUT wipes the slate and chalks a fresh one, for one intervention', () => {
    const n = startNight(3);
    n.kit.push('rubout');
    const before = currentLeg(n).offer.slice();
    const out = useRubOut(n);
    expect(out.ok).toBe(true);
    expect(eventTypes(out.events)).toEqual(['KIT_SPENT', 'SLATE_OFFERED']);
    expect(n.kit).not.toContain('rubout');
    expect(currentLeg(n).offer).toHaveLength(before.length);
    expect(useRubOut(n).reason).toBe('no rub out in the kit');
  });
});

// ---------------------------------------------------------------- taking

describe('taking a contract', () => {
  it('stakes the Pot, prints the price and puts it on the slate', () => {
    const n = startNight(1);
    const leg = currentLeg(n);
    const def = contractDef('bull');
    leg.offer = ['bull'];
    const out = takeContract(n, 'bull');
    expect(out.ok).toBe(true);
    const c = ev(out.events, 'CONTRACT_TAKEN').contract;
    expect(c).toMatchObject({ defId: 'bull', stake: def.stake, price: def.price, takenAt: 0, madeAt: null, pressed: 0, status: 'LIVE', settled: null });
    expect(n.pot).toBe(STARTING_POT - def.stake);
    expect(leg.offer).toEqual([]);
    expect(leg.slate).toEqual([c]);
  });

  it('refuses what is not on the slate, what cannot be afforded, and a leg that is over', () => {
    const n = startNight(1);
    expect(takeContract(n, 'maximum').reason).toBe('not on the slate');
    currentLeg(n).offer = ['maximum'];
    n.pot = 1;
    expect(takeContract(n, 'maximum').reason).toBe('not enough pot');
    n.pot = 50;
    currentLeg(n).status = 'CHECKED_OUT';
    expect(takeContract(n, 'maximum').reason).toBe('leg is over');
    currentLeg(n).status = 'ACTIVE';
    n.phase = 'SHOP';
    expect(takeContract(n, 'maximum').reason).toBe('not in a leg');
  });

  it('more than one contract can ride at once, and they settle independently', () => {
    const n = rich();
    take(n, 'treble');
    take(n, 'quiet_one');
    throwAt(n, 'T20');
    expect(statusOf(n, 'treble')).toBe('MADE');
    expect(statusOf(n, 'quiet_one')).toBe('DEAD');
    const { events } = throwAll(n, ['S1', 'S1']);
    const settled = events.filter((e) => e.type === 'CONTRACT_SETTLED');
    expect(settled).toHaveLength(2);
    expect(slateOf(n)).toEqual([]);
    const ledger = currentLeg(n).ledger;
    expect(ledger.map((c) => c.settled?.how).sort()).toEqual(['LOST', 'PAID']);
  });

  it('the price is locked in when it is taken, whatever happens to the printed one later', () => {
    const n = rich();
    const c = take(n, 'bull');
    expect(c.price).toBe(currentPrice(n, 'bull'));
    n.paid.bull = 5;
    expect(currentPrice(n, 'bull')).toBeLessThan(c.price);
    expect(c.price).toBe(contractDef('bull').price);
  });
});

// ---------------------------------------------------------------- settling at the end of the visit

describe('what the end of a visit does to the slate', () => {
  it('a contract that landed pays its stake, its price and the carry it earned', () => {
    const n = rich();
    const c = take(n, 'treble');
    const pot = n.pot;
    const { events } = throwAll(n, ['T20', 'S1', 'S1']);
    const settled = ev(events, 'CONTRACT_SETTLED').contract;
    // it landed on the first dart and sat through two more
    const carry = 2 * PULL_PER_DART;
    expect(settled.settled).toEqual({ pot: settleValue(c.stake, c.price, carry), how: 'PAID' });
    expect(n.pot).toBe(pot + c.stake + c.price + carry);
    expect(n.stats.contractsPaid).toBe(1);
    expect(n.paid.treble).toBe(1);
  });

  it('a contract that did not land pays nothing, and is reported as the loss it is', () => {
    const n = rich();
    take(n, 'treble');
    const pot = n.pot;
    const { events } = throwAll(n, ['S1', 'S1', 'S1']);
    const settled = ev(events, 'CONTRACT_SETTLED').contract;
    expect(settled.settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(pot);
    expect(n.stats.contractsPaid).toBe(0);
    expect(n.paid.treble).toBeUndefined();
  });

  it('a visit walked away from at the wall settles the slate too', () => {
    const n = rich();
    take(n, 'treble');
    throwAt(n, 'T20');
    const { events } = commitMiss(n);
    expect(ev(events, 'CONTRACT_SETTLED').contract.settled?.how).toBe('PAID');
  });

  it('the checkout settles the slate before the leg closes', () => {
    const n = rich();
    setScore(n, 40);
    take(n, 'game_shot');
    const { events } = throwAt(n, 'D20');
    const types = eventTypes(events);
    expect(types.indexOf('CONTRACT_SETTLED')).toBeLessThan(types.indexOf('CHECKOUT'));
    expect(ev(events, 'CONTRACT_SETTLED').contract.settled?.how).toBe('PAID');
  });
});

// ---------------------------------------------------------------- the wall

/**
 * A dart that finishes in the wall rubs the dearest contract off the slate.
 * This is what gives banking a job: with free aim a player can dodge every
 * bust by aiming at a safe single, so without it the money on the table was
 * never really at risk and greed was free (state.ts, `wallRubsOne`).
 */
describe('a dart in the wall takes a contract with it', () => {
  /** A night that will drift its next dart at `t` into the wall. */
  function drifting(t: string, chalk: string[] = []): NightState {
    const n = rich(1, chalk);
    n.trueAim = false;
    n.rng = wallRng(t);
    return n;
  }

  it('the dart lands in the wall, scores nothing, and the visit goes on', () => {
    const n = drifting('D20');
    const { result } = throwAt(n, 'D20');
    expect(result.aim).toBe('wall');
    expect(result.miss).toBe(false);
    expect(result.totalValue).toBe(0);
    expect(currentVisit(currentLeg(n)).throws).toHaveLength(1);
  });

  it('it rubs off the dearest contract riding, and leaves the rest', () => {
    const n = drifting('D20');
    take(n, 'bull'); // the bigger stake
    take(n, 'ton');
    const pot = n.pot;
    const { events } = throwAt(n, 'D20');
    const settled = ev(events, 'CONTRACT_SETTLED').contract;
    expect(settled.defId).toBe('bull');
    expect(settled.settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(pot);
    expect(statusOf(n, 'ton')).not.toBe('DEAD');
    expect(slateOf(n).filter((c) => !c.settled)).toHaveLength(1);
  });

  it('a contract that has landed is the dearest thing on the slate, so it goes first', () => {
    const n = rich();
    n.trueAim = true;
    take(n, 'treble');
    take(n, 'ton');
    throwAt(n, 'T20');
    expect(statusOf(n, 'treble')).toBe('MADE');
    n.trueAim = false;
    n.rng = wallRng('D20');
    const { events } = throwAt(n, 'D20');
    expect(ev(events, 'CONTRACT_SETTLED').contract.defId).toBe('treble');
    expect(statusOf(n, 'ton')).not.toBe('DEAD');
  });

  it('banking first is how you keep it: a banked contract is not on the slate to be rubbed off', () => {
    const n = rich();
    n.trueAim = true;
    const c = take(n, 'treble');
    throwAt(n, 'T20');
    bank(n, 'treble');
    const pot = n.pot;
    n.trueAim = false;
    n.rng = wallRng('D20');
    throwAt(n, 'D20');
    expect(currentLeg(n).ledger[0].settled).toEqual({ pot: c.stake + c.price, how: 'BANKED' });
    expect(n.pot).toBe(pot);
  });

  it('with nothing riding, a dart in the wall costs only the dart', () => {
    const n = drifting('D20');
    const pot = n.pot;
    const { events } = throwAt(n, 'D20');
    expect(events.filter((e) => e.type === 'CONTRACT_SETTLED')).toEqual([]);
    expect(n.pot).toBe(pot);
  });

  it('a contract the same dart just killed is not what gets rubbed off', () => {
    const n = drifting('D20');
    take(n, 'cheap_seats'); // a dart in the wall kills this one outright
    take(n, 'ton');
    const { events } = throwAt(n, 'D20');
    expect(statusOf(n, 'cheap_seats')).toBe('DEAD');
    expect(ev(events, 'CONTRACT_SETTLED').contract.defId).toBe('ton');
  });

  it('walking to the wall on purpose settles the slate instead: what landed still pays', () => {
    const n = rich();
    const c = take(n, 'treble');
    const pot = n.pot;
    throwAt(n, 'T20');
    const { events } = commitMiss(n);
    const settled = ev(events, 'CONTRACT_SETTLED').contract;
    expect(settled.settled?.how).toBe('PAID');
    expect(n.pot).toBeGreaterThan(pot);
    expect(c.defId).toBe('treble');
  });
});

// ---------------------------------------------------------------- the bust

describe('a bust takes everything still riding (the reason to bank)', () => {
  function bustAfter(n: NightState): void {
    setScore(n, 10);
    throwAt(n, 'T20');
  }

  it('a live contract is lost with the visit', () => {
    const n = rich();
    take(n, 'clean_hands');
    const pot = n.pot;
    bustAfter(n);
    expect(currentLeg(n).ledger[0].settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(pot);
  });

  it('a contract already MADE is lost too, if it was still riding', () => {
    const n = rich();
    take(n, 'treble');
    throwAt(n, 'T20');
    expect(statusOf(n, 'treble')).toBe('MADE');
    const pot = n.pot;
    setScore(n, 10);
    throwAt(n, 'T20'); // bust
    expect(currentLeg(n).ledger[0].settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(pot);
  });

  it('a banked contract survives the bust: that is what banking is for', () => {
    const n = rich();
    const c = take(n, 'treble');
    take(n, 'clean_hands');
    throwAt(n, 'T20');
    const banked = bank(n, 'treble');
    expect(banked.ok).toBe(true);
    const pot = n.pot;
    setScore(n, 10);
    throwAt(n, 'T20'); // bust
    const ledger = currentLeg(n).ledger;
    expect(ledger.find((x) => x.defId === 'treble')?.settled).toEqual({ pot: c.stake + c.price, how: 'BANKED' });
    expect(ledger.find((x) => x.defId === 'clean_hands')?.settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(pot); // the banked money was already in the purse
  });

  it('a pulled contract survives the bust as well', () => {
    const n = rich();
    take(n, 'in_a_bed');
    throwAt(n, 'S5');
    const pulled = pull(n, 'in_a_bed');
    expect(pulled.ok).toBe(true);
    const pot = n.pot;
    setScore(n, 10);
    throwAt(n, 'T20');
    expect(currentLeg(n).ledger[0].settled?.how).toBe('PULLED');
    expect(n.pot).toBe(pot);
  });

  it('On Tick: a bust no longer takes a contract you had already made', () => {
    const n = rich(1, ['on_tick']);
    const c = take(n, 'treble');
    take(n, 'clean_hands');
    throwAt(n, 'T20');
    const pot = n.pot;
    setScore(n, 10);
    throwAt(n, 'T20'); // bust
    const ledger = currentLeg(n).ledger;
    // it landed on the first dart and survived the busting one, so the carry counts
    const paid = settleValue(c.stake, c.price, PULL_PER_DART);
    expect(ledger.find((x) => x.defId === 'treble')?.settled).toEqual({ pot: paid, how: 'PAID' });
    // …but a contract that never landed is still lost
    expect(ledger.find((x) => x.defId === 'clean_hands')?.settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(pot + paid);
  });

  it('without On Tick the same visit pays nothing', () => {
    const plain = rich();
    take(plain, 'treble');
    throwAt(plain, 'T20');
    const pot = plain.pot;
    setScore(plain, 10);
    throwAt(plain, 'T20');
    expect(plain.pot).toBe(pot);
  });
});

// ---------------------------------------------------------------- banking

describe('banking', () => {
  it('takes the money now, and it cannot be lost afterwards', () => {
    const n = rich();
    const c = take(n, 'treble');
    throwAt(n, 'T20');
    const pot = n.pot;
    const out = bank(n, 'treble');
    expect(ev(out.events, 'CONTRACT_SETTLED').contract.settled).toEqual({ pot: c.stake + c.price, how: 'BANKED' });
    expect(n.pot).toBe(pot + c.stake + c.price);
    expect(n.stats.contractsPaid).toBe(1);
    expect(n.paid.treble).toBe(1);
    expect(slateOf(n).every((x) => x.settled)).toBe(true);
  });

  /**
   * The bank-or-ride decision, in one test. Banking pays the printed price
   * flat; leaving it on the slate pays the same plus interest for every dart
   * it survives after it lands — and risks the lot on a bust or a dart in the
   * wall. Certainty costs you the carry.
   */
  it('banking gives up the carry that riding earns', () => {
    const banked = rich();
    take(banked, 'treble');
    throwAt(banked, 'T20');
    const before = banked.pot;
    bank(banked, 'treble');
    const bankedPaid = banked.pot - before;

    const ridden = rich();
    take(ridden, 'treble');
    throwAt(ridden, 'T20');
    const start = ridden.pot;
    throwAll(ridden, ['S1', 'S1']);
    const riddenPaid = ridden.pot - start;

    expect(riddenPaid).toBe(bankedPaid + 2 * PULL_PER_DART);
    expect(riddenPaid).toBeGreaterThan(bankedPaid);
  });

  it('the carry counts from when it landed, not from when it was taken', () => {
    const early = rich();
    take(early, 'treble');
    const eStart = early.pot;
    throwAll(early, ['T20', 'S1', 'S1']); // landed on dart 1, survived two
    const late = rich();
    take(late, 'treble');
    const lStart = late.pot;
    throwAll(late, ['S1', 'S1', 'T20']); // landed on the last dart, survived none
    expect(early.pot - eStart).toBe(late.pot - lStart + 2 * PULL_PER_DART);
  });

  it('is refused on a contract that has not landed, and on one already settled', () => {
    const n = rich();
    take(n, 'treble');
    expect(bankContract(n, 0).reason).toBe('not made yet');
    throwAt(n, 'T20');
    expect(bankContract(n, 0).ok).toBe(true);
    expect(bankContract(n, 0).reason).toBe('nothing to bank');
    expect(bankContract(n, 9).reason).toBe('nothing to bank');
  });
});

// ---------------------------------------------------------------- pulling

describe('pulling: the stake back plus what it survived', () => {
  it('pays the stake back plus interest for every dart the contract sat through', () => {
    const n = rich();
    const c = take(n, 'fish'); // still live at 120: it wants a hundred and forty
    const pot = n.pot;
    throwAll(n, ['T20', 'T20']);
    const leg = currentLeg(n);
    expect(statusOf(n, 'fish')).toBe('LIVE');
    expect(interestOn(n, leg, leg.slate[0])).toBe(2 * PULL_PER_DART);
    const out = pull(n, 'fish');
    expect(out.ok).toBe(true);
    const settled = ev(out.events, 'CONTRACT_SETTLED').contract;
    expect(settled.settled).toEqual({ pot: pullValue(c.stake, 2 * PULL_PER_DART), how: 'PULLED' });
    expect(n.pot).toBe(pot + c.stake + 2 * PULL_PER_DART);
    expect(PULL_PER_DART).toBeGreaterThan(0);
  });

  it('pulling before a dart is thrown just hands the stake back', () => {
    const n = rich();
    const c = take(n, 'fish');
    const pot = n.pot;
    pull(n, 'fish');
    expect(n.pot).toBe(pot + c.stake);
    expect(pullValue(c.stake, 0)).toBe(c.stake);
  });

  it('Short Price doubles the interest', () => {
    const n = rich(1, ['short_price']);
    const c = take(n, 'fish');
    const pot = n.pot;
    throwAll(n, ['T20', 'T20']);
    pull(n, 'fish');
    expect(n.pot).toBe(pot + c.stake + 2 * PULL_PER_DART * 2);
  });

  it('Short Price doubles the carry on a contract left to settle as well', () => {
    const plain = rich();
    take(plain, 'treble');
    const a = plain.pot;
    throwAll(plain, ['T20', 'S1', 'S1']);
    const short = rich(1, ['short_price']);
    take(short, 'treble');
    const b = short.pot;
    throwAll(short, ['T20', 'S1', 'S1']);
    expect(short.pot - b).toBe(plain.pot - a + 2 * PULL_PER_DART);
  });

  it('a contract that has already landed earns its carry from the landing, not from the take', () => {
    const n = rich();
    const c = take(n, 'ton');
    const pot = n.pot;
    throwAll(n, ['T20', 'T20']); // a hundred and twenty: the ton is made on dart two
    expect(statusOf(n, 'ton')).toBe('MADE');
    expect(interestOn(n, currentLeg(n), currentLeg(n).slate[0])).toBe(0);
    pull(n, 'ton');
    expect(n.pot).toBe(pot + c.stake);
  });

  it('a dead contract cannot be pulled: there is nothing left to take down', () => {
    const n = rich();
    take(n, 'quiet_one');
    throwAt(n, 'T20');
    expect(statusOf(n, 'quiet_one')).toBe('DEAD');
    expect(pullContract(n, 0).reason).toBe('that one is gone');
  });

  it('a pull is profit only past the stake, and never counts as paid', () => {
    const n = rich();
    take(n, 'treble');
    throwAt(n, 'T20');
    pull(n, 'treble');
    expect(n.stats.contractsPaid).toBe(0);
    expect(n.paid.treble).toBeUndefined();
    expect(currentLeg(n).ledger[0].settled?.how).toBe('PULLED');
  });
});

// ---------------------------------------------------------------- pressing

describe('pressing: tear it up and write a harder one', () => {
  it('costs the extra stake, moves to the harder tier and re-reads the visit', () => {
    const n = rich();
    take(n, 'ton');
    throwAll(n, ['T20', 'T20']);
    expect(statusOf(n, 'ton')).toBe('MADE');
    const pot = n.pot;
    const out = press(n, 'ton');
    expect(out.ok).toBe(true);
    const c = ev(out.events, 'CONTRACT_PRESSED').contract;
    expect(ev(out.events, 'CONTRACT_PRESSED').from).toBe('ton');
    expect(c.defId).toBe('fish');
    expect(c.stake).toBe(pressStake(2));
    expect(c.price).toBe(currentPrice(n, 'fish'));
    expect(c.pressed).toBe(1);
    expect(c.status).toBe('LIVE'); // 120 with one dart left: still reachable
    expect(n.pot).toBe(pot - 2);
    expect(n.stats.contractsPressed).toBe(1);
    expect(n.stats.potStaked).toBe(2 + 2);
  });

  it('make the harder one and it pays the harder price', () => {
    const n = rich();
    take(n, 'ton');
    throwAll(n, ['T20', 'T20']);
    press(n, 'ton');
    const pot = n.pot;
    const { events } = throwAt(n, 'T20'); // 180
    const settled = ev(events, 'CONTRACT_SETTLED').contract;
    expect(settled.defId).toBe('fish');
    expect(settled.settled).toEqual({ pot: 4 + contractDef('fish').price, how: 'PAID' });
    expect(n.pot).toBe(pot + 4 + contractDef('fish').price);
  });

  it('miss the harder one and the lot goes: that is the whole point of the press', () => {
    const n = rich();
    const before = n.pot;
    take(n, 'ton');
    throwAll(n, ['T20', 'T20']);
    press(n, 'ton');
    throwAt(n, 'S1'); // 121, not the fish
    expect(currentLeg(n).ledger[0].settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(before - 4);
  });

  it('re-reading can find the harder one already done', () => {
    const n = rich();
    take(n, 'treble');
    throwAll(n, ['T20', 'T20']);
    press(n, 'treble');
    expect(slateOf(n)[0].defId).toBe('two_trebles');
    expect(slateOf(n)[0].status).toBe('MADE');
    const out = bank(n, 'two_trebles');
    expect(out.ok).toBe(true);
  });

  it('a press can be pressed again, all the way to the top tier', () => {
    const n = rich();
    take(n, 'treble');
    throwAt(n, 'T20');
    press(n, 'treble');
    throwAt(n, 'T20');
    expect(statusOf(n, 'two_trebles')).toBe('MADE');
    press(n, 'two_trebles');
    expect(slateOf(n)[0].defId).toBe('three_trebles');
    expect(slateOf(n)[0].stake).toBe(8);
    expect(slateOf(n)[0].pressed).toBe(2);
    throwAt(n, 'T20');
    expect(currentLeg(n).ledger[0].settled).toEqual({ pot: 8 + contractDef('three_trebles').price, how: 'PAID' });
  });

  it('is refused on a contract that has not landed, on the top tier, and with an empty purse', () => {
    const n = rich();
    take(n, 'ton');
    expect(pressContract(n, 0).reason).toBe('not made yet');
    throwAll(n, ['T20', 'T20']);
    n.pot = 0;
    expect(pressContract(n, 0).reason).toBe('not enough pot');
    n.pot = 100;
    expect(pressContract(n, 0).ok).toBe(true);
    throwAt(n, 'T20'); // the fish is made, but the visit ends and it settles
    const m = rich();
    m.kit.push('rubout');
    take(m, 'bull');
    throwAt(m, 'BULL');
    expect(pressContract(m, 0).reason).toBe('nothing harder to press into');
  });
});

// ---------------------------------------------------------------- the price decay

describe('the house shortens your price (design.md §5.4.1)', () => {
  it('a contract that has paid is printed shorter next time', () => {
    const n = rich();
    const printed = contractDef('bull').price;
    expect(currentPrice(n, 'bull')).toBe(printed);
    n.paid.bull = 1;
    expect(currentPrice(n, 'bull')).toBe(printed - 1);
    n.paid.bull = 4;
    expect(currentPrice(n, 'bull')).toBe(printed - 4);
  });

  it('and it never goes below the floor, however many times it pays', () => {
    const n = rich();
    for (const times of [contractDef('bull').price, 20, 500]) {
      n.paid.bull = times;
      expect(currentPrice(n, 'bull')).toBe(PRICE_FLOOR);
    }
    expect(priceOf(contractDef('treble'), 99)).toBe(PRICE_FLOOR);
    expect(PRICE_FLOOR).toBeGreaterThan(0);
  });

  it('paying it in play is what moves the price, and pulling out is not', () => {
    const n = rich();
    const first = take(n, 'treble');
    throwAt(n, 'T20');
    bank(n, 'treble');
    expect(n.paid.treble).toBe(1);
    const second = currentPrice(n, 'treble');
    expect(second).toBe(Math.max(PRICE_FLOOR, first.price - 1));
    // pull the next one and the price stays where it is
    throwAll(n, ['S1', 'S1']);
    const c = take(n, 'treble');
    expect(c.price).toBe(second);
    pull(n, 'treble');
    expect(currentPrice(n, 'treble')).toBe(second);
  });

  it('Long Prices adds two to everything on the slate', () => {
    const plain = rich();
    const long = rich(1, ['long_prices']);
    for (const c of CONTRACTS) expect(currentPrice(long, c.id)).toBe(currentPrice(plain, c.id) + 2);
  });

  it('the shop’s RUB OUT service is the way back: it wipes the record', () => {
    const n = rich();
    n.paid = { treble: 4 };
    expect(currentPrice(n, 'treble')).toBe(PRICE_FLOOR);
    delete n.paid.treble;
    expect(currentPrice(n, 'treble')).toBe(contractDef('treble').price);
  });
});

// ---------------------------------------------------------------- the ledger

describe('the ledger keeps the night honest', () => {
  it('every settled contract lands in the leg ledger exactly once, oldest first', () => {
    const n = rich();
    take(n, 'treble');
    take(n, 'quiet_one');
    throwAt(n, 'T20');
    bank(n, 'treble');
    throwAll(n, ['S1', 'S1']);
    const ledger = currentLeg(n).ledger;
    expect(ledger).toHaveLength(2);
    expect(ledger.map((c) => c.defId)).toEqual(['treble', 'quiet_one']);
    expect(ledger.every((c) => c.settled !== null)).toBe(true);
  });

  it('a loss is reported as a loss: no contract pays back less than its stake and calls it a win', () => {
    const n = rich();
    take(n, 'treble');
    throwAll(n, ['S1', 'S1', 'S1']);
    const settled = currentLeg(n).ledger[0] as TakenContract;
    expect(settled.settled?.how).toBe('LOST');
    expect(settled.settled?.pot).toBe(0);
    expect(n.stats.potWon).toBe(0);
  });

  it('the best payout of the night is tracked as profit, not as the gross', () => {
    const n = rich();
    const c = take(n, 'bull');
    throwAt(n, 'BULL');
    bank(n, 'bull');
    expect(n.stats.bestPayout).toBe(c.price);
    expect(n.stats.potWon).toBe(c.price);
  });

  it('the slate empties between visits but the ledger keeps growing', () => {
    const n = rich();
    take(n, 'treble');
    throwAll(n, ['S1', 'S1', 'S1']);
    expect(currentVisit(currentLeg(n)).throws).toEqual([]);
    expect(slateOf(n)).toEqual([]);
    take(n, 'treble');
    throwAll(n, ['S1', 'S1', 'S1']);
    expect(currentLeg(n).ledger).toHaveLength(2);
  });
});
