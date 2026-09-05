/**
 * The dartboard on screen: sprite, numbers ring, stuck darts, wobble on
 * impact, and the geometry that turns a Target into a landing pixel.
 */
import { P } from '../art/palette';
import { bedIndex } from '../core/board';
import type { Target } from '../core/types';
import type { Renderer } from './draw';
import type { GameLayout } from './layout';
import { Pulse, rndRange } from './tween';

export interface StuckDart {
  x: number;
  y: number;
  flight: number;
  /** Seconds since it landed (for the landing bounce). */
  age: number;
}

/** Radii for the 96px board, derived from the 128px spec (scale 0.75). */
const R96 = { outer: 46, doubleIn: 42, trebleOut: 30, trebleIn: 26, outerBull: 4.5, innerBull: 2.3 };

export class BoardView {
  stuck: StuckDart[] = [];
  wobble = new Pulse();
  /** Wire highlight flash (wired deflection). */
  wired = new Pulse();
  /** Highlighted sector index (tutorial pointer), or -1. */
  highlightBed = -1;
  time = 0;

  constructor(public layout: GameLayout) {}

  /** Landing point (internal pixels) for a resolved target, with cosmetic jitter inside the region. */
  landing(t: Target): { x: number; y: number } {
    const c = this.layout.boardCentre;
    if (t.region === 'IB') {
      return { x: c.x + Math.round(rndRange(-1, 1)), y: c.y + Math.round(rndRange(-1, 1)) };
    }
    if (t.region === 'OB') {
      const a = rndRange(0, Math.PI * 2);
      const r = rndRange(R96.outerBull - 1.5, R96.outerBull - 0.3) + 0.6;
      return { x: Math.round(c.x + Math.cos(a) * r), y: Math.round(c.y + Math.sin(a) * r) };
    }
    const i = bedIndex(t.bed as never);
    const centreAngle = (-90 + i * 18) * (Math.PI / 180);
    const a = centreAngle + rndRange(-6, 6) * (Math.PI / 180);
    let r: number;
    if (t.region === 'D') r = rndRange(R96.doubleIn + 0.8, R96.outer - 0.8);
    else if (t.region === 'T') r = rndRange(R96.trebleIn + 0.8, R96.trebleOut - 0.8);
    else {
      // singles: mostly the big outer single, sometimes the inner single
      r = rndRange(0, 1) < 0.7 ? rndRange(R96.trebleOut + 2, R96.doubleIn - 2) : rndRange(R96.outerBull + 3, R96.trebleIn - 2);
    }
    return { x: Math.round(c.x + Math.cos(a) * r), y: Math.round(c.y + Math.sin(a) * r) };
  }

  /** Centre point of a bed's outer single (for tutorial pointers). */
  bedPoint(bed: number, radius = 36): { x: number; y: number } {
    const c = this.layout.boardCentre;
    const i = bedIndex(bed as never);
    const a = (-90 + i * 18) * (Math.PI / 180);
    return { x: Math.round(c.x + Math.cos(a) * radius), y: Math.round(c.y + Math.sin(a) * radius) };
  }

  addStuck(x: number, y: number, flight: number): void {
    this.stuck.push({ x, y, flight, age: 0 });
    if (this.stuck.length > 4) this.stuck.shift();
    this.wobble.fire(0.28);
  }

  clearDarts(): void {
    this.stuck = [];
  }

  update(dt: number): void {
    this.time += dt;
    this.wobble.update(dt);
    this.wired.update(dt);
    for (const d of this.stuck) d.age += dt;
  }

  draw(r: Renderer): void {
    const l = this.layout;
    const w = this.wobble.value;
    const dx = w > 0 ? Math.round(Math.sin(this.time * 60) * w * 1.5) : 0;
    const dy = w > 0 ? Math.round(Math.cos(this.time * 47) * w) : 0;
    r.offset(dx, dy, () => {
      // shadow under the board
      r.dither(l.board.x + 2, l.board.y + 3, l.board.w, l.board.h, P.INK, 8);
      const name = this.wired.active ? 'board_wired_96' : l.boardName;
      r.sprite(r.sprites.has(name) ? name : l.boardName, l.board.x, l.board.y);
      if (r.sprites.has(l.boardNumbersName)) {
        const n = r.sprites.get(l.boardNumbersName);
        r.sprite(l.boardNumbersName, l.board.x - Math.floor((n.w - l.board.w) / 2), l.board.y - Math.floor((n.h - l.board.h) / 2));
      }
      if (this.highlightBed >= 0) {
        const p = this.bedPoint(this.highlightBed, 40);
        const blink = Math.floor(this.time * 4) % 2 === 0;
        if (blink) r.circle(p.x, p.y, 5, P.BRASS_LIT);
      }
      for (const d of this.stuck) {
        const bounce = d.age < 0.15 ? Math.round((0.15 - d.age) * 10) : 0;
        r.sprite('dart_stuck', d.x - 2, d.y - 2 - bounce, d.flight);
      }
    });
  }
}
