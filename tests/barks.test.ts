/**
 * Commentary (TDD §10, §11.8, §16 stage 8, §17.10): the bark pool's size,
 * length, required triggers and safety; and the engine's priority, cooldown,
 * no-repeat window, placeholder filling and determinism over a scripted,
 * varied sequence of 200+ engine events.
 *
 * The fixtures here drive the rebuilt loop (docs/decisions/design.md §5): free
 * aim at any of the 62 targets, and a slate of contracts that are taken,
 * banked, pulled, pressed or lost. No deck, no hand, no pocket.
 */
import { describe, expect, it } from 'vitest';
import { BARKS, allBarkLines } from '../src/content/barks.ts';
import { HEAT_CAP } from '../src/content/legs.ts';
import { parseTarget } from '../src/core/board.ts';
import { Commentary, buildBarkContext, contractName, describeChalkChain, type Bark } from '../src/core/commentary.ts';
import {
  addChalk,
  beginLeg,
  commitMiss,
  commitThrow,
  createNight as createNightRaw,
  currentLeg,
  currentVisit,
  pressContract,
  pressable,
  pullContract,
  shopBuy,
  shopLeave,
  shopRefresh,
  takeContract,
  useRubOut,
} from '../src/core/state.ts';
import type { BarkContext, BarkTrigger, EngineEvent, NightState, OcheId, TakenContract, ThrowResult } from '../src/core/types.ts';

/** These tests pin arithmetic and event order, not luck: every dart lands where it is aimed. */
const createNight = (seed: number, oche: OcheId = 'local') => createNightRaw(seed, oche, { trueAim: true });

// ---------------------------------------------------------------- local fixtures
//
// The engine's own test helpers are shared with the state suite; the bark
// fixtures only need four things, so they live here where they can be read
// beside the sequence they build.

/** Throw at a named target: "t20", "d16", "s1", "bull". */
function play(n: NightState, spec: string, use?: string): { result: ThrowResult; events: EngineEvent[] } {
  return commitThrow(n, parseTarget(spec), use ? { use } : {});
}

/** Set the remaining score, and the visit's start score if no dart has gone yet. */
function setScore(n: NightState, score: number): void {
  const leg = currentLeg(n);
  leg.score = score;
  const v = currentVisit(leg);
  if (v.throws.length === 0) v.scoreAtVisitStart = score;
}

/** Chalk a known contract up as the whole offer and take it. */
function take(n: NightState, defId: string): EngineEvent[] {
  currentLeg(n).offer = [defId];
  const out = takeContract(n, defId);
  if (!out.ok) throw new Error(`take ${defId}: ${out.reason}`);
  return out.events;
}

const LINES = allBarkLines();
const BY_ID = new Map(BARKS.map((t) => [t.id, t]));

// ---------------------------------------------------------------- the pool

describe('the bark pool (TDD §10.3)', () => {
  it('has at least 120 lines across main and reply pools', () => {
    let total = 0;
    for (const t of BARKS) total += t.lines.length + (t.reply?.lines.length ?? 0);
    expect(total).toBe(LINES.length);
    expect(total).toBeGreaterThanOrEqual(120);
  });

  it('every line is at most 90 characters (two lines at 5×7)', () => {
    const long = LINES.filter((l) => l.length > 90).map((l) => `${l.length}: ${l}`);
    expect(long).toEqual([]);
  });

  it('every line is non-empty, trimmed, and uses only ASCII printable characters plus the ellipsis', () => {
    for (const l of LINES) {
      expect(l.length).toBeGreaterThan(0);
      expect(l).toBe(l.trim());
      expect(/^[\x20-\x7e…]+$/.test(l), l).toBe(true);
    }
  });

  it('trigger ids are unique and every trigger has a speaker, a positive cooldown and lines', () => {
    expect(new Set(BARKS.map((t) => t.id)).size).toBe(BARKS.length);
    for (const t of BARKS) {
      expect(['BARREL', 'NOCK']).toContain(t.speaker);
      expect(t.cooldown).toBeGreaterThan(0);
      expect(t.lines.length).toBeGreaterThan(0);
      expect(typeof t.when).toBe('function');
      if (t.reply) {
        expect(t.reply.speaker).not.toBe(t.speaker);
        expect(t.reply.lines.length).toBeGreaterThan(0);
      }
    }
  });

  it.each([
    ['visit_180', 100],
    ['visit_26', 90],
    ['checkout_100', 95],
    ['checkout_leg8', 100],
    ['bust_1', 70],
    ['bust_2', 70],
    ['bust_3', 70],
    ['bust_4plus', 70],
    ['chalk_chain_4', 85],
    ['score_170', 60],
    ['score_1', 80],
    ['nine_darter', 110],
    ['timeout_leg8', 100],
    ['shop_zero_pot', 40],
    ['idle_15', 20],
    // the crowd
    ['heat_max', 88],
    ['heat_lost', 86],
    // the slate: taken, riding, settled, and the press
    ['slate_offered', 22],
    ['contract_taken', 44],
    ['contract_riding', 68],
    ['contract_paid_early', 72],
    ['contract_pulled', 66],
    ['contract_paid', 76],
    ['contract_lost', 74],
    ['contract_lost_bust', 90],
    ['contract_pressed', 98],
    ['contract_pressed_twice', 102],
    ['pressed_landed', 99],
    ['pressed_died', 99],
    // free aim
    ['aim_bull', 57],
    ['aim_low_bed', 50],
    ['aim_double_early', 52],
    ['aim_same_bed', 54],
    ['treble_wall', 66],
  ])('required trigger %s is present with priority %i', (id, priority) => {
    const t = BY_ID.get(id);
    expect(t, id).toBeDefined();
    expect((t as BarkTrigger).priority).toBe(priority);
  });

  it('nothing survives from the deck: no trigger reads a hand, a deck, a pocket or a leg Shanghai', () => {
    for (const id of ['pocketed', 'setup_bonus', 'shanghai', 'shanghai_two', 'shanghai_scoring', 'shanghai_called']) {
      expect(BY_ID.has(id), id).toBe(false);
    }
  });

  it('the 180 is the loudest ordinary event and the nine-darter outranks everything', () => {
    const nine = BY_ID.get('nine_darter') as BarkTrigger;
    for (const t of BARKS) if (t.id !== 'nine_darter') expect(t.priority).toBeLessThan(nine.priority);
    const one80 = BY_ID.get('visit_180') as BarkTrigger;
    expect(one80.speaker).toBe('BARREL');
    expect(one80.reply?.speaker).toBe('NOCK');
  });

  it('the bust escalation matches the TDD: 3 is a single word, 4+ changes the subject', () => {
    const three = BY_ID.get('bust_3') as BarkTrigger;
    for (const l of three.lines) expect(l.split(/\s+/).length).toBe(1);
    const four = BY_ID.get('bust_4plus') as BarkTrigger;
    expect(four.speaker).toBe('BARREL');
    for (const l of four.lines) expect(/\bbust\b/i.test(l)).toBe(false);
  });

  it('the timeout_leg8 pool is kind: no mocking words', () => {
    const t = BY_ID.get('timeout_leg8') as BarkTrigger;
    for (const l of [...t.lines, ...(t.reply?.lines ?? [])]) expect(/\b(fail|failed|failure|lose|loser|lost|pathetic|useless|rubbish)\b/i.test(l), l).toBe(false);
  });

  it('a lost contract is reported as a loss and the analyst names a rule (design.md §6)', () => {
    for (const id of ['contract_lost', 'contract_lost_bust', 'pressed_died']) {
      const t = BY_ID.get(id) as BarkTrigger;
      const all = [...t.lines, ...(t.reply?.lines ?? [])];
      // Nothing dresses a loss up as anything else.
      for (const l of all) expect(/\b(unlucky|nearly there|so close|next one|keep going|one more)\b/i.test(l), l).toBe(false);
      // And somewhere in the pool is the rule that would have stopped it.
      const nock = t.speaker === 'NOCK' ? t.lines : (t.reply?.lines ?? []);
      expect(nock.some((l) => /\b(pull|pulled|pulling|press|pressed|pressing|On Tick|darts|dart|clock)\b/i.test(l)), id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- safety scan (TDD §17.10, §11.8)

const GAMBLING = /\b(bet|bets|betting|odds|wager|wagers|wagering|stake|stakes|bookie|bookies|bookmaker|bookmakers|punt|punts|punter|gamble|gambling|gambler)\b/i;

const CRITICISM = [
  /\byou(?:'re| are)\s+(rubbish|useless|bad|terrible|awful|hopeless|pathetic|an idiot|a loser)\b/i,
  /\byour fault\b/i,
  /\b(idiot|stupid|loser|muppet|moron|pillock|numpty)\b/i,
  /\byou (?:can't|cannot|couldn't) (?:throw|play|count|hit)\b/i,
  /\b(?:shame on you|you should be ashamed)\b/i,
];

/** Real darts players (surnames), bodies, events, venues, broadcasters and sponsors. Matched case-sensitively on word boundaries. */
const REAL_WORLD = [
  // players
  'Taylor', 'Bristow', 'Lowe', 'Wilson', 'Anderson', 'Gerwen', 'Barneveld', 'Wright', 'Price', 'Cross', 'Lewis', 'Wade',
  'Whitlock', 'Littler', 'Humphries', 'Aspinall', 'Clayton', 'Dobey', 'Searle', 'Chisnall', 'Gurney', 'Suljovic', 'Schindler',
  'Heta', 'Noppert', 'Bunting', 'Priestley', 'Deller', 'Fordham', 'Adams', 'Hankey', 'Gulliver', 'Sherrock', 'Mardle', 'Part',
  'Rees', 'Beaton', 'Durrant', 'Waites', 'Painter', 'Baxter', 'Klaasen', 'Jenkins', 'Rydz', 'Menzies',
  // bodies, events, venues
  'PDC', 'BDO', 'WDF', 'UKDA', 'Premier League', 'World Matchplay', 'World Grand Prix', 'Grand Slam', 'Ally Pally', 'Alexandra Palace',
  'Lakeside', 'Winter Gardens', 'Circus Tavern',
  // broadcasters
  'Sky Sports', 'ITV', 'BBC', 'Eurosport', 'DAZN', 'Viaplay',
  // sponsors and brands
  'Winmau', 'Unicorn', 'Harrows', 'Red Dragon', 'Target Darts', "Bull's", 'Ladbrokes', 'William Hill', 'Betfred', 'Paddy Power',
  'Bet365', 'Betway', 'Coral', 'Unibet', 'Cazoo', "McCoy's", 'BoyleSports', 'Bwin', 'Stan James',
];

describe('bark safety scan (TDD §17.10)', () => {
  it('contains no gambling terminology', () => {
    const hits = LINES.filter((l) => GAMBLING.test(l));
    expect(hits).toEqual([]);
  });

  it('the source itself never says the word, in a line, a comment or an identifier', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['src/content/barks.ts', 'src/core/commentary.ts']) {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(/\bbet\b/i.test(src), file).toBe(false);
      expect(/\b(wager|gambl\w*|punter|bookmaker)\b/i.test(src), file).toBe(false);
    }
  });

  it('never criticises the player in the second person', () => {
    const hits: string[] = [];
    for (const l of LINES) for (const re of CRITICISM) if (re.test(l)) hits.push(`${re}: ${l}`);
    expect(hits).toEqual([]);
  });

  it('names no real player, organisation, venue, broadcaster or sponsor', () => {
    const hits: string[] = [];
    for (const name of REAL_WORLD) {
      const re = new RegExp(`(?<![A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`);
      for (const l of LINES) if (re.test(l)) hits.push(`${name}: ${l}`);
    }
    expect(REAL_WORLD.length).toBeGreaterThanOrEqual(40);
    expect(hits).toEqual([]);
  });

  it('mentions money only as the in-game Pot', () => {
    const hits = LINES.filter((l) => /\b(quid|pounds?|£|\$|euros?|dollars?|cash|prize money|jackpot)\b/i.test(l));
    expect(hits).toEqual([]);
  });

  it('the commentators are BARREL and NOCK and nobody else speaks', () => {
    for (const t of BARKS) {
      expect(['BARREL', 'NOCK']).toContain(t.speaker);
      if (t.reply) expect(['BARREL', 'NOCK']).toContain(t.reply.speaker);
    }
  });

  it('every placeholder in the pool is one the engine fills', () => {
    const known = new Set(['score', 'total', 'value', 'chalk', 'leg', 'pot', 'target', 'n180', 'contract', 'price', 'payout', 'from']);
    const unknown: string[] = [];
    for (const l of LINES) for (const m of l.matchAll(/\{(\w+)\}/g)) if (!known.has(m[1])) unknown.push(`${m[1]} in "${l}"`);
    expect(unknown).toEqual([]);
  });
});

// ---------------------------------------------------------------- a scripted, varied sequence of events

/** Snapshot a bark context so it can be replayed later against another Commentary instance. */
function snap(n: NightState, event: BarkContext['event'], tr?: ThrowResult): BarkContext {
  return structuredClone(buildBarkContext(n, event, tr));
}

/**
 * 200+ engine events with every required trigger reachable: a 180, a 26, a
 * landing on 170 and on 1, a bust chain of four, a 100+ checkout, shops with
 * and without Pot, idle, a chalk-heavy leg, a leg-8 timeout, a leg-8 win and a
 * nine-darter — plus the whole of the rebuilt loop: contracts taken cheap,
 * dear and long; a contract banked, one pulled, one paid at the end of the
 * visit and one that simply did not land; a bust that takes a live contract
 * and a bust that takes one already made; a press that lands, a press that
 * dies and a second press on top of the first; the kit spent and the slate
 * rubbed out; and darts sent at the bull, at the low beds, at a double with
 * three figures still on the board, and twice into the same bed.
 */
function buildSequence(): BarkContext[] {
  const seq: BarkContext[] = [];
  const n = createNight(4242);
  const push = (events: EngineEvent[]) => {
    for (const e of events) seq.push(snap(n, e));
  };
  const idle = (seconds: number) => seq.push(snap(n, { type: 'IDLE', seconds }));

  push(beginLeg(n));
  // The visit limits are a balance dial and move; this fixture is about the
  // commentary, so it lifts them and never times a leg out by accident.
  currentLeg(n).visitLimit = 60;
  // The short game opens a real night; this script wants the 501 arithmetic.
  setScore(n, 501);
  // visit 1: a 180 (501 → 321)
  for (const t of ['t20', 't20', 't20']) push(play(n, t).events);
  idle(20);
  // visit 2: land on exactly 170, then 150, 130
  setScore(n, 230);
  for (const t of ['t20', 's20', 's20']) push(play(n, t).events);
  // visit 3: the classic 26
  for (const t of ['s20', 's5', 's1']) push(play(n, t).events);
  // visit 4: down to 1 (bust)
  setScore(n, 41);
  for (const t of ['s20', 's20']) push(play(n, t).events);
  idle(16);
  // visit 5: a quiet visit resets the bust count
  setScore(n, 400);
  for (const t of ['s1', 's3', 's5']) push(play(n, t).events);
  // visits 6–9: a chain of four busts
  for (let i = 0; i < 4; i++) {
    setScore(n, 10);
    push(play(n, 't20').events);
  }
  idle(40);
  // visit 10: a 100 checkout → shop with pot
  setScore(n, 100);
  push(play(n, 't20').events);
  push(play(n, 'd20').events);
  seq.push(snap(n, { type: 'SHOP_ENTER', pot: n.pot }));
  idle(15);
  // shop: chalk for a chain, a kit slot, a refresh
  n.pot = 60;
  const shop = n.shop as NonNullable<NightState['shop']>;
  shop.slots[2] = { kind: 'CHALK', chalkId: 'split_tips', cost: 8, sold: false };
  push(shopBuy(n, 2).events);
  push(shopBuy(n, 0).events);
  push(shopRefresh(n).events);
  for (const id of ['heavy_tips', 'oiled', 'even_keel', 'cheap_chalk']) addChalk(n, id);
  push(shopLeave(n));

  // ---- leg 2: the slate. The visit limit is lifted so the fixture can take
  // its time; every beat below is one visit and none of them is a timeout.
  currentLeg(n).visitLimit = 60;
  n.pot = 200;
  // a chalk-heavy visit for the four-stage pipeline, then the chalk comes off
  // so the slate and the aim can be read without it shouting over them.
  setScore(n, 400);
  for (const t of ['t20', 't20', 't20']) push(play(n, t).events);
  n.chalk = [];
  // four clean visits: the crowd warms up to the cap
  for (let v = 0; v < 4; v++) {
    setScore(n, 400);
    for (const t of ['s20', 's20', 's20']) push(play(n, t).events);
  }
  // taken cheap, left riding, and paid at the end of the visit
  setScore(n, 400);
  push(take(n, 'ton'));
  push(play(n, 't20').events);
  push(play(n, 't20').events);
  push(play(n, 's20').events);
  // taken and banked the moment it landed
  setScore(n, 400);
  push(take(n, 'treble'));
  push(play(n, 't20').events);
  push(commitMiss(n).events);
  // a long price, taken and then pulled down for the small certain money
  setScore(n, 400);
  push(take(n, 'bull'));
  push(play(n, 's19').events);
  push(pullContract(n, 0).events);
  push(commitMiss(n).events);
  // a dear one that never gets near its condition
  setScore(n, 400);
  push(take(n, 'fish'));
  for (const t of ['s1', 's1', 's1']) push(play(n, t).events);
  // a made contract taken down by a bust: the cruellest one
  setScore(n, 400);
  push(take(n, 'treble'));
  push(play(n, 't20').events);
  setScore(n, 10);
  push(play(n, 't20').events);
  // a live contract taken down by a bust
  setScore(n, 400);
  push(take(n, 'bull'));
  push(play(n, 's19').events);
  setScore(n, 10);
  push(play(n, 't20').events);
  // the press: it paid, and the winnings go back up on something harder
  setScore(n, 400);
  push(take(n, 'treble'));
  push(play(n, 't20').events);
  push(pressContract(n, pressIdx(n)).events);
  push(play(n, 't19').events);
  push(commitMiss(n).events);
  // the press that dies
  setScore(n, 400);
  push(take(n, 'treble'));
  push(play(n, 't20').events);
  push(pressContract(n, pressIdx(n)).events);
  for (const t of ['s5', 's5']) push(play(n, t).events);
  // pressed twice, and it lands. A press leaves the contract it paid where it
  // is and pushes the harder one on the end, so the second press is a
  // different index from the first.
  setScore(n, 400);
  push(take(n, 'treble'));
  push(play(n, 't20').events);
  push(pressContract(n, pressIdx(n)).events);
  push(play(n, 't19').events);
  push(pressContract(n, pressIdx(n)).events);
  push(play(n, 't18').events);
  // the slate rubbed out, and one intervention spent on a dart
  setScore(n, 400);
  n.kit.push('rubout', 'steady');
  push(useRubOut(n).events);
  push(play(n, 't20', 'steady').events);
  push(commitMiss(n).events);
  // free aim: the bull, the small numbers, and the same bed twice
  setScore(n, 400);
  push(play(n, 'bull').events);
  push(play(n, 's1').events);
  push(play(n, 's1').events);
  // a double on the first dart with three figures still on the board
  setScore(n, 400);
  push(play(n, 'd20').events);
  push(commitMiss(n).events);

  // a leg-8 timeout on a second night
  const lost = createNight(77);
  lost.legIndex = 7;
  const pushLost = (events: EngineEvent[]) => {
    for (const e of events) seq.push(snap(lost, e));
  };
  pushLost(beginLeg(lost));
  setScore(lost, 100000);
  while (lost.status === 'ACTIVE') pushLost(play(lost, 's1').events);
  // a leg-8 win on a third night
  const won = createNight(78);
  won.legIndex = 7;
  const pushWon = (events: EngineEvent[]) => {
    for (const e of events) seq.push(snap(won, e));
  };
  pushWon(beginLeg(won));
  setScore(won, 40);
  pushWon(play(won, 'd20').events);
  // a nine-darter on a fourth night
  const nine = createNight(79);
  const pushNine = (events: EngineEvent[]) => {
    for (const e of events) seq.push(snap(nine, e));
  };
  pushNine(beginLeg(nine));
  setScore(nine, 501); // the short game opens a real night; the nine-darter is a 501 thing
  for (const t of ['t20', 't20', 't20', 't20', 't20', 't20', 't20', 't19', 'd12']) pushNine(play(nine, t).events);
  seq.push(snap(nine, { type: 'SHOP_ENTER', pot: nine.pot }));
  // an empty-pot shop, whichever way the legs above happened to fall
  const broke = createNight(80);
  broke.pot = 0;
  seq.push(snap(broke, { type: 'SHOP_ENTER', pot: 0 }));
  // a long quiet spell: the idle filler has to survive being asked repeatedly
  for (let i = 0; i < 20; i++) idle(15 + i);
  return seq;
}

const SEQUENCE = buildSequence();

function run(seed: number, seq: BarkContext[] = SEQUENCE): Bark[][] {
  const c = new Commentary(seed);
  return seq.map((ctx) => c.react(ctx));
}

describe('the scripted event sequence', () => {
  it('has at least 200 varied events', () => {
    expect(SEQUENCE.length).toBeGreaterThanOrEqual(200);
    const types = new Set(SEQUENCE.map((c) => c.event.type as string));
    for (const t of [
      'LEG_START', 'SLATE_OFFERED', 'CONTRACT_TAKEN', 'CONTRACT_SETTLED', 'CONTRACT_PRESSED', 'KIT_SPENT',
      'THROW', 'VISIT_END', 'ONE_EIGHTY', 'CHECKOUT', 'LEG_TIMEOUT', 'NIGHT_LOST', 'NIGHT_WON',
      'SHOP_OPEN', 'SHOP_BUY', 'SHOP_REFRESH', 'SHOP_ENTER', 'IDLE', 'ACHIEVEMENT', 'HEAT_LOST',
    ]) {
      expect(types.has(t), t).toBe(true);
    }
  });

  it('every required trigger fires at least once over the sequence', () => {
    const seeds = [1, 2, 3, 7, 23, 99];
    const fired = new Set(run(seeds[0]).flat().map((b) => b.triggerId));
    for (const sd of seeds.slice(1)) {
      const also = new Set(run(sd).flat().map((b) => b.triggerId));
      for (const id of fired) if (!also.has(id)) fired.delete(id);
    }
    for (const id of [
      'visit_180', 'visit_26', 'checkout_100', 'checkout_leg8', 'bust_1', 'bust_2', 'bust_3', 'bust_4plus',
      'chalk_chain_4', 'score_170', 'score_1', 'nine_darter', 'timeout_leg8', 'shop_zero_pot', 'idle_15',
      'heat_max', 'heat_lost',
      'slate_offered', 'contract_taken', 'contract_taken_dear', 'contract_taken_long', 'contract_riding',
      'contract_paid_early', 'contract_pulled', 'contract_paid', 'contract_lost', 'contract_lost_bust',
      'contract_pressed', 'contract_pressed_twice', 'pressed_landed', 'pressed_died',
      'rub_out', 'kit_spent', 'aim_bull', 'aim_low_bed', 'aim_double_early', 'aim_same_bed',
    ]) {
      expect(fired.has(id), id).toBe(true);
    }
  });

  it('predicates are pure: evaluating a trigger twice gives the same answer and leaves the context untouched', () => {
    for (const ctx of SEQUENCE.slice(0, 60)) {
      const before = JSON.stringify(ctx);
      for (const t of BARKS) {
        const a = t.when(ctx);
        const b = t.when(ctx);
        expect(a).toBe(b);
      }
      expect(JSON.stringify(ctx)).toBe(before);
    }
  });
});

// ---------------------------------------------------------------- the slate

/** The slate index of the contract that can be pressed right now. */
function pressIdx(n: NightState): number {
  const leg = currentLeg(n);
  const i = leg.slate.findIndex((c) => pressable(n, leg, c));
  if (i < 0) throw new Error('nothing is pressable');
  return i;
}

/** The index in SEQUENCE of the first context matching a predicate. */
function findIdx(pred: (c: BarkContext) => boolean): number {
  const i = SEQUENCE.findIndex(pred);
  expect(i).toBeGreaterThan(0);
  return i;
}

const settledWith = (how: string, extra: (c: TakenContract) => boolean = () => true) => (c: BarkContext) =>
  c.event.type === 'CONTRACT_SETTLED' && c.event.contract.settled?.how === how && extra(c.event.contract);

describe('the triggers the slate added', () => {
  const OUT = run(7);

  it('a bust can never take a contract that landed, because it has already paid', () => {
    // The commentary has no line for it because the situation cannot arise:
    // a contract pays the instant it lands, so what a bust takes is only ever
    // money that was still being chased.
    const wrong = SEQUENCE.findIndex(settledWith('LOST', (c) => c.status === 'MADE'));
    expect(wrong).toBe(-1);
  });

  it('a bust that takes a live contract is a different bark from one that takes a made one', () => {
    // A bust is still on the night's count when the slate settles behind it.
    const live = findIdx((c) => settledWith('LOST', (x) => x.status !== 'MADE' && x.pressed === 0)(c) && c.consecutiveBusts >= 1);
    expect(OUT[live][0].triggerId).toBe('contract_lost_bust');
  });

  it('banking, pulling and being paid are three different settlements and three different barks', () => {
    expect(OUT[findIdx(settledWith('PAID', (c) => c.pressed === 0))][0].triggerId).toBeTruthy();
    expect(OUT[findIdx(settledWith('PULLED'))][0].triggerId).toBe('contract_pulled');
    expect(OUT[findIdx(settledWith('PAID', (c) => c.pressed === 0))][0].triggerId).toBe('contract_paid');
  });

  it('a contract that simply did not land is a plain loss, and says so without a bust', () => {
    const idx = findIdx((c) => settledWith('LOST', (x) => x.pressed === 0)(c) && c.consecutiveBusts === 0);
    expect(OUT[idx][0].triggerId).toBe('contract_lost');
  });

  it('the press is the loudest thing on the slate, and the second press is louder still', () => {
    const first = findIdx((c) => c.event.type === 'CONTRACT_PRESSED' && c.event.contract.pressed === 1);
    expect(OUT[first][0].triggerId).toBe('contract_pressed');
    expect(OUT[first][0].speaker).toBe('BARREL');
    expect(OUT[first][1].speaker).toBe('NOCK');
    const second = findIdx((c) => c.event.type === 'CONTRACT_PRESSED' && c.event.contract.pressed === 2);
    expect(OUT[second][0].triggerId).toBe('contract_pressed_twice');
    const one = BY_ID.get('contract_pressed') as BarkTrigger;
    const two = BY_ID.get('contract_pressed_twice') as BarkTrigger;
    expect(two.priority).toBeGreaterThan(one.priority);
    for (const t of BARKS) if (t.id !== 'nine_darter' && t.id !== two.id) expect(t.priority, t.id).toBeLessThanOrEqual(two.priority);
  });

  it('a pressed contract that lands and one that dies are told apart', () => {
    expect(OUT[findIdx(settledWith('PAID', (c) => c.pressed > 0))][0].triggerId).toBe('pressed_landed');
    expect(OUT[findIdx(settledWith('LOST', (c) => c.pressed > 0))][0].triggerId).toBe('pressed_died');
  });

  it('{contract}, {price}, {payout} and {from} are filled from the event', () => {
    const probe = (ctx: BarkContext, line: string) =>
      new Commentary(3, [{ id: 't', speaker: 'NOCK', priority: 1, cooldown: 1, when: () => true, lines: [line] }]).react(ctx)[0].text;
    const taken = SEQUENCE[findIdx((c) => c.event.type === 'CONTRACT_TAKEN')].event as Extract<EngineEvent, { type: 'CONTRACT_TAKEN' }>;
    expect(probe(SEQUENCE[findIdx((c) => c.event.type === 'CONTRACT_TAKEN')], '{contract} {price}')).toBe(
      `${contractName(taken.contract.defId)} ${taken.contract.price}`,
    );
    const pressIdx = findIdx((c) => c.event.type === 'CONTRACT_PRESSED');
    const press = SEQUENCE[pressIdx].event as Extract<EngineEvent, { type: 'CONTRACT_PRESSED' }>;
    expect(probe(SEQUENCE[pressIdx], '{from} to {contract}')).toBe(`${contractName(press.from)} to ${contractName(press.contract.defId)}`);
    const paidIdx = findIdx(settledWith('PAID'));
    const paid = SEQUENCE[paidIdx].event as Extract<EngineEvent, { type: 'CONTRACT_SETTLED' }>;
    expect(probe(SEQUENCE[paidIdx], '{payout}')).toBe(String(paid.contract.settled?.pot));
    for (const id of ['contract_taken', 'contract_pressed', 'contract_paid']) {
      const real = new Commentary(3, [BY_ID.get(id) as BarkTrigger]);
      const at = findIdx((c) => (BY_ID.get(id) as BarkTrigger).when(c));
      for (const b of real.react(SEQUENCE[at])) expect(b.text, id).not.toMatch(/\{\w+\}/);
    }
  });

  it('a contract still riding is only remarked on while it can still be lost', () => {
    const t = BY_ID.get('contract_riding') as BarkTrigger;
    const idx = findIdx((c) => t.when(c));
    const ctx = SEQUENCE[idx];
    expect(ctx.event.type).toBe('THROW');
    // Something on the slate has not landed yet, and can still be lost.
    expect(ctx.leg.slate.some((c) => !c.settled && c.status !== 'DEAD')).toBe(true);
    // Once the visit is over the slate is settled, so nothing is left chasing.
    for (const c of SEQUENCE) if (c.event.type === 'VISIT_END') expect(t.when(c)).toBe(false);
  });
});

describe('the triggers free aim added', () => {
  const OUT = run(7);
  /** Clone a real THROW context and patch the dart. */
  function throwCtx(patch: (r: ThrowResult) => void): BarkContext {
    const idx = findIdx((c) => c.event.type === 'THROW');
    const ctx = structuredClone(SEQUENCE[idx]);
    const ev = ctx.event as Extract<EngineEvent, { type: 'THROW' }>;
    patch(ev.result);
    ctx.throwResult = ev.result;
    return ctx;
  }

  it('the bull, a low bed and an early double are each their own remark', () => {
    expect(OUT[findIdx((c) => c.event.type === 'THROW' && c.event.result.intent.target.region === 'IB')][0].triggerId).toBe('aim_bull');
    const lowIdx = findIdx((c) => (BY_ID.get('aim_low_bed') as BarkTrigger).when(c));
    expect(SEQUENCE[lowIdx].event.type).toBe('THROW');
    const dbl = BY_ID.get('aim_double_early') as BarkTrigger;
    expect(dbl.when(throwCtx((r) => {
      r.intent.target = { region: 'D', bed: 20 };
      r.intent.visitThrowIndex = 0;
      r.scoreBefore = 400;
    }))).toBe(true);
    // ... but not when the double is a finish.
    expect(dbl.when(throwCtx((r) => {
      r.intent.target = { region: 'D', bed: 20 };
      r.intent.visitThrowIndex = 0;
      r.scoreBefore = 40;
    }))).toBe(false);
  });

  it('a treble that misses the board entirely gets the wall bark, and a deliberate miss does not', () => {
    const t = BY_ID.get('treble_wall') as BarkTrigger;
    expect(t.when(throwCtx((r) => {
      r.intent.target = { region: 'T', bed: 20 };
      r.aimed = { region: 'T', bed: 20 };
      r.aim = 'wall';
      r.miss = false;
    }))).toBe(true);
    const deliberate = throwCtx((r) => {
      r.intent.target = { region: 'W' };
      r.aimed = { region: 'W' };
      r.aim = 'wall';
      r.miss = true;
    });
    expect(t.when(deliberate)).toBe(false);
    expect((BY_ID.get('dart_in_wall') as BarkTrigger).when(deliberate)).toBe(false);
  });

  it('{target} names where the dart was sent, not where it landed', () => {
    const ctx = throwCtx((r) => {
      r.intent.target = { region: 'T', bed: 20 };
      r.hits = [{ target: { region: 'S', bed: 5 }, value: 5, countsAsDouble: false }];
    });
    const probe = new Commentary(3, [{ id: 't', speaker: 'NOCK', priority: 1, cooldown: 1, when: () => true, lines: ['{target}'] }]);
    expect(probe.react(ctx)[0].text).toBe('treble 20');
  });
});

// ---------------------------------------------------------------- the crowd

describe('the crowd', () => {
  const n0 = createNight(31);
  beginLeg(n0);
  const visit = currentLeg(n0).visits[0];
  const visitEnd = (heat: number, busted = false, missed = false): BarkContext =>
    buildBarkContext(n0, { type: 'VISIT_END', visit, total: busted ? 0 : 60, busted, missed, heat });

  it('heat_max speaks for a bust-free visit at HEAT_CAP and not a degree below it', () => {
    const t = BY_ID.get('heat_max') as BarkTrigger;
    expect(t.when(visitEnd(HEAT_CAP))).toBe(true);
    expect(t.when(visitEnd(HEAT_CAP - 1))).toBe(false);
    expect(t.when(visitEnd(HEAT_CAP, true))).toBe(false); // a busted visit has no crowd
    expect(t.when(visitEnd(0))).toBe(false);
    expect(t.when(visitEnd(HEAT_CAP, false, true))).toBe(true); // walking away holds it
  });

  it('heat_lost speaks only when there was heat worth losing', () => {
    const t = BY_ID.get('heat_lost') as BarkTrigger;
    for (const from of [2, 3, HEAT_CAP]) expect(t.when(buildBarkContext(n0, { type: 'HEAT_LOST', from, reason: 'BUST' as const })), `from ${from}`).toBe(true);
    for (const from of [0, 1]) expect(t.when(buildBarkContext(n0, { type: 'HEAT_LOST', from, reason: 'BUST' as const })), `from ${from}`).toBe(false);
  });
});

// ---------------------------------------------------------------- engine behaviour

describe('Commentary engine (src/core/commentary.ts)', () => {
  const OUT = run(7);

  it('produces barks for a healthy fraction of events, at most two per event, the reply from the other commentator', () => {
    const spoken = OUT.filter((b) => b.length > 0).length;
    expect(spoken).toBeGreaterThan(SEQUENCE.length / 4);
    for (const barks of OUT) {
      expect(barks.length).toBeLessThanOrEqual(2);
      if (barks.length === 2) {
        expect(barks[0].speaker).not.toBe(barks[1].speaker);
        expect(barks[0].triggerId).toBe(barks[1].triggerId);
      }
      for (const b of barks) {
        expect(BY_ID.has(b.triggerId)).toBe(true);
        expect(b.priority).toBe((BY_ID.get(b.triggerId) as BarkTrigger).priority);
      }
    }
  });

  it('no line text repeats within 8 consecutive reacts, whatever the cosmetic seed', () => {
    const repeats: string[] = [];
    for (const seed of [1, 2, 7, 23, 99]) {
      const out = run(seed);
      for (let i = 0; i < out.length; i++) {
        const window = new Set<string>();
        for (let j = Math.max(0, i - 7); j < i; j++) for (const b of out[j]) window.add(b.text);
        const seen = new Set<string>();
        for (const b of out[i]) {
          if (window.has(b.text) || seen.has(b.text)) repeats.push(`seed ${seed} react ${i} (${b.triggerId}): "${b.text}"`);
          seen.add(b.text);
        }
      }
    }
    expect(repeats).toEqual([]);
  });

  it('no trigger fires again inside its cooldown', () => {
    const last = new Map<string, number>();
    const early: string[] = [];
    OUT.forEach((barks, i) => {
      if (!barks.length) return;
      const id = barks[0].triggerId;
      const cd = (BY_ID.get(id) as BarkTrigger).cooldown;
      const prev = last.get(id);
      if (prev !== undefined && i - prev < cd) early.push(`${id} at ${prev} and ${i} (cooldown ${cd})`);
      last.set(id, i);
    });
    expect(early).toEqual([]);
  });

  it('no output contains an unresolved {placeholder}', () => {
    const bad = OUT.flat().filter((b) => /\{\w+\}/.test(b.text));
    expect(bad.map((b) => b.text)).toEqual([]);
    for (const b of OUT.flat()) expect(b.text.length).toBeGreaterThan(0);
  });

  it('two instances with the same seed produce identical output for the same sequence', () => {
    const a = run(99);
    const b = run(99);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('a different cosmetic seed changes the selection, never the triggers that are eligible', () => {
    const a = run(1).flat().map((b) => b.text).join('\n');
    const b = run(2).flat().map((b) => b.text).join('\n');
    expect(a).not.toBe(b);
  });

  it('the highest-priority matching trigger wins: a landing on 1 is a score_1 bark, not a bust bark', () => {
    const idx = SEQUENCE.findIndex((c) => c.event.type === 'THROW' && c.event.result.scoreAfter === 1);
    expect(idx).toBeGreaterThan(0);
    expect(OUT[idx][0].triggerId).toBe('score_1');
    expect(OUT[idx][0].speaker).toBe('BARREL');
  });

  it('a 180 is greeted by BARREL with NOCK replying', () => {
    const idx = SEQUENCE.findIndex((c) => c.event.type === 'ONE_EIGHTY');
    expect(OUT[idx].map((b) => b.speaker)).toEqual(['BARREL', 'NOCK']);
    expect(OUT[idx][0].triggerId).toBe('visit_180');
    expect(OUT[idx][0].text.toUpperCase()).toMatch(/EIGHTY|MAXIMUM/);
  });

  it('the nine-darter outranks the checkout barks', () => {
    const idx = SEQUENCE.findIndex((c) => c.event.type === 'CHECKOUT' && c.leg.visits.length === 3 && c.leg.visits[0].scoreAtVisitStart === 501);
    expect(idx).toBeGreaterThan(0);
    expect(OUT[idx][0].triggerId).toBe('nine_darter');
  });

  it('the leg-8 timeout is answered by timeout_leg8 and the leg-8 win by checkout_leg8', () => {
    const lostIdx = SEQUENCE.findIndex((c) => c.event.type === 'LEG_TIMEOUT' && c.event.legIndex === 7);
    expect(lostIdx).toBeGreaterThan(0);
    expect(OUT[lostIdx][0].triggerId).toBe('timeout_leg8');
    const wonIdx = SEQUENCE.findIndex((c) => c.event.type === 'CHECKOUT' && c.event.legIndex === 7);
    expect(OUT[wonIdx][0].triggerId).toBe('checkout_leg8');
  });

  it('placeholders are filled from the context: {total} on the 180 reply, {pot} in the shop', () => {
    const c = new Commentary(3, [
      { id: 't', speaker: 'NOCK', priority: 1, cooldown: 1, when: () => true, lines: ['{total} {pot} {leg} {score} {n180} {value} {target} {chalk}'] },
    ]);
    const ctx = SEQUENCE.find((x) => x.event.type === 'ONE_EIGHTY') as BarkContext;
    const [b] = c.react(ctx);
    expect(b.text).toBe(`180 ${ctx.night.pot} First Round ${ctx.leg.score} ${ctx.night.stats.oneEighties} 0  `);
  });

  it('a placeholder the engine does not know is left alone (and the pool has none)', () => {
    const c = new Commentary(3, [{ id: 't', speaker: 'NOCK', priority: 1, cooldown: 1, when: () => true, lines: ['{nonsense}'] }]);
    expect(c.react(SEQUENCE[0])[0].text).toBe('{nonsense}');
  });

  it('cooldown: the same trigger is silent for `cooldown` reacts then fires again', () => {
    const c = new Commentary(5, [{ id: 't', speaker: 'NOCK', priority: 1, cooldown: 3, when: () => true, lines: ['a', 'b', 'c', 'd'] }]);
    const ctx = SEQUENCE[0];
    const fired = [1, 2, 3, 4, 5, 6, 7].map(() => c.react(ctx).length > 0);
    expect(fired).toEqual([true, false, false, true, false, false, true]);
  });

  it('priority beats declaration order; ties go to the less-used trigger', () => {
    const triggers: BarkTrigger[] = [
      { id: 'low', speaker: 'NOCK', priority: 1, cooldown: 1, when: () => true, lines: ['low1', 'low2', 'low3'] },
      { id: 'high', speaker: 'BARREL', priority: 9, cooldown: 1, when: () => true, lines: ['high1', 'high2', 'high3'] },
      { id: 'high2', speaker: 'BARREL', priority: 9, cooldown: 1, when: () => true, lines: ['x1', 'x2', 'x3'] },
    ];
    const c = new Commentary(5, triggers);
    const ids = [1, 2, 3, 4].map(() => c.react(SEQUENCE[0])[0].triggerId);
    expect(ids.every((id) => id === 'high' || id === 'high2')).toBe(true);
    expect(ids.slice(0, 2).sort()).toEqual(['high', 'high2']);
    expect(ids.slice(2, 4).sort()).toEqual(['high', 'high2']);
  });

  it('a throwing predicate is treated as not matching', () => {
    const c = new Commentary(5, [
      { id: 'boom', speaker: 'NOCK', priority: 99, cooldown: 1, when: () => { throw new Error('x'); }, lines: ['never'] },
      { id: 'ok', speaker: 'NOCK', priority: 1, cooldown: 1, when: () => true, lines: ['fine'] },
    ]);
    expect(c.react(SEQUENCE[0])[0].text).toBe('fine');
  });

  it('describeChalkChain names the chalk in pipeline order', () => {
    expect(describeChalkChain(['hot_twenty', 'heavy_tips'])).toBe('Hot Twenty then Heavy Tips');
    expect(describeChalkChain([])).toBe('');
  });

  it('contractName reads the slate, and falls back to the id it was given', () => {
    expect(contractName('ton')).toBe('A TON');
    expect(contractName('nothing_at_all')).toBe('nothing_at_all');
  });

  it('buildBarkContext carries the visit total on VISIT_END and the throw on THROW', () => {
    const n = createNight(5);
    beginLeg(n);
    const { events, result } = play(n, 't20');
    const ctx = buildBarkContext(n, events[0]);
    expect(ctx.throwResult).toBe(result);
    expect(ctx.chalkFiredCount).toBe(0);
    expect(ctx.leg).toBe(currentLeg(n));
    expect(ctx.consecutiveBusts).toBe(0);
    const ve = buildBarkContext(n, { type: 'VISIT_END', visit: currentLeg(n).visits[0], total: 123, busted: false, missed: false, heat: 0 });
    expect(ve.visitTotal).toBe(123);
  });
});
