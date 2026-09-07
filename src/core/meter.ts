/**
 * THE METER — how well the dart was actually thrown.
 *
 * Until now a dart was a target and a dice roll: you said T20, the game rolled
 * a number, and you watched. The fourth playtest asked for the throw itself
 * back — "an accuracy meter that slides up and down across a scale where the
 * middle is dead on accurate and you have to tap to determine shot precision".
 *
 * So: a marker sweeps a vertical scale, the middle of the scale is the dart
 * you called, and the tap that releases the dart is also the tap that decides
 * how well it was thrown. Above the middle the dart is thrown long; below it,
 * short. That is the whole model, and it is built to satisfy four things at
 * once.
 *
 * 1. THE MEASURED ODDS ARE WHAT AN ORDINARY HAND GETS. The band you must stop
 *    in is not a curve somebody liked the look of: it is solved so that a
 *    player with ordinary timing — a spread of about fifty-five milliseconds
 *    against a moving marker — lands exactly the AIM_BASE table the whole game
 *    is balanced on. Measured over three hundred thousand darts: 45.1% on the
 *    treble against a printed 45, 50.2% on the double against 50, 30.0% on the
 *    bull against 30. Nothing in the economy had to move.
 *
 * 2. THE RISK DIAL SURVIVES, AND SKILL PAYS. A called single takes ninety-six
 *    percent of the bar, so it cannot really be missed by anybody — measured
 *    97.8% for a poor thumb, which is what "the safe end has to be genuinely
 *    safe" means. A treble takes twenty-two percent, about sixty milliseconds
 *    of open window: 31% for a poor thumb, 45% for an ordinary one, 61% for a
 *    quick one. The gap between the safe dart and the paying dart is still
 *    thirty-nine points at the top of the skill range, so the decision the
 *    whole game rests on is still a decision.
 *
 * 3. LUCK STAYS IN EVERY DART. The stop is nudged by the hand's own shake,
 *    rolled from the gameplay RNG — exactly one float per dart, the same
 *    single float the old aim roll consumed, so nothing about the RNG order
 *    changes. A dart on the edge of the band is a dart you are not sure about.
 *
 * 4. A MISS IS LEGIBLE ON THE BOARD. The scale is laid out by height, not at
 *    random: the closer to the middle you stop, the milder the miss, and the
 *    two ends are the two ways a dart goes wrong. Stop low and the dart drops
 *    short, into the ring inside the one you called. Stop high and it goes
 *    long — the ring outside, and past that the wall.
 *
 * Nothing here imports from the UI: the scale is data, and the bar that draws
 * it is in src/ui/meter.ts.
 */
import type { Landing } from './resolver';
import type { Region, Target } from './types';

/**
 * How far out each region sits. A miss to a lower rank is short, a miss to a
 * higher rank is long, and a miss at the same rank is a line error — the right
 * height, the wrong bed — which is why lateral misses sit closest to the band.
 *
 * The single is ranked outside the treble because that is where the aim points
 * put it: the big outer single between the treble ring and the double. Missing
 * a treble long drops you in it; missing a single short finds the treble
 * underneath. Both are true of a real board.
 */
const RANK: Record<Region, number> = { IB: 0, OB: 1, T: 2, S: 3, D: 4, W: 5 };

/**
 * Scales per second the marker travels. A full up-and-down is two scales, so
 * this is a sweep of a little over half a second — quick enough that the band
 * is a real window and slow enough to read at 320x180. It is purely a feel
 * knob: the band below is solved against it, so a faster sweep widens the
 * bands and the printed odds stay true.
 */
export const SWEEP = 3.8;

/**
 * Timing spread, in seconds, of the hand the game is balanced on. Everything
 * that throws a dart without a player — the bot, the planner, a night replayed
 * from a script, the meter switched off in the settings — throws with this
 * hand, so the measured odds are the odds an ordinary player gets.
 */
export const ORDINARY_HAND = 0.055;

export const BAND_MIN = 0.03;
export const BAND_MAX = 0.985;

/**
 * Width of the scoring band, as a fraction of the scale, for a dart whose hit
 * chance is `chance` percent.
 *
 * This is not a curve somebody liked the look of. The stop an unaided hand
 * makes is a logistic about the middle of the scale with a known spread, so
 * the band that gives that hand exactly `chance` percent can be solved for:
 * for a logistic of scale s, the chance of landing within w/2 of the middle is
 * tanh(w / 4s). Invert it and the band IS the odds, honestly — the number
 * printed on the aim bar is what an ordinary player gets, the same number the
 * whole game is balanced on, and a steadier thumb than that is the player's
 * to earn.
 *
 * What it produces, on a ninety-six pixel column: a called single is
 * ninety-six percent of the bar and cannot really be missed; a treble is
 * twenty-two percent, about sixty milliseconds of open window; the bull is
 * fourteen, about thirty-eight. That gap is the risk dial, and now it is in
 * the player's hand as well as in the odds.
 */
export function bandWidth(chance: number): number {
  const h = Math.max(0, Math.min(1, chance / 100));
  const q = quantiles();
  return Math.max(BAND_MIN, Math.min(BAND_MAX, q((1 + h) / 2) - q((1 - h) / 2)));
}

/**
 * Shake left in a dart the player did time themselves, in seconds. Small: the
 * player's own timing already carries most of the error, and this is only the
 * part of a throw nobody controls.
 */
export const HAND_SHAKE = 0.012;

/** Half the band, from the middle of the scale, that counts as dead on. */
export const SWEET = 0.08;

/**
 * A logistic sample from one uniform float, scaled to a given standard
 * deviation. Symmetric, unbounded, closed form, and one float — which is what
 * keeps the RNG order exactly as it was before the meter existed.
 */
export function shakeFrom(u: number, sd: number): number {
  const clamped = Math.min(1 - 1e-9, Math.max(1e-9, u));
  // A logistic with scale s has standard deviation s*pi/sqrt(3).
  const s = sd / 1.8137993642342178;
  return s * Math.log(clamped / (1 - clamped));
}

/**
 * Fold a position back into [0, 1] by bouncing off the ends rather than
 * piling up on them.
 *
 * The alternative is to clamp, which would heap every wild tap onto the very
 * worst outcome — a dart thrown twice as long as the board is not twice as
 * likely to be in the wall as one thrown a little long, it is the same dart.
 * Bouncing spreads that mass back over the column, and `stopChance` below sums
 * every fold, so the odds the scale is cut from are exact rather than
 * approximate.
 */
export function reflect(x: number): number {
  let v = x;
  for (let i = 0; i < 8 && (v < 0 || v > 1); i++) {
    if (v < 0) v = -v;
    if (v > 1) v = 2 - v;
  }
  return Math.max(0, Math.min(1, v));
}

/**
 * Where the marker is at time `t`, as a fraction of the scale. A triangle
 * wave: up, down, up. It never stops, so the tap that throws the dart is the
 * tap that reads it, and there is no second button to press.
 */
export function markerAt(t: number, speed = SWEEP): number {
  const cycle = ((t * speed) % 2 + 2) % 2;
  return cycle <= 1 ? cycle : 2 - cycle;
}

/**
 * The stop a hand of this timing makes when it is aiming at the middle, given
 * one float from the RNG. This is what a dart thrown with no player input
 * gets.
 */
export function rolledStop(u: number, speed = SWEEP, sd = ORDINARY_HAND): number {
  return reflect(0.5 + shakeFrom(u, sd) * speed);
}

/** The player's own stop, with the shake the hand adds on top of it. */
export function shakenStop(stop: number, u: number, speed = SWEEP, sd = HAND_SHAKE): number {
  return reflect(stop + shakeFrom(u, sd) * speed);
}

// ---------------------------------------------------------------- the scale

/** One stretch of the scale, and what a dart stopped in it does. */
export interface MeterBand {
  target: Target;
  kind: Landing['kind'];
  /** Half-open [from, to) up the scale, 0 at the bottom and 1 at the top. */
  from: number;
  to: number;
  /** 'hit', or which way the dart went wrong. */
  how: 'hit' | 'short' | 'long';
}

interface Chunk {
  target: Target;
  kind: Landing['kind'];
  mass: number;
  /** Sorting key: how badly wrong this outcome is. */
  severity: number;
}

function rankOf(t: Target): number {
  return RANK[t.region];
}

/**
 * Lay the scale out for one dart.
 *
 * The band you called sits in the middle, exactly centred, `width` of the
 * scale wide. Everything else is a miss, and the misses are sorted out of the
 * middle by how wrong they are: a line error first, because that is a dart at
 * the right height in the wrong bed; then the ring inside (going down) or the
 * ring outside (going up); and the wall at the very top, because a dart that
 * leaves the board left it long.
 *
 * The two halves hold equal mass by construction, so whichever side has more
 * than half the miss weight spills its mildest outcomes across the middle.
 * That is not a fudge: missing a treble puts you in the single whichever way
 * you were out, and the scale says so.
 */
export function meterScale(dist: Landing[], aimed: Target): MeterBand[] {
  const hit = dist.find((d) => d.kind === 'hit') ?? { target: aimed, p: 1, kind: 'hit' as const };
  const bands: MeterBand[] = [];
  const w = Math.max(0, Math.min(1, hit.p));
  if (w >= 1) return [{ target: { ...hit.target }, kind: 'hit', from: 0, to: 1, how: 'hit' }];

  const aimRank = rankOf(aimed);
  const miss = dist.filter((d) => d !== hit && d.p > 0);
  const total = miss.reduce((a, d) => a + d.p, 0);
  // Masses are probabilities, not widths: the cut points below turn them into
  // widths through the hand that has to hit them.
  const room = 1 - w;
  if (total <= 0 || room <= 0) return [{ target: { ...hit.target }, kind: 'hit', from: 0, to: 1, how: 'hit' }];

  const up: Chunk[] = [];
  const down: Chunk[] = [];
  for (const d of miss) {
    const share = (d.p / total) * room;
    const r = rankOf(d.target);
    const sev = Math.abs(r - aimRank) + (d.target.region === 'W' ? 4 : 0);
    if (r === aimRank) {
      // A line error: the right height, the wrong bed. It happens both ways,
      // and it is the mildest thing that can go wrong, so it sits against the
      // band on both sides.
      up.push({ target: d.target, kind: d.kind, mass: share / 2, severity: 0 });
      down.push({ target: d.target, kind: d.kind, mass: share / 2, severity: 0 });
    } else if (r > aimRank) {
      up.push({ target: d.target, kind: d.kind, mass: share, severity: sev });
    } else {
      down.push({ target: d.target, kind: d.kind, mass: share, severity: sev });
    }
  }
  const bySeverity = (a: Chunk, b: Chunk) => a.severity - b.severity || rankOf(a.target) - rankOf(b.target);
  up.sort(bySeverity);
  down.sort(bySeverity);

  // Each half of the scale holds exactly half the miss weight. Whichever chain
  // is over its half hands its mildest end — the outcomes nearest the band —
  // across to the other side, which keeps the severe end of each chain at the
  // end of the scale where it belongs.
  const half = room / 2;
  spill(up, down, half);
  spill(down, up, half);
  // Re-sort after the spill: a chunk handed across lands at the receiving
  // side's mild end, next to the band, not out beyond the wall.
  up.sort(bySeverity);
  down.sort(bySeverity);

  // The cut points come from the hand, not from a ruler.
  //
  // Spacing the bands by their own probability would be spacing them for a
  // player who taps at random, and nobody taps at random: an ordinary hand
  // clusters near the middle, so the bands nearest the band you called would
  // collect far more darts than they are worth and the game would quietly get
  // easier — measured, a dart called at a double found SOME double 65% of the
  // time instead of 59%, and a bot ignoring the slate went from winning three
  // nights in ten to four. Placing each cut at the quantile of the stop
  // distribution instead makes an ordinary hand land EXACTLY the distribution
  // the whole game is balanced on, misses and all, while a steadier thumb
  // still does better. What the column shows is then the honest thing for a
  // timing meter to show: not a pie chart of the odds, but how far out of
  // time you have to be to get each outcome.
  const q = quantiles();
  let acc = 0;
  const cut = (): number => q(acc);
  const emit = (c: Chunk, how: 'short' | 'long'): void => {
    const from = cut();
    acc += c.mass;
    bands.push({ target: { ...c.target }, kind: c.kind, from, to: cut(), how });
  };
  for (let i = down.length - 1; i >= 0; i--) if (down[i].mass > 0) emit(down[i], 'short');
  const hitFrom = cut();
  acc += w;
  bands.push({ target: { ...hit.target }, kind: 'hit', from: hitFrom, to: cut(), how: 'hit' });
  for (const c of up) if (c.mass > 0) emit(c, 'long');
  bands.sort((a, b) => a.from - b.from);
  // Close the rounding gaps so the scale is a partition of [0, 1].
  if (bands.length) {
    bands[0].from = 0;
    bands[bands.length - 1].to = 1;
    for (let i = 1; i < bands.length; i++) bands[i].from = bands[i - 1].to;
  }
  return bands;
}

/**
 * The quantile function of the stop an ordinary hand makes, as a lookup table
 * built once and interpolated. Feeding it a cumulative probability gives the
 * place on the column where that much of the hand's darts have gone — which is
 * exactly where one band has to end and the next begin.
 */
const QUANTILE_STEPS = 2048;
let quantileTable: Float64Array | null = null;

function quantiles(): (p: number) => number {
  if (!quantileTable) {
    // The CDF over the scale, sampled evenly, then read backwards.
    const cdf = new Float64Array(QUANTILE_STEPS + 1);
    for (let i = 0; i <= QUANTILE_STEPS; i++) cdf[i] = stopChance(0, i / QUANTILE_STEPS);
    const q = new Float64Array(QUANTILE_STEPS + 1);
    let j = 0;
    for (let i = 0; i <= QUANTILE_STEPS; i++) {
      const p = i / QUANTILE_STEPS;
      while (j < QUANTILE_STEPS && cdf[j + 1] < p) j++;
      const lo = cdf[j];
      const hi = cdf[j + 1];
      const t = hi > lo ? (p - lo) / (hi - lo) : 0;
      q[i] = (j + t) / QUANTILE_STEPS;
    }
    q[0] = 0;
    q[QUANTILE_STEPS] = 1;
    quantileTable = q;
  }
  const table = quantileTable;
  return (p: number): number => {
    const x = Math.max(0, Math.min(1, p)) * QUANTILE_STEPS;
    const i = Math.min(QUANTILE_STEPS - 1, Math.floor(x));
    const t = x - i;
    return table[i] * (1 - t) + table[i + 1] * t;
  };
}

/** Move the mildest end of an over-full chain onto the other side. */
function spill(from: Chunk[], to: Chunk[], cap: number): void {
  let total = from.reduce((a, c) => a + c.mass, 0);
  while (total > cap + 1e-12 && from.length) {
    const mild = from[0];
    const over = total - cap;
    if (mild.mass <= over + 1e-12) {
      from.shift();
      to.push({ ...mild });
      total -= mild.mass;
    } else {
      mild.mass -= over;
      to.push({ ...mild, mass: over });
      total = cap;
    }
  }
}

/** The band a stop lands in. */
export function bandAt(scale: MeterBand[], stop: number): MeterBand {
  const s = Math.max(0, Math.min(1, stop));
  for (const b of scale) if (s >= b.from && s < b.to) return b;
  return scale[scale.length - 1];
}

/** Logistic CDF with the given scale, about zero. */
function logisticCdf(x: number, scale: number): number {
  return 1 / (1 + Math.exp(-x / scale));
}

/**
 * The chance a hand of the given timing stops inside [from, to).
 *
 * The stop is the middle of the scale plus a logistic error, folded back into
 * the scale by reflection. Reflection is a piecewise isometry, so the chance of
 * landing in a stretch is the sum of the chances of landing in every stretch
 * the fold maps onto it — the copies either side, out as far as the tails go.
 */
export function stopChance(from: number, to: number, speed = SWEEP, sd = ORDINARY_HAND): number {
  const scale = (sd * speed) / 1.8137993642342178;
  let p = 0;
  for (let k = -4; k <= 4; k++) {
    p += logisticCdf(2 * k + to - 0.5, scale) - logisticCdf(2 * k + from - 0.5, scale);
    p += logisticCdf(2 * k - from - 0.5, scale) - logisticCdf(2 * k - to - 0.5, scale);
  }
  return Math.max(0, Math.min(1, p));
}

/**
 * Where a dart aimed at this scale actually finishes, and how likely each place
 * is — the distribution the game is really played on.
 *
 * This is NOT the same as the intent distribution the scale was built from.
 * The scale sorts the ways a dart goes wrong by how wrong they are, mildest
 * against the band, and a hand misses by a little far more often than by a
 * lot, so a near miss is commoner here than a flat share of the miss mass
 * would make it. Measured: a dart called at the treble twenty finds SOME
 * treble 58% of the time rather than 52%, and a dart called at a double finds
 * SOME double 65% rather than 59% while leaving the board 15% of the time
 * rather than 18%.
 *
 * Everything that reasons about outcomes — the planner, the fan drawn on the
 * board, the bust and finish odds on the aim bar — has to use this, or it is
 * predicting a game nobody is playing. The chance of hitting what you called
 * is unchanged: the band was solved to make it so.
 */
export function meterOdds(scale: MeterBand[], speed = SWEEP, sd = ORDINARY_HAND): { target: Target; p: number; kind: MeterBand['kind'] }[] {
  const out: { target: Target; p: number; kind: MeterBand['kind'] }[] = [];
  const seen = new Map<string, number>();
  for (const b of scale) {
    const p = stopChance(b.from, b.to, speed, sd);
    if (p <= 0) continue;
    const key = `${b.target.region}${b.target.bed ?? ''}`;
    const at = seen.get(key);
    if (at === undefined) {
      seen.set(key, out.length);
      out.push({ target: { ...b.target }, p, kind: b.kind });
    } else {
      out[at].p += p;
      if (b.kind === 'hit') out[at].kind = 'hit';
    }
  }
  const total = out.reduce((a, l) => a + l.p, 0);
  if (total > 0) for (const l of out) l.p /= total;
  out.sort((a, b) => b.p - a.p);
  return out;
}

/** True if the stop was dead on: the middle of the middle. */
export function isSweet(stop: number): boolean {
  return Math.abs(stop - 0.5) <= SWEET / 2;
}
