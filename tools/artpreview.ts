/**
 * Contact sheet: every generated asset at 3× nearest-neighbour on a deep
 * background with its name in the 5×7 font, written to
 * assets/generated/_contact_sheet.png so a human (or an agent) can eyeball
 * the whole set at once.
 *
 *   node --experimental-strip-types tools/artpreview.ts [scale] [filter]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { P, createPixmap, type Pixmap } from '../src/art/palette.ts';
import { blit, drawText, fillRect, rectOutline, textWidth } from '../src/art/gen/draw.ts';
import { generateAll } from '../src/art/gen/index.ts';
import { OUT_DIR, pixmapToPng } from './genart.ts';

const SCALE = Math.max(1, parseInt(process.argv[2] ?? '3', 10) || 3);
const FILTER = process.argv[3];
const PAD = 8;
const MAX_W = 1600;

const assets = generateAll().filter((a) => !FILTER || a.name.includes(FILTER));

// flow layout: rows of assets, wrapping at MAX_W
interface Cell {
  a: (typeof assets)[number];
  x: number;
  y: number;
  w: number;
  h: number;
}
const cells: Cell[] = [];
let x = PAD;
let y = PAD;
let rowH = 0;
let sheetW = 0;
for (const a of assets) {
  const w = Math.max(a.pixmap.w * SCALE, textWidth(5, a.name));
  const h = a.pixmap.h * SCALE + 10;
  if (x + w + PAD > MAX_W && x > PAD) {
    x = PAD;
    y += rowH + PAD;
    rowH = 0;
  }
  cells.push({ a, x, y, w, h });
  x += w + PAD;
  rowH = Math.max(rowH, h);
  sheetW = Math.max(sheetW, x);
}
const sheetH = y + rowH + PAD;
const sheet = createPixmap(sheetW, sheetH, P.DEEP);
for (const c of cells) {
  const pm: Pixmap = c.a.pixmap;
  // checker backing so transparent regions (and dark sprites) stay visible; frame boundaries as thin ticks
  for (let yy = -1; yy < pm.h * SCALE + 1; yy++) {
    for (let xx = -1; xx < pm.w * SCALE + 1; xx++) {
      const dark = ((xx >> 3) + (yy >> 3)) % 2 === 0;
      fillRect(sheet, c.x + xx, c.y + yy, 1, 1, dark ? P.DEEP : P.STONE);
    }
  }
  rectOutline(sheet, c.x - 1, c.y - 1, pm.w * SCALE + 2, pm.h * SCALE + 2, P.INK);
  blit(sheet, pm, c.x, c.y, { scale: SCALE });
  const frames = c.a.frames ?? 1;
  const fw = c.a.frameW ?? pm.w;
  for (let f = 1; f < frames; f++) {
    const fx = c.x + f * fw * SCALE;
    for (let yy = 0; yy < pm.h * SCALE; yy += 2) {
      const v = sheet.data[(c.y + yy) * sheetW + fx];
      if (v === P.DEEP || v === P.STONE) sheet.data[(c.y + yy) * sheetW + fx] = P.MIST;
    }
  }
  drawText(sheet, 5, c.a.name, c.x, c.y + pm.h * SCALE + 3, P.MIST);
}
mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, FILTER ? `_contact_${FILTER}.png` : '_contact_sheet.png');
writeFileSync(file, pixmapToPng(sheet));
console.log(`${cells.length} assets → ${path.relative(process.cwd(), file)} (${sheetW}×${sheetH})`);
