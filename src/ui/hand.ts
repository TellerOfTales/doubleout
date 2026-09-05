/**
 * The hand of dart cards and the commit gesture (TDD §13): flick a card
 * upward toward the board to throw it; tap-to-select then tap-to-throw is
 * the fallback. Keyboard: arrows/1-4 select, Enter/Space throw.
 */
import { P } from '../art/palette';
import { baseValue, targetNotation } from '../core/board';
import type { DartCard } from '../core/types';
import type { Renderer } from './draw';
import { inRect, type Pointer } from './input';
import { cardSlots, type GameLayout, type Rect } from './layout';
import { clamp01, ease } from './tween';

export interface CardView {
  card: DartCard;
  slot: Rect;
  /** Current drawn position (animated). */
  x: number;
  y: number;
  /** Deal-in animation progress 0..1. */
  dealT: number;
  dealDelay: number;
  /** Snap-back animation. */
  snapT: number;
  snapFrom: { x: number; y: number } | null;
  gone: boolean;
}

export interface HandCallbacks {
  onThrow(card: DartCard, from: { x: number; y: number }, velocity: { vx: number; vy: number }): void;
  onSelect(card: DartCard | null): void;
  onDeal(): void;
  sound(name: 'card_deal' | 'card_select' | 'whoosh' | 'error'): void;
}

const FLICK_SPEED = 220; // internal px/s upward
const FLICK_DISTANCE = 26; // px above the slot top

export class Hand {
  cards: CardView[] = [];
  selectedId: string | null = null;
  /** No input while the previous throw is animating. */
  locked = false;
  /** When set, only these card ids may be thrown (tutorial). */
  allowed: Set<string> | null = null;
  /** Card ids that begin a finishing route (brass pulse). */
  routeStarts = new Set<string>();
  /** Card ids whose throw would bust (ember value). */
  bustIds = new Set<string>();
  /** Card values after chalk, by id (for the value label). */
  values = new Map<string, number>();
  /** What the score becomes if this card is thrown, by id. */
  leaves = new Map<string, number>();
  /** How good that leave is: a finish, a live position, or a dead end. */
  leaveKind = new Map<string, 'finish' | 'route' | 'live' | 'dead' | 'bust'>();
  /** The card currently set aside, drawn with a brass tag. */
  pocketId: string | null = null;
  tapToThrow = true;
  hintOn = true;
  time = 0;

  drag: {
    id: string;
    startX: number;
    startY: number;
    offX: number;
    offY: number;
    samples: { x: number; y: number; t: number }[];
    moved: boolean;
    t0: number;
  } | null = null;

  constructor(
    public layout: GameLayout,
    private cb: HandCallbacks,
  ) {}

  setLayout(l: GameLayout): void {
    this.layout = l;
    const slots = cardSlots(l, this.cards.length);
    this.cards.forEach((c, i) => {
      c.slot = slots[i];
      c.x = c.slot.x;
      c.y = c.slot.y;
    });
  }

  /**
   * Keep the views for cards still in hand, drop the spent one, and slide the
   * rest into their new slots. Called after every throw of a visit.
   */
  sync(cards: DartCard[]): void {
    const byId = new Map(this.cards.map((c) => [c.card.id, c]));
    const slots = cardSlots(this.layout, cards.length);
    this.cards = cards.map((card, i) => {
      const existing = byId.get(card.id);
      if (existing) {
        existing.slot = slots[i];
        existing.gone = false;
        existing.snapFrom = { x: existing.x, y: existing.y };
        existing.snapT = 0;
        return existing;
      }
      return { card, slot: slots[i], x: slots[i].x, y: slots[i].y + 40, dealT: 0, dealDelay: i * 0.05, snapT: 1, snapFrom: null, gone: false };
    });
    if (this.selectedId && !cards.some((c) => c.id === this.selectedId)) this.selectedId = null;
    this.drag = null;
  }

  /** Replace the hand with freshly dealt cards (with a staggered deal animation). */
  deal(cards: DartCard[]): void {
    const slots = cardSlots(this.layout, cards.length);
    this.cards = cards.map((card, i) => ({
      card,
      slot: slots[i],
      x: slots[i].x,
      y: slots[i].y + 40,
      dealT: 0,
      dealDelay: i * 0.07,
      snapT: 1,
      snapFrom: null,
      gone: false,
    }));
    this.selectedId = null;
    this.drag = null;
    this.cb.onDeal();
  }

  clear(): void {
    this.cards = [];
    this.selectedId = null;
    this.drag = null;
  }

  get selected(): CardView | null {
    return this.cards.find((c) => c.card.id === this.selectedId && !c.gone) ?? null;
  }

  private cardAt(x: number, y: number): CardView | null {
    // Topmost first: the selected card is drawn on top.
    const order = this.cards.slice().sort((a, b) => (a.card.id === this.selectedId ? 1 : 0) - (b.card.id === this.selectedId ? 1 : 0));
    for (let i = order.length - 1; i >= 0; i--) {
      const c = order[i];
      if (c.gone) continue;
        const rect = { x: c.x, y: c.y - 4, w: c.slot.w, h: c.slot.h + 4 };
      if (inRect(x, y, rect)) return c;
    }
    return null;
  }

  private canThrow(c: CardView): boolean {
    return !this.locked && !c.gone && (this.allowed === null || this.allowed.has(c.card.id));
  }

  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.cb.onSelect(this.selected?.card ?? null);
    if (id) this.cb.sound('card_select');
  }

  /** Keyboard selection by index (0-based). */
  selectIndex(i: number): void {
    const live = this.cards.filter((c) => !c.gone);
    if (i < 0 || i >= live.length) return;
    this.select(live[i].card.id);
  }

  moveSelection(delta: number): void {
    const live = this.cards.filter((c) => !c.gone);
    if (live.length === 0) return;
    let idx = live.findIndex((c) => c.card.id === this.selectedId);
    idx = idx < 0 ? (delta > 0 ? 0 : live.length - 1) : (idx + delta + live.length) % live.length;
    this.select(live[idx].card.id);
  }

  /** Throw the selected card (keyboard / tap fallback). */
  throwSelected(): boolean {
    const c = this.selected;
    if (!c || !this.canThrow(c)) {
      if (c) this.cb.sound('error');
      return false;
    }
    this.launch(c, { vx: 0, vy: -420 });
    return true;
  }

  private launch(c: CardView, v: { vx: number; vy: number }): void {
    c.gone = true;
    this.drag = null;
    const from = { x: c.x + c.slot.w / 2, y: c.y + 8 };
    this.selectedId = null;
    this.cb.sound('whoosh');
    this.cb.onThrow(c.card, from, v);
  }

  onDown(p: Pointer): boolean {
    if (this.locked) return false;
    const c = this.cardAt(p.x, p.y);
    if (!c) return false;
    this.drag = {
      id: c.card.id,
      startX: p.x,
      startY: p.y,
      offX: p.x - c.x,
      offY: p.y - c.y,
      samples: [{ x: p.x, y: p.y, t: p.t }],
      moved: false,
      t0: p.t,
    };
    return true;
  }

  onMove(p: Pointer): void {
    const d = this.drag;
    if (!d) return;
    const c = this.cards.find((k) => k.card.id === d.id);
    if (!c || c.gone) return;
    const dist = Math.hypot(p.x - d.startX, p.y - d.startY);
    if (dist > 5) {
      d.moved = true;
      if (this.selectedId !== c.card.id) this.select(c.card.id);
    }
    if (d.moved && this.canThrow(c)) {
      c.x = p.x - d.offX;
      c.y = p.y - d.offY;
    }
    d.samples.push({ x: p.x, y: p.y, t: p.t });
    if (d.samples.length > 8) d.samples.shift();
  }

  onUp(p: Pointer): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const c = this.cards.find((k) => k.card.id === d.id);
    if (!c || c.gone) return;
    const dtTap = p.t - d.t0;
    if (!d.moved) {
      // Tap: select, or throw if already selected and allowed.
      if (this.selectedId === c.card.id && this.tapToThrow && dtTap < 400) {
        if (this.canThrow(c)) this.launch(c, { vx: 0, vy: -420 });
        else this.cb.sound('error');
      } else {
        this.select(c.card.id);
      }
      return;
    }
    // Flick: velocity from the last ~90ms of samples.
    const s = d.samples;
    const last = s[s.length - 1];
    let first = s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (last.t - s[i].t > 90) break;
      first = s[i];
    }
    const dt = Math.max(1, last.t - first.t) / 1000;
    const vy = (last.y - first.y) / dt;
    const vx = (last.x - first.x) / dt;
    const liftedAbove = c.y < c.slot.y - FLICK_DISTANCE;
    if (this.canThrow(c) && (vy < -FLICK_SPEED || liftedAbove)) {
      this.launch(c, { vx, vy: Math.min(vy, -FLICK_SPEED) });
      return;
    }
    if (!this.canThrow(c) && (vy < -FLICK_SPEED || liftedAbove)) this.cb.sound('error');
    // snap back
    c.snapFrom = { x: c.x, y: c.y };
    c.snapT = 0;
  }

  onCancel(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const c = this.cards.find((k) => k.card.id === d.id);
    if (c && !c.gone) {
      c.snapFrom = { x: c.x, y: c.y };
      c.snapT = 0;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const c of this.cards) {
      if (c.gone) continue;
      if (c.dealT < 1) {
        if (c.dealDelay > 0) {
          c.dealDelay -= dt;
          continue;
        }
        if (c.dealT === 0) this.cb.sound('card_deal');
        c.dealT = Math.min(1, c.dealT + dt * 5);
        const e = ease.outBack(c.dealT);
        c.x = c.slot.x;
        c.y = Math.round(c.slot.y + 40 * (1 - e));
        continue;
      }
      const dragging = this.drag?.id === c.card.id && this.drag.moved;
      if (dragging) continue;
      if (c.snapT < 1 && c.snapFrom) {
        c.snapT = Math.min(1, c.snapT + dt * 6);
        const e = ease.outCubic(c.snapT);
        const targetY = c.slot.y - (this.selectedId === c.card.id ? 6 : 0);
        c.x = Math.round(c.snapFrom.x + (c.slot.x - c.snapFrom.x) * e);
        c.y = Math.round(c.snapFrom.y + (targetY - c.snapFrom.y) * e);
        continue;
      }
      const targetY = c.slot.y - (this.selectedId === c.card.id ? 6 : 0);
      c.x = c.slot.x;
      c.y += Math.sign(targetY - c.y) * Math.min(Math.abs(targetY - c.y), Math.ceil(dt * 60));
    }
  }

  draw(r: Renderer): void {
    const order = this.cards.filter((c) => !c.gone).sort((a, b) => (a.card.id === this.selectedId ? 1 : 0) - (b.card.id === this.selectedId ? 1 : 0));
    for (const c of order) this.drawCard(r, c);
  }

  private drawCard(r: Renderer, c: CardView): void {
    const cardW = c.slot.w;
    const cardH = c.slot.h;
    const selected = c.card.id === this.selectedId;
    const disallowed = this.allowed !== null && !this.allowed.has(c.card.id);
    const dragging = this.drag?.id === c.card.id && this.drag.moved;
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    // shadow
    r.dither(x + 2, y + 3, cardW, cardH, P.INK, dragging ? 6 : 10);
    const frame = disallowed ? 2 : selected ? 1 : 0;
    r.nineSlice('card_frame', x, y, cardW, cardH, frame);
    const t = c.card.target;
    const notation = targetNotation(t);
    const value = this.values.get(c.card.id) ?? baseValue(t);
    const isRoute = this.hintOn && this.routeStarts.has(c.card.id);
    const isBust = this.hintOn && this.bustIds.has(c.card.id);
    // region band colour: treble brass, double sky-lit, bull claret-lit, single mist
    const kept = this.pocketId === c.card.id;
    const band = kept ? P.BRASS_LIT : t.region === 'T' ? P.BRASS : t.region === 'D' ? P.SKY_LIT : t.region === 'IB' ? P.CLARET_LIT : t.region === 'OB' ? P.BAIZE_LIT : P.MIST;
    r.rect(x + 4, y + 4, cardW - 8, 3, band);
    // A kept card wears a brass edge all visit, so it reads at a glance.
    if (kept) r.rectOutline(x, y, cardW, cardH, P.BRASS_LIT);
    // The target, large — the notation already says single, double or treble.
    const big = t.region === 'IB' ? 'BULL' : t.region === 'OB' ? 'O·B' : notation;
    const bigScale = big.length <= 3 && cardW >= 36 ? 2 : 1;
    r.text(big, x + cardW / 2, y + (bigScale === 2 ? 9 : 11), { color: disallowed ? P.PEWTER : P.CHALK, align: 'center', scale: bigScale, shadow: P.INK });
    // What it scores — the number you are doing arithmetic on.
    const vcol = disallowed ? P.PEWTER : isBust ? P.EMBER : isRoute ? P.BRASS_LIT : P.CHALK;
    const vs = String(value);
    const vScale = vs.length * 12 - 1 <= cardW - 8 ? 2 : 1;
    r.text(vs, x + cardW / 2, y + (bigScale === 2 ? 25 : 21), { color: vcol, align: 'center', scale: vScale, shadow: P.INK });

    // What it leaves you — the whole tactical read, on the card.
    const leaves = this.leaves.get(c.card.id);
    const kind = this.leaveKind.get(c.card.id);
    if (leaves !== undefined && this.hintOn) {
      for (let i = 4; i < cardW - 4; i += 2) r.pixel(x + i, y + 41, P.SHADE);
      const label = kind === 'bust' ? 'BUST' : kind === 'finish' ? 'OUT!' : `→${leaves}`;
      const col = disallowed
        ? P.PEWTER
        : kind === 'bust'
          ? P.EMBER
          : kind === 'finish'
            ? P.BRASS_LIT
            : kind === 'route'
              ? P.BAIZE_LIT
              : kind === 'dead'
                ? P.CLARET_LIT
                : P.MIST;
      r.text(label, x + cardW / 2, y + 45, { color: col, align: 'center', shadow: P.INK });
    }
    // flight colour, tucked into the band corners so the numbers keep the room
    const flightCol = [P.SKY, P.CLARET_LIT, P.BAIZE_LIT, P.BRASS][c.card.flight];
    r.rect(x + 2, y + 4, 2, 3, flightCol);
    r.rect(x + cardW - 4, y + 4, 2, 3, flightCol);
    if (isRoute && !disallowed) {
      const on = Math.floor(this.time * 3) % 2 === 0;
      r.rectOutline(x - 1, y - 1, cardW + 2, cardH + 2, on ? P.BRASS_LIT : P.BRASS);
    }
  }

  get dragging(): boolean {
    return !!this.drag?.moved;
  }
}
