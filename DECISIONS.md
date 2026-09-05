# DECISIONS.md — choices the TDD left to the implementer

Every value or behaviour the TDD did not pin down, and what was chosen. Numbered so the
tests and the code can refer to them. Per-area worker notes live in `docs/decisions/`.

## Rules and resolution (§3, §5, §7)

1. **Multiplier chalk in acquisition order.** `hot_twenty` (×4 instead of ×3) and `feathered`
   (×3 instead of ×2) are applied as scalings of the running value — `floor(v·4/3)` and
   `floor(v·3/2)` — at their place in acquisition order, rather than as a multiplier override
   evaluated before other VALUE chalk. This keeps rule §5.5.1 literally true (order matters):
   `heavy_tips → hot_twenty` on T20 gives 86, `hot_twenty → heavy_tips` gives 85. On an
   unmodified value the result is exact (T20 = 80, D20 = 60).
2. **`bullish` sets the value to 75** at its point in the chain (earlier VALUE chalk is
   overwritten, later chalk still applies).
3. **`cold_hands` with `fourth_dart`:** throw index 0 scores 0, indexes 1 and 2 score ×2, the
   fourth dart scores ×1 (the TDD names only the second and third).
4. **`last_orders`** doubles throw index 2 only — "the third dart" — even with `fourth_dart`.
5. **`tunnel_vision` +20%** is a DEAL-stage card with a VALUE side effect. It is applied once,
   after all VALUE chalk, as `floor(v·6/5)`, and it appears in `firedChalk` on every throw.
6. **`wired`** rolls the gameplay RNG only for bed targets (bulls have no neighbour) and only
   when an RNG is supplied. Hints and bots resolve with `rng: null` (no deflection).
7. **`split_tips`** never splits a bull. The extra single is anticlockwise of the *original*
   bed (before other BOARD chalk acquired later); later BOARD chalk then acts on both targets.
8. **`magnetised`** is evaluated against the base value (bed × multiplier) of every target in
   the array, including a split single, before any VALUE chalk. Code comment marks this.
9. **`wide_doubles`** is BOARD stage in the table but is evaluated in the RULE stage (6.1)
   because it changes what counts as a double, not where the dart lands. It only "fires" when
   it actually changed `countsAsDouble` on the final hit.
10. **`straight_out`** fires only when it turned a would-be bust on 0 into a checkout.
11. **`overshoot`** (−1 or −2 counts as a checkout) does not require a double. The leg score
    is committed as 0; `ThrowResult.scoreAfter` keeps the true negative number.
12. **`chalk_dust`**: landing on exactly 1 sets the score to 2 and the throw continues.
13. **`forgiving_oche`** voids the busting throw entirely (score stays at `scoreBefore`), the
    visit continues, and `forgivenessUsed` is set for the leg. Forgiveness is checked before
    `cheap_chalk`; when it fires, cheap chalk does not.
14. **`cheap_chalk`** sets the score to 2 (not the visit-start score); the visit still ends.
15. **`practice_board`**: uncommitted cards go to the *bottom* of the deck (they come round
    again this leg without a reshuffle) rather than on top (which would re-deal them at once).
16. **`chalked_up`** peeks the top three deck cards at the start of every visit; the ids are in
    `LegState.peek` and the UI shows a PEEK marker.
17. **Hand size conflict** (`wide_grip` + `tunnel_vision`): the later-acquired chalk wins.
18. **Checkout "from" value** for the +2 big-finish bonus and the Sharp unlock is the score at
    the start of the finishing visit (the darts sense of "a 100 checkout").
19. **Nine-darter bonus** = the leg was checked out in exactly three visits, regardless of
    `fourth_dart`.
20. **Deck exhaustion** (tiny libraries): if deck and discard are both empty mid-deal, the hand
    is dealt short rather than crashing. Cannot happen with the shipped libraries.

## Run structure and shop (§4)

21. **Card prices** (not in the TDD): singles 1–3 by value, doubles 2–5, trebles 3–6, outer
    bull 4, bull 6 (`cardCost` in `src/content/cards.ts`). The Wide adds +2 to *cards only*.
22. **Shop offer pool** is weighted toward useful cards (high trebles, finishing doubles, the
    bull) with a thin tail of low singles so a bad offer is possible but rare.
23. **Chalk offer** is uniform over chalk not currently held. Chalk already held is never
    offered (rule §5.5.3).
24. **Service** is one of REMOVE / DUPLICATE / SHARPEN, uniform. SHARPEN is S→T→D and OB→IB;
    doubles and the bull cannot be sharpened. REMOVE is refused below 6 cards.
25. **Refresh** regenerates all four slots (sold ones included) for 1 Pot, once per shop.
26. **Shop RNG order**: card, card, chalk, service — after the leg's shuffles and wired rolls.
27. **Pot bonuses** on the last leg are not paid (the win is the reward) but the folk stats
    (nine-darter, big finish, clean leg) are still recorded.
28. **The Thin** library (12 cards): S20×2, S19, S16, S12, S3, T20, T19, D20, D16, D8, D2 — see #45.
29. **The Sharp** replaces the S1 card with T18 and T17 (so its library is 25 cards).
30. **Card ids** are a deterministic per-night counter (`c1`, `c2`, …); `flight` is
    `(counter−1) mod 4`. No RNG is consumed for cosmetics.

## Determinism (§8)

31. The gameplay generator lives in `NightState.rng` (mulberry32 state), so a serialised night
    replays exactly. Order of consumption: leg shuffle, discard reshuffles, wired rolls, shop
    generation. Commentary and VFX use separate generators.
32. **Seed strings** are 7 characters of a 32-symbol alphabet (no 0/O/1/I). Typing a number
    uses it directly; any other text is hashed (FNV-1a).

## Interface (§11, §13)

33. **Art is generated at runtime** from the same deterministic generator code that
    `tools/genart.ts` uses to write the PNGs. The game never loads a file, which is what makes
    the single-file build and offline play trivial; the PNGs in `assets/generated/` exist for
    inspection and the byte-identical build test.
34. **Board on screen is 96 px** with a numbers ring; the 128 px board is the title-screen hero.
    A 128 px board plus a 56 px card row plus chrome and commentary does not fit in 180 px.
35. **Chalk chips in play are 20×20** (9-slice of the 32×32 frame with a 12×12 icon); the shop
    shows the full 32×32 frame.
36. **Fades and flashes are ordered dithers**, not alpha blends, so every pixel on screen stays
    inside the 16-colour palette at runtime too.
37. **Commit gesture**: flick (drag up and release with upward velocity, or lift the card past a
    threshold) throws. A tap selects; a second tap on the selected card throws when "Tap to
    throw" is on (default on, toggleable). Keyboard: 1–4 select, ←/→ move, Enter/Space throw,
    M (or 0) misses on purpose, H toggles the hint, Esc pauses.
38. **Checkout hint threshold** is derived, not fixed — see #48. The route search uses the real
    pipeline without wired deflection, respects the current throw index, and never relies on
    forgiveness.
39. **Portrait commentary bar is 36 px (4 lines)** because a 90-character bark does not fit in
    two lines at 180 px wide.
40. **EXIT** attempts `window.close()` (which browsers only honour for script-opened windows)
    and otherwise shows a "you can close this tab" screen with a STAY button.
41. **Flick prototype test (§16 stage 5)** could not be run with ten human testers during an
    autonomous build; the gesture is tuned against real pointer events in the Playwright
    harness and the tap/keyboard fallbacks are always available.

## Commentary (§10)

42. Bark lines never repeat within 8 reacts; a trigger's cooldown counts reacts, not seconds.
43. Placeholders `{score} {total} {value} {chalk} {leg} {pot} {card} {n180}` are substituted
    by the engine; `{chalk}` joins fired chalk names with " then ".

## Out of scope kept out (§18)

44. No endless mode, dailies, accounts, telemetry, ads, purchases, or localisation beyond glyph
    coverage. Persistent state is only settings, the five oche unlocks, and lifetime stats.

---

## Balance-driven changes (added after simulation — see `docs/decisions/balance.md`)

45. **The starting library gains a ladder of small doubles.** TDD §6.1's 24 cards can only
    finish on 32 and 40 (D16, D20; the outer bull is not a double), so most small scores are
    dead ends and even perfect play loses leg 1 about 85% of the time. The library keeps 24
    cards but its doubles become **D20, D16, D8, D4, D2, D1**, paid for by trimming one copy
    each of S7, S5, S3 and S1 — the real double-16 ladder (32→16→8→4→2). Mean card value
    rises from 15.5 to 18.75. The Thin (12 cards) follows the same principle.
46. **The deliberate miss.** A player may throw at the wall on purpose: it spends the dart
    and the whole dealt hand, scores nothing and cannot bust (`commitMiss`, region `'W'`).
    This is what real players do rather than bust, and without it a dead-end hand forces a
    wasted visit with no agency. The MISS button sits beside the hand and flashes ember when
    every card in hand would bust; keyboard `M` or `0`. The cost is real (a dart and three
    cards) but it does mean optimal play never busts — see the balance notes.
47. **Pot rewards raised** from `3 4 5 6 8 10 12` to `4 6 8 9 11 13 15` (leg 8 still pays
    nothing; the win is the reward). Worth roughly one extra chalk per night.
48. **The checkout-hint ceiling is derived, not fixed at 170.** It is
    `2 × (best single throw) + (best finishing throw)`, which is exactly 60 + 60 + 50 = 170
    for the base deck — the folk maximum the TDD names — and grows on its own when chalk
    inflates values, instead of the earlier `3 × best` (which wrongly implied a treble could
    finish).
49. **`overshoot` costs 12, not 9** (the only §15.3 breach: `overshoot + fourth_dart` won leg 8
    83% of the time, over the 80% pair limit). The TDD sanctions raising a cost as the remedy;
    the effect text is untouched.
50. **Bot policies use the miss** (`checkout` and `optimal` only). `greedy` deliberately does
    not: it is the model of a player who does not engage with the arithmetic, and it must be
    allowed to bust.
