/**
 * Cards and chalk: the 9-slice card frames, the card back, the chalk chip
 * frame and the 24 chalk pictograms.
 */
import { P, createPixmap, px, type Pixmap } from '../palette.ts';
import { CHALK_DEFS } from '../../content/chalkdefs.ts';
import { blit, drawGlyph, fillRect, fromAscii, hLine, line, outline, roundedRect, sheet, vLine } from './draw.ts';

export const CARD_W = 40;
export const CARD_H = 56;

/** 40×56 × 3: neutral, selected, disabled. 2px rounded corners, ink outline, bevel. */
export function genCardFrame(): Pixmap {
  const tints = [
    { fill: P.STONE, hi: P.PEWTER, lo: P.SHADE },
    { fill: P.SKY, hi: P.SKY_LIT, lo: P.DEEP },
    { fill: P.SHADE, hi: P.STONE, lo: P.DEEP },
  ];
  return sheet(CARD_W, CARD_H, 3, (f, i) => {
    const t = tints[i];
    roundedRect(f, 0, 0, CARD_W, CARD_H, t.fill, P.INK);
    // inner highlight: top + left; shadow: bottom + right
    hLine(f, 2, CARD_W - 3, 1, t.hi);
    vLine(f, 1, 2, CARD_H - 3, t.hi);
    hLine(f, 2, CARD_W - 3, CARD_H - 2, t.lo);
    vLine(f, CARD_W - 2, 2, CARD_H - 3, t.lo);
    px(f, 2, 2, t.hi);
    px(f, CARD_W - 3, CARD_H - 3, t.lo);
  });
}

/** 40×56: a diamond lattice in sky over deep, ink outline, mist inner border. */
export function genCardBack(): Pixmap {
  const p = createPixmap(CARD_W, CARD_H);
  roundedRect(p, 0, 0, CARD_W, CARD_H, P.DEEP, P.INK);
  // lattice: diagonal lines every 6px both ways, inset by 3
  for (let y = 3; y < CARD_H - 3; y++) {
    for (let x = 3; x < CARD_W - 3; x++) {
      const a = (x + y) % 6 === 0;
      const b = (x - y + 600) % 6 === 0;
      if (a || b) px(p, x, y, P.SKY);
    }
  }
  // diamond centres get a lit pip
  for (let y = 3; y < CARD_H - 3; y++) {
    for (let x = 3; x < CARD_W - 3; x++) {
      if ((x + y) % 6 === 3 && (x - y + 600) % 6 === 3) px(p, x, y, P.SKY_LIT);
    }
  }
  // inner border
  fillRect(p, 2, 2, CARD_W - 4, 1, P.MIST);
  fillRect(p, 2, CARD_H - 3, CARD_W - 4, 1, P.MIST);
  fillRect(p, 2, 2, 1, CARD_H - 4, P.MIST);
  fillRect(p, CARD_W - 3, 2, 1, CARD_H - 4, P.MIST);
  hLine(p, 2, CARD_W - 3, 1, P.SKY);
  vLine(p, 1, 2, CARD_H - 3, P.SKY);
  return p;
}

/** 32×32 × 2: brass outline chip (frame 1 lit with an inner brass glow), deep fill. */
export function genChalkFrame(): Pixmap {
  return sheet(32, 32, 2, (f, i) => {
    roundedRect(f, 0, 0, 32, 32, P.DEEP, i === 0 ? P.BRASS : P.BRASS_LIT);
    if (i === 1) {
      hLine(f, 2, 29, 1, P.BRASS);
      hLine(f, 2, 29, 30, P.BRASS);
      vLine(f, 1, 2, 29, P.BRASS);
      vLine(f, 30, 2, 29, P.BRASS);
    } else {
      // a whisper of depth on the neutral chip
      hLine(f, 2, 29, 1, P.SHADE);
      vLine(f, 1, 2, 29, P.SHADE);
    }
  });
}

/** Hue by chalk stage. */
export const STAGE_HUE: Record<string, number> = {
  VALUE: P.BRASS,
  BOARD: P.CLARET_LIT,
  RULE: P.SKY_LIT,
  DEAL: P.BAIZE_LIT,
};

/**
 * 12×12 pictograms keyed by chalk id. 'M' is the stage hue; other letters
 * follow the shared legend. Ink outlines are added automatically around the
 * artwork, so most drawings stay inside columns/rows 1–10.
 */
const CHALK_ART: Record<string, string[]> = {
  hot_twenty: [
    '............',
    '......M.....',
    '.....MM.....',
    '.....MMM....',
    '....MMMM....',
    '...MMMMMM...',
    '...MMwwMM...',
    '..MMwwwwMM..',
    '..MMwwwwMM..',
    '...MMwwMM...',
    '....MMMM....',
    '............',
  ],
  feathered: [
    '............',
    '......M.....',
    '.....MMM....',
    '.....MMM....',
    '....MMMMM...',
    '....MMwMM...',
    '...MMMwMMM..',
    '...MMMwMMM..',
    '..MMMMwMMMM.',
    '......w.....',
    '......w.....',
    '............',
  ],
  heavy_tips: [
    '............',
    '.....MM.....',
    '....M..M....',
    '....M..M....',
    '...MMMMMM...',
    '...MwMMMM...',
    '..MMwMMMMM..',
    '..MMMMMMMM..',
    '.MMMMMMMMMM.',
    '.MMMMMMMMMM.',
    '............',
    '............',
  ],
  oiled: [
    '............',
    '.....M......',
    '.....M......',
    '....MMM.....',
    '....MMM.....',
    '...MMMMM....',
    '...MMMMM....',
    '..MMwMMMM...',
    '..MMwMMMM...',
    '...MMMMM....',
    '....MMM.....',
    '............',
  ],
  even_keel: [
    '............',
    '.....M......',
    '..MMMMMMM...',
    '..M..M..M...',
    '.MMM.M.MMM..',
    '.....M......',
    '.....M......',
    '.....M......',
    '....MMM.....',
    '...MMMMM....',
    '............',
    '............',
  ],
  cold_hands: [
    '............',
    '.....M......',
    '..M..M..M...',
    '...M.M.M....',
    '....MMM.....',
    '.MMMMMMMMM..',
    '....MMM.....',
    '...M.M.M....',
    '..M..M..M...',
    '.....M......',
    '............',
    '............',
  ],
  last_orders: [
    '............',
    '.....MM.....',
    '....MMMM....',
    '...MMMMMM...',
    '...MMMMMM...',
    '...MMMMMM...',
    '...MMMMMM...',
    '..MMMMMMMM..',
    '.MMMMMMMMMM.',
    '.....ww.....',
    '............',
    '............',
  ],
  bullish: [
    '............',
    '....MMMM....',
    '..MM....MM..',
    '.M..MMMM..M.',
    '.M.M....M.M.',
    '.M.M.MM.M.M.',
    '.M.M.MM.M.M.',
    '.M.M....M.M.',
    '.M..MMMM..M.',
    '..MM....MM..',
    '....MMMM....',
    '............',
  ],
  split_tips: [
    '............',
    '.M.......M..',
    '.MM.....MM..',
    '.MMM...MMM..',
    '...M...M....',
    '....M.M.....',
    '.....M......',
    '.....M......',
    '.....M......',
    '.....M......',
    '.....M......',
    '............',
  ],
  magnetised: [
    '............',
    '....MMMM....',
    '...MMMMMM...',
    '..MMM..MMM..',
    '..MM....MM..',
    '..MM....MM..',
    '..MM....MM..',
    '..MM....MM..',
    '..www..www..',
    '..www..www..',
    '............',
    '............',
  ],
  narrow_beds: [
    '............',
    '....M..M....',
    '....M..M....',
    '....M..M....',
    '..M.M..M.M..',
    '.MM.M..M.MM.',
    '..M.M..M.M..',
    '....M..M....',
    '....M..M....',
    '....M..M....',
    '............',
    '............',
  ],
  wide_doubles: [
    '............',
    '...MMMMMM...',
    '..MMMMMMMM..',
    '.MMM....MMM.',
    '.MM......MM.',
    '.MM......MM.',
    '.MM......MM.',
    '.MM......MM.',
    '.MMM....MMM.',
    '..MMMMMMMM..',
    '...MMMMMM...',
    '............',
  ],
  mirrored: [
    '............',
    '.....w......',
    '.M...w...M..',
    '.MM..w..MM..',
    '.MMM.w.MMM..',
    '.MMMM.MMMM..',
    '.MMMM.MMMM..',
    '.MMM.w.MMM..',
    '.MM..w..MM..',
    '.M...w...M..',
    '.....w......',
    '............',
  ],
  cheap_chalk: [
    '............',
    '........MMM.',
    '.......MwwM.',
    '......MwwM..',
    '.....MMMM...',
    '............',
    '...MMM......',
    '..MwwM......',
    '.MwwM.......',
    '.MMM........',
    '............',
    '............',
  ],
  forgiving_oche: [
    '............',
    '..MM...MM...',
    '.MMMM.MMMM..',
    '.MMMMMMMMM..',
    '.MwMMMMMMM..',
    '.MMMMMMMMM..',
    '..MMMMMMM...',
    '...MMMMM....',
    '....MMM.....',
    '.....M......',
    '............',
    '............',
  ],
  straight_out: [
    '............',
    '............',
    '............',
    '.......M....',
    '.......MM...',
    '.MMMMMMMMM..',
    '.MMMMMMMMMM.',
    '.MMMMMMMMM..',
    '.......MM...',
    '.......M....',
    '............',
    '............',
  ],
  overshoot: [
    '............',
    '.......w....',
    '.......w....',
    '.......w.M..',
    '.......w.MM.',
    '.MMMMMMMMMM.',
    '.MMMMMMMMMM.',
    '.......w.MM.',
    '.......w.M..',
    '.......w....',
    '.......w....',
    '............',
  ],
  chalk_dust: [
    '............',
    '..M....M....',
    '.....M......',
    '.M.......M..',
    '....M.......',
    '.......M....',
    '..M.....M...',
    '.....M......',
    '.M.......M..',
    '....M..M....',
    '............',
    '............',
  ],
  wide_grip: [
    '............',
    '.MMM........',
    '.M.MMM......',
    '.M.M.MMM....',
    '.M.M.M.MMM..',
    '.M.M.M.M.M..',
    '.M.M.M.M.M..',
    '.MMM.M.M.M..',
    '...MMM.M.M..',
    '.....MMM.M..',
    '.......MMM..',
    '............',
  ],
  tunnel_vision: [
    '............',
    '............',
    '....MMMM....',
    '..MMwwwwMM..',
    '.MwwwiswwwM.',
    '.MwwwiiwwwM.',
    '..MMwwwwMM..',
    '....MMMM....',
    '............',
    '............',
    '............',
    '............',
  ],
  practice_board: [
    '............',
    '....MMMM.M..',
    '..MM....MM..',
    '.M......MMM.',
    '.M..........',
    '.M..........',
    '.M..........',
    '.M.......M..',
    '..MM...MM...',
    '....MMMM....',
    '............',
    '............',
  ],
  chalked_up: [
    '............',
    '...MMMMMM...',
    '..MwwiiwwM..',
    '...MMMMMM...',
    '............',
    '.ww..ww..ww.',
    '.MM..MM..MM.',
    '.MM..MM..MM.',
    '.MM..MM..MM.',
    '.MM..MM..MM.',
    '............',
    '............',
  ],
};

/** Pictograms that are easier to draw than to type. */
function chalkArtSpecial(id: string, hue: number): Pixmap | undefined {
  if (id === 'wired') {
    const p = createPixmap(12, 12);
    const pts = [
      [1, 9],
      [3, 2],
      [6, 9],
      [8, 2],
      [10, 9],
    ];
    for (let i = 0; i + 1 < pts.length; i++) {
      line(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hue);
      line(p, pts[i][0] + 1, pts[i][1], pts[i + 1][0] + 1, pts[i + 1][1], hue);
    }
    return p;
  }
  if (id === 'fourth_dart') {
    const p = createPixmap(12, 12);
    drawGlyph(p, 5, '4', 1, 3, hue);
    // a small dart, tip top-right
    px(p, 10, 1, P.CHALK);
    px(p, 9, 2, P.PEWTER);
    px(p, 8, 3, P.PEWTER);
    px(p, 7, 4, P.PEWTER);
    px(p, 6, 5, P.SKY_LIT);
    px(p, 5, 6, P.SKY_LIT);
    px(p, 6, 6, P.SKY_LIT);
    px(p, 5, 5, P.SKY_LIT);
    return p;
  }
  return undefined;
}

export function chalkIcon(id: string, stage: string): Pixmap {
  const hue = STAGE_HUE[stage] ?? P.MIST;
  let p = chalkArtSpecial(id, hue);
  if (!p) {
    const rows = CHALK_ART[id];
    if (!rows) {
      // unknown chalk: a plain chip so the sheet never has a hole
      p = createPixmap(12, 12);
      roundedRect(p, 2, 2, 8, 8, hue, hue);
    } else {
      p = fromAscii(rows, { M: hue });
    }
  }
  outline(p, P.INK, true);
  return p;
}

/** 12×12 × CHALK_DEFS.length, in CHALK_DEFS order. */
export function genChalkIcons(): Pixmap {
  return sheet(12, 12, CHALK_DEFS.length, (f, i) => {
    const d = CHALK_DEFS[i];
    blit(f, chalkIcon(d.id, d.stage), 0, 0);
  });
}
