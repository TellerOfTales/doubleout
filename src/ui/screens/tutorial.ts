/**
 * The self-guided interactive tutorial: a scripted first leg on the real
 * game screen, a guided shop, and one throw with chalk. Every step waits
 * for the player to do the thing rather than read about it.
 */
import { P } from '../../art/palette';
import { cardDef } from '../../content/cards';
import { addChalk, beginLeg, createNight, currentLeg, currentVisit, hasChalk, newCard, shopLeave } from '../../core/state';
import type { DartCard, EngineEvent, LegState, NightState, ShopSlot } from '../../core/types';
import type { App } from '../app';
import type { Renderer } from '../draw';
import { inRect, type Pointer } from '../input';
import { cardSlots, type Rect } from '../layout';
import { GameScreen } from './game';
import { ShopScreen } from './shop';
import { ButtonSet } from '../widgets';

type Stage =
  | 'welcome'
  | 'cards'
  | 'throw1'
  | 'after1'
  | 'throw2'
  | 'throw3'
  | 'finish_intro'
  | 'throw_t20'
  | 'decide'
  | 'throw_decide'
  | 'busted'
  | 'twenty'
  | 'gameshot'
  | 'shop'
  | 'leg2'
  | 'throw_chalk'
  | 'chain'
  | 'done';

interface Prompt {
  text: string;
  /** Where the pointer goes. */
  target?: () => Rect | null;
  /** Label of the advance button; undefined = waiting for an action. */
  button?: string;
  onNext?: () => void;
  /** Extra button (used on the last step). */
  second?: { label: string; onPress: () => void };
}

const TUTORIAL_SEED = 20240501;

class Tutorial {
  night: NightState;
  stage: Stage = 'welcome';
  prompt: Prompt | null = null;
  buttons = new ButtonSet();
  game: GameScreen | null = null;
  shop: ShopScreen | null = null;
  time = 0;
  private bustCount = 0;
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

  // ---------------------------------------------------------------- deck control

  /** Find (or conjure) a card by def id from the leg pool, removing it from wherever it lives. */
  private take(defId: string): DartCard {
    const leg = this.leg;
    for (const pile of [leg.deck, leg.discard, leg.hand]) {
      const i = pile.findIndex((c) => c.defId === defId);
      if (i >= 0) return pile.splice(i, 1)[0];
    }
    return newCard(this.night, defId);
  }

  /** Put these cards on top of the deck so the NEXT deal shows them. */
  private arrangeNext(defIds: string[]): void {
    const cards = defIds.map((d) => this.take(d));
    this.leg.deck.unshift(...cards);
  }

  /** Replace the current hand immediately (before any throw). */
  private setHand(defIds: string[]): void {
    const leg = this.leg;
    leg.deck.push(...leg.hand);
    leg.hand = [];
    leg.hand = defIds.map((d) => this.take(d));
    if (this.game) {
      this.game.hand.deal(leg.hand);
      this.game.refreshHints();
    }
  }

  private setScore(score: number): void {
    const leg = this.leg;
    leg.score = score;
    const v = currentVisit(leg);
    if (v && v.throws.length === 0) v.scoreAtVisitStart = score;
    if (this.game) {
      this.game.score.snap(score);
      this.game.refreshHints();
    }
  }

  // ---------------------------------------------------------------- prompts

  private say(p: Prompt): void {
    this.prompt = p;
    this.buildButtons();
  }

  private buildButtons(): void {
    const b = this.buttons;
    b.clear();
    const panel = this.panelRect();
    if (this.prompt?.button) {
      b.add({
        id: 'next',
        rect: { x: panel.x + panel.w - 62, y: panel.y + panel.h - 20, w: 56, h: 16 },
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
        rect: { x: panel.x + panel.w - 128, y: panel.y + panel.h - 20, w: 60, h: 16 },
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

  private panelRect(): Rect {
    if (this.portrait) {
      // Below the board and above the hand, or over the commentary when the target is up top.
      const t = this.prompt?.target?.();
      const top = t && t.y > 160;
      return top ? { x: 4, y: 14, w: this.w - 8, h: 70 } : { x: 4, y: 250, w: this.w - 8, h: 66 };
    }
    const t = this.prompt?.target?.();
    // Targets in the right column → panel over the board (left); otherwise right column.
    const left = !t || t.x >= 120;
    return left ? { x: 3, y: 14, w: 128, h: 116 } : { x: 124, y: 14, w: 192, h: 66 };
  }

  private allow(defIds: string[] | null): void {
    if (!this.game) return;
    if (defIds === null) {
      this.game.hand.allowed = null;
      return;
    }
    const ids = new Set<string>();
    for (const c of this.leg.hand) if (defIds.includes(c.defId)) ids.add(c.id);
    this.game.hand.allowed = ids;
  }

  // ---------------------------------------------------------------- targets

  private scoreRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.score.x + 40, y: l.score.y - 2, w: l.score.w - 80, h: 40 };
  }

  private handRect(): Rect {
    const l = (this.game as GameScreen).layout;
    const slots = cardSlots(l, Math.max(1, this.leg.hand.length));
    const first = slots[0];
    const last = slots[slots.length - 1];
    return { x: first.x - 2, y: first.y - 8, w: last.x + last.w - first.x + 4, h: l.cardH + 10 };
  }

  private cardRect(defId: string): Rect | null {
    const l = (this.game as GameScreen).layout;
    const i = this.leg.hand.findIndex((c) => c.defId === defId);
    if (i < 0) return this.handRect();
    const s = cardSlots(l, this.leg.hand.length)[i];
    return { x: s.x - 2, y: s.y - 8, w: s.w + 4, h: s.h + 10 };
  }

  private pipsRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return l.orientation === 'landscape' ? { x: 118, y: 0, w: 90, h: 12 } : { x: 70, y: 0, w: 60, h: 12 };
  }

  private checkoutRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.checkoutLine.x - 2, y: l.checkoutLine.y - 2, w: l.checkoutLine.w, h: 11 };
  }

  private boardRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.board.x - 2, y: l.board.y - 2, w: l.board.w + 4, h: l.board.h + 4 };
  }

  private chalkRect(): Rect {
    const l = (this.game as GameScreen).layout;
    return { x: l.chalkStrip.x, y: l.chalkStrip.y, w: 70, h: 24 };
  }

  // ---------------------------------------------------------------- script

  start(): void {
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    this.game = new GameScreen(this.app, this.gameHooks());
    this.app.scenes.go(this.game);
  }

  private gameHooks() {
    return {
      ownsFlow: true,
      onReady: (screen: GameScreen) => this.onReady(screen),
      onEvent: (e: EngineEvent, screen: GameScreen) => this.onEvent(e, screen),
      draw: (r: Renderer) => this.draw(r),
      update: (dt: number) => {
        this.time += dt;
      },
      onDown: (p: Pointer) => this.onDown(p),
      onKey: (key: string) => this.onKey(key),
    };
  }

  private onReady(screen: GameScreen): void {
    this.game = screen;
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    screen.hand.locked = true;
    switch (this.stage) {
      case 'welcome': {
        this.setHand(['t20', 's5', 's1']);
        this.arrangeNext(['s20', 't19', 's7']);
        this.say({
          text: 'Welcome to the oche. This is your score. Get it from 501 to exactly zero. The last dart has to land on a DOUBLE.',
          target: () => this.scoreRect(),
          button: 'NEXT',
          onNext: () => this.gotoCards(),
        });
        break;
      }
      case 'throw2': {
        // Hand for throw 2 is already dealt by the engine (arranged earlier).
        this.arrangeNext(['s19', 's12', 's3']);
        this.say({
          text: 'Sixty off. Three darts make a VISIT, and every leg gives you a limited number of visits: the pips up top. Throw the next two darts. Any card you like.',
          target: () => this.pipsRect(),
          button: 'GO',
          onNext: () => {
            this.stage = 'throw2';
            this.say({ text: 'Throw two more darts. Any card.', target: () => this.handRect() });
            this.unlock(null);
          },
        });
        break;
      }
      case 'throw3': {
        this.say({ text: 'One more dart finishes the visit.', target: () => this.handRect() });
        this.unlock(null);
        break;
      }
      case 'finish_intro': {
        // New visit: jump to 100 and teach the finish.
        this.setScore(100);
        this.setHand(['t20', 'd20', 's1']);
        this.arrangeNext(['d20', 't20', 's20']);
        this.say({
          text: "Let's jump ahead: 100 left. The chalkboard suggests a route: T20 leaves 40, then D20 finishes. A double is the thin outer ring of the board.",
          target: () => this.checkoutRect(),
          button: 'NEXT',
          onNext: () => {
            this.stage = 'throw_t20';
            this.say({ text: 'Throw the T20. It leaves 40.', target: () => this.cardRect('t20') });
            this.unlock(['t20']);
          },
        });
        break;
      }
      case 'decide': {
        this.say({
          text: '40 left. D20 is exactly 40 on a double: GAME SHOT. T20 is 60: too many, a BUST, and the visit is wasted. S20 leaves 20. Your call.',
          target: () => this.handRect(),
          button: 'NEXT',
          onNext: () => {
            this.stage = 'throw_decide';
            this.say({ text: 'D20 finishes. T20 busts. S20 leaves 20. Choose.', target: () => this.handRect() });
            this.unlock(null);
          },
        });
        break;
      }
      case 'busted': {
        this.setHand(['d20', 't20', 's20']);
        this.say({
          text: 'BUST. Too many: the score went straight back to 40 and that visit is gone. Nothing else is lost.',
          target: () => this.scoreRect(),
          button: 'NEXT',
          onNext: () => {
            this.say({
              text: 'When every card would bust, hit MISS: the dart goes into the wall on purpose. No score, no bust. It costs you the dart and the hand. Real players do this.',
              target: () => (this.game as GameScreen).layout.miss,
              button: 'GOT IT',
              onNext: () => {
                this.stage = 'throw_decide';
                this.say({ text: 'D20 finishes. T20 busts. S20 leaves 20.', target: () => this.handRect() });
                this.unlock(null);
              },
            });
          },
        });
        break;
      }
      case 'twenty': {
        this.setHand(['d10', 's5', 's1']);
        this.say({
          text: '20 left. No card for 20 on a double in your deck… so we have slipped you a D10. In a real night you buy those in the shop.',
          target: () => this.cardRect('d10'),
          button: 'NEXT',
          onNext: () => {
            this.stage = 'throw_decide';
            this.say({ text: 'Double 10 is exactly 20. Throw it.', target: () => this.cardRect('d10') });
            this.unlock(['d10']);
          },
        });
        break;
      }
      case 'leg2': {
        this.setHand(['t20', 's20', 's5']);
        this.say({
          text: `Leg 2. You hold ${hasChalk(this.night, 'hot_twenty') ? 'HOT TWENTY' : 'chalk'}: trebles in the 20 bed score x4. Chalk fires by itself. Throw the T20 and watch the chain.`,
          target: () => this.chalkRect(),
          button: 'NEXT',
          onNext: () => {
            this.stage = 'throw_chalk';
            this.say({ text: 'Throw the T20.', target: () => this.cardRect('t20') });
            this.unlock(['t20']);
          },
        });
        break;
      }
      case 'chain': {
        this.say({
          text: 'Hot Twenty fired: 60 became 80. Chalk resolves in the order you bought it, one after another. Five slots. Some pairs are brilliant. Some are traps.',
          target: () => this.chalkRect(),
          button: 'NEXT',
          onNext: () => this.gotoDone(),
        });
        break;
      }
      default:
        break;
    }
  }

  private gotoCards(): void {
    this.stage = 'cards';
    this.say({
      text: "You never aim. For every dart you're dealt three cards, and each card is a spot on the board. T20 is treble twenty: sixty. The other two go in the bin.",
      target: () => this.handRect(),
      button: 'NEXT',
      onNext: () => {
        this.stage = 'throw1';
        this.say({
          text: this.app.input.isTouch ? 'Flick the T20 card up at the board.' : 'Flick the T20 card up at the board, or click it twice.',
          target: () => this.cardRect('t20'),
        });
        this.unlock(['t20']);
      },
    });
  }

  private unlock(defIds: string[] | null): void {
    if (!this.game) return;
    this.game.hand.locked = false;
    this.allow(defIds);
  }

  private onEvent(e: EngineEvent, screen: GameScreen): void {
    switch (e.type) {
      case 'THROW': {
        if (this.stage === 'throw1') {
          this.stage = 'throw2';
          this.prompt = null;
          this.buildButtons();
        } else if (this.stage === 'throw2') {
          this.stage = 'throw3';
          this.prompt = null;
        } else if (this.stage === 'throw3') {
          this.stage = 'finish_intro';
          this.prompt = null;
        } else if (this.stage === 'throw_t20') {
          this.stage = 'decide';
          this.prompt = null;
        } else if (this.stage === 'throw_decide') {
          const r = e.result;
          if (r.outcome === 'BUST') {
            this.bustCount++;
            this.stage = 'busted';
          } else if (r.outcome === 'CHECKOUT') {
            this.stage = 'gameshot';
          } else {
            this.stage = 'twenty';
          }
          this.prompt = null;
        } else if (this.stage === 'throw_chalk') {
          this.stage = 'chain';
          this.prompt = null;
        }
        break;
      }
      case 'HAND_DEALT':
        // onReady follows and sets up the next step.
        break;
      case 'CHECKOUT': {
        this.stage = 'gameshot';
        screen.hand.locked = true;
        this.say({
          text: `GAME SHOT! That's a leg. The Pot pays for it: ${this.leg.reward?.total ?? 0} coins, more for spare visits and a clean leg. Between legs there's a shop.`,
          target: () => this.scoreRect(),
          button: 'TO THE SHOP',
          onNext: () => this.gotoShop(),
        });
        break;
      }
      case 'LEG_TIMEOUT':
      case 'NIGHT_LOST': {
        // Should not happen (12 visits), but never trap the player.
        this.finish(false);
        break;
      }
      default:
        break;
    }
  }

  private gotoShop(): void {
    this.stage = 'shop';
    const n = this.night;
    n.pot = Math.max(n.pot, 12);
    const slots: ShopSlot[] = [
      { kind: 'CARD', defId: 't19', cost: 5, sold: false },
      { kind: 'CARD', defId: 'd16', cost: 3, sold: false },
      { kind: 'CHALK', chalkId: 'hot_twenty', cost: 6, sold: false },
      { kind: 'SERVICE', service: 'REMOVE', cost: 2, sold: false },
    ];
    n.shop = { slots, refreshed: false, afterLeg: 0 };
    n.phase = 'SHOP';
    this.shop = new ShopScreen(this.app, {
      allowRefresh: false,
      onReady: (s) => {
        this.shop = s;
        this.say({
          text: 'Cards join your deck for every leg. Chalk bends the rules. Buy HOT TWENTY, then TO THE OCHE. Tap an offer to read it first.',
          target: () => s.portrait ? { x: 92, y: 16, w: 82, h: 88 } : { x: 162, y: 16, w: 74, h: 90 },
        });
      },
      onBuy: (slot) => {
        if (slot.kind === 'CHALK') {
          this.say({
            text: 'That chalk now sits in a slot. It fires on every throw it applies to, in the order you bought it. Now: TO THE OCHE.',
            target: () => (this.shop?.portrait ? { x: 6, y: 224, w: 168, h: 18 } : { x: 210, y: 112, w: 104, h: 16 }),
          });
        }
      },
      onLeave: () => {
        if (!hasChalk(n, 'hot_twenty')) addChalk(n, 'hot_twenty');
        this.stage = 'leg2';
        this.app.sfx('ui_confirm');
        shopLeave(n);
        this.game = new GameScreen(this.app, this.gameHooks());
        this.app.scenes.go(this.game);
        return true;
      },
      draw: (r) => this.draw(r),
      update: (dt) => {
        this.time += dt;
      },
      onDown: (p) => this.onDown(p),
    });
    this.app.scenes.go(this.shop);
  }

  private gotoDone(): void {
    this.stage = 'done';
    this.say({
      text: 'That is the whole game. Eight legs, fewer visits each time. Buy cards to practise. Buy chalk to bend the maths. Finish on a double. Have a good night.',
      button: 'PLAY',
      onNext: () => this.finish(true),
      second: { label: 'MENU', onPress: () => this.finish(false) },
    });
  }

  private finish(play: boolean): void {
    this.app.save.data.stats.tutorialDone = true;
    this.app.save.persist();
    this.app.night = null;
    if (play) this.app.startNight(this.app.chosenSeed, this.app.chosenOche);
    else this.app.toTitle();
  }

  // ---------------------------------------------------------------- input / draw

  private onDown(p: Pointer): boolean {
    if (this.buttons.down(p.x, p.y)) {
      // Buttons act on up; emulate a press here so a tap works in one go.
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
    return false;
  }

  private draw(r: Renderer): void {
    const p = this.prompt;
    // skip button always
    this.buttons.draw(r, false);
    if (!p) return;
    const panel = this.panelRect();
    const target = p.target?.() ?? null;
    if (target) {
      const on = Math.floor(this.time * 3) % 2 === 0;
      r.rectOutline(target.x - 1, target.y - 1, target.w + 2, target.h + 2, on ? P.BRASS_LIT : P.BRASS);
      // pointer arrow from the panel side
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
    const textW = panel.w - 10;
    const lines = r.wrap(p.text, textW);
    const maxLines = p.button ? Math.floor((panel.h - 34) / 9) : Math.floor((panel.h - 14) / 9);
    lines.slice(0, Math.max(1, maxLines)).forEach((l, i) => r.text(l, panel.x + 5, panel.y + 12 + i * 9, { color: P.CHALK }));
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

export { cardDef };
