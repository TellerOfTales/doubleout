/**
 * The leg screen: board, remaining score, hand, chalk strip, commentary
 * and every piece of feedback in between. The engine runs a throw in one
 * call; this screen choreographs what the player sees and hears.
 */
import { P } from '../../art/palette';
import { measureText } from '../../art/sprites';
import { CHALK_DEFS, chalkDef } from '../../content/chalkdefs';
import { OCHE_BY_ID } from '../../content/oches';
import { baseValue, targetNotation } from '../../core/board';
import { computeCheckoutHints, type CheckoutHints } from '../../core/checkout';
import { buildBarkContext } from '../../core/commentary';
import { resolveThrow } from '../../core/resolver';
import { commitCard, commitMiss, currentLeg, currentVisit, legName, throwsPerVisit, visitTotal } from '../../core/state';
import type { DartCard, EngineEvent, LegState, NightState, ThrowResult } from '../../core/types';
import type { App } from '../app';
import { BoardView } from '../boardview';
import { CommentaryBar } from '../commentarybar';
import type { Renderer } from '../draw';
import { Hand } from '../hand';
import { inRect, type Pointer } from '../input';
import { chalkChips, gameLayout, type GameLayout, type Rect } from '../layout';
import type { Scene } from '../scene';
import { Coroutines, Counter, Particles, Pulse, Shake, clamp01, ease, lerp, rndRange, type Routine } from '../tween';
import { ButtonSet, drawPanel, drawVisitPips } from '../widgets';

/** Hooks a tutorial (or test harness) can attach to the game screen. */
export interface GameHooks {
  /** Called with every engine event after its animation has played. */
  onEvent?(e: EngineEvent, screen: GameScreen): void;
  /** Called when the hand is dealt and interactive. */
  onReady?(screen: GameScreen): void;
  /** Draw on top of everything. */
  draw?(r: Renderer, screen: GameScreen): void;
  update?(dt: number, screen: GameScreen): void;
  /** Return true to swallow the pointer event. */
  onDown?(p: Pointer, screen: GameScreen): boolean;
  onKey?(key: string, screen: GameScreen): boolean;
  /** Suppress the normal end-of-leg flow (tutorial handles it). */
  ownsFlow?: boolean;
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

export class GameScreen implements Scene {
  layout: GameLayout;
  board: BoardView;
  hand: Hand;
  bar = new CommentaryBar();
  co = new Coroutines();
  particles = new Particles();
  shake = new Shake();
  score: Counter;
  flash = new Pulse(); // ember full-screen
  goldFlash = new Pulse(); // checkout
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
  tension = 0;
  time = 0;
  idleBarked = false;
  hooks: GameHooks;
  /** The throw currently animating (for hooks). */
  lastResult: ThrowResult | null = null;
  pendingEvents: EngineEvent[] = [];
  private lastEventIdle = 0;
  private busy = false;
  private legBanner: { text: string; sub: string; t: number } | null = null;
  private checkoutPanelT = 0;
  private scoreBump = new Pulse();
  private hintPulse = 0;

  constructor(
    public app: App,
    hooks: GameHooks = {},
  ) {
    this.hooks = hooks;
    this.layout = gameLayout(app.screen.width, app.screen.height);
    this.board = new BoardView(this.layout);
    this.hand = new Hand(this.layout, {
      onThrow: (card, from, v) => this.throwCard(card, from, v),
      onSelect: () => this.refreshHints(),
      onDeal: () => {},
      sound: (n) => app.sfx(n),
    });
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

  // ---------------------------------------------------------------- lifecycle

  enter(): void {
    this.resize();
    this.shake.enabled = this.app.save.data.settings.screenShake;
    this.hand.tapToThrow = this.app.save.data.settings.tapToThrow;
    this.hand.hintOn = this.app.save.data.settings.checkoutHint;
    this.buildCrowd();
    const l0 = this.layout.orientation;
    const leg = this.leg;
    this.score.snap(leg.score);
    this.board.clearDarts();
    this.readout = l0 === 'portrait' ? 'FLICK A CARD AT THE BOARD' : this.app.input.isTouch ? 'FLICK A CARD AT THE BOARD' : 'FLICK OR CLICK A CARD TO THROW';
    this.readoutColor = P.MIST;
    this.legBanner = this.hooks.ownsFlow ? null : { text: `LEG ${leg.index + 1} · ${legName(leg.index).toUpperCase()}`, sub: `${leg.visitLimit} VISITS`, t: 0 };
    this.app.sfx('card_flip');
    this.hand.locked = true;
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
    this.hand.setLayout(this.layout);
    this.bar.lines = this.layout.orientation === 'portrait' ? 4 : 2;
    this.buildCrowd();
  }

  private buildCrowd(): void {
    const l = this.layout;
    const legIdx = this.night ? this.night.legIndex : 0;
    const n = Math.min(22, 7 + legIdx * 2);
    this.crowd = [];
    const y = l.orientation === 'landscape' ? 121 : 123;
    const x0 = l.orientation === 'landscape' ? 2 : 4;
    const span = l.orientation === 'landscape' ? 120 : 172;
    for (let i = 0; i < n; i++) {
      const x = x0 + Math.round((i / Math.max(1, n - 1)) * (span - 8)) + Math.round(rndRange(-2, 2));
      this.crowd.push({ x, y: y + Math.round(rndRange(0, 3)), frame: Math.floor(rndRange(0, 6)), tint: Math.floor(rndRange(0, 5)), phase: rndRange(0, 6.28) });
    }
    this.crowd.sort((a, b) => a.y - b.y);
  }

  private *legIntro(): Routine {
    yield 0.05;
    // Deal the hand the engine already prepared.
    this.hand.deal(this.leg.hand);
    this.refreshHints();
    const ev: EngineEvent = this.leg.visits.length === 1 && this.leg.visits[0].throws.length === 0 ? { type: 'LEG_START', legIndex: this.leg.index } : { type: 'HAND_DEALT', hand: this.leg.hand, visitIndex: 0, throwIndex: 0 };
    this.bark(ev);
    yield 0.35;
    this.hand.locked = false;
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

  // ---------------------------------------------------------------- hints

  /** True when no card in hand can be thrown without busting. */
  get allBust(): boolean {
    const leg = this.leg;
    if (!leg || leg.hand.length === 0) return false;
    return leg.hand.every((c) => this.hand.bustIds.has(c.id));
  }

  refreshHints(): void {
    const leg = this.leg;
    if (!leg || leg.status !== 'ACTIVE') return;
    this.hints = computeCheckoutHints(this.night, leg);
    this.hand.routeStarts.clear();
    this.hand.bustIds.clear();
    this.hand.values.clear();
    const visit = currentVisit(leg);
    const ti = (visit ? visit.throws.length : 0) as 0 | 1 | 2 | 3;
    for (const c of leg.hand) {
      const r = resolveThrow(c, {
        chalk: this.night.chalk,
        rng: null,
        scoreBefore: leg.score,
        scoreAtVisitStart: visit ? visit.scoreAtVisitStart : leg.score,
        visitThrowIndex: ti,
        forgivenessUsed: true,
      }).result;
      this.hand.values.set(c.id, r.totalValue);
      if (r.outcome === 'BUST') this.hand.bustIds.add(c.id);
      if (this.hints.byHandCard.get(c.id)) this.hand.routeStarts.add(c.id);
    }
  }

  // ---------------------------------------------------------------- throwing

  /** Deliberately throw at the wall: spends the dart and the hand, scores nothing. */
  throwAtWall(): void {
    if (this.busy || this.hand.locked || this.leg.status !== 'ACTIVE') return;
    if (this.hooks.ownsFlow && this.hand.allowed !== null && this.hand.allowed.size > 0) {
      this.app.sfx('error');
      return;
    }
    this.busy = true;
    this.hand.locked = true;
    this.app.input.touchActivity();
    this.idleBarked = false;
    const from = { x: this.layout.launch.x, y: this.layout.launch.y };
    let out: { result: ThrowResult; events: EngineEvent[] };
    try {
      out = commitMiss(this.night);
    } catch (e) {
      console.error(e);
      this.busy = false;
      this.hand.locked = false;
      return;
    }
    this.hand.clear();
    this.lastResult = out.result;
    this.pendingEvents = out.events.filter((e) => e.type !== 'THROW');
    this.co.run(this.missSequence(from), () => {
      this.busy = false;
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
    this.float('MISSED ON PURPOSE', l.orientation === 'landscape' ? l.board.x + 30 : l.boardCentre.x, to.y - 8, P.MIST, 1, 1.3);
    this.readout = 'INTO THE WALL. NO SCORE, NO BUST.';
    this.readoutColor = P.MIST;
    yield 0.5;
    for (const e of this.pendingEvents) yield* this.playEvent(e, this.lastResult as ThrowResult);
    this.pendingEvents = [];
  }

  private throwCard(card: DartCard, from: { x: number; y: number }, v: { vx: number; vy: number }): void {
    if (this.busy) return;
    this.busy = true;
    this.hand.locked = true;
    this.app.input.touchActivity();
    this.idleBarked = false;
    let out: { result: ThrowResult; events: EngineEvent[] };
    try {
      out = commitCard(this.night, card.id);
    } catch (e) {
      console.error(e);
      this.busy = false;
      this.hand.locked = false;
      return;
    }
    this.lastResult = out.result;
    this.pendingEvents = out.events.filter((e) => e.type !== 'THROW');
    this.co.run(this.throwSequence(out.result, from, v), () => {
      this.busy = false;
    });
  }

  private *throwSequence(result: ThrowResult, from: { x: number; y: number }, v: { vx: number; vy: number }): Routine {
    const l = this.layout;
    const first = result.hits[0];
    const intended = result.intent.card.target;
    const deflected = result.deflected;
    // Fly to the intended target first; a deflection hops to the neighbour on impact.
    const to = this.board.landing(deflected ? intended : first.target);
    const speed = clamp01(Math.abs(v.vy) / 900);
    const duration = lerp(0.42, 0.24, speed);
    const arc = lerp(18, 40, speed);
    this.dart = {
      from,
      to,
      ctrl: { x: (from.x + to.x) / 2 + v.vx * 0.02, y: Math.min(from.y, to.y) - arc },
      t: 0,
      duration,
      flight: result.intent.card.flight,
      trail: [],
    };
    this.app.sfx('throw', { pitch: 1 + speed * 0.3 });
    this.readout = '';
    yield () => !this.dart || this.dart.t >= 1;
    this.dart = null;

    // impact
    let land = to;
    if (deflected) {
      this.app.sfx('wire');
      this.board.wired.fire(0.5);
      this.sparks(to.x, to.y, 6, P.BRASS_LIT);
      yield 0.12;
      land = this.board.landing(first.target);
    }
    this.impact(land, result.intent.card.flight, 1);
    // split tips: a second, lighter impact
    if (result.hits.length > 1) {
      yield 0.1;
      const p2 = this.board.landing(result.hits[1].target);
      this.impact(p2, result.intent.card.flight, 0.6);
    }
    this.hooks.onEvent?.({ type: 'THROW', result }, this);

    // value label + chalk chain
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
      const def = chalkDef(step.chalkId);
      let pulse = this.chalkPulse.get(step.chalkId);
      if (!pulse) {
        pulse = new Pulse();
        this.chalkPulse.set(step.chalkId, pulse);
      }
      pulse.fire(0.5);
      this.app.audio.chalkFire(chain);
      chain++;
      const total = step.values.reduce((a, b) => a + b, 0);
      const txt = step.stage === 'VALUE' || step.stage === 'DEAL' ? `${def.name.toUpperCase()} ${running}→${total}` : `${def.name.toUpperCase()}: ${step.note}`;
      running = total;
      this.readout = txt;
      this.readoutColor = step.stage === 'VALUE' ? P.BRASS_LIT : step.stage === 'BOARD' ? P.CLARET_LIT : step.stage === 'RULE' ? P.SKY_LIT : P.BAIZE_LIT;
      this.float(step.stage === 'VALUE' || step.stage === 'DEAL' ? `${total}` : step.note, labelPos.x, labelPos.y + 10 + chain * 2, this.readoutColor, 1, 1.1);
      this.app.audio.setCrowdTension(Math.min(1, 0.3 + chain * 0.12));
      yield chain >= 4 ? 0.2 : 0.26;
    }
    if (chain >= 4) this.shake.hit(1.5, 0.2);

    // subtract
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
    this.app.audio.setCrowdTension(0.2 + (1 - this.leg.score / 501) * 0.4);
    this.bark({ type: 'THROW', result }, result);

    // engine events in order
    for (const e of this.pendingEvents) yield* this.playEvent(e, result);
    this.pendingEvents = [];
  }

  private *playEvent(e: EngineEvent, result: ThrowResult): Routine {
    const l = this.layout;
    switch (e.type) {
      case 'VISIT_END': {
        if (!e.busted) {
          const txt = `VISIT ${e.total}`;
          this.float(txt, l.score.x + l.score.w / 2, l.score.y + l.score.h + 2, e.total >= 100 ? P.BRASS_LIT : P.MIST, 1, 1.3);
          if (e.total >= 100 && e.total < 180) this.app.audio.crowdRoar(0.35 + (e.total - 100) / 200);
        }
        if (e.total < 180 && !e.busted) this.bark(e, result);
        this.hooks.onEvent?.(e, this);
        break;
      }
      case 'ONE_EIGHTY': {
        yield* this.oneEighty(e.total);
        this.bark(e, result);
        this.hooks.onEvent?.(e, this);
        break;
      }
      case 'HAND_DEALT': {
        // discard the remaining cards then deal the new hand
        this.hand.clear();
        yield 0.12;
        this.hand.deal(e.hand);
        this.refreshHints();
        if (this.leg.visits.length > 1 && e.throwIndex === 0) {
          const v = this.leg.visits[this.leg.visits.length - 1];
          this.readout = `VISIT ${v.index + 1} OF ${this.leg.visitLimit}`;
          this.readoutColor = this.leg.visitLimit - v.index <= 2 ? P.EMBER : P.MIST;
        }
        if (this.leg.peek.length) this.float('PEEK', l.chalkStrip.x + 60, l.chalkStrip.y - 6, P.BAIZE_LIT, 1, 1);
        yield 0.3;
        this.hand.locked = false;
        this.hooks.onEvent?.(e, this);
        this.hooks.onReady?.(this);
        if (this.leg.visitLimit - this.leg.visits.length === 0 && this.leg.visits[this.leg.visits.length - 1].throws.length === 0) {
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
        this.bigText = { text: 'TIMED OUT', sub: `${legName(e.legIndex).toUpperCase()} · ${this.leg.score} LEFT`, pulse: new Pulse(), color: P.EMBER };
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
      case 'SHOP_OPEN': {
        this.hooks.onEvent?.(e, this);
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
    const pw = l.orientation === 'landscape' ? 200 : 164;
    const ph = 118;
    const px = Math.floor((l.w - pw) / 2);
    const py = Math.floor((l.h - ph) / 2) - (l.orientation === 'landscape' ? 4 : 20);
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
    // chalk chips → tooltip
    const chips = this.chipRects();
    for (let i = 0; i < chips.length; i++) {
      if (inRect(p.x, p.y, chips[i]) && this.night.chalk[i]) {
        const id = this.night.chalk[i].def.id;
        this.chalkTip = this.chalkTip?.id === id ? null : { id, t: 4 };
        this.app.sfx('ui_move');
        return;
      }
    }
    if (inRect(p.x, p.y, this.layout.miss)) {
      this.throwAtWall();
      return;
    }
    if (inRect(p.x, p.y, this.layout.commentary)) {
      this.bar.skip();
      return;
    }
    if (this.hand.onDown(p)) return;
    // tap the board with a selected card → throw (tap fallback)
    if (this.hand.selected && this.hand.tapToThrow && inRect(p.x, p.y, { x: this.layout.board.x - 10, y: this.layout.board.y - 10, w: this.layout.board.w + 20, h: this.layout.board.h + 20 })) {
      this.hand.throwSelected();
    }
  }

  onMove(p: Pointer): void {
    if (this.overlay !== 'none') {
      this.buttons.move(p.x, p.y);
      return;
    }
    this.hand.onMove(p);
  }

  onUp(p: Pointer): void {
    if (this.overlay !== 'none') {
      this.buttons.up(p.x, p.y);
      return;
    }
    this.hand.onUp(p);
  }

  onCancel(): void {
    this.hand.onCancel();
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
    if (key === 'ArrowLeft') this.hand.moveSelection(-1);
    else if (key === 'ArrowRight') this.hand.moveSelection(1);
    else if (key >= '1' && key <= '4') this.hand.selectIndex(Number(key) - 1);
    else if (key === 'Enter' || key === ' ' || key === 'ArrowUp') {
      if (!this.hand.selected) this.hand.selectIndex(0);
      else this.hand.throwSelected();
    } else if (key === 'm' || key === 'M' || key === '0') {
      this.throwAtWall();
    } else if (key === 'h' || key === 'H') {
      this.app.save.data.settings.checkoutHint = !this.app.save.data.settings.checkoutHint;
      this.hand.hintOn = this.app.save.data.settings.checkoutHint;
      this.app.save.persist();
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    this.time += dt;
    this.co.update(dt);
    this.board.update(dt);
    this.hand.update(dt);
    this.bar.update(dt);
    this.particles.update(dt);
    this.shake.update(dt);
    this.score.update(dt);
    this.flash.update(dt);
    this.goldFlash.update(dt);
    this.bustStamp.update(dt);
    this.scoreBump.update(dt);
    this.crowdJump.update(dt);
    this.hintPulse += dt;
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
    // idle chatter
    const idle = this.app.input.idleSeconds;
    if (!this.busy && this.overlay === 'none' && idle > 15 && !this.idleBarked && this.bar.idle) {
      this.idleBarked = true;
      this.bark({ type: 'IDLE', seconds: idle });
    }
    if (idle < 2) this.idleBarked = false;
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
      this.drawChrome(r);
      this.drawScore(r);
      this.drawChalkStrip(r);
      this.drawReadout(r);
      this.hand.draw(r);
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
      const fy = l.orientation === 'landscape' ? 132 : 250;
      r.sprite('oche_floor', 0, fy);
      if (l.orientation === 'portrait') r.rect(0, fy + 48, l.w, l.h - fy - 48, P.DEEP);
    }
    if (r.sprites.has('light_cone')) r.sprite('light_cone', l.boardCentre.x - 32, l.board.y - 22);
    // scoreboard slate behind the score
    if (l.orientation === 'landscape') {
      r.nineSlice('panel_frame', l.score.x - 4, 13, l.score.w + 8, 66);
    } else {
      r.nineSlice('panel_frame', 2, 130, l.w - 4, 58);
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
    // Right-align the pips against the Pot so a long leg name never collides.
    const pipX = l.w - 44 - pipW;
    const title = l.orientation === 'landscape' ? `${leg.index + 1}/8 ${legName(leg.index).toUpperCase()}` : `${leg.index + 1}/8`;
    const titleW = measureText(5, title);
    r.text(titleW <= pipX - 8 ? title : `${leg.index + 1}/8`, 3, 3, { color: P.MIST });
    drawVisitPips(r, pipX, 3, used, leg.visitLimit);
    r.text(pot, potX, 3, { color: P.BRASS_LIT, align: 'right' });
    r.sprite('icons', potX - measureText(5, pot) - 10, 2, 5);
    r.sprite('icons', l.w - 10, 2, 14);
  }

  private drawScore(r: Renderer): void {
    const l = this.layout;
    const leg = this.leg;
    const shown = Math.round(this.score.shown);
    const scale = l.orientation === 'landscape' ? 3 : 3;
    const color = this.bustStamp.active ? P.EMBER : shown === 0 ? P.BRASS_LIT : this.scoreBump.active ? P.CHALK : P.CHALK;
    const cx = l.score.x + Math.floor(l.score.w / 2);
    const bump = this.scoreBump.active ? Math.round(this.scoreBump.value * 2) : 0;
    if (l.orientation === 'landscape') r.text('REMAINING', l.scoreLabel.x, l.scoreLabel.y, { color: P.MIST });
    r.text(String(shown), cx, l.score.y - bump, { font: 9, scale, color, align: 'center', shadow: P.INK });
    // checkout hint line
    const hintOn = this.app.save.data.settings.checkoutHint;
    const cl = l.checkoutLine;
    if (hintOn && this.hints && leg.status === 'ACTIVE') {
      if (this.hints.best) {
        const route = this.hints.best.defIds.map((d) => targetNotation(this.night.library.find((c) => c.defId === d)?.target ?? { region: 'S', bed: 20 })).join(' ');
        r.text('OUT', cl.x, cl.y, { color: P.PEWTER });
        r.text(route, cl.x + 22, cl.y, { color: P.BRASS_LIT });
      } else if (this.hints.inRange) {
        r.text('OUT', cl.x, cl.y, { color: P.PEWTER });
        r.text('NO ROUTE IN THIS DECK', cl.x + 22, cl.y, { color: P.EMBER });
      } else {
        // Too far out for a route: just the standing reminder.
        r.text('FINISH ON A DOUBLE', cl.x, cl.y, { color: P.STONE });
      }
    }
    // visit line
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
      r.sprite('chalk_icons', c.x + 4, c.y + 4 - lift, Math.max(0, idx));
    }
    // pint on the ledge tracks the pot
    if (r.sprites.has('pint')) {
      const fill = Math.min(4, Math.floor(this.night.pot / 6));
      const l = this.layout;
      const px = l.orientation === 'landscape' ? l.chalkStrip.x + 114 : l.chalkStrip.x + 116;
      const py = l.chalkStrip.y + 4;
      r.sprite('pint', px, py, fill);
    }
  }

  private drawReadout(r: Renderer): void {
    const l = this.layout;
    const ro = l.readout;
    // Backing strip so the readout always reads over the carpet.
    r.dither(ro.x - 3, ro.y - 1, ro.w + 6, ro.h + 2, P.INK, 11);
    if (this.readout) {
      const maxLines = Math.max(1, Math.floor(ro.h / 9));
      const lines = r.wrap(this.readout, ro.w).slice(0, maxLines);
      lines.forEach((line, i) => r.text(line, ro.x, ro.y + 1 + i * 9, { color: this.readoutColor }));
    }
    this.drawMissButton(r);
  }

  private drawMissButton(r: Renderer): void {
    const m = this.layout.miss;
    const urgent = this.allBust && !this.hand.locked;
    const blocked = this.hooks.ownsFlow && this.hand.allowed !== null && this.hand.allowed.size > 0;
    const frame = blocked ? 0 : urgent ? 1 : 0;
    r.nineSlice('button', m.x, m.y, m.w, m.h, frame);
    if (urgent) {
      const on = Math.floor(this.time * 4) % 2 === 0;
      r.rectOutline(m.x - 1, m.y - 1, m.w + 2, m.h + 2, on ? P.EMBER : P.BRASS);
    }
    r.text('MISS', m.x + Math.floor(m.w / 2), m.y + Math.floor((m.h - 7) / 2), {
      color: blocked ? P.PEWTER : urgent ? P.EMBER : P.MIST,
      align: 'center',
      shadow: P.INK,
    });
  }

  private drawDart(r: Renderer): void {
    const d = this.dart;
    if (!d) return;
    const pos = this.dartPos(d.t);
    // trail
    for (let i = d.trail.length - 1; i >= 1; i--) {
      const p = d.trail[i];
      const frame = Math.min(3, Math.floor((i / d.trail.length) * 4));
      r.sprite('dart_trail', p.x - 8, p.y - 2, frame);
    }
    const next = this.dartPos(Math.min(1, d.t + 0.05));
    const ang = Math.atan2(next.y - pos.y, next.x - pos.x);
    // frame 0 points up; frames rotate 45° clockwise. up = -90°.
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
    const scale = 2;
    const pop = v > 0.85 ? 3 : 2;
    const cx = l.orientation === 'landscape' ? l.board.x + l.board.w / 2 : l.w / 2;
    const cy = l.orientation === 'landscape' ? l.board.y + 36 : l.board.y + 36;
    r.text(text, cx, cy, { font: 9, scale: pop, color, align: 'center', outline: P.INK });
    void scale;
  }

  private drawBigText(r: Renderer): void {
    const b = this.bigText as NonNullable<typeof this.bigText>;
    const l = this.layout;
    const v = b.pulse.value;
    const t = 1 - v;
    const scale = t < 0.15 ? 3 : 2;
    const cx = Math.floor(l.w / 2);
    const cy = l.orientation === 'landscape' ? 52 : 116;
    const bandTop = cy - 9;
    const bandH = (b.sub ? 12 * scale + 16 : 12 * scale + 8) + 4;
    // A full-width band: this is the loudest moment in the game, so nothing
    // behind it is allowed to compete with the words.
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
    const y = l.orientation === 'landscape' ? 40 : 56;
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
    const y = l.orientation === 'landscape' ? l.chalkStrip.y - 34 : l.chalkStrip.y - 34;
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
    const pw = l.orientation === 'landscape' ? 200 : 164;
    const ph = 118;
    const px = Math.floor((l.w - pw) / 2);
    const py = Math.floor((l.h - ph) / 2) - (l.orientation === 'landscape' ? 4 : 20);
    r.dither(0, 0, l.w, l.h, P.INK, 8);
    const t = ease.outBack(this.checkoutPanelT);
    r.offset(0, Math.round((1 - t) * 40), () => {
      drawPanel(r, { x: px, y: py, w: pw, h: ph }, 'GAME SHOT');
      const x = px + 10;
      let y = py + 10;
      r.text(`${legName(leg.index).toUpperCase()} · ${leg.visits.length} VISITS`, px + pw / 2, y, { color: P.MIST, align: 'center' });
      y += 12;
      if (rw) {
        const rows: [string, number, boolean][] = [
          ['LEG WON', rw.base, true],
          [`UNUSED VISITS ×${rw.unusedVisits}`, rw.unusedVisits, rw.unusedVisits > 0],
          [`BIG FINISH (${rw.checkoutFrom})`, rw.bigFinish, rw.bigFinish > 0],
          ['CLEAN LEG', rw.cleanLeg, rw.cleanLeg > 0],
          ['NINE-DARTER', rw.nineDarter, rw.nineDarter > 0],
        ];
        const shown = Math.floor(this.checkoutPanelT * 5 + 0.5);
        rows.forEach((row, i) => {
          if (i >= shown) return;
          const on = row[2];
          r.text(row[0], x, y, { color: on ? P.CHALK : P.STONE });
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
    // Imported lazily to keep this file's imports tidy.
    return seedString(this.night.seed);
  }
}

import { seedToString } from '../../core/rng';
function seedString(seed: number): string {
  return seedToString(seed);
}
