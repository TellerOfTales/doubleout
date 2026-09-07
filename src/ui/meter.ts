/**
 * THE METER on screen: the column beside the board where a dart is timed.
 *
 * The scale is data from src/core/meter.ts — the band you called in the
 * middle, the ways a dart goes wrong stacked out from it, worst at the ends.
 * This file only draws it, and the drawing is the honest one: every band is
 * exactly as tall as its own chance, so what the player sees IS the odds. The
 * treble's green stripe really is a fifth of the column, and the single's
 * really is all of it.
 *
 * Up the column is a dart thrown long, down is a dart thrown short, which is
 * why the marker runs vertically. The arrows at top and bottom say so.
 */
import { P } from '../art/palette';
import { SWEET, type MeterBand } from '../core/meter';
import { targetNotation } from '../core/board';
import type { Renderer } from './draw';
import type { Rect } from './layout';

/** Colour for a band, by what it does to the dart. */
function bandColour(b: MeterBand): number {
  if (b.how === 'hit') return P.BAIZE_LIT;
  if (b.target.region === 'W') return P.EMBER;
  if (b.kind === 'lucky') return P.BAIZE;
  return b.how === 'long' ? P.CLARET : P.PEWTER;
}

/**
 * Draw the column.
 *
 * `marker` is where the marker is now (0 bottom, 1 top). `held` is the stop of
 * the dart just thrown, drawn as a bright line so the player can see what they
 * actually did — a timing meter that does not show you your own tap teaches
 * nothing.
 */
export function drawMeter(
  r: Renderer,
  rect: Rect,
  scale: MeterBand[],
  marker: number,
  opts: { live?: boolean; held?: number | null; sweet?: boolean; flash?: number } = {},
): void {
  const { x, y, w, h } = rect;
  const live = opts.live !== false;
  // The gutter: ink under the scale so a band is a band and not a hole in the
  // pub wall behind it. The column keeps to its own rect — there is no room
  // beside a board on a 320x180 screen for anything to hang over.
  r.rect(x, y, w, h, P.INK);

  const top = (f: number) => y + h - 1 - Math.round(f * (h - 1));
  for (const b of scale) {
    const y0 = top(b.to);
    const y1 = top(b.from);
    const bh = Math.max(1, y1 - y0 + 1);
    const c = bandColour(b);
    r.rect(x + 1, y0, w - 2, bh, live ? c : P.SHADE);
    if (b.how === 'hit') {
      // The band you called, edged so its top and bottom are unmistakable
      // even when it is only three pixels tall.
      r.rect(x + 1, y0, w - 2, 1, P.CHALK);
      r.rect(x + 1, y0 + bh - 1, w - 2, 1, P.CHALK);
      // Dead on: the middle of the middle.
      const mid = top(0.5);
      const sw = Math.max(1, Math.round((SWEET * (h - 1)) / 2));
      r.rect(x + 1, mid - sw, w - 2, sw * 2 + 1, live ? P.BRASS_LIT : P.PEWTER);
    }
  }
  r.rectOutline(x, y, w, h, live ? P.STONE : P.SHADE);
  // Up is long, down is short. Two chevrons inside the frame, because the one
  // thing a vertical meter has to say without words is which way is which.
  const mid = x + Math.floor(w / 2);
  const up = live ? P.CLARET_LIT : P.SHADE;
  const down = live ? P.MIST : P.SHADE;
  r.pixel(mid, y + 1, up);
  r.pixel(mid - 1, y + 2, up);
  r.pixel(mid + 1, y + 2, up);
  r.pixel(mid, y + h - 2, down);
  r.pixel(mid - 1, y + h - 3, down);
  r.pixel(mid + 1, y + h - 3, down);

  // The dart just thrown, left on the scale until the next one is called.
  if (opts.held !== undefined && opts.held !== null) {
    const hy = top(opts.held);
    r.rect(x - 1, hy, w + 2, 1, opts.sweet ? P.BRASS_LIT : P.CHALK);
    r.pixel(x - 2, hy, P.INK);
  }

  if (!live) return;
  // The marker. A wedge either side of the column so it reads against every
  // band colour, and a full-width line through it.
  const my = top(marker);
  r.rect(x, my, w, 1, P.CHALK);
  r.pixel(x - 1, my - 1, P.INK);
  r.pixel(x - 1, my, P.CHALK);
  r.pixel(x - 1, my + 1, P.INK);
  r.pixel(x + w, my - 1, P.INK);
  r.pixel(x + w, my, P.CHALK);
  r.pixel(x + w, my + 1, P.INK);
  if (opts.flash) r.dither(x + 1, y, w - 2, h, P.CHALK, Math.round(opts.flash * 6));
}

/** "T20 IN THE GREEN" — what the meter is asking for, in one line. */
export function meterLabel(scale: MeterBand[]): string {
  const band = scale.find((b) => b.how === 'hit');
  if (!band) return '';
  return `${targetNotation(band.target)} ${Math.round((band.to - band.from) * 100)}%`;
}
