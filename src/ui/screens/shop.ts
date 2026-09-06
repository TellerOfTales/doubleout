/**
 * The shop between legs: two interventions for the kit, a piece of chalk, and
 * one of the publican's services.
 *
 * The library browser went out with the deck. There is no pile of cards to
 * page through any more and no service that needs one picked out of it, so the
 * room that freed up is spent on the prices board — what has paid tonight and
 * what the house is printing it at now. That board is the player's own record
 * being used against them, and this is the only screen quiet enough to read it
 * on.
 */
import { P } from '../../art/palette';
import { measureText } from '../../art/sprites';
import { CHALK_DEFS, chalkDef } from '../../content/chalkdefs';
import { KIT_CAP, interventionDef } from '../../content/interventions';
import { SERVICE_COST, SHOP_REFRESH_COST } from '../../content/legs';
import { buildBarkContext } from '../../core/commentary';
import { CONTRACT_BY_ID, PRICE_FLOOR } from '../../core/slate';
import { currentPrice, hasChalk, legName, shopBuy, shopLeave, shopRefresh } from '../../core/state';
import type { NightState, ServiceKind, ShopSlot } from '../../core/types';
import type { App } from '../app';
import { CommentaryBar } from '../commentarybar';
import type { Renderer } from '../draw';
import { inRect, type Pointer } from '../input';
import type { Rect } from '../layout';
import type { Scene } from '../scene';
import { Particles, Pulse, rndRange } from '../tween';
import { ButtonSet, drawPanel, drawRule } from '../widgets';

export interface ShopHooks {
  onReady?(screen: ShopScreen): void;
  onBuy?(slot: ShopSlot, screen: ShopScreen): void;
  onLeave?(screen: ShopScreen): boolean; // return true to swallow
  draw?(r: Renderer, screen: ShopScreen): void;
  update?(dt: number, screen: ShopScreen): void;
  onDown?(p: Pointer, screen: ShopScreen): boolean;
  /** Restrict which slot indexes can be bought (tutorial). */
  allowedSlots?: number[] | null;
  allowRefresh?: boolean;
}

/**
 * The publican's three services. Names are his, not the game's: he is selling
 * a steady hand, an advance and a clean record, and the price of each is
 * printed on the slot beside it.
 */
const SERVICE_TEXT: Record<ServiceKind, { name: string; icon: number }> = {
  STEADY: { name: 'STEADY HAND', icon: 28 },
  CREDIT: { name: "PUBLICAN'S ADVANCE", icon: 5 },
  RUB_OUT: { name: 'FULL PRICE', icon: 7 },
};

/**
 * The 5×7 face has no curly quote and prints anything it does not know as a
 * hollow box. Content is written with proper typography, so flatten it on the
 * way to the screen rather than making the writers think about the font.
 */
function plain(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
}

interface ShopLayout {
  slots: Rect[];
  kit: Rect;
  prices: Rect;
  /** Held chalk chips: first chip, and the step between them. */
  chalk: Rect;
  chalkStep: number;
  detail: Rect;
  detailLines: number;
  refresh: Rect;
  leave: Rect;
  bar: Rect;
  barLines: number;
}

/**
 * Everything is placed from the commentary bar upward: the bar and the two
 * action buttons are fixed, and what is left over is split between the offers
 * on top and the two things worth reading before spending — the kit, and the
 * prices the night has earned.
 */
function shopLayout(w: number, h: number): ShopLayout {
  if (w >= h) {
    const slots: Rect[] = [];
    for (let i = 0; i < 4; i++) slots.push({ x: 5 + i * 78, y: 14, w: 74, h: 48 });
    return {
      slots,
      kit: { x: 4, y: 64, w: 150, h: 44 },
      prices: { x: 158, y: 64, w: 158, h: 60 },
      chalk: { x: 4, y: 110, w: 14, h: 14 },
      chalkStep: 16,
      detail: { x: 3, y: 126, w: w - 6, h: 16 },
      detailLines: 2,
      refresh: { x: 4, y: 143, w: 96, h: 15 },
      leave: { x: w - 100, y: 143, w: 96, h: 15 },
      bar: { x: 0, y: h - 20, w, h: 20 },
      barLines: 2,
    };
  }
  // Portrait stacks the same five things and spends its extra height on the
  // detail line, which has a third of the width to say the same sentence in.
  const slots: Rect[] = [];
  for (let i = 0; i < 4; i++) slots.push({ x: 4 + (i % 2) * 88, y: 14 + Math.floor(i / 2) * 50, w: 84, h: 46 });
  return {
    slots,
    kit: { x: 4, y: 114, w: 172, h: 42 },
    prices: { x: 4, y: 180, w: 172, h: 58 },
    chalk: { x: 4, y: 160, w: 16, h: 16 },
    chalkStep: 18,
    detail: { x: 3, y: 240, w: w - 6, h: 32 },
    detailLines: 4,
    refresh: { x: 4, y: 274, w: 84, h: 15 },
    leave: { x: 92, y: 274, w: 84, h: 15 },
    bar: { x: 0, y: h - 28, w, h: 28 },
    barLines: 3,
  };
}

/** One line of the prices board. */
interface PriceRow {
  name: string;
  paid: number;
  was: number;
  now: number;
}

export class ShopScreen implements Scene {
  buttons = new ButtonSet();
  bar = new CommentaryBar();
  particles = new Particles();
  keyboardFocus = false;
  time = 0;
  /** Which offer is being read, -1 for none. */
  selected = -1;
  /** Held intervention / held chalk being read. Only ever one of the three. */
  kitTip: string | null = null;
  chalkTip: string | null = null;
  overlay: 'none' | 'replace' = 'none';
  overlayButtons = new ButtonSet();
  pendingChalk: number | null = null;
  potPulse = new Pulse();
  w = 320;
  h = 180;
  private lay: ShopLayout = shopLayout(320, 180);
  private buyFlash = new Map<number, Pulse>();

  constructor(
    public app: App,
    public hooks: ShopHooks = {},
  ) {
    this.bar.blip = (s, ch) => (app.save.data.settings.voice ? app.audio.blip(s, ch) : 25);
  }

  get night(): NightState {
    return this.app.night as NightState;
  }

  get portrait(): boolean {
    return this.app.screen.orientation === 'portrait';
  }

  enter(): void {
    this.resize();
    this.app.sfx('card_flip');
    this.app.audio.setCrowdTension(0.08);
    try {
      const ctx = buildBarkContext(this.night, { type: 'SHOP_ENTER', pot: this.night.pot });
      const barks = this.app.commentary.react(ctx);
      if (barks.length) this.bar.say(barks);
    } catch {
      /* ignore */
    }
    this.hooks.onReady?.(this);
  }

  exit(): void {
    this.app.audio.setCrowdTension(0);
  }

  resize(): void {
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    this.lay = shopLayout(this.w, this.h);
    this.bar.lines = this.lay.barLines;
    this.buildButtons();
  }

  // ---------------------------------------------------------------- reading the night

  /** The kit, grouped: six of one intervention is one line, not six. */
  private kitCells(): { defId: string; label: string; rect: Rect }[] {
    const box = this.lay.kit;
    const order: string[] = [];
    const count = new Map<string, number>();
    for (const id of this.night.kit) {
      if (!count.has(id)) order.push(id);
      count.set(id, (count.get(id) ?? 0) + 1);
    }
    const colW = Math.floor((box.w - 10) / 2);
    return order.slice(0, 6).map((id, i) => {
      const held = count.get(id) ?? 1;
      const name = interventionDef(id).name;
      return {
        defId: id,
        label: held > 1 ? `${name} ×${held}` : name,
        rect: { x: box.x + 4 + (i % 2) * (colW + 2), y: box.y + 15 + Math.floor(i / 2) * 9, w: colW, h: 9 },
      };
    });
  }

  /**
   * What the night has paid, worst first. Only contracts that have actually
   * paid appear: an untouched price is still the printed one, and printing a
   * board of unchanged numbers would bury the ones that have moved.
   */
  private priceRows(): PriceRow[] {
    const n = this.night;
    const rows: PriceRow[] = [];
    for (const [id, times] of Object.entries(n.paid)) {
      const def = CONTRACT_BY_ID[id];
      if (!def || times <= 0) continue;
      rows.push({ name: def.name, paid: times, was: def.price, now: currentPrice(n, id) });
    }
    return rows.sort((a, b) => b.paid - a.paid || a.name.localeCompare(b.name));
  }

  /** The contract FULL PRICE would rub out. Mirrors the engine's own choice. */
  private rubOutTarget(): string | null {
    const worst = Object.entries(this.night.paid).sort((a, b) => b[1] - a[1])[0];
    if (!worst) return null;
    return CONTRACT_BY_ID[worst[0]]?.name ?? null;
  }

  private chipRects(): Rect[] {
    const { chalk, chalkStep } = this.lay;
    const out: Rect[] = [];
    for (let i = 0; i < this.night.chalkSlots; i++) out.push({ x: chalk.x + i * chalkStep, y: chalk.y, w: chalk.w, h: chalk.h });
    return out;
  }

  // ---------------------------------------------------------------- buttons

  /** Why this offer cannot be bought, in nine characters or fewer. */
  private blockedLabel(slot: ShopSlot): string | null {
    const n = this.night;
    const kitFull = n.kit.length >= KIT_CAP;
    if (slot.kind === 'KIT' && kitFull) return 'KIT FULL';
    if (slot.kind === 'CHALK' && hasChalk(n, slot.chalkId)) return 'HELD';
    if (slot.kind === 'SERVICE' && slot.service === 'STEADY' && kitFull) return 'KIT FULL';
    if (slot.kind === 'SERVICE' && slot.service === 'RUB_OUT' && !this.rubOutTarget()) return 'NO RECORD';
    return null;
  }

  private buildButtons(): void {
    const b = this.buttons;
    b.clear();
    const shop = this.night.shop;
    if (!shop) return;
    shop.slots.forEach((slot, i) => {
      const r = this.lay.slots[i];
      const allowed = !this.hooks.allowedSlots || this.hooks.allowedSlots.includes(i);
      const afford = this.night.pot >= slot.cost;
      const blocked = this.blockedLabel(slot);
      const spent = slot.sold || !!blocked;
      b.add({
        id: `buy${i}`,
        rect: { x: r.x + 6, y: r.y + r.h - 17, w: r.w - 12, h: 15 },
        label: slot.sold ? 'SOLD' : (blocked ?? `BUY ${slot.cost}`),
        icon: spent ? undefined : 5,
        disabled: spent || !afford || !allowed,
        primary: !spent && afford && allowed,
        onPress: () => this.buy(i),
      });
    });
    const refreshAllowed = this.hooks.allowRefresh !== false;
    b.add({
      id: 'refresh',
      rect: this.lay.refresh,
      label: shop.refreshed ? 'REFRESHED' : `REFRESH ${SHOP_REFRESH_COST}`,
      icon: 6,
      disabled: shop.refreshed || this.night.pot < SHOP_REFRESH_COST || !refreshAllowed,
      onPress: () => this.refresh(),
    });
    b.add({
      id: 'leave',
      rect: this.lay.leave,
      label: 'TO THE OCHE',
      icon: 15,
      primary: true,
      onPress: () => this.leave(),
    });
    b.focus = b.buttons.findIndex((x) => x.id === 'leave');
  }

  // ---------------------------------------------------------------- actions

  private buy(i: number): void {
    const slot = this.night.shop?.slots[i];
    if (!slot || slot.sold) return;
    // The only purchase that still needs an answer first: a sixth piece of
    // chalk has to push one off the wall.
    if (slot.kind === 'CHALK' && this.night.chalk.length >= this.night.chalkSlots) {
      this.openReplace(i);
      return;
    }
    const out = shopBuy(this.night, i);
    this.afterBuy(i, out.ok, out.reason);
  }

  private afterBuy(i: number, ok: boolean, reason?: string): void {
    if (!ok) {
      this.app.sfx('error');
      this.bar.say([{ speaker: 'NOCK', text: reason === 'not enough pot' ? 'Not enough in the Pot for that one.' : `Can't do that: ${reason ?? 'no'}.`, triggerId: 'shop_fail', priority: 1 }]);
      return;
    }
    const slot = this.night.shop?.slots[i];
    this.app.sfx('shop_buy');
    this.potPulse.fire(0.5);
    const rect = this.lay.slots[i];
    const pulse = new Pulse();
    pulse.fire(0.6);
    this.buyFlash.set(i, pulse);
    this.particles.emit(10, () => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, vx: rndRange(-50, 50), vy: rndRange(-70, -10), life: 0.5, sprite: 'spark', frame: 0 }));
    this.buildButtons();
    if (slot) {
      this.hooks.onBuy?.(slot, this);
      try {
        const ctx = buildBarkContext(this.night, { type: 'SHOP_BUY', slot });
        const barks = this.app.commentary.react(ctx);
        if (barks.length) this.bar.say(barks);
      } catch {
        /* ignore */
      }
    }
    for (const e of this.night.achievements) {
      if (this.app.save.unlock(e)) {
        this.app.sfx('unlock');
        this.bar.say([{ speaker: 'NOCK', text: `Oche unlocked: ${e === 'wide' ? 'The Wide' : e === 'sharp' ? 'The Sharp' : e === 'thin' ? 'The Thin' : e === 'steady' ? 'The Steady' : e}. It waits on the title screen.`, triggerId: 'unlock', priority: 90 }]);
      }
    }
  }

  private refresh(): void {
    const out = shopRefresh(this.night);
    if (!out.ok) {
      this.app.sfx('error');
      return;
    }
    this.app.sfx('shop_refresh');
    this.selected = -1;
    this.buildButtons();
  }

  private leave(): void {
    if (this.hooks.onLeave?.(this)) return;
    this.app.sfx('ui_confirm');
    shopLeave(this.night);
    this.app.toGame();
  }

  // ---------------------------------------------------------------- the replace overlay

  private openReplace(slot: number): void {
    this.overlay = 'replace';
    this.pendingChalk = slot;
    this.app.sfx('ui_confirm');
    const ob = this.overlayButtons;
    ob.clear();
    const px = Math.floor((this.w - (this.portrait ? 168 : 240)) / 2);
    const py = this.replaceTop();
    this.night.chalk.forEach((c, i) => {
      ob.add({
        id: `rep${i}`,
        rect: { x: px + 8, y: py + 16 + i * 18, w: this.portrait ? 152 : 110, h: 16 },
        label: c.def.name.toUpperCase(),
        onPress: () => {
          const out = shopBuy(this.night, slot, { replaceChalkId: c.def.id });
          this.closeOverlay();
          this.afterBuy(slot, out.ok, out.reason);
        },
      });
    });
    ob.add({ id: 'cancel', rect: { x: px + 8, y: py + 16 + this.night.chalk.length * 18 + 4, w: 70, h: 16 }, label: 'CANCEL', onPress: () => this.closeOverlay() });
    ob.focusFirst();
  }

  /**
   * Where the discard panel starts. A sixth slot on The Wide makes it tall
   * enough to matter, so it is pushed up rather than off the bottom.
   */
  private replaceTop(): number {
    const h = 16 + this.night.chalk.length * 18 + 26;
    return Math.max(6, Math.min(this.portrait ? 40 : 26, this.h - 4 - h));
  }

  private closeOverlay(): void {
    this.overlay = 'none';
    this.pendingChalk = null;
    this.overlayButtons.clear();
    this.app.sfx('ui_back');
  }

  // ---------------------------------------------------------------- input

  onDown(p: Pointer): void {
    this.keyboardFocus = false;
    if (this.hooks.onDown?.(p, this)) return;
    if (this.overlay === 'replace') {
      this.overlayButtons.down(p.x, p.y);
      return;
    }
    if (inRect(p.x, p.y, this.lay.bar)) {
      this.bar.skip();
      return;
    }
    for (let i = 0; i < this.lay.slots.length; i++) {
      if (inRect(p.x, p.y, this.lay.slots[i])) this.read('slot', i);
    }
    for (const cell of this.kitCells()) {
      if (inRect(p.x, p.y, cell.rect)) this.read('kit', cell.defId);
    }
    const chips = this.chipRects();
    for (let i = 0; i < chips.length; i++) {
      if (inRect(p.x, p.y, chips[i]) && this.night.chalk[i]) this.read('chalk', this.night.chalk[i].def.id);
    }
    this.buttons.down(p.x, p.y);
  }

  /** One thing is being read at a time, so picking one drops the other two. */
  private read(kind: 'slot' | 'kit' | 'chalk', what: number | string): void {
    const wasKit = this.kitTip;
    const wasChalk = this.chalkTip;
    this.selected = kind === 'slot' ? (what as number) : -1;
    this.kitTip = kind === 'kit' ? (wasKit === what ? null : (what as string)) : null;
    this.chalkTip = kind === 'chalk' ? (wasChalk === what ? null : (what as string)) : null;
    if (kind !== 'slot') this.app.sfx('ui_move');
  }

  onMove(p: Pointer): void {
    (this.overlay !== 'none' ? this.overlayButtons : this.buttons).move(p.x, p.y);
  }

  onUp(p: Pointer): void {
    if (this.overlay !== 'none') {
      this.overlayButtons.up(p.x, p.y);
      return;
    }
    this.buttons.up(p.x, p.y);
  }

  onKey(key: string): void {
    if (this.overlay !== 'none') {
      if (key === 'Escape') {
        this.closeOverlay();
        return;
      }
      if (this.overlayButtons.key(key)) this.keyboardFocus = true;
      return;
    }
    if (key === 'Escape') {
      this.leave();
      return;
    }
    if (this.buttons.key(key)) {
      this.keyboardFocus = true;
      const f = this.buttons.buttons[this.buttons.focus];
      // Walking the offers with the keyboard reads them out, so a player who
      // never touches the screen still gets the blurb.
      if (f && f.id.startsWith('buy')) this.read('slot', Number(f.id.slice(3)));
    }
  }

  // ---------------------------------------------------------------- update / draw

  update(dt: number): void {
    this.time += dt;
    this.bar.update(dt);
    this.particles.update(dt);
    this.potPulse.update(dt);
    for (const p of this.buyFlash.values()) p.update(dt);
    this.hooks.update?.(dt, this);
  }

  draw(r: Renderer): void {
    r.clear(P.DEEP);
    if (this.portrait) {
      r.sprite('wall', -70, 0);
      r.sprite('wall', -70, 132);
      r.sprite('oche_floor', 0, 272);
    } else {
      r.sprite('wall', 0, 0);
      r.sprite('oche_floor', 0, 132);
    }
    r.rect(0, 0, this.w, 12, P.INK);
    r.rect(0, 12, this.w, 1, P.STONE);
    const after = this.night.shop?.afterLeg ?? 0;
    r.text(this.portrait ? `SHOP · AFTER LEG ${after + 1}` : `THE SHOP · AFTER ${legName(after).toUpperCase()}`, 3, 3, { color: P.MIST });
    const pot = `${this.night.pot}`;
    const bump = this.potPulse.active ? 1 : 0;
    r.text(pot, this.w - 4, 3 - bump, { color: P.BRASS_LIT, align: 'right' });
    r.sprite('icons', this.w - 4 - measureText(5, pot) - 10, 2, 5);
    r.sprite('pint', this.w - 30 - measureText(5, pot), -2, Math.min(4, Math.floor(this.night.pot / 6)));

    const shop = this.night.shop;
    if (shop) shop.slots.forEach((slot, i) => this.drawSlot(r, slot, i));
    this.drawKit(r);
    this.drawChalk(r);
    this.drawPrices(r);
    this.drawDetail(r);
    this.buttons.draw(r, this.keyboardFocus);
    for (const p of this.particles.list) r.sprite(p.sprite, Math.round(p.x), Math.round(p.y), p.frame);
    this.bar.draw(r, this.lay.bar);
    if (this.overlay === 'replace') this.drawReplace(r);
    this.hooks.draw?.(r, this);
  }

  // ---------------------------------------------------------------- the offers

  /** Tag, name and the extra line an offer earns, if it has anything to add. */
  private slotView(slot: ShopSlot): { tag: string; tagColor: number; icon: number; name: string; note?: string; noteColor?: number } {
    if (slot.kind === 'KIT') {
      const d = interventionDef(slot.defId);
      const held = this.night.kit.filter((k) => k === slot.defId).length;
      return { tag: 'KIT', tagColor: P.SKY_LIT, icon: 25, name: d.name, note: held ? `IN KIT: ${held}` : undefined, noteColor: P.MIST };
    }
    if (slot.kind === 'CHALK') {
      const d = chalkDef(slot.chalkId);
      const color = d.stage === 'VALUE' ? P.BRASS_LIT : d.stage === 'BOARD' ? P.CLARET_LIT : d.stage === 'RULE' ? P.SKY_LIT : P.BAIZE_LIT;
      return { tag: d.stage, tagColor: color, icon: 27, name: d.name.toUpperCase() };
    }
    const s = SERVICE_TEXT[slot.service];
    if (slot.service === 'STEADY') return { tag: 'SERVICE', tagColor: P.BAIZE_LIT, icon: s.icon, name: s.name, note: 'STAYS OPEN', noteColor: P.BAIZE_LIT };
    if (slot.service === 'CREDIT') return { tag: 'SERVICE', tagColor: P.BAIZE_LIT, icon: s.icon, name: s.name, note: `PAYS ${SERVICE_COST.CREDIT * 2}`, noteColor: P.BRASS_LIT };
    const target = this.rubOutTarget();
    return { tag: 'SERVICE', tagColor: P.BAIZE_LIT, icon: s.icon, name: s.name, note: target ?? undefined, noteColor: P.BRASS_LIT };
  }

  private drawSlot(r: Renderer, slot: ShopSlot, i: number): void {
    const rect = this.lay.slots[i];
    const sel = this.selected === i;
    const flash = this.buyFlash.get(i);
    drawPanel(r, rect, undefined, sel);
    if (flash?.active) r.dither(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, P.BRASS_LIT, flash.value * 8);
    const view = this.slotView(slot);
    const dim = slot.sold;
    const cx = rect.x + Math.floor(rect.w / 2);
    // The two things a shop has to say first: what it is, and what it costs.
    r.sprite('icons', rect.x + 3, rect.y + 3, view.icon);
    r.text(view.tag, rect.x + 13, rect.y + 4, { color: dim ? P.PEWTER : view.tagColor });
    r.text(String(slot.cost), rect.x + rect.w - 4, rect.y + 4, { color: dim ? P.PEWTER : this.night.pot >= slot.cost ? P.BRASS_LIT : P.EMBER, align: 'right' });
    const lines = r.wrap(plain(view.name), rect.w - 8).slice(0, 2);
    lines.forEach((l, k) => r.text(l, cx, rect.y + 13 + k * 8, { color: dim ? P.PEWTER : P.CHALK, align: 'center' }));
    if (view.note && lines.length < 2) r.text(view.note, cx, rect.y + 21, { color: dim ? P.PEWTER : (view.noteColor ?? P.MIST), align: 'center' });
  }

  // ---------------------------------------------------------------- the kit

  private drawKit(r: Renderer): void {
    const box = this.lay.kit;
    const n = this.night;
    r.panel(box.x, box.y, box.w, box.h, P.DEEP, P.STONE);
    r.text('THE KIT', box.x + 4, box.y + 3, { color: P.CHALK });
    const full = n.kit.length >= KIT_CAP;
    r.text(`${n.kit.length}/${KIT_CAP}`, box.x + box.w - 4, box.y + 3, { color: full ? P.EMBER : P.BRASS_LIT, align: 'right' });
    drawRule(r, box.x + 3, box.y + 12, box.w - 6);
    const cells = this.kitCells();
    if (!cells.length) {
      r.text('NOTHING IN IT.', box.x + 4, box.y + 16, { color: P.STONE });
      return;
    }
    for (const c of cells) {
      const on = this.kitTip === c.defId;
      if (on) r.rect(c.rect.x - 1, c.rect.y, c.rect.w, c.rect.h - 1, P.SHADE);
      r.text(c.label, c.rect.x + 1, c.rect.y + 1, { color: on ? P.CHALK : P.MIST });
    }
  }

  private drawChalk(r: Renderer): void {
    const chips = this.chipRects();
    chips.forEach((c, i) => {
      const held = this.night.chalk[i];
      if (!held) {
        r.dither(c.x, c.y, c.w, c.h, P.INK, 6);
        r.rectOutline(c.x, c.y, c.w, c.h, P.SHADE);
        return;
      }
      r.nineSlice('chalk_frame', c.x, c.y, c.w, c.h, this.chalkTip === held.def.id ? 1 : 0);
      const idx = CHALK_DEFS.findIndex((d) => d.id === held.def.id);
      r.sprite('chalk_icons', c.x + (c.w - 8) / 2, c.y + (c.h - 8) / 2, Math.max(0, idx));
    });
    const last = chips[chips.length - 1];
    r.text(`CHALK ${this.night.chalk.length}/${this.night.chalkSlots}`, last.x + last.w + 4, last.y + Math.floor((last.h - 7) / 2), { color: P.PEWTER });
  }

  // ---------------------------------------------------------------- the prices board

  /**
   * The house shortens your price every time a contract pays, so this is the
   * night's own record read back at the player. WAS is what it was printed at
   * cold; NOW is what the next one would pay.
   */
  private drawPrices(r: Renderer): void {
    const box = this.lay.prices;
    r.panel(box.x, box.y, box.w, box.h, P.DEEP, P.STONE);
    r.text('THE PRICES', box.x + 4, box.y + 3, { color: P.CHALK });
    r.text('YOUR RECORD', box.x + box.w - 4, box.y + 3, { color: P.PEWTER, align: 'right' });
    drawRule(r, box.x + 3, box.y + 12, box.w - 6);
    const rows = this.priceRows();
    const nameX = box.x + 4;
    const nowX = box.x + box.w - 4;
    const wasX = nowX - 24;
    const paidX = wasX - 24;
    if (!rows.length) {
      r.text('NOTHING HAS PAID YET.', nameX, box.y + 16, { color: P.MIST });
      r.text('EVERY PRICE IS FULL.', nameX, box.y + 25, { color: P.PEWTER });
      return;
    }
    r.text('CONTRACT', nameX, box.y + 15, { color: P.PEWTER });
    r.text('PAID', paidX, box.y + 15, { color: P.PEWTER, align: 'right' });
    r.text('WAS', wasX, box.y + 15, { color: P.PEWTER, align: 'right' });
    r.text('NOW', nowX, box.y + 15, { color: P.PEWTER, align: 'right' });
    const room = 4;
    const shown = rows.length > room ? rows.slice(0, room - 1) : rows;
    shown.forEach((row, i) => {
      const y = box.y + 25 + i * 8;
      r.text(row.name, nameX, y, { color: P.CHALK });
      r.text(String(row.paid), paidX, y, { color: P.MIST, align: 'right' });
      r.text(String(row.was), wasX, y, { color: P.PEWTER, align: 'right' });
      // Shortened is bad news and is printed in the colour bad news comes in.
      r.text(String(row.now), nowX, y, { color: row.now < row.was ? P.EMBER : row.now > row.was ? P.BRASS_LIT : P.MIST, align: 'right' });
    });
    if (shown.length < rows.length) {
      r.text(`AND ${rows.length - shown.length} MORE`, nameX, box.y + 25 + shown.length * 8, { color: P.PEWTER });
    }
  }

  // ---------------------------------------------------------------- the detail line

  private detailText(): { text: string; color: number } {
    const n = this.night;
    if (this.kitTip) {
      const d = interventionDef(this.kitTip);
      const when = d.when === 'AIM' ? 'Spent on one dart.' : 'Spent before the visit.';
      return { text: plain(`${d.name}: ${d.blurb} ${when}`), color: P.SKY_LIT };
    }
    if (this.chalkTip) {
      const d = chalkDef(this.chalkTip);
      return { text: plain(`${d.name.toUpperCase()} · ${d.stage}: ${d.blurb}`), color: P.CHALK };
    }
    const slot = n.shop?.slots[this.selected];
    if (!slot) {
      // The one rule the prices board runs on, printed where the board is.
      const text = hasChalk(n, 'long_prices')
        ? 'Each time a contract pays, its price drops by one. Long Prices adds 2 back.'
        : `Each time a contract pays, its price drops by one, down to ${PRICE_FLOOR}.`;
      return { text, color: P.STONE };
    }
    if (slot.kind === 'KIT') {
      const d = interventionDef(slot.defId);
      const when = d.when === 'AIM' ? 'Spent on one dart.' : 'Spent before the visit.';
      return { text: plain(`${d.name}: ${d.blurb} ${when}`), color: P.SKY_LIT };
    }
    if (slot.kind === 'CHALK') {
      const d = chalkDef(slot.chalkId);
      return { text: plain(`${d.name.toUpperCase()} · ${d.stage}: ${d.blurb}`), color: P.CHALK };
    }
    return { text: plain(this.serviceRule(slot.service, slot.cost)), color: P.CHALK };
  }

  /**
   * What a service does, in full. The publican's terms are printed in front of
   * the player before they pay: nothing here works in a way they cannot read
   * (design.md §6).
   */
  private serviceRule(service: ServiceKind, cost: number): string {
    if (service === 'STEADY') return `${SERVICE_TEXT.STEADY.name}: adds a STEADY to the kit. Buy again while the kit has room.`;
    if (service === 'CREDIT') return `${SERVICE_TEXT.CREDIT.name}: pay ${cost}, the publican puts ${SERVICE_COST.CREDIT * 2} in the Pot. Once.`;
    const target = this.rubOutTarget();
    return target
      ? `${SERVICE_TEXT.RUB_OUT.name}: rubs ${target} off the record, so it is printed at its full price again.`
      : `${SERVICE_TEXT.RUB_OUT.name}: rubs your most-paid contract off the record. Nothing has paid yet.`;
  }

  private drawDetail(r: Renderer): void {
    const box = this.lay.detail;
    const d = this.detailText();
    r.dither(box.x, box.y - 2, box.w, box.h + 1, P.INK, 11);
    const lines = r.wrap(d.text, box.w - 6);
    // Anything that will not fit is cut with an ellipsis rather than run off
    // the panel, the same as the slate strip does.
    const shown = lines.slice(0, this.lay.detailLines);
    if (lines.length > shown.length && shown.length) shown[shown.length - 1] = `${shown[shown.length - 1]}…`;
    shown.forEach((l, i) => r.text(l, box.x + 3, box.y + i * 8, { color: d.color }));
  }

  private drawReplace(r: Renderer): void {
    r.dither(0, 0, this.w, this.h, P.INK, 12);
    const pw = this.portrait ? 168 : 240;
    const px = Math.floor((this.w - pw) / 2);
    const py = this.replaceTop();
    const n = this.night.chalk.length;
    drawPanel(r, { x: px, y: py, w: pw, h: 16 + n * 18 + 26 }, 'CHALK SLOTS FULL · DISCARD ONE');
    if (!this.portrait) {
      this.night.chalk.forEach((c, i) => r.text(c.def.stage, px + 124, py + 20 + i * 18, { color: P.PEWTER }));
    }
    this.overlayButtons.draw(r, this.keyboardFocus);
  }
}
