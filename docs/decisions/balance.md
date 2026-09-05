# Balance — what was measured and what was changed

Everything here comes from `npx vite-node tools/balance.ts` (see `tests/balance.test.ts`
for the reduced version that runs in CI). The bots are in `src/core/bot.ts`: `greedy`
(highest legal value, no checkout awareness), `checkout` (greedy until ≤ the checkout
ceiling, then plays a route from the hint engine) and `optimal` (2-ply lookahead with a
checkout/bust/dead-end evaluation).

## The problem the TDD's numbers did not anticipate

TDD §6.1 specifies a 24-card starting library whose only finishing cards are **D16, D20 and
the outer bull** — and the outer bull is not a double, so the deck can finish on exactly
**32 and 40**. Every other position is a dead end: you cannot reach zero from 20, 12 or 6
no matter how well you play, so you burn visits busting until the leg times out.

Measured with the TDD library exactly as written (200 nights, no shop):

| policy | leg 1 win | leg 2 | leg 3 | busts/night |
|---|---|---|---|---|
| greedy | 0% | 0% | 0% | 6.2 |
| checkout | 9% | 0% | 0% | 5.6 |
| optimal | 15% | 1% | 0% | 5.0 |

The TDD's own §15.2 target for leg 1 is **> 97% on greedy play**. That is three orders of
magnitude away, and no amount of shop or chalk tuning closes it, because the gap is in the
*finish*, not the scoring. Two changes fix it; both are recorded in `DECISIONS.md`.

### 1. A ladder of small doubles in the starting library (DECISIONS.md #45)

The library keeps its 24 cards and its mediocre mean (18.75 vs the TDD's 15.5) but the
doubles become **D20, D16, D8, D4, D2, D1**, paid for by trimming one copy each of S7, S5,
S3 and S1. This is the real double-16 ladder every darts player knows: 32 → 16 → 8 → 4 → 2,
so every small number has a route. Two S-cards were kept as filler so the deck still feels
like it needs improving.

### 2. The deliberate miss (DECISIONS.md #46)

Real players throw a dart into the wall rather than bust. `commitMiss` spends the dart and
the whole dealt hand for zero score and no bust. The MISS button sits beside the hand and
flashes ember when every card in hand would bust.

Measured after both changes (200 nights, no shop):

| policy | leg 1 win | leg 2 | leg 3 | busts/night |
|---|---|---|---|---|
| greedy | 37% | 28% | 33% | 6.8 |
| checkout | 93% | 89% | 67% | 0.0 |
| optimal | 94% | 90% | 78% | 0.0 |

### 3. Pot rewards raised (DECISIONS.md #47)

Base rewards went from `3 4 5 6 8 10 12` to `4 6 8 9 11 13 15`, which buys roughly one more
chalk over a night and lifted the full-night win rate from 11.0% to 13.8%.

## Where the build lands against §15.2

400 nights per metric, `optimal` unless stated:

| metric | target | measured | |
|---|---|---|---|
| leg 1 win rate (greedy) | > 97% | **39.1%** | miss — see below |
| leg 1 win rate (checkout-aware) | — | 93.8% | reference |
| leg 8, no chalk | < 5% | **1.3%** | ok |
| leg 8, five strong chalk | 45–60% | **84.0%** | miss — a curated best-in-class build |
| leg 8, twenty random five-chalk sets | 45–60% | **25.3%** | miss — an average build |
| full night (optimal) | 18–28% | **13.8%** | miss — 2-ply bot; see below |
| full night (greedy) | < 8% | **0.0%** | ok |
| median 180s per night (3+ chalk) | 4–9 | **4** | ok |
| busts per night | 3–7 | **0.0** | miss — see below |
| every single chalk on leg 8 | < 35% | **24.0% max** (`narrow_beds`) | ok |

Conditional leg win rates, optimal, full night with shop:
`96% 91% 84% 79% 73% 72% 73% 62%` — a clean difficulty ramp, and leg 8 is the hardest.

### The four misses, honestly

**Leg 1 greedy at 39%, not 97%.** Under double-out, a policy that never plays toward a
double cannot reliably finish, whatever the deck. The two readings of §15.2 are in tension:
"greedy must win leg 1 at 97%" and "greedy play must lose … that gap *is* the game's skill
expression". The second is the one the design actually rests on, and it is emphatic here:
**39% greedy vs 94% checkout-aware on leg 1, and 0.0% vs 13.8% over a night.** A player who
ignores the checkout arithmetic stalls at leg 1–4; a player who engages with it reaches leg
5–8. That is the intended shape. Closing the greedy number would mean handing out doubles
so freely that the skill gap disappears.

**Leg 8 at 84% with a hand-picked five-chalk set, 25% with a random one.** The band is met
somewhere between; what §15.2 does not say is *which* five chalk. A curated build beating
the last leg 84% of the time is the payoff a roguelite is supposed to offer. The
§15.3 anti-target that does have a crisp meaning — no *single* chalk above 35% — passes
with room (worst is `narrow_beds` at 24.0%).

**Full night 13.8%, not 18–28%.** The measuring instrument is a 2-ply lookahead that
evaluates one throw ahead and cannot plan a finish several visits out; a human with the
checkout hint plays materially better. Rather than inflate rewards until the bot hits the
band (which would make the game too easy for a person), the number is reported as measured.

**Busts 0.0, not 3–7.** This is the deliberate miss doing its job: a bot that always checks
`wouldBust` never busts. The bust rule still bites for a human — busts come from
misjudging a value, not from being trapped — but the honest reading is that the miss trades
some of the TDD's "core tension" for player agency. Without it the game is unwinnable
(leg 1 at 13%), so the trade is worth making; taking the miss away is a one-line change in
`state.ts` if a future designer disagrees.

## The one pair that breached §15.3

The full pair sweep (276 combinations, 200 nights each, leg 8 only) found exactly one
combination over the 80% limit:

```
  OVER overshoot + fourth_dart              83.0%
  ok   narrow_beds + overshoot              72.5%
  ok   narrow_beds + straight_out           50.0%
  ok   wide_grip + fourth_dart              49.5%
```

`fourth_dart` gives a fourth chance to land inside `overshoot`'s two-wide finishing window,
so the pair converts "close enough" into "checked out" far too reliably. §15.3 prescribes
either an anti-synergy or a cost rise; the cost rise is the smaller change and leaves the
rule text alone, so **`overshoot` went from 9 Pot to 12**, matching `fourth_dart`.

Note what that does and does not fix. The sweep grants chalk for free to isolate the
combination, so it still reads 83% — the *effect* is unchanged, and it should be: a player
who assembles that pair has earned it. What changed is the price of assembly: 24 Pot, about
two whole legs of income, against five slots competing for the same coins.

## Not changed

Chalk *effects* are exactly as TDD §5 specifies, and only one chalk *cost* moved
(`overshoot`, above). Card prices, the shop offer pool weights and the leg reward column
are the other tuning knobs touched.


---

# Second pass: the loop rework (after playtest)

The first build shipped a loop the player could beat without thinking: *"All I do
is select every big number until I get down to around 10 left and then I just keep
missing over and over until I get the card I need."* That is an accurate reading of
what the build did, and two of its causes were choices made in the first balance
pass above.

## Diagnosis

1. **Nothing was ever spent.** TDD §3.3 deals `HAND_SIZE` fresh cards for *every
   dart*, so the hand was a slot pull, not a resource. Taking the biggest number
   never cost anything later, so there was never a reason not to.
2. **The endgame was a free reroll.** The double ladder (#45) made almost every
   score finishable and the free miss (#46) let you cycle hands until the right
   card appeared. Between them they turned "can I steer somewhere I can finish?"
   into "mash until it shows up".
3. **No push-your-luck.** The bust is the folk ruleset's built-in gamble and the
   free miss had neutralised it.

## What changed

| Change | Effect |
|---|---|
| **Per-visit hand** (DECISIONS #51) | One hand of five is dealt per visit and spent across its three darts. Spending T20 on the first dart means darts two and three are whatever is left, so the scoring phase is a plan, not a reflex. |
| **The miss ends the visit** (#52) | Still saves the score, but you forfeit the rest of the visit, so fishing for a card burns the visit limit fast. |
| **Heat** (#53) | Consecutive bust-free visits fill a four-pip crowd gauge that scales the leg's Pot up to ×2. One bust wipes it. |
| **"Left it right"** (#54) | +1 Pot, up to 4 a leg, every time a visit ends on a score the deck can actually finish — and every card now shows what it *leaves*, colour-coded. |
| **The pocket** (#55) | Keep one card; it returns every visit until thrown. |

## Why the pocket had to exist

Per-visit hands alone made the game unwinnable, and measurement showed why: the
bottleneck was never scoring, it was *drawing the finisher on the visit you need
it*. Making the deck stronger did not help — the stronger the deck, the more you
overshoot the double.

| Configuration (optimal bot, 150 nights) | leg 1 | night |
|---|---|---|
| per-visit hand of 4, no pocket | 51% | 0.0% |
| per-visit hand of 5, no pocket | 75% | 2.7% |
| hand of 5, stronger deck, no pocket | 73% | 0.7% |
| hand of 5, much stronger deck, no pocket | 52% | 1.3% |
| **hand of 5 + pocket** | **81%** | **6.7%** |
| hand of 6 + pocket | 91% | 16.7% |

The pocket converts the endgame from waiting into planning: you see D16 on visit
two and bank it for the 32 you intend to leave on visit six. Six cards measured
better still, but six readable cards do not fit the 192px hand panel, so the build
takes five and pays for it in the visit limits.

## Where it lands now

Retuned together: starting library (trebles carry the scoring, ladder intact),
visit limits `13 12 11 10 9 8 6 4`, and `overshoot` now requires a finishing
double.

| metric | measured | note |
|---|---|---|
| leg 1, greedy | 38% | plays every big number, never plans a finish |
| leg 1, checkout-aware | 83% | |
| leg 1, visit-planning | 84% | |
| mean legs won: greedy / checkout / planning | **0.60 / 1.77 / 2.57** | the skill gap, four times wider than the first build |
| full night, greedy | 0.0% | |
| full night, planning | 7.2% | a human planning the pocket and the crowd does better |
| the Decider, starting deck, no chalk | 9.0% | TDD §4's "unwinnable without a modifier engine" |
| the Decider, in a full night with a build | ~75% | the payoff for building one |
| busts per night, planning | 0.0 | the miss still buys them out; see the first pass |

The ramp is `84 68 69 68 69 74 71 75`: leg 1 is a gentle open, the middle legs are
the squeeze, and the Decider is a wall unless you arrive with an engine.

## The one anti-target that moved

Under the new loop `overshoot` alone won leg 8 **83%** of the time against a field
mean of 49% — a two-point tolerance below zero meant *any* card could close a leg,
which is `straight_out`'s job. §15.3 sanctions an anti-synergy, so overshoot now
forgives 1 or 2 too many **only on a throw that already counts as a double**. It
keeps its flavour and stops replacing the double rule.


---

# Third pass: the instrument, and what it found in the shop

The second pass tuned the loop with a bot that was still scoring itself against
the *first* loop. `expectedVisit()` modelled TDD §3.3's per-dart deal — a fresh
best-of-three every throw — when the game now deals one hand of five per visit and
spends it across three darts. Everything downstream of that (the whole shop
heuristic, and therefore every number in the second pass) was measured against a
game that no longer existed.

## Fixing the instrument

`expectedTopK(values, h, k)` gives the expected sum of the best `k` of `h` cards
drawn without replacement, exactly, by order statistics. `expectedVisit` now takes
one such statistic over the whole visit and splits it across the throw indices by
how much each pays (`last_orders` and `cold_hands` make the darts unequal), instead
of taking a fresh maximum per dart. Sanity check: with no chalk, `top3 of 3` is
exactly 3x the mean, as it must be.

The corrected model values a marginal card far lower than the broken one did, which
immediately starved the shop bot — its purchase rule was `worth >= cost` with worth
in raw visit points, and the constant converting between them had been fitted to the
inflated numbers. Sweeping that constant went nowhere (2.0%, 1.3%, 3.3%, 0.7% for
1, 2, 3, 5), which is the signature of the wrong lever.

## What the measurement actually said

The right question turned out not to be "how much is a card worth" but "is a card
worth anything at all". Handing the starting deck free cards, no shop, 250 nights:

| library | leg 1 | mean legs won | night |
|---|---|---|---|
| starting 24 | 84% | 3.44 | 1.6% |
| + 2 free T20 | 78% | 2.90 | 1.2% |
| + 4 free T20 | 76% | 2.52 | 0.8% |
| + 4 free mixed (T20 T19 D16 D20) | 84% | 2.87 | 0.8% |
| + 8 free mixed | 76% | 2.09 | 0.4% |

**Free good cards make you worse.** The per-visit hand is why: it is drawn once and
spent across three darts, so a deck stuffed with trebles deals you a hand of
trebles on the visit that wanted a double, and the miss then costs you the visit.

The other direction is just as emphatic. Cutting filler (S12, S16, T14, OB, S18,
T16) out of the starting library, no shop, 300 nights:

| library | leg 1 | mean legs won | night |
|---|---|---|---|
| 24 (shipped) | 85% | 3.42 | 1.7% |
| 22 | 88% | 4.28 | 4.7% |
| 20 | 92% | 5.00 | 7.0% |
| **18** | 92% | 4.73 | **11.7%** |
| 16 | 89% | 3.81 | 2.7% |

Six cards out of the deck is worth ten points of night win rate — more than any
chalk. That is a good thing to find: it means the starting library is doing its job
as a *problem*, and the deckbuilding fantasy is real. It was simply unreachable,
because the service slot rolled `REMOVE` one shop in three and sold out after one
card.

## What changed

- **The bin is weighted 3:2:1 over Sharpen and Duplicate, and stays open.** One
  purchase no longer marks the slot sold; you may bin as many cards as you can pay
  for, down to a floor of six. At 2 Pot a card, this is what the pot is *for*.
- **`purchaseWorth` prices four terms in Pot units** — change in expected visit
  value, change in the odds the visit's hand holds a finisher at all, change in how
  much of the 2-110 finishing band the library closes in two darts, and a flat
  penalty per card held. The last is the measured effect above: it is what makes the
  bot decline a good card it cannot afford to dilute for.
- The dead per-dart hand-size surface (`handSizeFor`, `handSize`,
  `DEFAULT_HAND_SIZE`) is deleted, and the Wide Grip / Tunnel Vision blurbs now
  describe the visit hand they actually change.
- `legPool()` counts the pocketed card. Between visits it is in neither deck, hand
  nor discard, so the checkout hints and the setup bonus could not see the finisher
  the player had deliberately banked.

## Where it lands (1000 nights)

| metric | target | measured | |
|---|---|---|---|
| leg 1, greedy | > 97% | **41.3%** | miss - the skill gap, see the first pass |
| leg 1, checkout-aware | - | 83.2% | reference |
| leg 8, no chalk | < 5% | **9.6%** | close; the pocket raised the floor |
| leg 8, five strong chalk | 45-60% | **79.7%** | a curated build is meant to pay |
| leg 8, twenty random five-chalk sets | 45-60% | **27.7%** | an average build |
| full night (optimal) | 18-28% | **11.3%** | was 7.2% against the broken instrument |
| full night (greedy) | < 8% | **0.0%** | ok |
| median 180s (3+ chalk) | 4-9 | **5** | ok |
| busts per night | 3-7 | **0.0** | the bot always takes the miss; see pass one |
| mean legs won, optimal / greedy | - | **3.21 / 0.65** | |

Conditional leg win rates: `85 78 75 77 76 81 75 65`, corroborated by an independent
400-night run at `85 77 76 79 74 79 77 65`. Leg 6 sits slightly above its neighbours
because a build that survives that far usually has three chalk by then; leg 8 is
still the hardest, as §4 intends.

The two chalk that now clear §15.3's 35% line on their own are `fourth_dart` (45.7%)
and `last_orders` (44.7%). That bar was written against a leg 8 a bare deck won 1% of
the time; with the pocket the bare floor is 9.6%, so the meaningful test — the one
`tests/balance.test.ts` asserts — is that no chalk stands far above the *field*, and
none does. Both are expensive, and neither wins leg 8 without a deck behind it.


---

# Fourth pass: the excitement package

The playtest verdict after the third pass was "it's not feeling addictive enough",
then, more precisely: "more just one more turn mechanics and real thought out
tactics that incorporate small gambling mechanics for the fun of the mechanic."
DECISIONS.md #62–66 are the answer; this is what the instrument said while they
were being tuned.

## What was measured on the way

**The 301 opener is not a free win.** Legs 1 and 2 at 301 with eight visits lost
leg 1 more often than 501 in thirteen did (69% against 85%), because the limit is
what matters and eight was tight. Ten visits is the setting shipped; measured
against 501/13 with the same bot:

| opener | leg 1 | median visits to the first win | night |
|---|---|---|---|
| 501 in 13 | 83% | 6 | 11.7% |
| 301 in 10 | 77% | 4 | 13.3% |
| 301 in 11 | 78% | 4 | 12.7% |

The first win arrives two visits (six darts) sooner, for six points of leg-1 win
rate. That is the trade the brief asked for.

**The bot must not hunt the Shanghai with the pocket.** A first version pocketed a
piece of the called number while the finish was far off. It cost leg 1 eight points
(77% → 69%) and the night half its win rate (13.3% → 6.7%), because the pocket's
real job is the finisher and one pocketed piece leaves a 4% chance a visit deals
the other two. The bot now only takes a Shanghai the hand already offers; the
planner sees the set (including the dart that would otherwise bust) and plays it.
Humans hunting deliberately, and buying toward the number, will beat the bot's
Shanghai rate, which is the point.

**The clean sheet had to allow the wall.** The first draft broke the streak on a
bust *or* a walk to the wall. The optimal bot walks 2.2 times a leg, so the streak
never formed (mean best streak 1.06) and the mechanic was dead. Busts only, with
the wall costing the crowd instead: mean best streak 2.9, and the sheet is the
thing a run is afraid to lose. The multiplier tops out at ×3 rather than ×4
because ×4 from leg 3 on made the shop trivial.

**Shanghai numbers are only called from what the deck can complete.** With any of
20/19/18/17/16 called, the starting library (which holds the full trio only for 20
and 16) produced a Shanghai in 6% of nights. Calling only completable numbers
(and the bot merely accepting what it is dealt) gives 14–19% of nights; the two-of-
three tease fires far more often than that, which is where the moment lives.

## Where it lands (1000 nights)

| metric | target | measured | |
|---|---|---|---|
| leg 1, greedy | > 97% | **39.5%** | miss — the skill gap, see the first pass |
| leg 1, checkout-aware | — | 77.0% | the short game: median four visits to the first win |
| leg 8, no chalk | < 5% | **15.4%** | the sheet-fed Pot and the pocket raised the floor |
| leg 8, five strong chalk | 45–60% | **80.9%** | a curated build is meant to pay |
| leg 8, twenty random five-chalk sets | 45–60% | **29.8%** | an average build |
| full night (optimal) | 18–28% | **11.3%** | unchanged from the third pass, with a shorter night |
| full night (greedy) | < 8% | **0.0%** | ok |
| median 180s (3+ chalk) | 4–9 | **5** | ok |
| busts per night | 3–7 | **0.0** | the bot always takes the wall; see pass one |
| mean legs won, optimal / greedy | — | **2.85 / 0.64** | leg 1 is harder, the rest are easier |

Conditional leg win rates: `76 74 76 79 78 80 74 72`. The ramp is flatter than the
third pass's `85 78 75 77 76 81 75 65`: the short game costs leg 1 nine points, and
the clean sheet's Pot makes the Decider seven points kinder to a build that arrives
clean. The night's win rate is the same to the decimal, reached faster.

Over 300 nights with the package on, the optimal bot: Pot earned 218 a night (was
119), best clean sheet 2.9 legs, a Shanghai in 14% of nights, the crowd banked 1.9
times a night, and 2.3 walks to the wall per leg.

The chalk over §15.3's 35% line on leg 8 alone are now `fourth_dart` (52.7%),
`wide_grip` (40.3%) and `last_orders` (36.3%) — the extra dart and the extra card
are exactly what a Shanghai wants, which is a synergy the folk rule invites rather
than an accident. The test that guards the anti-target (no chalk far above the
field) still passes with room; if playtesting says Fourth Dart is a must-buy, its
price is the knob.

The instrument is honest about what it cannot see: the bot never busts, so the
clean sheet's ×3 is its default and the busts-per-night line stays at 0.0; a human
who busts twice a night feels the sheet break, which is the design. The bot also
never hunts the Shanghai and never rides the crowd on purpose, so its Shanghai and
cash numbers are floors.
