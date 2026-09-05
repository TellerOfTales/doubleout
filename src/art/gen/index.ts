/**
 * Registry of every generated asset (TDD §11.4). Deterministic: the same
 * code always yields the same bytes — no Math.random, no Date.
 *
 * Contract used by src/art/sprites.ts and tools/genart.ts.
 */
import { assertPalette, type Pixmap } from '../palette.ts';
import { genBoard, genBoardNumbers } from './board.ts';
import { genCardBack, genCardFrame, genChalkFrame, genChalkIcons } from './cards.ts';
import { genConfetti, genDart, genDartStuck, genDartTrail, genSpark } from './darts.ts';
import { genFont5x7, genFont9x12 } from './fonts.ts';
import { genCrowdHead, genLightCone, genOcheFloor, genVignette, genWall } from './scene.ts';
import { genButton, genIcons, genLogo, genPanelFrame, genPint, genScoreboard } from './ui.ts';

export interface GeneratedAsset {
  name: string;
  pixmap: Pixmap;
  frames?: number;
  frameW?: number;
  frameH?: number;
  nineSlice?: { l: number; t: number; r: number; b: number };
}

type Gen = () => Omit<GeneratedAsset, 'name'>;

const NINE = { l: 4, t: 4, r: 4, b: 4 };

function framed(pixmap: Pixmap, frameW: number, frameH: number): Omit<GeneratedAsset, 'name'> {
  return { pixmap, frames: pixmap.w / frameW, frameW, frameH };
}

/** Insertion order is the manifest order. */
const GENERATORS: Record<string, Gen> = {
  board_128: () => ({ pixmap: genBoard(128) }),
  board_96: () => ({ pixmap: genBoard(96) }),
  board_64: () => ({ pixmap: genBoard(64) }),
  board_48: () => ({ pixmap: genBoard(48) }),
  board_wired_128: () => ({ pixmap: genBoard(128, { wireHighlight: true }) }),
  board_wired_96: () => ({ pixmap: genBoard(96, { wireHighlight: true }) }),
  board_numbers_128: () => ({ pixmap: genBoardNumbers(128) }),
  board_numbers_96: () => ({ pixmap: genBoardNumbers(96) }),
  dart: () => framed(genDart(), 9, 9),
  dart_stuck: () => framed(genDartStuck(), 5, 5),
  dart_trail: () => framed(genDartTrail(), 16, 4),
  card_frame: () => ({ ...framed(genCardFrame(), 40, 56), nineSlice: NINE }),
  card_back: () => ({ pixmap: genCardBack() }),
  chalk_frame: () => ({ ...framed(genChalkFrame(), 32, 32), nineSlice: NINE }),
  chalk_icons: () => framed(genChalkIcons(), 12, 12),
  crowd_head: () => framed(genCrowdHead(), 8, 8),
  oche_floor: () => ({ pixmap: genOcheFloor() }),
  wall: () => ({ pixmap: genWall() }),
  scoreboard: () => ({ pixmap: genScoreboard() }),
  pint: () => framed(genPint(), 12, 16),
  light_cone: () => ({ pixmap: genLightCone() }),
  font_5x7: () => ({ pixmap: genFont5x7() }),
  font_9x12: () => ({ pixmap: genFont9x12() }),
  icons: () => framed(genIcons(), 8, 8),
  panel_frame: () => ({ ...framed(genPanelFrame(), 24, 24), nineSlice: NINE }),
  button: () => ({ ...framed(genButton(), 24, 16), nineSlice: NINE }),
  logo: () => ({ pixmap: genLogo() }),
  spark: () => framed(genSpark(), 3, 3),
  confetti: () => framed(genConfetti(), 2, 2),
  vignette: () => ({ pixmap: genVignette() }),
};

export const ASSET_NAMES: string[] = Object.keys(GENERATORS);

export function generateAsset(name: string): GeneratedAsset {
  const gen = GENERATORS[name];
  if (!gen) throw new Error(`unknown asset: ${name}`);
  const a = { name, ...gen() };
  assertPalette(a.pixmap, name);
  return a;
}

export function generateAll(): GeneratedAsset[] {
  return ASSET_NAMES.map(generateAsset);
}
