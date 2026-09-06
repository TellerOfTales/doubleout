/**
 * The resolution pipeline (TDD §7). Determinism depends on this order:
 *
 *   BOARD stage (may change WHICH target was hit)
 *   VALUE stage (computes numbers; floor everything, never round up)
 *   subtract
 *   RULE stage  (decides what the number means: checkout / bust / continue)
 *
 * Chalk within a stage resolves in acquisition order. Before the BOARD stage
 * the AIM step decides where the dart actually lands: every target has odds,
 * a miss drifts to a neighbouring bed or ring (or the wall, for a double), and
 * the roll consumes the gameplay RNG. `wired` also consumes it, afterwards.
 */
import { anticlockwiseAdjacent, baseValue, clockwiseAdjacent, isDoubleRegion, oppositeBed } from './board';
import { nextFloat } from './rng';
import type { Bed, Chalk, ChalkStage, DartCard, Region, ResolvedHit, Rng, Target, ThrowResult, TraceStep } from './types';
import { targetNotation } from './board';

export interface ResolveContext {
  /** Held chalk, any order; sorted by acquisition order internally. */
  chalk: Chalk[];
  /**
   * Gameplay RNG, consumed by the aim roll and by `wired`. Pass null to resolve
   * a hypothetical: the dart lands where it is aimed (or where `landing` says).
   */
  rng: Rng | null;
  /** Percentage points added to every hit chance (the crowd's steadiness). Default 0. */
  steadiness?: number;
  /** True aim: skip the odds, the dart lands where aimed. */
  trueAim?: boolean;
  /** Force where the dart lands (for enumerating outcomes). Overrides the roll. */
  landing?: Target;
  scoreBefore: number;
  /** Score at the start of the visit; a plain bust reverts to this. */
  scoreAtVisitStart: number;
  visitThrowIndex: 0 | 1 | 2 | 3;
  /** Has forgiving_oche already been spent this leg? */
  forgivenessUsed: boolean;
}

export interface ResolveOutput {
  result: ThrowResult;
  /** True if forgiveness was consumed by this throw. */
  forgivenessConsumed: boolean;
}

function has(chalk: Chalk[], id: string): boolean {
  return chalk.some((c) => c.def.id === id);
}

function byOrder(chalk: Chalk[]): Chalk[] {
  return chalk.slice().sort((a, b) => a.order - b.order);
}

/** Spare cards over the dart count. Tuned by simulation — see docs/decisions/balance.md. */
export const VISIT_HAND_SPARE = 2;

/**
 * Cards dealt at the start of a visit, to be spent across its darts.
 * One spare over the dart count, so there is always a choice to make and
 * spending the big card early costs you the later darts. Wide Grip adds a
 * card, Tunnel Vision takes one away (and pays for it in value).
 */
export function visitHandSizeFor(chalk: Chalk[]): number {
  let size = throwsPerVisitFor(chalk) + VISIT_HAND_SPARE;
  if (has(chalk, 'wide_grip')) size += 1;
  if (has(chalk, 'tunnel_vision')) size -= 1;
  return Math.max(1, size);
}

/** Throws per visit after DEAL chalk. */
export function throwsPerVisitFor(chalk: Chalk[]): number {
  return has(chalk, 'fourth_dart') ? 4 : 3;
}

// ---------------------------------------------------------------- the aim

/** One place the dart can land, with its chance. */
export interface Landing {
  target: Target;
  /** Probability, 0..1. */
  p: number;
  kind: 'hit' | 'drift' | 'lucky' | 'wall';
}

/**
 * Base chance, in percentage points, of a dart landing where it is aimed.
 * Singles are big, doubles are thin, trebles thinner, the bull smallest.
 */
export const AIM_BASE: Record<Exclude<Region, 'W'>, number> = { S: 90, D: 65, T: 60, OB: 70, IB: 50 };
/** No hand is steadier than this. */
export const AIM_CAP = 95;
/** Percentage points of steadiness per pip of heat: the crowd carries you. */
export const STEADY_PER_HEAT = 4;
/** The wall of the board: a double missed on the outside scores nothing. */
const WALL: Target = { region: 'W' };
/** Where a bull that misses ends up: the top of the board, mostly. */
const BULL_STRAY: Bed[] = [20, 5, 1];

/**
 * Where a dart aimed at `target` can land, and how likely each is. The miss
 * mass is shared out by region: a treble usually drops into its own single;
 * a double either falls short into the single, slips a bed, or goes in the
 * wall; a single mostly slips a bed and sometimes finds its own treble.
 */
export function landingDistribution(target: Target, steadiness = 0): Landing[] {
  if (target.region === 'W') return [{ target: WALL, p: 1, kind: 'wall' }];
  const hit = Math.min(AIM_CAP, AIM_BASE[target.region] + Math.max(0, steadiness)) / 100;
  const miss = 1 - hit;
  const out: Landing[] = [{ target: { ...target }, p: hit, kind: 'hit' }];
  const bed = target.bed;
  if (target.region === 'OB' || target.region === 'IB') {
    const other: Target = { region: target.region === 'OB' ? 'IB' : 'OB' };
    const share = target.region === 'OB' ? 0.25 : 0.55;
    out.push({ target: other, p: miss * share, kind: target.region === 'OB' ? 'lucky' : 'drift' });
    for (const b of BULL_STRAY) out.push({ target: { region: 'S', bed: b }, p: (miss * (1 - share)) / BULL_STRAY.length, kind: 'drift' });
    return out;
  }
  if (bed === undefined) return out;
  const cw = clockwiseAdjacent(bed);
  const acw = anticlockwiseAdjacent(bed);
  switch (target.region) {
    case 'S':
      out.push({ target: { region: 'S', bed: cw }, p: miss * 0.45, kind: 'drift' });
      out.push({ target: { region: 'S', bed: acw }, p: miss * 0.3, kind: 'drift' });
      out.push({ target: { region: 'T', bed }, p: miss * 0.25, kind: 'lucky' });
      break;
    case 'T':
      out.push({ target: { region: 'S', bed }, p: miss * 0.6, kind: 'drift' });
      out.push({ target: { region: 'T', bed: cw }, p: miss * 0.2, kind: 'drift' });
      out.push({ target: { region: 'T', bed: acw }, p: miss * 0.2, kind: 'drift' });
      break;
    case 'D':
      out.push({ target: { region: 'S', bed }, p: miss * 0.4, kind: 'drift' });
      out.push({ target: { region: 'D', bed: cw }, p: miss * 0.2, kind: 'drift' });
      out.push({ target: { region: 'D', bed: acw }, p: miss * 0.15, kind: 'drift' });
      out.push({ target: WALL, p: miss * 0.25, kind: 'wall' });
      break;
  }
  return out;
}

/** Hit chance, as a whole percentage, for the card face. */
export function hitChance(target: Target, steadiness = 0): number {
  if (target.region === 'W') return 100;
  return Math.min(AIM_CAP, AIM_BASE[target.region] + Math.max(0, steadiness));
}

/** Roll the landing from the gameplay RNG. Consumes exactly one float. */
export function rollLanding(target: Target, steadiness: number, rng: Rng): Landing {
  const dist = landingDistribution(target, steadiness);
  let u = nextFloat(rng);
  for (const l of dist) {
    if (u < l.p) return l;
    u -= l.p;
  }
  return dist[dist.length - 1];
}

function landingKind(aimed: Target, landed: Target): Landing['kind'] {
  if (landed.region === 'W') return 'wall';
  if (landed.region === aimed.region && landed.bed === aimed.bed) return 'hit';
  const dist = landingDistribution(aimed, 0);
  const found = dist.find((l) => l.target.region === landed.region && l.target.bed === landed.bed);
  return found ? found.kind : 'drift';
}

export function resolveThrow(card: DartCard, ctx: ResolveContext): ResolveOutput {
  if (card.target.region === 'W') {
    // A deliberate miss: the dart is spent, nothing on the board is hit, no chalk fires.
    return {
      result: {
        intent: { card, visitThrowIndex: ctx.visitThrowIndex },
        hits: [],
        totalValue: 0,
        scoreBefore: ctx.scoreBefore,
        scoreAfter: ctx.scoreBefore,
        outcome: 'CONTINUE',
        firedChalk: [],
        scoreCommitted: ctx.scoreBefore,
        forgiven: false,
        deflected: false,
        miss: true,
        shanghai: false,
        aimed: { ...card.target },
        aim: 'wall',
        steadiness: 0,
        trace: [],
      },
      forgivenessConsumed: false,
    };
  }
  const chalk = byOrder(ctx.chalk);
  const fired: string[] = [];
  const trace: TraceStep[] = [];
  let deflected = false;
  const note = (chalkId: string, stage: ChalkStage, targets: Target[], values: number[], text: string) =>
    trace.push({ chalkId, stage, targets: targets.map((t) => ({ ...t })), values: values.slice(), note: text });

  // ---------------- 2. AIM ----------------
  // Every target has odds. A hypothetical (no RNG) lands where it is aimed
  // unless a landing is forced; true aim skips the roll altogether.
  const steadiness = Math.max(0, ctx.steadiness ?? 0);
  const aimed: Target = { ...card.target };
  let landed: Target = aimed;
  if (ctx.landing) landed = { ...ctx.landing };
  else if (ctx.rng && !ctx.trueAim) landed = { ...rollLanding(aimed, steadiness, ctx.rng).target };
  const aim = landingKind(aimed, landed);
  if (landed.region === 'W') {
    // In the wall: the dart is spent, nothing on the board is hit, no chalk fires.
    return {
      result: {
        intent: { card, visitThrowIndex: ctx.visitThrowIndex },
        hits: [],
        totalValue: 0,
        scoreBefore: ctx.scoreBefore,
        scoreAfter: ctx.scoreBefore,
        outcome: 'CONTINUE',
        firedChalk: [],
        scoreCommitted: ctx.scoreBefore,
        forgiven: false,
        deflected: false,
        miss: false,
        shanghai: false,
        aimed,
        aim: 'wall',
        steadiness,
        trace: [],
      },
      forgivenessConsumed: false,
    };
  }

  // ---------------- 3. BOARD stage ----------------
  let targets: Target[] = [landed];
  for (const c of chalk) {
    if (c.def.stage !== 'BOARD') continue;
    switch (c.def.id) {
      case 'wired': {
        // 25% chance the (first) target deflects into the clockwise-adjacent bed, same region.
        // Only bed targets can deflect; bulls have no neighbour. The roll is only
        // consumed when a deflection is possible so that RNG use is well-defined.
        const t = targets[0];
        if (t.bed !== undefined && ctx.rng) {
          const roll = nextFloat(ctx.rng);
          if (roll < 0.25) {
            const before = targetNotation(t);
            targets[0] = { region: t.region, bed: clockwiseAdjacent(t.bed) };
            fired.push('wired');
            deflected = true;
            note('wired', 'BOARD', targets, targets.map(baseValue), `${before} → ${targetNotation(targets[0])}`);
          }
        }
        break;
      }
      case 'split_tips': {
        // Every throw also hits the anticlockwise-adjacent bed as a single.
        const t = targets[0];
        if (t.bed !== undefined) {
          targets.push({ region: 'S', bed: anticlockwiseAdjacent(t.bed) });
          fired.push('split_tips');
          note('split_tips', 'BOARD', targets, targets.map(baseValue), `+${targetNotation(targets[1])}`);
        }
        break;
      }
      case 'magnetised': {
        // BOARD stage but references a value: evaluate against the BASE value
        // (bed × multiplier) before any VALUE chalk. Do not move this.
        let did = false;
        targets = targets.map((t) => {
          if (baseValue(t) < 10) {
            did = true;
            return { region: 'S', bed: 20 } as Target;
          }
          return t;
        });
        if (did) {
          fired.push('magnetised');
          note('magnetised', 'BOARD', targets, targets.map(baseValue), `→ ${targets.map(targetNotation).join('+')}`);
        }
        break;
      }
      case 'narrow_beds': {
        let did = false;
        targets = targets.map((t) => {
          if (t.region === 'S') {
            did = true;
            return { region: 'T', bed: t.bed };
          }
          if (t.region === 'T') {
            did = true;
            return { region: 'S', bed: t.bed };
          }
          return t;
        });
        if (did) {
          fired.push('narrow_beds');
          note('narrow_beds', 'BOARD', targets, targets.map(baseValue), `→ ${targets.map(targetNotation).join('+')}`);
        }
        break;
      }
      case 'mirrored': {
        let did = false;
        targets = targets.map((t) => {
          if (t.bed !== undefined) {
            did = true;
            return { region: t.region, bed: oppositeBed(t.bed) };
          }
          return t;
        });
        if (did) {
          fired.push('mirrored');
          note('mirrored', 'BOARD', targets, targets.map(baseValue), `→ ${targets.map(targetNotation).join('+')}`);
        }
        break;
      }
      case 'wide_doubles':
        // Evaluated in the RULE stage (it changes what counts as a double, not where the dart lands).
        break;
    }
  }

  // ---------------- 4. VALUE stage ----------------
  const values = targets.map((t) => baseValue(t));
  const firedValue = new Set<string>();
  for (const c of chalk) {
    if (c.def.stage !== 'VALUE') continue;
    const beforeSum = values.reduce((a, b) => a + b, 0);
    let didAny = false;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      let v = values[i];
      let did = false;
      switch (c.def.id) {
        case 'hot_twenty':
          if (t.region === 'T' && t.bed === 20) {
            v = Math.floor((v * 4) / 3);
            did = true;
          }
          break;
        case 'feathered':
          if (t.region === 'D') {
            v = Math.floor((v * 3) / 2);
            did = true;
          }
          break;
        case 'heavy_tips':
          v += 5;
          did = true;
          break;
        case 'oiled':
          if (t.bed !== undefined && t.bed % 2 === 1) {
            v = Math.floor((v * 3) / 2);
            did = true;
          }
          break;
        case 'even_keel':
          if (t.bed !== undefined && t.bed % 2 === 0) {
            v = Math.floor((v * 3) / 2);
            did = true;
          }
          break;
        case 'cold_hands':
          if (ctx.visitThrowIndex === 0) {
            v = 0;
            did = true;
          } else if (ctx.visitThrowIndex === 1 || ctx.visitThrowIndex === 2) {
            v *= 2;
            did = true;
          }
          break;
        case 'last_orders':
          if (ctx.visitThrowIndex === 2) {
            v *= 2;
            did = true;
          }
          break;
        case 'bullish':
          if (t.region === 'OB' || t.region === 'IB') {
            v = 75;
            did = true;
          }
          break;
      }
      values[i] = Math.floor(v);
      if (did) {
        firedValue.add(c.def.id);
        didAny = true;
      }
    }
    if (didAny) note(c.def.id, 'VALUE', targets, values, `${beforeSum} → ${values.reduce((a, b) => a + b, 0)}`);
  }
  // Fired VALUE chalk is recorded in acquisition order, once per throw.
  for (const c of chalk) if (c.def.stage === 'VALUE' && firedValue.has(c.def.id)) fired.push(c.def.id);

  // tunnel_vision is DEAL chalk with a VALUE side-effect: +20% to every resolved value, after VALUE chalk.
  if (has(chalk, 'tunnel_vision')) {
    const beforeSum = values.reduce((a, b) => a + b, 0);
    for (let i = 0; i < values.length; i++) values[i] = Math.floor((values[i] * 6) / 5);
    fired.push('tunnel_vision');
    note('tunnel_vision', 'DEAL', targets, values, `${beforeSum} → ${values.reduce((a, b) => a + b, 0)}`);
  }

  const totalValue = values.reduce((a, b) => a + b, 0);

  // ---------------- 5. Subtract ----------------
  const scoreBefore = ctx.scoreBefore;
  let scoreAfter = scoreBefore - totalValue;

  // ---------------- 6. RULE stage ----------------
  const last = targets[targets.length - 1];
  let countsAsDouble = isDoubleRegion(last);
  if (!countsAsDouble && has(chalk, 'wide_doubles') && last.bed !== undefined && (last.bed === 16 || last.bed === 18 || last.bed === 20)) {
    countsAsDouble = true;
    fired.push('wide_doubles');
    note('wide_doubles', 'BOARD', targets, values, `${targetNotation(last)} counts as a double`);
  }
  const straightOut = has(chalk, 'straight_out');
  if (!countsAsDouble && straightOut) {
    countsAsDouble = true;
    // Only counts as "fired" if it actually mattered (a would-be checkout below).
  }

  const hits: ResolvedHit[] = targets.map((t, i) => ({
    target: t,
    value: values[i],
    countsAsDouble: i === targets.length - 1 ? countsAsDouble : false,
  }));

  let outcome: ThrowResult['outcome'];
  let scoreCommitted: number;
  let forgiven = false;
  let forgivenessConsumed = false;

  if (scoreAfter < 0) {
    // Overshoot forgives 1 or 2 too many, but only on a finishing throw:
    // removing the double requirement entirely is straight_out's job, and
    // letting any card close the leg made overshoot dominant (§15.3).
    if (has(chalk, 'overshoot') && scoreAfter >= -2 && countsAsDouble) {
      outcome = 'CHECKOUT';
      fired.push('overshoot');
      note('overshoot', 'RULE', targets, values, `${scoreAfter} counts as out`);
    } else {
      outcome = 'BUST';
    }
  } else if (scoreAfter === 1) {
    if (has(chalk, 'chalk_dust')) {
      scoreAfter = 2;
      outcome = 'CONTINUE';
      fired.push('chalk_dust');
      note('chalk_dust', 'RULE', targets, values, '1 → 2');
    } else {
      outcome = 'BUST';
    }
  } else if (scoreAfter === 0) {
    if (countsAsDouble) {
      outcome = 'CHECKOUT';
      if (straightOut && !isDoubleRegion(last) && !fired.includes('wide_doubles')) {
        fired.push('straight_out');
        note('straight_out', 'RULE', targets, values, 'no double needed');
      }
    } else {
      outcome = 'BUST';
    }
  } else {
    outcome = 'CONTINUE';
  }

  // 6.4 bust consequences: forgiveness first; if it fires, cheap chalk does not.
  if (outcome === 'BUST') {
    if (has(chalk, 'forgiving_oche') && !ctx.forgivenessUsed) {
      outcome = 'CONTINUE';
      forgiven = true;
      forgivenessConsumed = true;
      scoreCommitted = scoreBefore;
      fired.push('forgiving_oche');
      note('forgiving_oche', 'RULE', targets, values, 'bust forgiven');
    } else if (has(chalk, 'cheap_chalk')) {
      scoreCommitted = 2;
      fired.push('cheap_chalk');
      note('cheap_chalk', 'RULE', targets, values, 'bust → 2');
    } else {
      scoreCommitted = ctx.scoreAtVisitStart; // plain bust: revert
    }
  } else if (outcome === 'CHECKOUT') {
    scoreCommitted = 0;
  } else {
    scoreCommitted = scoreAfter;
  }

  const result: ThrowResult = {
    intent: { card, visitThrowIndex: ctx.visitThrowIndex },
    hits,
    totalValue,
    scoreBefore,
    scoreAfter,
    outcome,
    firedChalk: fired,
    scoreCommitted,
    forgiven,
    deflected,
    miss: false,
    shanghai: false,
    aimed,
    aim,
    steadiness,
    trace,
  };
  return { result, forgivenessConsumed };
}
