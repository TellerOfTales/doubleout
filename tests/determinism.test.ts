/**
 * TDD §8 / §17.1 — determinism. Same seed + same inputs → identical night.
 *
 * The inputs are richer than they were: free aim means a dart is a target, and
 * a visit also carries the contracts taken, banked, pressed and pulled, and the
 * interventions spent out of the kit. All of it is recorded as a script of
 * plain data (`ScriptStep`), so "the same inputs" is a thing that can be
 * written down and replayed rather than a thing a bot re-decides.
 *
 * A scripted bot replays seed 12345 a thousand times; fifty random seeds
 * thrice; snapshots deserialised mid-night continue identically; different
 * seeds differ; and a deeper run holding `wired` — the only chalk that
 * consumes the gameplay RNG — does the same while spending the kit and
 * pressing contracts.
 */
import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextInt, parseSeed, seedToString, shuffle } from '../src/core/rng.ts';
import { createNight, currentLeg, deserialiseNight, serialiseNight } from '../src/core/state.ts';
import type { NightState, OcheId } from '../src/core/types.ts';
import { applyScript, botTarget, continueScripted, playDeep, playScripted, sha256, startNight, type ScriptStep } from './helpers.ts';

const SEED = 12345;
/** A night that plays the real odds: determinism has to hold with the aim roll in the RNG order. */
const aimNight = (seed: number, oche: OcheId = 'local', chalk: string[] = []) => startNight(seed, oche, chalk, false);
const DEEP_CHALK = ['straight_out', 'overshoot', 'wide_grip', 'wired'];
/**
 * The deep run's seed: the one whose greedy night reaches the last leg,
 * deflects darts on `wired`, presses a contract and spends in every shop, so
 * one replay exercises every consumer of the gameplay RNG at once.
 */
const DEEP_SEED = 13;

function random50(): number[] {
  const r = createRng(0xd00b1e);
  const out: number[] = [];
  while (out.length < 50) {
    const s = Math.floor(nextFloat(r) * 0x100000000) >>> 0;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Play a night, recording every input it was given. */
function record(seed: number, chalk: string[] = [], deep = false): { night: NightState; script: ScriptStep[] } {
  const script: ScriptStep[] = [];
  const night = continueScripted(aimNight(seed, 'local', chalk), { deep, log: script });
  return { night, script };
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
    console.log(`seed ${SEED} scripted night sha256 = ${hash} (${json.length} bytes, ${first.status} at leg ${first.legIndex + 1})`);
  });

  it('the night that replays covers the slate and the kit, not just the darts', () => {
    const first = playScripted(SEED);
    expect(first.stats.throwsMade).toBeGreaterThan(30);
    expect(first.stats.contractsTaken).toBeGreaterThan(5);
    expect(first.stats.contractsPaid).toBeGreaterThan(0);
    expect(first.stats.potStaked).toBeGreaterThan(0);
    expect(first.legs.some((l) => l.ledger.length > 0)).toBe(true);
    const json = serialiseNight(first);
    expect(json).toContain('"kit"');
    expect(json).toContain('"paid"');
    expect(json).toContain('"ledger"');
    expect(json).toContain('"settled"');
  });

  it('the scripted bot never consumes the night RNG when choosing', () => {
    const n = aimNight(SEED);
    const before = n.rng.s;
    for (let i = 0; i < 20; i++) botTarget(n, currentLeg(n));
    expect(n.rng.s).toBe(before);
  });

  it('a night is a pure function of its seed and its inputs: the recorded script reproduces it', () => {
    const { night, script } = record(SEED);
    expect(script.length).toBeGreaterThan(40);
    expect(script.some((s) => s.kind === 'TAKE')).toBe(true);
    expect(script.some((s) => s.kind === 'THROW')).toBe(true);
    expect(script.some((s) => s.kind === 'TAKE')).toBe(true);
    const replayed = applyScript(aimNight(SEED), script);
    expect(serialiseNight(replayed)).toBe(serialiseNight(night));
  });

  it('the same darts on a different seed land differently: the roll is the seed’s, not the script’s', () => {
    const darts = record(SEED).script.filter((s) => s.kind === 'THROW').slice(0, 12);
    const play = (seed: number): string => {
      const n = aimNight(seed);
      for (const d of darts) {
        if (n.status !== 'ACTIVE' || n.phase !== 'LEG') break;
        applyScript(n, [d]);
      }
      return serialiseNight(n);
    };
    expect(play(SEED + 1)).not.toBe(play(SEED));
    expect(play(SEED)).toBe(play(SEED));
  });

  it('nothing in a night depends on Math.random', () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error('game logic must not use Math.random (TDD §8)');
    };
    try {
      expect(serialiseNight(playScripted(SEED))).toBe(serialiseNight(playScripted(SEED)));
    } finally {
      Math.random = real;
    }
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

  it('the seed is stored as a uint32 and the first slate depends on it', () => {
    const a = aimNight(1);
    const b = aimNight(2);
    expect(a.seed).toBe(1);
    expect(b.seed).toBe(2);
    expect(createNight(-1).seed).toBe(0xffffffff);
    const offers = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) offers.add(currentLeg(aimNight(seed)).offer.join(','));
    expect(offers.size).toBeGreaterThan(1);
  });
});

describe('snapshot replay (serialiseNight / deserialiseNight)', () => {
  it('serialise → deserialise is a deep round trip', () => {
    const n = aimNight(SEED);
    continueScripted(n, { stopWhen: (s) => s.stats.throwsMade >= 5 });
    const copy = deserialiseNight(serialiseNight(n));
    expect(copy).toEqual(n);
    expect(serialiseNight(copy)).toBe(serialiseNight(n));
  });

  it('a mid-leg snapshot continues identically to the uninterrupted run', () => {
    const full = serialiseNight(playScripted(SEED));
    const live = aimNight(SEED);
    continueScripted(live, { stopWhen: (s) => s.stats.throwsMade >= 7 });
    expect(live.status).toBe('ACTIVE');
    const resumed = deserialiseNight(serialiseNight(live));
    continueScripted(resumed);
    continueScripted(live);
    expect(serialiseNight(resumed)).toBe(full);
    expect(serialiseNight(live)).toBe(full);
  });

  it('a snapshot taken mid-visit, with contracts riding, continues identically', () => {
    const full = serialiseNight(playScripted(SEED));
    const live = aimNight(SEED);
    continueScripted(live, { stopWhen: (s) => s.phase === 'LEG' && currentLeg(s).slate.some((c) => !c.settled) });
    expect(currentLeg(live).slate.some((c) => !c.settled)).toBe(true);
    const resumed = deserialiseNight(serialiseNight(live));
    expect(currentLeg(resumed).slate).toEqual(currentLeg(live).slate);
    continueScripted(resumed);
    expect(serialiseNight(resumed)).toBe(full);
  });

  it('a snapshot taken in the shop continues identically', () => {
    const full = serialiseNight(playDeep(DEEP_SEED, DEEP_CHALK));
    const live = aimNight(DEEP_SEED, 'local', DEEP_CHALK);
    continueScripted(live, { stopWhen: (s) => s.phase === 'SHOP', deep: true });
    expect(live.phase).toBe('SHOP');
    expect(live.shop).not.toBeNull();
    const resumed = deserialiseNight(serialiseNight(live));
    continueScripted(resumed, { deep: true });
    expect(serialiseNight(resumed)).toBe(full);
  });

  it('a snapshot from a later leg of the deep run continues identically', () => {
    const reference = playDeep(DEEP_SEED, DEEP_CHALK);
    expect(reference.legIndex).toBeGreaterThanOrEqual(2);
    const full = serialiseNight(reference);
    const live = aimNight(DEEP_SEED, 'local', DEEP_CHALK);
    continueScripted(live, { stopWhen: (s) => s.legIndex >= 2 && s.phase === 'LEG' && currentLeg(s).visits.length >= 2, deep: true });
    expect(live.legIndex).toBeGreaterThanOrEqual(2);
    const resumed = deserialiseNight(serialiseNight(live));
    continueScripted(resumed, { deep: true });
    expect(serialiseNight(resumed)).toBe(full);
  });

  it('every intermediate snapshot of the deep run resumes to the same end state', () => {
    const full = serialiseNight(playDeep(DEEP_SEED, DEEP_CHALK));
    const live = aimNight(DEEP_SEED, 'local', DEEP_CHALK);
    let checks = 0;
    for (let next = 9; live.status === 'ACTIVE'; next += 9) {
      continueScripted(live, { stopWhen: (s) => s.stats.throwsMade >= next && s.phase === 'LEG', deep: true });
      if (live.status !== 'ACTIVE') break;
      const resumed = deserialiseNight(serialiseNight(live));
      continueScripted(resumed, { deep: true });
      expect(serialiseNight(resumed), `resumed at ${live.stats.throwsMade} darts`).toBe(full);
      checks++;
    }
    expect(checks).toBeGreaterThan(2);
  });
});

describe('the deep run: wired, the kit and the press', () => {
  it('deflects darts, spends the kit, presses contracts, and is identical across 25 runs', () => {
    const first = playDeep(DEEP_SEED, DEEP_CHALK);
    const throws = first.legs.flatMap((l) => l.visits).flatMap((v) => v.throws);
    const deflections = throws.filter((t) => t.deflected).length;
    expect(first.legIndex).toBeGreaterThanOrEqual(2);
    expect(deflections).toBeGreaterThan(0);
    expect(first.stats.potSpent).toBeGreaterThan(0);
    expect(first.stats.contractsTaken).toBeGreaterThan(0);
    expect(first.stats.kitBought).toBeGreaterThan(0);
    expect(first.stats.contractsPressed).toBeGreaterThan(0);
    const json = serialiseNight(first);
    for (let i = 0; i < 25; i++) expect(serialiseNight(playDeep(DEEP_SEED, DEEP_CHALK))).toBe(json);
    console.log(
      `seed ${DEEP_SEED} deep (wired) night sha256 = ${sha256(json)} (${first.status} at leg ${first.legIndex + 1}, ${deflections} deflections, ${first.stats.contractsPressed} presses)`,
    );
  });

  it('the recorded script of the deep run carries its kit and press steps', () => {
    const { night, script } = record(DEEP_SEED, DEEP_CHALK, true);
    expect(script.some((s) => s.kind === 'THROW' && s.use)).toBe(true);
    expect(script.some((s) => s.kind === 'BUY')).toBe(true);
    const replayed = applyScript(aimNight(DEEP_SEED, 'local', DEEP_CHALK), script);
    expect(serialiseNight(replayed)).toBe(serialiseNight(night));
  });

  it('ten seeds × three runs of the deep configuration are identical', () => {
    for (let seed = 100; seed < 110; seed++) {
      const a = serialiseNight(playDeep(seed, DEEP_CHALK));
      expect(serialiseNight(playDeep(seed, DEEP_CHALK)), `seed ${seed}`).toBe(a);
      expect(serialiseNight(playDeep(seed, DEEP_CHALK)), `seed ${seed}`).toBe(a);
    }
  });

  it('the same seed at a different oche is a different night; the same oche is the same night', () => {
    const local = serialiseNight(playScripted(SEED, 'local'));
    expect(serialiseNight(playScripted(SEED, 'local'))).toBe(local);
    expect(serialiseNight(playScripted(SEED, 'sharp'))).not.toBe(local);
    expect(serialiseNight(playScripted(SEED, 'thin'))).not.toBe(local);
  });
});
