/**
 * Shared helpers for the engine test suite. No test logic lives here — only
 * constructors and scripted bots so the spec files stay readable.
 *
 * Rebuilt for free aim (docs/decisions/design.md §5.1): there is no hand of
 * dealt cards to fake up any more, so a scripted throw is just a target, and
 * the interesting scaffolding is the slate — taking contracts, settling them,
 * and driving a whole night deterministically.
 */
import { createHash } from 'node:crypto';
import { chalkDef } from '../src/content/chalkdefs.ts';
import { ALL_TARGETS, baseValue, parseTarget, targetDefId, targetNotation } from '../src/core/board.ts';
import { computeCheckoutHints } from '../src/core/checkout.ts';
import { resolveThrow, throwOnMeter } from '../src/core/resolver.ts';
import { createRng, nextFloat } from '../src/core/rng.ts';
import { contractDef } from '../src/core/slate.ts';
import {
  addChalk,
  beginLeg,
  throwsPerVisit,
  commitMiss,
  commitThrow,
  createNight,
  currentLeg,
  currentVisit,
  pressContract,
  pressable,
  pullContract,
  shopBuy,
  shopLeave,
  shopRefresh,
  takeContract,
  useRubOut,
  visitProgress,
} from '../src/core/state.ts';
import type {
  Chalk,
  EngineEvent,
  LegState,
  NightState,
  OcheId,
  Rng,
  TakenContract,
  Target,
  ThrowResult,
} from '../src/core/types.ts';

// ---------------------------------------------------------------- targets

/** A target, or its notation ("T20", "d16", "ob", "bull", "wall"). */
export type TargetLike = Target | string;

/** Normalise a target written either way. Always a fresh object. */
export function target(t: TargetLike): Target {
  return typeof t === 'string' ? parseTarget(t) : { ...t };
}

/** "T20", "OB", "BULL", "WALL". */
export function notation(t: TargetLike): string {
  return targetNotation(target(t));
}

/** Lower-case def id for a target: "t20", "ob", "ib". Still the id the art and audio use. */
export function defIdOf(t: Target): string {
  return targetDefId(t);
}

/** Base value of a target written either way (bed × multiplier, OB 25, IB 50). */
export function baseOf(t: TargetLike): number {
  return baseValue(target(t));
}

// ---------------------------------------------------------------- chalk

/** Chalk list whose acquisition order is the array order (first = oldest). */
export function mkChalk(ids: string[]): Chalk[] {
  return ids.map((id, i) => ({ def: chalkDef(id), order: i + 1 }));
}

// ---------------------------------------------------------------- one throw, resolved

export interface ResolveOpts {
  /** Play the aim's odds instead of landing where aimed (default true aim). */
  trueAim?: boolean;
  /** Gameplay RNG; null (default) disables the aim roll and wired deflection. */
  rng?: Rng | null;
  /** Force where the dart lands, overriding the roll. */
  landing?: TargetLike;
  /** Percentage points of steadiness lent to the throw. */
  steadiness?: number;
  /** Interventions spent on this dart. */
  use?: string[];
  /** Defaults to `score`. */
  scoreAtVisitStart?: number;
  /** Defaults to 0. */
  throwIndex?: 0 | 1 | 2 | 3;
  /** Defaults to false. */
  forgivenessUsed?: boolean;
}

export type Resolved = ThrowResult & { forgivenessConsumed: boolean };

/** Resolve one throw through the real pipeline with the given chalk (acquisition order = array order). */
export function resolve(t: TargetLike, score: number, chalkIds: string[] = [], opts: ResolveOpts = {}): Resolved {
  const out = resolveThrow(target(t), {
    chalk: mkChalk(chalkIds),
    rng: opts.rng === undefined ? null : opts.rng,
    // These tests pin chalk arithmetic; the aim's odds have their own file.
    trueAim: opts.trueAim ?? true,
    landing: opts.landing === undefined ? undefined : target(opts.landing),
    steadiness: opts.steadiness,
    use: opts.use,
    scoreBefore: score,
    scoreAtVisitStart: opts.scoreAtVisitStart ?? score,
    visitThrowIndex: opts.throwIndex ?? 0,
    forgivenessUsed: opts.forgivenessUsed ?? false,
  });
  return { ...out.result, forgivenessConsumed: out.forgivenessConsumed };
}

/** Just the total resolved value of a throw. */
export function value(t: TargetLike, chalkIds: string[] = [], opts: ResolveOpts = {}): number {
  return resolve(t, 1000, chalkIds, opts).totalValue;
}

// ---------------------------------------------------------------- rng

/** An RNG whose next float is < 0.25, i.e. `wired` WILL deflect on the next bed throw. */
export function deflectingRng(): Rng {
  for (let s = 1; s < 100000; s++) {
    if (nextFloat(createRng(s)) < 0.25) return createRng(s);
  }
  throw new Error('no deflecting seed found');
}

/** A seeded RNG whose next aim roll at `t` puts the dart in the wall. */
export function wallRng(t: TargetLike, steadiness = 0): Rng {
  // The dart is thrown on the meter now, so the seed has to be one that puts
  // an ordinary hand's stop right at the top of the scale — which is where the
  // wall lives.
  for (let s = 1; s < 1000000; s++) {
    if (throwOnMeter(target(t), steadiness, createRng(s), undefined).target.region === 'W') return createRng(s);
  }
  throw new Error('no wall seed found');
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

// ---------------------------------------------------------------- nights

/**
 * A night at the oche with its first leg begun. True aim by default: the state
 * tests pin arithmetic and event order, not luck. Pass `trueAim = false` to
 * play the real odds.
 */
export function startNight(seed = 1, oche: OcheId = 'local', chalk: string[] = [], trueAim = true): NightState {
  const n = createNight(seed, oche, { trueAim });
  for (const id of chalk) addChalk(n, id);
  beginLeg(n);
  return n;
}

/** Set the remaining score and the current visit's start score (only valid before the visit's first throw). */
export function setScore(n: NightState, score: number): void {
  const leg = currentLeg(n);
  leg.score = score;
  const v = currentVisit(leg);
  if (v.throws.length === 0) v.scoreAtVisitStart = score;
}

/** Throw one dart at a named target, optionally spending an intervention on it. */
export function throwAt(n: NightState, t: TargetLike, opts: { use?: string } = {}): { result: ThrowResult; events: EngineEvent[] } {
  return commitThrow(n, target(t), opts);
}

/** Throw a sequence of darts, one per target; returns the last commit's output. */
export function throwAll(n: NightState, targets: TargetLike[]): { result: ThrowResult; events: EngineEvent[] } {
  let last: { result: ThrowResult; events: EngineEvent[] } | null = null;
  for (const t of targets) last = throwAt(n, t);
  if (!last) throw new Error('nothing thrown');
  return last;
}

/** Throw the darts, then walk away at the wall to close the visit. */
export function throwThenMiss(n: NightState, targets: TargetLike[]): { result: ThrowResult; events: EngineEvent[] } {
  throwAll(n, targets);
  return commitMiss(n);
}

export function eventTypes(events: EngineEvent[]): string[] {
  return events.map((e) => e.type);
}

/** The first event of a type, or a readable throw. */
export function ev<T extends EngineEvent['type']>(events: EngineEvent[], type: T): Extract<EngineEvent, { type: T }> {
  const e = events.find((x) => x.type === type);
  if (!e) throw new Error(`no ${type} in [${eventTypes(events)}]`);
  return e as Extract<EngineEvent, { type: T }>;
}

// ---------------------------------------------------------------- the slate

/** The contracts chalked up for the current visit. */
export function offerOf(n: NightState): string[] {
  return currentLeg(n).offer.slice();
}

/** The contracts taken this visit. */
export function slateOf(n: NightState): TakenContract[] {
  return currentLeg(n).slate;
}

/**
 * Take a contract, forcing it onto the offer first if it is not already there.
 * Tests that care about the offer roll read `offerOf`; the rest just want the
 * contract on the slate.
 */
export function take(n: NightState, defId: string): TakenContract {
  const leg = currentLeg(n);
  if (!leg.offer.includes(defId)) leg.offer.push(defId);
  const out = takeContract(n, defId);
  if (!out.ok) throw new Error(`could not take ${defId}: ${out.reason}`);
  return leg.slate[leg.slate.length - 1];
}

/** Index of a taken contract on the slate, by def id. */
export function slateIndex(n: NightState, defId: string): number {
  const i = currentLeg(n).slate.findIndex((c) => c.defId === defId && !c.settled);
  if (i < 0) throw new Error(`${defId} is not riding`);
  return i;
}

/** Index of a contract that has paid and can still be pressed, by def id. */
export function paidIndex(n: NightState, defId: string): number {
  const leg = currentLeg(n);
  const i = leg.slate.findIndex((c) => c.defId === defId && c.settled?.how === 'PAID');
  if (i < 0) throw new Error(`${defId} has not paid`);
  return i;
}

export function pull(n: NightState, defId: string) {
  return pullContract(n, slateIndex(n, defId));
}

export function press(n: NightState, defId: string) {
  return pressContract(n, paidIndex(n, defId));
}

/** Status of a contract on the slate right now. */
export function statusOf(n: NightState, defId: string): TakenContract['status'] {
  return currentLeg(n).slate.find((c) => c.defId === defId)?.status ?? 'DEAD';
}

/**
 * Run a contract's own check over a scripted visit: the values and the landing
 * spots of the darts, then whatever is left. Used to prove that every contract
 * reaches MADE on a visit that satisfies it and DEAD on one that cannot.
 */
export function checkVisit(
  defId: string,
  hits: (TargetLike | null)[],
  opts: { from?: number; perVisit?: number; busted?: boolean; checkedOut?: boolean } = {},
): TakenContract['status'] {
  const per = opts.perVisit ?? 3;
  const from = opts.from ?? 501;
  const landed = hits.map((h) => (h === null ? null : target(h)));
  const values = landed.map((h) => (h ? baseValue(h) : 0));
  const total = values.reduce((a, b) => a + b, 0);
  return contractDef(defId).check({
    values,
    hits: landed,
    left: Math.max(0, per - hits.length),
    from,
    now: opts.checkedOut ? 0 : from - total,
    busted: opts.busted ?? false,
    checkedOut: opts.checkedOut ?? false,
  });
}

// ---------------------------------------------------------------- scripted bot (determinism harness)

/**
 * Every input a night can take, as data. A night is a pure function of its
 * seed and this list, which is the property the determinism tests prove: the
 * bot below decides, but only these steps ever touch the state, so a recorded
 * script replays a night exactly without re-running a single decision.
 */
export type ScriptStep =
  | { kind: 'TAKE'; defId: string }
  | { kind: 'RUBOUT' }
  | { kind: 'THROW'; target: Target; use?: string; stop?: number }
  | { kind: 'MISS' }
  | { kind: 'PRESS'; index: number }
  | { kind: 'PULL'; index: number }
  | { kind: 'BUY'; index: number; replaceChalkId?: string }
  | { kind: 'LEAVE' };

export function applyStep(n: NightState, s: ScriptStep): void {
  switch (s.kind) {
    case 'TAKE':
      takeContract(n, s.defId);
      break;
    case 'RUBOUT':
      useRubOut(n);
      break;
    case 'THROW':
      commitThrow(n, s.target, { ...(s.use ? { use: s.use } : {}), ...(s.stop !== undefined ? { stop: s.stop } : {}) });
      break;
    case 'MISS':
      commitMiss(n);
      break;
    case 'PRESS':
      pressContract(n, s.index);
      break;
    case 'PULL':
      pullContract(n, s.index);
      break;
    case 'BUY':
      shopBuy(n, s.index, s.replaceChalkId ? { replaceChalkId: s.replaceChalkId } : {});
      break;
    case 'LEAVE':
      shopLeave(n);
      break;
  }
}

/** Replay a recorded script into a night. */
export function applyScript(n: NightState, script: ScriptStep[]): NightState {
  for (const s of script) applyStep(n, s);
  return n;
}

function step(n: NightState, s: ScriptStep, log?: ScriptStep[]): void {
  if (log) log.push(s);
  applyStep(n, s);
}

/**
 * The pick is a pure function of the held chalk (in acquisition order), the
 * score and the darts already thrown, so a thousand replays of one night can
 * share the answer without changing a single one of them.
 */
const pickCache = new Map<string, Target | null>();

/**
 * The scripted bot's dart. Free aim means the choice is a target, not a card,
 * so the rule is the darts player's default: finish if the checkout table says
 * you can, otherwise the biggest number that does not bust, otherwise the
 * wall. Never touches the night RNG — every hypothetical passes `rng: null`.
 */
export function botTarget(n: NightState, leg: LegState): Target | null {
  const visit = currentVisit(leg);
  const ti = visit.throws.length as 0 | 1 | 2 | 3;
  const key = `${n.chalk.map((c) => c.def.id).join(',')}|${leg.score}|${ti}`;
  const cached = pickCache.get(key);
  if (cached !== undefined) return cached ? { ...cached } : null;
  const pick = choose(n, leg, ti);
  pickCache.set(key, pick);
  return pick ? { ...pick } : null;
}

function choose(n: NightState, leg: LegState, ti: 0 | 1 | 2 | 3): Target | null {
  // Only look for a finish when one could exist: the search is the expensive
  // part and a night spends most of its darts a long way from the double.
  if (leg.score <= 240) {
    const best = computeCheckoutHints(n, leg).best;
    if (best) return { ...best.targets[0] };
  }
  let best: Target | null = null;
  let bestValue = -1;
  for (const t of ALL_TARGETS) {
    const r = resolveThrow(t, {
      chalk: n.chalk,
      rng: null,
      scoreBefore: leg.score,
      scoreAtVisitStart: leg.score,
      visitThrowIndex: ti,
      forgivenessUsed: true,
    }).result;
    if (r.outcome === 'BUST') continue;
    if (r.totalValue > bestValue) {
      best = { ...t };
      bestValue = r.totalValue;
    }
  }
  return best;
}

/**
 * The scripted slate policy, before the first dart of a visit: rub the offer
 * out if nothing on it is affordable and the kit can pay for it, then take up
 * to two contracts, cheapest first.
 *
 * It prefers a contract that pulls the same way this bot already throws —
 * SCORE and PRECISION, which the treble twenty satisfies — because the point
 * of this bot is to exercise the replay machinery, and a policy that only ever
 * took contracts it could not make never reached the BANK or PRESS steps at
 * all. It is not meant to be good play; `src/core/bot.ts` is where that lives.
 */
export function botTakeContracts(n: NightState, leg: LegState, log?: ScriptStep[]): void {
  if (currentVisit(leg).throws.length > 0) return;
  const affordable = () => leg.offer.filter((id) => contractDef(id).stake + 2 <= n.pot);
  if (affordable().length === 0 && n.kit.includes('rubout')) step(n, { kind: 'RUBOUT' }, log);
  const rank = (id: string) => {
    const pull = contractDef(id).pull;
    return pull === 'PRECISION' ? 0 : pull === 'SCORE' ? 1 : 2;
  };
  const order = (a: string, b: string) => rank(a) - rank(b) || contractDef(a).stake - contractDef(b).stake || a.localeCompare(b);
  for (let taken = 0; taken < 2; taken++) {
    const ids = affordable().sort(order);
    if (!ids.length) break;
    step(n, { kind: 'TAKE', defId: ids[0] }, log);
  }
}

/**
 * The scripted settle policy, after every dart. A contract that lands has
 * already paid itself, so there is nothing to bank; the greedier bot presses
 * the first one it can, which is the only way a press reaches the determinism
 * run at all.
 */
export function botSettleSlate(n: NightState, leg: LegState, deep = false, log?: ScriptStep[]): void {
  if (!deep) return;
  for (let i = 0; i < leg.slate.length; i++) {
    const c = leg.slate[i];
    if (c.pressed > 0 || !pressable(n, leg, c)) continue;
    if (n.pot < c.stake * 2) continue;
    step(n, { kind: 'PRESS', index: i }, log);
    return;
  }
}

/** The scripted kit policy: steady the hand on a finishing dart, when one is held. */
export function botUse(n: NightState, t: Target): string | undefined {
  // Steady the hand on anything thin: a double, a bull or a treble. The deep
  // run exists to exercise the kit, so it spends it rather than hoarding it.
  if (t.region !== 'D' && t.region !== 'IB' && t.region !== 'T') return undefined;
  if (n.kit.includes('steady')) return 'steady';
  if (n.kit.includes('called')) return 'called';
  return undefined;
}

/** In the shop: buy the first affordable slot, then leave. */
export function botShop(n: NightState, log?: ScriptStep[]): void {
  const shop = n.shop;
  if (shop) {
    for (let i = 0; i < shop.slots.length; i++) {
      const s = shop.slots[i];
      if (s.sold || n.pot < s.cost) continue;
      const replaceChalkId = s.kind === 'CHALK' && n.chalk.length >= n.chalkSlots ? n.chalk[0].def.id : undefined;
      const before = n.pot;
      step(n, { kind: 'BUY', index: i, replaceChalkId }, log);
      if (n.pot !== before) break;
    }
  }
  step(n, { kind: 'LEAVE' }, log);
}

/** A greedier shop: chalk first, then a refresh-free second buy. Used to reach the deeper legs. */
export function botShopDeep(n: NightState, log?: ScriptStep[]): void {
  const buyFirst = (kind?: string): boolean => {
    const shop = n.shop;
    if (!shop) return false;
    for (let i = 0; i < shop.slots.length; i++) {
      const s = shop.slots[i];
      if (s.sold || n.pot < s.cost) continue;
      if (kind && s.kind !== kind) continue;
      const replaceChalkId = s.kind === 'CHALK' && n.chalk.length >= n.chalkSlots ? n.chalk[0].def.id : undefined;
      const before = n.pot;
      step(n, { kind: 'BUY', index: i, replaceChalkId }, log);
      if (n.pot !== before) return true;
    }
    return false;
  };
  if (n.shop) {
    buyFirst('CHALK');
    buyFirst();
    buyFirst();
  }
  step(n, { kind: 'LEAVE' }, log);
}

export interface DriveOpts {
  /** Meter stops to play, cycled. Leave out and every dart is thrown by an ordinary hand. */
  stops?: number[];
  /** Stop before the step that would make this true. */
  stopWhen?: (n: NightState) => boolean;
  /** The greedier bot: presses contracts, spends the kit, buys chalk. */
  deep?: boolean;
  /** Every input the drive fed the night, for replay. */
  log?: ScriptStep[];
}

/**
 * Drive a night (or a deserialised snapshot of one) to its end with the
 * scripted bot: take contracts, throw, press what it can, repeat.
 */
export function continueScripted(n: NightState, opts: DriveOpts = {}): NightState {
  const { stopWhen, deep = false, log, stops } = opts;
  let guard = 0;
  let dart = 0;
  while (n.status === 'ACTIVE' && guard++ < 20000) {
    if (stopWhen && stopWhen(n)) break;
    if (n.phase === 'LEG') {
      const leg = currentLeg(n);
      botTakeContracts(n, leg, log);
      const t = botTarget(n, leg);
      // A thumb, when one is asked for: a fixed sequence of meter stops, so a
      // night played by a player rather than by an ordinary hand still has to
      // replay byte for byte from what was written down.
      const stop = stops ? stops[dart++ % stops.length] : undefined;
      if (!t) step(n, { kind: 'MISS' }, log);
      else step(n, { kind: 'THROW', target: t, use: deep ? botUse(n, t) : undefined, ...(stop !== undefined ? { stop } : {}) }, log);
      if (n.phase === 'LEG' && currentLeg(n).status === 'ACTIVE') botSettleSlate(n, currentLeg(n), deep, log);
    } else if (n.phase === 'SHOP') {
      if (deep) botShopDeep(n, log);
      else botShop(n, log);
    } else break;
  }
  return n;
}

/** Play a whole night from a seed with the scripted bot, at the real odds. */
export function playScripted(seed: number, oche: OcheId = 'local'): NightState {
  return continueScripted(startNight(seed, oche, [], false));
}

/** Play a whole night from a seed with the greedier bot, optionally with starting chalk. */
export function playDeep(seed: number, chalk: string[] = [], oche: OcheId = 'local'): NightState {
  return continueScripted(startNight(seed, oche, chalk, false), { deep: true });
}

/** Everything the visit's contracts can see right now. */
export { visitProgress };
