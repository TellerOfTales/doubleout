/**
 * The self-guided interactive tutorial: a scripted first leg on the real game
 * screen, a guided shop, and the moment the whole game turns on — a contract
 * that has landed, and the choice between taking the money and pressing it.
 *
 * Two structural rules, both learned the hard way. First, the prompt is a pure
 * function of the stage (`promptFor`), and `update` re-issues it whenever the
 * screen is idle with nothing on it. A tutorial that can silently end up with
 * no prompt and no button is a tutorial that traps the player, which is
 * exactly what happened at the "40 left" step of the previous one. Second,
 * every scripted dart forces its own landing, so a lesson about risk can show
 * a miss on cue instead of waiting for the RNG to supply one.
 */
import { P } from '../../art/palette';
import { parseTarget, sameTarget, targetNotation } from '../../core/board';
import { contractDef } from '../../core/slate';
import { addChalk, beginLeg, commitMiss, createNight, currentLeg, currentVisit, hasChalk, shopLeave } from '../../core/state';
import type { EngineEvent, LegState, NightState, ShopSlot, Target } from '../../core/types';
import type { App } from '../app';
import type { Renderer } from '../draw';
import { inRect, type Pointer } from '../input';
import { pointOf } from '../aim';
import { slateSlots, type Rect } from '../layout';
import type { SlateVerbId } from '../slateview';
import { GameScreen } from './game';
import { ShopScreen } from './shop';
import { ButtonSet } from '../widgets';

type Stage =
  | 'welcome'
  | 'aim'
  | 'risk'
  | 'meter'
  | 'throw_safe'
  | 'after_safe'
  | 'throw_treble'
  | 'after_treble'
  | 'throw_miss'
  | 'after_miss'
  | 'slate_intro'
  | 'take'
  | 'after_take'
  | 'throw_contract'
  | 'settle'
  | 'decide'
  | 'after_press'
  | 'throw_press'
  | 'wire'
  | 'bust_intro'
  | 'throw_bust'
  | 'after_bust'
  | 'finish_intro'
  | 'throw_finish'
  | 'gameshot'
  | 'shop'
  | 'done';

interface Prompt {
  text: string;
  /** 'bottom' pins the panel to a wide strip clear of the shop offers. */
  place?: 'auto' | 'bottom';
  target?: () => Rect | null;
  /** Label of the advance button; undefined = waiting for the player to act. */
  button?: string;
  onNext?: () => void;
  second?: { label: string; onPress: () => void };
}

const TUTORIAL_SEED = 20240501;

/** The scripted board positions, so the script reads as darts rather than ids. */
const T20 = parseTarget('T20');
const S20 = parseTarget('S20');
const S5 = parseTarget('S5');
const D20 = parseTarget('D20');
const T19 = parseTarget('T19');

class Tutorial {
  night: NightState;
  stage: Stage = 'welcome';
  prompt: Prompt | null = null;
  buttons = new ButtonSet();
  game: GameScreen | null = null;
  shop: ShopScreen | null = null;
  time = 0;
  /** Seconds the screen has been idle with no prompt. The dead-end guard. */
  private idle = 0;
  /** Where the sights were when the current stage began, for the aim lessons. */
  private aimAtEntry: Target | null = null;
  /** The target a scripted stage called, so wandering sights can be put back. */
  private scripted: Target | null = null;
  private wandered = 0;
  private w = 320;
  private h = 180;

  constructor(private app: App) {
    this.night = createNight(TUTORIAL_SEED, 'local');
    beginLeg(this.night);
    app.night = this.night;
  }

  get leg(): LegState {
    return currentLeg(this.night);
  }

  get portrait(): boolean {
    return this.app.screen.orientation === 'portrait';
  }

  // ---------------------------------------------------------------- scripting

  private setScore(score: number): void {
    const leg = this.leg;
    leg.score = score;
    const v = currentVisit(leg);
    if (v && v.throws.length === 0) v.scoreAtVisitStart = score;
    if (this.game) {
      this.game.score.snap(score);
      this.game.refresh();
    }
  }

  /** Chalk exactly these contracts up, so the lesson always has its example. */
  private setOffer(ids: string[]): void {
    this.leg.offer = ids.slice();
    this.game?.refresh();
  }

  /** Point the sights, and say what the next dart will do when it is thrown. */
  private script(target: Target, lands: Target = target): void {
    const g = this.game;
    if (!g) return;
    this.scripted = { ...target };
    this.wandered = 0;
    g.aim = { ...target };
    g.forceLanding = { ...lands };
    g.refreshPreview();
    g.hooks.allowedTargets = [target];
  }

  /**
   * No dart at all. The slate lessons happen before the first throw of a
   * visit, and a stray dart ends that window for good — so while one is
   * running, nothing on the board is a legal target.
   */
  private noThrow(): void {
    const g = this.game;
    if (!g) return;
    this.scripted = null;
    g.forceLanding = null;
    g.hooks.allowedTargets = [];
  }

  /**
   * The slate lessons only work at the top of a visit, because that is the
   * only time contracts can be taken. If a dart has already gone — however it
   * got thrown — walk the visit away so the next one starts clean. The
   * SLATE_OFFERED that follows re-enters this stage with a fresh slate.
   */
  private freshVisit(): boolean {
    const leg = this.leg;
    if (!leg || leg.status !== 'ACTIVE') return false;
    if (currentVisit(leg).throws.length === 0) return false;
    commitMiss(this.night);
    return true;
  }

  private freeAim(): void {
    const g = this.game;
    if (!g) return;
    this.scripted = null;
    g.forceLanding = null;
    g.hooks.allowedTargets = null;
  }

  private allowVerbs(v: SlateVerbId[] | null): void {
    if (this.game) this.game.hooks.allowedVerbs = v;
  }

  // ---------------------------------------------------------------- prompts

  private say(p: Prompt): void {
    this.prompt = p;
    this.idle = 0;
    this.buildButtons();
  }

  private buildButtons(): void {
    const b = this.buttons;
    b.clear();
    const panel = this.panelRect();
    const by = panel.y + panel.h - 20;
    const avail = panel.w - 10;
    const count = (this.prompt?.button ? 1 : 0) + (this.prompt?.second ? 1 : 0);
    const bw = count === 2 ? Math.min(60, Math.floor((avail - 6) / 2)) : Math.min(64, avail);
    const rightX = panel.x + panel.w - 5 - bw;
    if (this.prompt?.button) {
      b.add({
        id: 'next',
        rect: { x: rightX, y: by, w: bw, h: 16 },
        label: this.prompt.button,
        primary: true,
        onPress: () => {
          this.app.sfx('ui_confirm');
          this.prompt?.onNext?.();
        },
      });
    }
    if (this.prompt?.second) {
      b.add({
        id: 'second',
        rect: { x: rightX - bw - 6, y: by, w: bw, h: 16 },
        label: this.prompt.second.label,
        onPress: this.prompt.second.onPress,
      });
    }
    b.add({
      id: 'skip',
      rect: { x: this.w - 40, y: 0, w: 40, h: 12 },
      label: 'SKIP',
      onPress: () => {
        this.app.sfx('ui_back');
        this.finish(false);
      },
    });
    b.focusFirst();
  }

  private panelHeight(lines: number): number {
    return 12 + lines * 9 + (this.prompt?.button || this.prompt?.second ? 23 : 5);
  }

  private panelRect(): Rect {
    const t = this.prompt?.target?.();
    const text = this.prompt?.text ?? '';
    if (this.prompt?.place === 'bottom') {
      const w = this.w - 8;
      const h = this.panelHeight(this.lineCount(text, w - 10));
      return { x: 4, y: (this.portrait ? 284 : 156) - h - 2, w, h };
    }
    if (this.portrait) {
      const w = this.w - 8;
      const h = this.panelHeight(this.lineCount(text, w - 10));
      const low = !!t && t.y > 150;
      return low ? { x: 4, y: 16, w, h } : { x: 4, y: Math.min(300 - h, 302 - h), w, h };
    }
    // A target in the right column puts the panel over the board, and the
    // other way round, so the panel never sits on top of the thing it names.
    const left = !t || t.x >= 110;
    const w = left ? 100 : 186;
    const h = this.panelHeight(this.lineCount(text, w - 10));
    return left ? { x: 4, y: 16, w, h } : { x: 128, y: Math.min(16, 156 - h), w, h };
  }

  private lineCount(text: string, maxWidth: number): number {
    let lines = 1;
    let width = 0;
    for (const word of text.split(' ')) {
      const wWidth = word.length * 6 - 1;
      const next = width === 0 ? wWidth : width + 6 + wWidth;
      if (next > maxWidth && width > 0) {
        lines++;
        width = wWidth;
      } else width = next;
    }
    return lines;
  }

  // ---------------------------------------------------------------- targets

  private scoreRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.score.x + 40, y: l.score.y - 2, w: l.score.w - 80, h: 32 };
  }

  private boardRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.board.x - 2, y: l.board.y - 2, w: l.board.w + 4, h: l.board.h + 4 };
  }

  /** A small box around one target on the board, for pointing at the treble. */
  private spotRect(t: Target): Rect {
    const l = (this.game as GameScreen).layout;
    const p = pointOf(l, t);
    return { x: p.x - 5, y: p.y - 5, w: 10, h: 10 };
  }

  private meterRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.meter.x - 1, y: l.meter.y - 1, w: l.meter.w + 2, h: l.meter.h + 2 };
  }

  private aimBarRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.aimBar.x - 1, y: l.aimBar.y - 1, w: l.aimBar.w + 2, h: l.aimBar.h + 2 };
  }

  private slateRect(index = -1): Rect {
    const l = (this.game as GameScreen).layout;
    if (index < 0) return { x: l.slate.x + 2, y: l.slate.y - 2, w: l.slate.w - 4, h: l.slate.h + 4 };
    const card = this.game?.slate.cards[index];
    if (!card) return { x: l.slate.x + 2, y: l.slate.y - 2, w: l.slate.w - 4, h: l.slate.h + 4 };
    return { x: card.rect.x - 2, y: card.rect.y - 2, w: card.rect.w + 4, h: card.rect.h + 4 };
  }

  private throwRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.throwBtn.x - 1, y: l.throwBtn.y - 1, w: l.throwBtn.w + 2, h: l.throwBtn.h + 2 };
  }

  private checkoutRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.checkoutLine.x - 2, y: l.checkoutLine.y - 2, w: l.checkoutLine.w, h: 11 };
  }

  private chalkRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.chalkStrip.x, y: l.chalkStrip.y, w: 62, h: 20 };
  }

  // ---------------------------------------------------------------- the script

  start(): void {
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    this.game = new GameScreen(this.app, this.gameHooks());
    this.app.scenes.go(this.game);
  }

  private gameHooks() {
    return {
      ownsFlow: true,
      // The playtest harness reads this to say where a stuck tutorial stopped.
      stage: this.stage as string,
      allowedTargets: null as Target[] | null,
      allowedVerbs: null as SlateVerbId[] | null,
      onReady: (screen: GameScreen) => this.onReady(screen),
      onEvent: (e: EngineEvent, screen: GameScreen) => this.onEvent(e, screen),
      draw: (r: Renderer) => this.draw(r),
      update: (dt: number) => this.update(dt),
      onDown: (p: Pointer) => this.onDown(p),
      onKey: (key: string) => this.onKey(key),
    };
  }

  private onReady(screen: GameScreen): void {
    this.game = screen;
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    this.enter(this.stage);
  }

  private go(stage: Stage): void {
    this.stage = stage;
    if (this.game) (this.game.hooks as { stage?: string }).stage = stage;
    this.enter(stage);
  }

  /** Set the world up for a stage, then put its prompt on. */
  private enter(stage: Stage): void {
    const g = this.game;
    if (!g) return;
    g.locked = true;
    this.allowVerbs([]);
    this.freeAim();
    switch (stage) {
      case 'aim':
        g.locked = false;
        break;
      case 'risk':
        this.script(S20, S20);
        g.locked = false;
        break;
      case 'meter':
        this.script(S20, S20);
        break;
      case 'throw_safe':
        this.script(S20, S20);
        g.locked = false;
        break;
      case 'throw_treble':
        this.script(T20, T20);
        g.locked = false;
        break;
      case 'throw_miss':
        this.script(T20, S5);
        g.locked = false;
        break;
      case 'slate_intro':
        if (this.freshVisit()) return;
        this.setScore(301);
        this.setOffer(['ton', 'treble', 'clean_hands']);
        break;
      case 'take':
        if (this.freshVisit()) return;
        // One contract on the strip for this step. The three that pull against
        // each other were shown a moment ago; the lesson that follows is about
        // what happens to THIS one, so there is nothing else to take by
        // accident and no way to end up in a step the script cannot finish.
        this.setOffer(['treble']);
        this.allowVerbs(['TAKE']);
        this.noThrow();
        g.locked = false;
        break;
      case 'throw_contract':
        this.script(T20, T20);
        g.locked = false;
        break;
      case 'settle':
        this.noThrow();
        break;
      case 'decide':
        this.allowVerbs(['PRESS']);
        this.noThrow();
        g.locked = false;
        break;
      case 'throw_press':
        this.script(T20, T20);
        g.locked = false;
        break;
      case 'wire':
        this.noThrow();
        break;
      case 'bust_intro':
        if (this.freshVisit()) return;
        this.setScore(40);
        this.setOffer(['ton', 'left_pretty', 'clean_hands']);
        break;
      case 'throw_bust':
        this.setScore(40);
        this.script(T19, T19);
        g.locked = false;
        break;
      case 'finish_intro':
        this.setScore(40);
        break;
      case 'throw_finish':
        this.setScore(40);
        this.script(D20, D20);
        g.locked = false;
        break;
      default:
        break;
    }
    // Rebuild the strip last. Everything above may have locked the screen,
    // changed the offer or changed which verbs are allowed, and the buttons
    // are drawn disabled or not from exactly those three things.
    g.refresh();
    this.aimAtEntry = g.aim ? { ...g.aim } : null;
    const p = this.promptFor(stage);
    if (p) this.say(p);
  }

  /**
   * Every prompt in one place, keyed only by stage. Nothing else may set
   * `this.prompt`, so there is no path where a stage change leaves the screen
   * with nothing on it and no way forward.
   */
  private promptFor(stage: Stage): Prompt | null {
    const leg = this.leg;
    switch (stage) {
      case 'welcome':
        return {
          text: 'Welcome to the oche. This is your score. Get it to exactly zero. The last dart has to land on a DOUBLE.',
          target: () => this.scoreRect(),
          button: 'NEXT',
          onNext: () => this.go('aim'),
        };
      case 'aim':
        return {
          text: 'You aim wherever you like, every dart, all night. Tap the board to move the sights. Try a few places.',
          target: () => this.boardRect(),
        };
      case 'risk':
        return {
          text: 'The dots round the sights are where the dart might actually finish. A single twenty lands 97 times in a hundred. Tap the TREBLE twenty — the thin band — and watch that number.',
          target: () => this.spotRect(T20),
        };
      case 'meter':
        return {
          text: 'Forty-five percent, for triple the score. Look at the column beside the board: that is the same number as a height. The green band is the dart you called, and it is only that wide because a treble is only that likely. A single fills nearly the whole column.',
          target: () => this.meterRect(),
          button: 'NEXT',
          onNext: () => this.go('throw_safe'),
        };
      case 'throw_safe':
        return {
          text: 'The marker never stops. Tap THROW as it crosses the green and the dart goes where you called it; high and it goes long, low and it drops short. That gap is the whole game. Throw the single first.',
          target: () => this.throwRect(),
        };
      case 'after_safe':
        return {
          text: 'Twenty, exactly as called. Now the treble.',
          target: () => this.aimBarRect(),
          button: 'NEXT',
          onNext: () => this.go('throw_treble'),
        };
      case 'throw_treble':
        return { text: 'Sixty if it lands. Throw it.', target: () => this.spotRect(T20) };
      case 'after_treble':
        return {
          text: 'Sixty. That is what you are playing for. Throw one more at the treble.',
          target: () => this.throwRect(),
          button: 'NEXT',
          onNext: () => this.go('throw_miss'),
        };
      case 'throw_miss':
        return { text: 'Same dart, same aim.', target: () => this.spotRect(T20) };
      case 'after_miss':
        return {
          text: 'Five. Miss a treble and you usually land in the bed beside it, and once in a while nowhere at all. Nobody took that off you. You chose it.',
          target: () => this.boardRect(),
          button: 'NEXT',
          onNext: () => this.go('slate_intro'),
        };
      case 'slate_intro':
        return {
          text: 'Now the interesting part. Every visit, three contracts go up on the slate. Take one and you stake Pot on it. Land it before your three darts run out and it pays the printed price.',
          target: () => this.slateRect(),
          button: 'NEXT',
          onNext: () => this.go('take'),
        };
      case 'take':
        return {
          text: 'They pull in different directions on purpose: A TON wants the trebles, CLEAN wants three safe darts, and you cannot have both. Start with the cheap one. Take A TREBLE.',
          target: () => this.slateRect(this.offerIndex('treble')),
        };
      case 'after_take':
        return {
          text: 'Two off the Pot, and it pays two back on top if it lands. Now throw the treble.',
          target: () => this.throwRect(),
          button: 'NEXT',
          onNext: () => this.go('throw_contract'),
        };
      case 'throw_contract':
        return { text: 'Aim called. Throw it.', target: () => this.throwRect() };
      case 'settle':
        return {
          text: 'Two things to know before it lands. The offer stays open until two darts are left, at a longer price — so what lands on the board can still change what is worth taking. And a contract still going can be SETTLED for a share of what it would pay, which grows with every dart it survives.',
          target: () => this.slateRect(),
          button: 'NEXT',
          onNext: () => this.go('decide'),
        };
      case 'decide':
        return {
          text: 'That one landed, and it has already paid: the money is in the Pot and nothing on the board can reach it. Now the choice. PRESS puts double the stake back up on A PAIR, using the darts you have left. Press it.',
          target: () => this.slateRect(0),
        };
      case 'after_press':
        return {
          text: 'Four on it now. You need a second treble before the visit ends, or that four is gone. The first one is already paid and safe. That is the whole shape of it: win, then choose whether to put it back out.',
          target: () => this.slateRect(0),
          button: 'NEXT',
          onNext: () => this.go('throw_press'),
        };
      case 'throw_press':
        return { text: 'One more treble. Throw it.', target: () => this.throwRect() };
      case 'wire':
        return {
          text: 'Paid money is safe in the Pot — unless you put it back up. PUT IT UP moves a payout on to the WIRE, where it doubles for every visit it survives. Land nothing next visit, or bust, or put a dart off the board, and the whole wire goes. TAKE IT DOWN whenever you like.',
          target: () => this.slateRect(),
          button: 'NEXT',
          onNext: () => this.go('bust_intro'),
        };
      case 'bust_intro':
        return {
          text: `Forty left, and something you need to see. Go over, or land on one, and it is a BUST: the score goes back and every contract still riding on the slate goes with it. Money already paid, or settled, is safe. Money still riding is not.`,
          target: () => this.scoreRect(),
          button: 'NEXT',
          onNext: () => this.go('throw_bust'),
        };
      case 'throw_bust':
        return { text: 'Fifty-seven on forty left. Throw it and watch.', target: () => this.throwRect() };
      case 'after_bust':
        return {
          text: 'Back to forty, and the slate wiped. That is what banking is for, and why walking away from a visit is sometimes the right dart.',
          target: () => this.scoreRect(),
          button: 'NEXT',
          onNext: () => this.go('finish_intro'),
        };
      case 'finish_intro':
        return {
          text: `Forty left. The OUT line names the finish: ${this.routeText()}. Doubles miss half the time and go off the board when they do, which is why the last dart is the hard one.`,
          target: () => this.checkoutRect(),
          button: 'NEXT',
          onNext: () => this.go('throw_finish'),
        };
      case 'throw_finish':
        return { text: 'Double twenty for the leg. Throw it.', target: () => this.throwRect() };
      case 'gameshot':
        return {
          text: `Game shot. The Pot pays ${leg.reward?.total ?? 0} for the leg, and whatever you took off the slate is already in there. Between legs there is a shop.`,
          target: () => this.scoreRect(),
          button: 'TO THE SHOP',
          onNext: () => this.gotoShop(),
        };
      case 'done':
        return {
          text: 'That is the whole game. Eight legs, fewer visits each time. Aim where you like, take what you fancy, and know when to stop. Have a good night.',
          button: 'PLAY',
          onNext: () => this.finish(true),
          second: { label: 'MENU', onPress: () => this.finish(false) },
        };
      default:
        return null;
    }
  }

  private offerIndex(defId: string): number {
    const cards = this.game?.slate.cards ?? [];
    const i = cards.findIndex((c) => c.defId === defId && c.mode === 'OFFER');
    return i >= 0 ? i : -1;
  }

  private routeText(): string {
    const best = this.game?.hints?.best;
    return best ? best.targets.map(targetNotation).join(' then ') : 'double twenty';
  }

  // ---------------------------------------------------------------- reactions

  private onEvent(e: EngineEvent, screen: GameScreen): void {
    this.game = screen;
    switch (e.type) {
      case 'THROW': {
        switch (this.stage) {
          case 'throw_safe':
            this.go('after_safe');
            break;
          case 'throw_treble':
            this.go('after_treble');
            break;
          case 'throw_miss':
            this.go('after_miss');
            break;
          case 'throw_contract':
            this.go('settle');
            break;
          case 'throw_press':
            this.go('wire');
            break;
          case 'throw_bust':
            this.go('after_bust');
            break;
          default:
            // A dart the script did not ask for. It still spent the lock, and
            // nothing else will give it back while the tutorial owns the flow,
            // so put the stage back exactly as it was.
            this.enter(this.stage);
            break;
        }
        break;
      }
      case 'CONTRACT_TAKEN':
        if (this.stage === 'take' && e.contract.defId === 'treble') this.go('after_take');
        break;
      case 'CONTRACT_PRESSED':
        if (this.stage === 'decide') this.go('after_press');
        break;
      case 'CONTRACT_SETTLED':
        // The contract paid the moment it landed; the press window opens now.
        if (this.stage === 'throw_contract' && e.contract.settled?.how === 'PAID') this.go('settle');
        break;
      case 'CHECKOUT':
        this.go('gameshot');
        break;
      case 'LEG_TIMEOUT':
      case 'NIGHT_LOST':
        // Should never happen inside the script, but never trap the player.
        this.finish(false);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- shop, end

  private gotoShop(): void {
    this.stage = 'shop';
    const n = this.night;
    n.pot = Math.max(n.pot, 14);
    const slots: ShopSlot[] = [
      { kind: 'KIT', defId: 'steady', cost: 3, sold: false },
      { kind: 'KIT', defId: 'again', cost: 4, sold: false },
      { kind: 'CHALK', chalkId: 'hot_twenty', cost: 6, sold: false },
      { kind: 'SERVICE', service: 'STEADY', cost: 2, sold: false },
    ];
    n.shop = { slots, refreshed: false, afterLeg: 0 };
    n.phase = 'SHOP';
    this.shop = new ShopScreen(this.app, {
      allowRefresh: false,
      onReady: (s) => {
        this.shop = s;
        this.say({
          place: 'bottom',
          text: 'Chalk bends the rules for the rest of the night. Kit is one-shot, spent on a dart you have already chosen. Buy HOT TWENTY, then head TO THE OCHE.',
        });
      },
      onBuy: (slot) => {
        if (slot.kind === 'CHALK') {
          this.say({
            place: 'bottom',
            text: 'That chalk sits in a slot now and fires on every throw it applies to, in the order you bought it. Five slots, and a night is not long enough to fill them twice.',
          });
        } else if (slot.kind === 'KIT') {
          this.say({
            place: 'bottom',
            text: 'Kit goes on the strip under the board. Arm one, then throw, and it changes that dart. It never tells you where to aim.',
          });
        }
      },
      onLeave: () => {
        if (!hasChalk(n, 'hot_twenty')) addChalk(n, 'hot_twenty');
        this.app.sfx('ui_confirm');
        this.gotoDone();
        return true;
      },
      draw: (r) => this.draw(r),
      update: (dt) => this.update(dt),
      onDown: (p) => this.onDown(p),
    });
    this.app.scenes.go(this.shop);
  }

  private gotoDone(): void {
    this.stage = 'done';
    shopLeave(this.night);
    this.game = new GameScreen(this.app, this.gameHooks());
    this.app.scenes.go(this.game);
  }

  private finish(play: boolean): void {
    this.app.save.data.stats.tutorialDone = true;
    this.app.save.persist();
    // Change scene before clearing the night, never after: a screen that is
    // still current with no night to read from crashes on its next frame.
    if (play) {
      this.app.startNight(this.app.chosenSeed, this.app.chosenOche);
      return;
    }
    this.app.night = null;
    this.app.toTitle();
  }

  // ---------------------------------------------------------------- input / draw

  private update(dt: number): void {
    this.time += dt;
    const g = this.game;
    if (!g || this.stage === 'shop') return;
    // The two aim lessons watch the sights rather than the input, so they
    // advance whether the player moved them by pointer, by arrow key or by
    // dragging. Hooking one input device meant the other could not finish the
    // tutorial at all.
    if (this.stage === 'aim' && this.aimAtEntry && !sameTarget(g.aim, this.aimAtEntry)) {
      this.go('risk');
      return;
    }
    if (this.stage === 'risk' && g.aim.region === 'T') {
      this.go('meter');
      return;
    }
    // A scripted step will not accept a dart at anything but the target it
    // called. Rather than leave someone who moved the sights to have a look
    // unable to go on, put them back where the pointer is.
    if (this.scripted && !sameTarget(g.aim, this.scripted)) {
      this.wandered += dt;
      if (this.wandered > 1) {
        this.wandered = 0;
        this.script(this.scripted, g.forceLanding ?? this.scripted);
      }
    } else {
      this.wandered = 0;
    }

    // The dead-end guard. If the screen is sitting there with nothing to do —
    // no prompt, or a prompt that wants an action from a locked screen — put
    // the stage back up exactly as it was. A tutorial must always have a next
    // thing to do, and the previous one did not, which is how it trapped a
    // player at "40 left".
    const wantsAction = !!this.prompt && !this.prompt.button;
    const stalled = !this.prompt || (wantsAction && g.locked && !g.busy && !g.dart);
    if (stalled) {
      this.idle += dt;
      if (this.idle > 0.6) this.enter(this.stage);
    } else {
      this.idle = 0;
    }
  }

  private onDown(p: Pointer): boolean {
    if (this.buttons.down(p.x, p.y)) {
      this.buttons.up(p.x, p.y);
      return true;
    }
    if (this.prompt?.button && inRect(p.x, p.y, this.panelRect())) return true;
    return false;
  }

  private onKey(key: string): boolean {
    if (key === 'Escape') {
      this.finish(false);
      return true;
    }
    if (this.prompt?.button && (key === 'Enter' || key === ' ')) {
      this.prompt.onNext?.();
      return true;
    }
    // Throwing on a scripted step: put the sights back on the called target
    // first. Someone who moved them to look around should not have to hunt for
    // it again, and the pointer is on it either way.
    if ((key === 'Enter' || key === ' ') && this.scripted && this.game && !sameTarget(this.game.aim, this.scripted)) {
      this.script(this.scripted, this.game.forceLanding ?? this.scripted);
    }
    return false;
  }

  private draw(r: Renderer): void {
    const p = this.prompt;
    this.buttons.draw(r, false);
    if (!p) return;
    const panel = this.panelRect();
    const target = p.target?.() ?? null;
    if (target) {
      const on = Math.floor(this.time * 3) % 2 === 0;
      r.rectOutline(target.x - 1, target.y - 1, target.w + 2, target.h + 2, on ? P.BRASS_LIT : P.BRASS);
      const ax = target.x + Math.floor(target.w / 2) - 4;
      const above = panel.y + panel.h <= target.y;
      const bob = Math.round(Math.sin(this.time * 6) * 2);
      if (above) r.sprite('icons', ax, target.y - 11 + bob, 19);
      else if (panel.y >= target.y + target.h) r.sprite('icons', ax, target.y + target.h + 3 - bob, 18);
      else if (panel.x + panel.w <= target.x) r.sprite('icons', target.x - 11 + bob, target.y + Math.floor(target.h / 2) - 4, 17);
      else r.sprite('icons', target.x + target.w + 3 - bob, target.y + Math.floor(target.h / 2) - 4, 16);
    }
    r.dither(panel.x + 2, panel.y + 3, panel.w, panel.h, P.INK, 10);
    r.panel(panel.x, panel.y, panel.w, panel.h, P.DEEP, P.SKY_LIT);
    r.text('TUTORIAL', panel.x + 5, panel.y + 3, { color: P.SKY_LIT });
    const lines = r.wrap(p.text, panel.w - 10);
    lines.forEach((l, i) => r.text(l, panel.x + 5, panel.y + 12 + i * 9, { color: P.CHALK }));
    if (!p.button) {
      const on = Math.floor(this.time * 2) % 2 === 0;
      r.sprite('icons', panel.x + panel.w - 12, panel.y + panel.h - 11, on ? 28 : 25);
    }
    this.buttons.draw(r, false);
  }
}

export function startTutorial(app: App): void {
  const t = new Tutorial(app);
  t.start();
}

export { contractDef, slateSlots };
