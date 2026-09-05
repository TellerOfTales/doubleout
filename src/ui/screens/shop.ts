/**
 * The shop between legs (TDD §4.1): two cards, one chalk, one service,
 * one refresh. Services open the library picker; a sixth chalk asks which
 * one to discard.
 */
import { P } from '../../art/palette';
import { measureText } from '../../art/sprites';
import { cardDef } from '../../content/cards';
import { CHALK_DEFS, chalkDef } from '../../content/chalkdefs';
import { SHOP_REFRESH_COST } from '../../content/legs';
import { targetNotation } from '../../core/board';
import { buildBarkContext } from '../../core/commentary';
import { legName, shopBuy, shopLeave, shopRefresh } from '../../core/state';
import type { DartCard, NightState, ShopSlot } from '../../core/types';
import type { App } from '../app';
import { CommentaryBar } from '../commentarybar';
import type { Renderer } from '../draw';
import { inRect, type Pointer } from '../input';
import type { Rect } from '../layout';
import type { Scene } from '../scene';
import { Particles, Pulse, rndRange } from '../tween';
import { ButtonSet, drawPanel } from '../widgets';

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

const SERVICE_TEXT: Record<string, { name: string; blurb: string; icon: number }> = {
  REMOVE: { name: 'REMOVE A CARD', blurb: 'Take one card out of your library for good.', icon: 7 },
  DUPLICATE: { name: 'DUPLICATE', blurb: 'Add a second copy of one card you own.', icon: 8 },
  SHARPEN: { name: 'SHARPEN', blurb: 'Upgrade a card: single to treble, treble to double.', icon: 9 },
};

export class ShopScreen implements Scene {
  buttons = new ButtonSet();
  bar = new CommentaryBar();
  particles = new Particles();
  keyboardFocus = false;
  time = 0;
  selected = -1;
  overlay: 'none' | 'library' | 'replace' = 'none';
  overlayButtons = new ButtonSet();
  pendingService: number | null = null;
  pendingChalk: number | null = null;
  libraryPage = 0;
  chalkTip: string | null = null;
  potPulse = new Pulse();
  w = 320;
  h = 180;
  private slotRects: Rect[] = [];
  private buyFlash = new Map<number, Pulse>();
  private sortedLibrary: DartCard[] = [];

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
    this.bar.lines = this.portrait ? 4 : 2;
    this.layoutSlots();
    this.buildButtons();
  }

  private layoutSlots(): void {
    this.slotRects = [];
    if (this.portrait) {
      for (let i = 0; i < 4; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        this.slotRects.push({ x: 6 + col * 86, y: 14 + row * 88, w: 82, h: 84 });
      }
    } else {
      for (let i = 0; i < 4; i++) this.slotRects.push({ x: 6 + i * 78, y: 16, w: 74, h: 90 });
    }
  }

  private buildButtons(): void {
    const b = this.buttons;
    b.clear();
    const shop = this.night.shop;
    if (!shop) return;
    shop.slots.forEach((slot, i) => {
      const r = this.slotRects[i];
      const allowed = !this.hooks.allowedSlots || this.hooks.allowedSlots.includes(i);
      const canAfford = this.night.pot >= slot.cost;
      b.add({
        id: `buy${i}`,
        rect: { x: r.x + 8, y: r.y + r.h - 22, w: r.w - 16, h: 16 },
        label: slot.sold ? 'SOLD' : `BUY ${slot.cost}`,
        icon: slot.sold ? undefined : 5,
        disabled: slot.sold || !canAfford || !allowed,
        primary: !slot.sold && canAfford && allowed,
        onPress: () => this.buy(i),
      });
    });
    const by = this.portrait ? 206 : 112;
    const refreshAllowed = this.hooks.allowRefresh !== false;
    b.add({
      id: 'refresh',
      rect: { x: 6, y: by, w: this.portrait ? 82 : 96, h: 16 },
      label: shop.refreshed ? 'REFRESHED' : `REFRESH ${SHOP_REFRESH_COST}`,
      icon: 6,
      disabled: shop.refreshed || this.night.pot < SHOP_REFRESH_COST || !refreshAllowed,
      onPress: () => this.refresh(),
    });
    b.add({
      id: 'library',
      rect: { x: this.portrait ? 92 : 108, y: by, w: this.portrait ? 82 : 96, h: 16 },
      label: `LIBRARY ${this.night.library.length}`,
      icon: 26,
      onPress: () => this.openLibrary(null),
    });
    b.add({
      id: 'leave',
      rect: this.portrait ? { x: 6, y: by + 20, w: 168, h: 18 } : { x: 210, y: by, w: 104, h: 16 },
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
    if (slot.kind === 'SERVICE') {
      this.openLibrary(i);
      return;
    }
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
    const rect = this.slotRects[i];
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

  // ---------------------------------------------------------------- overlays

  private openLibrary(serviceSlot: number | null): void {
    this.overlay = 'library';
    this.pendingService = serviceSlot;
    this.libraryPage = 0;
    this.app.sfx('ui_confirm');
    this.sortedLibrary = this.night.library.slice().sort((a, b) => cardDef(b.defId).value - cardDef(a.defId).value || a.defId.localeCompare(b.defId));
    this.buildLibraryButtons();
  }

  private libraryGrid(): { cols: number; rows: number; cw: number; ch: number; x0: number; y0: number } {
    return this.portrait ? { cols: 6, rows: 5, cw: 26, ch: 30, x0: 10, y0: 40 } : { cols: 11, rows: 3, cw: 26, ch: 30, x0: 12, y0: 34 };
  }

  private buildLibraryButtons(): void {
    const ob = this.overlayButtons;
    ob.clear();
    const g = this.libraryGrid();
    const perPage = g.cols * g.rows;
    const pages = Math.max(1, Math.ceil(this.sortedLibrary.length / perPage));
    const bottom = g.y0 + g.rows * g.ch + 6;
    ob.add({ id: 'prev', rect: { x: g.x0, y: bottom, w: 40, h: 16 }, label: 'PREV', icon: 16, disabled: this.libraryPage <= 0, onPress: () => { this.libraryPage--; this.buildLibraryButtons(); } });
    ob.add({ id: 'next', rect: { x: g.x0 + 44, y: bottom, w: 40, h: 16 }, label: 'NEXT', icon: 17, disabled: this.libraryPage >= pages - 1, onPress: () => { this.libraryPage++; this.buildLibraryButtons(); } });
    ob.add({ id: 'close', rect: { x: this.w - 12 - 60, y: bottom, w: 60, h: 16 }, label: this.pendingService !== null ? 'CANCEL' : 'BACK', onPress: () => this.closeOverlay() });
    ob.focus = 2;
  }

  private libraryCardAt(x: number, y: number): DartCard | null {
    const g = this.libraryGrid();
    const perPage = g.cols * g.rows;
    const start = this.libraryPage * perPage;
    for (let i = 0; i < perPage; i++) {
      const c = this.sortedLibrary[start + i];
      if (!c) break;
      const rect = { x: g.x0 + (i % g.cols) * g.cw, y: g.y0 + Math.floor(i / g.cols) * g.ch, w: g.cw - 2, h: g.ch - 2 };
      if (inRect(x, y, rect)) return c;
    }
    return null;
  }

  private applyService(card: DartCard): void {
    if (this.pendingService === null) return;
    const i = this.pendingService;
    const out = shopBuy(this.night, i, { cardId: card.id });
    this.closeOverlay();
    this.afterBuy(i, out.ok, out.reason);
  }

  private openReplace(slot: number): void {
    this.overlay = 'replace';
    this.pendingChalk = slot;
    this.app.sfx('ui_confirm');
    const ob = this.overlayButtons;
    ob.clear();
    const px = Math.floor((this.w - (this.portrait ? 168 : 240)) / 2);
    const py = this.portrait ? 40 : 26;
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

  private closeOverlay(): void {
    this.overlay = 'none';
    this.pendingService = null;
    this.pendingChalk = null;
    this.overlayButtons.clear();
    this.app.sfx('ui_back');
  }

  // ---------------------------------------------------------------- input

  private chipRects(): Rect[] {
    const out: Rect[] = [];
    const y = this.portrait ? 248 : 132;
    const x0 = 6;
    for (let i = 0; i < this.night.chalkSlots; i++) out.push({ x: x0 + i * 24, y, w: 22, h: 22 });
    return out;
  }

  onDown(p: Pointer): void {
    this.keyboardFocus = false;
    if (this.hooks.onDown?.(p, this)) return;
    if (this.overlay === 'library') {
      const card = this.libraryCardAt(p.x, p.y);
      if (card && this.pendingService !== null) {
        this.applyService(card);
        return;
      }
      this.overlayButtons.down(p.x, p.y);
      return;
    }
    if (this.overlay === 'replace') {
      this.overlayButtons.down(p.x, p.y);
      return;
    }
    if (inRect(p.x, p.y, this.barRect())) {
      this.bar.skip();
      return;
    }
    // slot panels: select to read the blurb
    for (let i = 0; i < this.slotRects.length; i++) {
      if (inRect(p.x, p.y, this.slotRects[i])) {
        this.selected = i;
        this.chalkTip = null;
      }
    }
    const chips = this.chipRects();
    for (let i = 0; i < chips.length; i++) {
      if (inRect(p.x, p.y, chips[i]) && this.night.chalk[i]) {
        this.chalkTip = this.chalkTip === this.night.chalk[i].def.id ? null : this.night.chalk[i].def.id;
        this.selected = -1;
        this.app.sfx('ui_move');
      }
    }
    this.buttons.down(p.x, p.y);
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
      if (f && f.id.startsWith('buy')) this.selected = Number(f.id.slice(3));
    }
  }

  // ---------------------------------------------------------------- update / draw

  private barRect(): Rect {
    return this.portrait ? { x: 0, y: this.h - 36, w: this.w, h: 36 } : { x: 0, y: this.h - 20, w: this.w, h: 20 };
  }

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
    // chrome
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
    // held chalk
    const chips = this.chipRects();
    if (!this.portrait) r.text('YOUR CHALK', chips[0].x, chips[0].y - 9, { color: P.PEWTER });
    chips.forEach((c, i) => {
      const held = this.night.chalk[i];
      if (!held) {
        r.dither(c.x, c.y, c.w, c.h, P.INK, 6);
        r.rectOutline(c.x, c.y, c.w, c.h, P.SHADE);
        return;
      }
      r.nineSlice('chalk_frame', c.x, c.y, c.w, c.h, this.chalkTip === held.def.id ? 1 : 0);
      const idx = CHALK_DEFS.findIndex((d) => d.id === held.def.id);
      r.sprite('chalk_icons', c.x + 5, c.y + 5, Math.max(0, idx));
    });
    // library summary
    const lib = this.night.library;
    const mean = lib.length ? (lib.reduce((a, c) => a + cardDef(c.defId).value, 0) / lib.length).toFixed(1) : '0';
    const doubles = lib.filter((c) => c.target.region === 'D' || c.target.region === 'IB').length;
    const trebles = lib.filter((c) => c.target.region === 'T').length;
    const infoX = this.portrait ? 6 : chips[chips.length - 1].x + 30;
    const infoY = this.portrait ? 272 : 132;
    if (this.portrait) {
      r.dither(infoX - 3, infoY - 2, this.w - 6, 12, P.INK, 11);
      r.text(`${lib.length} CARDS · AVG ${mean} · ${trebles}T ${doubles}D`, infoX, infoY, { color: P.MIST });
    } else {
      r.dither(infoX - 3, infoY - 2, 130, 21, P.INK, 11);
      r.text(`${lib.length} CARDS · AVG ${mean}`, infoX, infoY, { color: P.MIST });
      r.text(`${trebles} TREBLES · ${doubles} DOUBLES`, infoX, infoY + 9, { color: P.PEWTER });
    }
    // detail strip: selected slot blurb or chalk tip
    const detailY = this.portrait ? 282 - 40 : 156 - 12;
    const detail = this.detailText();
    if (detail) {
      const dy = this.portrait ? 188 : detailY + 2;
      r.dither(3, dy - 2, this.w - 6, 20, P.INK, 11);
      r.textWrap(detail.text, 6, dy, this.w - 12, { color: detail.color });
    }
    this.buttons.draw(r, this.keyboardFocus);
    for (const p of this.particles.list) r.sprite(p.sprite, Math.round(p.x), Math.round(p.y), p.frame);
    this.bar.draw(r, this.barRect());
    if (this.overlay === 'library') this.drawLibrary(r);
    if (this.overlay === 'replace') this.drawReplace(r);
    this.hooks.draw?.(r, this);
  }

  private detailText(): { text: string; color: number } | null {
    if (this.chalkTip) {
      const d = chalkDef(this.chalkTip);
      return { text: `${d.name.toUpperCase()} (${d.stage}): ${d.blurb}`, color: P.CHALK };
    }
    const slot = this.night.shop?.slots[this.selected];
    if (!slot) return { text: 'TAP AN OFFER TO READ ABOUT IT. THE POT DOES NOT CARRY OVER SHAME, ONLY COINS.', color: P.STONE };
    if (slot.kind === 'CARD') {
      const d = cardDef(slot.defId);
      const region = d.target.region === 'T' ? 'A treble: three times the bed.' : d.target.region === 'D' ? 'A double: finishes a leg.' : d.target.region === 'IB' ? 'The bull: 50, and it counts as a double.' : d.target.region === 'OB' ? 'Outer bull: 25.' : 'A single.';
      return { text: `${targetNotation(d.target)} - worth ${d.value}. ${region} Added to your library for every leg.`, color: P.CHALK };
    }
    if (slot.kind === 'CHALK') {
      const d = chalkDef(slot.chalkId);
      return { text: `${d.name.toUpperCase()} (${d.stage}): ${d.blurb}`, color: P.CHALK };
    }
    const s = SERVICE_TEXT[slot.service];
    return { text: `${s.name}: ${s.blurb}`, color: P.CHALK };
  }

  private drawSlot(r: Renderer, slot: ShopSlot, i: number): void {
    const rect = this.slotRects[i];
    const sel = this.selected === i;
    const flash = this.buyFlash.get(i);
    drawPanel(r, rect, undefined, sel);
    if (flash?.active) r.dither(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, P.BRASS_LIT, flash.value * 8);
    const cx = rect.x + Math.floor(rect.w / 2);
    // Lay the captions out from the buy button upward so they fit any slot height.
    const buttonTop = rect.y + rect.h - 22;
    const stageY = buttonTop - 9;
    if (slot.kind === 'CARD') {
      const d = cardDef(slot.defId);
      const cxw = cx - 20;
      const cy = rect.y + 6;
      r.nineSlice('card_frame', cxw, cy, 40, 56, slot.sold ? 2 : 0);
      const t = d.target;
      const band = t.region === 'T' ? P.BRASS : t.region === 'D' ? P.SKY_LIT : t.region === 'IB' ? P.CLARET_LIT : t.region === 'OB' ? P.BAIZE_LIT : P.MIST;
      r.rect(cxw + 4, cy + 4, 32, 3, band);
      const regionWord = t.region === 'T' ? 'TREBLE' : t.region === 'D' ? 'DOUBLE' : t.region === 'IB' ? 'BULL' : t.region === 'OB' ? 'OUTER' : 'SINGLE';
      r.text(regionWord, cxw + 20, cy + 9, { color: P.MIST, align: 'center' });
      const big = t.region === 'IB' ? 'BULL' : t.region === 'OB' ? 'O·B' : targetNotation(t);
      r.text(big, cxw + 20, cy + 20, { color: slot.sold ? P.PEWTER : P.CHALK, align: 'center', scale: big.length > 3 ? 1 : 2, shadow: P.INK });
      r.text(String(d.value), cxw + 20, cy + 43, { color: P.CHALK, align: 'center', shadow: P.INK });
    } else if (slot.kind === 'CHALK') {
      const d = chalkDef(slot.chalkId);
      r.nineSlice('chalk_frame', cx - 16, rect.y + 6, 32, 32, sel ? 1 : 0);
      const idx = CHALK_DEFS.findIndex((x) => x.id === d.id);
      r.sprite('chalk_icons', cx - 6, rect.y + 16, Math.max(0, idx));
      const stageColor = d.stage === 'VALUE' ? P.BRASS_LIT : d.stage === 'BOARD' ? P.CLARET_LIT : d.stage === 'RULE' ? P.SKY_LIT : P.BAIZE_LIT;
      const lines = r.wrap(d.name.toUpperCase(), rect.w - 8).slice(0, 2);
      lines.forEach((l, k) => r.text(l, cx, stageY - lines.length * 8 + k * 8, { color: slot.sold ? P.PEWTER : P.CHALK, align: 'center' }));
      r.text(d.stage, cx, stageY, { color: stageColor, align: 'center' });
    } else {
      const s = SERVICE_TEXT[slot.service];
      r.spriteScaled('icons', cx - 12, rect.y + 8, 3, s.icon);
      const lines = r.wrap(s.name, rect.w - 8).slice(0, 2);
      lines.forEach((l, k) => r.text(l, cx, stageY - lines.length * 8 + k * 8, { color: slot.sold ? P.PEWTER : P.CHALK, align: 'center' }));
      r.text('SERVICE', cx, stageY, { color: P.MIST, align: 'center' });
    }
  }

  private drawLibrary(r: Renderer): void {
    r.dither(0, 0, this.w, this.h, P.INK, 12);
    const g = this.libraryGrid();
    const title = this.pendingService !== null ? `${SERVICE_TEXT[(this.night.shop?.slots[this.pendingService] as { service: string }).service].name}: CHOOSE A CARD` : `YOUR LIBRARY · ${this.night.library.length} CARDS`;
    r.text(title, this.w / 2, g.y0 - 14, { color: P.BRASS_LIT, align: 'center' });
    const perPage = g.cols * g.rows;
    const start = this.libraryPage * perPage;
    for (let i = 0; i < perPage; i++) {
      const c = this.sortedLibrary[start + i];
      if (!c) break;
      const x = g.x0 + (i % g.cols) * g.cw;
      const y = g.y0 + Math.floor(i / g.cols) * g.ch;
      const t = c.target;
      const band = t.region === 'T' ? P.BRASS : t.region === 'D' ? P.SKY_LIT : t.region === 'IB' ? P.CLARET_LIT : t.region === 'OB' ? P.BAIZE_LIT : P.MIST;
      r.panel(x, y, g.cw - 2, g.ch - 2, P.STONE, P.INK);
      r.rect(x + 2, y + 2, g.cw - 6, 2, band);
      const label = t.region === 'IB' ? 'BUL' : t.region === 'OB' ? 'O·B' : targetNotation(t);
      r.text(label, x + Math.floor((g.cw - 2) / 2), y + 7, { color: P.CHALK, align: 'center' });
      r.text(String(cardDef(c.defId).value), x + Math.floor((g.cw - 2) / 2), y + 17, { color: P.MIST, align: 'center' });
    }
    const pages = Math.max(1, Math.ceil(this.sortedLibrary.length / perPage));
    r.text(`PAGE ${this.libraryPage + 1}/${pages}`, this.w / 2, g.y0 + g.rows * g.ch + 10, { color: P.PEWTER, align: 'center' });
    this.overlayButtons.draw(r, this.keyboardFocus);
  }

  private drawReplace(r: Renderer): void {
    r.dither(0, 0, this.w, this.h, P.INK, 12);
    const pw = this.portrait ? 168 : 240;
    const px = Math.floor((this.w - pw) / 2);
    const py = this.portrait ? 40 : 26;
    const n = this.night.chalk.length;
    drawPanel(r, { x: px, y: py, w: pw, h: 16 + n * 18 + 26 }, 'CHALK SLOTS FULL · DISCARD ONE');
    if (!this.portrait) {
      this.night.chalk.forEach((c, i) => r.text(c.def.stage, px + 124, py + 20 + i * 18, { color: P.PEWTER }));
    }
    this.overlayButtons.draw(r, this.keyboardFocus);
  }
}
