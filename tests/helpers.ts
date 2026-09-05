/**
 * Shared helpers for the engine test suite. No test logic lives here — only
 * constructors and scripted bots so the spec files stay readable.
 */
import { createHash } from 'node:crypto';
import { cardDef, makeCard } from '../src/content/cards.ts';
import { chalkDef } from '../src/content/chalkdefs.ts';
import { targetDefId } from '../src/core/board.ts';
import { computeCheckoutHints } from '../src/core/checkout.ts';
import { resolveThrow } from '../src/core/resolver.ts';
import { createRng, nextFloat } from '../src/core/rng.ts';
import {
  addChalk,
  beginLeg,
  commitCard,
  createNight,
  currentLeg,
  currentVisit,
  newCard,
  shopBuy,
  shopLeave,
  shopRefresh,
} from '../src/core/state.ts';
import type { Chalk, DartCard, EngineEvent, LegState, NightState, OcheId, Rng, Target, ThrowResult } from '../src/core/types.ts';

// ---------------------------------------------------------------- chalk / cards

/** Chalk list whose acquisition order is the array order (first = oldest). */
export function mkChalk(ids: string[]): Chalk[] {
  return ids.map((id, i) => ({ def: chalkDef(id), order: i + 1 }));
}

let cardSeq = 0;

/** A throw-away card instance for a def id ("t20", "d16", "ob", "ib"). */
export function mkCard(defId: string): DartCard {
  cardSeq++;
  return makeCard(defId, `h${cardSeq}`, (cardSeq % 4) as 0 | 1 | 2 | 3);
}

export interface ResolveOpts {
  /** Gameplay RNG; null (default) disables wired deflection. */
  rng?: Rng | null;
  /** Defaults to `score`. */
  scoreAtVisitStart?: number;
  /** Defaults to 0. */
  throwIndex?: 0 | 1 | 2 | 3;
  /** Defaults to false. */
  forgivenessUsed?: boolean;
}

export type Resolved = ThrowResult & { forgivenessConsumed: boolean };

/** Resolve one card through the real pipeline with the given chalk (acquisition order = array order). */
export function resolve(defId: string, score: number, chalkIds: string[] = [], opts: ResolveOpts = {}): Resolved {
  const out = resolveThrow(mkCard(defId), {
    chalk: mkChalk(chalkIds),
    rng: opts.rng === undefined ? null : opts.rng,
    scoreBefore: score,
    scoreAtVisitStart: opts.scoreAtVisitStart ?? score,
    visitThrowIndex: opts.throwIndex ?? 0,
    forgivenessUsed: opts.forgivenessUsed ?? false,
  });
  return { ...out.result, forgivenessConsumed: out.forgivenessConsumed };
}

/** Just the total resolved value of a throw. */
export function value(defId: string, chalkIds: string[] = [], opts: ResolveOpts = {}): number {
  return resolve(defId, 1000, chalkIds, opts).totalValue;
}

/** Card def id for a target: "t20", "ob", "ib". */
export function defIdOf(t: Target): string {
  return targetDefId(t);
}

/** Base value of a def id straight from the card table (bed × multiplier, OB 25, IB 50). */
export function baseOf(defId: string): number {
  return cardDef(defId).value;
}

// ---------------------------------------------------------------- rng

/** An RNG whose next float is < 0.25, i.e. `wired` WILL deflect on the next bed throw. */
export function deflectingRng(): Rng {
  for (let s = 1; s < 100000; s++) {
    if (nextFloat(createRng(s)) < 0.25) return createRng(s);
  }
  throw new Error('no deflecting seed found');
}

/** An RNG whose next float is >= 0.25, i.e. `wired` will NOT deflect on the next bed throw. */
export function nonDeflectingRng(): Rng {
  for (let s = 1; s < 100000; s++) {
    if (nextFloat(createRng(s)) >= 0.25) return createRng(s);
  }
  throw new Error('no non-deflecting seed found');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// ---------------------------------------------------------------- night helpers

/** A fresh night with its first leg begun. Chalk ids are added (in order) before the leg starts. */
export function startNight(seed = 1, oche: OcheId = 'local', chalk: string[] = []): NightState {
  const n = createNight(seed, oche);
  for (const id of chalk) addChalk(n, id);
  beginLeg(n);
  return n;
}

/** Replace the current hand with fresh cards of the given def ids (bypasses the deck). */
export function forceHand(n: NightState, defIds: string[]): DartCard[] {
  const leg = currentLeg(n);
  leg.hand = defIds.map((d) => newCard(n, d));
  return leg.hand;
}

/**
 * Put the current hand back on top of the deck, then pull one card per def id
 * out of the leg pool (deck first, then discard) into the hand. Unlike
 * forceHand this keeps the leg pool intact. Throws if a def id is not held.
 */
export function dealFromPool(n: NightState, defIds: string[]): DartCard[] {
  const leg = currentLeg(n);
  leg.deck.unshift(...leg.hand);
  leg.hand = [];
  for (const d of defIds) {
    let i = leg.deck.findIndex((c) => c.defId === d);
    if (i >= 0) {
      leg.hand.push(leg.deck.splice(i, 1)[0]);
      continue;
    }
    i = leg.discard.findIndex((c) => c.defId === d);
    if (i >= 0) {
      leg.hand.push(leg.discard.splice(i, 1)[0]);
      continue;
    }
    throw new Error(`no ${d} in the leg pool`);
  }
  return leg.hand;
}

/** Set the remaining score and the current visit's start score (only valid before the visit's first throw). */
export function setScore(n: NightState, score: number): void {
  const leg = currentLeg(n);
  leg.score = score;
  const v = currentVisit(leg);
  if (v.throws.length === 0) v.scoreAtVisitStart = score;
}

/** Force a one-card hand of `defId` and commit it. */
export function play(n: NightState, defId: string): { result: ThrowResult; events: EngineEvent[] } {
  const [c] = forceHand(n, [defId]);
  return commitCard(n, c.id);
}

/** Force and commit a sequence of cards; returns the last commit's output. */
export function playAll(n: NightState, defIds: string[]): { result: ThrowResult; events: EngineEvent[] } {
  let last: { result: ThrowResult; events: EngineEvent[] } | null = null;
  for (const d of defIds) last = play(n, d);
  if (!last) throw new Error('nothing played');
  return last;
}

export function eventTypes(events: EngineEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Multiset of def ids in a card list, as a sorted "defId×n" string for easy comparison. */
export function composition(cards: { defId: string }[]): string {
  const m = new Map<string, number>();
  for (const c of cards) m.set(c.defId, (m.get(c.defId) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}×${v}`)
    .join(' ');
}

// ---------------------------------------------------------------- scripted bot (determinism harness)

/**
 * The scripted bot: the highest-value card in hand that does not bust
 * (evaluated with forgiveness spent so a forgivable bust still reads as a
 * bust), else the first card. Never touches the night RNG.
 */
export function botPickCard(n: NightState, leg: LegState): DartCard {
  const visit = currentVisit(leg);
  let best: DartCard | null = null;
  let bestValue = -1;
  for (const c of leg.hand) {
    const r = resolveThrow(c, {
      chalk: n.chalk,
      rng: null,
      scoreBefore: leg.score,
      scoreAtVisitStart: visit.scoreAtVisitStart,
      visitThrowIndex: visit.throws.length as 0 | 1 | 2 | 3,
      forgivenessUsed: true,
    }).result;
    if (r.outcome !== 'BUST' && r.totalValue > bestValue) {
      best = c;
      bestValue = r.totalValue;
    }
  }
  return best ?? leg.hand[0];
}

/** In the shop: buy the first affordable card slot, then leave. */
export function botShop(n: NightState): void {
  const shop = n.shop;
  if (shop) {
    for (let i = 0; i < shop.slots.length; i++) {
      const s = shop.slots[i];
      if (s.kind === 'CARD' && !s.sold && n.pot >= s.cost) {
        shopBuy(n, i);
        break;
      }
    }
  }
  shopLeave(n);
}

/**
 * A checkout-aware variant used to reach the later legs: inside hint range it
 * plays the hand card that starts the shortest finishing route, else the
 * highest non-busting card that leaves a number the pool can still finish,
 * else the scripted pick. Still never touches the night RNG.
 */
export function smartPickCard(n: NightState, leg: LegState): DartCard {
  const visit = currentVisit(leg);
  const ti = visit.throws.length as 0 | 1 | 2 | 3;
  if (leg.score <= 170) {
    const hints = computeCheckoutHints(n, leg);
    let best: DartCard | null = null;
    let bestLen = Infinity;
    for (const c of leg.hand) {
      const r = hints.byHandCard.get(c.id);
      if (r && r.defIds.length < bestLen) {
        best = c;
        bestLen = r.defIds.length;
      }
    }
    if (best) return best;
  }
  let pick: DartCard | null = null;
  let pickV = -1;
  for (const c of leg.hand) {
    const r = resolveThrow(c, {
      chalk: n.chalk,
      rng: null,
      scoreBefore: leg.score,
      scoreAtVisitStart: visit.scoreAtVisitStart,
      visitThrowIndex: ti,
      forgivenessUsed: true,
    }).result;
    if (r.outcome !== 'CONTINUE' || r.scoreCommitted > 170 || r.totalValue <= pickV) continue;
    const fake: LegState = {
      ...leg,
      score: r.scoreCommitted,
      deck: [...leg.deck, ...leg.discard, ...leg.hand.filter((x) => x !== c)],
      hand: [],
      discard: [],
      visits: [{ index: 0, scoreAtVisitStart: 0, throws: new Array(ti + 1).fill(r) as ThrowResult[], busted: false }],
    };
    if (computeCheckoutHints(n, fake).best) {
      pick = c;
      pickV = r.totalValue;
    }
  }
  return pick ?? botPickCard(n, leg);
}

/** Smart shop: chalk if affordable (replacing the oldest when full), first affordable card, one refresh, another card, leave. */
export function smartShop(n: NightState): void {
  const buyFirstCard = () => {
    const shop = n.shop;
    if (!shop) return;
    for (let i = 0; i < shop.slots.length; i++) {
      const s = shop.slots[i];
      if (s.kind === 'CARD' && !s.sold && n.pot >= s.cost) {
        shopBuy(n, i);
        return;
      }
    }
  };
  const shop = n.shop;
  if (shop) {
    for (let i = 0; i < shop.slots.length; i++) {
      const s = shop.slots[i];
      if (s.kind === 'CHALK' && !s.sold && n.pot >= s.cost) {
        const full = n.chalk.length >= n.chalkSlots;
        shopBuy(n, i, full ? { replaceChalkId: n.chalk[0].def.id } : {});
      }
    }
    buyFirstCard();
    if (shopRefresh(n).ok) buyFirstCard();
  }
  shopLeave(n);
}

export interface DriveOpts {
  stopWhen?: (n: NightState) => boolean;
  smart?: boolean;
}

/** Drive a night (or a deserialised snapshot of one) to its end with a scripted bot. */
export function continueScripted(n: NightState, stopWhen?: (n: NightState) => boolean, smart = false): NightState {
  while (n.status === 'ACTIVE') {
    if (stopWhen && stopWhen(n)) break;
    if (n.phase === 'LEG') {
      const leg = currentLeg(n);
      if (leg.hand.length === 0) throw new Error('empty hand');
      commitCard(n, (smart ? smartPickCard : botPickCard)(n, leg).id);
    } else if (n.phase === 'SHOP') {
      if (smart) smartShop(n);
      else botShop(n);
    } else {
      break;
    }
  }
  return n;
}

/** Play a whole night from a seed with the scripted bot. */
export function playScripted(seed: number, oche: OcheId = 'local'): NightState {
  return continueScripted(startNight(seed, oche));
}

/** Play a whole night from a seed with the checkout-aware bot, optionally with starting chalk. */
export function playSmart(seed: number, chalk: string[] = [], oche: OcheId = 'local'): NightState {
  return continueScripted(startNight(seed, oche, chalk), undefined, true);
}
