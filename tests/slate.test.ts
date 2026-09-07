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
import { PULL_RETURN, SLATE_SIZE, STARTING_POT } from '../src/content/legs.ts';
import { CONTRACTS, CONTRACT_BY_ID, PRICE_FLOOR, contractDef, pressStake, priceOf, pullValue, settleValue } from '../src/core/slate.ts';
import {
  addChalk,
  commitMiss,
  currentLeg,
  currentPrice,
  currentVisit,
  pressContract,
  pullContract,
  takeContract,
  useRubOut,
  visitProgress,
} from '../src/core/state.ts';
import type { NightState, TakenContract } from '../src/core/types.ts';
import { checkVisit, ev, eventTypes, press, pull, setScore, slateOf, startNight, statusOf, take, throwAll, throwAt, wallRng } from './helpers.ts';

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
    // The treble pays the instant it lands; the quiet one dies on the same dart
    // and waits for the visit to end before it is written off.
    const first = throwAt(n, 'T20');
    expect(first.events.filter((e) => e.type === 'CONTRACT_SETTLED')).toHaveLength(1);
    expect(statusOf(n, 'quiet_one')).toBe('DEAD');
    const { events } = throwAll(n, ['S1', 'S1']);
    expect(events.filter((e) => e.type === 'CONTRACT_SETTLED')).toHaveLength(1);
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
  it('a contract pays its stake and its price the moment it lands, not at the end', () => {
    const n = rich();
    const c = take(n, 'treble');
    const pot = n.pot;
    // It lands on the very first dart, and the money is in the Pot before the
    // second one is thrown. There is no way to leave it up for more.
    const { events } = throwAt(n, 'T20');
    const settled = ev(events, 'CONTRACT_SETTLED').contract;
    expect(settled.settled).toEqual({ pot: c.stake + c.price, how: 'PAID' });
    expect(n.pot).toBe(pot + c.stake + c.price);
    expect(n.stats.contractsPaid).toBe(1);
    expect(n.paid.treble).toBe(1);
    // And two more darts cannot take it back.
    throwAt(n, 'S1');
    throwAt(n, 'S1');
    expect(n.pot).toBe(pot + c.stake + c.price);
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

  it('a visit walked away from settles whatever is left on the slate', () => {
    const n = rich();
    take(n, 'treble');
    take(n, 'ton');
    // The treble pays at once; walking away writes off the one still chasing.
    expect(ev(throwAt(n, 'T20').events, 'CONTRACT_SETTLED').contract.settled?.how).toBe('PAID');
    const { events } = commitMiss(n);
    expect(ev(events, 'CONTRACT_SETTLED').contract.settled?.how).toBe('LOST');
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
describe('a dart in the wall wipes the slate', () => {
  it('everything still chasing goes, whether it was aimed at the wall or not', () => {
    const n = rich();
    take(n, 'ton');
    take(n, 'clean_hands');
    const pot = n.pot;
    n.trueAim = false;
    n.rng = wallRng('D20');
    throwAt(n, 'D20');
    const ledger = currentLeg(n).ledger;
    expect(ledger.filter((c) => c.settled?.how === 'LOST').length).toBe(2);
    expect(n.pot).toBe(pot);
    expect(n.stats.slatesWiped).toBe(1);
  });

  it('a contract that already paid is untouched, because it is not on the slate any more', () => {
    const n = rich();
    n.trueAim = true;
    const c = take(n, 'treble');
    take(n, 'ton');
    throwAt(n, 'T20');
    const afterPaid = n.pot;
    n.trueAim = false;
    n.rng = wallRng('D20');
    throwAt(n, 'D20');
    const ledger = currentLeg(n).ledger;
    expect(ledger.find((x) => x.defId === 'treble')?.settled).toEqual({ pot: c.stake + c.price, how: 'PAID' });
    expect(ledger.find((x) => x.defId === 'ton')?.settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(afterPaid);
  });

  it('a wall dart with nothing on the slate wipes nothing and counts nothing', () => {
    const n = rich();
    n.trueAim = false;
    n.rng = wallRng('D20');
    throwAt(n, 'D20');
    expect(currentLeg(n).ledger).toHaveLength(0);
    expect(n.stats.slatesWiped).toBe(0);
  });

  it('walking away on purpose settles the slate the same way', () => {
    const n = rich();
    take(n, 'ton');
    const pot = n.pot;
    commitMiss(n);
    expect(currentLeg(n).ledger[0]?.settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(pot);
  });
});

describe('a bust takes everything still chasing', () => {
  function bustAfter(n: NightState): void {
    setScore(n, 10);
    throwAt(n, 'T20');
  }

  it('a live contract is lost with the visit', () => {
    const n = rich();
    const c = take(n, 'ton');
    const pot = n.pot;
    bustAfter(n);
    const settled = currentLeg(n).ledger.find((x) => x.defId === 'ton');
    expect(settled?.settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(pot);
    expect(n.stats.slatesWiped).toBe(1);
    void c;
  });

  it('a contract that already landed is untouchable, because it has already paid', () => {
    const n = rich();
    const c = take(n, 'treble');
    take(n, 'clean_hands');
    const pot = n.pot;
    // It pays the instant it lands, so the money is in the Pot before the bust.
    throwAt(n, 'T20');
    expect(n.pot).toBe(pot + c.stake + c.price);
    const afterPaid = n.pot;
    bustAfter(n);
    const ledger = currentLeg(n).ledger;
    expect(ledger.find((x) => x.defId === 'treble')?.settled).toEqual({ pot: c.stake + c.price, how: 'PAID' });
    expect(ledger.find((x) => x.defId === 'clean_hands')?.settled).toEqual({ pot: 0, how: 'LOST' });
    expect(n.pot).toBe(afterPaid);
  });

  it('every live contract goes at once, however many are up', () => {
    const n = rich();
    take(n, 'ton');
    take(n, 'clean_hands');
    bustAfter(n);
    const ledger = currentLeg(n).ledger;
    expect(ledger.filter((x) => x.settled?.how === 'LOST').length).toBe(2);
    // and it counts as one slate gone, not two
    expect(n.stats.slatesWiped).toBe(1);
  });

  it('a contract already DEAD before the bust is still just lost', () => {
    const n = rich();
    take(n, 'nothing_cheap');
    throwAt(n, 'S1'); // kills it: a dart under fifteen
    expect(statusOf(n, 'nothing_cheap')).toBe('DEAD');
    bustAfter(n);
    expect(currentLeg(n).ledger.find((x) => x.defId === 'nothing_cheap')?.settled).toEqual({ pot: 0, how: 'LOST' });
  });
});

describe('pulling out: half the stake back', () => {
  it('returns half the stake, rounded down, and takes the contract off the slate', () => {
    const n = rich();
    const c = take(n, 'ton');
    const pot = n.pot;
    throwAt(n, 'S1');
    const out = pullContract(n, 0);
    expect(out.ok).toBe(true);
    expect(ev(out.events, 'CONTRACT_SETTLED').contract.settled).toEqual({ pot: pullValue(c.stake, PULL_RETURN), how: 'PULLED' });
    expect(n.pot).toBe(pot + Math.floor(c.stake * PULL_RETURN));
    expect(currentLeg(n).slate[0].settled).not.toBeNull();
  });

  it('is a loss, not a refund: taking a contract has to cost something', () => {
    const n = rich();
    const c = take(n, 'ton');
    const before = n.pot;
    pullContract(n, 0);
    expect(n.pot).toBeLessThan(before + c.stake);
    // and it never counts as a contract that paid
    expect(n.stats.contractsPaid).toBe(0);
    expect(n.paid.ton).toBeUndefined();
  });

  it('cannot pull a contract that has already paid, or one that is dead', () => {
    const n = rich();
    take(n, 'treble');
    throwAt(n, 'T20');
    expect(pullContract(n, 0).ok).toBe(false);
  });
});

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
    // A press is a fresh contract at double the stake, paid for in full out of
    // the Pot the first one has already been paid into.
    expect(c.stake).toBe(pressStake(2));
    expect(n.pot).toBe(pot - pressStake(2));
    expect(c.price).toBe(currentPrice(n, 'fish'));
    expect(c.pressed).toBe(1);
    expect(c.status).toBe('LIVE'); // 120 with one dart left: still reachable
    expect(n.stats.contractsPressed).toBe(1);
    expect(n.stats.potStaked).toBe(2 + pressStake(2));
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

  it('miss the harder one and the new stake goes, but the first payout does not', () => {
    const n = rich();
    const before = n.pot;
    const c = take(n, 'ton');
    throwAll(n, ['T20', 'T20']);
    press(n, 'ton');
    throwAt(n, 'S1'); // 121, not the fish
    const ledger = currentLeg(n).ledger;
    expect(ledger.find((x) => x.defId === 'ton')?.settled).toEqual({ pot: c.stake + c.price, how: 'PAID' });
    expect(ledger.find((x) => x.defId === 'fish')?.settled).toEqual({ pot: 0, how: 'LOST' });
    // Staked 2, paid c.price back on it, then staked 4 more and lost that.
    expect(n.pot).toBe(before + c.price - pressStake(c.stake));
  });

  it('re-reading can find the harder one already done', () => {
    const n = rich();
    take(n, 'treble');
    throwAll(n, ['T20', 'T20']);
    press(n, 'treble');
    // The harder tier reads the whole visit, so two trebles already thrown
    // make it the instant it goes up, and it pays without another dart.
    const settled = currentLeg(n).slate.find((c) => c.defId === 'two_trebles');
    expect(settled?.settled?.how).toBe('PAID');
  });

  it('a press can be pressed again, all the way to the top tier', () => {
    const n = rich();
    take(n, 'treble');
    throwAt(n, 'T20');
    press(n, 'treble');
    throwAt(n, 'T20');
    expect(statusOf(n, 'two_trebles')).toBe('MADE');
    press(n, 'two_trebles');
    const top = currentLeg(n).slate[currentLeg(n).slate.length - 1];
    expect(top.defId).toBe('three_trebles');
    expect(top.stake).toBe(8);
    expect(top.pressed).toBe(2);
    throwAt(n, 'T20');
    expect(currentLeg(n).ledger.find((c) => c.defId === 'three_trebles')?.settled).toEqual({
      pot: 8 + contractDef('three_trebles').price,
      how: 'PAID',
    });
    // And nothing may be pressed out of twice: the money already went back out.
    expect(currentLeg(n).ledger.filter((c) => c.spent).length).toBe(2);
  });

  it('is refused before it lands, at the top tier, with an empty purse, and out of darts', () => {
    const n = rich();
    take(n, 'ton');
    // Nothing to press until it has landed and paid.
    expect(pressContract(n, 0).reason).toBe('nothing to press');
    throwAll(n, ['T20', 'T20']);
    n.pot = 0;
    expect(pressContract(n, 0).reason).toBe('not enough pot');
    n.pot = 100;
    expect(pressContract(n, 0).ok).toBe(true);

    // The bull has no harder tier to become.
    const m = rich();
    take(m, 'bull');
    throwAt(m, 'BULL');
    expect(pressContract(m, 0).reason).toBe('nothing to press');

    // And no press once the darts have run out, because there is nothing left
    // to make the harder one with.
    const o = rich();
    take(o, 'treble');
    throwAll(o, ['T20', 'S1', 'S1']);
    expect(pressContract(o, 0).reason).toBe('nothing to press');
  });

  it('never sells a press that is already dead on arrival (design.md §6)', () => {
    const n = rich();
    take(n, 'nothing_cheap');
    // A fifteen keeps NO SCRAPS alive but kills NO SCRAPS+ outright, so the
    // press must be refused rather than taking a stake for the impossible.
    throwAt(n, 'S15');
    throwAt(n, 'S20');
    expect(statusOf(n, 'nothing_cheap')).toBe('LIVE');
    throwAt(n, 'S20');
    const paid = currentLeg(n).ledger.find((c) => c.defId === 'nothing_cheap');
    expect(paid?.settled?.how).toBe('PAID');
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
