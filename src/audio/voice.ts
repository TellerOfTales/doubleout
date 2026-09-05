/**
 * Blip voice (TDD §12.3): per-character pitched blips during a bark reveal.
 *
 * BARREL — square wave, base 420 Hz ± 80 Hz jitter, 18 ms per character.
 * NOCK   — triangle wave, base 180 Hz ± 25 Hz jitter, 34 ms per character.
 *
 * `blipParams` is pure (timing + tone description) so the reveal cadence is
 * available without an AudioContext; `playBlip` renders one tone.
 */
import type { Rng } from '../core/types';
import { nextFloat } from '../core/rng';
import type { AudioContextLike, AudioNodeLike, PlayedLayer, SynthResources } from './synth';

export type Speaker = 'BARREL' | 'NOCK';

export interface SpeakerVoice {
  wave: 'square' | 'triangle';
  baseHz: number;
  jitterHz: number;
  /** Gap per ordinary character, ms. */
  charMs: number;
  /** Tone length as a fraction of charMs for consonants. */
  toneFrac: number;
  /** Low-pass to keep the timbre soft. */
  lpf: number;
  volume: number;
}

export const VOICES: Record<Speaker, SpeakerVoice> = {
  BARREL: { wave: 'square', baseHz: 420, jitterHz: 80, charMs: 18, toneFrac: 0.85, lpf: 3200, volume: 0.17 },
  NOCK: { wave: 'triangle', baseHz: 180, jitterHz: 25, charMs: 34, toneFrac: 0.85, lpf: 1800, volume: 0.24 },
};

/** Gap after punctuation, ms (no sound). */
export const PUNCT_GAP_MS = {
  comma: 120,
  stop: 220,
  dash: 80,
} as const;

/** Vowels are a little longer and higher than consonants: a speech-like contour. */
const VOWEL_DUR = 1.3;
const VOWEL_PITCH = 1.07;
const DIGIT_PITCH = 0.92;

export interface BlipTone {
  wave: 'square' | 'triangle';
  freq: number;
  /** Tone duration in ms. */
  durationMs: number;
  lpf: number;
  volume: number;
}

export interface BlipParams {
  /** Milliseconds to wait before revealing the next character. */
  gapMs: number;
  /** Tone to play, or undefined for silent characters (space, punctuation). */
  tone?: BlipTone;
}

const VOWELS = /^[aeiouyàâäèéêëîïôöùûüÿáíóú]$/i;
const LETTER = /^[\p{L}]$/u;
const DIGIT = /^[0-9]$/;

/**
 * Timing and tone for one character. `rng` supplies the pitch jitter; it is
 * cosmetic and deterministic per engine instance.
 */
export function blipParams(speaker: Speaker, ch: string, rng: Rng): BlipParams {
  const v = VOICES[speaker] ?? VOICES.BARREL;
  const c = ch.length > 0 ? ch[0] : ' ';

  if (c === ' ' || c === '\t') return { gapMs: v.charMs * 2 };
  if (c === '\n' || c === '\r') return { gapMs: PUNCT_GAP_MS.stop };
  if (c === '.' || c === '!' || c === '?' || c === '…') return { gapMs: PUNCT_GAP_MS.stop };
  if (c === ',' || c === ';' || c === ':') return { gapMs: PUNCT_GAP_MS.comma };
  if (c === '-' || c === '—' || c === '–') return { gapMs: PUNCT_GAP_MS.dash };

  const isLetter = LETTER.test(c);
  const isDigit = DIGIT.test(c);
  if (!isLetter && !isDigit) return { gapMs: v.charMs };

  const jitter = (nextFloat(rng) * 2 - 1) * v.jitterHz;
  let freq = v.baseHz + jitter;
  let dur = v.charMs * v.toneFrac;
  if (isDigit) freq *= DIGIT_PITCH;
  else if (VOWELS.test(c)) {
    freq *= VOWEL_PITCH;
    dur *= VOWEL_DUR;
  }
  return {
    gapMs: v.charMs,
    tone: { wave: v.wave, freq, durationMs: dur, lpf: v.lpf, volume: v.volume },
  };
}

/** Render one blip tone into `dest` at absolute context time `when`. */
export function playBlip(res: SynthResources, dest: AudioNodeLike, tone: BlipTone, when: number, gainMul = 1): PlayedLayer {
  const ctx: AudioContextLike = res.ctx;
  const d = tone.durationMs / 1000;
  const attack = 0.002;
  const decay = Math.max(0.006, d * 0.35);
  const hold = Math.max(0, d - attack - decay);
  const peak = Math.max(0.0005, Math.min(1, tone.volume * gainMul));

  const osc = ctx.createOscillator();
  osc.type = tone.wave;
  osc.frequency.setValueAtTime(Math.max(20, tone.freq), when);
  // A slight downward glide inside each blip reads as a syllable.
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, tone.freq * 0.94), when + d);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = tone.lpf;
  lp.Q.value = 0.7;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(peak, when + attack);
  env.gain.setValueAtTime(peak, when + attack + hold);
  env.gain.exponentialRampToValueAtTime(0.0005, when + attack + hold + decay);
  env.gain.setValueAtTime(0, when + d + 0.001);

  osc.connect(lp);
  lp.connect(env);
  env.connect(dest);
  osc.start(when);
  const stopAt = when + d + 0.02;
  osc.stop(stopAt);

  let dead = false;
  const cleanup = () => {
    if (dead) return;
    dead = true;
    try { osc.disconnect(); lp.disconnect(); env.disconnect(); } catch { /* gone */ }
  };
  osc.onended = cleanup;

  return {
    endTime: when + d,
    kill() {
      if (dead) return;
      try {
        const now = ctx.currentTime;
        env.gain.cancelScheduledValues(now);
        env.gain.setTargetAtTime(0, now, 0.003);
        osc.stop(now + 0.02);
      } catch { /* best effort */ }
    },
  };
}
