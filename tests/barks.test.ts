/**
 * Commentary (TDD §10, §11.8, §16 stage 8, §17.10): the bark pool's size,
 * length, required triggers and safety; and the engine's priority, cooldown,
 * no-repeat window, placeholder filling and determinism over a scripted,
 * varied sequence of 200+ engine events.
 */
import { describe, expect, it } from 'vitest';
import { BARKS, allBarkLines } from '../src/content/barks.ts';
import { HEAT_CAP } from '../src/content/legs.ts';
import { Commentary, buildBarkContext, describeChalkChain, type Bark } from '../src/core/commentary.ts';
import { addChalk, beginLeg, commitCard, commitMiss, createNight, currentLeg, pocketCard, shopBuy, shopLeave, shopRefresh } from '../src/core/state.ts';
import type { BarkContext, BarkTrigger, EngineEvent, NightState, ThrowResult } from '../src/core/types.ts';
import { dealFromPool, play, playAll, setScore, smartPickCard } from './helpers.ts';

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
    // the reworked loop: the crowd, the pocket and leaving it right
    ['heat_max', 88],
    ['heat_lost', 86],
    ['setup_bonus', 55],
    ['pocketed', 45],
  ])('required trigger %s is present with priority %i', (id, priority) => {
    const t = BY_ID.get(id);
    expect(t, id).toBeDefined();
    expect((t as BarkTrigger).priority).toBe(priority);
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
    const known = new Set(['score', 'total', 'value', 'chalk', 'leg', 'pot', 'card', 'n180', 'number']);
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
 * 200+ engine events with every required trigger reachable: a 180, a 26,
 * a landing on 170 and on 1, a bust chain of four, a 100+ checkout, shops
 * with and without Pot, idle, a chalk-heavy leg, a leg-8 timeout, a leg-8
 * win and a nine-darter — plus the events the per-visit rework added: a
 * pocketed card, heat lost to a bust, a visit ended at the wall and a
 * setup bonus. One hand now covers a whole visit, so a visit is three
 * commits and a single HAND_DEALT, not three of each.
 */
function buildSequence(): BarkContext[] {
  const seq: BarkContext[] = [];
  const n = createNight(4242);
  const push = (events: EngineEvent[]) => {
    for (const e of events) seq.push(snap(n, e));
  };
  const idle = (seconds: number) => seq.push(snap(n, { type: 'IDLE', seconds }));

  push(beginLeg(n));
  // The short game opens a real night; this script wants the 501 arithmetic.
  setScore(n, 501);
  // visit 1: a 180 (501 → 321)
  for (const c of ['t20', 't20', 't20']) push(play(n, c).events);
  idle(20);
  // visit 2: land on exactly 170, then 150, 130
  setScore(n, 230);
  for (const c of ['t20', 's20', 's20']) push(play(n, c).events);
  // visit 3: the classic 26
  for (const c of ['s20', 's5', 's1']) push(play(n, c).events);
  // visit 4: down to 1 (bust)
  setScore(n, 41);
  for (const c of ['s20', 's20']) push(play(n, c).events);
  idle(16);
  // visit 5: a quiet visit resets the bust count
  setScore(n, 400);
  for (const c of ['s1', 's3', 's5']) push(play(n, c).events);
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
  // shop: chalk for a chain, a card, a refresh
  n.pot = 60;
  const shop = n.shop as NonNullable<NightState['shop']>;
  shop.slots[2] = { kind: 'CHALK', chalkId: 'split_tips', cost: 8, sold: false };
  push(shopBuy(n, 2).events);
  push(shopBuy(n, 0).events);
  push(shopRefresh(n).events);
  for (const id of ['heavy_tips', 'oiled', 'even_keel', 'cheap_chalk']) addChalk(n, id);
  push(shopLeave(n));
  // leg 2: the checkout-aware bot plays through the chalk pipeline
  while (n.status === 'ACTIVE' && n.phase === 'LEG' && seq.length < 150) push(commitCard(n, smartPickCard(n, currentLeg(n)).id).events);
  if (n.status === 'ACTIVE' && n.phase === 'LEG') {
    setScore(n, 40);
    push(play(n, 'd20').events);
  }
  if ((n.phase as string) === 'SHOP') {
    n.pot = 0;
    seq.push(snap(n, { type: 'SHOP_ENTER', pot: 0 }));
    push(shopLeave(n));
    while (n.status === 'ACTIVE' && n.phase === 'LEG' && seq.length < 200) push(commitCard(n, smartPickCard(n, currentLeg(n)).id).events);
  }
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
  for (const c of ['t20', 't20', 't20', 't20', 't20', 't20', 't20', 't19']) pushNine(play(nine, c).events);
  pushNine(playAll(nine, ['d12']).events);
  seq.push(snap(nine, { type: 'SHOP_ENTER', pot: nine.pot }));
  // a fifth night for the reworked visit: a card kept in the pocket, heat built
  // over whole visits and then wiped by a bust, a visit walked away from at the
  // wall, and a setup bonus for leaving a score the deck can finish.
  const kept = createNight(81);
  const pushKept = (events: EngineEvent[]) => {
    for (const e of events) seq.push(snap(kept, e));
  };
  pushKept(beginLeg(kept));
  const keeper = currentLeg(kept).hand[currentLeg(kept).hand.length - 1];
  pushKept(pocketCard(kept, keeper.id).events);
  setScore(kept, 100000);
  const legRunning = () => kept.status === 'ACTIVE' && kept.phase === 'LEG';
  // whole visits thrown out from the hand the engine dealt: the heat climbs
  for (let v = 0; v < 5 && legRunning(); v++) {
    for (let d = 0; d < 3 && legRunning(); d++) pushKept(commitCard(kept, currentLeg(kept).hand[0].id).events);
  }
  // a visit walked away from at the wall: the heat is held, not raised
  if (legRunning()) pushKept(commitMiss(kept).events);
  // a bust: the crowd goes cold again
  if (legRunning()) {
    setScore(kept, 10);
    pushKept(play(kept, 't20').events);
  }
  // and a visit that leaves 80 on the board — a score the deck can still finish
  if (legRunning()) {
    setScore(kept, 140);
    for (const card of dealFromPool(kept, ['t20'])) pushKept(commitCard(kept, card.id).events);
    if (legRunning()) pushKept(commitMiss(kept).events);
  }
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
    for (const t of ['LEG_START', 'HAND_DEALT', 'THROW', 'VISIT_END', 'ONE_EIGHTY', 'CHECKOUT', 'LEG_TIMEOUT', 'NIGHT_LOST', 'NIGHT_WON', 'SHOP_OPEN', 'SHOP_BUY', 'SHOP_REFRESH', 'SHOP_ENTER', 'IDLE', 'ACHIEVEMENT', 'POCKETED', 'HEAT_LOST', 'SETUP_BONUS']) {
      expect(types.has(t), t).toBe(true);
    }
  });

  it('every required trigger fires at least once over the sequence', () => {
    const fired = new Set(run(1).flat().map((b) => b.triggerId));
    for (const id of ['visit_180', 'visit_26', 'checkout_100', 'checkout_leg8', 'bust_1', 'bust_2', 'bust_3', 'bust_4plus', 'chalk_chain_4', 'score_170', 'score_1', 'nine_darter', 'timeout_leg8', 'shop_zero_pot', 'idle_15', 'heat_max', 'heat_lost', 'setup_bonus', 'pocketed']) {
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

describe('the triggers the reworked visit added', () => {
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

  it('setup_bonus and pocketed answer their own event and nothing else, and nothing shouts over them', () => {
    const setup = BY_ID.get('setup_bonus') as BarkTrigger;
    const pocketed = BY_ID.get('pocketed') as BarkTrigger;
    const setupCtx = buildBarkContext(n0, { type: 'SETUP_BONUS', score: 80, pot: 1 });
    const pocketCtx = buildBarkContext(n0, { type: 'POCKETED', card: currentLeg(n0).hand[0] });
    expect(setup.when(setupCtx)).toBe(true);
    expect(setup.when(pocketCtx)).toBe(false);
    expect(pocketed.when(pocketCtx)).toBe(true);
    expect(pocketed.when(setupCtx)).toBe(false);
    for (const t of BARKS) if (t.when(setupCtx)) expect(t.priority, t.id).toBeLessThanOrEqual(setup.priority);
    for (const t of BARKS) if (t.when(pocketCtx)) expect(t.priority, t.id).toBeLessThanOrEqual(pocketed.priority);
  });

  it('{score} on a setup bonus is the score that was left on the board', () => {
    const ctx = SEQUENCE.find((c) => c.event.type === 'SETUP_BONUS') as BarkContext;
    const left = (ctx.event as Extract<EngineEvent, { type: 'SETUP_BONUS' }>).score;
    expect(left).toBeGreaterThan(0);
    const probe = new Commentary(3, [{ id: 't', speaker: 'NOCK', priority: 1, cooldown: 1, when: () => true, lines: ['{score}'] }]);
    expect(probe.react(ctx)[0].text).toBe(String(left));
    const real = new Commentary(3, [BY_ID.get('setup_bonus') as BarkTrigger]);
    expect(real.react(ctx)[0].text).not.toMatch(/\{\w+\}/);
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

  it('no line text repeats within 8 consecutive reacts', () => {
    const repeats: string[] = [];
    for (let i = 0; i < OUT.length; i++) {
      const window = new Set<string>();
      for (let j = Math.max(0, i - 7); j < i; j++) for (const b of OUT[j]) window.add(b.text);
      const seen = new Set<string>();
      for (const b of OUT[i]) {
        if (window.has(b.text) || seen.has(b.text)) repeats.push(`react ${i} (${b.triggerId}): "${b.text}"`);
        seen.add(b.text);
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
    expect(OUT[idx][0].text.toUpperCase()).toContain('EIGHTY');
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
      { id: 't', speaker: 'NOCK', priority: 1, cooldown: 1, when: () => true, lines: ['{total} {pot} {leg} {score} {n180} {value} {card} {chalk}'] },
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
