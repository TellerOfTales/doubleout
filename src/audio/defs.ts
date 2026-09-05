/**
 * DOUBLE OUT — sound definitions (TDD §12).
 *
 * Every sound in the game is a parameter object, sfxr-style. Nothing here is
 * audio data; `synth.ts` turns a definition into a small Web Audio node graph
 * at play time. Tune by ear with `node --experimental-strip-types tools/audiosmoke.ts`,
 * which renders every definition offline and reports peak / RMS / duration.
 *
 * Units: seconds for time, Hz for frequency, semitones for pitch offsets,
 * octaves-per-second for filter sweeps, 0..1 for gains.
 */

export type SfxName =
  | 'throw' | 'thud' | 'wire' | 'card_deal' | 'card_select' | 'chalk_fire' | 'bust' | 'checkout'
  | 'one_eighty' | 'crowd_roar' | 'ui_move' | 'ui_confirm' | 'ui_back' | 'pot' | 'shop_buy'
  | 'shop_refresh' | 'tick' | 'whoosh' | 'error' | 'unlock' | 'win_fanfare' | 'lose_sting' | 'card_flip';

export type Wave = 'square' | 'saw' | 'sine' | 'triangle' | 'noise';

/**
 * One synthesis layer: a single oscillator (or noise source), its envelope,
 * pitch motion, and filters. A sound is a primary layer plus optional
 * sub-layers, so a chord or a "hit + tail" is one definition.
 */
export interface SfxLayer {
  wave: Wave;
  /** Square only: pulse width 0..1 (0.5 = plain square). */
  duty?: number;

  // Amplitude envelope. Gain goes 0→1 over `attack`, holds for `sustain`,
  // falls to `decayTo` over `decay`, then to 0 over `release`.
  attack: number;
  sustain: number;
  decay: number;
  /** Level reached at the end of `decay` (default 0, sfxr-style). */
  decayTo?: number;
  /** Tail from `decayTo` to silence (default 0). Only audible if decayTo > 0. */
  release?: number;

  /** Base frequency in Hz (ignored for 'noise'). */
  freq: number;
  /** Pitch slide, semitones per second (negative = falling). */
  slide?: number;
  /** Change of slide, semitones per second². */
  deltaSlide?: number;
  /** Vibrato depth in semitones. */
  vibratoDepth?: number;
  /** Vibrato rate in Hz. */
  vibratoSpeed?: number;
  /** Arpeggio: every `arpSpeed` seconds the pitch jumps by `arpStep` semitones. */
  arpStep?: number;
  arpSpeed?: number;
  /** Number of arpeggio steps before wrapping to the base pitch (default: never wrap). */
  arpCount?: number;
  /** Random pitch offset per play, ± semitones (cosmetic RNG). */
  jitter?: number;

  /** Mix a white-noise source in parallel with the oscillator, 0..1. */
  noise?: number;

  /** Low-pass cutoff in Hz (omit = none). */
  lpf?: number;
  /** Low-pass sweep in octaves per second (positive = opening). */
  lpfSweep?: number;
  /** Low-pass resonance (default 0.7). */
  lpfQ?: number;
  /** High-pass cutoff in Hz (omit = none). */
  hpf?: number;
  /** Band-pass centre in Hz (omit = none). */
  bpf?: number;
  /** Band-pass Q (default 1). */
  bpfQ?: number;

  /** Layer gain 0..1. */
  volume: number;
  /** Start offset in seconds relative to the sound's start (sub-layers only). */
  delay?: number;
}

export interface SfxDef extends SfxLayer {
  /** Additional layers, each with its own delay. */
  layers?: SfxLayer[];
}

/** Equal-tempered frequency of a MIDI note number (69 = A4 = 440 Hz). */
export function midiHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Total duration of a layer's envelope in seconds. */
export function layerDuration(l: SfxLayer): number {
  return l.attack + l.sustain + l.decay + ((l.decayTo ?? 0) > 0 ? (l.release ?? 0) : 0);
}

/** Total duration of a definition including sub-layer delays. */
export function defDuration(d: SfxDef): number {
  let end = layerDuration(d);
  for (const l of d.layers ?? []) end = Math.max(end, (l.delay ?? 0) + layerDuration(l));
  return end;
}

// Note numbers used below (MIDI).
const C4 = 60, E4 = 64, G4 = 67, A4 = 69, C5 = 72, D5 = 74, E5 = 76, G5 = 79, B5 = 83, C6 = 84, D6 = 86, E6 = 88, G6 = 91, B6 = 95, C7 = 96, D7 = 98;

/** A plucky chip-tune note: short attack, brief hold, exponential fall. */
function chip(midi: number, opts: Partial<SfxLayer> = {}): SfxLayer {
  return {
    wave: 'square',
    duty: 0.3,
    attack: 0.004,
    sustain: 0.06,
    decay: 0.22,
    freq: midiHz(midi),
    lpf: 5200,
    volume: 0.2,
    ...opts,
  };
}

/** A soft bell partial. */
function bell(midi: number, opts: Partial<SfxLayer> = {}): SfxLayer {
  return {
    wave: 'sine',
    attack: 0.002,
    sustain: 0.01,
    decay: 0.3,
    freq: midiHz(midi),
    lpf: 8000,
    volume: 0.2,
    ...opts,
  };
}

/** A paper flick: very short band-limited noise. */
function flick(opts: Partial<SfxLayer> = {}): SfxLayer {
  return {
    wave: 'noise',
    attack: 0.003,
    sustain: 0.008,
    decay: 0.045,
    freq: 0,
    hpf: 1100,
    bpf: 2600,
    bpfQ: 0.9,
    lpf: 7000,
    volume: 0.3,
    ...opts,
  };
}

export const SFX_DEFS: Record<SfxName, SfxDef> = {
  // Short noise sweep: the dart leaving the hand.
  throw: {
    wave: 'noise',
    attack: 0.012,
    sustain: 0.02,
    decay: 0.1,
    freq: 0,
    hpf: 900,
    lpf: 2600,
    lpfSweep: 5,
    volume: 0.28,
  },

  // The most important sound in the game. Low, short, rounded: a sine drop
  // with a triangle body and a tiny tip click. No harsh highs, ±1 semitone
  // jitter so 500 repetitions never sound identical.
  thud: {
    wave: 'sine',
    attack: 0.002,
    sustain: 0.012,
    decay: 0.11,
    freq: 165,
    slide: -110,
    jitter: 1,
    lpf: 900,
    volume: 0.58,
    layers: [
      { wave: 'triangle', attack: 0.003, sustain: 0.015, decay: 0.085, freq: 96, slide: -30, jitter: 1, lpf: 520, volume: 0.28 },
      { wave: 'noise', attack: 0.001, sustain: 0.003, decay: 0.018, freq: 0, hpf: 220, lpf: 1600, volume: 0.13 },
    ],
  },

  // Metallic ping for wired deflections: two inharmonic sines and a bright tick.
  wire: {
    wave: 'sine',
    attack: 0.001,
    sustain: 0.004,
    decay: 0.19,
    freq: 2380,
    slide: -5,
    jitter: 0.5,
    lpf: 6500,
    volume: 0.24,
    layers: [
      { wave: 'sine', attack: 0.001, sustain: 0.002, decay: 0.09, freq: 3590, slide: -8, lpf: 6500, volume: 0.13 },
      { wave: 'noise', attack: 0.0005, sustain: 0.003, decay: 0.014, freq: 0, hpf: 3000, lpf: 7500, volume: 0.1 },
    ],
  },

  // Paper flick.
  card_deal: {
    ...flick(),
    layers: [flick({ delay: 0.018, decay: 0.03, volume: 0.16, bpf: 3400 })],
  },

  // Soft click.
  card_select: {
    wave: 'sine',
    attack: 0.001,
    sustain: 0.004,
    decay: 0.032,
    freq: 880,
    slide: -160,
    lpf: 2600,
    volume: 0.22,
    layers: [{ wave: 'noise', attack: 0.0005, sustain: 0.002, decay: 0.008, freq: 0, hpf: 1500, lpf: 4000, volume: 0.08 }],
  },

  // Ascending blip — the payoff sound. AudioEngine.chalkFire() raises the
  // pitch one pentatonic step per chain index so a chain is an arpeggio.
  chalk_fire: {
    wave: 'square',
    duty: 0.35,
    attack: 0.003,
    sustain: 0.035,
    decay: 0.09,
    freq: midiHz(C5),
    slide: 28,
    lpf: 4200,
    volume: 0.24,
    layers: [{ wave: 'sine', attack: 0.003, sustain: 0.03, decay: 0.12, freq: midiHz(C6), slide: 28, volume: 0.1 }],
  },

  // Descending comic two-note fall. Wobbly, not punishing.
  bust: {
    wave: 'square',
    duty: 0.5,
    attack: 0.006,
    sustain: 0.09,
    decay: 0.06,
    freq: midiHz(G4),
    slide: -8,
    lpf: 2300,
    volume: 0.22,
    layers: [
      {
        wave: 'square', duty: 0.5, delay: 0.16, attack: 0.008, sustain: 0.14, decay: 0.22, freq: midiHz(C4),
        slide: -34, vibratoDepth: 0.45, vibratoSpeed: 7, lpf: 2000, volume: 0.22,
      },
      { wave: 'triangle', delay: 0.16, attack: 0.008, sustain: 0.14, decay: 0.22, freq: midiHz(C4 - 12), slide: -34, lpf: 1200, volume: 0.12 },
    ],
  },

  // Rising major triad with an octave to resolve it.
  checkout: {
    ...chip(C5, { volume: 0.18 }),
    layers: [
      chip(E5, { delay: 0.09, volume: 0.18 }),
      chip(G5, { delay: 0.18, volume: 0.18 }),
      chip(C6, { delay: 0.27, sustain: 0.12, decay: 0.42, volume: 0.17 }),
      bell(C6 + 12, { delay: 0.27, decay: 0.5, volume: 0.06 }),
    ],
  },

  // The largest sound in the game: low hit + stacked chord + crowd swell + sparkle.
  one_eighty: {
    wave: 'sine',
    attack: 0.002,
    sustain: 0.03,
    decay: 0.42,
    freq: 120,
    slide: -60,
    lpf: 700,
    volume: 0.42,
    layers: [
      { wave: 'noise', attack: 0.001, sustain: 0.006, decay: 0.03, freq: 0, hpf: 200, lpf: 2200, volume: 0.14 },
      chip(C4, { duty: 0.3, attack: 0.01, sustain: 0.32, decay: 0.55, lpf: 3400, volume: 0.1 }),
      chip(E4, { duty: 0.3, attack: 0.01, sustain: 0.32, decay: 0.55, lpf: 3400, volume: 0.09, jitter: 0.04 }),
      chip(G4, { duty: 0.3, attack: 0.01, sustain: 0.32, decay: 0.55, lpf: 3400, volume: 0.09, jitter: 0.04 }),
      chip(C5, { duty: 0.3, attack: 0.01, sustain: 0.32, decay: 0.55, lpf: 3400, volume: 0.08 }),
      chip(E5, { duty: 0.3, attack: 0.01, sustain: 0.32, decay: 0.55, lpf: 3400, volume: 0.07, jitter: 0.04 }),
      { wave: 'noise', delay: 0.05, attack: 0.28, sustain: 0.25, decay: 1.05, freq: 0, hpf: 250, bpf: 900, bpfQ: 0.5, lpf: 1800, lpfSweep: 0.8, volume: 0.32 },
      bell(C6, { delay: 0.12, decay: 0.4, volume: 0.09 }),
      bell(E6, { delay: 0.22, decay: 0.4, volume: 0.09 }),
      bell(G6, { delay: 0.32, decay: 0.45, volume: 0.09 }),
      bell(C7, { delay: 0.42, decay: 0.7, volume: 0.09 }),
    ],
  },

  // Filtered noise burst (default intensity; AudioEngine.crowdRoar() is parametric).
  crowd_roar: {
    wave: 'noise',
    attack: 0.08,
    sustain: 0.1,
    decay: 1.2,
    freq: 0,
    hpf: 180,
    bpf: 750,
    bpfQ: 0.5,
    lpf: 2600,
    lpfSweep: -0.9,
    volume: 0.45,
  },

  // UI: subtle.
  ui_move: {
    wave: 'sine',
    attack: 0.001,
    sustain: 0.008,
    decay: 0.03,
    freq: 1180,
    lpf: 3200,
    volume: 0.11,
  },
  ui_confirm: {
    wave: 'sine',
    attack: 0.002,
    sustain: 0.03,
    decay: 0.08,
    freq: midiHz(E5),
    lpf: 3600,
    volume: 0.16,
    layers: [{ wave: 'sine', delay: 0.06, attack: 0.002, sustain: 0.035, decay: 0.1, freq: midiHz(A4 + 12), lpf: 3600, volume: 0.16 }],
  },
  ui_back: {
    wave: 'triangle',
    attack: 0.002,
    sustain: 0.03,
    decay: 0.08,
    freq: 520,
    slide: -22,
    lpf: 2400,
    volume: 0.15,
  },

  // Coin chime.
  pot: {
    ...bell(A4 + 24, { decay: 0.32, volume: 0.2 }),
    layers: [
      bell(E5 + 24, { delay: 0.035, decay: 0.28, volume: 0.13 }),
      { wave: 'triangle', delay: 0.035, attack: 0.001, sustain: 0.004, decay: 0.05, freq: midiHz(A4 + 36), lpf: 9000, volume: 0.06 },
    ],
  },

  // Register click + rising chime.
  shop_buy: {
    wave: 'noise',
    attack: 0.0005,
    sustain: 0.003,
    decay: 0.012,
    freq: 0,
    hpf: 1200,
    lpf: 5000,
    volume: 0.12,
    layers: [
      bell(A4 + 12, { sustain: 0.04, decay: 0.2, volume: 0.17 }),
      bell(E5 + 12, { delay: 0.08, sustain: 0.04, decay: 0.2, volume: 0.15 }),
      bell(A4 + 24, { delay: 0.16, sustain: 0.03, decay: 0.28, volume: 0.13 }),
    ],
  },

  // Card shuffle: three quick flicks and a soft whoosh under them.
  shop_refresh: {
    ...flick({ volume: 0.24 }),
    layers: [
      flick({ delay: 0.055, bpf: 2200, volume: 0.22 }),
      flick({ delay: 0.11, bpf: 1900, volume: 0.2 }),
      { wave: 'noise', attack: 0.04, sustain: 0.05, decay: 0.16, freq: 0, hpf: 300, lpf: 900, lpfSweep: 2, volume: 0.12 },
    ],
  },

  // Near-single-sample click for the score countdown.
  tick: {
    wave: 'noise',
    attack: 0.0005,
    sustain: 0.0015,
    decay: 0.006,
    freq: 0,
    hpf: 1500,
    lpf: 6000,
    volume: 0.2,
    layers: [{ wave: 'sine', attack: 0.0005, sustain: 0.002, decay: 0.008, freq: 2100, volume: 0.1 }],
  },

  // Rising band-limited whoosh for screen transitions.
  whoosh: {
    wave: 'noise',
    attack: 0.05,
    sustain: 0.05,
    decay: 0.2,
    freq: 0,
    hpf: 280,
    lpf: 700,
    lpfSweep: 4.5,
    volume: 0.28,
  },

  // Gentle "bonk": an invalid action, not a punishment.
  error: {
    wave: 'square',
    duty: 0.5,
    attack: 0.004,
    sustain: 0.05,
    decay: 0.07,
    freq: 220,
    lpf: 1400,
    volume: 0.14,
    layers: [{ wave: 'square', duty: 0.5, delay: 0.1, attack: 0.004, sustain: 0.05, decay: 0.1, freq: 196, lpf: 1300, volume: 0.14 }],
  },

  // Sparkle arpeggio.
  unlock: {
    ...bell(C6, { sustain: 0.03, decay: 0.38, volume: 0.15 }),
    layers: [
      bell(E6, { delay: 0.07, sustain: 0.03, decay: 0.38, volume: 0.14 }),
      bell(G6, { delay: 0.14, sustain: 0.03, decay: 0.38, volume: 0.13 }),
      bell(B6, { delay: 0.21, sustain: 0.03, decay: 0.4, volume: 0.12 }),
      bell(D7, { delay: 0.28, sustain: 0.04, decay: 0.5, volume: 0.11 }),
      { wave: 'noise', delay: 0.05, attack: 0.02, sustain: 0.05, decay: 0.45, freq: 0, hpf: 5500, lpf: 11000, volume: 0.04 },
    ],
  },

  // Short five-note phrase: G4 C5 E5 G5, then C6 held. Square lead + triangle body.
  win_fanfare: {
    ...chip(G4, { sustain: 0.08, decay: 0.08, volume: 0.17 }),
    layers: [
      { wave: 'triangle', attack: 0.004, sustain: 0.08, decay: 0.08, freq: midiHz(G4 - 12), lpf: 2000, volume: 0.1 },
      chip(C5, { delay: 0.13, sustain: 0.08, decay: 0.08, volume: 0.17 }),
      { wave: 'triangle', delay: 0.13, attack: 0.004, sustain: 0.08, decay: 0.08, freq: midiHz(C5 - 12), lpf: 2000, volume: 0.1 },
      chip(E5, { delay: 0.26, sustain: 0.08, decay: 0.08, volume: 0.17 }),
      { wave: 'triangle', delay: 0.26, attack: 0.004, sustain: 0.08, decay: 0.08, freq: midiHz(E5 - 12), lpf: 2000, volume: 0.1 },
      chip(G5, { delay: 0.39, sustain: 0.08, decay: 0.08, volume: 0.17 }),
      { wave: 'triangle', delay: 0.39, attack: 0.004, sustain: 0.08, decay: 0.08, freq: midiHz(G5 - 12), lpf: 2000, volume: 0.1 },
      chip(C6, { delay: 0.52, sustain: 0.34, decay: 0.45, vibratoDepth: 0.12, vibratoSpeed: 5.5, volume: 0.17 }),
      { wave: 'triangle', delay: 0.52, attack: 0.004, sustain: 0.34, decay: 0.45, freq: midiHz(C6 - 12), lpf: 2400, volume: 0.1 },
      bell(C7, { delay: 0.52, decay: 0.6, volume: 0.05 }),
    ],
  },

  // Gentle, sympathetic two-note. The loss screen must be kind.
  lose_sting: {
    wave: 'triangle',
    attack: 0.03,
    sustain: 0.24,
    decay: 0.36,
    freq: midiHz(E4),
    vibratoDepth: 0.12,
    vibratoSpeed: 4.5,
    lpf: 1700,
    volume: 0.2,
    layers: [
      { wave: 'sine', attack: 0.03, sustain: 0.24, decay: 0.36, freq: midiHz(E4 - 12), lpf: 900, volume: 0.1 },
      { wave: 'triangle', delay: 0.36, attack: 0.035, sustain: 0.3, decay: 0.7, freq: midiHz(C4), vibratoDepth: 0.12, vibratoSpeed: 4.5, lpf: 1600, volume: 0.2 },
      { wave: 'sine', delay: 0.36, attack: 0.035, sustain: 0.3, decay: 0.7, freq: midiHz(C4 - 12), lpf: 800, volume: 0.1 },
    ],
  },

  // Paper flip: a flick with a tiny pitched "thwip".
  card_flip: {
    ...flick({ volume: 0.24, bpf: 2100 }),
    layers: [{ wave: 'sine', attack: 0.001, sustain: 0.006, decay: 0.035, freq: 1500, slide: -220, lpf: 3000, volume: 0.12 }],
  },
};

/** Every sound name, in definition order. */
export const SFX_NAMES: SfxName[] = Object.keys(SFX_DEFS) as SfxName[];

/**
 * Crowd murmur bed (TDD §12.2 `crowd_murmur`): a looping filtered-noise bed
 * whose gain and brightness follow AudioEngine.setCrowdTension().
 */
export const CROWD_MURMUR = {
  /** Band-pass centre at tension 0 and 1. */
  centreLo: 340,
  centreHi: 880,
  q: 0.8,
  /** Low-pass ceiling at tension 0 and 1. */
  lpfLo: 1200,
  lpfHi: 2600,
  /** Bed gain at tension 0 and 1. */
  gainLo: 0.025,
  gainHi: 0.17,
  /** Slow filter wobble: ± Hz at this rate. */
  filterLfoHz: 0.13,
  filterLfoDepth: 120,
  /** Slow amplitude swell: ± fraction at this rate. */
  ampLfoHz: 0.29,
  ampLfoDepth: 0.18,
  /** Smoothing time constant for tension changes, seconds. */
  smoothing: 0.35,
} as const;

/** Pentatonic offsets (major) used by AudioEngine.chalkFire(): index → semitones above base. */
export function chalkChainSemitones(chainIndex: number): number {
  const steps = [0, 2, 4, 7, 9];
  const i = Math.max(0, Math.floor(chainIndex));
  return 12 * Math.floor(i / steps.length) + steps[i % steps.length];
}
