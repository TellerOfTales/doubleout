/**
 * Aiming: the board as an input surface, and the outcome fan drawn on it.
 *
 * This is the piece the rebuild turns on. The player picks any of the
 * sixty-two targets by pointing at it, and before committing sees exactly
 * where the dart might end up and how likely each place is. Hiding that would
 * turn a decision into a superstition — a press-your-luck choice is only a
 * choice when the player can see what they are giving up.
 * See docs/decisions/design.md §5.3.
 */
import { P } from '../art/palette';
import { BED_ORDER, type Bed, type Target } from '../core/types';
import { bedIndex, sameTarget, targetNotation } from '../core/board';
import type { Landing } from '../core/resolver';
import type { Renderer } from './draw';
import type { GameLayout } from './layout';

/** Radii on the 96px board, from the 128px art spec at scale 0.75. */
export const R96 = { outer: 46, doubleIn: 42, trebleOut: 30, trebleIn: 26, outerBull: 4.5, innerBull: 2.3 };

/** Degrees per bed. Twenty beds, twenty at the top. */
const SECTOR = 18;

/**
 * The target under a point, or null if the point is off the board. Rings snap
 * generously: the double band is four pixels wide on a 96-pixel board, which
 * is not something a thumb can be asked to hit, so anything past the treble
 * ring reads as the double the player was obviously going for.
 */
export function targetAt(l: GameLayout, x: number, y: number): Target | null {
  const dx = x - l.boardCentre.x;
  const dy = y - l.boardCentre.y;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r > R96.outer + 4) return null;
  // The bull is two and a bit pixels across on a 96-pixel board, so both
  // rings get a little more than they own. Anything closer in than the outer
  // bull's own radius reads as the bull itself.
  if (r <= 3.2) return { region: 'IB' };
  if (r <= 7) return { region: 'OB' };
  // Angle measured clockwise from the top, which is how the beds run.
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  while (deg < 0) deg += 360;
  const bed = BED_ORDER[Math.floor((deg + SECTOR / 2) / SECTOR) % 20] as Bed;
  // The real bands are 26–30 for the treble and 42–46 for the double: four
  // pixels each, which no thumb can be asked to hit. Each ring therefore owns
  // the dead space either side of it, so a tap anywhere near the treble reads
  // as the treble the player was plainly going for.
  if (r <= 24) return { region: 'S', bed }; // the inner single, under the treble
  if (r <= 32) return { region: 'T', bed };
  if (r <= 40) return { region: 'S', bed }; // the big outer single
  return { region: 'D', bed };
}

/** Where a target sits on screen: the middle of its band, in its bed. */
export function pointOf(l: GameLayout, t: Target): { x: number; y: number } {
  const c = l.boardCentre;
  if (t.region === 'IB' || t.region === 'W') return { x: c.x, y: c.y };
  if (t.region === 'OB') return { x: c.x, y: c.y - 5 };
  const a = ((-90 + bedIndex(t.bed as Bed) * SECTOR) * Math.PI) / 180;
  const r = t.region === 'D' ? (R96.doubleIn + R96.outer) / 2 : t.region === 'T' ? (R96.trebleIn + R96.trebleOut) / 2 : (R96.trebleOut + R96.doubleIn) / 2;
  return { x: Math.round(c.x + Math.cos(a) * r), y: Math.round(c.y + Math.sin(a) * r) };
}

/** Step the aim one bed round the board, keeping the ring. */
export function stepBed(t: Target, dir: 1 | -1): Target {
  if (t.region === 'OB' || t.region === 'IB' || t.region === 'W') return { region: 'S', bed: 20 };
  return { region: t.region, bed: BED_ORDER[(bedIndex(t.bed as Bed) + 20 + dir) % 20] as Bed };
}

/** Step the aim in or out through the rings: single, treble, double, bull. */
export function stepRing(t: Target, dir: 1 | -1): Target {
  const ladder: Target['region'][] = ['IB', 'OB', 'T', 'S', 'D'];
  const bed = t.bed ?? 20;
  const at = ladder.indexOf(t.region);
  const next = ladder[Math.min(ladder.length - 1, Math.max(0, at + dir))];
  return next === 'OB' || next === 'IB' ? { region: next } : { region: next, bed: bed as Bed };
}

// ---------------------------------------------------------------- drawing

/** The crosshair over the target the player is aiming at. */
export function drawAimMark(r: Renderer, l: GameLayout, t: Target, phase: number): void {
  const p = pointOf(l, t);
  const blink = Math.sin(phase * 6) > -0.4;
  const c = blink ? P.CHALK : P.BRASS_LIT;
  r.line(p.x - 4, p.y, p.x - 2, p.y, c);
  r.line(p.x + 2, p.y, p.x + 4, p.y, c);
  r.line(p.x, p.y - 4, p.x, p.y - 2, c);
  r.line(p.x, p.y + 2, p.x, p.y + 4, c);
  r.pixel(p.x, p.y, P.EMBER);
}

/**
 * The outcome fan: every place the dart could finish, sized by how likely it
 * is. The place you aimed is a ring; the drifts are dots that fade with their
 * probability; a chance of the wall is a mark outside the board, because a
 * dart that leaves the board is the thing the player most needs to see coming.
 */
export function drawFan(r: Renderer, l: GameLayout, aimed: Target, dist: Landing[]): void {
  let wall = 0;
  for (const land of dist) {
    if (land.target.region === 'W') {
      wall += land.p;
      continue;
    }
    if (sameTarget(land.target, aimed)) continue;
    const p = pointOf(l, land.target);
    const strong = land.p >= 0.14;
    const colour = land.kind === 'lucky' ? P.BAIZE_LIT : strong ? P.MIST : P.PEWTER;
    r.pixel(p.x, p.y, colour);
    if (strong) {
      r.pixel(p.x - 1, p.y, colour);
      r.pixel(p.x + 1, p.y, colour);
      r.pixel(p.x, p.y - 1, colour);
      r.pixel(p.x, p.y + 1, colour);
    }
  }
  if (wall > 0.02) {
    // Off the board, bottom right of it, with a bar that grows with the risk.
    const x = l.board.x + l.board.w - 12;
    const y = l.board.y + l.board.h - 4;
    const wide = Math.max(2, Math.round(wall * 22));
    r.rect(x, y, wide, 2, P.EMBER);
    r.text('X', x - 6, y - 3, { font: 5, color: P.EMBER });
  }
}

/** "T20 · 45%" for the aim bar. */
export function aimLabel(t: Target, chance: number): string {
  return `${targetNotation(t)}  ${Math.round(chance)}%`;
}
