/**
 * Glyph sheets for the TDD manifest (§11.4/§11.5). The runtime rasterises
 * glyphs straight from the bit arrays; these sheets exist so the fonts are
 * inspectable as images. Glyphs run left-to-right, top-to-bottom in key
 * order, one per cell, chalk on transparent.
 */
import { P, createPixmap, type Pixmap } from '../palette.ts';
import { GLYPHS_5X7 } from '../glyphs5x7.ts';
import { GLYPHS_9X12 } from '../glyphs9x12.ts';
import { drawGlyph } from './draw.ts';

export const FONT_5X7_SHEET = { w: 512, h: 56, cell: 8 };
export const FONT_9X12_SHEET = { w: 768, h: 96, cell: 12 };

function fontSheet(font: 5 | 9, table: Record<string, number[]>, w: number, h: number, cell: number): Pixmap {
  const p = createPixmap(w, h);
  const perRow = Math.floor(w / cell);
  const keys = Object.keys(table);
  for (let i = 0; i < keys.length; i++) {
    const cx = (i % perRow) * cell;
    const cy = Math.floor(i / perRow) * cell;
    if (cy + cell > h) break;
    drawGlyph(p, font, keys[i], cx, cy, P.CHALK);
  }
  return p;
}

export function genFont5x7(): Pixmap {
  return fontSheet(5, GLYPHS_5X7, FONT_5X7_SHEET.w, FONT_5X7_SHEET.h, FONT_5X7_SHEET.cell);
}

export function genFont9x12(): Pixmap {
  return fontSheet(9, GLYPHS_9X12, FONT_9X12_SHEET.w, FONT_9X12_SHEET.h, FONT_9X12_SHEET.cell);
}
