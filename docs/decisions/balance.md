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
