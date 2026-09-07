/**
 * Persistence: settings, unlocked oches, lifetime stats. localStorage only,
 * wrapped in try/catch — the game must run with storage unavailable.
 */
import type { OcheId } from '../core/types';

export interface Settings {
  sound: boolean;
  voice: boolean;
  crowd: boolean;
  checkoutHint: boolean;
  tapToThrow: boolean;
  /** The magnifier over the sights. On by default: thumbs are wider than a double. */
  scope: boolean;
  /**
   * The accuracy meter. Off means the dart is thrown by an ordinary hand and
   * the printed odds are exactly what you get — the game before the meter
   * existed, kept for anyone who cannot time a tap.
   */
  meter: boolean;
  screenShake: boolean;
  flashes: boolean;
  /** 0 = auto, 1 = landscape, 2 = portrait */
  orientation: 0 | 1 | 2;
  volume: number; // 0..1
}

export interface LifetimeStats {
  nightsPlayed: number;
  nightsWon: number;
  legsWon: number;
  oneEighties: number;
  bestCheckout: number;
  bestLeg: number; // furthest leg index reached (0..7) + 1
  nineDarters: number;
  tutorialDone: boolean;
  /** Highest single-visit total. */
  bestVisit: number;
  /** Most Pot earned in one night. */
  bestPot: number;
}

export interface SaveData {
  version: number;
  settings: Settings;
  unlocked: OcheId[];
  lastOche: OcheId;
  stats: LifetimeStats;
}

const KEY = 'doubleout.save.v1';

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  voice: true,
  crowd: true,
  checkoutHint: true,
  tapToThrow: true,
  scope: true,
  meter: true,
  screenShake: true,
  flashes: true,
  orientation: 0,
  volume: 0.8,
};

function defaults(): SaveData {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    unlocked: ['local'],
    lastOche: 'local',
    stats: {
      nightsPlayed: 0,
      nightsWon: 0,
      legsWon: 0,
      oneEighties: 0,
      bestCheckout: 0,
      bestLeg: 0,
      nineDarters: 0,
      tutorialDone: false,
      bestVisit: 0,
      bestPot: 0,
    },
  };
}

export class Save {
  data: SaveData = defaults();

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      const d = defaults();
      this.data = {
        version: 1,
        settings: { ...d.settings, ...(parsed.settings ?? {}) },
        unlocked: Array.isArray(parsed.unlocked) ? (parsed.unlocked.filter((x) => typeof x === 'string') as OcheId[]) : d.unlocked,
        lastOche: (parsed.lastOche as OcheId) ?? 'local',
        stats: { ...d.stats, ...(parsed.stats ?? {}) },
      };
      if (!this.data.unlocked.includes('local')) this.data.unlocked.unshift('local');
    } catch {
      this.data = defaults();
    }
  }

  persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable: play on */
    }
  }

  unlock(oche: OcheId): boolean {
    if (this.data.unlocked.includes(oche)) return false;
    this.data.unlocked.push(oche);
    this.persist();
    return true;
  }

  isUnlocked(oche: OcheId): boolean {
    return this.data.unlocked.includes(oche);
  }

  reset(): void {
    this.data = defaults();
    this.persist();
  }
}
