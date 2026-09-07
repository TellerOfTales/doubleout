/**
 * THE SLATE — the contracts chalked up beside the score.
 *
 * This replaces the deck of dealt targets. The deck decided *where you were
 * allowed to aim*, which is the one decision darts has, so it had to go
 * (docs/decisions/design.md §2). The slate decides *what a visit is worth*,
 * which is the thing every pub darts variant in existence actually modifies.
 *
 * At the start of a visit three contracts are offered. Taking one stakes Pot
 * against a printed price. The contracts pull in different directions on
 * purpose — one wants a hundred, one wants three darts in the same bed, one
 * wants nothing under fifteen — so "where do I aim" stops answering itself.
 *
 * The offer stays open until there are two darts left, at a price that
 * lengthens with the darts already gone, so what happens on the board can
 * still be wagered on. After every dart:
 *   SETTLE — take the money on a contract still going, for a share of what it
 *            would pay that grows with every dart it has survived.
 *   PRESS  — a contract that has landed and been paid puts the winnings back
 *            up on its harder tier at double stake. Make the harder one by the
 *            end of the visit or lose that stake. This is the push-your-luck
 *            beat, and it is the only one where the money is already yours.
 *   (leave it) — a contract pays the instant it lands, and anything still
 *            going when the visit ends, busts, or takes a dart in the wall is
 *            lost.
 *
 * Nothing here is hidden. Prices are printed, conditions are printed, the
 * landing odds are drawn on the board, and a contract that pays back less than
 * its stake is reported as a loss in the same colour as every other loss.
 */
import type { Bed, Target } from './types';

/** The most one dart can score. */
const MAX_DART = 60;

/** What the visit looks like to a contract, part way through. */
export interface VisitProgress {
  /** Value of each dart thrown so far. A dart in the wall is 0. */
  values: number[];
  /** Where each dart actually landed. null for the wall. */
  hits: (Target | null)[];
  /** Darts still to come in this visit. */
  left: number;
  /** Score at the start of the visit. */
  from: number;
  /** Score now, after the darts thrown so far. */
  now: number;
  /** True once the visit has busted. */
  busted: boolean;
  /** True once the leg has been checked out. */
  checkedOut: boolean;
}

export type ContractStatus = 'LIVE' | 'MADE' | 'DEAD';

export interface ContractDef {
  id: string;
  /**
   * Chalked on the board. Eight characters at most, because the narrowest
   * place it is printed is a fifty-five pixel card on a portrait phone and a
   * name that has to be cut short is a name the player cannot read back.
   */
  name: string;
  /** One line under the name. Keep to 30 characters: the slate strip is narrow. */
  blurb: string;
  /** Pot staked to take it. */
  stake: number;
  /** Pot paid on top of the returned stake when it lands. */
  price: number;
  /** The harder contract a PRESS rewrites this into. */
  pressTo?: string;
  /** Relative draw weight. Pressed tiers are 0: they are never offered cold. */
  weight: number;
  /** Which way this contract pulls the aim. Drives the offer mix. */
  pull: 'SCORE' | 'PRECISION' | 'RESTRAINT' | 'FINISH' | 'SHAPE';
  check: (v: VisitProgress) => ContractStatus;
}

// ---------------------------------------------------------------- helpers

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const thrown = (v: VisitProgress) => v.values.length;
const ceiling = (v: VisitProgress) => sum(v.values) + v.left * MAX_DART;
const bedOf = (t: Target | null): Bed | undefined => (t && t.region !== 'W' ? t.bed : undefined);
const regionCount = (v: VisitProgress, region: Target['region']) => v.hits.filter((h) => h?.region === region).length;

/** MADE the moment `done` is true; DEAD once `possible` has gone; LIVE otherwise. */
function gate(done: boolean, possible: boolean): ContractStatus {
  if (done) return 'MADE';
  return possible ? 'LIVE' : 'DEAD';
}

/**
 * A contract judged by an invariant that has to hold for every dart, plus an
 * optional extra reading taken once the darts have run out.
 *
 * The invariant is checked at every step, so the moment it breaks the contract
 * is DEAD and stays dead — an earlier version consulted it only while darts
 * remained and then asked a different question at the end, which let 15 UP
 * die on the first dart and come back to life on the third. Writing conditions
 * as "this must be true of every dart so far" makes that impossible, and it
 * means a contract can say "every dart" and mean it however many darts the
 * visit had: Fourth Dart makes four and nothing here changes.
 */
function atEnd(v: VisitProgress, invariant: boolean, final = true, minDarts = 1): ContractStatus {
  if (!invariant) return 'DEAD';
  if (v.left > 0) return 'LIVE';
  return final && thrown(v) >= minDarts ? 'MADE' : 'DEAD';
}

// ---------------------------------------------------------------- the pool

export const CONTRACTS: ContractDef[] = [
  // --- SCORE: these want the treble twenty and will punish a safe visit.
  {
    id: 'ton',
    name: 'A TON',
    blurb: '100 or more.',
    stake: 2,
    price: 4,
    pressTo: 'fish',
    weight: 7,
    pull: 'SCORE',
    check: (v) => gate(sum(v.values) >= 100, ceiling(v) >= 100),
  },
  {
    id: 'fish',
    name: 'THE FISH',
    blurb: '140 or more.',
    stake: 4,
    price: 10,
    pressTo: 'maximum',
    weight: 4,
    pull: 'SCORE',
    check: (v) => gate(sum(v.values) >= 140, ceiling(v) >= 140),
  },
  {
    id: 'maximum',
    name: 'MAXIMUM',
    blurb: '180. The lot.',
    stake: 8,
    price: 44,
    weight: 0,
    pull: 'SCORE',
    check: (v) => gate(sum(v.values) >= 180, ceiling(v) >= 180),
  },

  // --- PRECISION: these want a named piece of the board, whatever it scores.
  {
    id: 'treble',
    name: 'A TREBLE',
    blurb: 'Any treble.',
    stake: 2,
    price: 3,
    pressTo: 'two_trebles',
    weight: 7,
    pull: 'PRECISION',
    check: (v) => gate(regionCount(v, 'T') >= 1, regionCount(v, 'T') + v.left >= 1),
  },
  {
    id: 'two_trebles',
    name: 'A PAIR',
    blurb: 'Two trebles.',
    stake: 4,
    price: 7,
    pressTo: 'three_trebles',
    weight: 3,
    pull: 'PRECISION',
    check: (v) => gate(regionCount(v, 'T') >= 2, regionCount(v, 'T') + v.left >= 2),
  },
  {
    id: 'three_trebles',
    name: 'A TRIO',
    blurb: 'Three trebles.',
    stake: 8,
    price: 32,
    weight: 0,
    pull: 'PRECISION',
    check: (v) => gate(regionCount(v, 'T') >= 3, regionCount(v, 'T') + v.left >= 3),
  },
  {
    id: 'bull',
    name: 'THE BULL',
    blurb: 'The inner bull.',
    stake: 3,
    price: 13,
    weight: 7,
    pull: 'PRECISION',
    check: (v) => gate(regionCount(v, 'IB') >= 1, regionCount(v, 'IB') + v.left >= 1),
  },
  {
    id: 'in_a_bed',
    name: 'IN A BED',
    blurb: 'All darts, one bed.',
    stake: 3,
    price: 15,
    weight: 7,
    pull: 'PRECISION',
    check: (v) => {
      const beds = v.hits.map(bedOf);
      const first = beds.find((b) => b !== undefined);
      const consistent = beds.every((b) => b !== undefined && b === first);
      return atEnd(v, consistent);
    },
  },
  {
    id: 'shanghai',
    name: 'SHANGHAI',
    blurb: 'One bed, all three.',
    stake: 4,
    price: 38,
    weight: 3,
    pull: 'PRECISION',
    check: (v) => {
      const beds = v.hits.map(bedOf);
      const first = beds.find((b) => b !== undefined);
      const consistent = beds.every((b) => b !== undefined && b === first);
      const regions = new Set(v.hits.filter((h) => h && h.region !== 'W').map((h) => (h as Target).region));
      const made = consistent && regions.has('S') && regions.has('D') && regions.has('T');
      return gate(made, consistent && regions.size + v.left >= 3);
    },
  },

  // --- RESTRAINT: these are why a safe single is worth aiming at.
  {
    id: 'nothing_cheap',
    name: '15 UP',
    blurb: 'No dart under 15.',
    stake: 2,
    price: 9,
    // No pressTo. A contract judged at the end of the visit can only ever
    // reach MADE with no darts left, and a press needs darts to make the
    // harder one in — so the button was advertised and could never appear.
    // Nothing in this game may print an offer it cannot honour (§6).
    weight: 11,
    pull: 'RESTRAINT',
    check: (v) => atEnd(v, v.values.every((x) => x >= 15)),
  },
  {
    id: 'nothing_cheaper',
    name: '20 UP',
    blurb: 'No dart under 20.',
    stake: 4,
    price: 15,
    // Offered in its own right, now that nothing presses into it. It used to be
    // the pressed tier of 15 UP, which could never happen: a contract judged at
    // the end of the visit only ever reaches MADE with no darts left, and a
    // press needs darts to make the harder one in.
    weight: 5,
    pull: 'RESTRAINT',
    check: (v) => atEnd(v, v.values.every((x) => x >= 20)),
  },
  {
    id: 'quiet_one',
    name: 'QUIET',
    blurb: 'Score under 25.',
    stake: 2,
    price: 14,
    weight: 9,
    pull: 'RESTRAINT',
    check: (v) => {
      const t = sum(v.values);
      return atEnd(v, t < 25, t > 0);
    },
  },
  {
    id: 'clean_hands',
    name: 'CLEAN',
    blurb: 'All on, no bust.',
    stake: 2,
    price: 6,
    weight: 9,
    pull: 'RESTRAINT',
    check: (v) => atEnd(v, !v.busted && v.hits.every((h) => h !== null)),
  },

  {
    id: 'plain_numbers',
    name: 'SINGLES',
    blurb: 'Singles only.',
    stake: 2,
    price: 8,
    weight: 10,
    pull: 'RESTRAINT',
    check: (v) => atEnd(v, v.hits.every((h) => h?.region === 'S')),
  },
  {
    id: 'cheap_seats',
    name: 'CHEAP',
    blurb: 'Every dart 10 or less.',
    stake: 2,
    price: 13,
    weight: 8,
    pull: 'RESTRAINT',
    check: (v) => atEnd(v, v.hits.every((h) => h !== null && h.region !== 'W' && (h.bed ?? 99) <= 10)),
  },
  {
    id: 'two_doubles',
    name: 'TWO OUTS',
    blurb: 'Two doubles.',
    stake: 3,
    price: 15,
    weight: 7,
    pull: 'PRECISION',
    check: (v) => gate(regionCount(v, 'D') >= 2, regionCount(v, 'D') + v.left >= 2),
  },

  // --- FINISH: these only matter down at the business end of a leg.
  {
    id: 'game_shot',
    name: 'THE SHOT',
    blurb: 'Win the leg this visit.',
    stake: 3,
    price: 10,
    weight: 7,
    pull: 'FINISH',
    // Unreachable from a scoring position, and a contract that cannot be
    // reached must never reach the slate: that is the dead card the deck used
    // to deal, wearing a different hat.
    check: (v) => gate(v.checkedOut, !v.busted && v.now > 1 && v.left > 0 && v.now <= v.left * MAX_DART),
  },
  {
    id: 'left_pretty',
    name: 'A LEAVE',
    blurb: 'Even leave, 40 max.',
    stake: 2,
    price: 7,
    weight: 9,
    pull: 'FINISH',
    check: (v) => {
      const good = (s: number) => s > 1 && s <= 40 && s % 2 === 0;
      if (v.checkedOut) return 'DEAD';
      // Same rule: from 301 no three darts can leave you under forty-one.
      const reachable = v.now - v.left * MAX_DART <= 40;
      return atEnd(v, !v.busted && v.now >= 2 && reachable, good(v.now));
    },
  },

  // --- SHAPE: pure aiming puzzles. These are the ones that make a visit odd.
  {
    id: 'ladder_up',
    name: 'LADDER',
    blurb: 'Each dart bigger.',
    stake: 3,
    price: 12,
    weight: 9,
    pull: 'SHAPE',
    check: (v) => {
      const rising = v.values.every((x, i) => i === 0 || x > v.values[i - 1]);
      // Nothing beats sixty, so a sixty with darts still to come is a dead end.
      const room = v.left === 0 || thrown(v) === 0 || v.values[thrown(v) - 1] < MAX_DART;
      return atEnd(v, rising && room, true, 2);
    },
  },
  {
    id: 'ladder_down',
    name: 'DOWNHILL',
    blurb: 'Each dart smaller.',
    stake: 3,
    price: 12,
    weight: 9,
    pull: 'SHAPE',
    check: (v) => {
      const falling = v.values.every((x, i) => i === 0 || x < v.values[i - 1]);
      // And nothing is under nothing.
      const room = v.left === 0 || thrown(v) === 0 || v.values[thrown(v) - 1] > 0;
      return atEnd(v, falling && room, true, 2);
    },
  },
  {
    id: 'odd_job',
    name: 'ODD JOB',
    blurb: 'Every dart odd.',
    stake: 2,
    price: 11,
    weight: 9,
    pull: 'SHAPE',
    check: (v) => atEnd(v, v.values.every((x) => x % 2 === 1)),
  },
  {
    id: 'three_ways',
    name: 'ONE EACH',
    blurb: 'Single, double, treble.',
    stake: 3,
    price: 12,
    weight: 9,
    pull: 'SHAPE',
    check: (v) => {
      const seen = new Set(v.hits.filter((h) => h && (h.region === 'S' || h.region === 'D' || h.region === 'T')).map((h) => (h as Target).region));
      return gate(seen.size >= 3, seen.size + v.left >= 3);
    },
  },
];

export const CONTRACT_BY_ID: Record<string, ContractDef> = Object.fromEntries(CONTRACTS.map((c) => [c.id, c]));

export function contractDef(id: string): ContractDef {
  const d = CONTRACT_BY_ID[id];
  if (!d) throw new Error(`unknown contract: ${id}`);
  return d;
}

// ---------------------------------------------------------------- pricing

/**
 * Prices, and how they were arrived at.
 *
 * A contract is only a decision if taking it is worth aiming differently for.
 * The arithmetic: three darts at the treble twenty average about a hundred, and
 * three safe singles about sixty, so a contract that asks you to play safe has
 * to be worth roughly forty points of score, which at `POT_IN_POINTS` is four
 * Pot — before the chance of missing it. That is why 15 UP pays eight
 * rather than the three it was first printed at, and why every contract that
 * pulls AWAY from the treble twenty is dear while the two that agree with it
 * (A TON, A TREBLE) stay cheap. `npm run decisions` measures whether it
 * worked: it replays every dart with the slate emptied and counts how often
 * the aim moves.
 */

/**
 * The house shortens your price as you keep doing the same thing. Every time a
 * contract pays, its price drops by one for the rest of the night, down to a
 * floor. It is the simplest honest way to stop a night settling into one
 * favourite contract thrown over and over, and it reads on the slate as a
 * number that visibly gets worse.
 */
export const PRICE_FLOOR = 1;

export function priceOf(def: ContractDef, timesPaid: number): number {
  return Math.max(PRICE_FLOOR, def.price - Math.max(0, timesPaid));
}

/** Pot returned by a PULL: half the stake, rounded down. The floor under SETTLE. */
export function pullValue(stake: number, share: number): number {
  return Math.floor(stake * share);
}

/**
 * SETTLE — what a contract still riding is worth if you take the money now.
 *
 * This is the verb the fourth playtest was missing. Before it, the money on
 * the slate did nothing between darts: a contract paid itself the instant it
 * landed, and the only thing you could do to one still going was give up on it
 * for half your stake, which is not a decision anybody makes twice. So the
 * visit had exactly one moment with money in it — the purchase, before the
 * first dart — and then three darts of watching.
 *
 * Now a live contract is worth something that grows with every dart it
 * survives, and that number is on the card, moving. Riding it out pays the
 * lot; settling pays a share of it, now, for certain. The share is deliberately
 * under the fair price — a contract two darts into three is worth roughly two
 * thirds of its own odds and settles for sixty percent of that — so settling
 * everything is never free money, and neither is riding everything, because a
 * dart in the wall takes the lot. That gap is where the decision lives.
 *
 * It never pays less than a PULL used to, so the old escape hatch is intact
 * underneath it.
 */
export const SETTLE_SHARE = 0.6;
/** Short Price: the house settles at a better share. */
export const SETTLE_SHARE_SHORT = 0.8;

export function settleNow(stake: number, price: number, survived: number, window: number, share = SETTLE_SHARE, floor = 0.5): number {
  const along = window > 0 ? Math.max(0, Math.min(1, survived / window)) : 0;
  return Math.max(Math.floor(stake * floor), Math.floor((stake + price) * along * share));
}

/**
 * The premium on a contract taken after the visit has started.
 *
 * The offer used to close the moment the first dart left the hand, which meant
 * every wager on the slate was made blind and nothing that happened on the
 * board could be wagered on. It stays open now, but the house prices on the
 * darts left rather than on how the visit is going: fewer darts is a harder
 * contract, so it pays more. Reading whether the visit has gone well enough to
 * make a standing price generous is the player's edge, and it is the reason to
 * keep looking at the slate after the first dart.
 *
 * It closes with two darts to go, so nobody can wait until they are on a
 * double they were going to throw anyway and take the money for it.
 */
export const LATE_PREMIUM = 0.5;

export function latePrice(price: number, thrown: number): number {
  return Math.round(price * (1 + LATE_PREMIUM * Math.max(0, thrown)));
}

/** A pressed contract costs double and pays the harder tier's price. */
export function pressStake(stake: number): number {
  return stake * 2;
}
