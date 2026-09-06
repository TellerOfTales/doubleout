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
34. **Board on screen is 96 px** with a numbers ring, on every screen. A 128 px board plus a
    56 px card row plus chrome and commentary does not fit in 180 px, and on the title screen
    the word-mark band owns the top 34 px. The 128 px generator is kept for the asset manifest.
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

---

## The loop rework (second playtest pass — `docs/decisions/balance.md`)

Playtesting the first build found the scoring phase had no decision and the endgame
was a free reroll. These five changes are the response; the first two deviate from
TDD §3.3, deliberately and with measurements.

51. **One hand per visit, not per dart.** TDD §3.3 deals `HAND_SIZE` cards at the
    start of every *throw*, discarding the rest. Instead a visit is dealt
    `throwsPerVisit + 2` cards (five normally; `wide_grip` +1, `tunnel_vision` −1)
    and spends them across its darts; leftovers are binned at visit end (or routed
    under the deck by `practice_board`). This is the change that makes the scoring
    phase a plan: the big card spent now is not there for the third dart.
52. **The deliberate miss ends the visit.** It still scores nothing and cannot bust,
    but the remaining darts are forfeited, so cycling hands to fish for a card costs
    visits rather than nothing.
53. **Heat.** `leg.heat` counts consecutive visits ended without a bust, capped at 4,
    and scales the leg's Pot by `1 + heat/4` (up to ×2). A bust wipes it to 0 and
    emits `HEAT_LOST`. A visit ended by a miss holds heat but does not raise it —
    walking away is safe, not rewarded. Heat resets each leg.
54. **"Left it right".** +1 Pot (max 4 a leg) whenever a visit ends on a score the
    deck can still finish, paid immediately via `SETUP_BONUS`. Every card in hand
    shows the score it would *leave*, coloured: brass for a finish, green for a
    position you can close, claret for a dead end, ember for a bust. This is the
    tactical counterweight to heat — score big, or leave it right.
55. **The pocket.** `pocketCard` sets one card aside; it rejoins the hand every visit
    until thrown, and is not binned at visit end. Free, one card, cleared when
    thrown, and it does not survive the leg. Without it the per-visit hand made the
    finish pure luck (see the balance notes); with it, banking the double you intend
    to finish on is the central long-range decision of a leg.
56. **`overshoot` requires a finishing double.** Going 1–2 below zero still counts,
    but only on a throw that already counts as a double — otherwise every card
    closed a leg and it won leg 8 83% of the time on its own (§15.3).
57. **Visit limits recalibrated** to `13 12 11 10 9 8 6 4`. One hand of five spent
    across three darts scores far less than a fresh best-of-three every dart did, so
    the TDD's `12…5` ramp no longer describes the same game. The Decider drops to 4
    to keep it the wall §4 intends.
58. **Starting library retuned again** to 24 cards where trebles carry the scoring
    (T20×2, T19×2, T18, T17, T16, T14) with the double ladder and both bulls intact.

## The shop pass (third measurement pass — `docs/decisions/balance.md`)

59. **The bin stays open, and comes up more often.** `REMOVE` is weighted 3 against
    `SHARPEN` 2 and `DUPLICATE` 1, and buying it does not mark the slot sold — you
    may bin as many cards as you can pay for while the shop is open, down to a floor
    of six. The starting library is deliberately bloated with filler; measurement
    says cutting that filler is worth about ten points of night win rate, which is
    more than anything else 2 Pot buys. A once-per-three-shops, once-only service
    could not act on that, so the pot had nowhere useful to go.
60. **The shop bot prices a card on four terms, not one.** The old heuristic valued a
    card purely by the points it added to an expected visit. Under the per-visit hand
    that is close to meaningless — four free T20s handed to the starting deck
    measurably *lose* 8 points of leg-1 win rate, because a hand of trebles is no use
    when the leg wants a double. `purchaseWorth` now sums the change in expected visit
    value, in the odds the visit's hand holds a finisher at all, in how much of the
    2–110 band the library can close in two darts, and a flat penalty per card in the
    library. Each weight is in Pot units, so a purchase is compared against its price
    on the same scale, and the constants are calibrated against measurement rather
    than guessed.
61. **The per-dart hand size is gone from the code, not just from the loop.**
    `handSizeFor`, `handSize` and `DEFAULT_HAND_SIZE` still encoded TDD §5.4's
    per-throw rule (and a "later acquisition wins" clash between Wide Grip and Tunnel
    Vision that the live rule does not have). Nothing used them. They are deleted, and
    the two chalk blurbs now describe what the chalk actually does to the visit hand.

## The excitement package (after "it's not feeling addictive enough")

The playtest verdict after the loop rework was that the loop had tactics but no
thrill. These are the answer, tuned together (`docs/decisions/balance.md`, fourth and
fifth passes). The brief they serve, in the developer's words: "just one more turn
mechanics and real thought out tactics that incorporate small gambling mechanics for
the fun of the mechanic." A three-critic adversarial pass on the first version found
a solved engine and two mechanics with no risk in them; #67 records what changed.

62. **Shanghai.** Every leg calls a number, drawn for all eight legs at the start of
    the night from all five of 20/19/18/17/16, so no library can be tuned to one of
    them. A single, a double and a treble of that number in one visit is a Shanghai.
    **Inside checkout range (the visit began at 170 or below) it wins the leg
    outright**, whatever the arithmetic says, and takes precedence over a bust on the
    dart that completes it. Above range it pays `SHANGHAI_BONUS` straight to the Pot
    and the leg goes on. A Shanghai is not a checkout: no finish ladder, no
    nine-darter, no best-checkout record, no Sharp unlock. Only each throw's primary
    hit counts, a forgiven dart never happened, bulls never do, and the resolved bed
    is what matters. The shop's second card is always a piece of the next leg's
    number (the region the library holds fewest of), the leg banner names the
    number, it sits on the checkout line with S D T lighting up as the visit collects
    them, cards of it wear a claret corner, and the third piece in hand reads as a
    finish, never as a bust. The hunt gives singles a reason to exist and the pocket
    a second job; the range gate is what stops it being an engine (#67).
63. **The clean sheet.** Consecutive legs won without a bust multiply **the leg's
    base reward and its finish bonuses** — not the visits it left unused, the setup
    bonuses or the crowd — by ×1, ×2, then ×3 from the third clean leg on
    (`STREAK_MULT`). One bust and the sheet is gone, announced the moment it happens.
    Throwing at the wall keeps the sheet (it costs the crowd instead, #64); a Cheap
    Chalk bust-to-2 keeps it too, since that line is what the chalk is for; a
    Forgiving Oche bust keeps it, as the blurb promises. This is the run's compounding
    number and the thing a player who busts is afraid of losing. The bot never busts,
    so its ×3 is a default; a human's is not.
64. **The wall costs the crowd.** A deliberate miss wipes the heat as well as ending
    the visit, and a forgiven bust wipes it too — the board forgives, the crowd saw
    the dart, and the visit it happened in does not warm them back up. The safe
    option is still safe for the score; it is no longer free.
65. **Banking the crowd — retired.** The first version let the heat be banked at
    visit start for Pot. The critics showed it was never a decision: the whole hand
    is visible and every outcome is deterministic before the choice, so the only play
    was "bank, then walk", which refunded #64 at 2 Pot a pip and moved 6.7 of 218 Pot
    a night. A wager needs something the player cannot see. It is gone; the gauge is
    a gauge again. (A leg-start call — "I'll do it in six" — is the shape a real
    wager would take here, because it spans hands not yet dealt. It is the next thing
    to try.)
66. **The short game opens the night, and finishes pay a ladder.** Legs 1 and 2 start
    at 301 with ten visits; the rest are 501. The first win now lands in a median
    four visits instead of six. Big finishes pay 2 from a ton, 4 from 130 and 8 for
    the 170 (`BIG_FINISH_LADDER`); a timed-out leg within 60 that the deck could
    still have closed says SO CLOSE. The nine-darter and the Thin unlock ("a leg in
    six") are 501 things and pay only on a leg that began at 501 or more.
67. **What the critics changed.** Three agents read the first version of #62–66
    against the code and the simulator. Findings and outcomes: (a) with the number
    drawn only from what the starting deck completed, a player on The Thin who binned
    everything but the 20s won 73% of nights by Shanghai on visit one — fixed by the
    range gate, all five numbers, and a bin floor of `LIBRARY_FLOOR` (14) cards
    (measured after: 1%); (b) the sheet's ×3 on top of heat and the unused-visit Pot
    flooded the economy (218 Pot a night, 198 unspent) — fixed by multiplying the base
    and finish only (121 a night); (c) banking was never a decision — retired;
    (d) a Shanghai was scored as a checkout from its starting score — fixed;
    (e) Forgiving Oche kept the crowd warm through a bust and let a forgiven dart
    count as a piece — fixed, and the chalk now costs 10; (f) the bot walked away
    from a completing piece that would have bust — fixed; (g) the completing piece
    read as BUST in the hand — fixed; (h) `{card}` in the Shanghai lines named the
    dart, not the number — a `{number}` placeholder now exists; (i) "Double money"
    in a heat line — reworded; (j) the ×2.0 gauge text, the ASCII arrow, the sheet
    label hiding until leg 2 and colliding with VISIT 10/10, the unlabelled pips, the
    SO CLOSE that ignored the deck, the stale 501 constant — all fixed.

The shop bot plays a Shanghai the hand offers (including off a busting dart) but
does not pocket toward the number: measured, that heuristic cost leg 1 eight points
because the pocket has a better job. A human hunting deliberately, buying the piece
the shop offers, does better than the bot's numbers.

## Every dart has odds (after "I still feel like I'm just counting down")

68. **The aim.** Until now every dart landed where it was aimed, which made every
    throw a subtraction and the whole leg a countdown; the developer's third
    playtest said exactly that, and asked for strategy, risk and a touch of luck in
    each action. So the throw itself now carries odds (`landingDistribution` in
    `src/core/resolver.ts`, the AIM step before the BOARD stage). A single lands
    85% of the time, a double 55%, a treble 50%, the outer bull 65%, the bull 45%.
    A miss is structured the way a real miss is: a treble mostly drops into its own
    single, sometimes slips a bed; a double falls short into the single, slips a
    bed, or goes in the wall for nothing; a single slips a bed or, one miss in four,
    finds its own treble; the bull strays to the top of the board. The roll is one
    float from the gameplay RNG, before `wired`, so a night is still one seed. Every
    card shows its chance of landing, or, when a landing could bust, its chance of
    a bust, and the selected card's readout shows the whole spread. The crowd
    steadies the hand: every pip of heat is `STEADY_PER_HEAT` points on every hit
    chance, capped at 95, so the ride is now worth something on every dart and a
    bust costs the odds as well as the Pot. The planner (`planVisit`) is an
    expectimax over the distributions with a bust priced as a cost, not a veto, and
    the wall on the table at every depth; the shop bot values cards by expected
    points. True aim (`NightState.trueAim`) exists for the tutorial's scripted
    throws and for tests that pin arithmetic; play never uses it. The visit limits
    were retuned for the new expected scoring (`docs/decisions/balance.md`, sixth
    pass). This is the change the whole loop was missing: the decision on every card
    is now "how much do I want it, and at what odds".

## The oche problem: giving the aim back (after the fourth playtest)

The third rebuild changed nothing the developer could feel. The verdict came back
a third time in the same words — "picking the highest number until I get to a miss
point and then missing on purpose", "no strategy, no creativity, no consequence",
"dreadfully boring" — so the next step was to stop arguing and measure it.
`tools/decisions.ts` plays every night twice on one seed, once with the naive rule
the playtester describes and once with the full planner. The full table, the
research behind it and the design that follows are in `docs/decisions/design.md`;
these are the decisions it produced.

69. **The deck of dealt targets is deleted.** This is the whole diagnosis. A third
    of darts had one legal option or none, a quarter of the rest were answered by
    "give up on this visit", and 44% of visits ended at the wall. Darts has exactly
    one decision — where do I aim, given what I need — and a hand of randomly dealt
    legal targets removes it. Every pub variant surveyed (Killer, Cricket, Halve-It,
    Shanghai, Mickey Mouse, Golf, High-Low) modifies the payoff, the risk or the win
    condition; not one restricts where you may throw. The one that comes closest,
    Around the Clock, is a beginner practice drill with no strategy in it, and that
    is what the deck had turned this into. So `DartCard`, `src/core/deck.ts`,
    `src/content/cards.ts`, `LegState.hand/deck/discard/pocket`, `NightState.library`
    and the whole draw-and-discard economy are gone. `resolveThrow` takes a `Target`.
    The player aims at any of the sixty-two targets, every dart, all night.

70. **The safe dart is near-certain again.** `AIM_BASE` moves to S 97, D 50, T 45,
    OB 60, IB 30, and `STEADY_MAX` caps how far steadiness can lift any of them, so
    a treble stays a gamble however much the build stacks. Decision #68 made
    everything wobble, which sounds like risk and is the opposite: risk requires a
    reliable thing you chose to give up. A professional aiming at a safe single hits
    it about 97.5% of the time, and that is precisely why going for the treble is a
    decision. Missed trebles now land the way real ones do — mostly in their own
    single, sometimes the bed beside it, 8% of the miss mass off the board entirely —
    and missed doubles go off the board 36% of the time, which is why the checkout
    is the hard part of darts and now the hard part of this.

71. **The slate replaces the deck.** Three contracts are chalked up at the start of
    every visit (`src/core/slate.ts`). Taking one stakes Pot against a printed
    price. They pull in deliberately different directions — A TON wants the trebles,
    NO SCRAPS wants nothing under fifteen, THE QUIET wants a visit under 25, ODD JOB
    wants three odd numbers, IN A BED wants all three darts in one number — so
    "where do I aim" stops answering itself. Nothing on the slate ever restricts the
    board; it only changes what a visit is worth. A contract that is already
    impossible from the current position is never offered, because a dead contract
    is the dead card the deck used to deal.

72. **The press, the bank and the pull.** After every dart: PULL a live contract for
    the stake back plus one Pot per dart it survived; BANK one that has landed for
    the printed price, safely; or PRESS it — tear it up and rewrite it as its harder
    tier at double the stake, with the extra stake taken now. Three decisions a
    visit, each of them the craps table's only real question. The interest on a pull
    is what makes stopping positive-value; without it the safe move loses money and
    a push-your-luck loop with no worthwhile stop has no push in it.

73. **A bust takes the slate with it.** The single rule that makes the rest work.
    Banked money survives a bust, riding money does not, so the greed is priced
    against something real rather than against a number going down. The On Tick
    chalk buys an exemption for contracts already made, at 7 Pot.

74. **The house shortens your price.** Every time a contract pays, its printed price
    drops by one for the rest of the night, floored at 1. It is the simplest honest
    way to stop a night settling into one favourite contract thrown over and over,
    it reads on the slate as a number that visibly gets worse, and the shop's RUB OUT
    service buys the worst of it back. The slate is priced off one player's own
    record and is never a market: nobody can take the other side of it.

75. **The kit replaces the shop's card economy.** Six one-shot interventions —
    STEADY, AGAIN, CALLED, DOUBLED, INSURED, RUB OUT — spent on a dart the player has
    already chosen to throw. A dealt card constrains where you may aim, which is
    input randomness and measurably the less satisfying kind; an intervention
    modifies the throw you were making anyway, so there is no such thing as a dead
    one. The DEAL chalk was rebuilt around them and the slate: Wide Grip chalks an
    extra contract, Tunnel Vision one fewer for +20% on every throw, Practice Board
    is a steadier hand all night, Chalked Up shows next visit's contracts early.

76. **Shanghai stops being a leg mechanic and becomes a contract.** It was a
    special case with its own state, its own bonus, its own commentary and an
    exploit history (decisions #63 and #66). As one line on the slate it does the
    same job with none of that, and it competes for the visit against the other two
    contracts rather than sitting on top of them. `SETUP_BONUS` goes the same way:
    LEFT PRETTY is the contract version, and an automatic Pot drip only dilutes the
    thing the player is actually deciding.

77. **The board is the input surface.** Tap or drag to aim, tap again to throw;
    arrows step round the beds and through the rings, Enter throws. The outcome fan
    (`src/ui/aim.ts`) draws every place the dart could finish, sized by likelihood,
    with the chance of the wall shown as a bar outside the board. Hiding that would
    make the press-your-luck choice a superstition rather than a decision. Checkout
    routes are now the real darts finish table rather than a search of the cards
    held, and the game shows the route, because teaching the table is a feature for
    the player this is aimed at rather than a hint that spoils anything.

78. **The tutorial can no longer dead-end.** The previous one trapped the player at
    "40 left" because a mid-visit stage change cleared the prompt and nothing put
    another one up. Prompts are now a pure function of the stage (`promptFor`) and
    `update` re-issues the current one whenever the screen sits idle without one, so
    there is no code path that leaves the player with nothing to do. Scripted darts
    force their own landing (`ThrowOptions.forceLanding`), which is how the lesson
    about risk can show a miss on cue instead of waiting for the RNG to supply one.
