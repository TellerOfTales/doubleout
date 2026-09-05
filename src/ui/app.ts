/**
 * Shared application context handed to every scene: the screen, renderer,
 * sprites, audio, save data, input and the scene manager, plus the current
 * night. Scenes import this as a type only, so there is no runtime cycle.
 */
import type { Sprites } from '../art/sprites';
import type { AudioEngine } from '../audio/sfx';
import type { Commentary } from '../core/commentary';
import type { NightState, OcheId } from '../core/types';
import type { Screen } from './canvas';
import type { Renderer } from './draw';
import type { Input } from './input';
import type { Save } from './save';
import type { SceneManager } from './scene';

export interface App {
  screen: Screen;
  renderer: Renderer;
  sprites: Sprites;
  audio: AudioEngine;
  save: Save;
  input: Input;
  scenes: SceneManager;
  commentary: Commentary;
  night: NightState | null;
  /** Seed typed on the title screen (null = random). */
  chosenSeed: number | null;
  chosenOche: OcheId;
  /** Navigation helpers implemented in main.ts. */
  toTitle(): void;
  startNight(seed: number | null, oche: OcheId): void;
  toGame(): void;
  toShop(): void;
  toWin(): void;
  toLoss(): void;
  toTutorial(): void;
  toSettings(back: () => void): void;
  toCredits(): void;
  applySettings(): void;
  /** Play a UI sound respecting settings. */
  sfx(name: Parameters<AudioEngine['play']>[0], opts?: Parameters<AudioEngine['play']>[1]): void;
  /** Random seed for a new night (uses Math.random: this is outside game logic). */
  randomSeed(): number;
}
