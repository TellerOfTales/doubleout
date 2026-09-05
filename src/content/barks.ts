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
 * No gambling words. No real people, leagues, sponsors, venues or brands.
 * "Pot" means the in-game Pot only.
 *
 * Placeholders substituted by the engine (src/core/commentary.ts):
 *   {score} leg score after the throw   {total} visit total   {value} throw value
 *   {chalk} fired chalk names joined by ' then '   {leg} leg name   {pot} pot
 *   {card} notation of the committed card   {n180} 180s this night
 *
 * Character set: ASCII printable plus '…' (the 5x7 font has no em-dash).
 */
import { shanghaiProgress } from '../core/state';
import type { BarkContext, BarkTrigger, ThrowResult } from '../core/types';

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
    when: (ctx) => ctx.event.type === 'HAND_DEALT' && ctx.leg.score >= 2 && ctx.leg.score <= 170,
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
      "Shop's open! {pot} in the pot! Cards! Chalk! Something in a jar!",
      "To the shop! {pot} pot! The man behind the counter's got a look! A SELLING look!",
      "Shop time! {pot} pot! I'd buy the lot but I'm not allowed to touch anything!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        "{pot} in the pot. A refresh is 1. Removing a card is 2. The jar is not for sale.",
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
      "A purchase. {pot} left in the pot. The deck is a little different. The board is not.",
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
      'Double money on this leg! Somebody hold my clipboard! I do not have a clipboard!',
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
    id: 'setup_bonus',
    speaker: 'NOCK',
    priority: 55,
    cooldown: 9,
    when: (ctx) => ctx.event.type === 'SETUP_BONUS',
    lines: [
      'Left on {score}, and the deck can close it. That is the whole game, done quietly.',
      '{score}. A finishable number, chosen on purpose. I could weep.',
      'That is not luck. That is arithmetic done three darts early.',
      'Left it right. The Pot notices. Nobody else does, but the Pot notices.',
    ],
  },
  {
    id: 'pocketed',
    speaker: 'BARREL',
    priority: 45,
    cooldown: 10,
    when: (ctx) => ctx.event.type === 'POCKETED',
    lines: [
      "Into the pocket! He's saving that one for later! Like a crisp!",
      'Kept back! That is FORWARD PLANNING and I do not care for it!',
      'One up the sleeve! Legal! I checked! Nobody checked!',
      'Pocketed! It will come back every visit until he throws it! Like a bad memory!',
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
    id: 'shanghai',
    speaker: 'BARREL',
    priority: 108,
    cooldown: 6,
    when: (ctx) => ctx.event.type === 'SHANGHAI',
    lines: [
      "SHANGHAI! SINGLE, DOUBLE, TREBLE! THE LEG IS OVER! Nock, the leg is OVER!",
      "SHANGHAI! Whatever was left, it's gone! GONE! The scoreboard's been made redundant!",
      "SHANGHAI ON THE {card}S! Gerald's up! Gerald's on a CHAIR! That chair has a history!",
      "THE SHANGHAI! The pub rule! The ONE! Three darts, one number, and the leg just… ENDS!",
      "SHANGHAI! I've never seen one! I've seen one NOW! I'll be seeing it for WEEKS!",
      "ONE NUMBER, THREE WAYS, AND GOODNIGHT! That is a SHANGHAI and I need a sit down!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'Single, double, treble of the called number. What was left does not matter. It never did.',
        'The rule predates the scoreboard. Tonight the scoreboard found out.',
        'Three darts in one bed, three rings. The arithmetic is dismissed. It returns next leg.',
        'That is the oldest rule in the room, and the loudest. Both by some distance.',
      ],
    },
  },
  {
    id: 'shanghai_two',
    speaker: 'NOCK',
    priority: 48,
    cooldown: 5,
    when: (ctx) => {
      if (ctx.event.type !== 'THROW' || ctx.event.result.outcome !== 'CONTINUE') return false;
      const v = ctx.leg.visits[ctx.leg.visits.length - 1];
      return !!v && v.throws.length < 3 && shanghaiProgress(ctx.leg).size === 2;
    },
    lines: [
      'Two of the three. One dart, one ring, and the leg ends where it stands.',
      'That is two pieces of the Shanghai in one visit. The room has noticed. So has the board.',
      'Two down. The third would finish the leg from anywhere. I will not say more. Barrel will.',
      'Single and double, or double and treble, it does not matter. One more of the {card}s.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "ONE MORE OF THEM AND IT'S OVER! I can't look! I'm looking! I CAN'T STOP LOOKING!",
        "Come on! COME ON! One more in that bed and the leg is DONE! DONE, I said!",
        "Nock, I have never wanted a dart to land anywhere this much! ANYWHERE!",
      ],
    },
  },
  {
    id: 'shanghai_called',
    speaker: 'NOCK',
    priority: 28,
    cooldown: 12,
    when: (ctx) => ctx.event.type === 'LEG_START' && ctx.leg.visits.length <= 1,
    lines: [
      'Shanghai stands tonight. Single, double and treble of one number in a visit wins the leg.',
      'House rule on the board: three rings of the called number in a visit and the leg is yours.',
      'The Shanghai number is called. Most nights nobody hits it. Everyone talks about it anyway.',
    ],
  },
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
      "That's the wall, and the warmth's gone with it! You could have banked that! I WOULD have!",
    ],
    reply: {
      speaker: 'NOCK',
      lines: [
        'The wall keeps the score and spends the crowd. It was on offer to bank before the throw.',
        'A cold room and an intact score. That is the trade. It is not a bad trade. It is a trade.',
        'Nothing lost on the board. Everything lost on the gauge. Two different ledgers.',
      ],
    },
  },
  {
    id: 'heat_cashed',
    speaker: 'NOCK',
    priority: 58,
    cooldown: 6,
    when: (ctx) => ctx.event.type === 'HEAT_CASHED',
    lines: [
      'Banked. The sure thing, taken. The gauge starts again from nothing, where it started.',
      'The crowd is paid off and sits down. {pot} to the Pot. Could have been more, or nothing.',
      'Banked before the throw. The wall can do what it likes now. So can the board.',
      'That is the ride declined. Sensible people decline rides. Barrel never has.',
    ],
    reply: {
      speaker: 'BARREL',
      lines: [
        "BANKED IT! Coins in the tin! The crowd's confused but they've been PAID!",
        "Took the coins and ran! Well, stood! Took the coins and STOOD!",
        "That's a pint's worth right there! Not a real pint! A METAPHORICAL pint! Gerald, DOWN!",
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
    priority: 26,
    cooldown: 20,
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

BARKS.push(...PACKAGE_BARKS);

/** Every line in the bark pool, main and reply, in declaration order. */
export function allBarkLines(triggers: BarkTrigger[] = BARKS): string[] {
  const out: string[] = [];
  for (const t of triggers) {
    out.push(...t.lines);
    if (t.reply) out.push(...t.reply.lines);
  }
  return out;
}
