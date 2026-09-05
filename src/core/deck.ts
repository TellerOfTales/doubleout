import { shuffle } from './rng';
import type { DartCard, LegState, Rng } from './types';

/**
 * Deck handling (TDD §3.3). The leg deck is a shuffled copy of the library.
 * Cards drawn go to the hand; the committed card and the uncommitted cards
 * go to the discard pile (or, with practice_board, the uncommitted cards go
 * back under the deck). When the deck runs short the discard pile is
 * shuffled back in.
 */

/** Draw `n` cards into the hand, reshuffling the discard pile if the deck is short. */
export function drawHand(leg: LegState, rng: Rng, n: number): DartCard[] {
  const hand: DartCard[] = [];
  while (hand.length < n) {
    if (leg.deck.length === 0) {
      if (leg.discard.length === 0) break; // deck exhausted entirely (tiny library) — deal what we have
      leg.deck = shuffle(rng, leg.discard);
      leg.discard = [];
    }
    hand.push(leg.deck.shift() as DartCard);
  }
  leg.hand = hand;
  return hand;
}

/**
 * Take one card out of the hand and discard it, leaving the rest of the hand
 * in place for the remaining darts of the visit. Returns null if not in hand.
 */
export function takeFromHand(leg: LegState, cardId: string): DartCard | null {
  const i = leg.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return null;
  const card = leg.hand.splice(i, 1)[0];
  leg.discard.push(card);
  return card;
}

/**
 * Remove the committed card from the hand; route the rest.
 * Returns the committed card or null if the id is not in hand.
 */
export function commitFromHand(leg: LegState, cardId: string, practiceBoard: boolean): DartCard | null {
  const i = leg.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return null;
  const card = leg.hand[i];
  const rest = leg.hand.filter((_, j) => j !== i);
  leg.hand = [];
  leg.discard.push(card);
  if (practiceBoard) leg.deck.push(...rest);
  else leg.discard.push(...rest);
  return card;
}

/** A deliberate miss: every card in the hand is routed as uncommitted. */
export function discardHand(leg: LegState, practiceBoard: boolean): void {
  const rest = leg.hand;
  leg.hand = [];
  if (practiceBoard) leg.deck.push(...rest);
  else leg.discard.push(...rest);
}

/** The whole card pool available during this leg (deck + hand + discard). */
export function legPool(leg: LegState): DartCard[] {
  return [...leg.deck, ...leg.hand, ...leg.discard];
}
