/**
 * Buttons, focus handling and small reusable widgets. Buttons are 9-slice
 * sprites with 5×7 labels; the focus ring is keyboard navigation.
 */
import { P } from '../art/palette';
import { measureText } from '../art/sprites';
import type { Renderer } from './draw';
import { inRect } from './input';
import type { Rect } from './layout';

export interface Button {
  id: string;
  rect: Rect;
  label: string;
  /** Optional icon frame from the `icons` sheet drawn left of the label. */
  icon?: number;
  disabled?: boolean;
  primary?: boolean;
  /** Small caption under the label (e.g. a price). */
  caption?: string;
  captionColor?: number;
  onPress?: () => void;
  hidden?: boolean;
}

export class ButtonSet {
  buttons: Button[] = [];
  focus = -1;
  pressed: string | null = null;
  hover: string | null = null;

  add(b: Button): Button {
    this.buttons.push(b);
    return b;
  }

  clear(): void {
    this.buttons = [];
    this.focus = -1;
    this.pressed = null;
  }

  get(id: string): Button | undefined {
    return this.buttons.find((b) => b.id === id);
  }

  private visible(): Button[] {
    return this.buttons.filter((b) => !b.hidden);
  }

  at(x: number, y: number): Button | null {
    for (const b of this.visible()) if (!b.disabled && inRect(x, y, b.rect)) return b;
    return null;
  }

  down(x: number, y: number): boolean {
    const b = this.at(x, y);
    this.pressed = b ? b.id : null;
    if (b) this.focus = this.buttons.indexOf(b);
    return !!b;
  }

  /** Returns the button activated, if any. */
  up(x: number, y: number): Button | null {
    const b = this.at(x, y);
    const hit = b && this.pressed === b.id ? b : null;
    this.pressed = null;
    if (hit) hit.onPress?.();
    return hit;
  }

  move(x: number, y: number): void {
    const b = this.at(x, y);
    this.hover = b ? b.id : null;
  }

  /** Keyboard: arrows move focus (in list order), Enter/Space activate. Returns true if handled. */
  key(k: string): boolean {
    const vis = this.visible().filter((b) => !b.disabled);
    if (vis.length === 0) return false;
    const cur = this.focus >= 0 ? this.buttons[this.focus] : null;
    let idx = cur ? vis.indexOf(cur) : -1;
    if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'Tab') {
      idx = (idx + 1) % vis.length;
      this.focus = this.buttons.indexOf(vis[idx]);
      return true;
    }
    if (k === 'ArrowUp' || k === 'ArrowLeft') {
      idx = (idx - 1 + vis.length) % vis.length;
      this.focus = this.buttons.indexOf(vis[idx]);
      return true;
    }
    if (k === 'Enter' || k === ' ') {
      if (idx < 0) {
        this.focus = this.buttons.indexOf(vis[0]);
        return true;
      }
      vis[idx].onPress?.();
      return true;
    }
    return false;
  }

  focusFirst(): void {
    const vis = this.visible().filter((b) => !b.disabled);
    this.focus = vis.length ? this.buttons.indexOf(vis[0]) : -1;
  }

  draw(r: Renderer, showFocus: boolean): void {
    for (const b of this.buttons) {
      if (b.hidden) continue;
      const focused = showFocus && this.buttons[this.focus] === b;
      drawButton(r, b, this.pressed === b.id, focused || this.hover === b.id);
    }
  }
}

export function drawButton(r: Renderer, b: Button, pressed: boolean, focused: boolean): void {
  const { x, y, w, h } = b.rect;
  const frame = b.disabled ? 0 : pressed ? 2 : focused ? 1 : 0;
  const dy = pressed ? 1 : 0;
  r.nineSlice('button', x, y + dy, w, h, frame);
  if (b.primary && !b.disabled) {
    // brass underline strip to mark the primary action
    r.rect(x + 3, y + h - 3 + dy, w - 6, 1, focused ? P.BRASS_LIT : P.BRASS);
  }
  const color = b.disabled ? P.PEWTER : focused ? P.CHALK : P.CHALK;
  const iconW = b.icon !== undefined ? 10 : 0;
  const tw = measureText(5, b.label) + iconW;
  const tx = x + Math.floor((w - tw) / 2);
  const lines = b.caption ? 2 : 1;
  const ty = y + dy + Math.floor((h - (lines === 2 ? 16 : 7)) / 2);
  if (b.icon !== undefined) r.sprite('icons', tx, ty - 1, b.icon);
  r.text(b.label, tx + iconW, ty, { color, shadow: b.disabled ? undefined : P.INK });
  if (b.caption) r.text(b.caption, x + Math.floor(w / 2), ty + 9, { color: b.captionColor ?? P.BRASS_LIT, align: 'center' });
  if (focused && !b.disabled) {
    // 1px chalk focus ring just outside the button
    r.rectOutline(x - 1, y - 1 + dy, w + 2, h + 2, P.CHALK);
  }
}

/** A label + value row used by settings and results. */
export function drawRow(r: Renderer, x: number, y: number, w: number, label: string, value: string, valueColor: number = P.BRASS_LIT): void {
  r.text(label, x, y, { color: P.MIST });
  r.text(value, x + w, y, { color: valueColor, align: 'right' });
}

/** Dotted separator line. */
export function drawRule(r: Renderer, x: number, y: number, w: number, color = P.STONE): void {
  for (let i = 0; i < w; i += 2) r.pixel(x + i, y, color);
}

/** A framed panel with a title. */
export function drawPanel(r: Renderer, rect: Rect, title?: string, focused = false): void {
  r.nineSlice('panel_frame', rect.x, rect.y, rect.w, rect.h, focused ? 1 : 0);
  if (title) {
    const tw = measureText(5, title) + 8;
    const tx = rect.x + Math.floor((rect.w - tw) / 2);
    r.rect(tx, rect.y - 1, tw, 9, P.DEEP);
    r.text(title, tx + 4, rect.y, { color: P.BRASS_LIT });
  }
}

/** Pips for visits: filled = used, hollow = remaining, ember = the last one. */
export function drawVisitPips(r: Renderer, x: number, y: number, used: number, limit: number): number {
  let cx = x;
  for (let i = 0; i < limit; i++) {
    const usedPip = i < used;
    const last = i === limit - 1;
    const color = usedPip ? P.PEWTER : last ? P.EMBER : P.CHALK;
    if (usedPip) {
      // spent: a dim stub
      r.rect(cx, y + 4, 3, 2, P.SHADE);
    } else {
      // remaining: a solid dart-shaped tick, the last one in ember
      r.rect(cx, y + 1, 3, 5, color);
      r.rect(cx + 1, y, 1, 1, color);
    }
    cx += 4;
  }
  return cx - x;
}
