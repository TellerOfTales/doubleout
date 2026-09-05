/**
 * TDD §8 / §17.1 — determinism. Same seed + same inputs → identical night.
 * A scripted bot (highest-value non-busting card, else the first; in the shop
 * the first affordable card slot, then leave) replays seed 12345 a thousand
 * times; fifty random seeds thrice; snapshots deserialised mid-night continue
 * identically; different seeds differ; and a deeper checkout-aware run with
 * `wired` (the only chalk that consumes the RNG) does the same.
 */
import { describe, expect, it } from 'vitest';
import { chooseCard } from '../src/core/bot.ts';
import { createRng, nextFloat, nextInt, parseSeed, seedToString, shuffle } from '../src/core/rng.ts';
import { beginLeg, commitCard, createNight, currentLeg, deserialiseNight, serialiseNight } from '../src/core/state.ts';
import type { NightState } from '../src/core/types.ts';
import { botPickCard, continueScripted, playScripted, playSmart, sha256, smartPickCard, startNight } from './helpers.ts';

const SEED = 12345;
const DEEP_CHALK = ['straight_out', 'overshoot', 'wide_grip', 'wired'];

function random50(): number[] {
  const r = createRng(0xd00b1e);
  const out: number[] = [];
  while (out.length < 50) {
    const s = Math.floor(nextFloat(r) * 0x100000000) >>> 0;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

describe('the mulberry32 generator (TDD §8)', () => {
  it('the same seed yields the same stream', () => {
    const a = createRng(SEED);
    const b = createRng(SEED);
    for (let i = 0; i < 1000; i++) expect(nextFloat(a)).toBe(nextFloat(b));
  });
  it('floats are in [0, 1) and ints in [0, n)', () => {
    const r = createRng(99);
    for (let i = 0; i < 10000; i++) {
      const f = nextFloat(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const k = nextInt(r, 7);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(7);
      expect(Number.isInteger(k)).toBe(true);
    }
  });
  it('shuffle is a permutation and is seed-determined', () => {
    const a = shuffle(createRng(5), [1, 2, 3, 4, 5, 6, 7, 8]);
    const b = shuffle(createRng(5), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffle(createRng(6), [1, 2, 3, 4, 5, 6, 7, 8])).not.toEqual(a);
  });
  it('seed strings round-trip through seedToString / parseSeed', () => {
    for (const s of [0, 1, SEED, 0xffffffff, 0x80000000, 4242424242]) {
      const str = seedToString(s >>> 0);
      expect(str).toHaveLength(7);
      expect(parseSeed(str)).toBe(s >>> 0);
      expect(parseSeed(str.toLowerCase())).toBe(s >>> 0);
    }
    expect(parseSeed('12345')).toBe(12345);
    expect(parseSeed('hello darts')).toBe(parseSeed('HELLO DARTS'));
  });
});

describe('scripted bot: seed 12345 (TDD §17.1)', () => {
  it('plays to the end 1000 times with a byte-identical serialised night', () => {
    const first = playScripted(SEED);
    expect(first.status).not.toBe('ACTIVE');
    expect(first.phase).toBe('OVER');
    const json = serialiseNight(first);
    const hash = sha256(json);
    let identical = 0;
    for (let i = 1; i < 1000; i++) {
      const again = serialiseNight(playScripted(SEED));
      if (again === json) identical++;
      else expect(again).toBe(json);
    }
    expect(identical).toBe(999);
    console.log(`seed 12345 scripted night sha256 = ${hash} (${json.length} bytes, ${first.status} at leg ${first.legIndex + 1})`);
  });

  it('the scripted bot never consumes the night RNG when choosing', () => {
    const n = startNight(SEED);
    const before = n.rng.s;
    for (let i = 0; i < 20; i++) botPickCard(n, currentLeg(n));
    smartPickCard(n, currentLeg(n));
    expect(n.rng.s).toBe(before);
  });

  it('a night is a pure function of seed and inputs: replaying the recorded input script reproduces it', () => {
    const script: string[] = [];
    const n = startNight(SEED);
    while (n.status === 'ACTIVE' && n.phase === 'LEG') {
      const c = botPickCard(n, currentLeg(n));
      script.push(c.id);
      commitCard(n, c.id);
      if (script.length > 60) break;
    }
    const m = startNight(SEED);
    for (const id of script) commitCard(m, id);
    expect(serialiseNight(m)).toBe(serialiseNight(n));
  });
});

describe('scripted bot: fifty random seeds', () => {
  const seeds = random50();

  it('50 distinct seeds', () => {
    expect(new Set(seeds).size).toBe(50);
  });

  it('each seed played three times is identical every time', () => {
    for (const seed of seeds) {
      const a = serialiseNight(playScripted(seed));
      const b = serialiseNight(playScripted(seed));
      const c = serialiseNight(playScripted(seed));
      expect(b, `seed ${seed}`).toBe(a);
      expect(c, `seed ${seed}`).toBe(a);
    }
  });

  it('different seeds produce different nights', () => {
    const hashes = new Set<string>();
    for (const seed of seeds) hashes.add(sha256(serialiseNight(playScripted(seed))));
    expect(hashes.size).toBe(50);
    expect(serialiseNight(playScripted(1))).not.toBe(serialiseNight(playScripted(2)));
  });

  it('the seed is stored as a uint32 and the first deal depends on it', () => {
    const a = startNight(1);
    const b = startNight(2);
    expect(a.seed).toBe(1);
    expect(b.seed).toBe(2);
    expect(createNight(-1).seed).toBe(0xffffffff);
    expect(currentLeg(a).deck.map((c) => c.defId)).not.toEqual(currentLeg(b).deck.map((c) => c.defId));
  });
});

describe('snapshot replay (serialiseNight / deserialiseNight)', () => {
  it('serialise → deserialise is a deep round trip', () => {
    const n = startNight(SEED);
    continueScripted(n, (s) => s.stats.throwsMade >= 5);
    const copy = deserialiseNight(serialiseNight(n));
    expect(copy).toEqual(n);
    expect(serialiseNight(copy)).toBe(serialiseNight(n));
  });

  it('a mid-leg snapshot continues identically to the uninterrupted run', () => {
    const full = serialiseNight(playScripted(SEED));
    const live = startNight(SEED);
    continueScripted(live, (s) => s.stats.throwsMade >= 7);
    expect(live.status).toBe('ACTIVE');
    const snapshot = serialiseNight(live);
    const resumed = deserialiseNight(snapshot);
    continueScripted(resumed);
    continueScripted(live);
    expect(serialiseNight(resumed)).toBe(full);
    expect(serialiseNight(live)).toBe(full);
  });

  it('a snapshot taken in the shop continues identically', () => {
    const chalk = DEEP_CHALK;
    const full = serialiseNight(playSmart(SEED, chalk));
    const live = startNight(SEED, 'local', chalk);
    continueScripted(live, (s) => s.phase === 'SHOP', true);
    expect(live.phase).toBe('SHOP');
    expect(live.shop).not.toBeNull();
    const resumed = deserialiseNight(serialiseNight(live));
    continueScripted(resumed, undefined, true);
    expect(serialiseNight(resumed)).toBe(full);
  });

  it('a snapshot from a later leg of the deep run continues identically', () => {
    const chalk = DEEP_CHALK;
    const reference = playSmart(SEED, chalk);
    expect(reference.legIndex).toBeGreaterThanOrEqual(2);
    const full = serialiseNight(reference);
    const live = startNight(SEED, 'local', chalk);
    continueScripted(live, (s) => s.legIndex >= 2 && s.phase === 'LEG' && currentLeg(s).visits.length >= 2, true);
    expect(live.legIndex).toBeGreaterThanOrEqual(2);
    const resumed = deserialiseNight(serialiseNight(live));
    continueScripted(resumed, undefined, true);
    expect(serialiseNight(resumed)).toBe(full);
  });

  it('every intermediate snapshot of the deep run resumes to the same end state', () => {
    const chalk = DEEP_CHALK;
    const full = serialiseNight(playSmart(SEED, chalk));
    const live = startNight(SEED, 'local', chalk);
    let checks = 0;
    while (live.status === 'ACTIVE') {
      continueScripted(live, (s) => s.stats.throwsMade % 9 === 0 && s.stats.throwsMade > 0 && s.phase === 'LEG', true);
      if (live.status !== 'ACTIVE') break;
      const resumed = deserialiseNight(serialiseNight(live));
      continueScripted(resumed, undefined, true);
      expect(serialiseNight(resumed)).toBe(full);
      checks++;
      // step past the stop condition
      if (live.phase === 'LEG') commitCard(live, smartPickCard(live, currentLeg(live)).id);
    }
    expect(checks).toBeGreaterThan(2);
  });
});

describe('checkout-aware deep run with wired (the RNG-consuming chalk)', () => {
  it('reaches at least leg 3, deflects darts, buys in the shop, and is identical across 25 runs', () => {
    const first = playSmart(SEED, DEEP_CHALK);
    expect(first.legIndex).toBeGreaterThanOrEqual(2);
    const deflections = first.legs.flatMap((l) => l.visits).flatMap((v) => v.throws).filter((t) => t.deflected).length;
    expect(deflections).toBeGreaterThan(0);
    expect(first.stats.cardsBought + first.stats.potSpent).toBeGreaterThan(0);
    const json = serialiseNight(first);
    for (let i = 0; i < 25; i++) expect(serialiseNight(playSmart(SEED, DEEP_CHALK))).toBe(json);
    console.log(`seed 12345 deep (wired) night sha256 = ${sha256(json)} (${first.status} at leg ${first.legIndex + 1}, ${deflections} deflections)`);
  });

  it('ten seeds × three runs of the deep configuration are identical', () => {
    for (let seed = 100; seed < 110; seed++) {
      const a = serialiseNight(playSmart(seed, DEEP_CHALK));
      expect(serialiseNight(playSmart(seed, DEEP_CHALK)), `seed ${seed}`).toBe(a);
      expect(serialiseNight(playSmart(seed, DEEP_CHALK)), `seed ${seed}`).toBe(a);
    }
  });

  it('the same seed on a different oche is a different night; the same oche is the same night', () => {
    const local = serialiseNight(playScripted(SEED, 'local'));
    expect(serialiseNight(playScripted(SEED, 'local'))).toBe(local);
    expect(serialiseNight(playScripted(SEED, 'sharp'))).not.toBe(local);
    expect(serialiseNight(playScripted(SEED, 'thin'))).not.toBe(local);
  });
});

describe('the balance bots (src/core/bot.ts) are deterministic too', () => {
  function drive(seed: number, policy: 'greedy' | 'checkout' | 'optimal'): NightState {
    const n = createNight(seed);
    beginLeg(n);
    let guard = 0;
    while (n.status === 'ACTIVE' && guard++ < 5000) {
      if (n.phase === 'LEG') commitCard(n, chooseCard(n, currentLeg(n), policy).id);
      else break; // stop at the first shop: the shop policy is bot.ts's own business
    }
    return n;
  }

  it.each(['greedy', 'checkout', 'optimal'] as const)('%s policy: three runs of seed 12345 agree and never touch the RNG when choosing', (policy) => {
    const a = serialiseNight(drive(SEED, policy));
    expect(serialiseNight(drive(SEED, policy))).toBe(a);
    expect(serialiseNight(drive(SEED, policy))).toBe(a);
    const n = startNight(SEED);
    const before = n.rng.s;
    chooseCard(n, currentLeg(n), policy);
    expect(n.rng.s).toBe(before);
  });
});
