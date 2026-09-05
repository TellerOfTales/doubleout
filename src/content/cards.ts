import { parseTarget, targetDefId, baseValue } from '../core/board';
import type { DartCard, OcheId, Target } from '../core/types';

/** A card definition: the region it names. Copies share a defId. */
export interface CardDef {
  id: string;
  target: Target;
  /** Base value, for sorting/shop pricing. */
  value: number;
}

const DEF_CACHE = new Map<string, CardDef>();

/** Card def for a def id like "t20", "s7", "d16", "ob", "ib". */
export function cardDef(defId: string): CardDef {
  let d = DEF_CACHE.get(defId);
  if (!d) {
    const target = parseTarget(defId);
    d = { id: targetDefId(target), target, value: baseValue(target) };
    DEF_CACHE.set(defId, d);
  }
  return d;
}

/**
 * Shop card price (TDD leaves this to the implementer, see DECISIONS.md).
 * Singles 1–3, doubles 2–5, trebles 3–6, outer bull 4, bull 6.
 */
export function cardCost(defId: string): number {
  const d = cardDef(defId);
  switch (d.target.region) {
    case 'S':
      return d.value >= 17 ? 3 : d.value >= 10 ? 2 : 1;
    case 'D':
      return d.value >= 32 ? 5 : d.value >= 20 ? 4 : d.value >= 12 ? 3 : 2;
    case 'T':
      return d.value >= 51 ? 6 : d.value >= 39 ? 5 : d.value >= 24 ? 4 : 3;
    case 'OB':
      return 4;
    case 'IB':
      return 6;
    case 'W':
      return 0;
  }
}

/** Starting library: 24 deliberately mediocre cards (TDD §6.1 with a ladder of small doubles — DECISIONS.md #45). */
/**
 * Starting library: 24 cards. Trebles carry the scoring, a ladder of small
 * doubles makes every finish reachable, and the singles are the filler you
 * want to buy your way out of. Tuned by simulation for the per-visit hand —
 * see docs/decisions/balance.md.
 */
export const STARTING_LIBRARY: [string, number][] = [
  ['s20', 2],
  ['s19', 2],
  ['s18', 1],
  ['s16', 1],
  ['s12', 1],
  ['t20', 2],
  ['t19', 2],
  ['t18', 1],
  ['t17', 1],
  ['t16', 1],
  ['t14', 1],
  ['d20', 1],
  ['d16', 1],
  ['d10', 1],
  ['d8', 1],
  ['d4', 1],
  ['d2', 1],
  ['d1', 1],
  ['ob', 1],
  ['ib', 1],
];

/** The Thin: a 12-card library — every card comes round again. */
export const THIN_LIBRARY: [string, number][] = [
  ['s20', 1],
  ['s19', 1],
  ['s16', 1],
  ['t20', 2],
  ['t19', 1],
  ['t17', 1],
  ['d20', 1],
  ['d16', 1],
  ['d8', 1],
  ['d2', 1],
  ['ib', 1],
];

/**
 * Library composition for an oche, as [defId, copies]. The Sharp trades its two
 * weakest singles for two trebles, found by value rather than by name so the
 * oche keeps working when the starting list is retuned.
 */
export function libraryFor(oche: OcheId): [string, number][] {
  if (oche === 'thin') return THIN_LIBRARY.map((x) => [x[0], x[1]] as [string, number]);
  const lib: [string, number][] = STARTING_LIBRARY.map((x) => [x[0], x[1]] as [string, number]);
  if (oche === 'sharp') {
    for (const upgrade of ['t18', 't17']) {
      // drop one copy of the cheapest single we still hold
      let worstIndex = -1;
      let worstValue = Infinity;
      lib.forEach(([defId, copies], i) => {
        if (copies <= 0) return;
        const d = cardDef(defId);
        if (d.target.region !== 'S') return;
        if (d.value < worstValue) {
          worstValue = d.value;
          worstIndex = i;
        }
      });
      if (worstIndex >= 0) {
        lib[worstIndex] = [lib[worstIndex][0], lib[worstIndex][1] - 1];
        if (lib[worstIndex][1] === 0) lib.splice(worstIndex, 1);
      }
      const existing = lib.findIndex((x) => x[0] === upgrade);
      if (existing >= 0) lib[existing] = [upgrade, lib[existing][1] + 1];
      else lib.push([upgrade, 1]);
    }
  }
  return lib;
}

/**
 * Shop offer pool with weights. Skewed toward cards a player would actually
 * want to practise, with a thin tail of low singles so a bad offer is
 * possible but rare.
 */
export const SHOP_CARD_POOL: [string, number][] = [
  ['t20', 6],
  ['t19', 6],
  ['t18', 5],
  ['t17', 5],
  ['t16', 3],
  ['t15', 2],
  ['t14', 2],
  ['t13', 1],
  ['t12', 1],
  ['t11', 1],
  ['t10', 1],
  ['d20', 5],
  ['d18', 4],
  ['d16', 5],
  ['d12', 3],
  ['d10', 3],
  ['d8', 3],
  ['d6', 2],
  ['d4', 2],
  ['d2', 1],
  ['d1', 1],
  ['ib', 3],
  ['ob', 2],
  ['s20', 4],
  ['s19', 3],
  ['s18', 3],
  ['s17', 2],
  ['s16', 2],
  ['s15', 1],
  ['s14', 1],
  ['s13', 1],
  ['s10', 1],
  ['s9', 1],
  ['s8', 1],
  ['s6', 1],
  ['s4', 1],
  ['s2', 1],
];

/** Sharpen (TDD §4.1): single→treble→double. OB→IB. Returns null if already top tier. */
export function sharpenedDefId(defId: string): string | null {
  const d = cardDef(defId);
  switch (d.target.region) {
    case 'S':
      return `t${d.target.bed}`;
    case 'T':
      return `d${d.target.bed}`;
    case 'OB':
      return 'ib';
    default:
      return null;
  }
}

export function makeCard(defId: string, id: string, flight: 0 | 1 | 2 | 3): DartCard {
  const d = cardDef(defId);
  return { id, defId: d.id, target: { ...d.target }, flight };
}
