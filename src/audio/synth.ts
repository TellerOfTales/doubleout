/**
 * Synth core: turns an SfxLayer into a Web Audio node graph.
 *
 * Everything is typed against small structural interfaces rather than the DOM
 * `AudioContext` so the same code drives a real AudioContext in the game, an
 * OfflineAudioContext in tools/audiosmoke.ts, and a recording fake in tests.
 */
import type { SfxDef, SfxLayer, Wave } from './defs';
import { layerDuration } from './defs';

// ---------------------------------------------------------------------------
// Structural Web Audio types

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(value: number, time: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioParamLike): unknown;
  disconnect(): unknown;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface SourceNodeLike extends AudioNodeLike {
  start(when?: number): unknown;
  stop(when?: number): unknown;
  onended: ((this: unknown, ev: unknown) => unknown) | null;
}

export interface OscillatorNodeLike extends SourceNodeLike {
  type: string;
  frequency: AudioParamLike;
  detune: AudioParamLike;
  setPeriodicWave?(wave: unknown): unknown;
}

export interface AudioBufferLike {
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceNodeLike extends SourceNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  playbackRate: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  Q: AudioParamLike;
}

export interface CompressorNodeLike extends AudioNodeLike {
  threshold: AudioParamLike;
  knee: AudioParamLike;
  ratio: AudioParamLike;
  attack: AudioParamLike;
  release: AudioParamLike;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBufferSource(): BufferSourceNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createDynamicsCompressor?(): CompressorNodeLike;
  createPeriodicWave?(real: Float32Array, imag: Float32Array, constraints?: { disableNormalization?: boolean }): unknown;
  resume?(): Promise<void>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared resources per context (noise buffer, pulse waves)

export class SynthResources {
  private noise: AudioBufferLike | undefined;
  private waves = new Map<number, unknown>();

  constructor(readonly ctx: AudioContextLike) {}

  /** One second of white noise, generated once with a fixed-seed LCG. */
  noiseBuffer(): AudioBufferLike {
    if (this.noise) return this.noise;
    const sr = Math.max(8000, Math.floor(this.ctx.sampleRate) || 44100);
    const buf = this.ctx.createBuffer(1, sr, sr);
    const data = buf.getChannelData(0);
    let s = 0x9e3779b9;
    for (let i = 0; i < data.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      data[i] = s / 2147483648 - 1;
    }
    this.noise = buf;
    return buf;
  }

  /** Band-limited pulse wave with the given duty cycle (cached per 1% step). */
  pulseWave(duty: number): unknown {
    const key = Math.round(Math.min(0.95, Math.max(0.05, duty)) * 100);
    const hit = this.waves.get(key);
    if (hit) return hit;
    if (typeof this.ctx.createPeriodicWave !== 'function') return undefined;
    const d = key / 100;
    const n = 48;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) {
      real[k] = (2 * Math.sin(2 * Math.PI * k * d)) / (Math.PI * k);
      imag[k] = (2 * (1 - Math.cos(2 * Math.PI * k * d))) / (Math.PI * k);
    }
    const wave = this.ctx.createPeriodicWave(real, imag);
    this.waves.set(key, wave);
    return wave;
  }
}

// ---------------------------------------------------------------------------
// Rendering

export interface PlayedLayer {
  /** Absolute context time when the layer falls silent. */
  endTime: number;
  /** Fade out quickly (for polyphony stealing) and release the nodes. */
  kill(): void;
}

export interface LayerOptions {
  /** Absolute context time the layer starts. */
  when: number;
  /** Pitch multiplier (1 = as defined). */
  pitch?: number;
  /** Gain multiplier. */
  gain?: number;
  /** Extra semitone offset (jitter, chain index). */
  semitones?: number;
}

const MIN_FREQ = 20;
const ENV_FLOOR = 0.0005;
const STOP_MARGIN = 0.02;

function clampFreq(f: number, ctx: AudioContextLike): number {
  const nyq = (ctx.sampleRate || 44100) * 0.45;
  if (!(f > MIN_FREQ)) return MIN_FREQ;
  return f > nyq ? nyq : f;
}

function oscType(w: Wave): string {
  return w === 'saw' ? 'sawtooth' : w;
}

/**
 * Pitch curve in semitones relative to base at time t (seconds from layer start).
 * slide is linear, deltaSlide quadratic, arpeggio stepwise.
 */
function pitchOffsetAt(l: SfxLayer, t: number): number {
  let st = (l.slide ?? 0) * t + 0.5 * (l.deltaSlide ?? 0) * t * t;
  if (l.arpStep && l.arpSpeed && l.arpSpeed > 0) {
    let step = Math.floor(t / l.arpSpeed);
    if (l.arpCount && l.arpCount > 0) step %= l.arpCount;
    st += step * l.arpStep;
  }
  return st;
}

/** Schedule the frequency automation of an oscillator for a layer. */
function scheduleFrequency(ctx: AudioContextLike, param: AudioParamLike, l: SfxLayer, t0: number, dur: number, mul: number): void {
  const base = l.freq * mul;
  const f = (t: number) => clampFreq(base * Math.pow(2, pitchOffsetAt(l, t) / 12), ctx);
  const moving = !!(l.slide || l.deltaSlide);
  const arp = !!(l.arpStep && l.arpSpeed && l.arpSpeed > 0);
  param.setValueAtTime(f(0), t0);
  if (!moving && !arp) return;

  // Boundaries: a uniform grid for slides, plus a jump at every arpeggio step.
  const times: { t: number; jump: boolean }[] = [];
  if (moving) {
    const n = Math.min(64, Math.max(2, Math.ceil(dur * 100)));
    for (let i = 1; i <= n; i++) times.push({ t: (dur * i) / n, jump: false });
  }
  if (arp) {
    const speed = l.arpSpeed as number;
    for (let t = speed; t < dur; t += speed) times.push({ t, jump: true });
    if (!moving) times.push({ t: dur, jump: false });
  }
  times.sort((a, b) => a.t - b.t || (a.jump ? -1 : 1));
  let last = -1;
  for (const b of times) {
    if (b.t <= last + 1e-6 && !b.jump) continue;
    last = b.t;
    if (b.jump) param.setValueAtTime(f(b.t), t0 + b.t);
    else param.exponentialRampToValueAtTime(f(b.t), t0 + b.t);
  }
}

/** Schedule the amplitude envelope. Returns the time the envelope reaches silence. */
function scheduleEnvelope(param: AudioParamLike, l: SfxLayer, t0: number, peak: number): number {
  const a = Math.max(0.0005, l.attack);
  const s = Math.max(0, l.sustain);
  const d = Math.max(0.002, l.decay);
  const decayTo = Math.min(1, Math.max(0, l.decayTo ?? 0));
  const rel = decayTo > 0 ? Math.max(0.002, l.release ?? 0.01) : 0;
  const p = Math.max(ENV_FLOOR, peak);

  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(p, t0 + a);
  let t = t0 + a + s;
  if (s > 0) param.setValueAtTime(p, t);
  const floor = Math.max(ENV_FLOOR, decayTo * p);
  param.exponentialRampToValueAtTime(floor, t + d);
  t += d;
  if (decayTo > 0) {
    param.setValueAtTime(floor, t);
    param.exponentialRampToValueAtTime(ENV_FLOOR, t + rel);
    t += rel;
  }
  param.setValueAtTime(0, t);
  return t;
}

/**
 * Build and start the node graph for one layer:
 *   [osc | noise] (+ noise mix) → hpf? → bpf? → lpf? → envelope gain → dest
 */
export function playLayer(res: SynthResources, dest: AudioNodeLike, l: SfxLayer, o: LayerOptions): PlayedLayer {
  const ctx = res.ctx;
  const t0 = o.when;
  const dur = layerDuration(l);
  const pitchMul = (o.pitch ?? 1) * Math.pow(2, (o.semitones ?? 0) / 12);
  const peak = Math.min(1, Math.max(0, l.volume * (o.gain ?? 1)));
  const stopAt = t0 + dur + STOP_MARGIN;

  const env = ctx.createGain();
  const nodes: AudioNodeLike[] = [env];
  const sources: SourceNodeLike[] = [];

  // Filters, innermost first so we can chain toward the envelope.
  let input: AudioNodeLike = env;
  if (l.lpf) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = l.lpfQ ?? 0.7;
    const start = clampFreq(l.lpf, ctx);
    lp.frequency.setValueAtTime(start, t0);
    if (l.lpfSweep) lp.frequency.exponentialRampToValueAtTime(clampFreq(start * Math.pow(2, l.lpfSweep * dur), ctx), t0 + dur);
    lp.connect(input);
    input = lp;
    nodes.push(lp);
  }
  if (l.bpf) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = l.bpfQ ?? 1;
    bp.frequency.value = clampFreq(l.bpf, ctx);
    bp.connect(input);
    input = bp;
    nodes.push(bp);
  }
  if (l.hpf) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.Q.value = 0.7;
    hp.frequency.value = clampFreq(l.hpf, ctx);
    hp.connect(input);
    input = hp;
    nodes.push(hp);
  }

  // Tonal source.
  if (l.wave !== 'noise') {
    const osc = ctx.createOscillator();
    if (l.wave === 'square' && l.duty !== undefined && Math.abs(l.duty - 0.5) > 0.005 && typeof osc.setPeriodicWave === 'function') {
      const wave = res.pulseWave(l.duty);
      if (wave) osc.setPeriodicWave(wave);
      else osc.type = 'square';
    } else {
      osc.type = oscType(l.wave);
    }
    scheduleFrequency(ctx, osc.frequency, l, t0, dur, pitchMul);
    if (l.vibratoDepth && l.vibratoSpeed) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = l.vibratoSpeed;
      const depth = ctx.createGain();
      depth.gain.value = l.vibratoDepth * 100; // cents
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(t0);
      lfo.stop(stopAt);
      sources.push(lfo);
      nodes.push(depth);
    }
    osc.connect(input);
    osc.start(t0);
    osc.stop(stopAt);
    sources.push(osc);
  }

  // Noise source (the whole layer, or a mix).
  const noiseMix = l.wave === 'noise' ? 1 : Math.min(1, Math.max(0, l.noise ?? 0));
  if (noiseMix > 0) {
    const src = ctx.createBufferSource();
    src.buffer = res.noiseBuffer();
    src.loop = true;
    let into: AudioNodeLike = input;
    if (noiseMix < 1) {
      const g = ctx.createGain();
      g.gain.value = noiseMix;
      g.connect(input);
      into = g;
      nodes.push(g);
    }
    src.connect(into);
    src.start(t0);
    src.stop(stopAt);
    sources.push(src);
  }

  const endTime = scheduleEnvelope(env.gain, l, t0, peak);
  env.connect(dest);

  let dead = false;
  const cleanup = () => {
    if (dead) return;
    dead = true;
    for (const n of nodes) try { n.disconnect(); } catch { /* already gone */ }
    for (const s of sources) try { s.disconnect(); } catch { /* already gone */ }
  };
  const last = sources[sources.length - 1];
  if (last) last.onended = cleanup;

  return {
    endTime,
    kill() {
      if (dead) return;
      try {
        const now = ctx.currentTime;
        env.gain.cancelScheduledValues(now);
        env.gain.setTargetAtTime(0, now, 0.004);
        for (const s of sources) s.stop(now + 0.03);
      } catch { /* best effort */ }
    },
  };
}

/** Play a full definition (primary layer + sub-layers). */
export function playDef(res: SynthResources, dest: AudioNodeLike, def: SfxDef, o: LayerOptions, jitterSemis: (l: SfxLayer) => number): PlayedLayer[] {
  const out: PlayedLayer[] = [];
  const all: SfxLayer[] = [def, ...(def.layers ?? [])];
  for (const l of all) {
    const semis = (o.semitones ?? 0) + jitterSemis(l);
    out.push(playLayer(res, dest, l, { when: o.when + (l.delay ?? 0), pitch: o.pitch, gain: o.gain, semitones: semis }));
  }
  return out;
}
