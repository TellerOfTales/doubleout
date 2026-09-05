/**
 * The 16-colour palette (TDD §11.3). Every generated pixel must be one of
 * these. Index constants are used throughout the art generators and UI.
 */
export const PALETTE_HEX = [
  '#0d0b12', // 00 ink        (outlines, text)
  '#1c1a2b', // 01 deep       (background)
  '#2e2a45', // 02 shade
  '#4a4363', // 03 stone      (interface chrome)
  '#6f6690', // 04 pewter
  '#a49bbf', // 05 mist
  '#e8e3f2', // 06 chalk      (text, highlights)
  '#7a2231', // 07 claret     (board red)
  '#b8394e', // 08 claret-lit
  '#14452f', // 09 baize      (board green)
  '#26805a', // 0a baize-lit
  '#c9a227', // 0b brass      (Pot, wire, trebles)
  '#f0d264', // 0c brass-lit
  '#2b5f8a', // 0d sky        (flights, chalk-card frames)
  '#4a9fd8', // 0e sky-lit
  '#e05a2b', // 0f ember      (bust, warnings, 180 flash)
] as const;

export const P = {
  INK: 0,
  DEEP: 1,
  SHADE: 2,
  STONE: 3,
  PEWTER: 4,
  MIST: 5,
  CHALK: 6,
  CLARET: 7,
  CLARET_LIT: 8,
  BAIZE: 9,
  BAIZE_LIT: 10,
  BRASS: 11,
  BRASS_LIT: 12,
  SKY: 13,
  SKY_LIT: 14,
  EMBER: 15,
} as const;

/** Transparent marker in pixmaps (not a palette entry). */
export const TRANSPARENT = 255;

export const PALETTE_RGB: [number, number, number][] = PALETTE_HEX.map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]);

/**
 * A pixmap is a rectangle of palette indices (0..15) or TRANSPARENT.
 * All generated art is produced in this form and converted to PNG (tools)
 * or to canvas ImageData (runtime) without any other colour ever appearing.
 */
export interface Pixmap {
  w: number;
  h: number;
  data: Uint8Array; // length w*h, row-major
}

export function createPixmap(w: number, h: number, fill: number = TRANSPARENT): Pixmap {
  const data = new Uint8Array(w * h);
  data.fill(fill);
  return { w, h, data };
}

export function px(p: Pixmap, x: number, y: number, c: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.data[y * p.w + x] = c;
}

export function getPx(p: Pixmap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return TRANSPARENT;
  return p.data[y * p.w + x];
}

/** Throws if any pixel is outside the palette (and not transparent). */
export function assertPalette(p: Pixmap, name: string): void {
  for (let i = 0; i < p.data.length; i++) {
    const v = p.data[i];
    if (v !== TRANSPARENT && v > 15) {
      throw new Error(`palette violation in ${name} at index ${i}: ${v}`);
    }
  }
}

/** Ordered 4×4 Bayer matrix, values 0..15, for dithered gradients. */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
