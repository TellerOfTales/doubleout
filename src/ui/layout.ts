/**
 * Screen layouts for landscape (320×180) and portrait (180×320), TDD §13.
 * Every rect is in internal pixels. The remaining score is always the largest
 * element on screen.
 *
 * The board is no longer decoration. Since the rebuild it is the input
 * surface: you aim at it directly, so it gets the whole left column in
 * landscape and the top third in portrait, and the strip that used to hold a
 * hand of dealt cards now holds the slate.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GameLayout {
  orientation: 'landscape' | 'portrait';
  w: number;
  h: number;
  chrome: Rect;
  /** The board sprite name and where its top-left goes. */
  boardName: string;
  boardNumbersName: string;
  board: Rect; // the board itself (96×96) — tap it to aim
  boardCentre: { x: number; y: number };
  boardRadius: number;
  scoreLabel: { x: number; y: number };
  score: Rect;
  checkoutLine: { x: number; y: number; w: number };
  visitLine: { x: number; y: number; w: number };
  /** The slate: contracts on offer, or contracts riding. */
  slate: Rect;
  /** The kit strip: one-shot interventions. */
  kit: Rect;
  chalkStrip: Rect;
  /** What the aimed target is and what it would leave. */
  aimBar: Rect;
  /**
   * The accuracy meter: a tall thin column beside the board, where the marker
   * sweeps and the dart is timed. It is vertical because the axis it measures
   * is vertical — high is long, low is short — and it sits beside the board
   * because the eye has to hold both at once.
   */
  meter: Rect;
  readout: Rect;
  /** Commit the dart. */
  throwBtn: Rect;
  /** Throw it at the wall on purpose and end the visit. */
  miss: Rect;
  commentary: Rect;
  /** Where the dart launches from when thrown. */
  launch: { x: number; y: number };
}

/** One contract card on the slate. */
export const SLATE_W = 68;
export const SLATE_H = 62;

export function gameLayout(w: number, h: number): GameLayout {
  if (w >= h) {
    // ---- landscape 320×180 ----
    // The board moved twelve pixels right to make a column for the meter, and
    // the scoreboard column gave up the same twelve. Nothing else changed.
    const board: Rect = { x: 14, y: 15, w: 96, h: 96 };
    return {
      orientation: 'landscape',
      w,
      h,
      chrome: { x: 0, y: 0, w, h: 12 },
      boardName: 'board_96',
      boardNumbersName: 'board_numbers_96',
      board,
      boardCentre: { x: board.x + 48, y: board.y + 48 },
      boardRadius: 46,
      scoreLabel: { x: 118, y: 14 },
      score: { x: 114, y: 18, w: 204, h: 28 },
      checkoutLine: { x: 118, y: 48, w: 198 },
      visitLine: { x: 118, y: 56, w: 198 },
      slate: { x: 114, y: 64, w: 204, h: SLATE_H },
      kit: { x: 3, y: 113, w: 108, h: 12 },
      aimBar: { x: 3, y: 127, w: 108, h: 17 },
      meter: { x: 2, y: 15, w: 9, h: 96 },
      throwBtn: { x: 3, y: 145, w: 73, h: 12 },
      miss: { x: 79, y: 145, w: 32, h: 12 },
      chalkStrip: { x: 114, y: 128, w: 130, h: 18 },
      readout: { x: 114, y: 147, w: 204, h: 10 },
      commentary: { x: 0, y: 158, w, h: 22 },
      launch: { x: 61, y: 150 },
    };
  }
  // ---- portrait 180×320 ----
  const board: Rect = { x: 42, y: 14, w: 96, h: 96 };
  return {
    orientation: 'portrait',
    w,
    h,
    chrome: { x: 0, y: 0, w, h: 12 },
    boardName: 'board_96',
    boardNumbersName: 'board_numbers_96',
    board,
    boardCentre: { x: board.x + 48, y: board.y + 48 },
    boardRadius: 46,
    scoreLabel: { x: 6, y: 112 },
    score: { x: 0, y: 116, w, h: 28 },
    checkoutLine: { x: 6, y: 145, w: 168 },
    visitLine: { x: 6, y: 153, w: 168 },
    slate: { x: 0, y: 161, w, h: SLATE_H },
    kit: { x: 4, y: 225, w: 172, h: 12 },
    chalkStrip: { x: 4, y: 239, w: 130, h: 18 },
    aimBar: { x: 4, y: 259, w: 172, h: 17 },
    meter: { x: 27, y: 14, w: 9, h: 96 },
    throwBtn: { x: 4, y: 278, w: 108, h: 14 },
    miss: { x: 116, y: 278, w: 60, h: 14 },
    readout: { x: 4, y: 294, w: 172, h: 9 },
    commentary: { x: 0, y: 305, w, h: 15 },
    launch: { x: 90, y: 292 },
  };
}

/**
 * Contract slots across the slate. They shrink to fit as Wide Grip adds a
 * fourth, so the extra contract never pushes the row off the panel.
 */
/**
 * Contract slots across the slate. They shrink to fit as Wide Grip adds a
 * fourth, so the extra contract never pushes the row off the panel.
 *
 * The wire takes one of these slots rather than a sliver of every one of them.
 * Squeezing a fifth column in to make room for it cost every contract a fifth
 * of its writing space, which on a portrait phone is the difference between a
 * condition on three lines and a condition cut off with an ellipsis. Money
 * already won occupying a place on the slate is also simply what is happening.
 */
export function slateSlots(l: GameLayout, n: number): Rect[] {
  if (n <= 0) return [];
  const gap = n >= 4 ? 3 : 4;
  const cw = Math.min(SLATE_W, Math.floor((l.slate.w - 6 - (n - 1) * gap) / n));
  const total = n * cw + (n - 1) * gap;
  const start = l.slate.x + Math.floor((l.slate.w - total) / 2);
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) out.push({ x: start + i * (cw + gap), y: l.slate.y, w: cw, h: l.slate.h });
  return out;
}

/** Kit chips along the kit strip. Three letters wide, so they can be read. */
export function kitChips(l: GameLayout, n: number): Rect[] {
  const gap = 2;
  const size = n > 0 ? Math.min(20, Math.floor((l.kit.w - (n - 1) * gap) / n)) : 20;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) out.push({ x: l.kit.x + i * (size + gap), y: l.kit.y, w: size, h: l.kit.h });
  return out;
}

/** Chalk chip rects for up to `slots` chips. */
export function chalkChips(l: GameLayout, slots: number): Rect[] {
  const size = 18;
  const gap = 2;
  const out: Rect[] = [];
  for (let i = 0; i < slots; i++) out.push({ x: l.chalkStrip.x + i * (size + gap), y: l.chalkStrip.y + 1, w: size, h: size });
  return out;
}

export function centreRect(w: number, h: number, boxW: number, boxH: number): Rect {
  return { x: Math.floor((w - boxW) / 2), y: Math.floor((h - boxH) / 2), w: boxW, h: boxH };
}
