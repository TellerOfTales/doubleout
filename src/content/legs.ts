/** TDD §4 — the eight legs of a night. */
export interface LegDef {
  name: string;
  visitLimit: number;
  /** Base pot reward for checking out. 0 on the last leg (the win is the reward). */
  reward: number;
}

export const LEGS: LegDef[] = [
  { name: 'First Round', visitLimit: 12, reward: 4 },
  { name: 'Second Round', visitLimit: 11, reward: 6 },
  { name: 'Quarter', visitLimit: 10, reward: 8 },
  { name: 'Interval', visitLimit: 9, reward: 9 },
  { name: 'Semi', visitLimit: 8, reward: 11 },
  { name: 'Last Four', visitLimit: 7, reward: 13 },
  { name: 'Final', visitLimit: 6, reward: 15 },
  { name: 'The Decider', visitLimit: 5, reward: 0 },
];

export const LEG_COUNT = LEGS.length;
export const STARTING_SCORE = 501;
export const DEFAULT_HAND_SIZE = 3;
export const DEFAULT_THROWS_PER_VISIT = 3;
export const DEFAULT_CHALK_SLOTS = 5;
export const SHOP_REFRESH_COST = 1;
export const SERVICE_COST = { REMOVE: 2, DUPLICATE: 4, SHARPEN: 5 } as const;
