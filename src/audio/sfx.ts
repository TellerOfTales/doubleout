/**
 * AudioEngine — the public audio surface (contract in docs/AGENT_BRIEF.md).
 *
 * Every sound is synthesised on demand from `defs.ts` through small Web Audio
 * graphs. Nothing here may throw: with no AudioContext (Node, tests) or before
 * `unlock()`, every method is a silent no-op that still returns sensible values
 * (`blip()` keeps returning reveal timings so the UI cadence is unchanged when
 * sound is unavailable).
 *
 * Graph:  one-shots → sfxBus ─┐
 *         crowd bed → crowdGain → sfxBus ─┤→ master → mute → compressor → destination
 *         voice     → voiceBus ───────────┘
 */
import { createRng, nextFloat } from '../core/rng';
import type { Rng } from '../core/types';
import { CROWD_MURMUR, SFX_DEFS, chalkChainSemitones } from './defs';
import type { SfxDef, SfxLayer, SfxName } from './defs';
import { SynthResources, playDef, playLayer } from './synth';
import type {
  AudioContextLike, AudioNodeLike, BiquadFilterNodeLike, BufferSourceNodeLike, GainNodeLike, OscillatorNodeLike, PlayedLayer,
} from './synth';
import { blipParams, playBlip } from './voice';
import type { Speaker } from './voice';

export type { SfxName, SfxDef, SfxLayer } from './defs';
export type { AudioContextLike } from './synth';

export interface PlayOptions {
  /** Pitch multiplier: 1 = as defined, 2 = an octave up. */
  pitch?: number;
  /** Gain multiplier 0..1 (multiplies the definition's own volume). */
  volume?: number;
  /** Start delay in milliseconds. */
  delay?: number;
}

export interface AudioEngineOptions {
  /**
   * Use this context instead of creating one on unlock(). Used by
   * tools/audiosmoke.ts to render through an OfflineAudioContext.
   */
  context?: AudioContextLike;
  /** Factory used by unlock() when no context was supplied. Defaults to window.AudioContext. */
  contextFactory?: () => AudioContextLike | undefined;
  /** Seed for the cosmetic RNG (pitch jitter, voice jitter). */
  cosmeticSeed?: number;
  /** Maximum simultaneous one-shot layers before the oldest is stolen. */
  maxVoices?: number;
}

const DEFAULT_MAX_VOICES = 24;
const MASTER_DEFAULT = 0.9;

function defaultContextFactory(): AudioContextLike | undefined {
  const g = globalThis as unknown as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (typeof Ctor !== 'function') return undefined;
  return new Ctor();
}

function clamp01(v: number): number {
  return typeof v === 'number' && v === v ? Math.min(1, Math.max(0, v)) : 0;
}

interface ActiveVoice extends PlayedLayer {
  born: number;
}

interface CrowdBed {
  src: BufferSourceNodeLike;
  band: BiquadFilterNodeLike;
  lp: BiquadFilterNodeLike;
  gain: GainNodeLike;
  filterLfo: OscillatorNodeLike;
  ampLfo: OscillatorNodeLike;
}

export class AudioEngine {
  private ctx: AudioContextLike | undefined;
  private res: SynthResources | undefined;
  private master: GainNodeLike | undefined;
  private muteGain: GainNodeLike | undefined;
  private sfxBus: GainNodeLike | undefined;
  private voiceBus: GainNodeLike | undefined;
  private crowdGain: GainNodeLike | undefined;
  private crowd: CrowdBed | undefined;

  private readonly factory: () => AudioContextLike | undefined;
  private readonly maxVoices: number;
  private readonly rng: Rng;
  private active: ActiveVoice[] = [];
  private voiceActive: ActiveVoice[] = [];

  private masterVol = MASTER_DEFAULT;
  private sfxVol = 1;
  private voiceVol = 1;
  private _muted = false;
  private crowdTension = 0;
  private lastResumeAttempt = -1;
  private readonly isOffline: boolean;

  constructor(opts: AudioEngineOptions = {}) {
    this.factory = opts.contextFactory ?? defaultContextFactory;
    this.maxVoices = Math.max(1, opts.maxVoices ?? DEFAULT_MAX_VOICES);
    this.rng = createRng(opts.cosmeticSeed ?? 0x5eed5eed);
    this.isOffline = !!opts.context && typeof (opts.context as { startRendering?: unknown }).startRendering === 'function';
    if (opts.context) {
      try {
        this.attach(opts.context);
      } catch {
        this.ctx = undefined;
      }
    }
  }

  /** True once a context exists and has not been closed. Sound may still be pending resume(). */
  get ready(): boolean {
    return !!this.ctx && this.ctx.state !== 'closed';
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Call from a user gesture. Creates or resumes the AudioContext. Safe to call repeatedly. Never throws. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const ctx = this.factory();
        if (!ctx) return;
        this.attach(ctx);
      }
      this.tryResume(true);
    } catch {
      /* no audio available */
    }
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    try {
      const def = SFX_DEFS[name];
      if (!def || !this.res || !this.sfxBus) return;
      if (this._muted) return;
      this.tryResume(false);
      const when = this.now() + Math.max(0, (opts.delay ?? 0) / 1000);
      const pitch = opts.pitch && opts.pitch > 0 ? opts.pitch : 1;
      const gain = opts.volume === undefined ? 1 : clamp01(opts.volume);
      this.startDef(def, when, pitch, gain, 0);
    } catch {
      /* never throw from audio */
    }
  }

  /** Ascending blip: chainIndex 0,1,2… each a pentatonic step higher. A 5-chalk chain is an arpeggio. */
  chalkFire(chainIndex: number): void {
    try {
      if (!this.res || !this.sfxBus || this._muted) return;
      this.tryResume(false);
      const i = Math.max(0, Math.min(19, Math.floor(chainIndex || 0)));
      const semis = chalkChainSemitones(i);
      // Keep the top of a long chain from getting shrill: trim volume as it climbs.
      const gain = 1 - Math.min(0.35, i * 0.03);
      this.startDef(SFX_DEFS.chalk_fire, this.now(), 1, gain, semis);
    } catch {
      /* never throw */
    }
  }

  /** Crowd murmur bed. 0..1 tension controls amplitude/brightness. Loop starts lazily. */
  private crowdEnabled = true;

  /** Settings toggle: silences the crowd bed and roars without touching other buses. */
  setCrowdEnabled(on: boolean): void {
    this.crowdEnabled = on;
    if (!on) this.setCrowdTension(0);
  }

  setCrowdTension(t: number): void {
    if (!this.crowdEnabled) t = 0;
    try {
      const tension = clamp01(t);
      this.crowdTension = tension;
      if (!this.res || !this.crowdGain) return;
      if (!this.crowd) {
        if (tension <= 0) return;
        this.crowd = this.buildCrowd();
      }
      const c = this.crowd;
      const now = this.now();
      const s = CROWD_MURMUR.smoothing;
      const gain = tension <= 0 ? 0 : CROWD_MURMUR.gainLo + (CROWD_MURMUR.gainHi - CROWD_MURMUR.gainLo) * tension;
      c.gain.gain.setTargetAtTime(gain, now, s);
      c.band.frequency.setTargetAtTime(CROWD_MURMUR.centreLo + (CROWD_MURMUR.centreHi - CROWD_MURMUR.centreLo) * tension, now, s);
      c.lp.frequency.setTargetAtTime(CROWD_MURMUR.lpfLo + (CROWD_MURMUR.lpfHi - CROWD_MURMUR.lpfLo) * tension, now, s);
    } catch {
      /* never throw */
    }
  }

  /** Filtered noise burst. intensity 0..1: louder, longer, brighter as it rises. */
  crowdRoar(intensity: number): void {
    if (!this.crowdEnabled) return;
    try {
      if (!this.res || !this.sfxBus || this._muted) return;
      this.tryResume(false);
      const k = clamp01(intensity);
      const layer: SfxLayer = {
        wave: 'noise',
        attack: 0.08,
        sustain: 0.05 + 0.15 * k,
        decay: 0.6 + 0.9 * k,
        freq: 0,
        hpf: 160 + 60 * k,
        bpf: 600 + 500 * k,
        bpfQ: 0.5,
        lpf: 1200 + 3200 * k,
        lpfSweep: -0.6 - 0.5 * k,
        volume: 0.22 + 0.36 * k,
      };
      const hit: SfxLayer = {
        wave: 'sine', attack: 0.004, sustain: 0.02, decay: 0.25 + 0.2 * k, freq: 110, slide: -40, lpf: 500, volume: 0.1 + 0.18 * k,
      };
      const when = this.now();
      this.admit(playLayer(this.res, this.sfxBus, layer, { when }));
      if (k > 0.35) this.admit(playLayer(this.res, this.sfxBus, hit, { when: when + 0.03 }));
    } catch {
      /* never throw */
    }
  }

  /**
   * Voice blip for one character during a bark reveal. Returns the ms to wait
   * before the next character — also when audio is unavailable, so reveal
   * timing never depends on sound. `opts.delay` (ms) schedules the blip later.
   */
  blip(speaker: Speaker, ch: string, opts: { delay?: number } = {}): number {
    let gap = 18;
    try {
      const p = blipParams(speaker, ch, this.rng);
      gap = p.gapMs;
      if (!p.tone || !this.res || !this.voiceBus || this._muted) return gap;
      this.tryResume(false);
      const when = this.now() + Math.max(0, (opts.delay ?? 0) / 1000);
      const played = playBlip(this.res, this.voiceBus, p.tone, when);
      this.voiceActive = this.voiceActive.filter((v) => v.endTime > this.now());
      while (this.voiceActive.length >= 8) (this.voiceActive.shift() as ActiveVoice).kill();
      this.voiceActive.push({ ...played, born: when });
    } catch {
      /* never throw */
    }
    return gap;
  }

  setMasterVolume(v: number): void {
    this.masterVol = clamp01(v);
    this.applyGain(this.master, this.masterVol);
  }

  setSfxVolume(v: number): void {
    this.sfxVol = clamp01(v);
    this.applyGain(this.sfxBus, this.sfxVol);
  }

  setVoiceVolume(v: number): void {
    this.voiceVol = clamp01(v);
    this.applyGain(this.voiceBus, this.voiceVol);
  }

  setMuted(m: boolean): void {
    this._muted = !!m;
    this.applyGain(this.muteGain, this._muted ? 0 : 1);
  }

  /** Number of one-shot layers currently sounding (for tests / debug overlays). */
  get activeVoices(): number {
    return this.active.length;
  }

  // -------------------------------------------------------------------------

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private attach(ctx: AudioContextLike): void {
    this.ctx = ctx;
    this.res = new SynthResources(ctx);

    const master = ctx.createGain();
    master.gain.value = this.masterVol;
    const mute = ctx.createGain();
    mute.gain.value = this._muted ? 0 : 1;
    const sfx = ctx.createGain();
    sfx.gain.value = this.sfxVol;
    const voice = ctx.createGain();
    voice.gain.value = this.voiceVol;
    const crowd = ctx.createGain();
    crowd.gain.value = 1;

    sfx.connect(master);
    voice.connect(master);
    crowd.connect(sfx);
    master.connect(mute);

    let tail: AudioNodeLike = mute;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      try {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 12;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.16;
        mute.connect(comp);
        tail = comp;
      } catch {
        tail = mute;
      }
    }
    tail.connect(ctx.destination);

    this.master = master;
    this.muteGain = mute;
    this.sfxBus = sfx;
    this.voiceBus = voice;
    this.crowdGain = crowd;
    if (this.crowdTension > 0) this.setCrowdTension(this.crowdTension);
  }

  /** Resume a suspended context (tab was hidden, iOS interruption). Throttled unless forced. */
  private tryResume(force: boolean): void {
    const ctx = this.ctx;
    if (!ctx || this.isOffline || typeof ctx.resume !== 'function') return;
    if (ctx.state !== 'suspended' && ctx.state !== 'interrupted') return;
    const now = Date.now();
    if (!force && this.lastResumeAttempt >= 0 && now - this.lastResumeAttempt < 1000) return;
    this.lastResumeAttempt = now;
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* not allowed yet */
    }
  }

  private applyGain(node: GainNodeLike | undefined, v: number): void {
    if (!node || !this.ctx) return;
    try {
      const now = this.now();
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(v, now, 0.015);
    } catch {
      try { node.gain.value = v; } catch { /* give up */ }
    }
  }

  private jitterFor(l: SfxLayer): number {
    if (!l.jitter) return 0;
    return (nextFloat(this.rng) * 2 - 1) * l.jitter;
  }

  private startDef(def: SfxDef, when: number, pitch: number, gain: number, semitones: number): void {
    if (!this.res || !this.sfxBus) return;
    const played = playDef(this.res, this.sfxBus, def, { when, pitch, gain, semitones }, (l) => this.jitterFor(l));
    for (const p of played) this.admit(p);
  }

  /** Register a one-shot layer, stealing the oldest when over the polyphony limit. */
  private admit(p: PlayedLayer): void {
    const now = this.now();
    if (this.active.length >= this.maxVoices) {
      this.active = this.active.filter((v) => v.endTime > now);
    }
    while (this.active.length >= this.maxVoices) {
      const oldest = this.active.shift() as ActiveVoice;
      oldest.kill();
    }
    this.active.push({ ...p, born: now });
  }

  private buildCrowd(): CrowdBed {
    const ctx = this.ctx as AudioContextLike;
    const res = this.res as SynthResources;
    const dest = this.crowdGain as GainNodeLike;
    const now = this.now();

    const src = ctx.createBufferSource();
    src.buffer = res.noiseBuffer();
    src.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 150;
    hp.Q.value = 0.7;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = CROWD_MURMUR.centreLo;
    band.Q.value = CROWD_MURMUR.q;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = CROWD_MURMUR.lpfLo;
    lp.Q.value = 0.7;

    const amp = ctx.createGain();
    amp.gain.value = 1;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    // Slow drift on the band centre and a slow swell on amplitude so the bed
    // never sounds like a static hiss.
    const filterLfo = ctx.createOscillator();
    filterLfo.type = 'sine';
    filterLfo.frequency.value = CROWD_MURMUR.filterLfoHz;
    const filterDepth = ctx.createGain();
    filterDepth.gain.value = CROWD_MURMUR.filterLfoDepth;
    filterLfo.connect(filterDepth);
    filterDepth.connect(band.frequency);

    const ampLfo = ctx.createOscillator();
    ampLfo.type = 'sine';
    ampLfo.frequency.value = CROWD_MURMUR.ampLfoHz;
    const ampDepth = ctx.createGain();
    ampDepth.gain.value = CROWD_MURMUR.ampLfoDepth;
    ampLfo.connect(ampDepth);
    ampDepth.connect(amp.gain);

    src.connect(hp);
    hp.connect(band);
    band.connect(lp);
    lp.connect(amp);
    amp.connect(gain);
    gain.connect(dest);

    src.start(now);
    filterLfo.start(now);
    ampLfo.start(now);

    return { src, band, lp, gain, filterLfo, ampLfo };
  }
}
