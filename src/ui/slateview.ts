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

export type SlateVerbId = 'TAKE' | 'PULL' | 'PRESS';

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
  /** Offered (take it) or riding (pull, bank or press it). */
  mode: 'OFFER' | 'RIDING' | 'SETTLED';
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

  draw(r: Renderer): void {
    const f = this.flash();
    for (let i = 0; i < this.cards.length; i++) drawContract(r, this.cards[i], this.hover === i, this.time, f);
  }
}

const STATUS_COLOUR: Record<string, number> = { LIVE: P.MIST, MADE: P.BAIZE_LIT, DEAD: P.EMBER };

export function drawContract(r: Renderer, c: SlateCardView, hovered: boolean, time: number, flash: { color: number; v: number } | null = null): void {
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
    r.text(`${c.prices.leftLabel}${c.prices.left}`, x + 3, py, { font: 5, color: dim ? P.STONE : P.MIST });
    r.text(`${c.prices.rightLabel}${c.prices.right}`, x + w - 3, py, { font: 5, color: dim ? P.STONE : P.BRASS_LIT, align: 'right' });
  }

  // A contract that has landed but is still riding gets a tick that pulses,
  // because that is the moment the player has a decision to make.
  if (made && c.mode === 'RIDING' && Math.sin(time * 5) > 0) r.text('\u2713', x + w - 8, y + 3, { font: 5, color: P.BAIZE_LIT });
  if (dead) for (let i = 0; i < w - 4; i += 2) r.pixel(x + 2 + i, y + Math.floor(h / 2), P.CLARET_LIT);

  for (const v of c.verbs) {
    const key = v.id === 'PRESS' ? P.EMBER : v.id === 'TAKE' ? P.BRASS_LIT : P.MIST;
    r.rect(v.rect.x, v.rect.y, v.rect.w, v.rect.h, v.disabled ? P.DEEP : P.SHADE);
    r.rectOutline(v.rect.x, v.rect.y, v.rect.w, v.rect.h, v.disabled ? P.SHADE : key);
    r.text(v.label, v.rect.x + Math.floor(v.rect.w / 2), v.rect.y + 2, { font: 5, color: v.disabled ? P.STONE : key, align: 'center' });
  }
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
