import type { OcheId } from '../core/types';

/** TDD §9.4 — the five oches. Alternate starting configurations only. */
export interface OcheDef {
  id: OcheId;
  name: string;
  /** Unlock condition, player-facing. */
  unlock: string;
  /** What changes at the start. */
  change: string;
  /** Short flavour line for the picker. */
  flavour: string;
}

export const OCHES: OcheDef[] = [
  {
    id: 'local',
    name: 'The Local',
    unlock: 'Always open',
    change: 'The standard 24-card library.',
    flavour: 'Sticky carpet. Warm welcome. Nobody remembers your name.',
  },
  {
    id: 'sharp',
    name: 'The Sharp',
    unlock: 'Win a leg with a 100+ checkout',
    change: 'Start with T18 and T17 instead of two S1.',
    flavour: 'Somebody has been practising. It shows.',
  },
  {
    id: 'steady',
    name: 'The Steady',
    unlock: 'Win a night with zero busts',
    change: 'Forgiving Oche chalk free at the start.',
    flavour: 'A calm hand and a kind board.',
  },
  {
    id: 'wide',
    name: 'The Wide',
    unlock: 'Hold 5 chalk at once',
    change: '6 chalk slots. All cards cost +2.',
    flavour: 'More pockets. Deeper pockets needed.',
  },
  {
    id: 'thin',
    name: 'The Thin',
    unlock: 'Win a leg in 6 visits or fewer',
    change: 'A library of 12 cards instead of 24.',
    flavour: 'Every card counts. Every card comes round again.',
  },
];

export const OCHE_BY_ID: Record<OcheId, OcheDef> = Object.fromEntries(OCHES.map((o) => [o.id, o])) as Record<OcheId, OcheDef>;
