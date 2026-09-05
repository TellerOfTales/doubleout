import { BED_ORDER, type Bed, type Region, type Target } from './types';

/** Position (0..19, clockwise from top) of a bed. */
export function bedIndex(bed: Bed): number {
  return BED_ORDER.indexOf(bed);
}

export function clockwiseAdjacent(bed: Bed): Bed {
  return BED_ORDER[(bedIndex(bed) + 1) % 20];
}

export function anticlockwiseAdjacent(bed: Bed): Bed {
  return BED_ORDER[(bedIndex(bed) + 19) % 20];
}

export function oppositeBed(bed: Bed): Bed {
  return BED_ORDER[(bedIndex(bed) + 10) % 20];
}

export function regionMultiplier(region: Region): number {
  switch (region) {
    case 'S':
      return 1;
    case 'D':
      return 2;
    case 'T':
      return 3;
    case 'OB':
      return 1;
    case 'IB':
      return 1;
    case 'W':
      return 0;
  }
}

/** bed × multiplier; OB = 25, IB = 50. */
export function baseValue(t: Target): number {
  if (t.region === 'W') return 0;
  if (t.region === 'OB') return 25;
  if (t.region === 'IB') return 50;
  return (t.bed as number) * regionMultiplier(t.region);
}

/** Does this target satisfy double-out law on its own (before RULE chalk)? */
export function isDoubleRegion(t: Target): boolean {
  return t.region === 'D' || t.region === 'IB';
}

/** Player-facing notation: T20, S7, D16, OB, BULL. */
export function targetNotation(t: Target): string {
  if (t.region === 'W') return 'WALL';
  if (t.region === 'OB') return 'OB';
  if (t.region === 'IB') return 'BULL';
  return `${t.region}${t.bed}`;
}

/** Long-form name used by the tutorial/commentary: "treble 20", "double 16", "outer bull", "bull". */
export function targetLongName(t: Target): string {
  if (t.region === 'W') return 'the wall';
  if (t.region === 'OB') return 'outer bull';
  if (t.region === 'IB') return 'the bull';
  const r = t.region === 'S' ? 'single' : t.region === 'D' ? 'double' : 'treble';
  return `${r} ${t.bed}`;
}

/** Parse "T20", "s7", "d16", "ob", "ib"/"bull" into a Target. Throws on garbage. */
export function parseTarget(s: string): Target {
  const u = s.trim().toUpperCase();
  if (u === 'W' || u === 'WALL') return { region: 'W' };
  if (u === 'OB') return { region: 'OB' };
  if (u === 'IB' || u === 'BULL') return { region: 'IB' };
  const m = /^([SDT])(\d{1,2})$/.exec(u);
  if (!m) throw new Error(`bad target: ${s}`);
  const bed = Number(m[2]);
  if (!BED_ORDER.includes(bed as Bed)) throw new Error(`bad bed: ${s}`);
  return { region: m[1] as Region, bed: bed as Bed };
}

/** Card def id for a target: "t20", "s7", "d16", "ob", "ib". */
export function targetDefId(t: Target): string {
  if (t.region === 'W') return 'wall';
  if (t.region === 'OB') return 'ob';
  if (t.region === 'IB') return 'ib';
  return `${t.region.toLowerCase()}${t.bed}`;
}

/** The pseudo-card committed for a deliberate miss. Never in a deck. */
export const WALL_CARD_ID = 'wall';

export function sameTarget(a: Target, b: Target): boolean {
  return a.region === b.region && a.bed === b.bed;
}

/** All 62 board targets: 20 beds × S/D/T plus OB and IB. */
export const ALL_TARGETS: Target[] = (() => {
  const out: Target[] = [];
  for (const bed of BED_ORDER) {
    for (const region of ['S', 'D', 'T'] as Region[]) out.push({ region, bed });
  }
  out.push({ region: 'OB' }, { region: 'IB' });
  return out;
})();
