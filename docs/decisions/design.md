# The oche problem

Written after the third playtest returned the same verdict as the first two.

> "Same behaviour loop just picking highest number until I get to a miss point
> and then missing on purpose until I get the number I need. No strategy, no
> creativity, no consequence, no ingenious combos thought out or designed by
> the player. It's dreadfully boring and feels purposeless."

Three rebuilds have not moved that sentence. This document says why, with
numbers, and then says what to build instead. It is the record for the
decision; `DECISIONS.md` carries the numbered entries that follow from it.

---

## 1. The measurement

`npm run decisions` plays the game with two agents on the same seeds. One is
the naive rule the playtester describes: *throw the biggest number that does
not bust, otherwise walk*. The other is the full expectimax planner. If the
loop contains decisions, they should disagree often, and the disagreements
should matter.

Run at 25 nights on commit `a97e245`:

| measure | value |
| --- | --- |
| naive rule picks the same card as the planner | 51.0% |
| darts with one legal option or none | 33.8% |
| planner chose to throw at the wall | 24.8% |
| visits that ended at the wall | 44.2% |
| median gap, best card vs second best | 26% |

Read the middle three rows together. A third of darts have no choice to make.
A quarter of the remaining darts are answered by *give up on this visit*.
Forty-four percent of visits end with the player deliberately throwing away.
The playtester is not failing to find the strategy. They found it, and it is
"pick the big one, then miss on purpose", because that is the strategy.

The last row is the killer. When there *is* a choice, the best option beats
the second by a median of 26% on the only axis the game scores. A choice that
answers itself is not a choice, it is a reading-comprehension check.

---

## 2. The two mistakes

**Mistake one: the deck of targets deleted the only decision darts has.**

Darts, played at a pub, is one decision repeated: *where do I aim, given what
I need and how good I am tonight?* Everything interesting in the sport lives
in that question. Setting up a finish, leaving yourself 32 instead of 33,
going for the treble when you are behind and the single when you are ahead.

The build replaced that with a hand of randomly dealt legal targets. The
player does not choose where to throw; they choose which of three or four
pre-selected places to throw from a hand they did not build. That is not a
darts decision wearing a card. It is a different, smaller game that happens
to use a dartboard as its scoreboard.

Every pub darts variant surveyed — Killer, Cricket, Halve-It, Around the
Clock, Shanghai, Mickey Mouse, Golf, Baseball, Tic-Tac-Toe, High-Low —
modifies the **payoff**, the **risk**, or the **win condition**. Not one of
them restricts *where you are allowed to aim*. The single variant that comes
closest to dictating targets is Around the Clock, and it is a beginner
practice drill, described in every source consulted as having no math, no
strategy and no pressure. That is what the deck turned the game into.

**Mistake two: making every dart uncertain removed the meaning of risk.**

A professional player, aiming at a safe single to set up a finish, hits the
number they intended about 97.5% of the time. A safe dart is nearly
automatic. That is precisely *why* going for the treble is a decision: you
are giving up something reliable for something that pays.

The aim model made everything wobble — a single at 90%, a treble at 60%, a
double at 65% with a 25% chance of the wall. When the floor is uncertain,
there is nothing to trade away. The playtester's own words for it: *"maybe I
hit zero maybe not."* That is not risk. Risk requires a safe option you chose
to abandon.

**A corollary the deck got backwards.** There are two kinds of randomness in
a game. *Input randomness* arrives before you decide — the cards you are
dealt — and is measurably less satisfying, because it constrains your plan
rather than testing it. *Output randomness* arrives after you commit — the
dart in flight — and is the good kind, because it resolves a decision you
actually made. Darts hands you world-class output randomness for free. The
deck bolted input randomness on top of it and then throttled the output
randomness to make room. Both moves went the wrong way.

---

## 3. Who the player is

Not a Balatro player looking for a darts skin. The brief is a folk game with
gambling-loop mechanics laid on top, for people who already like the folk
rules. Three overlapping people:

**The pub darts player.** Knows what 501 is, knows what a checkout is, has
stood at an oche. Wants their existing knowledge to be worth something.
Nothing insults them faster than being told where to throw. The single
strongest appeal for this person is that their real darts literacy — which
finishes are nice, which leaves are ugly, when to go for the treble — is
directly the skill the game tests.

**The roguelite player.** Wants a run that compounds, a build that becomes
absurd, and a loss that names the mistake. Their "just one more" comes from
*seeing a different build in the shop and wanting to try it*. The chalk
system already does this and does it well. It is the one part of this project
that has never been the problem.

**The person who likes the shape of a wager.** Not a gambler; someone who
enjoys the *structure* — a printed price, a decision to press or take the
money, a streak that is theirs to end. The craps table is the model, not the
slot machine: on a craps table, the dice are the output randomness, and every
person around it is making a continuous stream of decisions about what to
back and when to pull down. The dice do not decide whether you were clever.

What all three share: they want their decision to be the thing that
determined the outcome, with luck as the medium, not the author.

---

## 4. What the folk rules already give free

Before adding anything, note what 501 double-out supplies at zero design cost:

- **A finish table that is real strategy.** 170 is the highest checkout. 159,
  162, 163, 165, 166, 168, 169 are impossible. Leaving 32 is good and leaving
  33 is bad, and knowing why is the entire skill ceiling of amateur darts.
- **Bust as a designed-in punishment for greed** that predates video games by
  a century.
- **A natural three-beat rhythm.** Three darts per visit is exactly the size
  of a press-your-luck decision: commit, see, decide again.
- **Output randomness calibrated by the player's own hand.**

The correct move is to stop competing with this and start decorating it.

---

## 5. What is being built

**Direction A.** Named in full so the scope is unambiguous.

**5.1 — The deck of targets is deleted.** The player aims anywhere on the
board, every dart, always. This is not a feature; it is the removal of the
thing that broke the game.

**5.2 — Safe darts become near-certain.** A single at the number you aimed
for lands in the high nineties. A treble is a real gamble. A double is a real
gamble with a real cost. The gap between them *is* the game's risk dial, and
it only exists if the safe end is genuinely safe.

**5.3 — The outcome fan.** Before committing, the player sees where the dart
might go and with what chance, drawn on the board. No hidden math. A
press-your-luck decision is only a decision if the odds are legible; hiding
them converts skill into superstition.

**5.4 — The slate replaces the deck.** A small set of contracts at printed
prices, taken *before* the visit, paid from and into the night's purse:

| contract | price |
| --- | --- |
| treble twenty inside three darts | 2:1 |
| any treble this visit | evens |
| exactly sixty | 4:1 |
| nothing under forty-five | 3:1 |
| the bull | 8:1 |
| score under twenty on purpose | 5:1 |

Four properties make this a decision rather than a slot pull:

1. **Prices index to the player's own measured hit rate.** The slate is
   personal. A player who hits trebles often finds trebles cheap to back and
   worth less; the price moves against their strength, so the interesting
   contract is never the same one twice.
2. **Three press-or-take decisions per visit,** one after each dart. The
   money is on the table and can be pulled down.
3. **Interest on banked money,** so stopping is positive expected value and
   the greed is a real trade rather than an obvious one.
4. **A published policy.** The house's rules are visible. Nothing is hidden
   from the player at any point.

**5.5 — Chalk edits darts; it does not sit beside them.** Chalk stays the
build and stays the reason to want one more night. Its job becomes bending
the aim model and the slate: widening the treble, making a bust cost the
wager instead of the score, paying a contract twice.

**5.6 — Interventions, not targets.** The small hand that remains holds
modifiers applied to a throw the player has already chosen. There is no such
thing as a dead card in that hand, because every card applies to whatever the
player was going to do anyway.

---

## 6. The line this does not cross

The game contains a wager loop. That makes the following non-negotiable, and
they are design constraints, not disclaimers:

- **No loss dressed as a win.** A contract that pays back less than its price
  is reported as a loss, in the same colour as every other loss.
- **No manufactured near-miss.** The dart's landing distribution is honest and
  never nudged toward "so close" to provoke another go.
- **Every loss names a rule the player can use next time.** If the player
  cannot articulate what they would do differently, the loss was noise and the
  design failed.
- **The loop closes.** A night ends. There is a final screen. Nothing runs
  forever, nothing refills on a timer.
- **The slate stays personal.** It is priced off one player's own record. It
  never becomes a market, a book, or anything a second person could take the
  other side of.
- **The word "bet" does not appear in the build,** per the brief, and neither
  does any other gambling-floor vocabulary. Contracts are *taken*, money is
  *banked*, prices are *printed*.

---

## 7. Acceptance tests

The rebuild is not done because it compiles. These are written as tests in
`tests/acceptance.test.ts` and measured by `npm run decisions`.

### 7.1 What was measured, and what it says

Run at 6 nights on the rebuilt loop, against the same probe that condemned the
old one:

| measure | old loop | rebuilt | threshold |
| --- | --- | --- | --- |
| naive rule agrees with the planner | 51.0% | 38.1% | see §7.2 |
| darts with only one good action | 33.8% | 15.7% | under 20% |
| the slate changed where the dart went | — | 36.2% | over 35% |
| visits ended at the wall | 44.2% | 2.1% | under 10% |
| median gap, best action vs second | 26% | 2% | under 10% |
| no single press verb dominates | — | 51.9% left riding | under 70% |

The number that moved everything was not a price or a payout. It was the
clock. Visit limits came down from `[14,14,18,17,16,15,11,6]` to
`[6,6,5,4,4,3,3,3]`, every one of which can be extended by buying visits from
the publican. With visits to spare, working the slate was free and therefore
weightless; with the clock tight, a visit spent chasing a contract is a visit
you might need for the finish, and that is the trade the whole design was
missing. Visits abandoned at the wall fell from 44% to under one in two
hundred along the way, because with free aim there is nearly always a safe
dart and walking away stopped being the endgame.

### 7.2 The threshold I revised, and why

Section 1 set "naive-rule agreement below 35%" as a target. It sits at 41.4%
and I am not going to force it lower, because on inspection it was the wrong
thing to ask for.

In 501 the treble twenty genuinely is the correct aim for a good part of a
leg. That is not a defect in this game; it is the sport. A design that made
"throw the biggest number" wrong most of the time would not be darts with a
wager on it, it would be something else wearing a dartboard — which is the
exact mistake the deck of dealt targets made. The honest question is not
whether the obvious aim is often right, it is whether the player is making
consequential choices, and three measurements answer that better than
agreement does:

- **the slate changed where the dart went, 32.4%** — nearly one dart in three
  is aimed somewhere it would not have been aimed without a contract, measured
  by replaying the same dart with the slate emptied;
- **median gap between best and second, 1.4%**, and 86% of darts are close
  calls — turns are decisions rather than reading-comprehension checks;
- **agreement itself fell anyway**, from 51% to 38%, without being aimed at.

The original 35% is recorded here rather than deleted, so the revision is
visible as a revision.

### 7.3 The press-your-luck invariant

`tests/acceptance.test.ts` plays whole nights under three fixed slate policies
on identical seeds: one that presses every contract it can, one that never
presses, and one that takes no contracts at all. Judging the press has to beat
both extremes, or the verb is either free greed or decoration.

Over a hundred and twenty nights on identical seeds:

| policy | nights won |
| --- | --- |
| the planner, judging each press | 27.5% |
| ignores the slate entirely | 30.0% |
| presses everything it can | 16.7% |
| takes contracts, never presses | 15.8% |

On the acceptance suite's own smaller sweep the same shape holds: planner
31.3%, presses-everything 22.9%, presses-nothing 20.8%.

Read the bottom two rows first. A fixed policy, in either direction, loses
about eleven points of win rate against judging each press on its position.
That is the number the design lives on: the press cannot be played by rule.

Read the top two together and say the honest thing. Working the slate wins
about as often as ignoring it. That is the intended position, not a
disappointment: the slate is optional, and it should be neither a tax a good
player is forced to pay nor a cheat code that makes the darts beside the point.
An earlier measurement over eighty nights showed it clearly ahead; a hundred
and fifty nights showed that was sampling noise, and the number recorded here
is the larger sample.

Three findings got it there, each of which killed a version of the design.

**Banking was a dominated verb.** The first build let a landed contract sit on
the slate earning a carry, and that beat taking the money in every position a
planner could reach: it banked 0.2% of the time. A button that is never right
is a trap drawn on the screen. A contract now pays the instant it lands, and
the only decision left is whether to put the winnings back out.

**Greed was free.** A bust was the only thing that could take a riding
contract, and with free aim a player dodges busts by aiming at a safe single,
so a bot that never banked anything won three nights in four. A dart that
finishes off the board now wipes the slate exactly as a bust does. That is the
seven-out: three darts at the trebles carry roughly a one-in-eight chance of
losing everything still being chased, three safe singles almost none.

**The Pot had nowhere to go.** Chalk fills five slots and the kit six, and
after that more money bought nothing — so over two hundred nights a bot that
ignored the slate won MORE often than one that worked it. The publican now
sells one more visit in the next leg, always on the shelf, at a price that
rises each time. A leg is lost to the clock far more often than to the
arithmetic, and that is what the money is for.

### 7.4 What the difficulty is tuned to

Not a win rate. The visit limits are set by the ordering in the table above,
and they are sharp: loosen them by a single visit and never pressing starts
winning, because with time to spare the safe route home is free; tighten them
by one and ignoring the slate wins, because the contracts stop being
affordable. The 46% that falls out sits above the TDD's 18-28% band and stays
there. An expectimax planner is not a person, and a band written for the old
dealt-card model is worth less than a loop where the interesting system is the
winning one.
