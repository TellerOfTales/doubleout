/**
 * The bark engine (TDD §10.2). Evaluates trigger predicates over the game
 * state, honours priority and cooldown, never repeats a line within 8
 * events, and substitutes placeholders. Cosmetic RNG only — gameplay never
 * depends on anything here.
 */
import { BARKS } from '../content/barks';
import { CHALK_BY_ID } from '../content/chalkdefs';
import { targetNotation } from './board';
import { createRng, nextInt } from './rng';
import { currentLeg, currentVisit, legName, visitTotal } from './state';
import type { BarkContext, BarkTrigger, EngineEvent, LegState, NightState, Rng, ThrowResult } from './types';

export interface Bark {
  speaker: 'BARREL' | 'NOCK';
  text: string;
  triggerId: string;
  priority: number;
}

const NO_REPEAT_WINDOW = 8;

export function describeChalkChain(firedChalk: string[]): string {
  return firedChalk.map((id) => CHALK_BY_ID[id]?.name ?? id).join(' then ');
}

export class Commentary {
  private rng: Rng;
  private cooldownUntil = new Map<string, number>();
  private useCount = new Map<string, number>();
  private recent: string[] = [];
  private tick = 0;

  constructor(
    cosmeticSeed: number,
    private triggers: BarkTrigger[] = BARKS,
  ) {
    this.rng = createRng(cosmeticSeed ^ 0x5eed);
  }

  /** Evaluate every trigger; returns 0–2 barks (main + optional reply). */
  react(ctx: BarkContext): Bark[] {
    this.tick++;
    const ready: BarkTrigger[] = [];
    for (const t of this.triggers) {
      const until = this.cooldownUntil.get(t.id) ?? 0;
      if (this.tick < until) continue;
      let ok = false;
      try {
        ok = t.when(ctx);
      } catch {
        ok = false;
      }
      if (ok) ready.push(t);
    }
    if (ready.length === 0) return [];
    ready.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const ua = this.useCount.get(a.id) ?? 0;
      const ub = this.useCount.get(b.id) ?? 0;
      return ua - ub;
    });
    // Among equal-priority, equal-use candidates pick with the cosmetic RNG.
    const top = ready.filter((t) => t.priority === ready[0].priority && (this.useCount.get(t.id) ?? 0) === (this.useCount.get(ready[0].id) ?? 0));
    const trigger = top[nextInt(this.rng, top.length)];
    const line = this.pick(trigger.lines);
    if (line === null) return [];
    this.cooldownUntil.set(trigger.id, this.tick + Math.max(1, trigger.cooldown));
    this.useCount.set(trigger.id, (this.useCount.get(trigger.id) ?? 0) + 1);
    const out: Bark[] = [{ speaker: trigger.speaker, text: this.fill(line, ctx), triggerId: trigger.id, priority: trigger.priority }];
    if (trigger.reply && trigger.reply.lines.length) {
      const reply = this.pick(trigger.reply.lines);
      if (reply !== null) out.push({ speaker: trigger.reply.speaker, text: this.fill(reply, ctx), triggerId: trigger.id, priority: trigger.priority });
    }
    return out;
  }

  /** Choose a line not used in the last 8 reacts; null if the pool is exhausted. */
  private pick(lines: string[]): string | null {
    const fresh = lines.filter((l) => !this.recent.includes(l));
    const pool = fresh.length ? fresh : lines.length > 1 ? lines : [];
    if (pool.length === 0) return null;
    const line = pool[nextInt(this.rng, pool.length)];
    this.recent.push(line);
    if (this.recent.length > NO_REPEAT_WINDOW) this.recent.shift();
    return line;
  }

  private fill(line: string, ctx: BarkContext): string {
    const tr = ctx.throwResult;
    const leg = ctx.leg;
    const vals: Record<string, string> = {
      score: String(tr ? tr.scoreCommitted : leg.score),
      total: String(ctx.visitTotal),
      value: String(tr ? tr.totalValue : 0),
      chalk: describeChalkChain(tr ? tr.firedChalk : []),
      leg: legName(leg.index),
      pot: String(ctx.night.pot),
      card: tr ? targetNotation(tr.intent.card.target) : '',
      n180: String(ctx.night.stats.oneEighties),
    };
    return line.replace(/\{(\w+)\}/g, (m, k: string) => (k in vals ? vals[k] : m));
  }
}

const EMPTY_LEG: LegState = {
  index: 0,
  visitLimit: 12,
  score: 501,
  visits: [],
  deck: [],
  discard: [],
  hand: [],
  bustsThisLeg: 0,
  forgivenessUsed: false,
  status: 'ACTIVE',
  peek: [],
};

export function buildBarkContext(night: NightState, event: BarkContext['event'], throwResult?: ThrowResult): BarkContext {
  const leg = night.legs.length ? currentLeg(night) : EMPTY_LEG;
  const tr = throwResult ?? (event.type === 'THROW' ? (event as Extract<EngineEvent, { type: 'THROW' }>).result : undefined);
  let vt = 0;
  if (event.type === 'VISIT_END') vt = event.total;
  else if (event.type === 'ONE_EIGHTY') vt = event.total;
  else {
    const v = leg.visits.length ? currentVisit(leg) : undefined;
    vt = v ? visitTotal(v) : 0;
  }
  return {
    throwResult: tr,
    leg,
    night,
    visitTotal: vt,
    consecutiveBusts: night.consecutiveBusts,
    chalkFiredCount: tr ? tr.firedChalk.length : 0,
    event,
  };
}
