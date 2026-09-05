/**
 * The night state machine (TDD §2, §4, §9). Pure functions over a mutable
 * NightState; every function returns the engine events it produced so the
 * UI and commentary can react. Headless: no imports from ui/art/audio.
 */
import { CHALK_DEFS, chalkDef } from '../content/chalkdefs';
import { SHOP_CARD_POOL, cardCost, cardDef, libraryFor, makeCard, sharpenedDefId } from '../content/cards';
import { DEFAULT_CHALK_SLOTS, HEAT_CAP, LEGS, LEG_COUNT, LIBRARY_FLOOR, SERVICE_COST, SETUP_BONUS, SETUP_BONUS_CAP, SHANGHAI_BONUS, SHANGHAI_NUMBERS, SHANGHAI_RANGE, SHOP_REFRESH_COST } from '../content/legs';
import { computeCheckoutHints } from './checkout';
import { discardHand, drawHand, takeFromHand } from './deck';
import { WALL_CARD_ID } from './board';
import { createRng, nextInt, pickWeighted, shuffle } from './rng';
import { resolveThrow, throwsPerVisitFor, visitHandSizeFor } from './resolver';
import { potReward } from './rules';
import type {
  Chalk,
  DartCard,
  EngineEvent,
  LegState,
  NightState,
  OcheId,
  ServiceKind,
  ShopSlot,
  ShopState,
  ThrowResult,
} from './types';

// ---------------------------------------------------------------- creation

export function createNight(seed: number, oche: OcheId = 'local'): NightState {
  const n: NightState = {
    seed: seed >>> 0,
    legIndex: 0,
    pot: 0,
    library: [],
    chalk: [],
    legs: [],
    status: 'ACTIVE',
    oche,
    phase: 'LEG',
    rng: createRng(seed),
    nextCardId: 1,
    nextChalkOrder: 1,
    chalkSlots: oche === 'wide' ? DEFAULT_CHALK_SLOTS + 1 : DEFAULT_CHALK_SLOTS,
    shop: null,
    stats: {
      oneEighties: 0,
      busts: 0,
      legsWon: 0,
      bestVisit: 0,
      bestCheckout: 0,
      nineDarters: 0,
      throwsMade: 0,
      visitsPlayed: 0,
      chalkFires: 0,
      potEarned: 0,
      potSpent: 0,
      cardsBought: 0,
      bigFinishes: 0,
      cleanLegs: 0,
      maxChalkHeld: 0,
      misses: 0,
      setups: 0,
      bestHeat: 0,
      shanghais: 0,
      bestStreak: 0,
    },
    achievements: [],
    consecutiveBusts: 0,
    shanghaiNumbers: [],
    streak: 0,
  };
  for (const [defId, copies] of libraryFor(oche)) {
    for (let i = 0; i < copies; i++) n.library.push(newCard(n, defId));
  }
  // Every leg's Shanghai number is called up front, in a fixed place in the
  // RNG order, from all five numbers, so no library can be tuned to one of
  // them. The shop before each leg sells a piece of the next number.
  for (let i = 0; i < LEG_COUNT; i++) n.shanghaiNumbers.push(SHANGHAI_NUMBERS[nextInt(n.rng, SHANGHAI_NUMBERS.length)]);
  if (oche === 'steady') addChalk(n, 'forgiving_oche');
  return n;
}

export function newCard(n: NightState, defId: string): DartCard {
  const id = `c${n.nextCardId}`;
  const flight = ((n.nextCardId - 1) % 4) as 0 | 1 | 2 | 3;
  n.nextCardId++;
  return makeCard(defId, id, flight);
}

export function addChalk(n: NightState, id: string): Chalk {
  const c: Chalk = { def: chalkDef(id), order: n.nextChalkOrder++ };
  n.chalk.push(c);
  n.stats.maxChalkHeld = Math.max(n.stats.maxChalkHeld, n.chalk.length);
  return c;
}

export function hasChalk(n: NightState, id: string): boolean {
  return n.chalk.some((c) => c.def.id === id);
}

export function currentLeg(n: NightState): LegState {
  return n.legs[n.legs.length - 1];
}

export function currentVisit(leg: LegState) {
  return leg.visits[leg.visits.length - 1];
}

export function legName(index: number): string {
  return LEGS[index]?.name ?? `Leg ${index + 1}`;
}

/** Cards dealt at the start of a visit, spent across its darts. */
export function visitHandSize(n: NightState): number {
  return visitHandSizeFor(n.chalk);
}

export function throwsPerVisit(n: NightState): number {
  return throwsPerVisitFor(n.chalk);
}

// ---------------------------------------------------------------- legs

/** Start the leg at n.legIndex: fresh shuffled deck from the library, first visit, first hand. */
export function beginLeg(n: NightState): EngineEvent[] {
  if (n.status !== 'ACTIVE') throw new Error('night is over');
  const def = LEGS[n.legIndex];
  const leg: LegState = {
    index: n.legIndex,
    visitLimit: def.visitLimit,
    score: def.start,
    visits: [],
    deck: shuffle(n.rng, n.library.map((c) => ({ ...c, target: { ...c.target } }))),
    discard: [],
    hand: [],
    bustsThisLeg: 0,
    forgivenessUsed: false,
    status: 'ACTIVE',
    peek: [],
    pocket: null,
    heat: 0,
    setupBonuses: 0,
    shanghai: n.shanghaiNumbers[n.legIndex] ?? SHANGHAI_NUMBERS[0],
    dirty: false,
  };
  n.legs.push(leg);
  n.phase = 'LEG';
  n.shop = null;
  const events: EngineEvent[] = [{ type: 'LEG_START', legIndex: n.legIndex }];
  events.push(...startVisit(n, leg));
  return events;
}

function startVisit(n: NightState, leg: LegState): EngineEvent[] {
  leg.visits.push({ index: leg.visits.length, scoreAtVisitStart: leg.score, throws: [], busted: false });
  n.stats.visitsPlayed++;
  // chalked_up: peek at the top 3 cards of the deck at the start of each visit.
  leg.peek = hasChalk(n, 'chalked_up') ? leg.deck.slice(0, 3).map((c) => c.id) : [];
  return deal(n, leg);
}

/**
 * One hand per VISIT, not per dart: the cards are a resource spent across the
 * visit's throws, so taking the big number early is a real cost later.
 */
function deal(n: NightState, leg: LegState): EngineEvent[] {
  const visit = currentVisit(leg);
  drawHand(leg, n.rng, visitHandSize(n));
  // The pocketed card comes back out every visit until it is thrown: keeping
  // it is what lets you plan a finish several visits ahead.
  if (leg.pocket) leg.hand.push(leg.pocket);
  return [{ type: 'HAND_DEALT', hand: leg.hand.slice(), visitIndex: visit.index, throwIndex: visit.throws.length }];
}

/**
 * Set one card aside for a later visit. Free, but the pocket holds one card,
 * so choosing what to keep is the decision. Returns false if it cannot be done.
 */
export function pocketCard(n: NightState, cardId: string): { ok: boolean; events: EngineEvent[] } {
  if (n.status !== 'ACTIVE' || n.phase !== 'LEG') return { ok: false, events: [] };
  const leg = currentLeg(n);
  if (leg.status !== 'ACTIVE' || leg.pocket) return { ok: false, events: [] };
  const i = leg.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return { ok: false, events: [] };
  const card = leg.hand[i];
  leg.pocket = card;
  return { ok: true, events: [{ type: 'POCKETED', card }] };
}

/** Take the card back out of the pocket and leave it in the hand for this visit. */
export function unpocketCard(n: NightState): boolean {
  const leg = currentLeg(n);
  if (!leg || !leg.pocket) return false;
  leg.pocket = null;
  return true;
}

/**
 * The player commits one card from the hand. Resolves the throw, applies the
 * outcome, advances visit/leg/night, and returns the result plus events.
 */
export function commitCard(n: NightState, cardId: string): { result: ThrowResult; events: EngineEvent[] } {
  if (n.status !== 'ACTIVE' || n.phase !== 'LEG') throw new Error('not in a leg');
  const leg = currentLeg(n);
  if (leg.status !== 'ACTIVE') throw new Error('leg is over');
  const visit = currentVisit(leg);
  const throwIndex = visit.throws.length as 0 | 1 | 2 | 3;
  let card: DartCard | null;
  const missed = cardId === WALL_CARD_ID;
  if (missed) {
    // Deliberate miss: the dart goes into the wall and the visit ends there.
    card = { id: WALL_CARD_ID, defId: WALL_CARD_ID, target: { region: 'W' }, flight: 0 };
    n.stats.misses++;
  } else {
    card = takeFromHand(leg, cardId);
    if (card && leg.pocket && leg.pocket.id === card.id) leg.pocket = null;
  }
  if (!card) throw new Error(`card ${cardId} not in hand`);

  const { result, forgivenessConsumed } = resolveThrow(card, {
    chalk: n.chalk,
    rng: n.rng,
    scoreBefore: leg.score,
    scoreAtVisitStart: visit.scoreAtVisitStart,
    visitThrowIndex: throwIndex,
    forgivenessUsed: leg.forgivenessUsed,
  });
  if (forgivenessConsumed) leg.forgivenessUsed = true;

  // Shanghai: single, double and treble of the called number in one visit.
  // Inside checkout range it wins the leg outright, whatever the arithmetic
  // says — even off a dart that would otherwise have bust — so it is checked
  // before the outcome. Above range it pays the bonus and the leg goes on.
  const trio = !missed && completesShanghai(visit.throws, result, leg.shanghai);
  const trioWins = trio && visit.scoreAtVisitStart <= SHANGHAI_RANGE;
  if (trioWins) {
    result.shanghai = true;
    result.outcome = 'CHECKOUT';
    result.scoreAfter = 0;
    result.scoreCommitted = 0;
    result.forgiven = false;
  }

  visit.throws.push(result);
  n.stats.throwsMade++;
  n.stats.chalkFires += result.firedChalk.length;
  leg.score = result.scoreCommitted;

  const events: EngineEvent[] = [{ type: 'THROW', result }];
  const perVisit = throwsPerVisit(n);

  if (trio && !trioWins && result.outcome !== 'BUST') {
    // A trio in the scoring phase: the crowd pays, the board does not.
    n.pot += SHANGHAI_BONUS;
    n.stats.potEarned += SHANGHAI_BONUS;
    n.stats.shanghais++;
    events.push({ type: 'SHANGHAI', number: leg.shanghai, total: visitTotal(visit), won: false, pot: SHANGHAI_BONUS });
  }

  if (result.outcome === 'CHECKOUT') {
    visit.busted = false;
    leg.heat = Math.min(HEAT_CAP, leg.heat + 1);
    n.stats.bestHeat = Math.max(n.stats.bestHeat, leg.heat);
    if (result.shanghai) {
      n.stats.shanghais++;
      events.push({ type: 'SHANGHAI', number: leg.shanghai, total: visitTotal(visit), won: true, pot: SHANGHAI_BONUS });
    }
    endVisit(n, leg, visit, events, false);
    leg.status = 'CHECKED_OUT';
    n.stats.legsWon++;
    n.consecutiveBusts = 0;
    // The clean sheet: this leg counts only if nothing dirtied it.
    n.streak = leg.dirty ? 0 : n.streak + 1;
    n.stats.bestStreak = Math.max(n.stats.bestStreak, n.streak);
    const reward = leg.index === LEG_COUNT - 1 ? null : potReward(leg, n.streak);
    // A Shanghai is not a checkout: the folk stats and the unlocks that read
    // "a 100+ checkout" and "a leg in six" are about the arithmetic.
    const checkoutFrom = result.shanghai ? 0 : visit.scoreAtVisitStart;
    n.stats.bestCheckout = Math.max(n.stats.bestCheckout, checkoutFrom);
    if (reward) {
      leg.reward = reward;
      n.pot += reward.total;
      n.stats.potEarned += reward.total;
      if (reward.bigFinish) n.stats.bigFinishes++;
      if (reward.cleanLeg) n.stats.cleanLegs++;
      if (reward.nineDarter) n.stats.nineDarters++;
    } else {
      // Last leg: still track the folk stats.
      if (leg.visits.length === 3 && startedLong(leg) && !result.shanghai) n.stats.nineDarters++;
      if (checkoutFrom >= 100) n.stats.bigFinishes++;
      if (leg.bustsThisLeg === 0) n.stats.cleanLegs++;
    }
    events.push({ type: 'CHECKOUT', legIndex: leg.index, reward });
    if (checkoutFrom >= 100) achieve(n, 'sharp', events);
    if (leg.visits.length <= 6 && startedLong(leg)) achieve(n, 'thin', events);

    if (leg.index === LEG_COUNT - 1) {
      n.status = 'WON';
      n.phase = 'OVER';
      if (n.stats.busts === 0) achieve(n, 'steady', events);
      events.push({ type: 'NIGHT_WON' });
    } else {
      n.phase = 'SHOP';
      n.shop = generateShop(n, leg.index);
      events.push({ type: 'SHOP_OPEN', shop: n.shop });
    }
    return { result, events };
  }

  if (result.outcome === 'BUST') {
    visit.busted = true;
    leg.bustsThisLeg++;
    n.stats.busts++;
    n.consecutiveBusts++;
    // A bust wipes the crowd: this is what makes the big score a gamble.
    if (leg.heat > 0) {
      events.push({ type: 'HEAT_LOST', from: leg.heat, reason: 'BUST' });
      leg.heat = 0;
    }
    // Cheap Chalk's bust-to-2 is a line the chalk exists for: the sheet forgives it.
    if (!result.firedChalk.includes('cheap_chalk')) dirtyLeg(n, leg, events);
    endVisit(n, leg, visit, events, false);
    if (leg.visits.length >= leg.visitLimit) timeOut(n, leg, events);
    else events.push(...startVisit(n, leg));
    return { result, events };
  }

  // A forgiven bust never happened on the board, but the crowd saw the dart.
  if (result.forgiven && leg.heat > 0) {
    events.push({ type: 'HEAT_LOST', from: leg.heat, reason: 'BUST' });
    leg.heat = 0;
  }

  // CONTINUE — the visit ends when the darts run out, or on a deliberate miss.
  if (missed || visit.throws.length >= perVisit) {
    n.consecutiveBusts = 0;
    if (missed) {
      // The wall saves the score and the clean sheet, nothing else: the crowd
      // goes cold. Cash it first if you are going to walk.
      if (leg.heat > 0) {
        events.push({ type: 'HEAT_LOST', from: leg.heat, reason: 'MISS' });
        leg.heat = 0;
      }
    } else if (!visit.throws.some((t) => t.forgiven)) {
      // A visit the crowd watched a dart get forgiven in does not warm them.
      leg.heat = Math.min(HEAT_CAP, leg.heat + 1);
    }
    n.stats.bestHeat = Math.max(n.stats.bestHeat, leg.heat);
    awardSetupBonus(n, leg, events);
    endVisit(n, leg, visit, events, missed);
    if (leg.visits.length >= leg.visitLimit) timeOut(n, leg, events);
    else events.push(...startVisit(n, leg));
  }
  return { result, events };
}

/**
 * True if `result`, added to the visit's previous throws, gives a single, a
 * double and a treble of the called number. Only each throw's primary hit
 * counts (a split-tips echo is not a dart), a forgiven dart never happened,
 * bulls never qualify, and the resolved bed is what matters, so Mirrored and
 * Narrow Beds play into it.
 */
export function completesShanghai(previous: ThrowResult[], result: ThrowResult, number: number): boolean {
  const seen = new Set<string>();
  for (const t of [...previous, result]) {
    if (t.miss || t.forgiven) continue;
    const hit = t.hits[0];
    if (!hit || hit.target.bed !== number) continue;
    if (hit.target.region === 'S' || hit.target.region === 'D' || hit.target.region === 'T') seen.add(hit.target.region);
  }
  return seen.size === 3;
}

/** Which of S, D and T of the leg's number the current visit has already hit. */
export function shanghaiProgress(leg: LegState): Set<'S' | 'D' | 'T'> {
  const seen = new Set<'S' | 'D' | 'T'>();
  const visit = leg.visits[leg.visits.length - 1];
  if (!visit) return seen;
  for (const t of visit.throws) {
    if (t.miss || t.forgiven) continue;
    const hit = t.hits[0];
    if (!hit || hit.target.bed !== leg.shanghai) continue;
    if (hit.target.region === 'S' || hit.target.region === 'D' || hit.target.region === 'T') seen.add(hit.target.region);
  }
  return seen;
}

/** A leg that began at the full 501 or more: the nine-darter and "a leg in six" are about that game. */
export function startedLong(leg: LegState): boolean {
  const first = leg.visits[0];
  return LEGS[leg.index].start >= 501 || (!!first && first.scoreAtVisitStart >= 501);
}

/** A bust takes the leg off the clean sheet. */
function dirtyLeg(n: NightState, leg: LegState, events: EngineEvent[]): void {
  if (leg.dirty) return;
  leg.dirty = true;
  if (n.streak > 0) {
    events.push({ type: 'STREAK_LOST', from: n.streak });
    n.streak = 0;
  }
}

/**
 * "Left it right": paid the moment a visit ends on a score the deck can
 * actually finish. This is the tactical counterweight to heat — the biggest
 * number is not always the one that leaves you somewhere useful.
 */
function awardSetupBonus(n: NightState, leg: LegState, events: EngineEvent[]): void {
  if (leg.score <= 0 || leg.setupBonuses >= SETUP_BONUS_CAP) return;
  let route = null;
  try {
    route = computeCheckoutHints(n, leg).best;
  } catch {
    route = null;
  }
  if (!route) return;
  leg.setupBonuses += SETUP_BONUS;
  n.stats.setups++;
  events.push({ type: 'SETUP_BONUS', score: leg.score, pot: SETUP_BONUS });
}

function endVisit(n: NightState, leg: LegState, visit: LegState['visits'][number], events: EngineEvent[], missed: boolean): void {
  // Unspent cards go back where the chalk says — except the pocketed one,
  // which is being kept on purpose.
  if (leg.pocket) leg.hand = leg.hand.filter((c) => c.id !== leg.pocket?.id);
  discardHand(leg, hasChalk(n, 'practice_board'));
  const total = visitTotal(visit);
  if (!visit.busted) {
    n.stats.bestVisit = Math.max(n.stats.bestVisit, total);
    if (total >= 180) {
      n.stats.oneEighties++;
    }
  }
  events.push({ type: 'VISIT_END', visit, total, busted: visit.busted, missed, heat: leg.heat });
  if (!visit.busted && total >= 180) events.push({ type: 'ONE_EIGHTY', total });
}

function timeOut(n: NightState, leg: LegState, events: EngineEvent[]): void {
  leg.status = 'TIMED_OUT';
  n.status = 'LOST';
  n.phase = 'OVER';
  events.push({ type: 'LEG_TIMEOUT', legIndex: leg.index });
  events.push({ type: 'NIGHT_LOST' });
}

/** Throw the dart at the wall on purpose: scores nothing, spends the dart and the hand. */
export function commitMiss(n: NightState): { result: ThrowResult; events: EngineEvent[] } {
  return commitCard(n, WALL_CARD_ID);
}

/** Sum of a visit's committed values (0 if the visit busted, in the darts sense). */
export function visitTotal(visit: LegState['visits'][number]): number {
  if (visit.busted) return 0;
  return visit.throws.reduce((a, t) => a + (t.forgiven ? 0 : t.totalValue), 0);
}

function achieve(n: NightState, oche: OcheId, events: EngineEvent[]): void {
  if (n.achievements.includes(oche)) return;
  n.achievements.push(oche);
  events.push({ type: 'ACHIEVEMENT', oche });
}

// ---------------------------------------------------------------- shop

export function cardPrice(n: NightState, defId: string): number {
  return cardCost(defId) + (n.oche === 'wide' ? 2 : 0);
}

/**
 * The bin comes up most often on purpose: the starting library is deliberately
 * bloated with filler, and thinning it is the strongest thing the pot can buy
 * (docs/decisions/balance.md), so the shop has to offer the chance regularly.
 */
function rollService(n: NightState): ServiceKind {
  const kinds: ServiceKind[] = ['REMOVE', 'DUPLICATE', 'SHARPEN'];
  return pickWeighted(n.rng, kinds, [3, 1, 2]);
}

function rollCardOffer(n: NightState): string {
  const ids = SHOP_CARD_POOL.map((x) => x[0]);
  const ws = SHOP_CARD_POOL.map((x) => x[1]);
  return pickWeighted(n.rng, ids, ws);
}

function rollChalkOffer(n: NightState): string | null {
  const available = CHALK_DEFS.filter((d) => !hasChalk(n, d.id));
  if (available.length === 0) return null;
  return available[nextInt(n.rng, available.length)].id;
}

/** Shop generation consumes the gameplay RNG in a fixed order: card, card, chalk, service. */
export function generateShop(n: NightState, afterLeg: number): ShopState {
  const slots: ShopSlot[] = [];
  const c1 = rollCardOffer(n);
  const rolled = rollCardOffer(n);
  // The second card is always a piece of the next leg's Shanghai number — the
  // region the library holds fewest of — so the hunt is something you can buy
  // toward. The roll is still consumed, so the RNG order does not move.
  const c2 = shanghaiPieceOffer(n, afterLeg + 1) ?? rolled;
  slots.push({ kind: 'CARD', defId: c1, cost: cardPrice(n, c1), sold: false });
  slots.push({ kind: 'CARD', defId: c2, cost: cardPrice(n, c2), sold: false });
  const ch = rollChalkOffer(n);
  if (ch) slots.push({ kind: 'CHALK', chalkId: ch, cost: chalkDef(ch).cost, sold: false });
  const s = rollService(n);
  slots.push({ kind: 'SERVICE', service: s, cost: SERVICE_COST[s], sold: false });
  return { slots, refreshed: false, afterLeg };
}

/** The def id of the single, double or treble of the next leg's number the library has fewest of. */
export function shanghaiPieceOffer(n: NightState, legIndex: number): string | null {
  const num = n.shanghaiNumbers[legIndex];
  if (num === undefined) return null;
  let best: 'S' | 'D' | 'T' = 'S';
  let fewest = Infinity;
  for (const reg of ['D', 'T', 'S'] as const) {
    const copies = n.library.filter((c) => c.target.bed === num && c.target.region === reg).length;
    if (copies < fewest) {
      fewest = copies;
      best = reg;
    }
  }
  return `${best.toLowerCase()}${num}`;
}

export interface BuyOptions {
  /** For services: which library card to act on. */
  cardId?: string;
  /** For a chalk purchase when slots are full: which held chalk to discard. */
  replaceChalkId?: string;
}

export interface BuyOutcome {
  ok: boolean;
  reason?: string;
  events: EngineEvent[];
}

export function canAfford(n: NightState, cost: number): boolean {
  return n.pot >= cost;
}

export function shopBuy(n: NightState, slotIndex: number, opts: BuyOptions = {}): BuyOutcome {
  if (n.phase !== 'SHOP' || !n.shop) return { ok: false, reason: 'not in shop', events: [] };
  const slot = n.shop.slots[slotIndex];
  if (!slot) return { ok: false, reason: 'no such slot', events: [] };
  if (slot.sold) return { ok: false, reason: 'already sold', events: [] };
  if (n.pot < slot.cost) return { ok: false, reason: 'not enough pot', events: [] };
  const events: EngineEvent[] = [];
  // The bin stays open: thinning is the pot's best sink, and one card a shop
  // is not enough to dig a bloated library out on any sensible schedule.
  let repeatable = false;

  switch (slot.kind) {
    case 'CARD': {
      n.library.push(newCard(n, slot.defId));
      n.stats.cardsBought++;
      break;
    }
    case 'CHALK': {
      if (hasChalk(n, slot.chalkId)) return { ok: false, reason: 'already held', events: [] };
      if (n.chalk.length >= n.chalkSlots) {
        if (!opts.replaceChalkId) return { ok: false, reason: 'chalk slots full', events: [] };
        const i = n.chalk.findIndex((c) => c.def.id === opts.replaceChalkId);
        if (i < 0) return { ok: false, reason: 'no such chalk to replace', events: [] };
        n.chalk.splice(i, 1);
      }
      addChalk(n, slot.chalkId);
      if (n.chalk.length >= 5) achieve(n, 'wide', events);
      break;
    }
    case 'SERVICE': {
      const card = n.library.find((c) => c.id === opts.cardId);
      if (!card) return { ok: false, reason: 'choose a card', events: [] };
      if (slot.service === 'REMOVE') {
        if (n.library.length <= LIBRARY_FLOOR) return { ok: false, reason: 'library too small', events: [] };
        n.library = n.library.filter((c) => c.id !== card.id);
        repeatable = true;
      } else if (slot.service === 'DUPLICATE') {
        n.library.push(newCard(n, card.defId));
      } else {
        const up = sharpenedDefId(card.defId);
        if (!up) return { ok: false, reason: 'cannot sharpen', events: [] };
        const fresh = cardDef(up);
        card.defId = fresh.id;
        card.target = { ...fresh.target };
      }
      break;
    }
  }
  n.pot -= slot.cost;
  n.stats.potSpent += slot.cost;
  slot.sold = !repeatable;
  events.push({ type: 'SHOP_BUY', slot });
  return { ok: true, events };
}

export function shopRefresh(n: NightState): BuyOutcome {
  if (n.phase !== 'SHOP' || !n.shop) return { ok: false, reason: 'not in shop', events: [] };
  if (n.shop.refreshed) return { ok: false, reason: 'already refreshed', events: [] };
  if (n.pot < SHOP_REFRESH_COST) return { ok: false, reason: 'not enough pot', events: [] };
  n.pot -= SHOP_REFRESH_COST;
  n.stats.potSpent += SHOP_REFRESH_COST;
  const after = n.shop.afterLeg;
  n.shop = generateShop(n, after);
  n.shop.refreshed = true;
  return { ok: true, events: [{ type: 'SHOP_REFRESH' }] };
}

/** Leave the shop and begin the next leg. */
export function shopLeave(n: NightState): EngineEvent[] {
  if (n.phase !== 'SHOP') throw new Error('not in shop');
  n.legIndex++;
  return beginLeg(n);
}

/** Remove a card from the library outside the shop (unused in v1 UI; here for tools). */
export function libraryCounts(n: NightState): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of n.library) m.set(c.defId, (m.get(c.defId) ?? 0) + 1);
  return m;
}

// ---------------------------------------------------------------- serialisation

/** Stable JSON of the night for determinism tests and saves. */
export function serialiseNight(n: NightState): string {
  return JSON.stringify(n);
}

export function deserialiseNight(json: string): NightState {
  return JSON.parse(json) as NightState;
}
