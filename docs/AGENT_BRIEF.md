# DOUBLE OUT — build brief for parallel workers

Read `docs/DOUBLE_OUT_TDD.md` first. It is the specification. This file adds the
project conventions and the module contracts that already exist so that work
done in parallel fits together.

## Ground rules

- TypeScript, strict. `npm run typecheck` must pass for your files. Node 22 is
  installed; run TypeScript files directly with `node --experimental-strip-types file.ts`
  (use `.ts` extensions in relative imports inside `tools/` and `tests/`, but plain
  extensionless imports inside `src/`), or `npx vite-node file.ts`.
- Tests: vitest (`npx vitest run tests/foo.test.ts`).
- `/src/core` must never import from `/src/ui`, `/src/art`, `/src/audio`.
- Zero runtime dependencies. Build deps only: vite, typescript, vitest, pngjs.
- No `Math.random()` in game logic. Cosmetic randomness uses a separate mulberry32 (`src/core/rng.ts`).
- No real people, leagues, brands, sponsors, venues, or commentators. No gambling words (bet, odds, wager, stake, bookie, punt).
- Art: every pixel is one of the 16 palette indices in `src/art/palette.ts` or `TRANSPARENT` (255).
- Only touch the files you are told you own. If you find a bug elsewhere, report it in your final output instead of editing.
- Record any choice the TDD leaves open in `docs/decisions/<your-area>.md` (short bullet list).

## Existing contracts (do not change these files)

- `src/core/types.ts` — all normative types + `EngineEvent`, `BarkContext`, `BarkTrigger`, `NightState` extras.
- `src/core/rng.ts` — `createRng`, `nextFloat`, `nextInt`, `shuffle`, `pickWeighted`, `seedToString`, `parseSeed`.
- `src/core/board.ts` — `BED_ORDER` helpers, `baseValue`, `targetNotation`, `parseTarget`, `ALL_TARGETS`.
- `src/core/resolver.ts` — `resolveThrow(card, ctx)`, `handSizeFor(chalk)`, `throwsPerVisitFor(chalk)`.
- `src/core/deck.ts` — `drawHand`, `commitFromHand`, `legPool`.
- `src/core/rules.ts` — `potReward(leg)`, `classifyBase(score, target)`, `isFinishableBase`.
- `src/core/checkout.ts` — `computeCheckoutHints(night, leg)`.
- `src/core/state.ts` — the night state machine:
  - `createNight(seed, oche)`, `beginLeg(n)`, `commitCard(n, cardId)` → `{result, events}`,
  - `shopBuy(n, slotIndex, {cardId?, replaceChalkId?})`, `shopRefresh(n)`, `shopLeave(n)`,
  - `currentLeg(n)`, `currentVisit(leg)`, `addChalk(n, id)`, `hasChalk`, `visitTotal`, `legName`,
  - `n.phase` is `'LEG' | 'SHOP' | 'OVER'`; `n.status` is `'ACTIVE' | 'WON' | 'LOST'`.
- `src/content/chalkdefs.ts` — `CHALK_DEFS`, `chalkDef(id)`.
- `src/content/cards.ts` — `cardDef(defId)`, `cardCost`, `STARTING_LIBRARY`, `SHOP_CARD_POOL`, `sharpenedDefId`, `makeCard`.
- `src/content/legs.ts` — `LEGS`, `STARTING_SCORE`, service costs.
- `src/content/oches.ts` — `OCHES`.
- `src/art/palette.ts` — `PALETTE_HEX`, `P` (index constants), `Pixmap`, `createPixmap`, `px`, `getPx`, `assertPalette`, `BAYER4`, `TRANSPARENT`.
- `src/art/glyphs5x7.ts`, `src/art/glyphs9x12.ts` — `GLYPHS_5X7`, `GLYPHS_9X12: Record<string, number[]>` (row bitmasks, MSB = left).
- `tools/fontpreview.ts` — prints glyphs as ASCII art and validates coverage.

## Contracts for modules being written now (other workers depend on these exact names)

### Audio — `src/audio/sfx.ts`, `src/audio/defs.ts`, `src/audio/voice.ts`

```ts
export type SfxName =
  | 'throw' | 'thud' | 'wire' | 'card_deal' | 'card_select' | 'chalk_fire' | 'bust' | 'checkout'
  | 'one_eighty' | 'crowd_roar' | 'ui_move' | 'ui_confirm' | 'ui_back' | 'pot' | 'shop_buy'
  | 'shop_refresh' | 'tick' | 'whoosh' | 'error' | 'unlock' | 'win_fanfare' | 'lose_sting' | 'card_flip';

export class AudioEngine {
  constructor();
  /** Call from a user gesture. Creates or resumes the AudioContext. Safe to call repeatedly. Never throws. */
  unlock(): void;
  readonly ready: boolean;
  play(name: SfxName, opts?: { pitch?: number; volume?: number; delay?: number }): void;
  /** Ascending blip: chainIndex 0,1,2… each a musical step higher. A 5-chalk chain is an arpeggio. */
  chalkFire(chainIndex: number): void;
  /** Crowd murmur bed. 0..1 tension controls amplitude/brightness. Loop starts lazily. */
  setCrowdTension(t: number): void;
  /** Filtered noise burst. intensity 0..1. */
  crowdRoar(intensity: number): void;
  /** Voice blip for one character during a bark reveal. Returns the ms to wait before the next character. */
  blip(speaker: 'BARREL' | 'NOCK', ch: string): number;
  setMasterVolume(v: number): void;
  setSfxVolume(v: number): void;
  setVoiceVolume(v: number): void;
  setMuted(m: boolean): void;
  readonly muted: boolean;
}
```

All sounds are synthesised with the Web Audio API from parameter objects in `defs.ts` (sfxr-style: waveform, envelope, frequency slide, vibrato, noise mix, lowpass). No audio files. Everything must be a no-op (never throw) when `AudioContext` is undefined (Node, tests) or before `unlock()`.

### Commentary — `src/content/barks.ts`, `src/core/commentary.ts`

```ts
// src/content/barks.ts
export const BARKS: BarkTrigger[];             // ≥ 120 lines total across all triggers

// src/core/commentary.ts
export interface Bark { speaker: 'BARREL' | 'NOCK'; text: string; triggerId: string; priority: number }
export class Commentary {
  constructor(cosmeticSeed: number, triggers?: BarkTrigger[]);
  /** Evaluate all triggers; returns 0–2 barks (main + optional reply). Honours priority, per-trigger cooldown, and never repeats a line within 8 events. */
  react(ctx: BarkContext): Bark[];
}
export function buildBarkContext(night: NightState, event: BarkContext['event'], throwResult?: ThrowResult): BarkContext;
```

Required trigger ids (exact): `visit_180`, `visit_26`, `checkout_100`, `checkout_leg8`, `bust_1`, `bust_2`, `bust_3`, `bust_4plus`, `chalk_chain_4`, `score_170`, `score_1`, `nine_darter`, `timeout_leg8`, `shop_zero_pot`, `idle_15`. Plus extra triggers for texture (leg intros, generic checkout, generic timeout on legs 1–7 — kind, not mocking —, high visit ≥ 140, low visit ≤ 30, wired deflection, split tips, first chalk fired, shop entered, night start, big pot, etc.).

### Bots — `src/core/bot.ts`

```ts
export type Policy = 'greedy' | 'checkout' | 'optimal';
export function chooseCard(n: NightState, leg: LegState, policy: Policy): DartCard;
/** Spend pot in the open shop with a sensible heuristic for the policy (cards that raise average value, doubles the deck lacks, chalk that fits). */
export function botShop(n: NightState, policy: Policy): void;
export interface NightOutcome { status: 'WON' | 'LOST'; legsWon: number; oneEighties: number; busts: number; chalkHeld: string[]; seed: number; throws: number }
export function playNight(seed: number, policy: Policy, opts?: { oche?: OcheId; startLeg?: number; startChalk?: string[]; shop?: boolean; extraCards?: string[] }): NightOutcome;
export function simulate(seeds: number[], policy: Policy, opts?): { winRate: number; legWinRates: number[]; median180s: number; meanBusts: number; outcomes: NightOutcome[] };
```

### Art generators — `src/art/gen/*.ts`, `src/art/gen/index.ts`, `tools/genart.ts`

```ts
// src/art/gen/index.ts
export interface GeneratedAsset { name: string; pixmap: Pixmap; frames?: number; frameW?: number; frameH?: number; nineSlice?: { l: number; t: number; r: number; b: number } }
export function generateAll(): GeneratedAsset[];   // deterministic, no Math.random, no Date
export function generateAsset(name: string): GeneratedAsset;
```

`tools/genart.ts` writes each asset to `assets/generated/<name>.png` via pngjs (palette indices → RGBA, TRANSPARENT → alpha 0), asserting palette compliance and writing `assets/generated/manifest.json` (name, w, h, frames, frameW, frameH, nineSlice, sha256 of pixel data). Running it twice must produce byte-identical files.
