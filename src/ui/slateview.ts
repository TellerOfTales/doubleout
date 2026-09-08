/**
 * THE SLATE on screen: the contracts chalked up beside the score, and the
 * three verbs the player has between darts.
 *
 * This strip replaced the hand of dealt cards. The difference is visible in
 * what it shows: the old strip told you which four places you were permitted
 * to aim at, and this one tells you what a visit is worth and what you stand
 * to lose by carrying on. Nothing here restricts where the dart may go.
 */
import { P } from '../art/palette';
import { measureText } from '../art/sprites';
import type { Renderer } from './draw';
import { CONTRACT_BY_ID } from '../core/slate';
import type { TakenContract } from '../core/types';
import type { Rect } from './layout';
import { Pulse } from './tween';

export type SlateVerbId = 'TAKE' | 'PULL' | 'PRESS' | 'RIDE' | 'DOWN';

export interface SlateVerb {
  id: SlateVerbId;
  label: string;
  rect: Rect;
  disabled: boolean;
}

/** The two numbers printed above the verbs: what you get now, what you get if you wait. */
export interface SlatePrices {
  leftLabel: string;
  left: number;
  rightLabel: string;
  right: number;
}

export interface SlateCardView {
  /** Contract def id. */
  defId: string;
  rect: Rect;
  /** Offered, riding, settled this visit, or the wire itself. */
  mode: 'OFFER' | 'RIDING' | 'SETTLED' | 'WIRE';
  /** For a riding contract, its index on the leg's slate. */
  index: number;
  stake: number;
  price: number;
  status: 'LIVE' | 'MADE' | 'DEAD';
  /** Greyed out because the Pot cannot cover the stake. */
  unaffordable: boolean;
  settled?: { pot: number; how: string } | null;
  /** What the player can do to it right now, laid out along the bottom. */
  verbs: SlateVerb[];
  /** The money line. Verb buttons carry only words; the numbers live here. */
  prices?: SlatePrices;
}

/** Lay the verbs out along the bottom of a contract card. */
export function layoutVerbs(rect: Rect, verbs: { id: SlateVerbId; label: string; disabled: boolean }[]): SlateVerb[] {
  if (!verbs.length) return [];
  const h = 11;
  const gap = 2;
  const y = rect.y + rect.h - h - 2;
  const w = Math.floor((rect.w - 4 - (verbs.length - 1) * gap) / verbs.length);
  return verbs.map((v, i) => ({ ...v, rect: { x: rect.x + 2 + i * (w + gap), y, w, h } }));
}

export class SlateView {
  cards: SlateCardView[] = [];
  /** defId or slate index the pointer is over. */
  hover = -1;
  /** Money going out: a contract taken or pulled. */
  taken = new Pulse();
  /** Money coming in: a contract that landed. */
  paid = new Pulse();
  /** Money gone: a contract dead or lost. */
  lost = new Pulse();
  time = 0;

  update(dt: number): void {
    this.time += dt;
    this.taken.update(dt);
    this.paid.update(dt);
    this.lost.update(dt);
  }

  /**
   * The strip's flash. These three pulses were built and ticked every frame
   * and no draw code read them, so staking, winning and losing money all
   * looked exactly the same: like nothing. The strip now takes the colour of
   * whatever the money just did.
   */
  flash(): { color: number; v: number } | null {
    if (this.paid.active) return { color: P.BRASS_LIT, v: this.paid.value };
    if (this.lost.active) return { color: P.EMBER, v: this.lost.value };
    if (this.taken.active) return { color: P.CHALK, v: this.taken.value };
    return null;
  }

  at(x: number, y: number): SlateCardView | null {
    for (const c of this.cards) {
      if (x >= c.rect.x && x < c.rect.x + c.rect.w && y >= c.rect.y && y < c.rect.y + c.rect.h) return c;
    }
    return null;
  }

  /** The verb under a point, with the card it belongs to. */
  verbAt(x: number, y: number): { card: SlateCardView; verb: SlateVerb } | null {
    for (const c of this.cards) {
      for (const v of c.verbs) {
        if (!v.disabled && x >= v.rect.x && x < v.rect.x + v.rect.w && y >= v.rect.y && y < v.rect.y + v.rect.h) return { card: c, verb: v };
      }
    }
    return null;
  }

  /** Set by the game screen each rebuild, when there is money on the wire. */
  wire: WireView | null = null;

  draw(r: Renderer): void {
    const f = this.flash();
    for (let i = 0; i < this.cards.length; i++) drawContract(r, this.cards[i], this.hover === i, this.time, f, this.wire ?? undefined);
  }
}

const STATUS_COLOUR: Record<string, number> = { LIVE: P.MIST, MADE: P.BAIZE_LIT, DEAD: P.EMBER };

/** How much is on the wire, what it is worth, and what one more visit would make it. */
export interface WireView {
  amount: number;
  run: number;
  worth: number;
  next: number;
  /** True while the called dart could put it in the wall or bust the visit. */
  hot: boolean;
}

/**
 * THE WIRE, on the strip. It takes the first slot, ahead of every contract,
 * because it is the only thing on the row that is money rather than a promise.
 */
export function drawWire(r: Renderer, c: SlateCardView, w: WireView, time: number): void {
  const { x, y, h } = c.rect;
  const cw = c.rect.w;
  const mult = w.worth / Math.max(1, w.amount);
  const top = w.run >= 3 ? P.EMBER : P.BRASS_LIT;
  const pulse = Math.sin(time * (3 + w.run)) > 0;
  r.panel(x, y, cw, h, P.INK, w.hot ? P.EMBER : pulse ? top : P.BRASS);
  const mid = x + Math.floor(cw / 2);
  r.text('WIRE', mid, y + 3, { font: 5, color: P.BRASS_LIT, align: 'center' });
  r.line(x + 2, y + 11, x + cw - 3, y + 11, P.STONE);
  // The figure, as big as the slot can carry it. This is the number the whole
  // mechanic exists to put in front of the player.
  const worth = String(w.worth);
  const big = measureText(9, worth) + 6 <= cw;
  r.text(worth, mid, y + 14, { font: big ? 9 : 5, color: w.hot ? P.EMBER : P.BRASS_LIT, align: 'center', shadow: P.INK });
  r.text(`×${mult}`, mid, y + (big ? 27 : 22), { font: 5, color: top, align: 'center' });
  drawChips(r, x + 3, y + (big ? 33 : 28), w.amount, cw - 6);
  // What one more fed visit would make it: the whole reason to leave it up.
  const next = `${w.next} NEXT`;
  const line = measureText(5, next) <= cw - 6 ? next : String(w.next);
  r.text(line, mid, y + h - 21, { font: 5, color: P.PEWTER, align: 'center' });
  for (const v of c.verbs) drawVerb(r, v);
}

/** A stack of chips: the only physical token for money in the build. */
function drawChips(r: Renderer, x: number, y: number, amount: number, maxW: number): void {
  const per = 4;
  const stacks = Math.max(1, Math.ceil(amount / per));
  const room = Math.max(1, Math.floor(maxW / 5));
  const shown = Math.min(stacks, room);
  for (let i = 0; i < shown; i++) {
    const inThis = Math.min(per, amount - i * per);
    for (let j = 0; j < inThis; j++) {
      const cy = y + 6 - j * 2;
      r.rect(x + i * 5, cy, 4, 1, P.BRASS_LIT);
      r.rect(x + i * 5, cy + 1, 4, 1, P.BRASS);
    }
  }
  if (stacks > room) r.text('+', x + room * 5, y + 2, { font: 5, color: P.BRASS });
}

function drawVerb(r: Renderer, v: SlateVerb): void {
  const key = v.id === 'PRESS' ? P.EMBER : v.id === 'DOWN' ? P.BRASS_LIT : v.id === 'RIDE' ? P.CLARET_LIT : v.id === 'TAKE' ? P.BRASS_LIT : P.MIST;
  r.rect(v.rect.x, v.rect.y, v.rect.w, v.rect.h, v.disabled ? P.DEEP : P.SHADE);
  r.rectOutline(v.rect.x, v.rect.y, v.rect.w, v.rect.h, v.disabled ? P.SHADE : key);
  r.text(v.label, v.rect.x + Math.floor(v.rect.w / 2), v.rect.y + 2, { font: 5, color: v.disabled ? P.STONE : key, align: 'center' });
}

export function drawContract(r: Renderer, c: SlateCardView, hovered: boolean, time: number, flash: { color: number; v: number } | null = null, wire?: WireView): void {
  if (c.mode === 'WIRE') {
    if (wire) drawWire(r, c, wire, time);
    return;
  }
  const def = CONTRACT_BY_ID[c.defId];
  if (!def) return;
  const { x, y, w, h } = c.rect;
  const made = c.status === 'MADE';
  const dead = c.status === 'DEAD';
  const gone = c.mode === 'SETTLED';
  const dim = c.unaffordable || dead || gone;
  const edge = dead ? P.CLARET : made ? P.BAIZE_LIT : hovered ? P.CHALK : P.STONE;
  r.panel(x, y, w, h, gone ? P.INK : made ? P.SHADE : P.DEEP, gone ? P.SHADE : edge);
  if (flash && flash.v > 0.15) {
    // The whole strip takes the colour of the money for a beat.
    r.rectOutline(x, y, w, h, flash.color);
    r.dither(x + 1, y + 1, w - 2, h - 2, flash.color, Math.round(flash.v * 5));
  }

  // The name, on the chalk line at the top, trimmed to the panel. With Wide
  // Grip the strip carries a fourth card and every one of them narrows; a name
  // that overruns its own frame reads as a rendering fault, not as a contract.
  let name = def.name;
  while (name.length > 1 && measureText(5, name) > w - 6) name = name.slice(0, -1);
  r.text(name, x + 3, y + 3, { font: 5, color: dim ? P.PEWTER : P.CHALK });
  r.line(x + 2, y + 11, x + w - 3, y + 11, P.STONE);

  // What it asks for. The strip is narrow, so anything that will not fit is
  // cut here and printed in full on the readout when the card is tapped.
  const bottom = (c.verbs.length ? 13 : 0) + (c.prices ? 10 : 0);
  const room = Math.max(1, Math.floor((h - 16 - bottom) / 7));
  const lines = r.wrap(def.blurb, w - 6, 5, 1);
  let ty = y + 14;
  for (const line of lines.slice(0, room)) {
    r.text(line, x + 3, ty, { font: 5, color: dim ? P.STONE : P.MIST });
    ty += 7;
  }
  if (lines.length > room) r.text('\u2026', x + w - 6, y + 14 + (room - 1) * 7, { font: 5, color: P.PEWTER });

  if (gone && c.settled) {
    // Settled this visit: what it did, so the strip is a ledger rather than a gap.
    const profit = c.settled.pot - c.stake;
    const good = profit > 0;
    r.text(c.settled.how, x + 3, y + h - 10, { font: 5, color: P.PEWTER });
    r.text(good ? `+${profit}` : c.settled.pot === 0 ? `-${c.stake}` : 'EVEN', x + w - 3, y + h - 10, {
      font: 5,
      color: good ? P.BRASS_LIT : c.settled.pot === 0 ? P.EMBER : P.MIST,
      align: 'right',
    });
    for (let i = 0; i < w - 4; i += 2) r.pixel(x + 2 + i, y + Math.floor(h / 2), P.SHADE);
    return;
  }

  // The money line: what taking it costs, or what it is worth now against what
  // it is worth if it is left up. Verb buttons carry the word, never the number.
  if (c.prices) {
    const py = y + h - (c.verbs.length ? 24 : 10);
    r.line(x + 2, py - 2, x + w - 3, py - 2, P.STONE);
    // The labels are the first thing to go when the card narrows: two numbers
    // that touch read as one wrong number, and "2PAYS 9" is not a price.
    let left = `${c.prices.leftLabel}${c.prices.left}`;
    let right = `${c.prices.rightLabel}${c.prices.right}`;
    if (measureText(5, left) + measureText(5, right) + 5 > w - 6) {
      left = String(c.prices.left);
      right = String(c.prices.right);
    }
    r.text(left, x + 3, py, { font: 5, color: dim ? P.STONE : P.MIST });
    r.text(right, x + w - 3, py, { font: 5, color: dim ? P.STONE : P.BRASS_LIT, align: 'right' });
  }

  // A contract that has landed but is still riding gets a tick that pulses,
  // because that is the moment the player has a decision to make.
  if (made && c.mode === 'RIDING' && Math.sin(time * 5) > 0) r.text('\u2713', x + w - 8, y + 3, { font: 5, color: P.BAIZE_LIT });
  if (dead) for (let i = 0; i < w - 4; i += 2) r.pixel(x + 2 + i, y + Math.floor(h / 2), P.CLARET_LIT);

  for (const v of c.verbs) drawVerb(r, v);
  void STATUS_COLOUR;
}

/**
 * An empty slot, so the strip keeps its shape when nothing is riding. A solid
 * ground and a dashed edge: a dithered one read as the pub wall showing
 * through and made the row look like a fence.
 */
export function drawEmptySlot(r: Renderer, rect: Rect): void {
  r.rect(rect.x, rect.y, rect.w, rect.h, P.INK);
  for (let x = rect.x; x < rect.x + rect.w; x += 3) {
    r.pixel(x, rect.y, P.SHADE);
    r.pixel(x, rect.y + rect.h - 1, P.SHADE);
  }
  for (let y = rect.y; y < rect.y + rect.h; y += 3) {
    r.pixel(rect.x, y, P.SHADE);
    r.pixel(rect.x + rect.w - 1, y, P.SHADE);
  }
}
