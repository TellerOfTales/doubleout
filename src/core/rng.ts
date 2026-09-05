import type { Rng } from './types';

/**
 * mulberry32 — the single seeded generator (TDD §8). One instance per night
 * for gameplay; a separate instance for cosmetic choices (commentary, VFX).
 * Never use Math.random() in game logic.
 */
export function createRng(seed: number): Rng {
  return { s: seed >>> 0 };
}

/** Next float in [0, 1). Mutates the state. */
export function nextFloat(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function nextInt(r: Rng, n: number): number {
  return Math.floor(nextFloat(r) * n);
}

/** Fisher–Yates, in place. Returns the same array. */
export function shuffle<T>(r: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(r, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** Pick one element by weight. Weights must be positive. */
export function pickWeighted<T>(r: Rng, items: T[], weights: number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let x = nextFloat(r) * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Deterministic string → seed hash (FNV-1a 32-bit). Used for typed seed strings. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Encode a uint32 seed as a 7-character readable string (base-32, no ambiguous glyphs). */
export function seedToString(seed: number): string {
  let s = '';
  let v = seed >>> 0;
  for (let i = 0; i < 7; i++) {
    s = SEED_ALPHABET[v & 31] + s;
    v = v >>> 5;
  }
  return s;
}

/**
 * Parse a seed typed by the player. A 7-character alphabet string decodes
 * exactly; anything else (numbers, words) hashes deterministically.
 */
export function parseSeed(input: string): number {
  const t = input.trim().toUpperCase().replace(/O/g, '0').replace(/I/g, '1');
  if (/^[0-9]{1,10}$/.test(t)) return Number(t) >>> 0;
  if (t.length === 7 && [...t].every((c) => SEED_ALPHABET.includes(c))) {
    let v = 0;
    for (const c of t) v = (v * 32 + SEED_ALPHABET.indexOf(c)) >>> 0;
    return v >>> 0;
  }
  return hashSeed(t);
}
