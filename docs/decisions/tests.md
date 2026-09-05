# Decisions — engine test suite

Choices the TDD leaves open, as exercised by `tests/*.test.ts`. Where the
engine made a documented choice the tests assert that choice; the TDD's own
text wins everywhere else.

- **Scripted determinism bot** (`tests/helpers.ts`): highest-value card in hand
  that does not bust (forgiveness treated as spent so a forgivable bust still
  reads as a bust), else the first card; in the shop, the first affordable
  card slot, then leave. It never touches the night RNG. A second,
  checkout-aware bot (`smartPickCard` / `smartShop`) exists only to reach the
  later legs and the shop's chalk/refresh paths in the snapshot tests; the
  1000-run seed 12345 test uses the plain scripted bot as specified.
- **Deep determinism configuration**: `straight_out, overshoot, wide_grip, wired`
  held from the start. `wired` is the only chalk that consumes the gameplay RNG,
  so the deep run is the one that proves deflection rolls are replayable.
- **Bust table reference** is computed inline from first principles (bed ×
  multiplier, OB 25, IB 50; below 0 / exactly 1 / non-double 0 → BUST) and is
  asserted against both `classifyBase` and `resolveThrow` with no chalk. The
  closed-form cell counts (21 checkouts, 62 exactly-one busts, 1927 below-zero
  busts, 40 non-double-zero busts) are asserted as a cross-check on the table.
- **Finishability** is derived by brute force over the 62 targets and compared
  with `isFinishableBase`, so the folk set {159, 162, 163, 165, 166, 168, 169}
  is proven rather than copied.
- **Nine-darter** is judged the engine's way: three visits used on a leg (every
  leg starts at 501, so this equals "501 checked out in three visits").
- **`chalked_up` peek** is tested as the engine implements it: the top three deck
  cards *before* the visit's first hand is dealt (TDD §5.4 says DEAL chalk
  resolves before the deal). With a 3-card hand the peek is therefore the hand
  itself; see `issues` in the test report.
- **Shop `REMOVE` floor**: the engine refuses to shrink the library below 7
  cards; tested as an engine choice.
- **Chalk offer with everything held**: when all 24 chalk are held the shop has
  three slots (no chalk slot); tested as an engine choice.
- **`overshoot` checkouts need no double** and **`feathered` does not touch the
  inner bull** — engine choices already recorded in `resolver.test.ts`.
- **Achievement `thin`** fires on any checkout in ≤ 6 visits, including leg 8;
  `sharp` on any checkout whose finishing visit started at ≥ 100; `wide` the
  moment the fifth chalk is held (shop purchase); `steady` on a won night with
  `stats.busts === 0`. Each fires once per night.
- **Commentary repeat window** is measured over react calls (one per engine
  event), matching TDD §16 stage 8 ("no repeat within 8 events"); the sequence
  is a scripted 200+ event night mixing forced 180s, a 26, a bust chain of
  four, a landing on 1 and on 170, a 100+ checkout, a shop with and without
  Pot, idle events, a leg-8 timeout, a leg-8 win and a nine-darter.
- **Bark safety list**: ~50 real darts surnames, bodies, venues, broadcasters
  and sponsors matched case-sensitively on word boundaries (so "cross", "price"
  and "king" as ordinary words are fine); gambling words and second-person
  criticism are matched case-insensitively.
- **Licence audit** lists packages with no `license` field instead of failing,
  and accepts an `OR` expression when any branch is permissive.
