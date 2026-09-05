import type { ChalkDef, ChalkStage } from '../core/types';

/**
 * Chalk definitions (TDD §5). Blurbs are ≤ 64 characters and read at 5×7
 * over two lines. Order within a stage is the player's acquisition order,
 * not the order here.
 */
export const CHALK_DEFS: ChalkDef[] = [
  // ---- VALUE ----
  { id: 'hot_twenty', name: 'Hot Twenty', stage: 'VALUE', cost: 6, blurb: 'Trebles in the 20 bed score x4 instead of x3.' },
  { id: 'feathered', name: 'Feathered', stage: 'VALUE', cost: 7, blurb: 'Doubles score x3. They still count as doubles to finish.' },
  { id: 'heavy_tips', name: 'Heavy Tips', stage: 'VALUE', cost: 5, blurb: '+5 to every throw you make.' },
  { id: 'oiled', name: 'Oiled', stage: 'VALUE', cost: 6, blurb: 'Odd-numbered beds score +50% (rounded down).' },
  { id: 'even_keel', name: 'Even Keel', stage: 'VALUE', cost: 6, blurb: 'Even-numbered beds score +50% (rounded down).' },
  { id: 'cold_hands', name: 'Cold Hands', stage: 'VALUE', cost: 6, blurb: 'First dart of a visit scores 0. Second and third score x2.' },
  { id: 'last_orders', name: 'Last Orders', stage: 'VALUE', cost: 7, blurb: 'Third dart of every visit scores x2.' },
  { id: 'bullish', name: 'Bullish', stage: 'VALUE', cost: 5, blurb: 'Both bulls score 75.' },
  // ---- BOARD ----
  { id: 'wired', name: 'Wired', stage: 'BOARD', cost: 4, blurb: '1 in 4 darts drops into the next bed clockwise. Same ring.' },
  { id: 'split_tips', name: 'Split Tips', stage: 'BOARD', cost: 8, blurb: 'Every dart also hits the bed anticlockwise as a single.' },
  { id: 'magnetised', name: 'Magnetised', stage: 'BOARD', cost: 6, blurb: 'Any dart worth under 10 is pulled into single 20.' },
  { id: 'narrow_beds', name: 'Narrow Beds', stage: 'BOARD', cost: 7, blurb: 'Singles become trebles. Trebles become singles.' },
  { id: 'wide_doubles', name: 'Wide Doubles', stage: 'BOARD', cost: 9, blurb: 'Anything in the 16, 18 or 20 bed counts as a double.' },
  { id: 'mirrored', name: 'Mirrored', stage: 'BOARD', cost: 5, blurb: 'Darts land in the bed directly opposite.' },
  // ---- RULE ----
  { id: 'cheap_chalk', name: 'Cheap Chalk', stage: 'RULE', cost: 8, blurb: 'A bust drops your score to 2 instead of putting it back.' },
  { id: 'forgiving_oche', name: 'Forgiving Oche', stage: 'RULE', cost: 7, blurb: 'The first bust of each leg never happened.' },
  { id: 'straight_out', name: 'Straight Out', stage: 'RULE', cost: 10, blurb: 'You no longer need a double to finish.' },
  { id: 'overshoot', name: 'Overshoot', stage: 'RULE', cost: 12, blurb: 'A finishing double may go 1 or 2 below zero and still count.' },
  { id: 'chalk_dust', name: 'Chalk Dust', stage: 'RULE', cost: 4, blurb: 'Landing on 1 is legal. It is treated as 2.' },
  // ---- DEAL ----
  { id: 'wide_grip', name: 'Wide Grip', stage: 'DEAL', cost: 8, blurb: 'Deal one extra card at the start of every visit.' },
  { id: 'tunnel_vision', name: 'Tunnel Vision', stage: 'DEAL', cost: 6, blurb: 'Deal one card fewer each visit, but every throw scores +20%.' },
  { id: 'fourth_dart', name: 'Fourth Dart', stage: 'DEAL', cost: 12, blurb: 'Four darts per visit instead of three.' },
  { id: 'practice_board', name: 'Practice Board', stage: 'DEAL', cost: 5, blurb: 'Cards you do not throw go back under the deck, not the bin.' },
  { id: 'chalked_up', name: 'Chalked Up', stage: 'DEAL', cost: 4, blurb: 'See the next 3 cards of the deck at the start of each visit.' },
];

export const CHALK_BY_ID: Record<string, ChalkDef> = Object.fromEntries(CHALK_DEFS.map((c) => [c.id, c]));

export const STAGE_ORDER: ChalkStage[] = ['DEAL', 'BOARD', 'VALUE', 'RULE'];

export function chalkDef(id: string): ChalkDef {
  const d = CHALK_BY_ID[id];
  if (!d) throw new Error(`unknown chalk: ${id}`);
  return d;
}
