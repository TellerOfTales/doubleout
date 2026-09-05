/**
 * The dartboard (TDD §11.4 "board.png"): a parametric object. Twenty 18°
 * sectors with bed 20 centred at the top, double and treble rings, two
 * bulls, brass wires on every boundary, an ink outline and a stone rim.
 *
 * Geometry is evaluated per pixel in pixel-centre space: pixel (x, y) sits at
 * (x + 0.5, y + 0.5) and the board centre is (size/2, size/2), so the board
 * is perfectly symmetric. Region bands are half-open [rIn, rOut); ring wires
 * occupy the outermost 1px of the region inside each boundary.
 */
import { P, createPixmap, type Pixmap } from '../palette.ts';
import { drawText, textWidth } from './draw.ts';

/** Clockwise from the top. Mirrors BED_ORDER in src/core/types.ts (art must not import core). */
export const BED_RING = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

export interface BoardSpec {
  size: number;
  outer: number;
  doubleIn: number;
  trebleOut: number;
  trebleIn: number;
  outerBull: number;
  innerBull: number;
  /** Draw sector wires (false on the tiny 48px thumbnail). */
  sectorWires: boolean;
  /** Draw ring wires on band boundaries. */
  ringWires: boolean;
}

export const BOARD_SPECS: Record<number, BoardSpec> = {
  128: { size: 128, outer: 62, doubleIn: 56, trebleOut: 40, trebleIn: 34, outerBull: 6, innerBull: 3, sectorWires: true, ringWires: true },
  96: { size: 96, outer: 46, doubleIn: 42, trebleOut: 30, trebleIn: 26, outerBull: 4.5, innerBull: 2.25, sectorWires: true, ringWires: true },
  64: { size: 64, outer: 31, doubleIn: 28, trebleOut: 20, trebleIn: 17, outerBull: 3, innerBull: 1.5, sectorWires: true, ringWires: true },
  48: { size: 48, outer: 23, doubleIn: 20, trebleOut: 15, trebleIn: 12, outerBull: 2.5, innerBull: 1.5, sectorWires: false, ringWires: false },
};

export function boardSpec(size: number): BoardSpec {
  const s = BOARD_SPECS[size];
  if (!s) throw new Error(`no board spec for ${size}`);
  return s;
}

/** Sector index (0 = bed 20 at the top, clockwise) for a direction. */
export function sectorIndex(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = up, 90 = right
  return Math.floor((((deg + 9) % 360) + 360) % 360 / 18) % 20;
}

export function genBoard(size: number, opts: { wireHighlight?: boolean } = {}): Pixmap {
  const s = boardSpec(size);
  const p = createPixmap(size, size);
  const c = size / 2;
  const wire = opts.wireHighlight ? P.BRASS_LIT : P.BRASS;
  const rimOut = s.outer + 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= rimOut) continue;
      let v: number;
      if (d >= s.outer + 1) v = P.STONE;
      else if (d >= s.outer) v = P.INK;
      else {
        const idx = sectorIndex(dx, dy);
        const even = idx % 2 === 0;
        const single = even ? P.SHADE : P.MIST;
        const band = even ? P.CLARET : P.BAIZE;
        if (d < s.innerBull) v = P.CLARET;
        else if (d < s.outerBull) v = P.BAIZE;
        else if (d < s.trebleIn) v = single;
        else if (d < s.trebleOut) v = band;
        else if (d < s.doubleIn) v = single;
        else v = band;
        // ring wires: outermost 1px inside each boundary
        if (s.ringWires) {
          for (const r of [s.innerBull, s.outerBull, s.trebleIn, s.trebleOut, s.doubleIn, s.outer]) {
            if (d >= r - 1 && d < r) {
              v = wire;
              break;
            }
          }
        } else if (d >= s.outer - 1) {
          v = wire;
        }
        // sector wires: 1px lines from the bull ring to the edge
        if (s.sectorWires && v !== wire && d >= s.outerBull) {
          const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
          const b = Math.round((deg + 9) / 18) * 18 - 9;
          const perp = Math.abs(d * Math.sin(((deg - b) * Math.PI) / 180));
          if (perp < 0.5) v = wire;
        }
      }
      p.data[y * size + x] = v;
    }
  }
  return p;
}

/**
 * The number ring: not a board. Bed numbers in the 5×7 font, chalk with an
 * ink outline, each centred on its sector just outside the rim. The pixmap
 * is board size + 10px each side (148 and 116). Two-digit numbers beside the board
 * (11, 14, 8…) overlap the stone rim by a few pixels — the 20px margin is
 * narrower than a two-digit number — which reads like a real number ring.
 */
export function genBoardNumbers(size: number): Pixmap {
  const s = boardSpec(size);
  const pad = 10;
  const full = size + pad * 2;
  const p = createPixmap(full, full);
  const c = full / 2;
  const radius = s.outer + 7.5;
  for (let i = 0; i < 20; i++) {
    const a = (i * 18 * Math.PI) / 180;
    const ux = Math.sin(a);
    const uy = -Math.cos(a);
    const text = String(BED_RING[i]);
    const w = textWidth(5, text);
    let left = Math.round(c + ux * radius - w / 2 - 0.5);
    let top = Math.round(c + uy * radius - 3.5 - 0.5);
    left = Math.max(1, Math.min(full - 1 - w, left));
    top = Math.max(1, Math.min(full - 1 - 7, top));
    drawText(p, 5, text, left, top, P.CHALK, { outline: P.INK });
  }
  return p;
}

/** Colour of the board at an offset from the centre (test helper). */
export function boardPixelAt(p: Pixmap, dx: number, dy: number): number {
  const c = p.w / 2;
  const x = Math.floor(c + dx);
  const y = Math.floor(c + dy);
  return p.data[y * p.w + x];
}

