/**
 * Interface chrome: panel frame, button, the 8×8 icon set, the scoreboard
 * slate, the decorative pint and the title logo.
 */
import { P, createPixmap, px, type Pixmap } from '../palette.ts';
import { blit, drawGlyph, drawText, fillRect, flipH, flipV, fontDims, fromAscii, glyphRows, hLine, hash2, rectOutline, roundedRect, sheet, vLine } from './draw.ts';
import { dartFrame0 } from './darts.ts';
import { rotateDeg } from './draw.ts';

/** 24×24 × 2: deep fill, stone border inside an ink outline; frame 1 mist border (focused). */
export function genPanelFrame(): Pixmap {
  return sheet(24, 24, 2, (f, i) => {
    roundedRect(f, 0, 0, 24, 24, P.DEEP, P.INK);
    const border = i === 1 ? P.MIST : P.STONE;
    hLine(f, 2, 21, 1, border);
    hLine(f, 2, 21, 22, border);
    vLine(f, 1, 2, 21, border);
    vLine(f, 22, 2, 21, border);
    px(f, 2, 2, border);
    px(f, 21, 2, border);
    px(f, 2, 21, border);
    px(f, 21, 21, border);
  });
}

/** 24×16 × 3: idle, hover/focused, pressed. */
export function genButton(): Pixmap {
  return sheet(24, 16, 3, (f, i) => {
    const face = [P.STONE, P.PEWTER, P.SHADE][i];
    roundedRect(f, 0, 0, 24, 16, face, P.INK);
    if (i === 0) {
      hLine(f, 2, 21, 1, P.PEWTER);
      hLine(f, 2, 21, 14, P.SHADE);
      vLine(f, 22, 2, 13, P.SHADE);
    } else if (i === 1) {
      hLine(f, 2, 21, 1, P.MIST);
      vLine(f, 1, 2, 13, P.MIST);
      hLine(f, 2, 21, 14, P.STONE);
      vLine(f, 22, 2, 13, P.STONE);
    } else {
      // pressed: inset shadow along the top/left
      hLine(f, 2, 21, 1, P.DEEP);
      vLine(f, 1, 2, 13, P.DEEP);
    }
  });
}

/** 96×64: slate with a stone frame, ink outline and sparse chalk dust. */
export function genScoreboard(): Pixmap {
  const p = createPixmap(96, 64, P.SHADE);
  rectOutline(p, 1, 1, 94, 62, P.STONE);
  rectOutline(p, 2, 2, 92, 60, P.STONE);
  rectOutline(p, 0, 0, 96, 64, P.INK);
  for (let y = 4; y < 60; y++) {
    for (let x = 4; x < 92; x++) {
      const h = hash2(x, y, 0x5c0e);
      if (h < 0.025) px(p, x, y, P.STONE);
      else if (h < 0.032) px(p, x, y, P.PEWTER);
    }
  }
  return p;
}

/** 12×16 × 5: a pint glass, frames 1–4 filling with brass under a chalk head. */
export function genPint(): Pixmap {
  return sheet(12, 16, 5, (f, i) => {
    const wall = (y: number) => (y >= 8 ? 1 : 0);
    // fill first, then the glass over it
    const fillRows = [0, 3, 6, 9, 12][i];
    const foamRows = i === 0 ? 0 : i <= 2 ? 1 : 2;
    for (let y = 15 - fillRows; y < 15; y++) {
      const l = 1 + wall(y) + 1;
      const r = 10 - wall(y) - 1;
      for (let x = l; x <= r; x++) px(f, x, y, P.BRASS);
    }
    for (let k = 0; k < foamRows; k++) {
      const y = 15 - fillRows - 1 - k;
      if (y < 1) break;
      const l = 1 + wall(y) + 1;
      const r = 10 - wall(y) - 1;
      for (let x = l; x <= r; x++) px(f, x, y, P.CHALK);
    }
    for (let y = 0; y < 16; y++) {
      px(f, 1 + wall(y), y, P.MIST);
      px(f, 10 - wall(y), y, P.MIST);
    }
    hLine(f, 1, 10, 0, P.MIST);
    hLine(f, 2, 9, 15, P.MIST);
    // glass highlight down the inside of the left wall
    for (let y = 2; y < 13; y++) if (y % 4 !== 3) px(f, 2 + wall(y), y, P.CHALK);
  });
}

// ---- icons ----------------------------------------------------------------

const ICON_NAMES = [
  'visit', 'bust', 'double', 'treble', 'bull', 'pot', 'refresh', 'remove', 'duplicate', 'sharpen', 'lock', 'unlock',
  'sound_on', 'sound_off', 'gear', 'play', 'arrow_left', 'arrow_right', 'arrow_up', 'arrow_down', 'tick', 'cross', 'star',
  'pip_full', 'pip_empty', 'dart', 'card', 'chalk', 'hand', 'heart', 'question', 'exit',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export function iconIndex(name: IconName): number {
  return ICON_NAMES.indexOf(name);
}

const ICON_ART: Partial<Record<IconName, string[]>> = {
  visit: ['.s.s.s..', '.s.s.s..', '.m.m.m..', '.m.m.m..', '.m.m.m..', '.m.m.m..', '.w.w.w..', '........'],
  bust: ['e......e', '.e....e.', '..e..e..', '...ee...', '...ee...', '..e..e..', '.e....e.', 'e......e'],
  bull: ['..wwww..', '.w....w.', 'w..rr..w', 'w.rrrr.w', 'w.rrrr.w', 'w..rr..w', '.w....w.', '..wwww..'],
  pot: ['..bbbb..', '.bBBBBb.', 'bBBbbBBb', 'bBBbbBBb', 'bBBbbBBb', 'bBBbbBBb', '.bBBBBb.', '..bbbb..'],
  refresh: ['..www.w.', '.w...ww.', 'w....www', 'w.......', 'w.......', 'w......w', '.w....w.', '..wwww..'],
  remove: ['...ww...', '.wwwwww.', '..wwww..', '..w..w..', '..w..w..', '..w..w..', '..w..w..', '..wwww..'],
  duplicate: ['.www....', '.w.w....', '.w.wwww.', '.w.w..w.', '.www..w.', '...w..w.', '...w..w.', '...wwww.'],
  sharpen: ['.......B', '.....wB.', '....ww..', '...mww..', '..mmm...', '.mmm....', 'mmm.....', '........'],
  lock: ['..mmmm..', '.m....m.', '.m....m.', 'wwwwwwww', 'wwwwwwww', 'wwwiiwww', 'wwwwiwww', 'wwwwwwww'],
  unlock: ['....mmmm', '...m...m', '...m....', 'wwwwww..', 'wwwwww..', 'wwiiww..', 'wwwiww..', 'wwwwww..'],
  sound_on: ['...w....', '..ww.m..', '.www..m.', 'wwww.m.m', 'wwww.m.m', '.www..m.', '..ww.m..', '...w....'],
  sound_off: ['...w....', '..ww....', '.www.e.e', 'wwww..e.', 'wwww..e.', '.www.e.e', '..ww....', '...w....'],
  gear: ['...ww...', '.w.ww.w.', '.wwwwww.', 'www..www', 'www..www', '.wwwwww.', '.w.ww.w.', '...ww...'],
  play: ['..g.....', '..gg....', '..ggg...', '..gggg..', '..gggg..', '..ggg...', '..gg....', '..g.....'],
  arrow_left: ['...w....', '..ww....', '.wwwwww.', 'wwwwwww.', '.wwwwww.', '..ww....', '...w....', '........'],
  arrow_up: ['...w....', '..www...', '.wwwww..', 'wwwwwww.', '..www...', '..www...', '..www...', '........'],
  tick: ['.......g', '......gg', '.....gg.', 'g...gg..', 'gg.gg...', '.ggg....', '..g.....', '........'],
  cross: ['w.....w.', '.w...w..', '..w.w...', '...w....', '..w.w...', '.w...w..', 'w.....w.', '........'],
  star: ['...B....', '...B....', 'BBBBBBB.', '.BBBBB..', '..BBB...', '.BB.BB..', '.B...B..', '........'],
  pip_full: ['........', '..wwww..', '.wwwwww.', '.wwwwww.', '.wwwwww.', '.wwwwww.', '..wwww..', '........'],
  pip_empty: ['........', '..mmmm..', '.m....m.', '.m....m.', '.m....m.', '.m....m.', '..mmmm..', '........'],
  dart: ['.......w', '......p.', '.....p..', '....p...', '...p....', '.ss.....', 'sss.....', 'ss......'],
  card: ['.wwwww..', '.w...w..', '.w.s.w..', '.w.s.w..', '.w...w..', '.w...w..', '.wwwww..', '........'],
  chalk: ['......ww', '.....wwm', '....wwm.', '...wwm..', '..wwm...', '.wwm....', 'wwm.....', '........'],
  hand: ['...w....', '..w.w...', '..w.w...', '..w.www.', '.ww.w..w', 'w..w...w', 'w......w', '.wwwwww.'],
  heart: ['.rr..rr.', 'rrrrrrrr', 'rrrrrrrr', 'rrrrrrrr', '.rrrrrr.', '..rrrr..', '...rr...', '........'],
  exit: ['wwww....', 'w..w..w.', 'w..w..ww', 'w.ww.www', 'w..w..ww', 'w..w..w.', 'w..w....', 'wwww....'],
};

export function icon(name: IconName): Pixmap {
  const art = ICON_ART[name];
  if (art) return fromAscii(art);
  const p = createPixmap(8, 8);
  switch (name) {
    case 'double':
      drawGlyph(p, 5, 'D', 1, 0, P.CHALK);
      break;
    case 'treble':
      drawGlyph(p, 5, 'T', 1, 0, P.CHALK);
      break;
    case 'question':
      drawGlyph(p, 5, '?', 1, 0, P.CHALK);
      break;
    case 'arrow_right':
      return flipH(icon('arrow_left'));
    case 'arrow_down':
      return flipV(icon('arrow_up'));
    default:
      rectOutline(p, 0, 0, 8, 8, P.MIST);
  }
  return p;
}

/** 8×8 × 32 in ICON_NAMES order. */
export function genIcons(): Pixmap {
  return sheet(8, 8, ICON_NAMES.length, (f, i) => blit(f, icon(ICON_NAMES[i]), 0, 0));
}

export { ICON_NAMES };

// ---- logo -----------------------------------------------------------------

/**
 * 160×40: "DOUBLE OUT" from the 9×12 glyphs at 2× (18×24 letters), chalk with
 * an ink drop shadow at (+2,+2) and a brass-lit bevel along the top edge of
 * every stroke, and a dart stuck diagonally through the last O.
 *
 * Ten 18px letters with 2px gaps are 198px wide, so the word is set with a
 * tighter advance when it would not fit: letters may overlap by one source
 * pixel (2px) and the word gap is 8px. See docs/decisions/art.md.
 */
export function genLogo(): Pixmap {
  const W = 160;
  const H = 40;
  const p = createPixmap(W, H);
  const text = 'DOUBLE OUT';
  const scale = 2;
  const { w: gw, h: gh } = fontDims(9);
  const letterW = gw * scale; // 18
  const letterH = gh * scale; // 24
  const letters = [...text].filter((c) => c !== ' ').length;
  const wordGap = 8;
  let gap = 2;
  const widthFor = (g: number) => letters * letterW + (letters - 2) * g + wordGap;
  while (widthFor(gap) + 2 > W - 4 && gap > -4) gap--;
  const total = widthFor(gap) + 2;
  const x0 = Math.floor((W - total) / 2);
  const y0 = Math.floor((H - letterH - 2) / 2);

  // Rasterise each letter into its own pixmap so the bevel can find "top edges".
  const positions: { ch: string; x: number }[] = [];
  let cx = x0;
  for (const ch of text) {
    if (ch === ' ') {
      cx += wordGap - gap;
      continue;
    }
    positions.push({ ch, x: cx });
    cx += letterW + gap;
  }
  const mask = createPixmap(W, H);
  for (const { ch, x } of positions) {
    const rows = glyphRows(9, ch);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if ((rows[gy] >> (gw - 1 - gx)) & 1) fillRect(mask, x + gx * scale, y0 + gy * scale, scale, scale, P.CHALK);
      }
    }
  }
  // shadow, then face, then bevel
  blit(p, mask, 2, 2, { remap: () => P.INK });
  blit(p, mask, 0, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask.data[y * W + x] !== P.CHALK) continue;
      const above = y === 0 ? 255 : mask.data[(y - 1) * W + x];
      if (above !== P.CHALK) px(p, x, y, P.BRASS_LIT);
    }
  }
  // a dart through the last O (frame 0 rotated 135°: tip down-right), drawn at 2×
  const lastO = positions.filter((q) => q.ch === 'O').pop();
  if (lastO) {
    const dart = rotateDeg(dartFrame0(), 135);
    const dx = lastO.x + Math.floor(letterW / 2) - 9;
    const dy = y0 + Math.floor(letterH / 2) - 9;
    blit(p, dart, dx + 2, dy + 2, { scale: 2, remap: () => P.INK });
    blit(p, dart, dx, dy, { scale: 2 });
  }
  return p;
}

/** Title text width helper for the UI (unused by generators, handy for tests). */
export function logoTextWidth(): number {
  return drawText(createPixmap(1, 1), 9, 'DOUBLE OUT', 0, 0, P.CHALK, { scale: 2 });
}
