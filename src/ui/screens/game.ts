/**
 * The leg screen: the board you aim at, the remaining score, the slate, the
 * kit, the chalk strip, the commentary, and every piece of feedback between
 * them. The engine runs a throw in one call; this screen choreographs what
 * the player sees and hears.
 *
 * The board is the input surface. Point at any of the sixty-two targets, see
 * the fan of where the dart could land, then commit. Nothing tells you where
 * to aim — that decision is the game (docs/decisions/design.md §5.1).
 */
import { P } from '../../art/palette';
import { measureText } from '../../art/sprites';
import { CHALK_DEFS, chalkDef } from '../../content/chalkdefs';
import { INTERVENTIONS, interventionDef } from '../../content/interventions';
import { OCHE_BY_ID } from '../../content/oches';
import { baseValue, sameTarget, targetNotation } from '../../core/board';
import { computeCheckoutHints, routeNotation, type CheckoutHints } from '../../core/checkout';
import { HEAT_CAP, LEGS, streakMultiplier } from '../../content/legs';
import { buildBarkContext } from '../../core/commentary';
import { contractDef } from '../../core/slate';
import { hitChance, resolveThrow, spreadFor, type Landing } from '../../core/resolver';
import {
  bankContract,
  commitMiss,
  commitThrow,
  currentLeg,
  currentPrice,
  currentVisit,
  interestOn,
  kitCount,
  legName,
  pressContract,
  pullContract,
  slateSize,
  steadinessOf,
  takeContract,
  throwsPerVisit,
  useRubOut,
  visitProgress,
  visitTotal,
} from '../../core/state';
import type { EngineEvent, LegState, NightState, Target, ThrowResult } from '../../core/types';
import type { App } from '../app';
import { aimLabel, drawAimMark, drawFan, pointOf, stepBed, stepRing, targetAt } from '../aim';
import { BoardView } from '../boardview';
import { CommentaryBar } from '../commentarybar';
import type { Renderer } from '../draw';
import { inRect, type Pointer } from '../input';
import { chalkChips, gameLayout, kitChips, slateSlots, type GameLayout, type Rect } from '../layout';
import type { Scene } from '../scene';
import { SlateView, drawEmptySlot, layoutVerbs, type SlateCardView, type SlateVerbId } from '../slateview';
import { Coroutines, Counter, Particles, Pulse, Shake, ease, lerp, rndRange, type Routine } from '../tween';
import { seedToString } from '../../core/rng';
import { ButtonSet, drawPanel, drawVisitPips } from '../widgets';

/** Hooks a tutorial (or test harness) can attach to the game screen. */
export interface GameHooks {
  /** Called with every engine event after its animation has played. */
  onEvent?(e: EngineEvent, screen: GameScreen): void;
  /** Called when the screen is interactive again. */
  onReady?(screen: GameScreen): void;
  /** Draw on top of everything. */
  draw?(r: Renderer, screen: GameScreen): void;
  update?(dt: number, screen: GameScreen): void;
  /** Return true to swallow the pointer event. */
  onDown?(p: Pointer, screen: GameScreen): boolean;
  onKey?(key: string, screen: GameScreen): boolean;
  /** Suppress the normal end-of-leg flow (tutorial handles it). */
  ownsFlow?: boolean;
  /** Targets the tutorial will accept right now. Null means anywhere. */
  allowedTargets?: Target[] | null;
  /** Slate verbs the tutorial will accept right now. Null means all. */
  allowedVerbs?: SlateVerbId[] | null;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: number;
  scale: number;
  vy: number;
}

interface DartFlight {
  from: { x: number; y: number };
  to: { x: number; y: number };
  ctrl: { x: number; y: number };
  t: number;
  duration: number;
  flight: number;
  trail: { x: number; y: number }[];
}

/** What the currently aimed dart would do, worked out before it is thrown. */
export interface AimPreview {
  target: Target;
  /** Chance of landing on the called target, as a whole percentage. */
  hit: number;
  /** What it scores if it lands where it is aimed. */
  value: number;
  /** What it leaves if it lands where it is aimed. */
  leaves: number;
  /** Chance across every landing that this dart busts the visit. */
  bust: number;
  /** Chance across every landing that this dart wins the leg. */
  finish: number;
  /** Chance it finishes in the wall. */
  wall: number;
  dist: Landing[];
}

export class GameScreen implements Scene {
  layout: GameLayout;
  board: BoardView;
  slate = new SlateView();
  bar = new CommentaryBar();
  co = new Coroutines();
  particles = new Particles();
  shake = new Shake();
  score: Counter;
  flash = new Pulse();
  goldFlash = new Pulse();
  bustStamp = new Pulse();
  bigText: { text: string; sub?: string; pulse: Pulse; color: number } | null = null;
  hints: CheckoutHints | null = null;
  floaters: Floater[] = [];
  dart: DartFlight | null = null;
  chalkPulse = new Map<string, Pulse>();
  readout = '';
  readoutColor: number = P.MIST;
  chalkTip: { id: string; t: number } | null = null;
  overlay: 'none' | 'checkout' | 'pause' | 'over' = 'none';
  buttons = new ButtonSet();
  keyboardFocus = false;
  crowd: { x: number; y: number; frame: number; tint: number; phase: number }[] = [];
  crowdJump = new Pulse();
  heatPulse = new Pulse();
  heatLost = new Pulse();
  time = 0;
  idleBarked = false;
  hooks: GameHooks;

  /** Where the player is pointing. Never null once a leg is running. */
  aim: Target = { region: 'T', bed: 20 };
  /** Everything the aimed dart would do, recomputed whenever the aim moves. */
  preview: AimPreview | null = null;
  /** An intervention armed for the next dart, or null. */
  armed: string | null = null;
  /** Locked while a throw plays out or the tutorial holds the floor. */
  locked = true;
  aimPulse = new Pulse();
  /** True while a pointer is down on the board, sweeping the sights. */
  private dragging = false;
  /** Seconds the screen has been locked with nothing happening. See `update`. */
  private stuckFor = 0;
  /** Slate slots with nothing in them, drawn as empties so the row keeps its shape. */
  private emptySlots: Rect[] = [];

  lastResult: ThrowResult | null = null;
  pendingEvents: EngineEvent[] = [];
  private busy = false;
  private legBanner: { text: string; sub: string; t: number } | null = null;
  private checkoutPanelT = 0;
  private scoreBump = new Pulse();

  constructor(
    public app: App,
    hooks: GameHooks = {},
  ) {
    this.hooks = hooks;
    this.layout = gameLayout(app.screen.width, app.screen.height);
    this.board = new BoardView(this.layout);
    this.score = new Counter(this.night ? currentLeg(this.night).score : 501);
    this.score.onTick = () => app.sfx('tick', { volume: 0.35, pitch: 1 + rndRange(-0.05, 0.05) });
    this.bar.blip = (s, ch) => (app.save.data.settings.voice ? app.audio.blip(s, ch) : s === 'BARREL' ? 18 : 34);
  }

  get night(): NightState {
    return this.app.night as NightState;
  }

  get leg(): LegState {
    return currentLeg(this.night);
  }

  /** True before the first dart of a visit, when contracts may still be taken. */
  get takingPhase(): boolean {
    const leg = this.leg;
    if (!leg || leg.status !== 'ACTIVE') return false;
    const v = currentVisit(leg);
    return !!v && v.throws.length === 0;
  }

  // ---------------------------------------------------------------- lifecycle

  enter(): void {
    this.resize();
    this.shake.enabled = this.app.save.data.settings.screenShake;
    this.buildCrowd();
    const leg = this.leg;
    this.score.snap(leg.score);
    this.board.clearDarts();
    this.aim = this.openingAim();
    this.readout = this.app.input.isTouch ? 'TAP THE BOARD TO AIM. TAP AGAIN TO THROW.' : 'CLICK THE BOARD TO AIM. ARROWS MOVE IT, ENTER THROWS.';
    this.readoutColor = P.MIST;
    this.legBanner = this.hooks.ownsFlow ? null : { text: `LEG ${leg.index + 1} · ${legName(leg.index).toUpperCase()}`, sub: `${LEGS[leg.index].start} UP · ${leg.visitLimit} VISITS`, t: 0 };
    this.app.sfx('card_flip');
    this.locked = true;
    this.co.run(this.legIntro());
    this.app.audio.setCrowdTension(0.2);
  }

  exit(): void {
    this.co.clear();
    this.app.audio.setCrowdTension(0);
  }

  resize(): void {
    this.layout = gameLayout(this.app.screen.width, this.app.screen.height);
    this.board.layout = this.layout;
    this.bar.lines = this.layout.orientation === 'portrait' ? 4 : 2;
    this.buildCrowd();
    this.refresh();
  }

  private buildCrowd(): void {
    const l = this.layout;
    const legIdx = this.night ? this.night.legIndex : 0;
    const n = Math.min(22, 7 + legIdx * 2);
    this.crowd = [];
    const y = l.orientation === 'landscape' ? 108 : 100;
    const x0 = l.orientation === 'landscape' ? 2 : 4;
    const span = l.orientation === 'landscape' ? 104 : 172;
    for (let i = 0; i < n; i++) {
      const x = x0 + Math.round((i / Math.max(1, n - 1)) * (span - 8)) + Math.round(rndRange(-2, 2));
      this.crowd.push({ x, y: y + Math.round(rndRange(0, 3)), frame: Math.floor(rndRange(0, 6)), tint: Math.floor(rndRange(0, 5)), phase: rndRange(0, 6.28) });
    }
    this.crowd.sort((a, b) => a.y - b.y);
  }

  private *legIntro(): Routine {
    yield 0.05;
    this.refresh();
    this.bark({ type: 'LEG_START', legIndex: this.leg.index });
    yield 0.35;
    this.locked = false;
    this.hooks.onReady?.(this);
  }

  // ---------------------------------------------------------------- commentary

  bark(event: EngineEvent | { type: 'IDLE'; seconds: number } | { type: 'SHOP_ENTER'; pot: number }, result?: ThrowResult): void {
    try {
      const ctx = buildBarkContext(this.night, event, result);
      const barks = this.app.commentary.react(ctx);
      if (barks.length) this.bar.say(barks);
    } catch {
      /* commentary must never break play */
    }
  }

  // ---------------------------------------------------------------- aim

  /**
   * Where the sights start each visit. The route out if there is one, because
   * that is what a darts player would be looking at, and the treble twenty if
   * there is not. It is only a starting point — every target is one tap away.
   */
  private openingAim(): Target {
    try {
      const hints = computeCheckoutHints(this.night, this.leg);
      if (hints.best) return { ...hints.best.targets[0] };
    } catch {
      /* fall through */
    }
    return { region: 'T', bed: 20 };
  }

  setAim(t: Target): void {
    if (this.locked || this.busy) return;
    if (sameTarget(t, this.aim)) return;
    this.aim = { ...t };
    this.aimPulse.fire(0.2);
    this.app.sfx('ui_move', { volume: 0.25 });
    this.refreshPreview();
    this.describeAim();
  }

  /** Work out what the aimed dart would do, over every place it could land. */
  refreshPreview(): void {
    const leg = this.leg;
    if (!leg || leg.status !== 'ACTIVE') {
      this.preview = null;
      return;
    }
    const visit = currentVisit(leg);
    const ti = (visit ? visit.throws.length : 0) as 0 | 1 | 2 | 3;
    const steady = steadinessOf(this.night, leg);
    const use = this.armed ? [this.armed] : [];
    const base = {
      chalk: this.night.chalk,
      rng: null,
      use,
      scoreBefore: leg.score,
      scoreAtVisitStart: visit ? visit.scoreAtVisitStart : leg.score,
      visitThrowIndex: ti,
      forgivenessUsed: true,
    };
    const straight = resolveThrow(this.aim, base).result;
    const dist = this.night.trueAim ? [{ target: this.aim, p: 1, kind: 'hit' as const }] : spreadFor(this.aim, steady, use);
    let bust = 0;
    let finish = 0;
    let wall = 0;
    for (const land of dist) {
      if (land.target.region === 'W') {
        wall += land.p;
        continue;
      }
      const o = resolveThrow(this.aim, { ...base, landing: land.target }).result;
      if (o.outcome === 'CHECKOUT') finish += land.p;
      else if (o.outcome === 'BUST') bust += land.p;
    }
    this.preview = {
      target: { ...this.aim },
      hit: this.night.trueAim ? 100 : hitChance(this.aim, steady + (use.includes('steady') ? 25 : 0)),
      value: straight.totalValue,
      leaves: straight.outcome === 'BUST' ? visit.scoreAtVisitStart : straight.scoreCommitted,
      bust: Math.round(bust * 100),
      finish: Math.round(finish * 100),
      wall: Math.round(wall * 100),
      dist,
    };
  }

  /** The line under the board: what this dart is for. */
  private describeAim(): void {
    const p = this.preview;
    if (!p) return;
    const leg = this.leg;
    const bits: string[] = [`${targetNotation(p.target)} SCORES ${p.value}`];
    if (p.finish >= 100) bits.push('AND WINS THE LEG');
    else if (p.finish > 0) bits.push(`WINS ${p.finish}% OF THE TIME`);
    else if (p.bust >= 100) bits.push('AND BUSTS');
    else if (p.bust > 0) bits.push(`BUSTS ${p.bust}%`);
    else bits.push(`LEAVES ${p.leaves}`);
    // What it would do to the slate is the reason to aim anywhere unusual.
    const helps = this.contractsHelped(p.target);
    if (helps.length) bits.push(`· ${helps.join(', ')}`);
    this.readout = bits.join(' ');
    this.readoutColor = p.bust >= 50 ? P.EMBER : p.finish > 0 ? P.BRASS_LIT : helps.length ? P.BAIZE_LIT : P.MIST;
    void leg;
  }

  /** Names of contracts on the slate this landing would carry forward. */
  private contractsHelped(target: Target): string[] {
    const leg = this.leg;
    if (!leg || !leg.slate.length) return [];
    const out: string[] = [];
    const before = visitProgress(this.night, leg);
    for (const c of leg.slate) {
      if (c.settled || c.status === 'DEAD') continue;
      const def = contractDef(c.defId);
      const value = resolveThrow(target, {
        chalk: this.night.chalk,
        rng: null,
        landing: target,
        scoreBefore: leg.score,
        scoreAtVisitStart: currentVisit(leg).scoreAtVisitStart,
        visitThrowIndex: currentVisit(leg).throws.length as 0 | 1 | 2 | 3,
        forgivenessUsed: true,
      }).result;
      const after = {
        ...before,
        values: [...before.values, value.totalValue],
        hits: [...before.hits, value.hits[0] ? { ...value.hits[0].target } : null],
        left: Math.max(0, before.left - 1),
        now: value.outcome === 'BUST' ? before.from : value.scoreCommitted,
        busted: value.outcome === 'BUST',
        checkedOut: value.outcome === 'CHECKOUT',
      };
      const was = def.check(before);
      const now = def.check(after);
      if (now === 'MADE' && was !== 'MADE') out.push(`${def.name} LANDS`);
      else if (now === 'DEAD' && was !== 'DEAD') out.push(`${def.name} DIES`);
    }
    return out.slice(0, 2);
  }

  /** Rebuild the slate strip, the checkout route and the aim preview. */
  refresh(): void {
    const leg = this.leg;
    if (!leg) return;
    try {
      this.hints = computeCheckoutHints(this.night, leg);
    } catch {
      this.hints = null;
    }
    this.rebuildSlate();
    this.refreshPreview();
  }

  private rebuildSlate(): void {
    const leg = this.leg;
    const l = this.layout;
    const cards: SlateCardView[] = [];
    this.emptySlots = [];
    if (!leg || leg.status !== 'ACTIVE') {
      this.slate.cards = cards;
      return;
    }
    const riding = leg.slate.filter((c) => !c.settled);
    const showOffer = this.takingPhase;
    // The strip keeps a fixed number of slots all visit. During the throwing
    // phase the gaps left by settled contracts show what they did instead of
    // going blank, so the row reads as a ledger rather than emptying out.
    const slots = slateSize(this.night);
    type Item = { taken?: (typeof riding)[number]; offer?: string; done?: (typeof riding)[number] };
    const items: Item[] = riding.map((c) => ({ taken: c }));
    if (showOffer) for (const id of leg.offer) items.push({ offer: id });
    else for (const c of leg.slate) if (c.settled) items.push({ done: c });
    const rects = slateSlots(l, Math.max(slots, Math.min(slots + 1, items.length)));
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const it = items[i];
      if (!it) {
        this.emptySlots.push(rect);
        continue;
      }
      if (it.offer) {
        const def = contractDef(it.offer);
        const price = currentPrice(this.night, it.offer);
        const poor = this.night.pot < def.stake;
        cards.push({
          defId: it.offer,
          rect,
          mode: 'OFFER',
          index: -1,
          stake: def.stake,
          price,
          status: 'LIVE',
          unaffordable: poor,
          prices: { leftLabel: 'STAKE ', left: def.stake, rightLabel: 'PAYS ', right: price },
          verbs: layoutVerbs(rect, [{ id: 'TAKE', label: 'TAKE', disabled: poor || this.locked || !this.verbAllowed('TAKE') }]),
        });
        continue;
      }
      if (it.done) {
        const c = it.done;
        cards.push({
          defId: c.defId,
          rect,
          mode: 'SETTLED',
          index: leg.slate.indexOf(c),
          stake: c.stake,
          price: c.price,
          status: c.status,
          unaffordable: false,
          settled: c.settled,
          verbs: [],
        });
        continue;
      }
      const c = it.taken as (typeof riding)[number];
      const index = leg.slate.indexOf(c);
      const def = contractDef(c.defId);
      const made = c.status === 'MADE';
      const dead = c.status === 'DEAD';
      const canPress = made && !!def.pressTo && this.night.pot >= c.stake;
      const verbs = showOffer
        ? []
        : layoutVerbs(rect, [
            ...(made ? [{ id: 'BANK' as SlateVerbId, label: 'BANK', disabled: this.locked || !this.verbAllowed('BANK') }] : []),
            ...(canPress ? [{ id: 'PRESS' as SlateVerbId, label: 'PRESS', disabled: this.locked || !this.verbAllowed('PRESS') }] : []),
            ...(!made && !dead ? [{ id: 'PULL' as SlateVerbId, label: 'PULL', disabled: this.locked || !this.verbAllowed('PULL') }] : []),
          ]);
      cards.push({
        defId: c.defId,
        rect,
        mode: 'RIDING',
        index,
        stake: c.stake,
        price: c.price,
        status: c.status,
        unaffordable: false,
        // Made: what banking pays now against what it pays if it is left up.
        // Live: what pulling out pays now against what landing it would pay.
        prices: made
          ? { leftLabel: 'BANK ', left: c.stake + c.price, rightLabel: 'RIDE ', right: this.carryWorth(c) }
          : { leftLabel: 'PULL ', left: this.pullWorth(c), rightLabel: 'PAYS ', right: c.stake + c.price },
        verbs,
      });
    }
    this.slate.cards = cards;
  }

  private verbAllowed(v: SlateVerbId): boolean {
    const allow = this.hooks.allowedVerbs;
    return !allow || allow.includes(v);
  }

  private pullWorth(c: LegState['slate'][number]): number {
    return c.stake + interestOn(this.night, this.leg, c);
  }

  /** What a landed contract pays if it is left to settle instead of banked. */
  private carryWorth(c: LegState['slate'][number]): number {
    return c.stake + c.price + interestOn(this.night, this.leg, c);
  }

  // ---------------------------------------------------------------- the slate

  onSlateVerb(card: SlateCardView, verb: SlateVerbId): void {
    if (this.locked || this.busy) return;
    const l = this.layout;
    const mid = { x: card.rect.x + card.rect.w / 2, y: card.rect.y - 4 };
    let out: { ok: boolean; reason?: string; events: EngineEvent[] };
    switch (verb) {
      case 'TAKE':
        out = takeContract(this.night, card.defId);
        break;
      case 'BANK':
        out = bankContract(this.night, card.index);
        break;
      case 'PRESS':
        out = pressContract(this.night, card.index);
        break;
      case 'PULL':
        out = pullContract(this.night, card.index);
        break;
    }
    if (!out.ok) {
      this.app.sfx('error');
      this.readout = (out.reason ?? 'NOT NOW').toUpperCase();
      this.readoutColor = P.EMBER;
      return;
    }
    const def = contractDef(card.defId);
    if (verb === 'TAKE') {
      this.app.sfx('card_flip');
      this.slate.taken.fire(0.4);
      this.float(`-${def.stake}`, mid.x, mid.y, P.MIST, 1, 0.9);
      this.readout = `${def.name} TAKEN FOR ${def.stake}. IT PAYS ${card.price}.`;
      this.readoutColor = P.CHALK;
    } else if (verb === 'PRESS') {
      this.app.sfx('one_eighty', { volume: 0.5 });
      this.shake.hit(2, 0.2);
      const now = this.leg.slate[card.index];
      const nd = contractDef(now.defId);
      this.float('PRESSED', mid.x, mid.y, P.EMBER, 1, 1.3);
      this.readout = `PRESSED INTO ${nd.name}. ${now.stake} ON IT NOW, PAYING ${now.price}.`;
      this.readoutColor = P.EMBER;
    } else {
      const settled = this.leg.ledger[this.leg.ledger.length - 1];
      const pot = settled?.settled?.pot ?? 0;
      this.app.sfx('pot');
      this.float(`+${pot}`, mid.x, mid.y, P.BRASS_LIT, 1, 1.2);
      this.readout = verb === 'BANK' ? `${def.name} BANKED. ${pot} IN THE POT, AND NOTHING CAN TAKE IT.` : `PULLED OUT FOR ${pot}. NOT GREEDY.`;
      this.readoutColor = P.BRASS_LIT;
    }
    for (const e of out.events) this.bark(e);
    this.refresh();
    this.hooks.onEvent?.(out.events[0] ?? { type: 'LEG_START', legIndex: this.leg.index }, this);
    void l;
  }

  /** Wipe the offer and chalk three new contracts. Costs a RUB OUT. */
  rubOut(): void {
    if (this.locked || this.busy) return;
    const out = useRubOut(this.night);
    if (!out.ok) {
      this.app.sfx('error');
      return;
    }
    this.app.sfx('card_flip');
    this.readout = 'SLATE WIPED. THREE NEW ONES UP.';
    this.readoutColor = P.CHALK;
    this.refresh();
  }

  /** Arm or disarm an intervention for the next dart. */
  toggleKit(defId: string): void {
    if (this.locked || this.busy) return;
    if (kitCount(this.night, defId) === 0) {
      this.app.sfx('error');
      return;
    }
    const def = interventionDef(defId);
    if (def.when === 'SLATE') {
      this.rubOut();
      return;
    }
    this.armed = this.armed === defId ? null : defId;
    this.app.sfx('ui_move');
    this.readout = this.armed ? `${def.name}: ${def.blurb.toUpperCase()}` : 'NOTHING ON THIS DART.';
    this.readoutColor = this.armed ? P.SKY_LIT : P.MIST;
    this.refreshPreview();
  }

  // ---------------------------------------------------------------- throwing

  /** Throw at the wall on purpose: spends the dart, ends the visit, saves the score. */
  throwAtWall(): void {
    if (this.busy || this.locked || this.leg.status !== 'ACTIVE') return;
    if (!this.targetAllowed({ region: 'W' })) {
      this.app.sfx('error');
      return;
    }
    this.busy = true;
    this.locked = true;
    this.app.input.touchActivity();
    this.idleBarked = false;
    const from = { x: this.layout.launch.x, y: this.layout.launch.y };
    let out: { result: ThrowResult; events: EngineEvent[] };
    try {
      out = commitMiss(this.night);
    } catch (e) {
      console.error(e);
      this.busy = false;
      this.locked = false;
      return;
    }
    this.armed = null;
    this.lastResult = out.result;
    this.pendingEvents = out.events.filter((e) => e.type !== 'THROW');
    this.co.run(this.missSequence(from), () => {
      this.busy = false;
      this.unlock();
    });
  }

  private *missSequence(from: { x: number; y: number }): Routine {
    const l = this.layout;
    const to = { x: l.board.x - 14, y: l.board.y + 20 + Math.round(rndRange(-8, 8)) };
    this.dart = { from, to, ctrl: { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 26 }, t: 0, duration: 0.4, flight: 0, trail: [] };
    this.app.sfx('throw', { pitch: 0.9 });
    this.readout = '';
    yield () => !this.dart || this.dart.t >= 1;
    this.dart = null;
    this.app.sfx('thud', { pitch: 0.6, volume: 0.5 });
    this.shake.hit(1, 0.12);
    this.sparks(to.x, to.y, 4, P.MIST);
    this.float('WALKED AWAY', l.orientation === 'landscape' ? l.board.x + 30 : l.boardCentre.x, to.y - 8, P.MIST, 1, 1.3);
    this.readout = 'INTO THE WALL. NO SCORE, NO BUST, NOTHING PAID.';
    this.readoutColor = P.MIST;
    yield 0.5;
    for (const e of this.pendingEvents) yield* this.playEvent(e, this.lastResult as ThrowResult);
    this.pendingEvents = [];
  }

  /** Is this target one the tutorial is currently allowing? */
  private targetAllowed(t: Target): boolean {
    const allow = this.hooks.allowedTargets;
    return !allow || allow.some((a) => sameTarget(a, t));
  }

  /**
   * Force the landing of the next dart. The tutorial sets this to script a
   * hit or a miss on cue; play never touches it.
   */
  forceLanding: Target | null = null;

  /** Commit the dart at the current aim. */
  throwDart(): void {
    if (this.busy || this.locked || this.leg.status !== 'ACTIVE') return;
    if (!this.targetAllowed(this.aim)) {
      this.app.sfx('error');
      this.readout = 'NOT THAT ONE. FOLLOW THE POINTER.';
      this.readoutColor = P.EMBER;
      return;
    }
    this.busy = true;
    this.locked = true;
    this.app.input.touchActivity();
    this.idleBarked = false;
    const armed = this.armed;
    let out: { result: ThrowResult; events: EngineEvent[] };
    try {
      out = commitThrow(this.night, this.aim, { ...(armed ? { use: armed } : {}), ...(this.forceLanding ? { forceLanding: this.forceLanding } : {}) });
    } catch (e) {
      console.error(e);
      this.busy = false;
      this.locked = false;
      return;
    }
    this.armed = null;
    this.forceLanding = null;
    this.lastResult = out.result;
    this.pendingEvents = out.events.filter((e) => e.type !== 'THROW');
    const from = { x: this.layout.launch.x, y: this.layout.launch.y };
    this.co.run(this.throwSequence(out.result, from), () => {
      this.busy = false;
      this.unlock();
    });
  }

  /** Fast-forward the current throw's theatre (never the dart or the score count). */
  private hurry(): void {
    if (this.hooks.ownsFlow) return;
    this.co.hurry();
    this.bar.skip();
    this.app.input.touchActivity();
  }

  private unlock(): void {
    if (this.hooks.ownsFlow) return;
    if (this.leg.status !== 'ACTIVE' || this.night.phase !== 'LEG') return;
    this.locked = false;
    this.refresh();
  }

  /** Flight colour: hot for a treble, cold for a safe single. */
  private flightOf(t: Target): number {
    return t.region === 'T' ? 1 : t.region === 'D' ? 3 : t.region === 'IB' || t.region === 'OB' ? 2 : 0;
  }

  private *throwSequence(result: ThrowResult, from: { x: number; y: number }): Routine {
    const l = this.layout;
    const first = result.hits[0];
    const intended = result.aimed;
    const deflected = result.deflected;
    const inWall = !first;
    const flight = this.flightOf(intended);
    const to = inWall ? { x: l.board.x - 14, y: l.board.y + 20 + Math.round(rndRange(-8, 8)) } : this.board.landing(deflected ? intended : first.target);
    const duration = 0.34;
    this.dart = {
      from,
      to,
      ctrl: { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 26 },
      t: 0,
      duration,
      flight,
      trail: [],
    };
    this.app.sfx('throw', { pitch: 1 + (intended.region === 'T' ? 0.2 : 0) });
    this.readout = '';
    yield () => !this.dart || this.dart.t >= 1;
    this.dart = null;

    let land = to;
    if (inWall) {
      this.app.sfx('thud', { pitch: 0.6, volume: 0.5 });
      this.shake.hit(1, 0.12);
      this.sparks(to.x, to.y, 4, P.MIST);
      this.float('IN THE WALL', l.orientation === 'landscape' ? l.board.x + 30 : l.boardCentre.x, to.y - 8, P.EMBER, 1, 1.3);
      this.readout = `${targetNotation(intended)} MISSED THE BOARD. NO SCORE.`;
      this.readoutColor = P.EMBER;
      this.refresh();
      this.hooks.onEvent?.({ type: 'THROW', result }, this);
      this.bark({ type: 'THROW', result }, result);
      yield 0.5;
      for (const e of this.pendingEvents) yield* this.playEvent(e, result);
      this.pendingEvents = [];
      return;
    }
    if (result.aim === 'drift' || result.aim === 'lucky') {
      const lucky = result.aim === 'lucky';
      this.float(`${lucky ? 'LUCKY' : 'DRIFT'} → ${targetNotation(first.target)}`, l.boardCentre.x, l.board.y - 2, lucky ? P.BAIZE_LIT : P.MIST, 1, 1.2);
    }
    if (deflected) {
      this.app.sfx('wire');
      this.board.wired.fire(0.5);
      this.sparks(to.x, to.y, 6, P.BRASS_LIT);
      yield 0.12;
      land = this.board.landing(first.target);
    }
    this.impact(land, flight, 1);
    if (result.hits.length > 1) {
      yield 0.1;
      this.impact(this.board.landing(result.hits[1].target), flight, 0.6);
    }
    this.refresh();
    this.hooks.onEvent?.({ type: 'THROW', result }, this);

    const hitText = result.hits.map((h) => targetNotation(h.target)).join('+');
    const base = result.hits.reduce((a, h) => a + baseValue(h.target), 0);
    const labelPos = { x: l.boardCentre.x, y: l.orientation === 'landscape' ? l.board.y + 8 : l.board.y + 6 };
    let running = base;
    this.readout = `${hitText} = ${base}`;
    this.readoutColor = P.CHALK;
    this.float(`${hitText}`, labelPos.x, labelPos.y, P.CHALK, 1, 1.2);
    yield 0.18;
    let chain = 0;
    for (const step of result.trace) {
      const label = step.chalkId === 'doubled' || step.chalkId === 'insured' || step.chalkId === 'again' ? interventionDef(step.chalkId).name : chalkDef(step.chalkId).name.toUpperCase();
      let pulse = this.chalkPulse.get(step.chalkId);
      if (!pulse) {
        pulse = new Pulse();
        this.chalkPulse.set(step.chalkId, pulse);
      }
      pulse.fire(0.5);
      this.app.audio.chalkFire(chain);
      chain++;
      const total = step.values.reduce((a, b) => a + b, 0);
      const txt = step.stage === 'VALUE' || step.stage === 'DEAL' ? `${label} ${running}→${total}` : `${label}: ${step.note}`;
      running = total;
      this.readout = txt;
      this.readoutColor = step.stage === 'VALUE' ? P.BRASS_LIT : step.stage === 'BOARD' ? P.CLARET_LIT : step.stage === 'RULE' ? P.SKY_LIT : P.BAIZE_LIT;
      this.float(step.stage === 'VALUE' || step.stage === 'DEAL' ? `${total}` : step.note, labelPos.x, labelPos.y + 10 + chain * 2, this.readoutColor, 1, 1.1);
      this.app.audio.setCrowdTension(Math.min(1, 0.3 + chain * 0.12));
      yield chain >= 4 ? 0.2 : 0.26;
    }
    if (chain >= 4) this.shake.hit(1.5, 0.2);

    const value = result.totalValue;
    this.float(`-${value}`, labelPos.x, labelPos.y + 12, result.outcome === 'BUST' ? P.EMBER : P.BRASS_LIT, 2, 1.4);
    this.readout = `${hitText} SCORES ${value}`;
    this.readoutColor = P.CHALK;

    if (result.outcome === 'BUST') {
      this.score.set(result.scoreAfter, 0.25);
      yield () => this.score.settled;
      yield 0.1;
      this.app.sfx('bust');
      this.flash.fire(0.35);
      this.shake.hit(3, 0.3);
      this.bustStamp.fire(1.1);
      this.app.audio.setCrowdTension(0.15);
      this.readout = result.scoreAfter < 0 ? `BUST · ${-result.scoreAfter} TOO MANY` : result.scoreAfter === 1 ? 'BUST · NO DOUBLE FINISHES 1' : 'BUST · NOT A DOUBLE';
      this.readoutColor = P.EMBER;
      yield 0.55;
      this.score.set(result.scoreCommitted, 0.3);
      yield () => this.score.settled;
      yield 0.2;
    } else if (result.outcome === 'CHECKOUT') {
      this.score.set(0, 0.3);
      yield () => this.score.settled;
      this.app.sfx('checkout');
      this.goldFlash.fire(0.6);
      this.shake.hit(2, 0.3);
      this.confetti(l.boardCentre.x, l.boardCentre.y, 40);
      this.crowdJump.fire(1.2);
      this.app.audio.crowdRoar(0.9);
      this.readout = result.firedChalk.includes('straight_out') ? 'GAME SHOT · STRAIGHT OUT' : result.firedChalk.includes('overshoot') ? 'GAME SHOT · OVERSHOOT' : `GAME SHOT · ${targetNotation(result.hits[result.hits.length - 1].target)}`;
      this.readoutColor = P.BRASS_LIT;
      yield 0.3;
    } else {
      if (result.forgiven) {
        this.readout = 'FORGIVEN · THAT ONE NEVER HAPPENED';
        this.readoutColor = P.SKY_LIT;
        this.app.sfx('unlock');
        yield 0.4;
      } else {
        this.score.set(result.scoreCommitted, 0.3);
        this.scoreBump.fire(0.3);
        yield () => this.score.settled;
      }
      if (result.scoreCommitted === 170) this.float('THE BIG FISH', l.score.x + l.score.w / 2, l.score.y - 4, P.BRASS_LIT, 1, 1.5);
    }
    this.app.audio.setCrowdTension(0.2 + (1 - this.leg.score / LEGS[this.leg.index].start) * 0.4);
    this.bark({ type: 'THROW', result }, result);

    for (const e of this.pendingEvents) yield* this.playEvent(e, result);
    this.pendingEvents = [];
  }

  private *playEvent(e: EngineEvent, result: ThrowResult): Routine {
    const l = this.layout;
    switch (e.type) {
      case 'CONTRACT_SETTLED': {
        const c = e.contract;
        const def = contractDef(c.defId);
        const s = c.settled;
        if (!s) break;
        const profit = s.pot - c.stake;
        const spot = { x: l.slate.x + l.slate.w / 2, y: l.slate.y - 2 };
        if (s.how === 'PAID') {
          this.app.sfx('pot');
          this.app.audio.crowdRoar(0.4);
          this.float(`${def.name} +${profit}`, spot.x, spot.y, P.BRASS_LIT, 1, 1.5);
          this.readout = `${def.name} PAYS. ${s.pot} INTO THE POT.`;
          this.readoutColor = P.BRASS_LIT;
        } else if (s.how === 'LOST') {
          this.slate.lost.fire(0.8);
          this.app.sfx('lose_sting', { volume: 0.5 });
          this.float(`${def.name} LOST ${c.stake}`, spot.x, spot.y, P.EMBER, 1, 1.5);
          this.readout = `${def.name} GOES. ${c.stake} OFF THE SLATE.`;
          this.readoutColor = P.EMBER;
        }
        this.bark(e, result);
        this.refresh();
        yield s.how === 'LOST' || s.how === 'PAID' ? 0.5 : 0.15;
        this.hooks.onEvent?.(e, this);
        break;
      }
      case 'VISIT_END': {
        if (!e.busted) {
          const txt = `VISIT ${e.total}`;
          this.float(txt, l.score.x + l.score.w / 2, l.score.y + l.score.h + 2, e.total >= 100 ? P.BRASS_LIT : P.MIST, 1, 1.3);
          if (e.total >= 100 && e.total < 180) this.app.audio.crowdRoar(0.35 + (e.total - 100) / 200);
        }
        if (e.missed) {
          this.readout = 'INTO THE WALL. VISIT OVER, SCORE SAFE.';
          this.readoutColor = P.MIST;
        } else if (!e.busted && e.heat > 0) {
          this.heatPulse.fire(0.6);
          this.app.audio.setCrowdTension(0.25 + (e.heat / HEAT_CAP) * 0.55);
        }
        if (e.total < 180 && !e.busted && !e.missed) this.bark(e, result);
        this.hooks.onEvent?.(e, this);
        break;
      }
      case 'ONE_EIGHTY': {
        yield* this.oneEighty(e.total);
        this.bark(e, result);
        this.hooks.onEvent?.(e, this);
        break;
      }
      case 'SLATE_OFFERED': {
        // A fresh visit: three contracts up, and the sights back to the route.
        yield 0.12;
        this.aim = this.openingAim();
        this.refresh();
        const v = currentVisit(this.leg);
        if (this.leg.visits.length > 1) {
          const steady = steadinessOf(this.night, this.leg);
          this.readout = `VISIT ${v.index + 1} OF ${this.leg.visitLimit} · THREE UP ON THE SLATE${steady > 0 ? ` · CROWD +${steady} ON EVERY CHANCE` : ''}`;
          this.readoutColor = this.leg.visitLimit - v.index <= 2 ? P.EMBER : P.MIST;
        }
        this.bark(e, result);
        yield 0.3;
        this.locked = false;
        this.hooks.onEvent?.(e, this);
        this.hooks.onReady?.(this);
        if (this.leg.visitLimit - this.leg.visits.length === 0 && v.throws.length === 0) {
          this.float('LAST VISIT', l.score.x + l.score.w / 2, l.score.y - 4, P.EMBER, 1, 1.6);
        }
        break;
      }
      case 'CHECKOUT': {
        this.bark(e, result);
        this.hooks.onEvent?.(e, this);
        if (this.hooks.ownsFlow) break;
        yield 0.6;
        if (e.legIndex < 7) this.openCheckoutOverlay();
        break;
      }
      case 'HEAT_LOST': {
        this.heatLost.fire(1.1);
        this.app.sfx('lose_sting', { volume: e.reason === 'MISS' ? 0.3 : 0.5 });
        this.float(e.reason === 'MISS' ? 'CROWD GOES COLD' : 'CROWD COOLS', l.orientation === 'landscape' ? 240 : l.w / 2, l.orientation === 'landscape' ? 16 : 112, P.EMBER, 1, 1.3);
        yield 0.3;
        this.hooks.onEvent?.(e, this);
        break;
      }
      case 'STREAK_LOST': {
        this.app.sfx('bust', { volume: 0.6, pitch: 0.8 });
        this.shake.hit(1.5, 0.2);
        this.float(`CLEAN SHEET GONE ×${streakMultiplier(e.from + 1)} → ×1`, l.score.x + l.score.w / 2, l.score.y + l.score.h + 12, P.EMBER, 1, 1.8);
        this.readout = `THE CLEAN SHEET IS GONE. ${e.from} LEG${e.from === 1 ? '' : 'S'} OF IT.`;
        this.readoutColor = P.EMBER;
        yield 0.5;
        this.hooks.onEvent?.(e, this);
        break;
      }
      case 'ACHIEVEMENT': {
        const unlocked = this.app.save.unlock(e.oche);
        if (unlocked) {
          this.bark(e, result);
          this.app.sfx('unlock');
          const def = OCHE_BY_ID[e.oche];
          this.bigText = { text: 'OCHE UNLOCKED', sub: def.name.toUpperCase(), pulse: new Pulse(), color: P.SKY_LIT };
          this.bigText.pulse.fire(2.2);
          yield 1.0;
        }
        this.hooks.onEvent?.(e, this);
        break;
      }
      case 'LEG_TIMEOUT': {
        yield 0.4;
        this.app.sfx('lose_sting');
        const close = this.leg.score <= 60 && !!this.hints?.best;
        this.bigText = { text: 'TIMED OUT', sub: `${close ? 'SO CLOSE' : legName(e.legIndex).toUpperCase()} · ${this.leg.score} LEFT`, pulse: new Pulse(), color: P.EMBER };
        this.bigText.pulse.fire(2.4);
        this.bark(e, result);
        this.app.audio.setCrowdTension(0.05);
        this.hooks.onEvent?.(e, this);
        yield 2.2;
        break;
      }
      case 'NIGHT_LOST': {
        this.hooks.onEvent?.(e, this);
        if (this.hooks.ownsFlow) break;
        this.app.toLoss();
        break;
      }
      case 'NIGHT_WON': {
        this.hooks.onEvent?.(e, this);
        if (this.hooks.ownsFlow) break;
        this.bigText = { text: 'THE NIGHT', sub: 'IS YOURS', pulse: new Pulse(), color: P.BRASS_LIT };
        this.bigText.pulse.fire(2.6);
        this.confetti(l.w / 2, l.h / 2, 80);
        yield 2.4;
        this.app.toWin();
        break;
      }
      default:
        this.hooks.onEvent?.(e, this);
    }
  }

  private *oneEighty(total: number): Routine {
    const l = this.layout;
    this.app.sfx('one_eighty');
    this.app.audio.crowdRoar(1);
    this.crowdJump.fire(1.6);
    this.flash.fire(0.5);
    this.shake.hit(5, 0.6);
    this.bigText = { text: total > 180 ? String(total) : '180', sub: 'ONE HUNDRED AND EIGHTY', pulse: new Pulse(), color: P.EMBER };
    this.bigText.pulse.fire(2.4);
    this.confetti(l.w / 2, l.h / 2, 90);
    yield 0.4;
    this.sparks(l.w / 2, l.h / 2, 30, P.BRASS_LIT);
    yield 1.4;
  }

  private impact(p: { x: number; y: number }, flight: number, strength: number): void {
    this.board.addStuck(p.x, p.y, flight);
    this.app.sfx('thud', { pitch: 1 + rndRange(-0.08, 0.08), volume: strength });
    this.shake.hit(1.5 * strength, 0.15);
    this.sparks(p.x, p.y, 5, P.MIST);
  }

  private sparks(x: number, y: number, n: number, color: number): void {
    this.particles.emit(n, () => ({
      x,
      y,
      vx: rndRange(-70, 70),
      vy: rndRange(-90, 10),
      life: rndRange(0.25, 0.5),
      gravity: 160,
      sprite: 'spark',
      frame: color === P.BRASS_LIT ? 0 : color === P.EMBER ? 2 : color === P.SKY_LIT ? 3 : 1,
    }));
  }

  private confetti(x: number, y: number, n: number): void {
    this.particles.emit(n, (i) => ({
      x: x + rndRange(-20, 20),
      y: y + rndRange(-10, 10),
      vx: rndRange(-90, 90),
      vy: rndRange(-160, -40),
      life: rndRange(0.9, 1.8),
      gravity: 110,
      drag: 1.2,
      sprite: 'confetti',
      frame: i % 4,
    }));
  }

  private float(text: string, x: number, y: number, color: number, scale = 1, life = 1): void {
    this.floaters.push({ text, x, y, life, max: life, color, scale, vy: -12 });
    if (this.floaters.length > 8) this.floaters.shift();
  }

  // ---------------------------------------------------------------- overlays

  private openCheckoutOverlay(): void {
    this.overlay = 'checkout';
    this.checkoutPanelT = 0;
    this.buttons.clear();
    const l = this.layout;
    const pw = l.orientation === 'landscape' ? 210 : 168;
    const ph = 150;
    const px = Math.floor((l.w - pw) / 2);
    const py = Math.floor((l.h - ph) / 2) - (l.orientation === 'landscape' ? 8 : 24);
    this.buttons.add({
      id: 'continue',
      rect: { x: px + Math.floor(pw / 2) - 48, y: py + ph - 22, w: 96, h: 16 },
      label: this.night.legIndex >= 7 ? 'THE NIGHT IS YOURS' : 'TO THE SHOP',
      primary: true,
      onPress: () => {
        this.app.sfx('ui_confirm');
        this.overlay = 'none';
        this.app.toShop();
      },
    });
    this.buttons.focusFirst();
    this.app.sfx('pot');
  }

  openPause(): void {
    if (this.overlay !== 'none') return;
    this.overlay = 'pause';
    this.buttons.clear();
    const l = this.layout;
    const bw = 110;
    const bx = Math.floor((l.w - bw) / 2);
    const by = Math.floor(l.h / 2) - 34;
    this.buttons.add({ id: 'resume', rect: { x: bx, y: by, w: bw, h: 16 }, label: 'RESUME', primary: true, onPress: () => this.closeOverlay() });
    this.buttons.add({
      id: 'settings',
      rect: { x: bx, y: by + 20, w: bw, h: 16 },
      label: 'SETTINGS',
      onPress: () => {
        this.app.sfx('ui_confirm');
        this.app.toSettings(() => this.app.toGame());
      },
    });
    this.buttons.add({
      id: 'quit',
      rect: { x: bx, y: by + 40, w: bw, h: 16 },
      label: 'ABANDON NIGHT',
      onPress: () => {
        this.app.sfx('ui_back');
        this.app.toTitle();
      },
    });
    this.buttons.focusFirst();
    this.app.sfx('ui_move');
  }

  closeOverlay(): void {
    this.overlay = 'none';
    this.buttons.clear();
    this.app.sfx('ui_back');
  }

  // ---------------------------------------------------------------- input

  private chipRects(): Rect[] {
    return chalkChips(this.layout, this.night.chalkSlots);
  }

  private pauseRect(): Rect {
    return { x: this.layout.w - 12, y: 0, w: 12, h: 12 };
  }

  onDown(p: Pointer): void {
    this.keyboardFocus = false;
    if (this.hooks.onDown?.(p, this)) return;
    if (this.overlay !== 'none') {
      this.buttons.down(p.x, p.y);
      return;
    }
    if (inRect(p.x, p.y, this.pauseRect())) {
      this.openPause();
      return;
    }
    const chips = this.chipRects();
    for (let i = 0; i < chips.length; i++) {
      if (inRect(p.x, p.y, chips[i]) && this.night.chalk[i]) {
        const id = this.night.chalk[i].def.id;
        this.chalkTip = this.chalkTip?.id === id ? null : { id, t: 4 };
        this.app.sfx('ui_move');
        return;
      }
    }
    const kit = kitChips(this.layout, this.night.kit.length);
    for (let i = 0; i < kit.length; i++) {
      if (inRect(p.x, p.y, kit[i])) {
        this.toggleKit(this.night.kit[i]);
        return;
      }
    }
    // Any tap while the result plays out hurries it along.
    if (this.busy) {
      this.hurry();
      return;
    }
    const verb = this.slate.verbAt(p.x, p.y);
    if (verb) {
      this.onSlateVerb(verb.card, verb.verb.id);
      return;
    }
    // Tapping the body of a contract reads it out in full: the strip is too
    // narrow to print a whole condition and the player must never have to
    // guess what they have staked on.
    const card = this.slate.at(p.x, p.y);
    if (card) {
      const def = contractDef(card.defId);
      this.readout = `${def.name}: ${def.blurb.toUpperCase()} STAKE ${card.stake}, PAYS ${card.price}.`;
      this.readoutColor = P.CHALK;
      this.app.sfx('ui_move');
      return;
    }
    if (inRect(p.x, p.y, this.layout.throwBtn)) {
      this.throwDart();
      return;
    }
    if (inRect(p.x, p.y, this.layout.miss)) {
      this.throwAtWall();
      return;
    }
    if (inRect(p.x, p.y, this.layout.commentary)) {
      this.bar.skip();
      return;
    }
    // The board: point at a target, or throw at the one already called.
    const t = targetAt(this.layout, p.x, p.y);
    if (t) {
      this.dragging = true;
      if (sameTarget(t, this.aim)) this.throwDart();
      else this.setAim(t);
    }
  }

  onMove(p: Pointer): void {
    if (this.overlay !== 'none') {
      this.buttons.move(p.x, p.y);
      return;
    }
    const card = this.slate.at(p.x, p.y);
    this.slate.hover = card ? this.slate.cards.indexOf(card) : -1;
    // Dragging on the board sweeps the sights, so a thumb can search for the
    // bed it wants instead of stabbing at a four-pixel band.
    if (this.dragging && !this.busy && !this.locked) {
      const t = targetAt(this.layout, p.x, p.y);
      if (t) this.setAim(t);
    }
  }

  onUp(p: Pointer): void {
    this.dragging = false;
    if (this.overlay !== 'none') {
      this.buttons.up(p.x, p.y);
      return;
    }
  }

  onCancel(): void {
    this.dragging = false;
    this.slate.hover = -1;
  }

  onKey(key: string): void {
    if (this.hooks.onKey?.(key, this)) return;
    if (this.overlay !== 'none') {
      if (key === 'Escape' && this.overlay === 'pause') {
        this.closeOverlay();
        return;
      }
      if (this.buttons.key(key)) this.keyboardFocus = true;
      return;
    }
    if (key === 'Escape') {
      this.openPause();
      return;
    }
    if (this.busy && (key === 'Enter' || key === ' ')) {
      this.hurry();
      return;
    }
    if (key === 'ArrowLeft') this.setAim(stepBed(this.aim, -1));
    else if (key === 'ArrowRight') this.setAim(stepBed(this.aim, 1));
    else if (key === 'ArrowUp') this.setAim(stepRing(this.aim, -1));
    else if (key === 'ArrowDown') this.setAim(stepRing(this.aim, 1));
    else if (key === 'Enter' || key === ' ') this.throwDart();
    else if (key >= '1' && key <= '4') {
      // Number keys work the slate: take, bank, press or pull the nth contract.
      const card = this.slate.cards[Number(key) - 1];
      if (card && card.verbs.length) this.onSlateVerb(card, card.verbs[0].id);
      else this.app.sfx('error');
    } else if (key === 'w' || key === 'W' || key === '0') {
      this.throwAtWall();
    } else if (key === 'k' || key === 'K') {
      if (this.night.kit.length) this.toggleKit(this.night.kit[0]);
    } else if (key === 'h' || key === 'H') {
      this.app.save.data.settings.checkoutHint = !this.app.save.data.settings.checkoutHint;
      this.app.save.persist();
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    this.time += dt;
    this.co.update(dt);
    this.board.update(dt);
    this.slate.update(dt);
    this.bar.update(dt);
    this.particles.update(dt);
    this.shake.update(dt);
    this.score.update(dt);
    this.flash.update(dt);
    this.goldFlash.update(dt);
    this.bustStamp.update(dt);
    this.scoreBump.update(dt);
    this.crowdJump.update(dt);
    this.heatPulse.update(dt);
    this.heatLost.update(dt);
    this.aimPulse.update(dt);
    for (const p of this.chalkPulse.values()) p.update(dt);
    if (this.bigText) {
      this.bigText.pulse.update(dt);
      if (!this.bigText.pulse.active) this.bigText = null;
    }
    if (this.chalkTip) {
      this.chalkTip.t -= dt;
      if (this.chalkTip.t <= 0) this.chalkTip = null;
    }
    if (this.legBanner) {
      this.legBanner.t += dt;
      if (this.legBanner.t > 2.2) this.legBanner = null;
    }
    for (const f of this.floaters) {
      f.life -= dt;
      f.y += f.vy * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    if (this.dart) {
      const d = this.dart;
      d.t = Math.min(1, d.t + dt / d.duration);
      const pos = this.dartPos(d.t);
      d.trail.unshift(pos);
      if (d.trail.length > 6) d.trail.pop();
    }
    if (this.overlay === 'checkout') this.checkoutPanelT = Math.min(1, this.checkoutPanelT + dt * 3);
    const idle = this.app.input.idleSeconds;
    if (!this.busy && this.overlay === 'none' && idle > 15 && !this.idleBarked && this.bar.idle) {
      this.idleBarked = true;
      this.bark({ type: 'IDLE', seconds: idle });
    }
    if (idle < 2) this.idleBarked = false;

    // The stuck guard. A previous build shipped a lock that never came off
    // after a mid-visit throw, and the player was left staring at a board that
    // would not take a dart. Nothing here should ever be locked while no
    // coroutine is running and no dart is in the air, so if that state lasts,
    // take the lock off rather than trapping anyone.
    const shouldBeLive = !this.busy && !this.dart && this.overlay === 'none' && !this.hooks.ownsFlow && this.night.phase === 'LEG' && this.leg?.status === 'ACTIVE';
    if (shouldBeLive && this.locked) {
      this.stuckFor += dt;
      if (this.stuckFor > 1.5) {
        this.stuckFor = 0;
        this.locked = false;
        this.refresh();
      }
    } else {
      this.stuckFor = 0;
    }
    this.hooks.update?.(dt, this);
  }

  private dartPos(t: number): { x: number; y: number } {
    const d = this.dart as DartFlight;
    const e = ease.outQuad(t);
    const u = 1 - e;
    return {
      x: u * u * d.from.x + 2 * u * e * d.ctrl.x + e * e * d.to.x,
      y: u * u * d.from.y + 2 * u * e * d.ctrl.y + e * e * d.to.y,
    };
  }

  // ---------------------------------------------------------------- draw

  draw(r: Renderer): void {
    const l = this.layout;
    r.offset(this.shake.x, this.shake.y, () => {
      this.drawBackground(r);
      this.drawCrowd(r);
      this.board.draw(r);
      this.drawAim(r);
      this.drawChrome(r);
      this.drawScore(r);
      for (const slot of this.emptySlots) drawEmptySlot(r, slot);
      this.slate.draw(r);
      this.drawKitStrip(r);
      this.drawChalkStrip(r);
      this.drawAimBar(r);
      this.drawButtons(r);
      this.drawReadout(r);
      this.drawDart(r);
      this.drawParticles(r);
      this.drawFloaters(r);
    });
    this.bar.draw(r, l.commentary);
    if (this.flash.active && this.app.save.data.settings.flashes) r.dither(0, 0, l.w, l.h, P.EMBER, this.flash.value * 10);
    if (this.goldFlash.active && this.app.save.data.settings.flashes) r.dither(0, 0, l.w, l.h, P.BRASS_LIT, this.goldFlash.value * 6);
    if (this.bustStamp.active) this.drawStamp(r, 'BUST', P.EMBER, this.bustStamp.value);
    if (this.bigText) this.drawBigText(r);
    if (this.legBanner) this.drawLegBanner(r);
    if (this.chalkTip) this.drawChalkTip(r);
    if (r.sprites.has('vignette') && l.orientation === 'landscape') r.sprite('vignette', 0, 0);
    if (this.overlay === 'checkout') this.drawCheckoutOverlay(r);
    if (this.overlay === 'pause') this.drawPauseOverlay(r);
    this.hooks.draw?.(r, this);
  }

  /** The sights and the fan of where the dart could actually finish. */
  private drawAim(r: Renderer): void {
    if (this.dart || this.busy || this.leg.status !== 'ACTIVE') return;
    const p = this.preview;
    if (p && this.app.save.data.settings.checkoutHint) drawFan(r, this.layout, this.aim, p.dist);
    drawAimMark(r, this.layout, this.aim, this.time);
  }

  private drawBackground(r: Renderer): void {
    const l = this.layout;
    r.clear(P.DEEP);
    if (r.sprites.has('wall')) {
      if (l.orientation === 'landscape') r.sprite('wall', 0, 0);
      else {
        r.sprite('wall', -70, 0);
        r.sprite('wall', -70, 132);
      }
    }
    if (r.sprites.has('oche_floor')) {
      const fy = l.orientation === 'landscape' ? 118 : 226;
      r.sprite('oche_floor', 0, fy);
      if (l.orientation === 'portrait') r.rect(0, fy + 48, l.w, l.h - fy - 48, P.DEEP);
    }
    if (r.sprites.has('light_cone')) r.sprite('light_cone', l.boardCentre.x - 32, l.board.y - 22);
    if (l.orientation === 'landscape') {
      r.nineSlice('panel_frame', l.score.x - 4, 13, l.score.w + 8, 52);
    } else {
      r.nineSlice('panel_frame', 2, 110, l.w - 4, 52);
    }
  }

  private drawCrowd(r: Renderer): void {
    const jump = this.crowdJump.value;
    for (const c of this.crowd) {
      const bob = Math.round(Math.sin(this.time * 2.2 + c.phase) * 1.2);
      const hop = jump > 0 ? Math.round(Math.abs(Math.sin(this.time * 14 + c.phase)) * 4 * jump) : 0;
      const canvas = r.sprites.tinted('crowd_head', `t${c.tint}`, (idx) => (idx === P.SHADE ? [P.SHADE, P.STONE, P.DEEP, P.PEWTER, P.CLARET][c.tint] : idx));
      r.canvas(canvas, c.x, c.y + bob - hop, 8, 8, c.frame);
    }
  }

  private drawChrome(r: Renderer): void {
    const l = this.layout;
    const leg = this.leg;
    r.rect(0, 0, l.w, 12, P.INK);
    r.rect(0, 12, l.w, 1, P.STONE);
    const used = leg.visits.length - (leg.status === 'ACTIVE' && currentVisit(leg)?.throws.length === 0 ? 1 : 0);
    const pipW = leg.visitLimit * 4;
    const pot = `${this.night.pot}`;
    const potX = l.w - 16;
    const pipX = l.w - 44 - pipW;
    const title = l.orientation === 'landscape' ? `${leg.index + 1}/8 ${legName(leg.index).toUpperCase()}` : `${leg.index + 1}/8`;
    const titleW = measureText(5, title);
    const shownTitle = titleW <= pipX - 8 ? title : `${leg.index + 1}/8`;
    r.text(shownTitle, 3, 3, { color: P.MIST });
    const gapL = 3 + measureText(5, shownTitle) + 8;
    if (pipX - gapL >= 56) {
      const sheet = leg.dirty ? 'SHEET OFF' : `SHEET ×${streakMultiplier(this.night.streak + 1)}`;
      const mult = streakMultiplier(this.night.streak + 1);
      r.text(sheet, Math.floor((gapL + pipX) / 2), 3, { color: leg.dirty ? P.STONE : mult >= 3 ? P.BRASS_LIT : mult === 2 ? P.BRASS : P.PEWTER, align: 'center' });
    }
    drawVisitPips(r, pipX, 3, used, leg.visitLimit);
    r.text(pot, potX, 3, { color: P.BRASS_LIT, align: 'right' });
    r.sprite('icons', potX - measureText(5, pot) - 10, 2, 5);
    r.sprite('icons', l.w - 10, 2, 14);
  }

  private drawScore(r: Renderer): void {
    const l = this.layout;
    const leg = this.leg;
    const shown = Math.round(this.score.shown);
    const color = this.bustStamp.active ? P.EMBER : shown === 0 ? P.BRASS_LIT : P.CHALK;
    const cx = l.score.x + Math.floor(l.score.w / 2);
    const bump = this.scoreBump.active ? Math.round(this.scoreBump.value * 2) : 0;
    if (l.orientation === 'landscape') r.text('REMAINING', l.scoreLabel.x, l.scoreLabel.y, { color: P.MIST });
    this.drawHeat(r);
    r.text(String(shown), cx, l.score.y - bump, { font: 9, scale: 3, color, align: 'center', shadow: P.INK });
    // The route out, which with free aim is a real darts finish rather than a
    // list of the cards you happen to hold. Showing it teaches the table.
    const hintOn = this.app.save.data.settings.checkoutHint;
    const cl = l.checkoutLine;
    if (hintOn && this.hints && leg.status === 'ACTIVE') {
      if (this.hints.best) {
        const route = routeNotation(this.hints.best);
        r.text('OUT', cl.x, cl.y, { color: P.PEWTER });
        r.text(route, cl.x + 22, cl.y, { color: P.BRASS_LIT });
        const w = 22 + measureText(5, route) + 6;
        if (cl.w - w > 40) r.text('TAP THE BOARD TO CALL IT', cl.x + cl.w, cl.y, { color: P.STONE, align: 'right' });
      } else if (this.hints.inRange) {
        r.text('OUT', cl.x, cl.y, { color: P.PEWTER });
        r.text('NO ROUTE FROM HERE', cl.x + 22, cl.y, { color: P.EMBER });
      } else {
        r.text('DOUBLE OUT', cl.x, cl.y, { color: P.STONE });
      }
    }
    const v = leg.status === 'ACTIVE' ? currentVisit(leg) : leg.visits[leg.visits.length - 1];
    if (v) {
      const per = throwsPerVisit(this.night);
      const parts: string[] = [];
      for (let i = 0; i < per; i++) {
        const t = v.throws[i];
        parts.push(t ? (t.forgiven ? 'X' : String(t.totalValue)) : '·');
      }
      const vl = l.visitLine;
      r.text(`VISIT ${v.index + 1}/${leg.visitLimit}`, vl.x, vl.y, { color: leg.visitLimit - v.index <= 1 ? P.EMBER : P.PEWTER });
      const darts = parts.join(' ');
      r.text(darts, vl.x + vl.w, vl.y, { color: P.MIST, align: 'right' });
      const total = visitTotal(v);
      if (total > 0 && v.throws.length > 1) {
        r.text(`${total}`, vl.x + vl.w - measureText(5, darts) - 5, vl.y, { color: P.BRASS, align: 'right' });
      }
    }
  }

  /**
   * The crowd gauge: four pips that fill as visits land without a bust, and
   * the Pot multiplier they are worth. A bust empties it in one go.
   */
  private drawHeat(r: Renderer): void {
    const l = this.layout;
    const leg = this.leg;
    const heat = Math.min(HEAT_CAP, leg.heat);
    const x = l.orientation === 'landscape' ? l.score.x + l.score.w - 4 : l.w - 6;
    const y = l.orientation === 'landscape' ? l.scoreLabel.y : 112;
    const mult = `x${(1 + heat / HEAT_CAP).toFixed(2).replace(/\.?0+$/, '')}`;
    const hot = heat >= HEAT_CAP;
    const bump = this.heatPulse.active ? 1 : 0;
    const lost = this.heatLost.active && Math.floor(this.time * 12) % 2 === 0;
    r.text(heat > 0 ? mult : 'x1', x, y - bump, { color: lost ? P.EMBER : hot ? P.BRASS_LIT : heat > 0 ? P.BRASS : P.STONE, align: 'right' });
    let px2 = x - measureText(5, heat > 0 ? mult : 'x1') - 3 - HEAT_CAP * 4;
    for (let i = 0; i < HEAT_CAP; i++) {
      const lit = i < heat;
      r.rect(px2, y + 1 - (lit ? bump : 0), 3, 5, lost ? P.EMBER : lit ? (hot ? P.BRASS_LIT : P.BRASS) : P.SHADE);
      px2 += 4;
    }
    if (l.orientation === 'landscape') r.text('CROWD', px2 - HEAT_CAP * 4 - 38, y, { color: P.PEWTER, align: 'left' });
  }

  /**
   * The kit: one-shot interventions, spent on a dart you have already chosen.
   * Three letters each, because two was unreadable and a picture would need
   * teaching; the full line goes to the readout when one is armed.
   */
  private drawKitStrip(r: Renderer): void {
    const l = this.layout;
    r.rect(l.kit.x - 2, l.kit.y - 1, l.kit.w + 4, l.kit.h + 2, P.INK);
    const chips = kitChips(l, this.night.kit.length);
    if (!chips.length) {
      r.text('KIT EMPTY', l.kit.x + 1, l.kit.y + 3, { color: P.STONE });
      return;
    }
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      const id = this.night.kit[i];
      const armed = this.armed === id;
      r.rect(c.x, c.y, c.w, c.h, armed ? P.SKY : P.SHADE);
      r.rectOutline(c.x, c.y, c.w, c.h, armed ? P.SKY_LIT : P.STONE);
      r.text(interventionDef(id).name.slice(0, 3), c.x + Math.floor(c.w / 2), c.y + 3, { color: armed ? P.CHALK : P.MIST, align: 'center' });
    }
    void INTERVENTIONS;
  }

  private drawChalkStrip(r: Renderer): void {
    const chips = this.chipRects();
    const chalk = this.night.chalk;
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      const held = chalk[i];
      if (!held) {
        r.dither(c.x, c.y, c.w, c.h, P.INK, 6);
        r.rectOutline(c.x, c.y, c.w, c.h, P.SHADE);
        continue;
      }
      const pulse = this.chalkPulse.get(held.def.id);
      const lit = pulse?.active ? 1 : 0;
      const lift = pulse?.active ? Math.round(pulse.value * 3) : 0;
      r.nineSlice('chalk_frame', c.x, c.y - lift, c.w, c.h, lit);
      const idx = CHALK_DEFS.findIndex((d) => d.id === held.def.id);
      r.sprite('chalk_icons', c.x + 3, c.y + 3 - lift, Math.max(0, idx));
    }
  }

  /** What the sights are on, and what it is worth. */
  private drawAimBar(r: Renderer): void {
    const l = this.layout;
    const b = l.aimBar;
    const p = this.preview;
    r.panel(b.x - 1, b.y - 1, b.w + 2, b.h + 2, P.INK, P.STONE);
    if (!p || this.leg.status !== 'ACTIVE') return;
    const risky = p.bust > 0 || p.wall > 0;
    r.text(aimLabel(p.target, p.hit), b.x + 1, b.y + 1, { color: p.hit >= 90 ? P.BAIZE_LIT : p.hit >= 60 ? P.BRASS : P.EMBER });
    const right: string[] = [];
    if (p.finish > 0) right.push(`OUT ${p.finish}%`);
    if (p.bust > 0) right.push(`BUST ${p.bust}%`);
    if (!right.length && p.wall > 0) right.push(`WALL ${p.wall}%`);
    if (!right.length) right.push(`LEAVES ${p.leaves}`);
    r.text(right[0], b.x + b.w - 1, b.y + 1, { color: p.finish > 0 ? P.BRASS_LIT : risky ? P.EMBER : P.MIST, align: 'right' });
    r.text(`SCORES ${p.value}`, b.x + 1, b.y + 10, { color: P.MIST });
    if (this.armed) r.text(interventionDef(this.armed).name, b.x + b.w - 1, b.y + 10, { color: P.SKY_LIT, align: 'right' });
  }

  private drawButtons(r: Renderer): void {
    const l = this.layout;
    const t = l.throwBtn;
    const ready = !this.locked && !this.busy && this.leg.status === 'ACTIVE';
    r.nineSlice('button', t.x, t.y, t.w, t.h, ready ? 1 : 0);
    if (ready) {
      const on = Math.floor(this.time * 3) % 2 === 0;
      r.rectOutline(t.x - 1, t.y - 1, t.w + 2, t.h + 2, on ? P.BRASS_LIT : P.BRASS);
    }
    r.text(ready ? `THROW ${targetNotation(this.aim)}` : 'THROW', t.x + Math.floor(t.w / 2), t.y + Math.floor((t.h - 7) / 2), {
      color: ready ? P.BRASS_LIT : P.PEWTER,
      align: 'center',
      shadow: P.INK,
    });
    const m = l.miss;
    // Walking away is a real tactic when the slate is against you, so it is a
    // plain button rather than a panic switch.
    r.nineSlice('button', m.x, m.y, m.w, m.h, 0);
    r.text('WALK AWAY', m.x + Math.floor(m.w / 2), m.y + Math.floor((m.h - 7) / 2), { color: ready ? P.MIST : P.PEWTER, align: 'center', shadow: P.INK });
  }

  private drawReadout(r: Renderer): void {
    const l = this.layout;
    const ro = l.readout;
    r.rect(ro.x - 3, ro.y - 1, ro.w + 6, ro.h + 2, P.INK);
    r.line(ro.x - 3, ro.y - 2, ro.x + ro.w + 2, ro.y - 2, P.SHADE);
    if (this.readout) {
      const maxLines = Math.max(1, Math.floor(ro.h / 9));
      const lines = r.wrap(this.readout, ro.w).slice(0, maxLines);
      lines.forEach((line, i) => r.text(line, ro.x, ro.y + 1 + i * 9, { color: this.readoutColor }));
    }
  }

  private drawDart(r: Renderer): void {
    const d = this.dart;
    if (!d) return;
    const pos = this.dartPos(d.t);
    for (let i = d.trail.length - 1; i >= 1; i--) {
      const p = d.trail[i];
      const frame = Math.min(3, Math.floor((i / d.trail.length) * 4));
      r.sprite('dart_trail', p.x - 8, p.y - 2, frame);
    }
    const next = this.dartPos(Math.min(1, d.t + 0.05));
    const ang = Math.atan2(next.y - pos.y, next.x - pos.x);
    let frame = Math.round(((ang * 180) / Math.PI + 90) / 45);
    frame = ((frame % 8) + 8) % 8;
    const canvas = r.sprites.tinted('dart', `f${d.flight}`, (idx) => (idx === P.SKY ? [P.SKY, P.CLARET_LIT, P.BAIZE_LIT, P.BRASS][d.flight] : idx));
    r.canvas(canvas, Math.round(pos.x) - 4, Math.round(pos.y) - 4, 9, 9, frame);
  }

  private drawParticles(r: Renderer): void {
    for (const p of this.particles.list) {
      const fade = p.life / p.maxLife;
      if (fade < 0.3 && Math.floor(this.time * 30) % 2 === 0) continue;
      r.sprite(p.sprite, Math.round(p.x), Math.round(p.y), p.frame);
    }
  }

  private drawFloaters(r: Renderer): void {
    for (const f of this.floaters) {
      const fade = f.life / f.max;
      if (fade < 0.25 && Math.floor(this.time * 20) % 2 === 0) continue;
      r.text(f.text, Math.round(f.x), Math.round(f.y), { color: f.color, scale: f.scale, align: 'center', shadow: P.INK });
    }
  }

  private drawStamp(r: Renderer, text: string, color: number, v: number): void {
    const l = this.layout;
    const pop = v > 0.85 ? 3 : 2;
    const cx = l.board.x + l.board.w / 2;
    const cy = l.board.y + 36;
    r.text(text, cx, cy, { font: 9, scale: pop, color, align: 'center', outline: P.INK });
  }

  private drawBigText(r: Renderer): void {
    const b = this.bigText as NonNullable<typeof this.bigText>;
    const l = this.layout;
    const v = b.pulse.value;
    const t = 1 - v;
    const scale = t < 0.15 ? 3 : 2;
    const cx = Math.floor(l.w / 2);
    const cy = l.orientation === 'landscape' ? 48 : 100;
    const bandTop = cy - 9;
    const bandH = (b.sub ? 12 * scale + 16 : 12 * scale + 8) + 4;
    r.dither(0, bandTop, l.w, bandH, P.INK, 14);
    r.rect(0, bandTop, l.w, 1, b.color);
    r.rect(0, bandTop + bandH - 1, l.w, 1, b.color);
    r.text(b.text, cx, cy, { font: 9, scale, color: b.color, align: 'center', outline: P.INK });
    if (b.sub) r.text(b.sub, cx, cy + 12 * scale + 5, { color: P.CHALK, align: 'center', shadow: P.INK });
  }

  private drawLegBanner(r: Renderer): void {
    const b = this.legBanner as NonNullable<typeof this.legBanner>;
    const l = this.layout;
    const t = b.t;
    const slide = t < 0.3 ? ease.outCubic(t / 0.3) : t > 1.8 ? 1 - ease.inCubic((t - 1.8) / 0.4) : 1;
    const w = 150;
    const x = Math.round(lerp(-w, Math.floor(l.w / 2 - w / 2), slide));
    const y = l.orientation === 'landscape' ? 36 : 50;
    r.panel(x, y, w, 28, P.DEEP, P.BRASS);
    r.text(b.text, x + w / 2, y + 5, { color: P.CHALK, align: 'center' });
    r.text(b.sub, x + w / 2, y + 15, { color: P.BRASS_LIT, align: 'center' });
  }

  private drawChalkTip(r: Renderer): void {
    const tip = this.chalkTip as NonNullable<typeof this.chalkTip>;
    const def = chalkDef(tip.id);
    const l = this.layout;
    const w = l.orientation === 'landscape' ? 170 : 168;
    const x = l.orientation === 'landscape' ? 4 : 6;
    const y = l.chalkStrip.y - 34;
    r.panel(x, y, w, 30, P.DEEP, P.BRASS);
    const stageColor = def.stage === 'VALUE' ? P.BRASS_LIT : def.stage === 'BOARD' ? P.CLARET_LIT : def.stage === 'RULE' ? P.SKY_LIT : P.BAIZE_LIT;
    r.text(def.name.toUpperCase(), x + 4, y + 3, { color: stageColor });
    r.text(def.stage, x + w - 4, y + 3, { color: P.PEWTER, align: 'right' });
    r.textWrap(def.blurb, x + 4, y + 12, w - 8, { color: P.CHALK });
  }

  private drawCheckoutOverlay(r: Renderer): void {
    const l = this.layout;
    const leg = this.leg;
    const rw = leg.reward;
    const pw = l.orientation === 'landscape' ? 210 : 168;
    const ph = 150;
    const px = Math.floor((l.w - pw) / 2);
    const py = Math.floor((l.h - ph) / 2) - (l.orientation === 'landscape' ? 8 : 24);
    r.dither(0, 0, l.w, l.h, P.INK, 8);
    const t = ease.outBack(this.checkoutPanelT);
    r.offset(0, Math.round((1 - t) * 40), () => {
      drawPanel(r, { x: px, y: py, w: pw, h: ph }, 'GAME SHOT');
      const x = px + 10;
      let y = py + 10;
      r.text(`${legName(leg.index).toUpperCase()} · ${leg.visits.length} VISITS`, px + pw / 2, y, { color: P.MIST, align: 'center' });
      y += 12;
      if (rw) {
        const slateWon = leg.ledger.reduce((a, c) => a + Math.max(0, (c.settled?.pot ?? 0) - c.stake), 0);
        const rows: [string, number, boolean][] = [
          ['LEG WON', rw.base, true],
          [`BIG FINISH (${rw.checkoutFrom})`, rw.bigFinish, rw.bigFinish > 0],
          ['CLEAN LEG', rw.cleanLeg, rw.cleanLeg > 0],
          ['NINE-DARTER', rw.nineDarter, rw.nineDarter > 0],
          [`CROWD ×${(1 + rw.heat / HEAT_CAP).toFixed(2).replace(/\.?0+$/, '')}`, rw.heatBonus, rw.heatBonus > 0],
          [rw.streak > 0 ? `CLEAN SHEET ×${rw.streakMult}` : 'CLEAN SHEET', rw.streakBonus, rw.streakMult > 1],
          ['OFF THE SLATE', slateWon, slateWon > 0],
        ];
        const shown = Math.floor(this.checkoutPanelT * rows.length + 0.5);
        rows.forEach((row, i) => {
          if (i >= shown) return;
          const on = row[2];
          const slate = row[0] === 'OFF THE SLATE';
          r.text(row[0], x, y, { color: on ? (slate ? P.BAIZE_LIT : P.CHALK) : P.STONE });
          r.text(on ? `+${row[1]}` : '-', px + pw - 10, y, { color: on ? P.BRASS_LIT : P.STONE, align: 'right' });
          y += 9;
        });
        y += 3;
        r.text('POT', x, y, { color: P.MIST });
        r.text(`+${rw.total}  →  ${this.night.pot}`, px + pw - 10, y, { color: P.BRASS_LIT, align: 'right' });
      } else {
        r.text('THE DECIDER · CHECKED OUT', px + pw / 2, y + 10, { color: P.BRASS_LIT, align: 'center' });
      }
      this.buttons.draw(r, this.keyboardFocus);
    });
  }

  private drawPauseOverlay(r: Renderer): void {
    const l = this.layout;
    r.dither(0, 0, l.w, l.h, P.INK, 10);
    const bw = 130;
    const bx = Math.floor((l.w - bw) / 2);
    const by = Math.floor(l.h / 2) - 50;
    drawPanel(r, { x: bx, y: by, w: bw, h: 100 }, 'PAUSED');
    r.text(`SEED ${this.seedText()}`, bx + bw / 2, by + 84, { color: P.PEWTER, align: 'center' });
    this.buttons.draw(r, this.keyboardFocus);
  }

  seedText(): string {
    return seedToString(this.night.seed);
  }
}
