/**
 * Small animation toolkit: easing, coroutines for choreography, particles,
 * screen shake and flashes. Cosmetic randomness comes from its own RNG.
 */
import { createRng, nextFloat } from '../core/rng';
import type { Rng } from '../core/types';

export const ease = {
  linear: (t: number) => t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inQuad: (t: number) => t * t,
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Cosmetic RNG shared by VFX. Never used by game logic. */
export const vfxRng: Rng = createRng(0xc0ffee);
export function rnd(): number {
  return nextFloat(vfxRng);
}
export function rndRange(a: number, b: number): number {
  return a + (b - a) * rnd();
}

// ---------------------------------------------------------------- coroutines

/** yield a number → wait that many seconds; yield a function → wait until it returns true. */
export type Step = number | (() => boolean);
export type Routine = Generator<Step, void, void>;

interface Running {
  gen: Routine;
  wait: number;
  until: (() => boolean) | null;
  done: boolean;
  onDone?: () => void;
}

export class Coroutines {
  private list: Running[] = [];

  run(gen: Routine, onDone?: () => void): Running {
    const r: Running = { gen, wait: 0, until: null, done: false, onDone };
    this.list.push(r);
    this.advance(r);
    return r;
  }

  private advance(r: Running): void {
    if (r.done) return;
    for (let guard = 0; guard < 100; guard++) {
      const res = r.gen.next();
      if (res.done) {
        r.done = true;
        r.onDone?.();
        return;
      }
      const v = res.value;
      if (typeof v === 'number') {
        if (v > 0) {
          r.wait = v;
          return;
        }
        // yield 0 → next frame
        r.wait = 0.0001;
        return;
      }
      if (typeof v === 'function') {
        if (v()) continue;
        r.until = v;
        return;
      }
    }
  }

  update(dt: number): void {
    for (const r of this.list) {
      if (r.done) continue;
      if (r.until) {
        if (!r.until()) continue;
        r.until = null;
        this.advance(r);
        continue;
      }
      r.wait -= dt;
      if (r.wait <= 0) this.advance(r);
    }
    this.list = this.list.filter((r) => !r.done);
  }

  get busy(): boolean {
    return this.list.length > 0;
  }

  clear(): void {
    this.list = [];
  }
}

// ---------------------------------------------------------------- particles

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gravity: number;
  sprite: string;
  frame: number;
  /** Optional colour for 1px particles when sprite is ''. */
  color: number;
  drag: number;
}

export class Particles {
  list: Particle[] = [];

  emit(n: number, make: (i: number) => Partial<Particle> & { x: number; y: number }): void {
    for (let i = 0; i < n; i++) {
      const p = make(i);
      this.list.push({
        vx: 0,
        vy: 0,
        life: 0.6,
        maxLife: 0.6,
        gravity: 120,
        sprite: 'spark',
        frame: 0,
        color: 12,
        drag: 0,
        ...p,
      });
      const last = this.list[this.list.length - 1];
      last.maxLife = last.life;
    }
    if (this.list.length > 600) this.list.splice(0, this.list.length - 600);
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      if (p.drag) {
        p.vx *= 1 - p.drag * dt;
        p.vy *= 1 - p.drag * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  clear(): void {
    this.list = [];
  }
}

// ---------------------------------------------------------------- shake / flash

export class Shake {
  private amp = 0;
  private time = 0;
  x = 0;
  y = 0;
  enabled = true;

  hit(amount: number, seconds = 0.25): void {
    if (!this.enabled) return;
    this.amp = Math.max(this.amp, amount);
    this.time = Math.max(this.time, seconds);
  }

  update(dt: number): void {
    if (this.time <= 0) {
      this.x = 0;
      this.y = 0;
      this.amp = 0;
      return;
    }
    this.time -= dt;
    const a = this.amp * clamp01(this.time / 0.25);
    this.x = Math.round(rndRange(-a, a));
    this.y = Math.round(rndRange(-a, a));
  }
}

/** A timed value that decays from 1 to 0. */
export class Pulse {
  value = 0;
  private duration = 1;
  private t = 0;

  fire(duration: number): void {
    this.duration = duration;
    this.t = duration;
    this.value = 1;
  }

  update(dt: number): void {
    if (this.t <= 0) {
      this.value = 0;
      return;
    }
    this.t -= dt;
    this.value = clamp01(this.t / this.duration);
  }

  get active(): boolean {
    return this.t > 0;
  }
}

/** Animated number that ticks toward a target (score readout). */
export class Counter {
  shown: number;
  target: number;
  private speed = 0;
  onTick: ((v: number) => void) | null = null;

  constructor(v: number) {
    this.shown = v;
    this.target = v;
  }

  set(v: number, seconds = 0.4): void {
    this.target = v;
    const diff = Math.abs(this.target - this.shown);
    this.speed = seconds > 0 ? Math.max(1, diff / seconds) : Infinity;
  }

  snap(v: number): void {
    this.shown = v;
    this.target = v;
  }

  update(dt: number): void {
    if (this.shown === this.target) return;
    const step = this.speed === Infinity ? Infinity : this.speed * dt;
    const before = this.shown;
    if (this.shown > this.target) this.shown = Math.max(this.target, this.shown - step);
    else this.shown = Math.min(this.target, this.shown + step);
    if (Math.floor(before) !== Math.floor(this.shown)) this.onTick?.(Math.floor(this.shown));
  }

  get settled(): boolean {
    return this.shown === this.target;
  }
}
