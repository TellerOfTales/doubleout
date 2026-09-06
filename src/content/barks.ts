/**
 * Bark content (TDD §10). Two commentators:
 *
 *   BARREL — excitable, loses composure early, escalating superlatives,
 *            cannot do arithmetic.
 *   NOCK   — the analyst. Dry, precise, tries to explain and increasingly
 *            cannot. Quietly devastated by leg 8. When NOCK does arithmetic
 *            it is always CORRECT and always IRRELEVANT.
 *
 * Writing rules (TDD §10.3): never mock the player; mock the board, the
 * wiring, the crowd, each other, the arithmetic, Gerald in the third row,
 * the carpet, the pint. ≤ 90 characters per line. Mild pub register only.
 * No casino words at all. No real people, leagues, sponsors, venues or brands.
 * "Pot" means the in-game Pot only.
 *
 * Since the rebuild (docs/decisions/design.md §5) the drama is on the slate,
 * not in a hand of dealt cards. The player aims wherever they like, every dart,
 * so where they aimed is now expressive and worth remarking on; and the money
 * is taken, pressed, banked, pulled or lost in front of the room. Two rules
 * from §6 bind the writing here: a loss is reported as a loss, in the same
 * voice as any other loss, and every loss names a rule that can be used next
 * time. Barrel may be reckless. Nock names the actual mistake.
 *
 * Placeholders substituted by the engine (src/core/commentary.ts):
 *   {score} leg score after the throw   {total} visit total   {value} throw value
 *   {chalk} fired chalk names joined by ' then '   {leg} leg name   {pot} pot
 *   {target} where the dart was aimed, long form   {n180} 180s this night
 *   {contract} name chalked on the slate   {price} its printed price
 *   {payout} what a settled contract returned   {from} what a press came out of
 *
 * {target} and {value} only mean anything on a THROW; the slate placeholders
 * only mean anything on a CONTRACT_TAKEN, CONTRACT_SETTLED or CONTRACT_PRESSED.
 *
 * Character set: ASCII printable plus '…' (the 5x7 font has no em-dash).
 */
import type { BarkContext, BarkTrigger, ContractOutcome, TakenContract, Target, ThrowResult, VisitState } from '../core/types';

const LAST_LEG = 7;

// ---------------------------------------------------------------- predicates

/** The throw a THROW event is about. */
function throwOf(ctx: BarkContext): ThrowResult | undefined {
  if (ctx.event.type !== 'THROW') return undefined;
  return ctx.throwResult ?? ctx.event.result;
}

/** The most recent throw of the leg, for events that arrive after it (CHECKOUT, VISIT_END). */
function lastThrow(ctx: BarkContext): ThrowResult | undefined {
  if (ctx.throwResult) return ctx.throwResult;
  if (ctx.event.type === 'THROW') return ctx.event.result;
  const v = ctx.leg.visits[ctx.leg.visits.length - 1];
  return v ? v.throws[v.throws.length - 1] : undefined;
}

function firedOnThrow(ctx: BarkContext, id: string): boolean {
  const t = throwOf(ctx);
  return !!t && t.firedChalk.includes(id);
}

function firedOnLastThrow(ctx: BarkContext, id: string): boolean {
  const t = lastThrow(ctx);
  return !!t && t.firedChalk.includes(id);
}

function bustThrow(ctx: BarkContext): ThrowResult | undefined {
  const t = throwOf(ctx);
  return t && t.outcome === 'BUST' ? t : undefined;
}

function continueThrow(ctx: BarkContext): ThrowResult | undefined {
  const t = throwOf(ctx);
  return t && t.outcome === 'CONTINUE' ? t : undefined;
}

/** Score committed by a CONTINUE throw, or undefined. */
function scoreAfterContinue(ctx: BarkContext): number | undefined {
  return continueThrow(ctx)?.scoreCommitted;
}

function isCheckout(ctx: BarkContext): boolean {
  return ctx.event.type === 'CHECKOUT';
}

/** Score at the start of the finishing visit (the darts sense of "a 100 checkout"). */
function checkoutFrom(ctx: BarkContext): number {
  if (ctx.event.type !== 'CHECKOUT') return 0;
  if (ctx.event.reward) return ctx.event.reward.checkoutFrom;
  const v = ctx.leg.visits[ctx.leg.visits.length - 1];
  return v ? v.scoreAtVisitStart : 0;
}

function isNineDarter(ctx: BarkContext): boolean {
  return isCheckout(ctx) && ctx.leg.visits.length === 3;
}

function nightWon(ctx: BarkContext): boolean {
  if (ctx.event.type === 'NIGHT_WON') return true;
  return ctx.event.type === 'CHECKOUT' && ctx.event.legIndex === LAST_LEG;
}

/** Leg index that timed out, or -1. Covers both LEG_TIMEOUT and NIGHT_LOST. */
function timedOutLeg(ctx: BarkContext): number {
  if (ctx.event.type === 'LEG_TIMEOUT') return ctx.event.legIndex;
  if (ctx.event.type === 'NIGHT_LOST') return ctx.leg.index;
  return -1;
}

/** Visit total for a non-busted VISIT_END while the leg is still live, or -1. */
function liveVisitTotal(ctx: BarkContext): number {
  if (ctx.event.type !== 'VISIT_END' || ctx.event.busted) return -1;
  if (ctx.leg.status !== 'ACTIVE') return -1;
  return ctx.event.total;
}

/** Pot on entering the shop, or -1 when this is not a shop event. */
function shopPot(ctx: BarkContext): number {
  if (ctx.event.type === 'SHOP_ENTER') return ctx.event.pot;
  if (ctx.event.type === 'SHOP_OPEN') return ctx.night.pot;
  return -1;
}

function legStart(ctx: BarkContext, index: number): boolean {
  return ctx.event.type === 'LEG_START' && ctx.event.legIndex === index;
}

// ---------------------------------------------------------------- the slate

/** The contract a CONTRACT_TAKEN / SETTLED / PRESSED event is about. */
function contractOf(ctx: BarkContext): TakenContract | undefined {
  const e = ctx.event;
  if (e.type === 'CONTRACT_TAKEN' || e.type === 'CONTRACT_SETTLED' || e.type === 'CONTRACT_PRESSED') return e.contract;
  return undefined;
}

/** How a CONTRACT_SETTLED event ended. Undefined for every other event. */
function settledAs(ctx: BarkContext): ContractOutcome | undefined {
  if (ctx.event.type !== 'CONTRACT_SETTLED') return undefined;
  return ctx.event.contract.settled?.how;
}

/**
 * The visit a settlement belongs to. A bark context is built from the state
 * the engine left behind, by which time a busted visit has already been closed
 * and the next one opened, so "the visit that just ended" is the one with
 * darts in it.
 */
function settlingVisit(ctx: BarkContext): VisitState | undefined {
  const vs = ctx.leg.visits;
  const last = vs[vs.length - 1];
  if (last && last.throws.length > 0) return last;
  return vs[vs.length - 2] ?? last;
}

/** A contract lost because the visit went bust, rather than simply not landing. */
function bustTookIt(ctx: BarkContext): boolean {
  return settledAs(ctx) === 'LOST' && !!settlingVisit(ctx)?.busted;
}

/** Contracts still on the slate and still losable. Empty once the visit is over. */
function riding(ctx: BarkContext): TakenContract[] {
  return ctx.leg.slate.filter((c) => !c.settled);
}

// ---------------------------------------------------------------- free aim

/** Where this dart was sent. Any of the 62 targets, or the wall on purpose. */
function aimedAt(ctx: BarkContext): Target | undefined {
  return throwOf(ctx)?.intent.target;
}

/** The beds aimed at so far this visit. Undefined entries are the wall. */
function aimedBeds(ctx: BarkContext): (number | undefined)[] {
  const v = settlingVisit(ctx);
  return v ? v.throws.map((t) => t.intent.target.bed) : [];
}

// ---------------------------------------------------------------- content

export const BARKS: BarkTrigger[] = [
  // ------------------------------------------------------------ night / legs
  {
    id: 'night_start',
    speaker: 'BARREL',
    priority: 50,
    cooldown: 30,
    when: (ctx) => legStart(ctx, 0),
    lines: [
      "Good evening! Welcome to the oche! The board is up, the carpet is sticky, we are LIVE!",
      "Here we go! Eight legs, one night, and I have had precisely one pint! Maybe two!",
      "Ladies, gentlemen, Gerald: welcome! Three hundred and one to nothing, let's have it!",
      "It's a night at the darts! I've got a new pen and everything! Two pens!",
      "Welcome in! The wiring's been checked! By Gerald! So it hasn't been checked!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "Three hundred and one. A prime number… no. It is 7 times 43. Carry on.",
        "Ten visits for the first leg. I shall count every dart. Nobody asked me to.",
        "Good evening. I have brought a calculator. Barrel has brought a whistle.",
        "Good evening. The board has been hung straight. It is the last straight thing tonight.",
      ],
    },
  },
  {
    id: 'leg_start_2',
    speaker: 'BARREL',
    priority: 45,
    cooldown: 30,
    when: (ctx) => legStart(ctx, 1),
    lines: [
      "The Second Round! Eleven visits! Which is one fewer than twelve, I'm told!",
      "Second Round! Same board, same carpet, somehow stickier!",
      "Round two! Gerald has taken his coat off. It's serious now.",
    ],
  },
  {
    id: 'leg_start_3',
    speaker: 'NOCK',
    priority: 45,
    cooldown: 30,
    when: (ctx) => legStart(ctx, 2),
    lines: [
      "The Quarter. Ten visits. Thirty darts. A round number, which is unusual for darts.",
      "The Quarter. Named, I assume, for the fraction of my pint that remains.",
      "Ten visits. That is 50.1 per visit from here. Point one. It is always point something.",
    ],
  },
  {
    id: 'leg_start_4',
    speaker: 'BARREL',
    priority: 45,
    cooldown: 30,
    when: (ctx) => legStart(ctx, 3),
    lines: [
      "The Interval! Nine visits! Nobody's going anywhere, the toilets are queued to the door!",
      "It's the Interval! Which, I'm told, is not actually a break! Terrible name!",
      "The Interval! Gerald's gone for crisps. He'll miss everything. He always does.",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "Nine visits. Twenty-seven darts. I am ready. I was ready in the car park.",
        "It is not an interval. Nothing stops. I have asked. Nothing has ever stopped.",
      ],
    },
  },
  {
    id: 'leg_start_5',
    speaker: 'NOCK',
    priority: 45,
    cooldown: 30,
    when: (ctx) => legStart(ctx, 4),
    lines: [
      "The Semi. Eight visits, twenty-four darts, 62.625 per visit. Not a nice number.",
      "The Semi. Half of something, which is more than I have of anything at this point.",
      "The Semi. Eight visits. Barrel has asked me what half of eight is. I have told him.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "It's four, Nock. I knew it was four. I was testing you.",
        "The SEMI! Which is short for something! Semi-what, Nock? Semi-WHAT?",
      ],
    },
  },
  {
    id: 'leg_start_6',
    speaker: 'BARREL',
    priority: 45,
    cooldown: 30,
    when: (ctx) => legStart(ctx, 5),
    lines: [
      "The Last Four! Seven visits! I've counted the visits and got a different number! Twice!",
      "Last Four! The lights have dimmed! Or my eyes have! Either way, atmosphere!",
      "The Last Four! The crowd is on its feet! Mostly because of the carpet!",
    ],
  },
  {
    id: 'leg_start_7',
    speaker: 'NOCK',
    priority: 45,
    cooldown: 30,
    when: (ctx) => legStart(ctx, 6),
    lines: [
      "The Final. Six visits. Eighteen darts. 83.5 per visit. I have started to sweat.",
      "The Final. There is a Decider after this, so 'Final' is, technically, a lie.",
      "Six visits. The board has heard this and has, I think, tightened its wires.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "The FINAL! Then another one! It's like a bus! It's like two buses!",
        "The Final! Gerald's put his coat back on! That's how he shows respect!",
      ],
    },
  },
  {
    id: 'leg_start_decider',
    speaker: 'NOCK',
    priority: 55,
    cooldown: 30,
    when: (ctx) => legStart(ctx, LAST_LEG),
    lines: [
      "The Decider. Five visits. One hundred point two per visit. The point two is the problem.",
      "The Decider. Five visits. Fifteen darts. I have stopped blinking. It is not helping.",
      "The Decider. This is the leg the board was built to win. Let us see about that.",
      "Five visits. On an ordinary board, with ordinary darts, impossible. Look at this board.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "THE DECIDER! I've gone hot! I've gone cold! I've gone hot again!",
        "Five visits! That's fewer than six, Nock! I looked it up!",
        "The Decider! Gerald has stood up! Gerald never stands up!",
      ],
    },
  },

  // ------------------------------------------------------------ the 180
  {
    id: 'visit_180',
    speaker: 'BARREL',
    priority: 100,
    cooldown: 4,
    when: (ctx) => ctx.event.type === 'ONE_EIGHTY',
    lines: [
      "ONE HUNDRED AND EIGHTYYYY!",
      "ONE HUNDRED AND EIGHTY! Maximum! Colossal! Bigger than colossal! COLOSSALER!",
      "ONE HUNDRED AND EIGHTY! I've dropped my pen! I've dropped my OTHER pen!",
      "ONE HUNDRED AND EIGHTY! Gerald's spilt his pint! Worth it, Gerald! WORTH IT!",
      "ONE HUNDRED AND EIGHTY! That's three sixties! Or six thirties! Or… Nock, help me!",
      "ONE HUNDRED AND EIGHTY! The carpet's lifting! The wiring's humming! I'M humming!",
      "ONE HUNDRED AND EIGHTY! I've lost my voice! I've found it! ONE HUNDRED AND EIGHTY!",
      "ONE HUNDRED AND EIGHTY! Or more! I've stopped reading the numbers! I just shout!",
      "A MAXIMUM! A maximum and a half! That's not a thing! It is NOW!",
      "ONE HUNDRED AND EIGHTY! Stand up, Gerald! Stand up! He's standing! He's fallen!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "One hundred and eighty. Sixty, three times. I have checked it on paper and it holds.",
        "That is 180. The degrees in a triangle. Unrelated. I apologise.",
        "Three trebles. The visit total is {total}. I write it down; I do not enjoy it.",
        "180 is also the degrees in a straight line. Barrel is not in a straight line.",
        "Half of 360. All of the crowd. Please, Barrel, the microphone.",
        "{total}. I had that as a round number. It remains one.",
        "It is 60 plus 60 plus 60. He asked me. I told him. He shouted anyway.",
      ],
    },
  },
  {
    id: 'visit_over_180',
    speaker: 'NOCK',
    priority: 100,
    cooldown: 4,
    when: (ctx) => ctx.event.type === 'ONE_EIGHTY' && ctx.event.total > 180,
    lines: [
      "That is {total}. The board goes up to 180. I have written to someone about it.",
      "{total} in one visit. Under ordinary rules that is not possible. These are not those.",
      "{total}. I had to add it up twice. Both times it was too much.",
      "{total}. More than a maximum. A maximum was meant to be the maximum. Hence the name.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "MORE than a hundred and eighty! I didn't know it went higher! I do NOW!",
        "It's over! It's over the top! It's over the top of the top!",
        "I'm not shouting a number! I'm just shouting!",
      ],
    },
  },
  {
    id: 'many_180s',
    speaker: 'BARREL',
    priority: 100,
    cooldown: 4,
    when: (ctx) => ctx.event.type === 'ONE_EIGHTY' && ctx.night.stats.oneEighties >= 3,
    lines: [
      "one hundred and eighty. That's {n180} of them. I'm going to need a sit down.",
      "Another one. {n180} now. I've got nothing left. I've shouted it all out.",
      "One hundred and… eighty. Yes. Again. My voice is a rumour.",
      "{n180} maximums in a night. I've stopped standing up for them. My knees have views.",
      "Oh, look, another maximum. Lovely. Wonderful. Somebody get me a lozenge.",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "{n180} of them. I have stopped writing them down. I write a tick. It is a tidy column.",
        "At this rate we could stop commentating and simply point. I have pointed.",
        "That is a lot of maximums. Statistically, the board should complain.",
      ],
    },
  },

  // ------------------------------------------------------------ visits
  {
    id: 'visit_26',
    speaker: 'NOCK',
    priority: 90,
    cooldown: 6,
    when: (ctx) => liveVisitTotal(ctx) === 26,
    lines: [
      "Sorry, I was checking the fire exits. What did we get?",
      "I did not see that. I was looking at the carpet. The carpet is fascinating.",
      "I have no record of that visit. My pen ran out. Precisely then. Yes.",
      "Twenty-what? No. I was tying my shoe. Both shoes. Simultaneously.",
      "I saw nothing. I am prepared to sign something to that effect.",
      "Was that a visit? I had my eyes closed. For reasons. Medical reasons.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "Twenty-six, Nock. You saw it. We ALL saw it. Gerald's got it on his phone.",
        "The classic! Twenty-six! The bed and breakfast! Nock's gone very quiet!",
        "TWENTY-SIX! Twenty, five, one! I can add THAT one up! I've had practice!",
        "He saw it! Look at his face! That's the face of a man who saw a twenty-six!",
        "Twenty-six! Nock's pretending to be asleep! He's actually snoring!",
      ],
    },
  },
  {
    id: 'visit_high',
    speaker: 'BARREL',
    priority: 65,
    cooldown: 6,
    when: (ctx) => {
      const t = liveVisitTotal(ctx);
      return t >= 140 && t < 180;
    },
    lines: [
      "{total}! A BIG visit! That's nearly a maximum! Nearly! NEARLY, Nock!",
      "{total} scored! The crowd's up! Gerald's up! Gerald's hip is up!",
      "A visit of {total}! Have THAT, board! Have it and hold it!",
      "{total}! Three lovely darts! Well, three darts! Lovely is my word!",
      "What a visit! {total}! I'd whistle if I could whistle! I can't! I'll shout instead!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "{total}. Very good. I will not say 'nearly a maximum'. Barrel has said it enough.",
        "A visit of 140 is 46 and two thirds per dart. This was that or better. Recurring.",
        "{total} in one visit. The board frowned. I saw it. It has a wire for a brow.",
        "Excellent scoring. {score} left. The number is getting smaller. That is the idea.",
      ],
    },
  },
  {
    id: 'visit_low',
    speaker: 'NOCK',
    priority: 35,
    cooldown: 12,
    when: (ctx) => {
      const t = liveVisitTotal(ctx);
      return t >= 0 && t <= 30 && t !== 26;
    },
    lines: [
      "{total}. The board has been rude about that. The board should look at its own wiring.",
      "A visit of {total}. The darts were fine. The beds were narrow. The beds are always narrow.",
      "{total}. I blame the lighting, the carpet, the wire, and Gerald, in that order.",
      "{total} for the visit. The board has form for this. It is a board with a past.",
      "{total}. I have seen the board do this before. It does it to everyone. It is not personal.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "The board's having a laugh! Turn it round! Turn it to face the wall!",
        "{total}! That's the wiring! I said the wiring was off! I said it in the car!",
        "That board's got a grudge, Nock! It's got a grudge and a wire!",
      ],
    },
  },

  // ------------------------------------------------------------ checkouts
  {
    id: 'checkout_100',
    speaker: 'BARREL',
    priority: 95,
    cooldown: 10,
    when: (ctx) => isCheckout(ctx) && checkoutFrom(ctx) >= 100,
    lines: [
      "A BIG FINISH! From a hundred and something! Something big! Nock, what was it?!",
      "THE BIG FINISH! Gerald's on the table! Somebody get Gerald off the table!",
      "A ton-plus checkout! That's a hundred and… a lot! Off in one visit! HAVE THAT!",
      "OFF THE BIG NUMBER! The crowd's gone! The lights have gone! I've gone!",
      "A CHECKOUT FROM THE HEAVENS! Well, from the board! But it FELT like the heavens!",
      "A HUNDRED-PLUS! Out in one visit! The board's sulking! Look at it! SULKING!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "{total} scored in the finishing visit. At least 100. I have checked the 'at least'.",
        "A finish from three figures. Three figures is more figures than I currently have.",
        "One hundred or more, out in one visit. My notes say 'oh'. I have underlined it.",
        "The pot bonus for a big finish is two. Two is the only even prime. Neither fact helps.",
      ],
    },
  },
  {
    id: 'checkout_generic',
    speaker: 'BARREL',
    priority: 92,
    cooldown: 10,
    when: (ctx) => isCheckout(ctx),
    lines: [
      "CHECKOUT! GAME SHOT! The leg is ours! Well, not MINE, but I feel involved!",
      "GAME SHOT! On the double! Gerald's clapping with one hand! Pint in the other!",
      "GAME SHOT AND THE LEG! The board's gone quiet! It knows! It KNOWS!",
      "THAT'S THE LEG! Off the double! Beautiful! The carpet's crying!",
      "CHECKOUT! {leg} done and dusted! Dusted, Nock! With actual dust!",
      "GAME SHOT! I've written 'yes' in my notes! Just 'yes'! Big letters!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "Game shot. The pot rises to {pot}. That is the only number I will trust tonight.",
        "{leg}, checked out. I have drawn a small line under it. A neat one.",
        "Zero, finished on a double. As the rules require. The rules and I are old friends.",
        "A checkout. The board has been beaten. It will not be gracious about it.",
      ],
    },
  },
  {
    id: 'checkout_leg8',
    speaker: 'BARREL',
    priority: 100,
    cooldown: 10,
    when: (ctx) => nightWon(ctx),
    lines: [
      "THAT'S THE NIGHT! THE DECIDER IS DECIDED! Roll up the carpet! IT'S DONE!",
      "GAME SHOT AND THE NIGHT! I can't feel my hands! I don't NEED my hands!",
      "THE DECIDER! WON! Gerald's crying! I'm crying! The board's leaking!",
      "THAT'S IT! THAT'S THE LOT! Eight legs to nothing! EIGHT! I counted! Nock counted!",
      "A NIGHT AT THE DARTS, AND THE DARTS LOST! In a good way! The best way!",
      "IT'S OVER! WE'VE DONE IT! Well, not WE, but I was here! I was HERE!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "Eight legs. Eight checkouts. The night is won. I am going to sit down now.",
        "The night is over. It says so. It is not lying. I have checked it against the rules.",
        "That is all of it. Nothing else follows. I find that very restful, actually.",
        "Eight from eight. One hundred per cent, which is a fraction I understand.",
        "Well. Well, well. That is the sound of a man with no analysis left. Well done.",
      ],
    },
  },
  {
    id: 'nine_darter',
    speaker: 'BARREL',
    priority: 110,
    cooldown: 10,
    when: (ctx) => isNineDarter(ctx),
    lines: [
      "A NINE-DARTER! A NINE! DARTER! I've never… nobody's ever… GERALD'S FAINTED!",
      "NINE DARTS! THREE VISITS! FIVE HUNDRED AND ONE! GONE! I'm on the table! I'M ON THE TABLE!",
      "THE PERFECT LEG! THE PERFECT LEG! I have to lie down! I'm lying down! Still shouting!",
      "NINE-DARTER! THE BOARD'S IN SHOCK! THE CARPET'S IN SHOCK! I'M IN A STATE!",
      "NINE DARTS! IN THIS PUB! ON THIS BOARD! WITH THAT WIRING! HISTORY! HISTORY, NOCK!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "Nine darts. Three visits, 167 per visit, 55 and two thirds per dart. I will remember this.",
        "A perfect leg. I have analysed it. My analysis is: yes.",
        "Five hundred and one in three visits. The pot bonus is five. It deserves more.",
        "That is the rarest thing in the game. I have seen it. I can go home now. I will not.",
        "Nine darts. I have no numbers for this. I have looked. The numbers are hiding.",
      ],
    },
  },
  {
    id: 'overshoot',
    speaker: 'NOCK',
    priority: 93,
    cooldown: 10,
    when: (ctx) => isCheckout(ctx) && firedOnLastThrow(ctx, 'overshoot'),
    lines: [
      "Overshoot. One or two below zero counts. Zero, minus one, minus two. Three ways home.",
      "That went past zero and the rules waved it through. Minus numbers. In darts. A moment.",
      "Overshoot. Below zero and the board said 'close enough'. The board has never said that.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "OVER the line! Past zero! And it COUNTS! Nock, it COUNTS! Nock's gone stiff!",
        "It went past! It went past and came back for the leg! Like a boomerang!",
      ],
    },
  },
  {
    id: 'straight_out',
    speaker: 'NOCK',
    priority: 93,
    cooldown: 10,
    when: (ctx) => isCheckout(ctx) && firedOnLastThrow(ctx, 'straight_out'),
    lines: [
      "Straight Out. No double required. The oldest rule in the game, waived. I feel something.",
      "Finished without a double. Under the base rules, a bust. Under these, a leg. I see.",
      "Straight Out. Zero on anything. My grandfather is spinning. He was a very precise man.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "NO DOUBLE NEEDED! Straight out! Straight out the door! With the LEG!",
        "Game shot on a… on a single? On a SINGLE? Is that allowed? It's allowed! HAVE IT!",
      ],
    },
  },

  // ------------------------------------------------------------ busts
  {
    id: 'bust_1',
    speaker: 'BARREL',
    priority: 70,
    cooldown: 3,
    when: (ctx) => !!bustThrow(ctx) && ctx.consecutiveBusts === 1,
    lines: [
      "BUST! Oh, the board's done that on purpose! Look at its face! Smug!",
      "Bust! Back to {score}! That's the wiring, that is! Rewire the lot!",
      "Bust! The dart had every chance! It chose chaos!",
      "Ooh, bust! The board's giggling! I can hear it! Somebody unplug it!",
      "BUST! And Gerald's laughing, which is rich, given Gerald's own record on this board!",
      "Bust! The score goes back to {score} and the pint goes back down my throat!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "A bust. Score restored to {score}. The board and I have exchanged a look.",
        "Back to {score}. In arithmetic that is called 'the identity'. In darts it is called 'oh'.",
        "Bust. The throw was {value}. Correct in every way except the one that mattered.",
        "Restored to {score}. The number has not changed. Only our feelings about it.",
      ],
    },
  },
  {
    id: 'bust_2',
    speaker: 'NOCK',
    priority: 70,
    cooldown: 3,
    when: (ctx) => !!bustThrow(ctx) && ctx.consecutiveBusts === 2,
    lines: [
      "Two in a row. I am not concerned. I am adjacent to concerned. Concern-adjacent.",
      "A second bust. Back to {score} again. The board is doing this deliberately. I have notes.",
      "Two busts. I would like to say something reassuring. I have looked. There is nothing.",
      "Another bust. The number {score} and I are now on first-name terms.",
      "That is two. Two is a small number, statistically speaking. Emotionally, less so.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "Nock, are you alright? He's gone pale. Paler. He's a paler shade of pale.",
        "It's fine! It's FINE! Everything's fine! Somebody check the board's wiring!",
        "It's a phase! The board's going through a phase! It'll grow out of it!",
        "Two! That's twice one! I did that one myself! Don't check it!",
      ],
    },
  },
  {
    id: 'bust_3',
    speaker: 'NOCK',
    priority: 70,
    cooldown: 3,
    when: (ctx) => !!bustThrow(ctx) && ctx.consecutiveBusts === 3,
    lines: ['Right.', '…', 'Hm.', 'Well.', 'Yes.', 'Noted.', 'So.', 'Anyway.', 'Quite.', 'Mm.'],
    reply: {
      speaker: 'BARREL',
      lines: ['Yep.', 'Blimey.', 'Gosh.', 'Mm-hm.', 'Crikey.', 'Cor.', 'Ah.', 'Ooh.', 'Righto.'],
    },
  },
  {
    id: 'bust_4plus',
    speaker: 'BARREL',
    priority: 70,
    cooldown: 3,
    when: (ctx) => !!bustThrow(ctx) && ctx.consecutiveBusts >= 4,
    lines: [
      "So! Carpets! Who chose this one? It's got a pattern! Is it swirls? Nock, are they swirls?",
      "Anyway! Gerald! Third row! Gerald had a hip done in March! Look at him now! Sitting!",
      "This pint! Have you seen this pint? It's got a head on it like a cloud! A LOVELY cloud!",
      "Did anyone see the weather earlier? Weather! Loads of it! Out there! Doing weather!",
      "Speaking of nothing at all, my nan had a board like this! Kept jam in it! Bit odd!",
      "Let's talk about the lighting! It's lovely! It's WARM! Someone chose that on purpose!",
      "I've got a new kettle! It's got a light! You press it and it just… goes! Brilliant!",
      "Crisps! Which crisp is best? The ridged one! The ridges hold the flavour! Science!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "They are swirls, Barrel. Fourteen swirls per tile. I counted them earlier. Twice.",
        "The carpet is, yes, a carpet. I appreciate what you are doing. Continue.",
        "The kettle has a light. The light is not blue. It is teal. I have been over this.",
        "Gerald's hip is doing very well. Thank you for asking. He says hello.",
        "The lighting is 2700 kelvin, which is 'warm'. Everything else in here is cold.",
      ],
    },
  },
  {
    id: 'cheap_chalk',
    speaker: 'NOCK',
    priority: 72,
    cooldown: 12,
    when: (ctx) => !!bustThrow(ctx) && firedOnThrow(ctx, 'cheap_chalk'),
    lines: [
      "Cheap Chalk. A bust, and the score drops to 2. Double 1 from here. I have seen worse.",
      "Bust to two. Cheap Chalk does that. Two is one double away. It is also very small.",
      "Cheap Chalk. Score is 2. The board thought it had won that exchange. The board was wrong.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "Down to TWO! Cheap chalk! Cheap and CHEERFUL! Double one and we're off!",
        "Two left! That's a double one! I know that one! Two divided by… yes! ONE!",
      ],
    },
  },
  {
    id: 'score_1',
    speaker: 'BARREL',
    priority: 80,
    cooldown: 6,
    when: (ctx) => throwOf(ctx)?.scoreAfter === 1,
    lines: [
      "Oh. Oh, one. One! The board did that. The board has FORM for that. Write it down!",
      "One left. Which isn't a thing. Everyone knows it isn't a thing. The board DID IT ANYWAY.",
      "One. Oh, that's cruel. That's the wiring, that is. The wiring's got a grudge.",
      "Down to one! Which counts as a bust, which counts as a crime, which counts as WIRING!",
      "One! Oh, that's the board being petty! Petty board! Petty, petty board!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "One. The only score with no way out. I have checked, twice, in case it had changed.",
        "A score of 1 cannot be finished. Not by any double. The rulebook is very calm about it.",
        "It goes back to {score}. The 1 is not recorded. I record it privately, for my own reasons.",
        "One. If it is any consolation, one is very rare. It is not any consolation. I did check.",
      ],
    },
  },

  // ------------------------------------------------------------ chalk
  {
    id: 'chalk_chain_4',
    speaker: 'NOCK',
    priority: 85,
    cooldown: 5,
    when: (ctx) => ctx.event.type === 'THROW' && ctx.chalkFiredCount >= 4,
    lines: [
      "Right. So. {chalk}. Then the value stage, which… no. Hang on. No.",
      "{chalk}. Four stages, and I… I had this. I had this in the car.",
      "Watch the readout: {chalk}. Then the maths, which has… gone.",
      "{chalk}, in that order, gives {value}, because… it does. Next.",
      "It went {chalk}. Then it… I am going to say 'science'.",
      "So: {chalk}. Then… sorry. Four factorial is 24. That is not helping.",
      "{chalk}. Stage by stage. And then… and then. And then.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "Explained it PERFECTLY, Nock! I understood NONE of it! Wonderful!",
        "That's the pipeline! It's like a slinky! A slinky made of numbers!",
        "Nock's stopped mid-sentence! That's how you know it's GOOD!",
        "Four chalk! At once! The board's fizzing! Somebody fetch a bucket!",
      ],
    },
  },
  {
    id: 'chalk_first',
    speaker: 'BARREL',
    priority: 50,
    cooldown: 40,
    when: (ctx) => {
      const t = throwOf(ctx);
      return !!t && t.firedChalk.length > 0 && ctx.night.stats.chalkFires === t.firedChalk.length;
    },
    lines: [
      "CHALK! It's fired! The chalk's gone off! Look at the readout! It LIT UP!",
      "First chalk of the night! {chalk}! That's the engine, Nock! The ENGINE!",
      "The chalk's kicked in! {chalk}! It does a thing! The thing's HAPPENED!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "{chalk}. Stage one of the pipeline. I have a diagram. Nobody has asked to see it.",
        "The chalk has fired. The value was {value}. It will not be the last time. Brace.",
      ],
    },
  },
  {
    id: 'wired_deflect',
    speaker: 'BARREL',
    priority: 58,
    cooldown: 8,
    when: (ctx) => !!throwOf(ctx)?.deflected,
    lines: [
      "WIRED! It's dropped a bed! The dart went in, said 'no thanks', and moved house!",
      "Off the wire! One bed round! The board's rearranged itself! Cheeky board!",
      "The wire's had it! Next bed clockwise! Which is… Nock, which one's clockwise?",
      "WIRE! The dart went where it fancied! Darts don't have fancies! THIS one did!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "Wired fires one throw in four. That is 25 per cent. That throw was in the 25.",
        "Deflected clockwise. Same ring. It is in the blurb. It is still upsetting.",
        "The dart moved one bed. The number changed. My feelings about it did not.",
      ],
    },
  },
  {
    id: 'split_tips',
    speaker: 'NOCK',
    priority: 48,
    cooldown: 14,
    when: (ctx) => firedOnThrow(ctx, 'split_tips'),
    lines: [
      "Split Tips. One dart, two beds. The second is a single, anticlockwise. Two hits, one dart.",
      "Two hits from one dart. I have counted them twice. It remains two. I am reassured.",
      "Split Tips. The dart has hit the bed and then the bed next door. The neighbours will talk.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "TWO! One dart, two holes! The board's got holes in it! More than usual!",
        "Split! It's gone in twice! Like a fork! A DARTING fork!",
      ],
    },
  },
  {
    id: 'forgiven',
    speaker: 'NOCK',
    priority: 78,
    cooldown: 10,
    when: (ctx) => !!throwOf(ctx)?.forgiven,
    lines: [
      "Forgiving Oche. That bust never happened. I saw it not happen. It was quite something.",
      "The oche forgave it. Score stays at {score}. I forgive nothing; the oche is kinder.",
      "That was a bust, and now it was not. Permitted once a leg. The rules are soft.",
      "Forgiven. Once per leg. It has been used. I would not go looking for a second one.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "FORGIVEN! The oche's a saint! Somebody give that oche a medal! A big one!",
        "The oche said 'no, go on, have another'! Lovely oche! Best oche in the county!",
        "It didn't happen! Nothing happened! I saw nothing! Gerald saw nothing!",
      ],
    },
  },
  {
    id: 'chalk_dust',
    speaker: 'NOCK',
    priority: 79,
    cooldown: 10,
    when: (ctx) => firedOnThrow(ctx, 'chalk_dust'),
    lines: [
      "Chalk Dust. Landed on one, treated as two. One is not two. Tonight it is. Fine.",
      "That was a 1. It is now a 2. In the wild, one and two are different animals.",
      "Chalk Dust has turned a 1 into a 2. Double 1 finishes it. The smallest finish there is.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "The dust's done it! One's a two! Two's a finish! It's ALIVE!",
        "Chalk dust! Magic dust! The board's sneezed and now it's a two!",
      ],
    },
  },
  {
    id: 'magnetised',
    speaker: 'BARREL',
    priority: 47,
    cooldown: 14,
    when: (ctx) => firedOnThrow(ctx, 'magnetised'),
    lines: [
      "MAGNETISED! It's been dragged into the twenty! Dragged! The board's got a pull!",
      "Pulled into the 20! The dart didn't want to go! It had NO choice!",
      "Magnetised! Under ten, into the twenty! The twenty's a magnet! The twenty's a MONSTER!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "Magnetised. Anything worth under ten goes to single 20. Twenty is more than ten. Progress.",
        "Pulled to the 20. The board judges the base value, not the chalked value. I did check.",
      ],
    },
  },

  // ------------------------------------------------------------ scores
  {
    id: 'score_170',
    speaker: 'NOCK',
    priority: 60,
    cooldown: 8,
    when: (ctx) => scoreAfterContinue(ctx) === 170,
    lines: [
      "One hundred and seventy. Treble 20, treble 20, bull. Sixty, sixty, fifty. The big one.",
      "170 left. The maximum checkout. On a normal board. I glance at this one. It is not.",
      "170. The most famous number in the sport. Mostly for how rarely it happens.",
      "One seventy. On paper it is three darts. On this carpet it is a walk.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "ONE SEVENTY! The big fish! The BIG one! Everyone, hush! Gerald, HUSH!",
        "The big fish is on! Nock, what's the big fish again? The 170! Yes! Right!",
        "170! I know this one! It's the… yes! It's the big one! I've said that! Say it again!",
      ],
    },
  },
  {
    id: 'score_100',
    speaker: 'NOCK',
    priority: 52,
    cooldown: 10,
    when: (ctx) => scoreAfterContinue(ctx) === 100,
    lines: [
      "One hundred left. A ton. Treble 20, double top. Sixty and forty. It looks tidy on paper.",
      "A hundred remaining. Ten squared. A big finish if it goes in one visit. If.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "A TON left! A ton! That's a hundred! I know that one! It's the round one!",
        "A hundred to go! Two darts, Nock says! Two! I'd have said three! Or five!",
      ],
    },
  },
  {
    id: 'score_50',
    speaker: 'NOCK',
    priority: 55,
    cooldown: 10,
    when: (ctx) => scoreAfterContinue(ctx) === 50,
    lines: [
      "Fifty. The bull. Or single 18, double 16. Or single 10, double top. Or many things.",
      "Fifty left. Fifty is the bull, and the bull is very small, and this is very far away.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "FIFTY! The BULL! Right in the middle! The middle of the MIDDLE!",
        "Fifty! That's a bull! Or it's two outer bulls! Is it? Nock! NOCK!",
      ],
    },
  },
  {
    id: 'score_40',
    speaker: 'BARREL',
    priority: 55,
    cooldown: 10,
    when: (ctx) => scoreAfterContinue(ctx) === 40,
    lines: [
      "FORTY! Double top! Double twenty! The big double! The double at the TOP!",
      "Forty left! Double top! Gerald's stood up! Sit down, Gerald, it's not in yet!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "Forty. Double 20. Twenty is also the number of beds. Coincidence. Probably.",
        "Double top. Miss inside and it is 20, then double 10. The halving is soothing.",
      ],
    },
  },
  {
    id: 'score_32',
    speaker: 'NOCK',
    priority: 55,
    cooldown: 10,
    when: (ctx) => scoreAfterContinue(ctx) === 32,
    lines: [
      "Thirty-two. Double 16. Miss inside and it halves: 16, 8, 4, 2. Every one still a double.",
      "Thirty-two left. Two to the power of five. The most forgiving number on the board.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "Double sixteen! The pro's double! I've heard that! I heard a man say it once!",
        "Thirty-two! Which is… sixteen twice? Or twice sixteen? Same thing! IS it the same thing?!",
      ],
    },
  },
  {
    id: 'score_under_50',
    speaker: 'NOCK',
    priority: 30,
    cooldown: 10,
    when: (ctx) => {
      const t = continueThrow(ctx);
      return !!t && t.scoreBefore >= 50 && t.scoreCommitted < 50 && t.scoreCommitted > 0;
    },
    lines: [
      "Under fifty. {score} left. Every even number here is one dart. The odd ones are two.",
      "{score} remaining. We are in finishing territory. The territory is small and has wires.",
      "{score} left. The checkout hint has appeared. It is more confident than I am.",
      "Into the forties or below. {score}. The doubles are all very close now, and all very thin.",
    ],
  },
  {
    id: 'checkout_hint_irrelevant',
    speaker: 'NOCK',
    priority: 15,
    cooldown: 20,
    when: (ctx) => ctx.event.type === 'SLATE_OFFERED' && ctx.leg.score >= 2 && ctx.leg.score <= 170,
    lines: [
      "{score} left. The hint knows the route. I know the distance: 2.37 metres.",
      "{score} to go. There are 62 places to land on a board. Only a few of them help.",
      "{score} left. If it takes two darts, that is 34 fewer than the first leg allows. Roughly.",
      "The checkout hint is on. The hint is a friend. The board is not. Note the difference.",
      "{score}. The bull is 50, the outer bull 25. Half. The only half I trust in here.",
    ],
  },

  // ------------------------------------------------------------ timeouts
  {
    id: 'timeout_leg8',
    speaker: 'NOCK',
    priority: 100,
    cooldown: 10,
    when: (ctx) => timedOutLeg(ctx) === LAST_LEG,
    lines: [
      "The Decider. Five visits. The hardest leg there is, and that was a proper go at it.",
      "That is the leg the board was built to win. It took all five visits to do it. All five.",
      "Time, on the Decider. Nobody reaches this leg by accident. The board knows it, too.",
      "The night ends here, but seven legs were won to reach it. Seven. I wrote them all down.",
      "That was the closest anyone has come, and I have been here every night.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "Same time tomorrow! I'll save the seat! Gerald will save the OTHER seat!",
        "Seven legs! SEVEN! And a Decider that went the distance! Nobody's going home sad!",
        "That was BRILLIANT! The board got lucky! I'll say it! The BOARD got LUCKY!",
        "Oh, we'll be back! Nock's already got the pen out! He never puts the pen down!",
        "That's a night! A PROPER night! Come back and finish the job! We'll be here!",
      ],
    },
  },
  {
    id: 'timeout_early',
    speaker: 'BARREL',
    priority: 96,
    cooldown: 10,
    when: (ctx) => {
      const i = timedOutLeg(ctx);
      return i >= 0 && i < LAST_LEG;
    },
    lines: [
      "Time! Oh, that's a shame! That's the visit limit, that is! Not the darts! The LIMIT!",
      "Out of visits! But the darts were lovely! Lovely darts! It's the CLOCK I blame!",
      "Time's gone! The night's done! And I'll tell you what: that board should be ASHAMED!",
      "That's the leg gone on visits! Gerald's shouting at the board! Good lad, Gerald!",
      "Ran out of visits! Ran out, not lost! There's a difference and I'll fight anyone on it!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "The visit limit on {leg}. It is a hard limit. Harder than it needs to be, if you ask me.",
        "Out of visits, not out of ideas. The seed is on the screen. The board should worry.",
        "{leg}, timed out. The board won a round. I would not call it a victory. Call it a wire.",
        "That is the end of the night. It is not the end of the evening. There is a difference.",
      ],
    },
  },

  // ------------------------------------------------------------ shop
  {
    id: 'shop_zero_pot',
    speaker: 'NOCK',
    priority: 40,
    cooldown: 6,
    when: (ctx) => shopPot(ctx) === 0,
    lines: [
      "Nothing in the pot. Zero. The shop is, in effect, a museum. Do not touch the exhibits.",
      "Zero pot. Everything is for sale and none of it is available. A very pure sort of shop.",
      "The pot is zero. Zero divided by four is zero. I checked. It did not cheer me up.",
      "Zero. Browsing is free. Browsing is all there is.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "Window shopping! Lovely window! Lovely shop! Lovely nothing!",
        "Nothing in the pot! Not a bean! Nock, is a bean a currency? It should be!",
        "Zero pot! Have a look round anyway! The chalk's very shiny! Shiny chalk!",
      ],
    },
  },
  {
    id: 'shop_enter',
    speaker: 'BARREL',
    priority: 38,
    cooldown: 6,
    when: (ctx) => {
      const p = shopPot(ctx);
      return p > 0 && p < 20;
    },
    lines: [
      "THE SHOP! {pot} in the pot! Spend it! Spend it all! No, SOME of it! Nock, how much?",
      "Shop's open! {pot} in the pot! Chalk! Kit! Something in a jar!",
      "To the shop! {pot} pot! The man behind the counter's got a look! A SELLING look!",
      "Shop time! {pot} pot! I'd buy the lot but I'm not allowed to touch anything!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "{pot} in the pot. A refresh is 1. A steadier hand is 2. The jar is not for sale.",
        "The pot is {pot}. Chalk costs between 4 and 12. I have a spreadsheet. It is sad.",
        "{pot} to spend. Four slots, one refresh. I would look at the doubles. I always do.",
      ],
    },
  },
  {
    id: 'shop_big_pot',
    speaker: 'BARREL',
    priority: 42,
    cooldown: 6,
    when: (ctx) => shopPot(ctx) >= 20,
    lines: [
      "{pot} IN THE POT! We're RICH! Well, not rich! But we're… Nock, what's the word? LOADED!",
      "{pot} pot! Buy the shop! Buy the man! Buy the jar!",
      "LOOK at that pot! {pot}! The shopkeeper's gone weak at the knees!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "{pot} in the pot. Buys the dearest chalk with change. I have never said 'with change'.",
        "A pot of {pot}. Fourth Dart is 12, Straight Out 10. I have already said too much.",
        "{pot}. A healthy pot. Spend it on something that fixes the board. Nothing fixes the board.",
      ],
    },
  },
  {
    id: 'shop_buy_chalk',
    speaker: 'BARREL',
    priority: 36,
    cooldown: 4,
    when: (ctx) => ctx.event.type === 'SHOP_BUY' && ctx.event.slot.kind === 'CHALK',
    lines: [
      "CHALK! New chalk! Rub it on! Rub it on the… no, don't rub it on anything!",
      "That's chalk bought! The board's seen it! The board's gone a funny colour!",
      "New chalk! Into the slot! What does it do? SOMETHING! It does SOMETHING!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "Chalk acquired. It resolves in acquisition order within its stage. Nobody else cares.",
        "New chalk. The pipeline has grown. My diagram has not. I will need a bigger napkin.",
      ],
    },
  },
  {
    id: 'shop_buy',
    speaker: 'NOCK',
    priority: 34,
    cooldown: 4,
    when: (ctx) => ctx.event.type === 'SHOP_BUY' && ctx.event.slot.kind !== 'CHALK',
    lines: [
      "Purchased. The pot is now {pot}. The shopkeeper has said nothing. He never does.",
      "A purchase. {pot} left in the pot. The kit is a little heavier. The board is not.",
      "Bought. I have updated my notes. My notes now say 'bought'.",
    ],
  },

  // ------------------------------------------------------------ achievements
  {
    id: 'achievement',
    speaker: 'NOCK',
    priority: 60,
    cooldown: 10,
    when: (ctx) => ctx.event.type === 'ACHIEVEMENT',
    lines: [
      "An oche has been unlocked. It is on the screen. I am not looking. I am composing myself.",
      "A new oche. Somewhere, a different carpet. I am told it is also sticky.",
      "That has unlocked something. Barrel is clapping. Barrel claps at automatic doors.",
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "A NEW OCHE! A whole new oche! Where do they keep them? The cellar? THE CELLAR!",
        "Unlocked! Something's unlocked! I'm clapping! I don't know why! I'm still clapping!",
      ],
    },
  },

  // ------------------------------------------------------------ idle
  {
    id: 'heat_max',
    speaker: 'BARREL',
    priority: 88,
    cooldown: 12,
    when: (ctx) => ctx.event.type === 'VISIT_END' && !ctx.event.busted && ctx.event.heat >= 4,
    lines: [
      'THE CROWD IS UP! They are ON THEIR FEET! Gerald is on a CHAIR!',
      "That is the room at full volume and the Pot has DOUBLED! Do not bust! DO NOT BUST!",
      'Four clean visits! The place has gone! I can hear my own heartbeat and I like it!',
      'Double the Pot on this leg! Somebody hold my clipboard! I do not have a clipboard!',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'Four visits without a bust. The multiplier is at its ceiling. One error removes it.',
        'The crowd cannot affect the arithmetic. It is, however, affecting me.',
        'Statistically the room has no bearing on the board. Statistically I am shouting.',
      ],
    },
  },
  {
    id: 'heat_lost',
    speaker: 'NOCK',
    priority: 86,
    cooldown: 8,
    when: (ctx) => ctx.event.type === 'HEAT_LOST' && ctx.event.from >= 2,
    lines: [
      'And the room sits down. That multiplier took four visits and one dart to lose.',
      'The crowd has cooled. I have seen weather change slower than that.',
      'Gone. All of it. The arithmetic is unchanged, which is the cruellest part.',
      'That is the trouble with a crowd. They are only ever as good as your last visit.',
    ],
  },
  {
    id: 'idle_15',
    speaker: 'BARREL',
    priority: 20,
    cooldown: 8,
    when: (ctx) => ctx.event.type === 'IDLE' && ctx.event.seconds >= 15,
    lines: [
      "Did I tell you about my kettle, Nock? It's got a light. You press it and it just… goes!",
      "Gerald's asleep. Third row. Look at him. Peaceful. Like a big sleepy coat.",
      "Is the carpet meant to be that colour, or has it just… become that colour, over time?",
      "I had a dream about this board once. It was taller. It asked me for a lift.",
      "Quiet in here. You can hear the wiring. It's humming. It's humming a TUNE.",
      "Nock, have you ever thought about how a dart knows which way is up?",
      "Long visit, this. Long as a bus. Not a long bus. A regular bus. Regular is long enough.",
      "I once saw a pigeon in here. On the board. Sat on the twenty. Best score all night.",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "You have told me about the kettle. The light is teal. It has always been teal.",
        "That clock loses four minutes a day. Right once every 180 days. There it goes.",
        "A dart knows which way is up because of the flight. And gravity. Mostly gravity.",
        "The carpet was red. It is now a colour with no name. I have tried to name it.",
        "Gerald is not asleep. Gerald is resting his eyes. He has told me this. Many times.",
        "I think about it in the shower. I have no answers. I have only the shower.",
        "The pigeon scored 20. That is more than 26 divided by two, which is 13. Yes.",
        "It has been {n180}… no, that is the wrong column. Fifteen seconds. Fifteen long seconds.",
      ],
    },
  },
];


// ---------------------------------------------------------------- the excitement package (DECISIONS.md #62-66)

const PACKAGE_BARKS: BarkTrigger[] = [
  {
    id: 'heat_lost_wall',
    speaker: 'BARREL',
    priority: 62,
    cooldown: 8,
    when: (ctx) => ctx.event.type === 'HEAT_LOST' && ctx.event.reason === 'MISS' && ctx.event.from >= 2,
    lines: [
      "Into the WALL! Score's safe! Crowd's gone COLD! You can't have both, apparently! Who KNEW!",
      "The wall! Safe as houses! Cold as houses! Houses are cold, Nock! Mine is!",
      "Walked away from it! Sensible! The crowd HATES sensible! Listen to them! NOTHING!",
      "That's the wall, and the warmth's gone with it! Safe as houses! COLD as houses!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'The wall keeps the score and spends the crowd. Those were the terms. They are on the door.',
        'A cold room and an intact score. That is the trade. It is not a bad trade. It is a trade.',
        'Nothing lost on the board. Everything lost on the gauge. Two different ledgers.',
      ],
    },
  },
  {
    id: 'streak_lost',
    speaker: 'BARREL',
    priority: 87,
    cooldown: 8,
    when: (ctx) => ctx.event.type === 'STREAK_LOST',
    lines: [
      "THE CLEAN SHEET! GONE! One bust and it's back to the start! The START, Nock!",
      "That was the sheet! The multiplier! It was a LOT of things, and now it's ONE thing!",
      "Bust, and the clean sheet goes with it! I felt that in my TEETH!",
      "There goes the sheet! Whole legs of it! Gerald's got his coat on! Not cold! GRIEF!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'The sheet is gone. The next clean leg starts a new one. That is how sheets work.',
        'One bust. The multiplier was never yours; it was on loan against not busting.',
        'Back to times one. The board did not do that. The board never does anything.',
      ],
    },
  },
  {
    id: 'clean_sheet_3',
    speaker: 'NOCK',
    priority: 72,
    cooldown: 8,
    when: (ctx) => ctx.event.type === 'CHECKOUT' && !!ctx.event.reward && ctx.event.reward.streakMult >= 3,
    lines: [
      'Three clean legs in a row. The Pot pays treble, and keeps paying it until something busts.',
      'The clean sheet holds. Treble on everything. The shop is about to be very good to you.',
      'Not a bust in three legs. The multiplier is at its top and stays there as long as you do.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "TREBLE THE POT! TREBLE! Every coin's got two friends! Bring your friends! BRING EVERYONE!",
        "Three clean legs! The sheet's SPOTLESS! You could eat off it! Don't! But you COULD!",
      ],
    },
  },
  {
    id: 'leg_301',
    speaker: 'NOCK',
    priority: 46,
    cooldown: 40,
    when: (ctx) => ctx.event.type === 'LEG_START' && ctx.event.legIndex <= 1 && ctx.leg.score === 301,
    lines: [
      'Three hundred and one to start. The short game. Ten visits, and a double at the end of it.',
      'The short game opens the night: 301, ten visits. The 501 comes later, once it is earned.',
    ],
  },
  {
    id: 'big_fish',
    speaker: 'BARREL',
    priority: 96,
    cooldown: 10,
    when: (ctx) => isCheckout(ctx) && checkoutFrom(ctx) >= 170,
    lines: [
      "THE BIG FISH! ONE SEVENTY! OUT! Two trebles and the bull and I have swallowed my pen!",
      "170! THE BIG FISH! The biggest finish there IS! There's no bigger! I've CHECKED!",
      "A HUNDRED AND SEVENTY! Off the bull! The crowd's fainted! ALL of them! At ONCE!",
    ],
  },
];

const AIM_BARKS: BarkTrigger[] = [
  {
    id: 'dart_in_wall',
    speaker: 'BARREL',
    priority: 64,
    cooldown: 6,
    when: (ctx) => ctx.event.type === 'THROW' && ctx.event.result.aim === 'wall' && !ctx.event.result.miss,
    lines: [
      "IN THE WALL! Not the board! The WALL! The wall has done nothing to deserve this!",
      "Wide! Into the plaster! There's a dart in the wall and a hole in the plan!",
      "Missed the board! The whole board! It's a big board, Nock! It's RIGHT THERE!",
      "That's gone in the wall! Gerald's ducked! Gerald was nowhere near it! Instinct!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'Outside the double. The board is 45 centimetres across and the dart found none of it.',
        'A double is thin. Miss it on the outside and there is nothing there but wall.',
        'No score, no bust. The wall is neutral. The wall has always been neutral.',
      ],
    },
  },
  {
    id: 'lucky_drift',
    speaker: 'NOCK',
    priority: 63,
    cooldown: 6,
    when: (ctx) => ctx.event.type === 'THROW' && ctx.event.result.aim === 'lucky',
    lines: [
      'Aimed at the single. Found the treble. I will note it as intended. It was not.',
      'That drifted UP a ring. The chances allowed it. The chances allow most things, eventually.',
      'Better than aimed. One throw in twenty-five does that. Enjoy it. Do not plan on it.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "LUCKY! He'll take it! I'd take it! Gerald would take it and he's asleep!",
        "Wrong ring, right answer! That's darts! That's the whole game in one dart!",
      ],
    },
  },
  {
    id: 'drift_single',
    speaker: 'NOCK',
    priority: 30,
    cooldown: 9,
    when: (ctx) => {
      if (ctx.event.type !== 'THROW') return false;
      const r = ctx.event.result;
      return r.aim === 'drift' && r.aimed.region === 'T' && r.hits[0]?.target.region === 'S' && r.hits[0]?.target.bed === r.aimed.bed;
    },
    lines: [
      'Aimed at the treble, dropped into the single. The commonest miss there is. A third of it.',
      'The treble bed is eight millimetres deep. The single under it forgives. Twenty, not sixty.',
      'Just under the wire. The single. It counts, it just does not count for much.',
    ],
  },
  {
    id: 'treble_wall',
    speaker: 'BARREL',
    priority: 66,
    cooldown: 8,
    when: (ctx) => {
      const t = throwOf(ctx);
      return !!t && !t.miss && t.aim === 'wall' && t.intent.target.region === 'T';
    },
    lines: [
      'At the treble, and into the wall. A dart in the plaster and a nought on the board.',
      'Missed the board off a treble. The wall has done nothing to deserve any of this.',
      'Aimed at {target}. Found the wall. Gerald has ducked. Gerald was never in danger.',
      'Treble, wall, nothing. The board is over there and the dart went somewhere else.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'The treble band is eight millimetres. High and wide of it there is only plaster.',
        'No score, no bust, one dart gone. The wall is the most honest thing in this room.',
        'A treble carries a real chance of the wall. That is what makes the single under it safe.',
      ],
    },
  },
  {
    id: 'aim_bull',
    speaker: 'NOCK',
    priority: 57,
    cooldown: 8,
    when: (ctx) => aimedAt(ctx)?.region === 'IB',
    lines: [
      'At the bull. Twelve and a half millimetres across, and everything round it is not it.',
      'The bull, called on purpose. Fifty if it lands and a long way back if it does not.',
      'He has gone at the middle. Smallest thing on that board, and nobody made him do it.',
      'The bull. Nothing about the score requires that. Something on the slate does.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'The bull. He is going at the bull. I always want the bull. Nobody wants the bull.',
        'Middle of the board, straight down the throat of it. Gerald has stopped chewing.',
        'At the bull, and not because he has to be. That is a decision, that is.',
      ],
    },
  },
  {
    id: 'aim_low_bed',
    speaker: 'BARREL',
    priority: 50,
    cooldown: 10,
    when: (ctx) => {
      const t = aimedAt(ctx);
      return !!t && t.region === 'S' && (t.bed ?? 20) <= 5 && ctx.leg.score > 60;
    },
    lines: [
      'He has aimed at the small numbers. On purpose. There is a reason and I want to hear it.',
      'Deliberately low. Somebody up there is reading the slate and ignoring the scoreboard.',
      'That is a low bed, called and thrown at. Nobody does that by accident twice.',
      'The little numbers. The ones nobody looks at. He has looked at them.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'That is a {target}, chosen. The score barely moves. Something on the slate wanted it.',
        'Low, on purpose. The scoreboard will not thank him for it. The slate might.',
        'Aiming small is a real decision here. The board does not know what to do with it.',
      ],
    },
  },
  {
    id: 'aim_double_early',
    speaker: 'NOCK',
    priority: 52,
    cooldown: 10,
    when: (ctx) => {
      const t = throwOf(ctx);
      return !!t && t.intent.target.region === 'D' && t.intent.visitThrowIndex === 0 && t.scoreBefore > 100;
    },
    lines: [
      'A double, this early. Nothing here is a finish. He wants the ring for its own sake.',
      'First dart of the visit at a double, with three figures still up. That is unusual.',
      'The doubles are thin and the wall is directly behind them. He has gone there anyway.',
      'A double at this score buys nothing but the ring it lands in. Something wants the ring.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'A double. Now. We are nowhere near the end of this leg and he has gone for one.',
        'Straight at the outside ring with the score up there. Bold. Possibly daft. Bold.',
        'Early double. Half the pub has checked the scoreboard. The scoreboard has not moved.',
      ],
    },
  },
  {
    id: 'aim_same_bed',
    speaker: 'NOCK',
    priority: 54,
    cooldown: 8,
    when: (ctx) => {
      if (ctx.event.type !== 'THROW') return false;
      const beds = aimedBeds(ctx);
      if (beds.length < 2) return false;
      const [a, b] = beds.slice(-2);
      return a !== undefined && a === b;
    },
    lines: [
      'Same bed again. He is not scoring, he is building something up there, dart by dart.',
      'Twice into one number. That is a contract being assembled in front of us.',
      'The same bed a second time. Whatever is on the slate, this is the shape of it.',
      'One number, over and over. The rest of the board might as well be a wall tonight.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'Same number again. He is going for the set. Do not talk to me, do not talk to him.',
        'That bed has gone thin and the rest of the board has gone quiet.',
        'Again. In the same one. I know exactly what he is doing and I cannot look at it.',
      ],
    },
  },
];

// ---------------------------------------------------------------- the slate
//
// Where the tension lives now. A contract is taken before the visit; after
// every dart it can be pulled down, banked, or pressed into something harder.
// Nothing left riding survives a bust. Barrel wants it left up there, Nock
// wants it banked, and per design.md §6 every loss is reported as a loss and
// names the rule that would have stopped it.

const SLATE_BARKS: BarkTrigger[] = [
  {
    id: 'slate_offered',
    speaker: 'NOCK',
    priority: 22,
    cooldown: 14,
    when: (ctx) => ctx.event.type === 'SLATE_OFFERED',
    lines: [
      'The slate is chalked. Three prices, one visit, and no obligation to touch any of them.',
      'Three contracts, pulling three different directions. That is the point of three.',
      'New slate. Read all three before the first dart. After that the prices are what they are.',
      'Chalked up, three of them. Taking none is a position. It is not a popular one.',
      'Three on the slate. Whichever goes up decides where the next three darts are going.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'Three up on the slate. I have opinions on all of them. Mostly about the dear one.',
        'Fresh chalk. I can smell it from here. That is the chalk, Nock. Tell me that is the chalk.',
        'Three contracts. Take the lot, that is my view. Nobody has ever asked for my view.',
      ],
    },
  },
  {
    id: 'contract_taken',
    speaker: 'BARREL',
    priority: 44,
    cooldown: 8,
    when: (ctx) => ctx.event.type === 'CONTRACT_TAKEN',
    lines: [
      '{contract} is on. That is a plan, that is. A plan, in darts, at this hour.',
      'Taken: {contract} at {price}. The slate has been touched and there is no untouching it.',
      '{contract}. Right. Everything else on that board is scenery for the next three darts.',
      'He has gone for {contract}. Gerald approves. Gerald approves of most things by now.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        '{contract}, at a price of {price}. The Pot is {pot}. Both numbers matter from here.',
        'Taken. The Pot goes down first and comes back later, or does not. That is the shape.',
        '{contract} for {price}. It pays at the end of the visit, or the moment it is banked.',
      ],
    },
  },
  {
    id: 'contract_taken_dear',
    speaker: 'NOCK',
    priority: 56,
    cooldown: 9,
    when: (ctx) => {
      const c = contractOf(ctx);
      return ctx.event.type === 'CONTRACT_TAKEN' && !!c && (c.stake >= 4 || ctx.night.pot <= c.stake);
    },
    lines: [
      'That is a dear one. Three darts to make it, and no fourth dart is coming.',
      '{contract}, and a good part of the Pot with it. Every dart in this visit has a job now.',
      'A large one, taken early. There is no slack left in the visit. There was not much.',
      'Dear. If it does not land inside three darts the Pot does not see that money again.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'Dear? It is dear. It is also {price} coming back. I can do that sum. I have done it.',
        'That is the big one off the slate. The night has a shape now. A frightening shape.',
        'He has had the dear one. I would have had the dear one. Nobody lets me near the darts.',
      ],
    },
  },
  {
    id: 'contract_taken_long',
    speaker: 'BARREL',
    priority: 54,
    cooldown: 9,
    when: (ctx) => {
      const c = contractOf(ctx);
      return ctx.event.type === 'CONTRACT_TAKEN' && !!c && c.price >= 9;
    },
    lines: [
      '{contract}. Pays {price}. Also almost never happens. Both of those are true at once.',
      'He has taken {contract}. At {price}. I have not sat down since and I will not.',
      '{contract} chalked up. That is the long one. That is the one nobody takes.',
      'The long price is up on the slate and somebody has gone and touched it.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        '{price} back on it. There is a reason the price is that long, and the reason is the board.',
        'A long price is a thin chance in a good coat. The house prints both of them honestly.',
        '{contract} pays {price} because it hardly ever lands. The number is not being generous.',
      ],
    },
  },
  {
    id: 'contract_riding',
    speaker: 'NOCK',
    priority: 68,
    cooldown: 8,
    when: (ctx) => ctx.event.type === 'THROW' && riding(ctx).some((c) => c.status === 'MADE'),
    lines: [
      'That has landed, and it is still up there. Made is not paid. Banking is what pays.',
      'Made, not banked. The difference between the two is one bust wide.',
      'It is good on the slate and not in the Pot. A bust from here takes it with the score.',
      'Up there, made, and losable until somebody takes it down. Those are the terms as printed.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'Bank it. Or do not. I am holding a pen and a pint, not the darts.',
        'It is made. Take it, press it, or leave it up. Three doors, and they all shut shortly.',
        'Made. Now the hard part, which is deciding to stop.',
      ],
    },
  },
  {
    id: 'contract_banked',
    speaker: 'NOCK',
    priority: 72,
    cooldown: 8,
    when: (ctx) => settledAs(ctx) === 'BANKED',
    lines: [
      'Banked. {payout} into the Pot, and nothing that happens on that board can reach it.',
      '{contract}, banked. Not the largest number available. The only certain one.',
      'Off the slate at {payout}. A bust later in this visit is now merely a bust.',
      'Banked. Unfashionable. Correct.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'Banked. Sensible. I hate it. Well done.',
        'He has taken the money. The room wanted the other thing. The room is not paying.',
        'In the Pot and out of reach. Boring. Lovely. Boring and lovely.',
      ],
    },
  },
  {
    id: 'contract_pulled',
    speaker: 'BARREL',
    priority: 66,
    cooldown: 8,
    when: (ctx) => settledAs(ctx) === 'PULLED',
    lines: [
      'Pulled. {payout} back, and it comes down off that slate before it can go wrong.',
      'He has pulled it. Small money, certain money. Gerald would have left it up there.',
      'Down it comes. {payout} for the darts it survived and not a pip more.',
      'Pulled it down. No drama, no shouting, no me. Lovely for everyone but me.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'A pull returns what went up, plus one for every dart it lived through. Not a loss.',
        '{payout}. Less than the price, more than nothing, and it happens now rather than maybe.',
        'Pulled early. The small certain number beats the large one that was never arriving.',
      ],
    },
  },
  {
    id: 'contract_paid',
    speaker: 'BARREL',
    priority: 76,
    cooldown: 8,
    when: (ctx) => {
      const c = contractOf(ctx);
      return settledAs(ctx) === 'PAID' && !!c && c.pressed === 0;
    },
    lines: [
      '{contract} lands. Left riding all the way to the last dart. {payout} into the Pot.',
      'That is {contract} home. He never banked it and, as it turns out, never needed to.',
      '{contract}, paid at the end of the visit. Held all the way. My nerves were not.',
      'Paid. It sat up on that slate for three darts and none of them broke it.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        '{payout} back on {contract}. Riding it to the end paid this time. It does not always.',
        'Paid at the end. Held, unbanked, and nothing broke it. Only one of those was a decision.',
        'The Pot is {pot}, and that one is settled. Settled money cannot be lost.',
      ],
    },
  },
  {
    id: 'contract_lost',
    speaker: 'NOCK',
    priority: 74,
    cooldown: 8,
    when: (ctx) => {
      const c = contractOf(ctx);
      return settledAs(ctx) === 'LOST' && !bustTookIt(ctx) && !!c && c.pressed === 0;
    },
    lines: [
      '{contract} did not land. A loss, recorded in the same column as every other loss.',
      'Dead. The visit ran out of darts before the contract ran out of conditions.',
      'Lost. Three darts was always the whole of it, and there is no fourth one coming.',
      'That one is gone. It could have been pulled the moment the visit stopped fitting it.',
      'Not made. The slate does not do nearly, and it never has.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'Gone. That is the slate for you. It does not do nearly and it never apologises.',
        'Not made. The board says no and the board keeps the chalk.',
        'Lost, and nothing to argue with. I have tried arguing with a board. It sits there.',
      ],
    },
  },
  {
    id: 'contract_lost_bust',
    speaker: 'BARREL',
    priority: 90,
    cooldown: 8,
    when: (ctx) => {
      const c = contractOf(ctx);
      return bustTookIt(ctx) && !!c && c.pressed === 0 && c.status !== 'MADE';
    },
    lines: [
      'The bust has taken the slate down with it. Everything up there, gone, in one dart.',
      'One dart too many and the whole slate goes. The board did not even blink.',
      'That is the score put back and the slate wiped. Two punishments, one dart.',
      'Bust, and {contract} goes down the drain behind it. I did not enjoy watching that.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'A bust settles every live contract as a loss. Nothing riding survives it. Nothing.',
        'The score is restored and the slate is not. That gap is the reason to pull early.',
        'This is what banking is for, and pulling, and the third dart nobody has to throw.',
      ],
    },
  },
  {
    id: 'contract_made_lost_bust',
    speaker: 'NOCK',
    priority: 95,
    cooldown: 8,
    when: (ctx) => {
      const c = contractOf(ctx);
      return bustTookIt(ctx) && !!c && c.pressed === 0 && c.status === 'MADE';
    },
    lines: [
      'It was made. It was up there, made, and the bust took it anyway. Banking is for that.',
      'Made and lost in the same visit. The bank was open on every dart until this one.',
      'That contract had landed. A bust does not care what has landed, only what was banked.',
      'Gone, and it was already good. On Tick is the chalk that stops exactly this.',
      '{payout} returned on a contract that was made. That is the cruellest zero on the slate.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'It was in. It was in, and now it is not. I have gone quiet. Listen to that.',
        'Made, then bust, then gone. Three things to one contract out of one dart.',
        'I watched it land. I watched it leave. Nobody moved and it left anyway.',
      ],
    },
  },
  {
    id: 'contract_pressed',
    speaker: 'BARREL',
    priority: 98,
    cooldown: 8,
    when: (ctx) => {
      const c = contractOf(ctx);
      return ctx.event.type === 'CONTRACT_PRESSED' && !!c && c.pressed <= 1;
    },
    lines: [
      'He has pressed it. A made contract, torn up, chalked again as {contract}, for double.',
      'Out of {from} and into {contract}. That was money and it is now a question.',
      'The press. He had it made and he has torn it up in front of the room.',
      'Pressed. {contract} by the end of this visit or the lot goes. I love it here.',
      'That is the press. Nobody made him do it. That is what I keep coming back to.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'It was made. It was made, and he tore it up. I would like that in the record twice.',
        '{from} had landed. That was a number. {contract} is a hope. He has swapped them over.',
        'Double the money down on a contract already good. There is a word for it. Not analysis.',
        'Appalling. Possibly correct at that price. Still appalling.',
      ],
    },
  },
  {
    id: 'contract_pressed_twice',
    speaker: 'NOCK',
    priority: 102,
    cooldown: 8,
    when: (ctx) => {
      const c = contractOf(ctx);
      return ctx.event.type === 'CONTRACT_PRESSED' && !!c && c.pressed >= 2;
    },
    lines: [
      'Pressed twice. {contract}. That is the top of the slate; there is nothing above it.',
      'Twice pressed. Four times the money on a contract that has to be perfect. I am cold.',
      '{contract}, at the second press. Nobody presses twice. He has just pressed twice.',
      'Out of {from} and up again. The slate has run out of harder things to become.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'Twice. He has pressed it twice. There is no third press. There is only the board.',
        'Pressed again! Gerald is standing on the chair and the chair has a history.',
        'Two presses and one visit. I have not breathed since the first one.',
      ],
    },
  },
  {
    id: 'pressed_landed',
    speaker: 'BARREL',
    priority: 99,
    cooldown: 8,
    when: (ctx) => {
      const c = contractOf(ctx);
      const how = settledAs(ctx);
      return !!c && c.pressed > 0 && (how === 'PAID' || how === 'BANKED');
    },
    lines: [
      'The press has landed. {contract}, made, {payout} into the Pot. I have no notes left.',
      'Pressed and paid. He tore up a good contract for a better one and the board allowed it.',
      '{contract} after a press. That is the biggest thing this slate does, and it has done it.',
      'It came in. The pressed one came in. Gerald has stood up and forgotten why.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        '{payout} on a pressed contract. It came off. Noted, for the record: it usually does not.',
        'The press paid. Once. One from one is the least useful record in the sport.',
        'I said it was appalling. It was appalling and it paid. Both are true. Both stay true.',
      ],
    },
  },
  {
    id: 'pressed_died',
    speaker: 'NOCK',
    priority: 99,
    cooldown: 8,
    when: (ctx) => {
      const c = contractOf(ctx);
      return settledAs(ctx) === 'LOST' && !!c && c.pressed > 0;
    },
    lines: [
      'That is the press gone. A made contract torn up, and nothing to show for either half.',
      'The press dies. Everything it was worth before he pressed it was real. It is not now.',
      'Lost on the press. The contract underneath it would have paid. That is the whole lesson.',
      'Gone. A press is a choice made from a winning position. That is why it costs this much.',
      'Gone. It could have been banked at any point before the press. That was the other door.',
      'Nothing back. {from} was the money and {contract} was the idea. The idea did not land.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'He had it. He pressed it. He has not got it. I am going to look at the carpet.',
        'That is the press for you. Best thing in the game, and mostly it is this.',
        'Nothing, out of something. Nock warned him. Nock was right and Nock hates being right.',
      ],
    },
  },
  {
    id: 'contract_shanghai',
    speaker: 'BARREL',
    priority: 88,
    cooldown: 8,
    when: (ctx) => {
      const c = contractOf(ctx);
      const how = settledAs(ctx);
      return !!c && c.defId === 'shanghai' && (how === 'PAID' || how === 'BANKED');
    },
    lines: [
      'Shanghai. Single, double and treble of one number, on a contract, for {payout}.',
      'That is a Shanghai, chalked and paid. Three rings, one bed, one visit. Gerald is up.',
      'A Shanghai on the slate. I have seen one. I will be seeing it for weeks.',
      'Three darts, one number, three different rings. And it was written down beforehand.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'Single, double, treble of the same bed. The oldest thing in this room, and it paid.',
        'Three rings of one number in three darts. The arithmetic is beside the point.',
        'That is the contract nobody takes, made by the player who took it. {payout} to the Pot.',
      ],
    },
  },
  {
    id: 'rub_out',
    speaker: 'NOCK',
    priority: 52,
    cooldown: 8,
    when: (ctx) => ctx.event.type === 'KIT_SPENT' && ctx.event.defId === 'rubout',
    lines: [
      'Rub out. The slate is wiped and three new contracts go up. The board did not object.',
      'Wiped. Three fresh ones, and the three he did not fancy are gone without costing a thing.',
      'A rub out before the first dart. The offer was poor. Now it is a different poor offer.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        'Off it all comes. New chalk, new three. That is lovely housekeeping, that is.',
        'Rubbed out. The slate is blank and the whole pub has gone quiet looking at it.',
      ],
    },
  },
  {
    id: 'kit_spent',
    speaker: 'BARREL',
    priority: 40,
    cooldown: 8,
    when: (ctx) => ctx.event.type === 'KIT_SPENT' && ctx.event.defId !== 'rubout',
    lines: [
      'Something out of the kit. One use, gone, and the dart is different for it.',
      'Into the kit and out of the kit. No putting that one back in the bag.',
      'He has spent one. That is the kit lighter and the dart heavier, in a manner of speaking.',
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'One intervention, one dart. It changes the throw he had already decided on. Nothing else.',
        'Spent. The kit is smaller and the chance is larger. That is the entire transaction.',
      ],
    },
  },
];

BARKS.push(...PACKAGE_BARKS, ...AIM_BARKS, ...SLATE_BARKS);

/** Every line in the bark pool, main and reply, in declaration order. */
export function allBarkLines(triggers: BarkTrigger[] = BARKS): string[] {
  const out: string[] = [];
  for (const t of triggers) {
    out.push(...t.lines);
    if (t.reply) out.push(...t.reply.lines);
  }
  return out;
}
