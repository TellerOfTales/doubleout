/**
 * Darts and their particles: the flying dart (8 rotation frames), the
 * stuck dart seen from the front, the motion trail, sparks and confetti.
 */
import { P, createPixmap, px, type Pixmap } from '../palette.ts';
import { fillRect, rotateDeg, sheet } from './draw.ts';

/**
 * Frame 0 of the dart, pointing up, as a 9×9 matrix:
 *   point (chalk) at the top, 5px shaft in pewter with a mist highlight on
 *   the barrel, a 3×3 sky flight at the tail. The runtime recolours P.SKY.
 */
export function dartFrame0(): Pixmap {
  const p = createPixmap(9, 9);
  px(p, 4, 0, P.CHALK); // point
  for (let y = 1; y <= 5; y++) px(p, 4, y, P.PEWTER); // shaft
  px(p, 3, 2, P.MIST); // barrel highlight
  px(p, 3, 3, P.MIST);
  px(p, 4, 6, P.SKY); // flight
  fillRect(p, 3, 7, 3, 2, P.SKY);
  return p;
}

/** 9×9 × 8 frames; frame i is frame 0 rotated i×45° clockwise. */
export function genDart(): Pixmap {
  const f0 = dartFrame0();
  return sheet(9, 9, 8, (f, i) => {
    const r = rotateDeg(f0, i * 45);
    for (let k = 0; k < r.data.length; k++) f.data[k] = r.data[k];
  });
}

/** Flight colours by DartCard.flight index, mirrored from the UI's remap table. */
export const FLIGHT_COLOURS = [P.SKY, P.CLARET_LIT, P.BAIZE_LIT, P.BRASS];

/** 5×5 × 4: the flight rosette seen head-on once the dart is in the board. */
export function genDartStuck(): Pixmap {
  return sheet(5, 5, 4, (f, i) => {
    const c = FLIGHT_COLOURS[i];
    const rows = ['.F.F.', 'FFFFF', '.FIF.', 'FFFFF', '.F.F.'];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const ch = rows[y][x];
        if (ch === 'F') px(f, x, y, c);
        else if (ch === 'I') px(f, x, y, P.INK);
      }
    }
    px(f, 1, 1, P.CHALK); // glint
  });
}

/** 16×4 × 4: a streak, brightest in the middle, each frame shorter and fainter. */
export function genDartTrail(): Pixmap {
  return sheet(16, 4, 4, (f, i) => {
    const len = 16 - i * 4;
    const x0 = Math.floor((16 - len) / 2);
    const thick = i < 3;
    for (let k = 0; k < len; k++) {
      const t = 1 - Math.abs((k + 0.5) / len - 0.5) * 2; // 0 at the ends, 1 at the centre
      let c: number;
      if (i === 0) c = t > 0.7 ? P.CHALK : t > 0.35 ? P.SKY_LIT : P.SKY;
      else if (i === 1) c = t > 0.6 ? P.SKY_LIT : P.SKY;
      else if (i === 2) c = t > 0.75 ? P.SKY_LIT : P.SKY;
      else c = P.SKY;
      if (i === 3 && k % 2 === 1) continue; // fainter: dotted
      px(f, x0 + k, 1, c);
      if (thick && t > 0.2) px(f, x0 + k, 2, c);
    }
  });
}

/** 3×3 × 4: brass-lit plus, chalk dot, ember plus, sky-lit dot. */
export function genSpark(): Pixmap {
  return sheet(3, 3, 4, (f, i) => {
    const c = [P.BRASS_LIT, P.CHALK, P.EMBER, P.SKY_LIT][i];
    if (i % 2 === 0) {
      px(f, 1, 0, c);
      px(f, 0, 1, c);
      px(f, 1, 1, c);
      px(f, 2, 1, c);
      px(f, 1, 2, c);
    } else {
      px(f, 1, 1, c);
    }
  });
}

/** 2×2 × 4 solid squares: claret-lit, baize-lit, brass-lit, sky-lit. */
export function genConfetti(): Pixmap {
  return sheet(2, 2, 4, (f, i) => {
    fillRect(f, 0, 0, 2, 2, [P.CLARET_LIT, P.BAIZE_LIT, P.BRASS_LIT, P.SKY_LIT][i]);
  });
}
