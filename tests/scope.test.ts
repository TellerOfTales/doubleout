/**
 * THE SCOPE — the magnifier over the sights.
 *
 * The fourth playtest said aiming was hard "because the thumb covers the point
 * and the target is extremely small for thumb aiming". The scope is the answer:
 * a window on the board around the sights, parked in whichever corner of the
 * board the thumb is not in. These tests pin the two properties that make it
 * work — it is always on the board, and it is always away from the aim.
 */
import { describe, expect, it } from 'vitest';
import { ALL_TARGETS, targetNotation } from '../src/core/board.ts';
import { SCOPE, pointOf, scopeRect, targetAt } from '../src/ui/aim.ts';
import { gameLayout } from '../src/ui/layout.ts';

const LAYOUTS = [
  { name: 'landscape', l: gameLayout(320, 180) },
  { name: 'portrait', l: gameLayout(180, 320) },
];

describe('the scope sits on the board and out of the way', () => {
  for (const { name, l } of LAYOUTS) {
    it(`${name}: the panel is always inside the board`, () => {
      for (const t of ALL_TARGETS) {
        if (t.region === 'W') continue;
        const box = scopeRect(l, pointOf(l, t));
        expect(box.x).toBeGreaterThanOrEqual(l.board.x);
        expect(box.y).toBeGreaterThanOrEqual(l.board.y);
        expect(box.x + box.w).toBeLessThanOrEqual(l.board.x + l.board.w);
        expect(box.y + box.h).toBeLessThanOrEqual(l.board.y + l.board.h);
      }
    });

    it(`${name}: the panel never covers the sights`, () => {
      for (const t of ALL_TARGETS) {
        if (t.region === 'W') continue;
        const p = pointOf(l, t);
        const box = scopeRect(l, p);
        const inside = p.x >= box.x && p.x < box.x + box.w && p.y >= box.y && p.y < box.y + box.h;
        expect(inside, `${targetNotation(t)} is under its own scope`).toBe(false);
      }
    });

    it(`${name}: it never covers a thumb anywhere on the board either`, () => {
      // The corner is chosen by distance from the aim, and a thumb that is on
      // the board is within a few pixels of the aim it just set, so the same
      // sweep over every point of the board stands in for every thumb.
      for (let y = l.board.y; y < l.board.y + l.board.h; y += 3) {
        for (let x = l.board.x; x < l.board.x + l.board.w; x += 3) {
          const box = scopeRect(l, { x, y });
          const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
          expect(inside, `a thumb at ${x},${y} is under the scope`).toBe(false);
        }
      }
    });
  }

  it('the window is a whole number of magnified pixels', () => {
    expect(SCOPE.srcW * SCOPE.zoom).toBe(SCOPE.viewW);
    expect(SCOPE.srcH * SCOPE.zoom).toBe(SCOPE.viewH);
    expect(SCOPE.w).toBeGreaterThanOrEqual(SCOPE.viewW + 4);
    expect(SCOPE.h).toBeGreaterThanOrEqual(SCOPE.viewH + SCOPE.callout + 4);
  });

  it('the corner moves when the aim crosses the middle of the board', () => {
    const l = gameLayout(320, 180);
    const c = l.boardCentre;
    const tl = scopeRect(l, { x: c.x - 30, y: c.y - 30 });
    const br = scopeRect(l, { x: c.x + 30, y: c.y + 30 });
    expect(tl.x).toBeGreaterThan(br.x);
    expect(tl.y).toBeGreaterThan(br.y);
  });
});

describe('every target still round-trips through the board as an input surface', () => {
  for (const { name, l } of LAYOUTS) {
    it(`${name}: pointOf then targetAt gives the target back`, () => {
      for (const t of ALL_TARGETS) {
        if (t.region === 'W') continue;
        const p = pointOf(l, t);
        const back = targetAt(l, p.x, p.y);
        expect(back, `${targetNotation(t)} is unreachable`).not.toBeNull();
        expect(targetNotation(back as never)).toBe(targetNotation(t));
      }
    });
  }
});
