/**
 * THE KIT — one-shot interventions, bought in the shop and spent on a dart the
 * player has already decided to throw.
 *
 * These replaced the deck of dealt targets. The difference matters: a dealt
 * target constrains where you may aim, which is input randomness and the thing
 * that broke the loop. An intervention modifies a throw you were making anyway,
 * so it is never a dead card and never tells you what to do.
 * See docs/decisions/design.md §5.6.
 */
import type { InterventionDef } from '../core/types';

export const INTERVENTIONS: InterventionDef[] = [
  {
    id: 'steady',
    name: 'STEADY',
    blurb: 'Twenty-five more on this dart’s chance.',
    cost: 3,
    when: 'AIM',
  },
  {
    id: 'again',
    name: 'AGAIN',
    blurb: 'Throw this dart again. The second one stands.',
    cost: 4,
    when: 'AIM',
  },
  {
    id: 'called',
    name: 'CALLED',
    blurb: 'This dart cannot finish in the wall.',
    cost: 3,
    when: 'AIM',
  },
  {
    id: 'doubled',
    name: 'DOUBLED',
    blurb: 'This dart scores twice what it lands on.',
    cost: 5,
    when: 'AIM',
  },
  {
    id: 'insured',
    name: 'INSURED',
    blurb: 'If this dart busts, your score survives it.',
    cost: 4,
    when: 'AIM',
  },
  {
    id: 'rubout',
    name: 'RUB OUT',
    blurb: 'Wipe the slate and chalk three new contracts.',
    cost: 2,
    when: 'SLATE',
  },
];

export const INTERVENTION_BY_ID: Record<string, InterventionDef> = Object.fromEntries(INTERVENTIONS.map((i) => [i.id, i]));

export function interventionDef(id: string): InterventionDef {
  const d = INTERVENTION_BY_ID[id];
  if (!d) throw new Error(`unknown intervention: ${id}`);
  return d;
}

/** What the night starts with, before a single shop. */
export const STARTING_KIT: string[] = ['steady', 'called'];

/** What the shop can offer. Weighted so the cheap steadying ones show up most. */
export const KIT_POOL: [string, number][] = [
  ['steady', 10],
  ['called', 8],
  ['again', 7],
  ['insured', 6],
  ['doubled', 5],
  ['rubout', 5],
];

/** Most interventions held at once. Buying past it is refused. */
export const KIT_CAP = 6;
