# DOUBLE OUT — Technical Design Document

**Version:** 1.0
**Status:** Build-ready specification
**Intended reader:** An autonomous build agent. Everything required to produce a shippable v1 is in this document. Where a value is not specified here, the implementer chooses and records the choice in `DECISIONS.md`.

---

## 0. Non-negotiable build constraints

| # | Constraint | Meaning |
|---|---|---|
| C1 | **2D only** | No 3D geometry, no perspective, no depth buffer. All rendering is orthographic 2D canvas blitting. |
| C2 | **Pixel art only** | Fixed internal resolution, integer scaling, nearest-neighbour filtering. No vector art, no anti-aliasing, no sub-pixel positioning of sprites. |
| C3 | **Zero cost** | Every tool, library, font, and asset in the project must be free to use commercially with no fee, no royalty, and no attribution obligation that cannot be satisfied by a text file in the build. |
| C4 | **Entirely autonomously sourced art** | No human artist. No purchased assets. No AI image generation service. All visual assets are produced at build time by deterministic generator code committed to the repository. See §12. |
| C5 | **No third-party intellectual property** | No real people, no real leagues, organisations, tournaments, sponsors, venues, or brands. No logos. All names invented. See §12.7. |
| C6 | **Offline-capable** | The finished build runs with no network connection and no account. No telemetry, no advertising, no in-app purchases, no energy timers, no daily login rewards. |

Constraint C4 is the one most likely to be violated by accident. The test: **delete every file in `assets/generated/` and run `npm run build`. If the game does not look identical afterwards, the constraint has been broken.**

---

## 1. Product summary

**DOUBLE OUT** is a single-player roguelite built on the folk ruleset of 501 darts. The player works a score down from 501 to exactly zero, finishing on a double, within a shrinking visit limit. The player does not aim. Throws are dealt from a deck the player builds, and the board is progressively corrupted by modifiers until the arithmetic stops making sense.

- **Session length:** one leg is 60–180 seconds. One full night (a run) is 25–40 minutes.
- **Total content:** finite. A night can be won. The game says so and stops.
- **Tone:** affectionate pub comedy, delivered entirely by a two-commentator bark system (§11). No dialogue trees, no cutscenes, no required reading.
- **Platform:** browser-first, portrait-capable, designed for touch. Desktop keyboard/mouse supported.

---

## 2. Core loop

```
NIGHT (run)
  └── LEG × 8            ← escalating visit limit
        └── VISIT × N     ← N = visit limit for this leg
              └── THROW × 3
                    ├── deal HAND_SIZE cards from throw deck
                    ├── player commits exactly one
                    ├── resolve modifiers (§9)
                    └── subtract from remaining score
        └── leg resolves: CHECKOUT / BUST-OUT / TIMEOUT
  └── SHOP  ← between legs: buy cards, buy chalk, remove cards
  └── NIGHT resolves: WIN (leg 8 checked out) / LOSS (any leg timed out)
```

The loop the player feels: *deal → read the board → commit → watch the modifiers chain → recalculate.*

---

## 3. Rules — base ruleset

### 3.1 The board

Twenty numbered beds arranged clockwise from the top:

```
20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5
```

Each bed has three regions:

| Region | Multiplier | Notation |
|---|---|---|
| Single | ×1 | `S20` = 20 |
| Double (outer ring) | ×2 | `D20` = 40 |
| Treble (inner ring) | ×3 | `T20` = 60 |

Plus two centre targets:

| Target | Value | Counts as a double? |
|---|---|---|
| Outer bull | 25 | No |
| Inner bull (`BULL`) | 50 | **Yes** — inner bull is treated as double 25 |

Maximum single-throw value: 60 (`T20`). Maximum visit: 180.

### 3.2 Scoring

The player starts each leg at **501**. Every committed throw subtracts its final resolved value (§9) from the remaining score.

### 3.3 The corruption — dealt throws

The player never aims. Instead:

- The player holds a **throw deck** of `DartCard`s. Each card names a board region (e.g. `T20`, `S7`, `D16`, `BULL`).
- At the start of each throw, `HAND_SIZE` cards (default **3**) are drawn from the deck.
- The player **commits exactly one**. The uncommitted cards go to the discard pile.
- Deck is reshuffled from the discard pile when it empties.
- Deck state persists across visits within a leg. Deck is fully reshuffled at the start of each leg.

**Design intent:** the deck is the player's skill. Buying `T20` cards is literally practising. Removing `S1` cards is literally getting rid of a bad habit.

### 3.4 Bust

A **visit** busts if, after any throw in that visit, the remaining score is:

- less than 0, **or**
- exactly 1 (unreachable — no double finishes 1), **or**
- exactly 0 but the finishing throw was **not** a double or inner bull.

**On bust:** the remaining score reverts to its value at the *start of the visit*. The visit ends immediately (remaining throws are forfeited). The visit still counts against the visit limit.

Bust is the core tension. It is a rule every darts-literate player already knows and already finds agonising, and it costs the design nothing to author.

### 3.5 Checkout

A leg is won when the remaining score reaches **exactly 0** on a throw whose resolved region is a **double** or the **inner bull**.

The maximum checkout from 501 in three visits is a known folk fact and should be surfaced in the interface as a **checkout hint**: for any remaining score ≤ 170, display the canonical shortest finishing route given the player's current deck contents. This is an accessibility feature, not a hint system — darts players do this arithmetic reflexively and non-players cannot. Default: **on**. Toggleable.

---

## 4. Run structure

A **night** is 8 legs. Each leg has a visit limit. Fail any leg and the night ends.

| Leg | Name | Visit limit | Pot reward (base) |
|---|---|---|---|
| 1 | First Round | 12 | 3 |
| 2 | Second Round | 11 | 4 |
| 3 | Quarter | 10 | 5 |
| 4 | **Interval** | 9 | 6 |
| 5 | Semi | 8 | 8 |
| 6 | Last Four | 7 | 10 |
| 7 | Final | 6 | 12 |
| 8 | **The Decider** | 5 | — (win) |

Reaching 501→0 in 5 visits requires an average of 100.2 per visit. This is deliberately at the edge of what an unmodified deck can do — leg 8 is intended to be unwinnable without a functioning modifier engine.

**Pot bonuses**, added to the base reward:

- `+1` per unused visit
- `+2` if the checkout was 100 or higher ("a big finish")
- `+3` if the leg contained zero busts ("a clean leg")
- `+5` for a nine-darter (three visits, 501 checked out) — should be near-impossible without a strong build

### 4.1 The shop

Appears after every leg except the last. Offers 4 slots, refreshable once per shop for 1 Pot:

- **2 × DartCard** — added to the throw deck
- **1 × Chalk** (modifier) — see §5
- **1 × Service** — one of: *Remove a card* (2 Pot), *Duplicate a card* (4 Pot), *Sharpen* (upgrade a card's region one tier: single→treble→double) (5 Pot)

The player has **5 chalk slots**. A sixth purchase requires discarding one. Chalk is never lost otherwise.

---

## 5. Chalk — the modifier layer

Chalk modifies the resolution pipeline (§9). Each entry below specifies the pipeline **stage** it hooks, which determines resolution order.

### 5.1 Value chalk (stage: VALUE)

| ID | Name | Effect | Cost |
|---|---|---|---|
| `hot_twenty` | Hot Twenty | Trebles in the 20 bed resolve ×4 instead of ×3 | 6 |
| `feathered` | Feathered | Doubles resolve ×3 instead of ×2 (still count as doubles for checkout) | 7 |
| `heavy_tips` | Heavy Tips | +5 to every resolved throw | 5 |
| `oiled` | Oiled | Odd-numbered beds resolve +50% (rounded down) | 6 |
| `even_keel` | Even Keel | Even-numbered beds resolve +50% (rounded down) | 6 |
| `cold_hands` | Cold Hands | First throw of each visit resolves ×0. Second and third resolve ×2 | 6 |
| `last_orders` | Last Orders | Third throw of each visit resolves ×2 | 7 |
| `bullish` | Bullish | Both bulls resolve at 75 | 5 |

### 5.2 Board chalk (stage: BOARD) — resolves before VALUE

| ID | Name | Effect | Cost |
|---|---|---|---|
| `wired` | Wired | 25% chance a throw deflects into the clockwise-adjacent bed, keeping its region | 4 |
| `split_tips` | Split Tips | Every throw also hits the anticlockwise-adjacent bed as a single. Both values subtract | 8 |
| `magnetised` | Magnetised | Any throw that would resolve under 10 is redirected to `S20` | 6 |
| `narrow_beds` | Narrow Beds | Singles become trebles; trebles become singles | 7 |
| `wide_doubles` | Wide Doubles | Any throw in the 16, 18 or 20 beds counts as a double for checkout purposes | 9 |
| `mirrored` | Mirrored | Throws resolve against the bed directly opposite on the board | 5 |

### 5.3 Rule chalk (stage: RULE) — resolves after VALUE, alters bust/checkout law

| ID | Name | Effect | Cost |
|---|---|---|---|
| `cheap_chalk` | Cheap Chalk | Busting reduces the remaining score to 2 instead of reverting | 8 |
| `forgiving_oche` | Forgiving Oche | The first bust of each leg is ignored entirely; the visit continues | 7 |
| `straight_out` | Straight Out | Checkout no longer requires a double | 10 |
| `overshoot` | Overshoot | Going below zero by 2 or less counts as a checkout | 9 |
| `chalk_dust` | Chalk Dust | Remaining score of exactly 1 is legal; treat as 2 | 4 |

### 5.4 Deck chalk (stage: DEAL) — resolves before the hand is dealt

| ID | Name | Effect | Cost |
|---|---|---|---|
| `wide_grip` | Wide Grip | `HAND_SIZE` becomes 4 | 8 |
| `tunnel_vision` | Tunnel Vision | `HAND_SIZE` becomes 2, but all resolved values +20% | 6 |
| `fourth_dart` | Fourth Dart | Visits have 4 throws instead of 3 | 12 |
| `practice_board` | Practice Board | Uncommitted cards return to the deck instead of the discard pile | 5 |
| `chalked_up` | Chalked Up | At the start of each visit, peek at the top 3 cards of the deck | 4 |

### 5.5 Chalk interaction rules

1. Chalk within the same stage resolves in **acquisition order** (oldest first). The interface displays chalk left-to-right in acquisition order so the player can read the pipeline.
2. Chalk is never conditional on other chalk. There are no chalk-modifying-chalk cards in v1.
3. Two copies of the same chalk cannot be held.
4. `narrow_beds` and `feathered` deliberately combine badly. This is fine and should not be patched — discovering a dead combination is part of the learning.

---

## 6. Data types

TypeScript. These are normative — the implementer must use these shapes.

```ts
// ---------- Board ----------

/** Clockwise from the top of the board. Index is position, value is bed number. */
export const BED_ORDER = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5] as const;

export type Bed = typeof BED_ORDER[number];          // 1..20
export type Region = 'S' | 'D' | 'T' | 'OB' | 'IB';  // single, double, treble, outer bull, inner bull

export interface Target {
  region: Region;
  /** Undefined for OB and IB. */
  bed?: Bed;
}

// ---------- Cards ----------

export interface DartCard {
  id: string;              // uuid, unique per instance
  defId: string;           // e.g. "t20" — shared by all copies
  target: Target;
  /** Cosmetic only. Drives flight-trail palette index. */
  flight: 0 | 1 | 2 | 3;
}

// ---------- Chalk ----------

export type ChalkStage = 'DEAL' | 'BOARD' | 'VALUE' | 'RULE';

export interface ChalkDef {
  id: string;
  name: string;
  stage: ChalkStage;
  cost: number;
  /** Short player-facing text. Max 64 chars. Must be readable at 5x7 font, 2 lines. */
  blurb: string;
}

export interface Chalk {
  def: ChalkDef;
  /** Acquisition index. Lower resolves first within a stage. */
  order: number;
}

// ---------- Throw resolution ----------

export interface ThrowIntent {
  card: DartCard;
  visitThrowIndex: 0 | 1 | 2 | 3;   // 3 only reachable with fourth_dart
}

export interface ResolvedHit {
  /** May differ from the intent's target after BOARD-stage chalk. */
  target: Target;
  value: number;
  /** True if this hit satisfies checkout law, after RULE-stage chalk. */
  countsAsDouble: boolean;
}

export interface ThrowResult {
  intent: ThrowIntent;
  /** Usually length 1. Length 2 with split_tips. */
  hits: ResolvedHit[];
  totalValue: number;
  scoreBefore: number;
  scoreAfter: number;
  outcome: 'CONTINUE' | 'CHECKOUT' | 'BUST';
  /** Ordered list of chalk ids that fired. Drives commentary and the pipeline readout. */
  firedChalk: string[];
}

// ---------- Game state ----------

export interface VisitState {
  index: number;
  scoreAtVisitStart: number;
  throws: ThrowResult[];
  busted: boolean;
}

export interface LegState {
  index: number;             // 0..7
  visitLimit: number;
  score: number;             // remaining, starts at 501
  visits: VisitState[];
  deck: DartCard[];
  discard: DartCard[];
  hand: DartCard[];
  bustsThisLeg: number;
  forgivenessUsed: boolean;  // for forgiving_oche
  status: 'ACTIVE' | 'CHECKED_OUT' | 'TIMED_OUT';
}

export interface NightState {
  seed: number;
  legIndex: number;
  pot: number;
  library: DartCard[];       // the persistent throw deck across legs
  chalk: Chalk[];            // max 5
  legs: LegState[];
  status: 'ACTIVE' | 'WON' | 'LOST';
}
```

### 6.1 Starting library

24 cards. Deliberately mediocre — the player must improve it.

| Card | Copies |
|---|---|
| `S20` | 3 |
| `S19` | 2 |
| `S18` | 2 |
| `S16` | 2 |
| `S12` | 2 |
| `S7`  | 2 |
| `S5`  | 2 |
| `S1`  | 2 |
| `S3`  | 2 |
| `T20` | 1 |
| `T19` | 1 |
| `D16` | 1 |
| `D20` | 1 |
| `OB`  | 1 |

Mean card value ≈ 15.5. Mean visit ≈ 46.5 with naive play, ≈ 62 with optimal selection from a 3-card hand. 501 ÷ 62 ≈ 8.1 visits — comfortably inside leg 1's limit of 12, comfortably outside leg 8's limit of 5.

---

## 7. Resolution pipeline

**This section is the most important in the document. Determinism depends on it.** Resolve in exactly this order:

```
1. DEAL stage
   1.1 Apply DEAL chalk to compute HAND_SIZE and throw count
   1.2 Draw hand from deck (reshuffle discard if deck is short)
   1.3 Present hand to player

2. Player commits one card → ThrowIntent

3. BOARD stage  (may change WHICH target was hit)
   3.1 For each BOARD chalk in acquisition order:
       - mutate the target, or
       - append an additional target (split_tips)
   3.2 Result: array of Targets, length ≥ 1

4. VALUE stage  (computes numbers)
   4.1 For each Target, compute base value = bed × regionMultiplier
   4.2 For each VALUE chalk in acquisition order, apply to each value
   4.3 Floor all values. Values are integers throughout. Never round up.
   4.4 totalValue = sum of values

5. Subtract: scoreAfter = scoreBefore − totalValue

6. RULE stage  (decides what the number means)
   6.1 Determine countsAsDouble for the final hit (wide_doubles, straight_out)
   6.2 Evaluate checkout: scoreAfter === 0 && countsAsDouble → CHECKOUT
   6.3 Evaluate bust conditions in order:
        scoreAfter < 0            → BUST (unless overshoot and scoreAfter >= -2)
        scoreAfter === 1          → BUST (unless chalk_dust)
        scoreAfter === 0 && !countsAsDouble → BUST (unless straight_out)
   6.4 Apply bust consequences (cheap_chalk, forgiving_oche)

7. Commit ThrowResult, emit commentary events (§11)
```

**Ordering hazards the implementer must handle:**

- `split_tips` creates two hits. Checkout law applies to the **last** hit in the array only. Both values subtract. This means split_tips actively makes checking out harder, which is intended — it's a scoring card, not a finishing card.
- `magnetised` is BOARD stage but references a value. Evaluate it against the **base** value (bed × multiplier), before VALUE chalk. Document this in a code comment; it will be got wrong otherwise.
- `cheap_chalk` and `forgiving_oche` stack: forgiveness is checked first, and if forgiveness fires, cheap chalk does not.
- Never apply a VALUE chalk twice to the same hit, even if it could arguably qualify twice (e.g. `oiled` on a split_tips pair — it applies once per hit, not once per throw).

---

## 8. Randomness

- Single seeded generator, **mulberry32**, seeded from `NightState.seed`.
- One generator instance per night. Never `Math.random()` anywhere in game logic.
- Draw order: the generator is consumed by, in order: shuffles, `wired` deflection rolls, shop offer generation. Commentary selection uses a **separate** generator instance so that cosmetic variety never desynchronises gameplay.
- A seed string is displayed on the results screen and can be entered on the title screen. Same seed + same inputs must produce an identical night. This is the primary regression test (§17).

---

## 9. Fail and win states

### 9.1 Leg fail — TIMED_OUT
Visit limit reached with score > 0. The leg ends. **The night ends.**

Nothing decays, nothing is confiscated, no progress is deducted. The results screen shows the seed and a single button: **AGAIN**. Retry must be reachable in one input from the fail screen, in under 400 ms.

### 9.2 Leg win — CHECKED_OUT
Score reaches exactly 0 on a legal double. Pot awarded. Shop opens.

### 9.3 Night win
Leg 8 checked out. Win screen, credits, and the game states plainly that it is over. **No endless mode, no ascension ladder, no post-game grind in v1.** Finiteness is a marketed feature.

### 9.4 Meta-progression
The only persistent unlock is **oches** — alternate starting configurations, each unlocked by a specific in-run achievement. Five total:

| Oche | Unlock condition | Starting change |
|---|---|---|
| The Local | default | — |
| The Sharp | win a leg with a 100+ checkout | start with `T18`, `T17` instead of two `S1` |
| The Steady | win a night with zero busts | `forgiving_oche` free at start |
| The Wide | hold 5 chalk simultaneously | 6 chalk slots, +2 all card costs |
| The Thin | win a leg in 6 visits or fewer | library of 12 cards instead of 24 |

Oches change the starting position only. They never grant power that carries into a run already in progress.

---

## 10. Commentary system

The comedy vehicle. Two commentators, always both present, no portraits required to be expressive — the writing carries it.

### 10.1 Characters

- **BARREL** — the excitable one. Loses professional composure early and often. Speaks in escalating superlatives. Cannot do arithmetic.
- **NOCK** — the analyst. Attempts to explain what is happening. Increasingly cannot. Dry, precise, quietly devastated by leg 8.

Names are invented and must not be changed to anything resembling a real commentator.

### 10.2 Architecture

```ts
export interface BarkTrigger {
  id: string;
  speaker: 'BARREL' | 'NOCK';
  /** Higher fires first when several match. */
  priority: number;
  /** Pure predicate over game state. No side effects. */
  when: (ctx: BarkContext) => boolean;
  /** Pool of variants. Chosen by the cosmetic RNG. */
  lines: string[];
  /** Do not repeat this trigger for N events. */
  cooldown: number;
}

export interface BarkContext {
  throwResult?: ThrowResult;
  leg: LegState;
  night: NightState;
  visitTotal: number;
  consecutiveBusts: number;
  chalkFiredCount: number;
}
```

### 10.3 Required trigger set (minimum 120 barks in v1)

| Trigger | Priority | Notes |
|---|---|---|
| Visit total = 180 | 100 | **Must** be the loudest event in the game. Full-screen, screen shake, both commentators. Should become common in a strong build — the joke is the frequency. |
| Visit total = 26 (the classic bad visit) | 90 | NOCK pretends not to have seen it |
| Checkout ≥ 100 | 95 | |
| Checkout on leg 8 | 100 | Win bark |
| Bust | 70 | Escalates with `consecutiveBusts`: 1 = teasing, 2 = concern, 3 = silence with a single word, 4+ = BARREL supportively changing the subject entirely |
| ≥ 4 chalk fired in one throw | 85 | NOCK attempts to explain the pipeline and fails mid-sentence |
| Score reduced to exactly 170 | 60 | The famous maximum checkout |
| Score reduced to 1 | 80 | Sympathy bark |
| Nine-darter | 110 | Both commentators, extended sequence |
| Timed out on leg 8 | 100 | Must be kind, not mocking. This is the loss screen. |
| Shop entered with 0 Pot | 40 | |
| Idle > 15 s during a hand | 20 | Low-priority filler; BARREL and NOCK talk about something irrelevant |

**Writing rules for the bark pool:**
1. Never mock the player for losing. Mock the situation, the board, each other, the wiring, the crowd, a man named Gerald in the third row. Never the player's competence.
2. Barks are ≤ 90 characters. Two lines at 5×7 font.
3. No profanity beyond mild British pub register. Keep the rating broad.
4. No references to gambling, betting, odds, or money outside the in-game Pot.
5. NOCK's arithmetic must always be *correct* when he attempts it, and always *irrelevant*. This is funnier and avoids teaching wrong maths.

### 10.4 Voice

No recorded voice acting — it violates C4 and C3. Instead: **procedural blip voice** (see §13.3). BARREL is pitched high and fast, NOCK low and slow. This is a known-good comedy technique and costs nothing.

---

## 11. Art specification and sourcing rules

**This section satisfies constraint C4. It is normative and takes precedence over convenience.**

### 11.1 The sourcing rule

> **All visual assets are generated at build time by deterministic code committed to this repository. Nothing is downloaded. Nothing is drawn by hand. Nothing is produced by an image model.**

Implementation: a Node script `tools/genart.ts` writes PNG files into `assets/generated/`. `assets/generated/` is listed in `.gitignore`. The build pipeline is:

```
npm run genart   →  writes assets/generated/*.png  (deterministic, seeded)
npm run build    →  runs genart, then bundles
```

The generator uses only `pngjs` (MIT) or a hand-rolled PNG writer. No canvas library, no font library, no asset packs.

**Why this is achievable here and would not be for most games:** a dartboard is a circle divided into twenty equal sectors with two concentric rings. It is a *parametric* object. Darts are 9-pixel arrows. The crowd is a field of 8×8 silhouettes. This game's entire visual vocabulary is procedurally expressible, which is precisely why this ruleset was chosen over one requiring characters, environments, or animation.

### 11.2 Resolution and scaling

| Property | Value |
|---|---|
| Internal resolution | **320 × 180** |
| Scaling | Integer only (×1 … ×6), nearest-neighbour |
| Letterboxing | Black bars. Never stretch, never fractional-scale. |
| Sprite positioning | Integer pixel coordinates only. Round before blit, never after. |
| Portrait mode | Rotate layout to 180 × 320; board shrinks to 96 px, commentary bar moves to bottom |

### 11.3 Palette

Exactly **16 colours**. Every generated pixel must be one of these. The generator asserts this and fails the build if violated.

```
00  #0d0b12   ink          (outlines, text)
01  #1c1a2b   deep         (background)
02  #2e2a45   shade
03  #4a4363   stone        (interface chrome)
04  #6f6690   pewter
05  #a49bbf   mist
06  #e8e3f2   chalk        (text, highlights)
07  #7a2231   claret       (board red)
08  #b8394e   claret-lit
09  #14452f   baize        (board green)
0a  #26805a   baize-lit
0b  #c9a227   brass        (Pot, wire, trebles)
0c  #f0d264   brass-lit
0d  #2b5f8a   sky          (flights, chalk-card frames)
0e  #4a9fd8   sky-lit
0f  #e05a2b   ember        (bust, warnings, 180 flash)
```

Palette rationale: dim pub interior (00–05), traditional board colours (07–0a), brass for reward feedback (0b–0c), sky for player agency (0d–0e), ember reserved exclusively for high-arousal events so that colour alone communicates state.

### 11.4 Generated asset manifest

Every asset, its dimensions, and its generation method. The implementer writes one generator function per row.

| Asset | Size | Generation method |
|---|---|---|
| `board.png` | 128×128 | Parametric. Twenty sectors at 18° each, offset so bed 20 is centred at top. Rings at radii: outer edge 62, double band 56–62, treble band 34–40, outer bull 6, inner bull 3. Alternate claret/baize by sector index parity. Wire drawn as 1 px brass lines on sector and ring boundaries. |
| `board_wired.png` | 128×128 | Same generator, `wireHighlight: true`, brass-lit wires |
| `dart.png` | 9×9, 8 frames | Programmatic. Shaft = 5 px line, flight = 3×3 triangle, point = 1 px. Rotation frames at 45° steps generated by rotating the source matrix. Flight recoloured per `DartCard.flight` via palette index swap. |
| `dart_trail.png` | 16×4, 4 frames | Gradient streak, palette indices 0d→0e→06 |
| `card_frame.png` | 40×56 | 9-slice. Rounded 2 px corners, 1 px ink outline, 1 px inner highlight. Three tints: neutral (03), selected (0e), disabled (02) |
| `chalk_frame.png` | 32×32 | 9-slice, brass outline |
| `crowd_head.png` | 8×8, 6 variants | Silhouette blobs. Six outlines × 5 palette tints = 30 apparent variants from 6 sprites. |
| `crowd_field` | runtime | Not a file. Tiled at runtime from `crowd_head`, y-offset by `sin(x*0.7 + t)` for a bobbing crowd. Density scales with leg index. |
| `oche_floor.png` | 320×48 | Procedural carpet: 2 px noise dither in shades 01/02/03, seeded, with a 4 px repeating diamond motif. Pub carpet is the single most evocative texture available and it is trivially procedural. |
| `scoreboard.png` | 96×64 | Slate rectangle with 1 px chalk-dust noise overlay |
| `pint.png` | 12×16 | Decorative. Sits on the scoreboard ledge. Fill level tracks Pot. |
| `light_cone.png` | 64×80 | Additive gradient, radial falloff, dithered to palette using ordered Bayer 4×4 |
| `font_5x7.png` | 512×56 | See §11.5 |
| `font_9x12.png` | 768×96 | See §11.5 — headline font for scores and the 180 flash |
| `icons.png` | 8×8 × 24 | Interface glyphs: visit, bust, double, treble, bull, pot, refresh, remove, lock, sound, etc. |

**Explicitly not required:** commentator portraits. The commentary bar is text on slate. If portraits are added later they must be generated by the modular parts system described in §11.6, not drawn.

### 11.5 Fonts

Fonts are the most common place a "free" project acquires a licence obligation. Avoid the problem entirely:

> **The font is defined in source code as a bit array. No font file is downloaded, bundled, or referenced.**

`src/art/glyphs.ts` contains, for each supported glyph, a `number[]` of row bitmasks:

```ts
// 'A' at 5x7
export const GLYPH_A = [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001];
```

Required glyph coverage for v1:
- ASCII 32–126 (95 glyphs) at 5×7 and 9×12
- Latin-1 accented characters required for French, German, Spanish, Italian, Dutch localisation: `à â ä ç è é ê ë î ï ô ö ù û ü ÿ á í ó ú ñ ¿ ¡ ß`

Dutch and German coverage is not optional given where the audience for this ruleset is. Localisation itself is out of scope for v1, but the glyph coverage must exist so it is not a rewrite later.

### 11.6 Modular parts system (for any future figurative art)

If any human figure is required, it is assembled, never drawn:

```
figure = silhouette(1 of 4) + head(1 of 6) + hair(1 of 8) + shirt_tint(1 of 5)
```

960 apparent characters from 18 generated sprites. This is the only sanctioned method for producing figurative art in this project.

### 11.7 Fallback policy

If a generator cannot produce an acceptable result, the fallback is **simplify the design**, not import an asset.

If an external asset is genuinely unavoidable, it may be used **only** if all of the following hold, and the exception must be recorded in `ASSETS.md` with a link and licence text:

1. Licence is **CC0 / public domain dedication**. Not CC-BY, not CC-BY-SA, not "free for non-commercial", not "free with credit".
2. The asset is recoloured to the 16-colour palette before use.
3. The original file is committed alongside the processed version.

Permissive-licence sources are acceptable for *code* (MIT, BSD, Apache-2.0, ISC, Zlib). They are not a licence to import art.

### 11.8 Prohibited content

- Real people, living or dead, including likenesses and names
- Real darts organisations, tournaments, venues, broadcasters, or sponsors
- Any registered trademark, logo, or trade dress
- Real-money gambling references, odds displays, betting terminology, or any interface element resembling a wagering product
- Alcohol branding. Generic pints are fine; named beers are not.

The last two matter commercially as well as legally: this game must not be classified as a gambling app by either store's review process. The word "bet" should not appear in the build.

---

## 12. Audio specification

Same constraint, same solution: **all audio is synthesised at runtime. No audio files ship with the game.**

### 12.1 Method
Web Audio API. A small synthesis layer (`src/audio/sfx.ts`) implementing an sfxr-style parameter set: waveform, attack/sustain/decay, frequency envelope, vibrato, noise mix. Sound definitions are committed as parameter objects, not samples.

### 12.2 Required sounds

| Sound | Character |
|---|---|
| `throw` | Short noise sweep |
| `thud` | Low thump, board impact. The single most important sound in the game — it must feel good on the 500th repetition. |
| `wire` | Metallic ping, higher pitch, used for `wired` deflections |
| `card_deal` | Paper flick |
| `card_select` | Soft click |
| `chalk_fire` | Ascending blip; pitch rises with each chalk in a chain, so a 5-chalk chain is an arpeggio. This is the payoff sound. |
| `bust` | Descending two-note fall. Comic, not punishing. |
| `checkout` | Rising triad |
| `one_eighty` | The largest sound in the game |
| `crowd_murmur` | Filtered noise loop, amplitude tracks tension |
| `crowd_roar` | Filtered noise burst |

### 12.3 Blip voice
Per-character pitched blips during bark reveal, Animal Crossing style. BARREL: square wave, base 420 Hz, ±80 Hz jitter, 18 ms per character. NOCK: triangle wave, base 180 Hz, ±25 Hz jitter, 34 ms per character. Punctuation extends the gap. This carries the comedy at zero asset cost.

---

## 13. Interface layout (320×180 landscape)

```
┌────────────────────────────────────────────────────────┐
│ LEG 6 · LAST FOUR          VISITS ▮▮▮▯▯▯▯   POT ⬤12   │  y 0–12   chrome
├──────────────────────┬─────────────────────────────────┤
│                      │                                 │
│      DARTBOARD       │   REMAINING                     │  y 12–120
│       128×128        │      1 4 1                      │
│                      │   (9x12 font, huge)             │
│                      │                                 │
│                      │   CHECKOUT: T20 D20 D20         │
│                      │   CHALK: [][][][][]             │
├──────────────────────┴─────────────────────────────────┤
│   ┌────┐  ┌────┐  ┌────┐                               │  y 120–160  hand
│   │T20 │  │S7  │  │D16 │                               │
│   │ 60 │  │  7 │  │ 32 │                               │
│   └────┘  └────┘  └────┘                               │
├────────────────────────────────────────────────────────┤
│ BARREL: "He's done it! He's actually gone and done it!" │  y 160–180  commentary
└────────────────────────────────────────────────────────┘
```

**Touch targets:** minimum 44 × 44 device-independent pixels for all interactive elements. At ×4 scale a 40×56 card is 160×224 device pixels — comfortable.

**The commit gesture:** flick a card upward toward the board. Tap-to-select then tap-to-throw is the accessibility fallback and must be available from a settings toggle. The flick is the thing that has to feel like throwing; prototype it first (see §16).

**Readability rule:** the remaining score is always the largest element on screen. It is the number the player is doing arithmetic on. Nothing else may compete with it.

---

## 14. Technical stack

| Layer | Choice | Licence |
|---|---|---|
| Language | TypeScript 5.x | Apache-2.0 |
| Bundler | Vite | MIT |
| Rendering | HTML5 Canvas 2D, `imageSmoothingEnabled = false` | — |
| Audio | Web Audio API | — |
| Runtime dependencies | **Zero** | — |
| Build dependencies | vite, typescript, pngjs, vitest | MIT / Apache-2.0 |
| Target | ES2020, browsers from 2021 onward |

No engine. No React. No physics library. The game is a state machine, a resolver, and a blitter.

### 14.1 Project structure

```
/src
  /core        rules.ts, resolver.ts, deck.ts, chalk.ts, rng.ts, state.ts
  /art         glyphs.ts, palette.ts, sprites.ts (runtime atlas loader)
  /audio       sfx.ts, voice.ts, defs.ts
  /ui          layout.ts, hand.ts, board.ts, commentary.ts, shop.ts
  /content     cards.ts, chalkdefs.ts, barks.ts, oches.ts
  main.ts
/tools
  genart.ts    ← writes assets/generated/
/tests
  resolver.test.ts, determinism.test.ts, balance.test.ts
```

**Hard architectural rule:** `/src/core` must have zero imports from `/src/ui`, `/src/art`, or `/src/audio`. The rules engine must be runnable headless in Node. This is what makes the balance simulation in §15 possible and it is not optional.

---

## 15. Balance targets and how to verify them

Balance is verified by simulation, not by feel. `tests/balance.test.ts` runs a headless bot over 10,000 seeded nights.

### 15.1 Bot policies
- **Greedy:** always commits the highest-value legal card.
- **Checkout-aware:** greedy until score ≤ 170, then plays toward a legal finish.
- **Optimal-ish:** 2-ply lookahead over the hand.

### 15.2 Targets

| Metric | Target | Policy |
|---|---|---|
| Leg 1 win rate | > 97% | greedy |
| Leg 8 win rate, no chalk | < 5% | optimal-ish |
| Leg 8 win rate, 5 chalk | 45–60% | optimal-ish |
| Full night win rate | 18–28% | optimal-ish |
| Full night win rate | < 8% | greedy |
| Median night length | 25–40 min | measured, human playtest |
| Median 180s per night | 4–9 | optimal-ish, 3+ chalk |
| Busts per night | 3–7 | optimal-ish |

**Reading of these targets:** greedy play must lose. A player who does not engage with the checkout arithmetic should reach roughly leg 5 and stop. That gap between greedy and checkout-aware *is* the game's skill expression, and it is the number to watch when tuning.

### 15.3 Anti-targets
- No single chalk may push leg-8 win rate above 35% on its own. If one does, it is overtuned; reduce it.
- No two-chalk combination may exceed 80%. If one does, it is a dominant strategy; add an anti-synergy or raise its cost.

---

## 16. Build order

Strictly sequential. Do not proceed to a stage until the previous stage's exit test passes.

| Stage | Deliverable | Exit test |
|---|---|---|
| 1 | `core/` rules engine, headless, no chalk | 501 → 0 solvable; all bust cases correct; 200 unit tests pass |
| 2 | Seeded RNG + determinism harness | Same seed, same inputs → byte-identical result log, 1000 trials |
| 3 | `tools/genart.ts` producing board, dart, font | Delete `assets/generated/`, rebuild, output is byte-identical |
| 4 | Minimal playable loop: hand, commit, board, score | A human can play one leg end to end |
| 5 | **Flick gesture prototype** | 10 testers report it feels like throwing. **If it fails here, stop and reconsider — the design's central risk lives in this test.** |
| 6 | Chalk system + full pipeline | Balance simulation runs; all §15 targets met |
| 7 | Shop, Pot, run structure | Full night completable |
| 8 | Commentary system, 120 barks | Bark cooldowns verified; no repeat within 8 events |
| 9 | Audio synthesis | All §12.2 sounds present |
| 10 | Oches, win/loss screens, settings | Full loop, ship candidate |

---

## 17. Acceptance tests

The build is done when all of these pass:

1. **Determinism:** seed `12345` played with a recorded input script produces an identical final `NightState` across 1000 runs and across Node and browser.
2. **Asset autonomy:** `rm -rf assets/generated && npm run build` produces a byte-identical bundle.
3. **Palette compliance:** every pixel in every generated PNG matches one of the 16 palette entries. Generator asserts this.
4. **Licence audit:** `ASSETS.md` lists every asset with its origin. Every entry reads "generated" or names a CC0 source. `npm ls --all` shows only MIT / BSD / Apache-2.0 / ISC / Zlib.
5. **Offline:** the game loads and plays a full night with the network disabled.
6. **No purchases:** no network calls of any kind exist in the shipped bundle. Grep for `fetch`, `XMLHttpRequest`, `WebSocket` returns zero hits in `/src`.
7. **Bust correctness:** all 501 remaining-score values × all 62 board targets are enumerated and their bust/checkout classification is asserted against a reference table.
8. **Retry latency:** from fail screen to first hand of a new night is under 400 ms and one input.
9. **Portrait:** full night completable one-handed in portrait at 375×667.
10. **Bark safety:** an automated scan of `barks.ts` finds zero instances of second-person criticism, zero gambling terminology, and zero real proper nouns.

---

## 18. Out of scope for v1

Multiplayer, online leaderboards, cloud saves, accounts, daily challenges, seasonal events, cosmetics, achievements beyond the five oche unlocks, localisation (glyph coverage only), controller support, endless mode.

Each of these is a defensible v2 feature. None of them is allowed to delay v1, and several of them (dailies, seasonal events) would violate the design's stated premise and should be resisted on principle rather than scheduled.

---

## 19. Open questions for the designer

Recorded honestly rather than papered over:

1. **Does the flick read as throwing?** Stage 5 answers this. Everything downstream assumes yes.
2. **Is 8 legs the right night length?** 25–40 minutes may be long for a phone. A 6-leg "quick night" variant is cheap to test and may become the default.
3. **Does checkout arithmetic exclude non-darts players?** The checkout hint is the mitigation. Measure whether players leave it on. If 90% leave it on, the arithmetic is not the game the player thinks it is, and the design should lean harder into engine-building instead.
4. **Is North American recognition sufficient?** The board is universally legible there; the double-out rule is not. Consider whether the first leg should teach double-out explicitly through a forced low-score finish.
