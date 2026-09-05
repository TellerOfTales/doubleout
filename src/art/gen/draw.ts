/**
 * Pixmap drawing helpers shared by every art generator. Pure functions over
 * palette-index buffers; no canvas, no randomness (noise comes from `hash2`).
 *
 * Relative imports inside src/art/gen carry `.ts` extensions so that
 * `node --experimental-strip-types tools/genart.ts` can resolve the chain
 * without a bundler (tsconfig sets allowImportingTsExtensions).
 */
import { BAYER4, P, TRANSPARENT, createPixmap, getPx, px, type Pixmap } from '../palette.ts';
import { GLYPHS_5X7 } from '../glyphs5x7.ts';
import { GLYPHS_9X12 } from '../glyphs9x12.ts';

export const T = TRANSPARENT;

export type FontSize = 5 | 9;

export function fillRect(p: Pixmap, x: number, y: number, w: number, h: number, c: number): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(p.w, x + w);
  const y1 = Math.min(p.h, y + h);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) p.data[yy * p.w + xx] = c;
}

export function hLine(p: Pixmap, x0: number, x1: number, y: number, c: number): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) px(p, x, y, c);
}

export function vLine(p: Pixmap, x: number, y0: number, y1: number, c: number): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) px(p, x, y, c);
}

export function rectOutline(p: Pixmap, x: number, y: number, w: number, h: number, c: number): void {
  hLine(p, x, x + w - 1, y, c);
  hLine(p, x, x + w - 1, y + h - 1, c);
  vLine(p, x, y, y + h - 1, c);
  vLine(p, x + w - 1, y, y + h - 1, c);
}

/**
 * Rounded rectangle with 2px corners (same shape as Renderer.panel): the
 * three corner pixels are left untouched, the outline steps in one pixel at
 * each corner. `fill` may be TRANSPARENT to skip the interior.
 */
export function roundedRect(p: Pixmap, x: number, y: number, w: number, h: number, fill: number, outline: number): void {
  if (fill !== T) {
    fillRect(p, x + 1, y, w - 2, h, fill);
    fillRect(p, x, y + 1, w, h - 2, fill);
  }
  hLine(p, x + 2, x + w - 3, y, outline);
  hLine(p, x + 2, x + w - 3, y + h - 1, outline);
  vLine(p, x, y + 2, y + h - 3, outline);
  vLine(p, x + w - 1, y + 2, y + h - 3, outline);
  px(p, x + 1, y + 1, outline);
  px(p, x + w - 2, y + 1, outline);
  px(p, x + 1, y + h - 2, outline);
  px(p, x + w - 2, y + h - 2, outline);
}

/** Bresenham line. */
export function line(p: Pixmap, x0: number, y0: number, x1: number, y1: number, c: number): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 8192; i++) {
    px(p, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * Ring of pixels whose centre distance from (cx, cy) satisfies rIn <= d < rOut.
 * cx/cy are in pixel-centre space: pixel (x, y) is at (x + 0.5, y + 0.5).
 * A disc is ring(…, 0, r, …).
 */
export function ring(p: Pixmap, cx: number, cy: number, rIn: number, rOut: number, c: number): void {
  const x0 = Math.max(0, Math.floor(cx - rOut - 1));
  const x1 = Math.min(p.w - 1, Math.ceil(cx + rOut + 1));
  const y0 = Math.max(0, Math.floor(cy - rOut - 1));
  const y1 = Math.min(p.h - 1, Math.ceil(cy + rOut + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= rIn && d < rOut) p.data[y * p.w + x] = c;
    }
  }
}

export function disc(p: Pixmap, cx: number, cy: number, r: number, c: number): void {
  ring(p, cx, cy, 0, r, c);
}

export interface BlitOpts {
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
  /** Integer nearest-neighbour scale. */
  scale?: number;
  remap?: (idx: number) => number;
  /** Copy transparent pixels too (default: skip them). */
  opaque?: boolean;
}

/** Copy src (or a sub-rectangle of it) onto dst at (dx, dy). */
export function blit(dst: Pixmap, src: Pixmap, dx: number, dy: number, opts: BlitOpts = {}): void {
  const sx = opts.sx ?? 0;
  const sy = opts.sy ?? 0;
  const sw = opts.sw ?? src.w - sx;
  const sh = opts.sh ?? src.h - sy;
  const s = opts.scale ?? 1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let v = getPx(src, sx + x, sy + y);
      if (opts.remap) v = opts.remap(v);
      if (v === T && !opts.opaque) continue;
      if (s === 1) px(dst, dx + x, dy + y, v);
      else fillRect(dst, dx + x * s, dy + y * s, s, s, v);
    }
  }
}

/** Extract frame i of a horizontal sheet. */
export function frameOf(sheet: Pixmap, frameW: number, i: number): Pixmap {
  const out = createPixmap(frameW, sheet.h);
  blit(out, sheet, 0, 0, { sx: i * frameW, sw: frameW, opaque: true });
  return out;
}

/** Build a horizontal sprite sheet: frame i drawn into its own pixmap then placed at x = i*frameW. */
export function sheet(frameW: number, frameH: number, n: number, draw: (f: Pixmap, i: number) => void): Pixmap {
  const out = createPixmap(frameW * n, frameH);
  for (let i = 0; i < n; i++) {
    const f = createPixmap(frameW, frameH);
    draw(f, i);
    blit(out, f, i * frameW, 0, { opaque: true });
  }
  return out;
}

export function rotateCW(src: Pixmap): Pixmap {
  const out = createPixmap(src.h, src.w);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) px(out, src.h - 1 - y, x, getPx(src, x, y));
  return out;
}

export function flipH(src: Pixmap): Pixmap {
  const out = createPixmap(src.w, src.h);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) px(out, src.w - 1 - x, y, getPx(src, x, y));
  return out;
}

export function flipV(src: Pixmap): Pixmap {
  const out = createPixmap(src.w, src.h);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) px(out, x, src.h - 1 - y, getPx(src, x, y));
  return out;
}

/**
 * Rotate a square pixmap clockwise by `deg` about its centre by forward
 * mapping every opaque pixel (nearest-neighbour). Exact for multiples of 90°;
 * at 45° a 1px vertical line becomes a clean 1px diagonal.
 */
export function rotateDeg(src: Pixmap, deg: number): Pixmap {
  const out = createPixmap(src.w, src.h);
  const rad = (deg * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  const cx = (src.w - 1) / 2;
  const cy = (src.h - 1) / 2;
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const v = getPx(src, x, y);
      if (v === T) continue;
      const ox = x - cx;
      const oy = y - cy;
      const rx = ox * cs - oy * sn;
      const ry = ox * sn + oy * cs;
      px(out, Math.round(cx + rx + 1e-6), Math.round(cy + ry + 1e-6), v);
    }
  }
  return out;
}

/** Legend shared by the ASCII pictograms. '.' is transparent. */
export const LEGEND: Record<string, number> = {
  '.': T,
  i: P.INK,
  d: P.DEEP,
  k: P.SHADE,
  S: P.STONE,
  p: P.PEWTER,
  m: P.MIST,
  w: P.CHALK,
  c: P.CLARET,
  r: P.CLARET_LIT,
  z: P.BAIZE,
  g: P.BAIZE_LIT,
  b: P.BRASS,
  B: P.BRASS_LIT,
  y: P.SKY,
  s: P.SKY_LIT,
  e: P.EMBER,
};

/** Build a pixmap from rows of legend characters. Unknown chars map via `extra`. */
export function fromAscii(rows: string[], extra: Record<string, number> = {}): Pixmap {
  const w = Math.max(...rows.map((r) => r.length));
  const out = createPixmap(w, rows.length);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      const v = extra[ch] ?? LEGEND[ch];
      if (v === undefined) throw new Error(`fromAscii: unknown legend char '${ch}'`);
      px(out, x, y, v);
    }
  }
  return out;
}

/** Paint `c` on every transparent pixel that touches an opaque one (4- or 8-neighbour). */
export function outline(p: Pixmap, c: number, eight = true): void {
  const src = new Uint8Array(p.data);
  const w = p.w;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x] !== T) continue;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!eight && dx !== 0 && dy !== 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= p.h) continue;
          if (src[ny * w + nx] !== T) {
            hit = true;
            break;
          }
        }
      }
      if (hit) p.data[y * w + x] = c;
    }
  }
}

/** Deterministic 2D hash → [0, 1). Integer coordinates; `seed` separates textures. */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function bayer(x: number, y: number): number {
  return BAYER4[y & 3][x & 3];
}

/** Ordered-dither decision: true when a value v in [0,1] should light pixel (x, y). */
export function ditherOn(x: number, y: number, v: number): boolean {
  return v > 0 && v * 16 > bayer(x, y);
}

/** Quantise v in [0, n] to an integer 0..n with Bayer dithering of the fraction. */
export function ditherQuantise(x: number, y: number, v: number, n: number): number {
  const c = Math.max(0, Math.min(n, v));
  const base = Math.floor(c);
  const frac = c - base;
  if (base >= n) return n;
  return frac * 16 > bayer(x, y) ? base + 1 : base;
}

// ---- text --------------------------------------------------------------

export function fontDims(font: FontSize): { w: number; h: number; adv: number } {
  return font === 5 ? { w: 5, h: 7, adv: 6 } : { w: 9, h: 12, adv: 10 };
}

/** Row bitmasks for a glyph; a hollow box when the glyph is missing. */
export function glyphRows(font: FontSize, ch: string): number[] {
  const table = font === 5 ? GLYPHS_5X7 : GLYPHS_9X12;
  const { w, h } = fontDims(font);
  const rows = table[ch];
  if (rows && rows.length === h) return rows;
  const box: number[] = [];
  for (let y = 0; y < h; y++) box.push(y === 0 || y === h - 1 ? (1 << w) - 1 : (1 << (w - 1)) | 1);
  return box;
}

export function drawGlyph(p: Pixmap, font: FontSize, ch: string, x: number, y: number, c: number, scale = 1): void {
  const { w, h } = fontDims(font);
  const rows = glyphRows(font, ch);
  for (let gy = 0; gy < h; gy++) {
    const row = rows[gy] ?? 0;
    for (let gx = 0; gx < w; gx++) {
      if ((row >> (w - 1 - gx)) & 1) {
        if (scale === 1) px(p, x + gx, y + gy, c);
        else fillRect(p, x + gx * scale, y + gy * scale, scale, scale, c);
      }
    }
  }
}

export function textWidth(font: FontSize, text: string, scale = 1): number {
  const n = [...text].length;
  if (n === 0) return 0;
  return (n * fontDims(font).adv - 1) * scale;
}

export interface TextOpts {
  scale?: number;
  /** 4-neighbour outline colour. */
  outline?: number;
  /** Drop shadow at (+1,+1)×scale. */
  shadow?: number;
}

/** Draw a string; returns its width. Spaces advance without painting. */
export function drawText(p: Pixmap, font: FontSize, text: string, x: number, y: number, c: number, opts: TextOpts = {}): number {
  const s = opts.scale ?? 1;
  const adv = fontDims(font).adv * s;
  const run = (col: number, dx: number, dy: number) => {
    let cx = x + dx;
    for (const ch of text) {
      if (ch !== ' ') drawGlyph(p, font, ch, cx, y + dy, col, s);
      cx += adv;
    }
  };
  if (opts.outline !== undefined) {
    run(opts.outline, s, 0);
    run(opts.outline, -s, 0);
    run(opts.outline, 0, s);
    run(opts.outline, 0, -s);
  }
  if (opts.shadow !== undefined) run(opts.shadow, s, s);
  run(c, 0, 0);
  return textWidth(font, text, s);
}

/** Count opaque pixels in a frame of a sheet (used by tests and the preview). */
export function opaqueCount(p: Pixmap, sx = 0, sw = p.w): number {
  let n = 0;
  for (let y = 0; y < p.h; y++) for (let x = sx; x < sx + sw; x++) if (p.data[y * p.w + x] !== T) n++;
  return n;
}
