/**
 * Runtime atlas (TDD §14.1 "sprites.ts"). All art is generated in memory
 * from the deterministic generators at boot — nothing is fetched. This is
 * what makes the single-file build and the offline requirement trivial.
 */
import { generateAll, type GeneratedAsset } from './gen/index';
import { GLYPHS_5X7 } from './glyphs5x7';
import { GLYPHS_9X12 } from './glyphs9x12';
import { PALETTE_RGB, TRANSPARENT, type Pixmap } from './palette';

export type FontId = 5 | 9;

export interface SpriteInfo {
  name: string;
  w: number;
  h: number;
  frames: number;
  frameW: number;
  frameH: number;
  nineSlice?: { l: number; t: number; r: number; b: number };
  canvas: HTMLCanvasElement;
  pixmap: Pixmap;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Convert a pixmap (palette indices) into a canvas. Optional index remap. */
export function pixmapToCanvas(p: Pixmap, remap?: (idx: number) => number): HTMLCanvasElement {
  const c = makeCanvas(p.w, p.h);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(p.w, p.h);
  const d = img.data;
  for (let i = 0; i < p.data.length; i++) {
    let v = p.data[i];
    if (remap) v = remap(v);
    if (v === TRANSPARENT || v > 15) {
      d[i * 4 + 3] = 0;
      continue;
    }
    const [r, g, b] = PALETTE_RGB[v];
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class Sprites {
  private map = new Map<string, SpriteInfo>();
  private tintCache = new Map<string, HTMLCanvasElement>();
  private glyphCache = new Map<string, HTMLCanvasElement>();
  assets: GeneratedAsset[] = [];

  load(): void {
    this.assets = generateAll();
    for (const a of this.assets) {
      const frames = a.frames ?? 1;
      const frameW = a.frameW ?? a.pixmap.w;
      const frameH = a.frameH ?? a.pixmap.h;
      this.map.set(a.name, {
        name: a.name,
        w: a.pixmap.w,
        h: a.pixmap.h,
        frames,
        frameW,
        frameH,
        nineSlice: a.nineSlice,
        canvas: pixmapToCanvas(a.pixmap),
        pixmap: a.pixmap,
      });
    }
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  get(name: string): SpriteInfo {
    const s = this.map.get(name);
    if (!s) throw new Error(`no sprite: ${name}`);
    return s;
  }

  /** A remapped copy of a sprite, cached by key. */
  tinted(name: string, key: string, remap: (idx: number) => number): HTMLCanvasElement {
    const k = `${name}|${key}`;
    let c = this.tintCache.get(k);
    if (!c) {
      const src = this.map.get(name);
      c = src ? pixmapToCanvas(src.pixmap, remap) : makeCanvas(8, 8);
      this.tintCache.set(k, c);
    }
    return c;
  }

  /** Rasterised glyph in a palette colour, cached. Missing glyphs render as a hollow box. */
  glyph(font: FontId, ch: string, color: number): HTMLCanvasElement {
    const k = `${font}|${color}|${ch}`;
    let c = this.glyphCache.get(k);
    if (c) return c;
    const table = font === 5 ? GLYPHS_5X7 : GLYPHS_9X12;
    const w = font === 5 ? 5 : 9;
    const h = font === 5 ? 7 : 12;
    let rows = table[ch];
    if (!rows) {
      // hollow box fallback
      rows = [];
      for (let y = 0; y < h; y++) rows.push(y === 0 || y === h - 1 ? (1 << w) - 1 : (1 << (w - 1)) | 1);
    }
    c = makeCanvas(w, h);
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(w, h);
    const [r, g, b] = PALETTE_RGB[color & 15];
    for (let y = 0; y < h; y++) {
      const row = rows[y] ?? 0;
      for (let x = 0; x < w; x++) {
        if ((row >> (w - 1 - x)) & 1) {
          const i = (y * w + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    this.glyphCache.set(k, c);
    return c;
  }
}

/** Glyph advance width in pixels (font width + 1px spacing). */
export function glyphAdvance(font: FontId): number {
  return font === 5 ? 6 : 10;
}

export function fontHeight(font: FontId): number {
  return font === 5 ? 7 : 12;
}

/** Width of a string in pixels at scale 1 (no trailing space). */
export function measureText(font: FontId, text: string): number {
  if (text.length === 0) return 0;
  return text.length * glyphAdvance(font) - 1;
}
