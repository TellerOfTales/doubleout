import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/sfx.ts';
import { SFX_DEFS, SFX_NAMES, chalkChainSemitones, defDuration, layerDuration } from '../src/audio/defs.ts';
import type { SfxLayer, SfxName } from '../src/audio/defs.ts';
import { blipParams, VOICES } from '../src/audio/voice.ts';
import { createRng } from '../src/core/rng.ts';
import type { AudioContextLike } from '../src/audio/synth.ts';

// ---------------------------------------------------------------------------
// A minimal fake AudioContext that records node construction and scheduling.

interface Scheduled { op: string; value: number; time: number }

class FakeParam {
  value = 0;
  events: Scheduled[] = [];
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v: number, t: number) { this.events.push({ op: 'set', value: v, time: t }); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push({ op: 'lin', value: v, time: t }); return this; }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (!(v > 0)) throw new Error('exponential ramp to non-positive value');
    this.events.push({ op: 'exp', value: v, time: t });
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) { this.events.push({ op: 'target', value: v, time: t }); void tc; return this; }
  cancelScheduledValues(t: number) { this.events.push({ op: 'cancel', value: 0, time: t }); return this; }
}

class FakeNode {
  connections: unknown[] = [];
  constructor(readonly kind: string, readonly ctx: FakeContext) { ctx.nodes.push(this); }
  connect(d: unknown) { this.connections.push(d); return d; }
  disconnect() { this.connections = []; }
}

class FakeGain extends FakeNode { gain = new FakeParam(1); }

class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  started: number[] = [];
  stopped: number[] = [];
  periodic: unknown;
  onended: ((this: unknown, ev: unknown) => unknown) | null = null;
  start(t = 0) { this.started.push(t); this.ctx.starts++; }
  stop(t = 0) { this.stopped.push(t); }
  setPeriodicWave(w: unknown) { this.periodic = w; }
}

class FakeBufferSource extends FakeNode {
  buffer: { sampleRate: number; length: number; getChannelData(c: number): Float32Array } | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  started: number[] = [];
  stopped: number[] = [];
  onended: ((this: unknown, ev: unknown) => unknown) | null = null;
  start(t = 0) { this.started.push(t); this.ctx.starts++; }
  stop(t = 0) { this.stopped.push(t); }
}

class FakeBiquad extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}

class FakeContext implements AudioContextLike {
  currentTime = 0;
  sampleRate = 44100;
  state = 'running';
  destination: FakeNode;
  nodes: FakeNode[] = [];
  starts = 0;
  resumeCalls = 0;
  constructor(state = 'running') {
    this.state = state;
    this.destination = new FakeNode('destination', this);
    this.nodes.length = 0;
  }
  createGain() { return new FakeGain('gain', this); }
  createOscillator() { return new FakeOsc('osc', this); }
  createBufferSource() { return new FakeBufferSource('buffer', this); }
  createBiquadFilter() { return new FakeBiquad('biquad', this); }
  createDynamicsCompressor() { return new FakeCompressor('compressor', this); }
  createPeriodicWave(real: Float32Array, imag: Float32Array) { return { real, imag }; }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { sampleRate, length, getChannelData: () => data, channels };
  }
  resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
  of<T extends FakeNode>(kind: string): T[] { return this.nodes.filter((n) => n.kind === kind) as T[]; }
}

function engineWith(ctx: FakeContext): AudioEngine {
  const e = new AudioEngine({ contextFactory: () => ctx });
  e.unlock();
  return e;
}

// ---------------------------------------------------------------------------

describe('defs', () => {
  it('defines every SfxName with sane parameters', () => {
    const names: SfxName[] = [
      'throw', 'thud', 'wire', 'card_deal', 'card_select', 'chalk_fire', 'bust', 'checkout', 'one_eighty', 'crowd_roar',
      'ui_move', 'ui_confirm', 'ui_back', 'pot', 'shop_buy', 'shop_refresh', 'tick', 'whoosh', 'error', 'unlock',
      'win_fanfare', 'lose_sting', 'card_flip',
    ];
    expect(new Set(SFX_NAMES)).toEqual(new Set(names));
    for (const name of names) {
      const def = SFX_DEFS[name];
      expect(def, name).toBeDefined();
      const layers: SfxLayer[] = [def, ...(def.layers ?? [])];
      for (const l of layers) {
        expect(l.volume, `${name} volume`).toBeGreaterThan(0);
        expect(l.volume, `${name} volume`).toBeLessThanOrEqual(1);
        expect(layerDuration(l), `${name} duration`).toBeGreaterThan(0.004);
        if (l.wave !== 'noise') expect(l.freq, `${name} freq`).toBeGreaterThan(20);
      }
      const d = defDuration(def);
      expect(d).toBeGreaterThan(0);
      expect(d, `${name} too long`).toBeLessThan(2.5);
    }
  });

  it('keeps thud short and rounded (no fatigue on repetition)', () => {
    const thud = SFX_DEFS.thud;
    expect(defDuration(thud)).toBeLessThan(0.2);
    expect(thud.lpf).toBeLessThanOrEqual(1200);
    expect(thud.jitter).toBeGreaterThan(0);
    expect(thud.freq).toBeLessThan(220);
  });

  it('chalk chain semitones rise strictly on a pentatonic', () => {
    let prev = -1;
    for (let i = 0; i < 15; i++) {
      const s = chalkChainSemitones(i);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
    expect(chalkChainSemitones(5)).toBe(12);
  });
});

describe('AudioEngine without an AudioContext', () => {
  it('constructs, is not ready, and every public method is a silent no-op', () => {
    const e = new AudioEngine({ contextFactory: () => undefined });
    expect(e.ready).toBe(false);
    expect(() => {
      e.unlock();
      e.unlock();
      for (const n of SFX_NAMES) e.play(n, { pitch: 1.2, volume: 0.5, delay: 10 });
      e.chalkFire(3);
      e.setCrowdTension(0.5);
      e.crowdRoar(1);
      e.setMasterVolume(0.5);
      e.setSfxVolume(0.5);
      e.setVoiceVolume(0.5);
      e.setMuted(true);
      e.setMuted(false);
    }).not.toThrow();
    expect(e.ready).toBe(false);
    expect(e.muted).toBe(false);
  });

  it('blip() still returns reveal timings without audio', () => {
    const e = new AudioEngine({ contextFactory: () => undefined });
    expect(e.blip('BARREL', 'a')).toBe(18);
    expect(e.blip('NOCK', 'k')).toBe(34);
    expect(e.blip('BARREL', ',')).toBe(120);
    expect(e.blip('NOCK', '.')).toBe(220);
  });

  it('default constructor never throws even if the platform factory throws', () => {
    const e = new AudioEngine({ contextFactory: () => { throw new Error('nope'); } });
    expect(() => e.unlock()).not.toThrow();
    expect(() => e.play('thud')).not.toThrow();
    expect(e.ready).toBe(false);
  });

  it('never throws when a context method throws mid-play', () => {
    const ctx = new FakeContext();
    const e = engineWith(ctx);
    ctx.createOscillator = () => { throw new Error('boom'); };
    expect(() => e.play('checkout')).not.toThrow();
    expect(() => e.chalkFire(2)).not.toThrow();
    expect(() => e.blip('BARREL', 'a')).not.toThrow();
  });
});

describe('AudioEngine with a fake AudioContext', () => {
  it('unlock builds the master graph and resumes a suspended context', () => {
    const ctx = new FakeContext('suspended');
    const e = new AudioEngine({ contextFactory: () => ctx });
    e.unlock();
    expect(e.ready).toBe(true);
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.of('compressor').length).toBe(1);
    expect(ctx.destination.connections.length).toBe(0);
    const comp = ctx.of<FakeCompressor>('compressor')[0];
    expect(comp.connections).toContain(ctx.destination);
    // Suspended again after a visibility change: the next unlock resumes it.
    ctx.state = 'suspended';
    e.unlock();
    expect(ctx.resumeCalls).toBe(2);
    expect(ctx.state).toBe('running');
  });

  it('play() of every SfxName starts at least one source and schedules a gain envelope', () => {
    for (const name of SFX_NAMES) {
      const ctx = new FakeContext();
      const e = engineWith(ctx);
      const before = ctx.starts;
      const gainsBefore = ctx.of<FakeGain>('gain').length;
      e.play(name);
      expect(ctx.starts, `${name} started a source`).toBeGreaterThan(before);
      const gains = ctx.of<FakeGain>('gain').slice(gainsBefore);
      const scheduled = gains.some((g) => g.gain.events.some((ev) => ev.op === 'lin' || ev.op === 'exp'));
      expect(scheduled, `${name} scheduled an envelope`).toBe(true);
      // Every started source is also stopped.
      for (const o of ctx.of<FakeOsc>('osc')) expect(o.stopped.length, `${name} osc stop`).toBe(o.started.length);
      for (const b of ctx.of<FakeBufferSource>('buffer')) expect(b.stopped.length, `${name} noise stop`).toBe(b.started.length);
    }
  });

  it('respects pitch, volume and delay options', () => {
    const ctx = new FakeContext();
    ctx.currentTime = 2;
    const e = engineWith(ctx);
    e.play('ui_move', { pitch: 2, volume: 0.5, delay: 250 });
    const osc = ctx.of<FakeOsc>('osc')[0];
    const first = osc.frequency.events[0];
    expect(first.value).toBeCloseTo(SFX_DEFS.ui_move.freq * 2, 3);
    expect(first.time).toBeCloseTo(2.25, 6);
    expect(osc.started[0]).toBeCloseTo(2.25, 6);
    const env = ctx.of<FakeGain>('gain').find((g) => g.gain.events.some((ev) => ev.op === 'lin')) as FakeGain;
    const peak = env.gain.events.find((ev) => ev.op === 'lin') as Scheduled;
    expect(peak.value).toBeCloseTo(SFX_DEFS.ui_move.volume * 0.5, 6);
  });

  it('uses a band-limited pulse wave for non-50% duty squares', () => {
    const ctx = new FakeContext();
    const e = engineWith(ctx);
    e.play('chalk_fire');
    const osc = ctx.of<FakeOsc>('osc')[0];
    expect(osc.periodic).toBeDefined();
  });

  it('chalkFire(i) pitch strictly rises with i', () => {
    const ctx = new FakeContext();
    const e = engineWith(ctx);
    let prev = 0;
    for (let i = 0; i < 12; i++) {
      const n = ctx.of<FakeOsc>('osc').length;
      e.chalkFire(i);
      const osc = ctx.of<FakeOsc>('osc')[n];
      const f = osc.frequency.events[0].value;
      expect(f, `chain ${i}`).toBeGreaterThan(prev);
      prev = f;
    }
    // Five steps up is exactly one octave.
    const oscs = ctx.of<FakeOsc>('osc');
    const f0 = oscs[0].frequency.events[0].value;
    const perCall = oscs.length / 12;
    const f5 = oscs[5 * perCall].frequency.events[0].value;
    expect(f5 / f0).toBeCloseTo(2, 4);
  });

  it('limits polyphony by stealing the oldest voice', () => {
    const ctx = new FakeContext();
    const e = engineWith(ctx);
    for (let i = 0; i < 40; i++) e.play('ui_move');
    expect(e.activeVoices).toBeLessThanOrEqual(24);
    const oscs = ctx.of<FakeOsc>('osc');
    // The earliest oscillators were stopped early (at now + 0.03) by the steal.
    expect(oscs[0].stopped.some((t) => t < 0.05)).toBe(true);
    // Most recent one is untouched.
    expect(oscs[oscs.length - 1].stopped.every((t) => t > 0.03)).toBe(true);
  });

  it('crowd bed starts lazily and follows tension with smoothing', () => {
    const ctx = new FakeContext();
    const e = engineWith(ctx);
    e.setCrowdTension(0);
    expect(ctx.of<FakeBufferSource>('buffer').length).toBe(0);
    e.setCrowdTension(0.5);
    const beds = ctx.of<FakeBufferSource>('buffer');
    expect(beds.length).toBe(1);
    expect(beds[0].loop).toBe(true);
    expect(beds[0].started.length).toBe(1);
    const lfos = ctx.of<FakeOsc>('osc');
    expect(lfos.length).toBe(2);
    const gains = ctx.of<FakeGain>('gain');
    const targets = gains.flatMap((g) => g.gain.events.filter((ev) => ev.op === 'target'));
    expect(targets.length).toBeGreaterThan(0);
    e.setCrowdTension(1);
    expect(ctx.of<FakeBufferSource>('buffer').length).toBe(1);
    const after = gains.flatMap((g) => g.gain.events.filter((ev) => ev.op === 'target'));
    expect(after[after.length - 1].value).toBeGreaterThan(targets[targets.length - 1].value);
  });

  it('crowdRoar scales with intensity', () => {
    const quiet = new FakeContext();
    engineWith(quiet).crowdRoar(0.1);
    const loud = new FakeContext();
    engineWith(loud).crowdRoar(1);
    const peakOf = (c: FakeContext) => Math.max(...c.of<FakeGain>('gain').flatMap((g) => g.gain.events.filter((ev) => ev.op === 'lin').map((ev) => ev.value)));
    expect(peakOf(loud)).toBeGreaterThan(peakOf(quiet));
    expect(loud.starts).toBeGreaterThan(quiet.starts);
  });

  it('mute and volume controls schedule bus gains and mute stops one-shots', () => {
    const ctx = new FakeContext();
    const e = engineWith(ctx);
    e.setMuted(true);
    expect(e.muted).toBe(true);
    const before = ctx.starts;
    e.play('thud');
    expect(ctx.starts).toBe(before);
    e.setMuted(false);
    e.play('thud');
    expect(ctx.starts).toBeGreaterThan(before);
    e.setMasterVolume(0.3);
    e.setSfxVolume(0.6);
    e.setVoiceVolume(0.9);
    const targets = ctx.of<FakeGain>('gain').flatMap((g) => g.gain.events.filter((ev) => ev.op === 'target').map((ev) => ev.value));
    expect(targets).toContain(0.3);
    expect(targets).toContain(0.6);
    expect(targets).toContain(0.9);
  });

  it('blip() plays a tone through the voice bus with the specified timings', () => {
    const ctx = new FakeContext();
    const e = engineWith(ctx);
    expect(e.blip('BARREL', 'h')).toBe(18);
    expect(ctx.of<FakeOsc>('osc').length).toBe(1);
    expect(ctx.of<FakeOsc>('osc')[0].type).toBe('square');
    expect(e.blip('NOCK', 'n')).toBe(34);
    expect(ctx.of<FakeOsc>('osc')[1].type).toBe('triangle');
    const n = ctx.of<FakeOsc>('osc').length;
    expect(e.blip('BARREL', ' ')).toBe(36);
    expect(e.blip('BARREL', ',')).toBe(120);
    expect(e.blip('BARREL', '.')).toBe(220);
    expect(e.blip('NOCK', '!')).toBe(220);
    expect(e.blip('NOCK', '?')).toBe(220);
    expect(ctx.of<FakeOsc>('osc').length).toBe(n);
  });
});

describe('blipParams', () => {
  it('jitter stays within the specified range and is deterministic', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 200; i++) {
      const pa = blipParams('BARREL', 'b', a);
      const pb = blipParams('BARREL', 'b', b);
      expect(pa.tone?.freq).toBe(pb.tone?.freq);
      expect(Math.abs((pa.tone?.freq ?? 0) - VOICES.BARREL.baseHz)).toBeLessThanOrEqual(VOICES.BARREL.jitterHz + 0.001);
    }
    for (let i = 0; i < 200; i++) {
      const p = blipParams('NOCK', 't', a);
      expect(Math.abs((p.tone?.freq ?? 0) - VOICES.NOCK.baseHz)).toBeLessThanOrEqual(VOICES.NOCK.jitterHz + 0.001);
    }
  });

  it('vowels are longer and higher than consonants', () => {
    const r = createRng(1);
    const cons = blipParams('BARREL', 't', createRng(1));
    const vow = blipParams('BARREL', 'a', createRng(1));
    void r;
    expect(vow.tone!.durationMs).toBeGreaterThan(cons.tone!.durationMs);
    expect(vow.tone!.freq).toBeGreaterThan(cons.tone!.freq);
    expect(vow.gapMs).toBe(18);
  });
});
