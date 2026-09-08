/**
 * The words have to fit the strips they are printed on.
 *
 * A contract whose condition is cut off with an ellipsis is a contract the
 * player is staking Pot on without being told what it asks for, and the
 * narrowest place it is printed is a fifty-five pixel card on a portrait
 * phone. These tests measure the real text against the real rects, so copy
 * cannot quietly outgrow the furniture again.
 */
import { describe, expect, it } from 'vitest';
import { measureText } from '../src/art/sprites.ts';
import { CONTRACTS } from '../src/core/slate.ts';
import { INTERVENTIONS } from '../src/content/interventions.ts';
import { gameLayout, slateSlots } from '../src/ui/layout.ts';
import { WIRE_MULT } from '../src/content/legs.ts';

/** The renderer's own greedy wrap, on words. */
function lineCount(text: string, max: number): number {
  let lines = 1;
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (measureText(5, next) > max) {
      lines++;
      cur = word;
    } else cur = next;
  }
  return lines;
}

const CARD_LINES = 3;

describe('the slate strip', () => {
  for (const [name, l] of [
    ['landscape', gameLayout(320, 180)],
    ['portrait', gameLayout(180, 320)],
  ] as const) {
    const cw = slateSlots(l, 3)[0].w;
    it(`${name}: every contract's condition fits the card at ${cw}px`, () => {
      for (const c of CONTRACTS) {
        expect(lineCount(c.blurb, cw - 6), `${c.name}: "${c.blurb}"`).toBeLessThanOrEqual(CARD_LINES);
      }
    });

    it(`${name}: every contract's name fits the chalk line`, () => {
      for (const c of CONTRACTS) {
        expect(c.name.length, c.name).toBeLessThanOrEqual(8);
        expect(measureText(5, c.name), c.name).toBeLessThanOrEqual(cw - 6);
      }
    });
  }

  it('no two contracts answer to the same name', () => {
    const names = CONTRACTS.map((c) => c.name);
    expect(new Set(names).size, names.join(', ')).toBe(names.length);
  });

  it('a fourth contract still fits when Wide Grip adds one', () => {
    for (const l of [gameLayout(320, 180), gameLayout(180, 320)]) {
      const slots = slateSlots(l, 4);
      expect(slots.length).toBe(4);
      expect(slots[3].x + slots[3].w).toBeLessThanOrEqual(l.slate.x + l.slate.w);
    }
    // A fourth card is forty-one pixels of writing room in either orientation,
    // which no eight-character name fits, so drawContract trims to the frame.
    // What this pins is that the trim never eats more than two characters —
    // beyond that a name stops being a name.
    const wide = slateSlots(gameLayout(320, 180), 4)[0].w;
    for (const c of CONTRACTS) expect(measureText(5, c.name.slice(0, -2)), c.name).toBeLessThanOrEqual(wide - 6);
  });
});

describe('the wire card', () => {
  it('everything printed on it fits the narrowest card there is', () => {
    // The wire takes one of the slate's own slots, so the tightest it ever
    // gets is a four-up card on a portrait phone.
    const w = slateSlots(gameLayout(180, 320), 4)[0].w - 6;
    expect(measureText(5, 'WIRE')).toBeLessThanOrEqual(w);
    expect(measureText(5, 'DOWN')).toBeLessThanOrEqual(w);
    // The biggest figure the wire can hold: a full slate of the dearest
    // contracts, four visits of doubling.
    expect(measureText(9, '999')).toBeLessThanOrEqual(w);
    for (const mult of WIRE_MULT) expect(measureText(5, `×${mult}`)).toBeLessThanOrEqual(w);
    expect(measureText(5, '999 NEXT')).toBeLessThanOrEqual(slateSlots(gameLayout(320, 180), 3)[0].w - 6);
  });
});

describe('the kit strip', () => {
  it('every intervention name fits a chip', () => {
    for (const k of INTERVENTIONS) {
      expect(k.name.length, k.name).toBeLessThanOrEqual(9);
      expect(k.blurb.length, k.blurb).toBeLessThanOrEqual(46);
    }
  });
});

describe('the meter column is clear of everything else', () => {
  it('does not overlap the board, the kit or the buttons', () => {
    for (const l of [gameLayout(320, 180), gameLayout(180, 320)]) {
      const m = l.meter;
      const overlaps = (r: { x: number; y: number; w: number; h: number }) =>
        m.x < r.x + r.w && m.x + m.w > r.x && m.y < r.y + r.h && m.y + m.h > r.y;
      for (const [name, rect] of [
        ['board', l.board],
        ['kit', l.kit],
        ['aimBar', l.aimBar],
        ['throwBtn', l.throwBtn],
        ['slate', l.slate],
        ['score', l.score],
      ] as const) {
        expect(overlaps(rect), `${l.orientation}: the meter overlaps the ${name}`).toBe(false);
      }
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeGreaterThanOrEqual(l.chrome.h);
      expect(m.x + m.w).toBeLessThanOrEqual(l.w);
      expect(m.y + m.h).toBeLessThanOrEqual(l.h);
    }
  });
});
