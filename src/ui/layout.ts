/**
 * Screen layouts for landscape (320×180) and portrait (180×320), TDD §13.
 * Every rect is in internal pixels. The remaining score is always the
 * largest element on screen.
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
  board: Rect; // the board itself (96×96)
  boardCentre: { x: number; y: number };
  boardRadius: number; // outer edge radius in pixels (for hit placement)
  scoreLabel: { x: number; y: number };
  score: Rect; // area for the big number (centre alignment)
  checkoutLine: { x: number; y: number; w: number };
  visitLine: { x: number; y: number; w: number };
  hand: Rect; // area that holds the cards
  cardW: number;
  cardH: number;
  chalkStrip: Rect;
  readout: Rect; // pipeline readout / hint text
  /** The deliberate-miss button (throw at the wall). */
  miss: Rect;
  /** The pocket button: set one card aside for a later visit. */
  pocket: Rect;
  commentary: Rect;
  /** Where the dart launches from when thrown (above the hand). */
  launch: { x: number; y: number };
}

export const CARD_W = 40;
export const CARD_H = 56;

export function gameLayout(w: number, h: number): GameLayout {
  if (w >= h) {
    // ---- landscape 320×180 ----
    const board: Rect = { x: 10, y: 22, w: 96, h: 96 };
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
      scoreLabel: { x: 128, y: 16 },
      score: { x: 124, y: 25, w: 192, h: 36 },
      checkoutLine: { x: 128, y: 63, w: 184 },
      visitLine: { x: 128, y: 72, w: 184 },
      hand: { x: 124, y: 82, w: 192, h: CARD_H },
      cardW: CARD_W,
      cardH: CARD_H,
      chalkStrip: { x: 2, y: 132, w: 132, h: 24 },
      readout: { x: 138, y: 140, w: 94, h: 18 },
      pocket: { x: 236, y: 140, w: 40, h: 16 },
      miss: { x: 280, y: 140, w: 38, h: 16 },
      commentary: { x: 0, y: 160, w, h: 20 },
      launch: { x: 220, y: 80 },
    };
  }
  // ---- portrait 180×320 ----
  const board: Rect = { x: 42, y: 22, w: 96, h: 96 };
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
    scoreLabel: { x: 6, y: 132 },
    score: { x: 0, y: 134, w, h: 36 },
    checkoutLine: { x: 6, y: 172, w: 168 },
    visitLine: { x: 6, y: 180, w: 168 },
    hand: { x: 0, y: 190, w, h: CARD_H },
    cardW: CARD_W,
    cardH: CARD_H,
    chalkStrip: { x: 4, y: 248, w: 172, h: 24 },
    readout: { x: 4, y: 270, w: 172, h: 12 },
    pocket: { x: 88, y: 248, w: 44, h: 18 },
    miss: { x: 134, y: 248, w: 42, h: 18 },
    commentary: { x: 0, y: 284, w, h: 36 },
    launch: { x: 90, y: 190 },
  };
}

/**
 * Card slots, centred in the hand area. Cards shrink to fit as the hand grows,
 * so a pocketed sixth card never pushes the row off the panel.
 */
export function cardSlots(l: GameLayout, n: number): Rect[] {
  if (n <= 0) return [];
  const gap = n >= 6 ? 2 : n >= 4 ? 3 : 8;
  const w = Math.min(l.cardW, Math.floor((l.hand.w - (n - 1) * gap) / n));
  const total = n * w + (n - 1) * gap;
  const start = l.hand.x + Math.floor((l.hand.w - total) / 2);
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) out.push({ x: start + i * (w + gap), y: l.hand.y, w, h: l.cardH });
  return out;
}

/** Chalk chip rects for up to `slots` chips. */
export function chalkChips(l: GameLayout, slots: number): Rect[] {
  const size = 20;
  const gap = 2;
  const out: Rect[] = [];
  for (let i = 0; i < slots; i++) out.push({ x: l.chalkStrip.x + i * (size + gap), y: l.chalkStrip.y + 2, w: size, h: size });
  return out;
}

export function centreRect(w: number, h: number, boxW: number, boxH: number): Rect {
  return { x: Math.floor((w - boxW) / 2), y: Math.floor((h - boxH) / 2), w: boxW, h: boxH };
}
