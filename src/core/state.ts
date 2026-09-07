/**
 * The night state machine (TDD §2, §4, §9). Pure functions over a mutable
 * NightState; every function returns the engine events it produced so the UI
 * and commentary can react. Headless: no imports from ui/art/audio.
 *
 * The shape of a visit, after the rebuild (docs/decisions/design.md §5):
 *
 *   1. Three contracts are chalked up. Take any of them, staking Pot.
 *   2. Aim anywhere on the board. Throw.
 *   3. A contract pays the moment it lands, straight into the Pot. Between
 *      darts you may PULL out of one that has not landed, for half the stake
 *      back, or PRESS one that has, putting double the stake on something
 *      harder with whatever darts are left.
 *   4. A bust, or a dart that finishes off the board, takes everything that
 *      has not landed yet.
 *
 * That last clause is the whole engine of the thing. Money already won is
 * safe; money still chasing is not, and the press is how you choose to put it
 * back at risk.
 */
import { CHALK_DEFS, chalkDef } from '../content/chalkdefs';
import { KIT_CAP, KIT_POOL, STARTING_KIT, interventionDef } from '../content/interventions';
import {
  ANOTHER_GO_CAP,
  anotherGoCost,
  DEFAULT_CHALK_SLOTS,
  HEAT_CAP,
  LEGS,
  LEG_COUNT,
  PULL_RETURN,
  SERVICE_COST,
  SHOP_REFRESH_COST,
  SLATE_SIZE,
  STARTING_POT,
} from '../content/legs';
import { CONTRACTS, contractDef, priceOf, pressStake, pullValue } from './slate';
import type { VisitProgress } from './slate';
import { STEADY_PER_HEAT, resolveThrow, throwsPerVisitFor } from './resolver';
import { createRng, nextInt, pickWeighted, shuffle } from './rng';
import { potReward } from './rules';
import type {
  Chalk,
  ContractOutcome,
  EngineEvent,
  LegState,
  NightState,
  OcheId,
  ServiceKind,
  ShopSlot,
  ShopState,
  TakenContract,
  Target,
  ThrowResult,
} from './types';

// ---------------------------------------------------------------- creation

export function createNight(seed: number, oche: OcheId = 'local', opts: { trueAim?: boolean } = {}): NightState {
  const n: NightState = {
    seed: seed >>> 0,
    legIndex: 0,
    pot: STARTING_POT + (oche === 'wide' ? 4 : 0),
    kit: STARTING_KIT.slice(),
    paid: {},
    extraVisits: 0,
    chalk: [],
    legs: [],
    status: 'ACTIVE',
    oche,
    phase: 'LEG',
    rng: createRng(seed),
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
      kitBought: 0,
      contractsTaken: 0,
      contractsPaid: 0,
      contractsPressed: 0,
      potStaked: 0,
      potWon: 0,
      bestPayout: 0,
      slatesWiped: 0,
      bigFinishes: 0,
      cleanLegs: 0,
      maxChalkHeld: 0,
      misses: 0,
      bestHeat: 0,
      bestStreak: 0,
    },
    achievements: [],
    consecutiveBusts: 0,
    streak: 0,
    trueAim: !!opts.trueAim,
  };
  if (oche === 'sharp') n.kit.push('doubled');
  if (oche === 'thin') n.kit.push('again', 'rubout');
  if (oche === 'steady') addChalk(n, 'forgiving_oche');
  return n;
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

export function throwsPerVisit(n: NightState): number {
  return throwsPerVisitFor(n.chalk);
}

/** Contracts chalked up each visit. Wide Grip adds one, Tunnel Vision takes one away. */
export function slateSize(n: NightState): number {
  let size = SLATE_SIZE;
  if (hasChalk(n, 'wide_grip')) size += 1;
  if (hasChalk(n, 'tunnel_vision')) size -= 1;
  return Math.max(1, size);
}

// ---------------------------------------------------------------- legs

export function beginLeg(n: NightState): EngineEvent[] {
  if (n.status !== 'ACTIVE') throw new Error('night is over');
  const def = LEGS[n.legIndex];
  const leg: LegState = {
    index: n.legIndex,
    // Visits bought from the publican are spent here, on this leg, once.
    visitLimit: def.visitLimit + n.extraVisits,
    score: def.start,
    visits: [],
    bustsThisLeg: 0,
    forgivenessUsed: false,
    status: 'ACTIVE',
    offer: [],
    nextOffer: [],
    slate: [],
    ledger: [],
    heat: 0,
    dirty: false,
  };
  n.extraVisits = 0;
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
  leg.slate = [];
  // Chalked Up showed you this offer a visit early; honour it rather than
  // rolling a fresh one, or the chalk would be a lie.
  leg.offer = leg.nextOffer.length ? leg.nextOffer : rollOffer(n, leg);
  leg.nextOffer = hasChalk(n, 'chalked_up') ? rollOffer(n, leg) : [];
  return [{ type: 'SLATE_OFFERED', offer: leg.offer.slice(), visitIndex: currentVisit(leg).index }];
}

// ---------------------------------------------------------------- the slate

/** What the contracts can see: the visit so far. */
export function visitProgress(n: NightState, leg: LegState, checkedOut = leg.status === 'CHECKED_OUT'): VisitProgress {
  const visit = currentVisit(leg);
  const values: number[] = [];
  const hits: (Target | null)[] = [];
  for (const t of visit.throws) {
    // A forgiven dart never happened ON THE BOARD, but it happened. Recording
    // it as a nothing keeps `values` the same length as the darts thrown, so
    // every contract that asks about "all three" still means all three — and
    // it makes the price of Forgiving Oche legible: it saves your score, not
    // your slate.
    if (t.forgiven) {
      values.push(0);
      hits.push(null);
      continue;
    }
    values.push(t.totalValue);
    hits.push(t.hits[0] ? { ...t.hits[0].target } : null);
  }
  return {
    values,
    hits,
    left: Math.max(0, throwsPerVisit(n) - visit.throws.length),
    from: visit.scoreAtVisitStart,
    now: leg.score,
    busted: visit.busted,
    checkedOut,
  };
}

/**
 * Three contracts, drawn so they pull in different directions. Anything that
 * is already impossible from this position (a GAME SHOT at 400 left) is never
 * offered — a dead contract on the slate is exactly the dead card the deck
 * used to deal, and the point of the rebuild is that there are none.
 */
function rollOffer(n: NightState, leg: LegState): string[] {
  const progress: VisitProgress = {
    values: [],
    hits: [],
    left: throwsPerVisit(n),
    from: leg.score,
    now: leg.score,
    busted: false,
    checkedOut: false,
  };
  const legal = CONTRACTS.filter((c) => c.weight > 0 && c.check(progress) !== 'DEAD' && c.stake <= Math.max(4, n.pot));
  const pool = legal.length >= 2 ? legal : CONTRACTS.filter((c) => c.weight > 0);
  const want = Math.min(slateSize(n), pool.length);
  const out: string[] = [];
  const usedPull = new Set<string>();
  let candidates = pool.slice();
  let weights = candidates.map((c) => c.weight);
  while (out.length < want && candidates.length) {
    // Prefer a direction not already on the slate: the tension between them is
    // the reason the visit has a plan at all.
    const fresh = candidates.filter((c) => !usedPull.has(c.pull));
    const from = fresh.length ? fresh : candidates;
    const ws = from.map((c) => c.weight);
    const pick = pickWeighted(n.rng, from, ws);
    out.push(pick.id);
    usedPull.add(pick.pull);
    candidates = candidates.filter((c) => c.id !== pick.id);
    weights = candidates.map((c) => c.weight);
  }
  void weights;
  return out;
}

/** The price this contract pays tonight, after the house has shortened it. */
export function currentPrice(n: NightState, defId: string): number {
  return priceOf(contractDef(defId), n.paid[defId] ?? 0) + (hasChalk(n, 'long_prices') ? 2 : 0);
}

export interface SlateOutcome {
  ok: boolean;
  reason?: string;
  events: EngineEvent[];
}

/** Take a contract off the offer and stake it. Only before the first dart. */
export function takeContract(n: NightState, defId: string): SlateOutcome {
  if (n.status !== 'ACTIVE' || n.phase !== 'LEG') return { ok: false, reason: 'not in a leg', events: [] };
  const leg = currentLeg(n);
  if (leg.status !== 'ACTIVE') return { ok: false, reason: 'leg is over', events: [] };
  const visit = currentVisit(leg);
  if (visit.throws.length > 0) return { ok: false, reason: 'the visit has started', events: [] };
  const i = leg.offer.indexOf(defId);
  if (i < 0) return { ok: false, reason: 'not on the slate', events: [] };
  const def = contractDef(defId);
  if (n.pot < def.stake) return { ok: false, reason: 'not enough pot', events: [] };
  n.pot -= def.stake;
  n.stats.potStaked += def.stake;
  n.stats.contractsTaken++;
  leg.offer.splice(i, 1);
  const c: TakenContract = {
    defId,
    stake: def.stake,
    price: currentPrice(n, defId),
    takenAt: 0,
    madeAt: null,
    pressed: 0,
    status: def.check(visitProgress(n, leg)),
    settled: null,
  };
  leg.slate.push(c);
  const events: EngineEvent[] = [{ type: 'CONTRACT_TAKEN', contract: c }];
  // A contract that is already made the moment it is taken pays at once.
  refreshSlate(n, leg, false, events);
  return { ok: true, events };
}

/** Give up on a live contract: the stake back, plus what it has survived. */
export function pullContract(n: NightState, index: number): SlateOutcome {
  const leg = currentLeg(n);
  const c = leg?.slate[index];
  if (!c || c.settled) return { ok: false, reason: 'nothing to pull', events: [] };
  if (c.status === 'DEAD') return { ok: false, reason: 'that one is gone', events: [] };
  const events: EngineEvent[] = [];
  // On Tick: the publican lets you off the whole stake, not half of it.
  settle(n, leg, c, 'PULLED', pullValue(c.stake, hasChalk(n, 'on_tick') ? 1 : PULL_RETURN), events);
  return { ok: true, events };
}

/**
 * Can this contract still be pressed? Only one that has landed and been paid,
 * with darts left in the visit to make the harder one.
 */
export function pressable(n: NightState, leg: LegState, c: TakenContract): boolean {
  if (!c.settled || c.settled.how !== 'PAID' || c.spent) return false;
  const harder = contractDef(c.defId).pressTo;
  if (!harder) return false;
  if (currentVisit(leg).throws.length >= throwsPerVisit(n)) return false;
  // A press must never be dead on arrival. The harder tier reads the whole
  // visit, so pressing NO SCRAPS into NO SCRAPS+ after a fifteen buys a
  // contract that has already failed on a dart thrown before the money was
  // taken. Nothing in this game may take a stake for something that cannot
  // happen (docs/decisions/design.md §6).
  return contractDef(harder).check(visitProgress(n, leg)) !== 'DEAD';
}

/**
 * The press. A contract that has landed pays out now, and the money goes
 * straight back up on something harder at double the stake.
 *
 * The first version tore the landed contract up and rewrote it, so pressing
 * meant giving back a certain payout for an uncertain one. Priced honestly
 * that is nearly always wrong, and the planner agreed: it pressed eight times
 * in a hundred and left everything else riding. This is what a press is at a
 * craps table — the number already made is paid, and the winnings go on a
 * bigger number — and it turns the verb from a trap into a decision.
 *
 * The harder contract reads the whole visit, so the dart that made the first
 * one still counts toward it. What it costs is the doubled stake and the darts
 * left to finish the job.
 */
export function pressContract(n: NightState, index: number): SlateOutcome {
  const leg = currentLeg(n);
  const c = leg?.slate[index];
  if (!c) return { ok: false, reason: 'nothing to press', events: [] };
  if (!pressable(n, leg, c)) return { ok: false, reason: 'nothing to press', events: [] };
  const def = contractDef(c.defId);
  const visit = currentVisit(leg);
  const harder = contractDef(def.pressTo as string);
  const stake = pressStake(c.stake);
  if (n.pot < stake) return { ok: false, reason: 'not enough pot', events: [] };
  const events: EngineEvent[] = [];
  c.spent = true;
  n.pot -= stake;
  n.stats.potStaked += stake;
  n.stats.contractsPressed++;
  const fresh: TakenContract = {
    defId: harder.id,
    stake,
    price: currentPrice(n, harder.id),
    takenAt: visit.throws.length,
    madeAt: null,
    pressed: c.pressed + 1,
    status: harder.check(visitProgress(n, leg)),
    settled: null,
  };
  leg.slate.push(fresh);
  events.push({ type: 'CONTRACT_PRESSED', contract: fresh, from: c.defId });
  // A press that lands the instant it is taken pays like any other.
  refreshSlate(n, leg, false, events);
  return { ok: true, events };
}

function settle(n: NightState, leg: LegState, c: TakenContract, how: ContractOutcome, pot: number, events: EngineEvent[]): void {
  c.settled = { pot, how };
  n.pot += pot;
  const profit = pot - c.stake;
  if (profit > 0) {
    n.stats.potEarned += profit;
    n.stats.potWon += profit;
    n.stats.bestPayout = Math.max(n.stats.bestPayout, profit);
  }
  if (how === 'PAID') {
    n.stats.contractsPaid++;
    n.paid[c.defId] = (n.paid[c.defId] ?? 0) + 1;
  }
  leg.ledger.push(c);
  events.push({ type: 'CONTRACT_SETTLED', contract: c });
}

/**
 * Re-read every contract on the slate, and pay the ones that have landed.
 *
 * A contract pays the moment it lands. There is deliberately no option to
 * leave a landed contract up for more: that option existed, it paid a carry
 * for each dart it survived, and it dominated banking so completely that the
 * planner banked nothing at all in a thousand decisions. A verb that is never
 * right is a trap on the screen, so the money goes in the Pot as soon as it is
 * won and the real decision is what to do next — take it and stop, or press it
 * into something harder. See docs/decisions/design.md §7.3.
 */
function refreshSlate(n: NightState, leg: LegState, checkedOut: boolean, events: EngineEvent[] = []): void {
  const progress = visitProgress(n, leg, checkedOut);
  const thrown = currentVisit(leg).throws.length;
  for (const c of leg.slate) {
    if (c.settled) continue;
    c.status = contractDef(c.defId).check(progress);
    if (c.status !== 'MADE') continue;
    c.madeAt = thrown;
    settle(n, leg, c, 'PAID', c.stake + c.price, events);
  }
}

/**
 * A dart that finishes in the wall wipes the slate, exactly as a bust does.
 *
 * This is the seven-out. Without it, riding a contract to the end of the visit
 * was very nearly free: a bust is the only other thing that can take one, and
 * with free aim a player who wants to avoid a bust simply aims at a safe
 * single. Measured, a bot that never banked anything won three nights in four,
 * which means the greed had no price and the press was decoration.
 *
 * Now the price is paid by the risky dart itself. A treble finishes off the
 * board about one time in twenty-five, so three darts at the trebles carry
 * something like a one-in-eight chance of losing everything riding, while
 * three safe singles carry almost none. That is the whole trade: go for the
 * hundred and forty with two contracts up, or take the money first.
 */
function wallWipesSlate(n: NightState, leg: LegState, events: EngineEvent[]): void {
  let took = 0;
  for (const c of leg.slate) {
    if (c.settled) continue;
    // Everything unsettled goes, the already-dead included: the slate is wiped,
    // not audited.
    if (c.status !== 'DEAD') took++;
    settle(n, leg, c, 'LOST', 0, events);
  }
  if (took) n.stats.slatesWiped++;
}

/**
 * Everything still riding when the visit ends. A bust takes the lot: that is
 * the reason to bank, and the reason a hundred-and-forty is a decision rather
 * than a foregone conclusion.
 */
function settleSlate(n: NightState, leg: LegState, busted: boolean, events: EngineEvent[]): void {
  if (busted && leg.slate.some((c) => !c.settled && c.status !== 'DEAD')) n.stats.slatesWiped++;
  for (const c of leg.slate) {
    if (c.settled) continue;
    // Anything that landed has already paid; whatever is left never will.
    settle(n, leg, c, 'LOST', 0, events);
  }
}

// ---------------------------------------------------------------- the kit

/** Wipe the offer and chalk a fresh one. Costs the RUB OUT intervention. */
export function useRubOut(n: NightState): SlateOutcome {
  const leg = currentLeg(n);
  if (!leg || leg.status !== 'ACTIVE') return { ok: false, reason: 'not in a leg', events: [] };
  if (currentVisit(leg).throws.length > 0) return { ok: false, reason: 'the visit has started', events: [] };
  const i = n.kit.indexOf('rubout');
  if (i < 0) return { ok: false, reason: 'no rub out in the kit', events: [] };
  n.kit.splice(i, 1);
  leg.offer = rollOffer(n, leg);
  return {
    ok: true,
    events: [
      { type: 'KIT_SPENT', defId: 'rubout' },
      { type: 'SLATE_OFFERED', offer: leg.offer.slice(), visitIndex: currentVisit(leg).index },
    ],
  };
}

export function kitCount(n: NightState, defId: string): number {
  return n.kit.filter((k) => k === defId).length;
}

// ---------------------------------------------------------------- throwing

export interface ThrowOptions {
  /** One AIM intervention spent on this dart. */
  use?: string;
  /**
   * Force where the dart lands. The tutorial uses this and nothing else does:
   * a lesson about risk has to be able to show the player a miss on cue, and
   * waiting for the RNG to produce one would make the script non-deterministic.
   */
  forceLanding?: Target;
}

/**
 * The player aims at a target and throws. Free aim: any of the sixty-two
 * targets on the board, or the wall on purpose.
 */
export function commitThrow(n: NightState, target: Target, opts: ThrowOptions = {}): { result: ThrowResult; events: EngineEvent[] } {
  if (n.status !== 'ACTIVE' || n.phase !== 'LEG') throw new Error('not in a leg');
  const leg = currentLeg(n);
  if (leg.status !== 'ACTIVE') throw new Error('leg is over');
  const visit = currentVisit(leg);
  const throwIndex = visit.throws.length as 0 | 1 | 2 | 3;
  const missed = target.region === 'W';
  if (missed) n.stats.misses++;

  const events: EngineEvent[] = [];
  const use: string[] = [];
  if (opts.use) {
    const i = n.kit.indexOf(opts.use);
    const def = i >= 0 ? interventionDef(opts.use) : null;
    if (def && def.when === 'AIM') {
      n.kit.splice(i, 1);
      use.push(opts.use);
      events.push({ type: 'KIT_SPENT', defId: opts.use });
    }
  }

  const { result, forgivenessConsumed } = resolveThrow(target, {
    chalk: n.chalk,
    rng: n.rng,
    // The crowd steadies the hand: every pip of heat is worth points on every chance.
    steadiness: steadinessOf(n, leg),
    trueAim: n.trueAim,
    landing: opts.forceLanding,
    use,
    scoreBefore: leg.score,
    scoreAtVisitStart: visit.scoreAtVisitStart,
    visitThrowIndex: throwIndex,
    forgivenessUsed: leg.forgivenessUsed,
  });
  if (forgivenessConsumed) leg.forgivenessUsed = true;

  visit.throws.push(result);
  n.stats.throwsMade++;
  n.stats.chalkFires += result.firedChalk.length;
  leg.score = result.scoreCommitted;
  events.unshift({ type: 'THROW', result });
  refreshSlate(n, leg, result.outcome === 'CHECKOUT', events);
  // A dart that ended up in the wall, whether it was aimed there or not.
  if (result.aim === 'wall' && !missed) wallWipesSlate(n, leg, events);

  const perVisit = throwsPerVisit(n);

  if (result.outcome === 'CHECKOUT') {
    visit.busted = false;
    leg.heat = Math.min(HEAT_CAP, leg.heat + 1);
    n.stats.bestHeat = Math.max(n.stats.bestHeat, leg.heat);
    endVisit(n, leg, visit, events, false);
    leg.status = 'CHECKED_OUT';
    n.stats.legsWon++;
    n.consecutiveBusts = 0;
    n.streak = leg.dirty ? 0 : n.streak + 1;
    n.stats.bestStreak = Math.max(n.stats.bestStreak, n.streak);
    const reward = leg.index === LEG_COUNT - 1 ? null : potReward(leg, n.streak);
    const checkoutFrom = visit.scoreAtVisitStart;
    n.stats.bestCheckout = Math.max(n.stats.bestCheckout, checkoutFrom);
    if (reward) {
      leg.reward = reward;
      n.pot += reward.total;
      n.stats.potEarned += reward.total;
      if (reward.bigFinish) n.stats.bigFinishes++;
      if (reward.cleanLeg) n.stats.cleanLegs++;
      if (reward.nineDarter) n.stats.nineDarters++;
    } else {
      if (leg.visits.length === 3 && startedLong(leg)) n.stats.nineDarters++;
      if (checkoutFrom >= 100) n.stats.bigFinishes++;
      if (leg.bustsThisLeg === 0) n.stats.cleanLegs++;
    }
    events.push({ type: 'CHECKOUT', legIndex: leg.index, reward });
    if (checkoutFrom >= 100) achieve(n, 'sharp', events);
    // Four visits for a 501. The limits came down, so six was no longer an achievement.
    if (leg.visits.length <= 4 && startedLong(leg)) achieve(n, 'thin', events);

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
    if (leg.heat > 0) {
      events.push({ type: 'HEAT_LOST', from: leg.heat, reason: 'BUST' });
      leg.heat = 0;
    }
    if (!result.firedChalk.includes('cheap_chalk')) dirtyLeg(n, leg, events);
    endVisit(n, leg, visit, events, false);
    if (leg.visits.length >= leg.visitLimit) timeOut(n, leg, events);
    else events.push(...startVisit(n, leg));
    return { result, events };
  }

  if (result.forgiven && leg.heat > 0) {
    events.push({ type: 'HEAT_LOST', from: leg.heat, reason: 'BUST' });
    leg.heat = 0;
  }

  // CONTINUE — the visit ends when the darts run out, or on a deliberate miss.
  if (missed || visit.throws.length >= perVisit) {
    n.consecutiveBusts = 0;
    if (missed) {
      if (leg.heat > 0) {
        events.push({ type: 'HEAT_LOST', from: leg.heat, reason: 'MISS' });
        leg.heat = 0;
      }
    } else if (!visit.throws.some((t) => t.forgiven)) {
      leg.heat = Math.min(HEAT_CAP, leg.heat + 1);
    }
    n.stats.bestHeat = Math.max(n.stats.bestHeat, leg.heat);
    endVisit(n, leg, visit, events, missed);
    if (leg.visits.length >= leg.visitLimit) timeOut(n, leg, events);
    else events.push(...startVisit(n, leg));
  }
  return { result, events };
}

/** Percentage points of hit chance the crowd and the build are lending right now. */
export function steadinessOf(n: NightState, leg: LegState): number {
  const crowd = Math.min(HEAT_CAP, leg.heat) * STEADY_PER_HEAT;
  return crowd + (hasChalk(n, 'practice_board') ? 8 : 0);
}

/** A leg that began at the full 501 or more. */
export function startedLong(leg: LegState): boolean {
  const first = leg.visits[0];
  return LEGS[leg.index].start >= 501 || (!!first && first.scoreAtVisitStart >= 501);
}

function dirtyLeg(n: NightState, leg: LegState, events: EngineEvent[]): void {
  if (leg.dirty) return;
  leg.dirty = true;
  if (n.streak > 0) {
    events.push({ type: 'STREAK_LOST', from: n.streak });
    n.streak = 0;
  }
}

function endVisit(n: NightState, leg: LegState, visit: LegState['visits'][number], events: EngineEvent[], missed: boolean): void {
  settleSlate(n, leg, visit.busted, events);
  const total = visitTotal(visit);
  if (!visit.busted) {
    n.stats.bestVisit = Math.max(n.stats.bestVisit, total);
    if (total >= 180) n.stats.oneEighties++;
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

/** Throw at the wall on purpose: scores nothing, spends the dart, ends the visit. */
export function commitMiss(n: NightState): { result: ThrowResult; events: EngineEvent[] } {
  return commitThrow(n, { region: 'W' });
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

export function kitPrice(n: NightState, defId: string): number {
  return interventionDef(defId).cost + (n.oche === 'wide' ? 2 : 0);
}

function rollService(n: NightState): ServiceKind {
  const kinds: ServiceKind[] = ['STEADY', 'CREDIT', 'RUB_OUT'];
  return pickWeighted(n.rng, kinds, [3, 2, 2]);
}

function rollKitOffer(n: NightState): string {
  const ids = KIT_POOL.map((x) => x[0]);
  const ws = KIT_POOL.map((x) => x[1]);
  return pickWeighted(n.rng, ids, ws);
}

function rollChalkOffer(n: NightState): string | null {
  const available = CHALK_DEFS.filter((d) => !hasChalk(n, d.id));
  if (available.length === 0) return null;
  return available[nextInt(n.rng, available.length)].id;
}

/**
 * Shop generation consumes the gameplay RNG in a fixed order: kit, kit, chalk,
 * service. ANOTHER GO is not rolled — it is always on the shelf.
 *
 * That is deliberate. Chalk fills five slots and the kit six, and after that
 * the Pot had nowhere to go: measured over two hundred nights, a bot that
 * ignored the slate entirely won MORE often than one that worked it, because
 * the money it earned could not be spent on anything that wins a leg. A
 * standing offer of one more visit is the sink, and it is the right one — a
 * leg is lost to the clock far more often than to the arithmetic.
 */
export function generateShop(n: NightState, afterLeg: number): ShopState {
  const slots: ShopSlot[] = [];
  const k1 = rollKitOffer(n);
  const k2 = rollKitOffer(n);
  slots.push({ kind: 'KIT', defId: k1, cost: kitPrice(n, k1), sold: false });
  slots.push({ kind: 'KIT', defId: k2, cost: kitPrice(n, k2), sold: false });
  const ch = rollChalkOffer(n);
  if (ch) slots.push({ kind: 'CHALK', chalkId: ch, cost: chalkDef(ch).cost, sold: false });
  const s = rollService(n);
  slots.push({ kind: 'SERVICE', service: s, cost: SERVICE_COST[s], sold: false });
  slots.push({ kind: 'SERVICE', service: 'ANOTHER_GO', cost: anotherGoCost(n.extraVisits), sold: false });
  return { slots, refreshed: false, afterLeg };
}

export interface BuyOptions {
  /** For a chalk purchase when slots are full: which held chalk to rub out. */
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
  let repeatable = false;

  switch (slot.kind) {
    case 'KIT': {
      if (n.kit.length >= KIT_CAP) return { ok: false, reason: 'the kit is full', events: [] };
      n.kit.push(slot.defId);
      n.stats.kitBought++;
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
      if (slot.service === 'STEADY') {
        // Refill the kit with the cheap steadying one. Always useful, never a decision you can get wrong.
        if (n.kit.length >= KIT_CAP) return { ok: false, reason: 'the kit is full', events: [] };
        n.kit.push('steady');
        n.stats.kitBought++;
        repeatable = n.kit.length < KIT_CAP;
      } else if (slot.service === 'ANOTHER_GO') {
        // A word with the publican. The Pot's other job: chalk is the build,
        // this is the clock, and a leg is lost to the clock far more often
        // than it is lost to the arithmetic.
        if (n.extraVisits >= ANOTHER_GO_CAP) return { ok: false, reason: 'he has heard enough', events: [] };
        n.extraVisits++;
        repeatable = n.extraVisits < ANOTHER_GO_CAP;
        // He asks more every time. The slot stays on the shelf at its new price.
        if (repeatable) slot.cost = anotherGoCost(n.extraVisits);
      } else if (slot.service === 'CREDIT') {
        // The publican's published policy: a flat advance, taken once.
        n.pot += SERVICE_COST.CREDIT * 2;
        n.stats.potEarned += SERVICE_COST.CREDIT * 2;
      } else {
        // Rub out a paid contract's history, so its price goes back up.
        const worst = Object.entries(n.paid).sort((a, b) => b[1] - a[1])[0];
        if (!worst) return { ok: false, reason: 'nothing chalked against you yet', events: [] };
        delete n.paid[worst[0]];
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

// ---------------------------------------------------------------- serialisation

export function serialiseNight(n: NightState): string {
  return JSON.stringify(n);
}

export function deserialiseNight(json: string): NightState {
  return JSON.parse(json) as NightState;
}

export { shuffle };
