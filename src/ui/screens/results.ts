/**
 * Night over: the loss screen (seed + one-input AGAIN, TDD §9.1) and the win
 * screen (the game says plainly that it is finished, §9.3).
 *
 * Both report the same numbers in the same colours. A night that spent more on
 * the slate than it took off it says so, in the colour every other loss is
 * printed in, and the line under the headline is an observation about how the
 * player actually played rather than a pat on the back — design.md §6 asks a
 * loss to name something usable, and "well played" is not usable.
 */
import { P } from '../../art/palette';
import { measureText } from '../../art/sprites';
import { OCHES } from '../../content/oches';
import { seedToString } from '../../core/rng';
import { hasChalk, legName } from '../../core/state';
import type { NightState } from '../../core/types';
import type { App } from '../app';
import { CommentaryBar } from '../commentarybar';
import type { Renderer } from '../draw';
import type { Pointer } from '../input';
import type { Scene } from '../scene';
import { Particles, rndRange } from '../tween';
import { ButtonSet, drawPanel, drawRow, drawRule } from '../widgets';

/** Every contract the night settled, counted by how it ended. */
interface SlateLedger {
  settled: number;
  paid: number;
  banked: number;
  pulled: number;
  lost: number;
  staked: number;
  returned: number;
  /** What the slate was actually worth: everything back, less everything staked. */
  net: number;
}

/**
 * Read the legs' ledgers rather than the running totals. `potWon` counts only
 * the profit on the contracts that came in, so on its own it would flatter a
 * night that lost twice as much on the ones that did not.
 */
function readLedger(n: NightState): SlateLedger {
  const l: SlateLedger = { settled: 0, paid: 0, banked: 0, pulled: 0, lost: 0, staked: 0, returned: 0, net: 0 };
  for (const leg of n.legs) {
    for (const c of leg.ledger) {
      if (!c.settled) continue;
      l.settled++;
      l.staked += c.stake;
      l.returned += c.settled.pot;
      if (c.settled.how === 'PAID') l.paid++;
      else if (c.settled.how === 'BANKED') l.banked++;
      else if (c.settled.how === 'PULLED') l.pulled++;
      else l.lost++;
    }
  }
  l.net = l.returned - l.staked;
  return l;
}

/**
 * One thing this player did that they could do differently. Ordered loudest
 * first and drawn from what actually happened, so the sentence names a rule
 * rather than commiserating.
 */
function observation(n: NightState, l: SlateLedger, won: boolean): string {
  const s = n.stats;
  if (s.contractsTaken === 0) return 'You took no contracts all night. The Pot only grows on the slate.';
  if (won && n.pot >= 8) return `Won with ${n.pot} left in the Pot. Nothing pays after the Decider: spend it sooner.`;
  if (s.busts >= 4 && !hasChalk(n, 'on_tick')) return `${s.busts} busts. A bust takes every contract still riding: bank the made ones first.`;
  if (l.lost >= l.banked + l.pulled + 2) return `Lost ${l.lost} riding, banked ${l.banked}. A contract that lands only counts once you bank it.`;
  if (s.contractsPressed > l.banked + 1) return `Pressed ${s.contractsPressed} times, banked ${l.banked}. A press doubles the stake and risks the lot.`;
  if (l.net < 0 && l.settled >= 3) return `The slate cost ${-l.net} more than it paid. Pull a live contract for the stake back.`;
  if (l.pulled === 0 && l.settled >= 4) return 'You never pulled a contract. Pulling returns the stake and what it survived.';
  if (s.kitBought === 0) return 'Nothing bought for the kit. An intervention edits the dart you were throwing.';
  return 'A price shortens every time that contract pays. Spread the slate around.';
}

export class ResultsScreen implements Scene {
  buttons = new ButtonSet();
  bar = new CommentaryBar();
  particles = new Particles();
  keyboardFocus = true;
  time = 0;
  w = 320;
  h = 180;
  private confettiTimer = 0;
  /** Lifetime records this night beat, by results-table label. */
  private newBests = new Set<string>();

  constructor(
    public app: App,
    public won: boolean,
  ) {
    this.bar.blip = (s, ch) => (app.save.data.settings.voice ? app.audio.blip(s, ch) : 25);
  }

  get night(): NightState {
    return this.app.night as NightState;
  }

  get portrait(): boolean {
    return this.app.screen.orientation === 'portrait';
  }

  enter(): void {
    this.resize();
    this.app.audio.setCrowdTension(this.won ? 0.5 : 0.05);
    if (this.won) {
      this.app.sfx('win_fanfare');
      this.app.audio.crowdRoar(1);
    }
    const n = this.night;
    const st = this.app.save.data.stats;
    // Records first, while the old ones are still there to compare against.
    // Only a night that is not the first counts as beating something.
    this.newBests.clear();
    if (st.nightsPlayed > 0) {
      if (n.stats.bestCheckout > st.bestCheckout) this.newBests.add('BEST CHECKOUT');
      if (n.stats.bestVisit > st.bestVisit) this.newBests.add('BEST VISIT');
      if (n.stats.potEarned > st.bestPot) this.newBests.add('POT EARNED');
      if (n.legs.length > st.bestLeg) this.newBests.add('LEGS WON');
    }
    st.nightsPlayed++;
    if (this.won) st.nightsWon++;
    st.legsWon += n.stats.legsWon;
    st.oneEighties += n.stats.oneEighties;
    st.bestCheckout = Math.max(st.bestCheckout, n.stats.bestCheckout);
    st.bestVisit = Math.max(st.bestVisit, n.stats.bestVisit);
    st.bestPot = Math.max(st.bestPot, n.stats.potEarned);
    st.bestLeg = Math.max(st.bestLeg, n.legs.length);
    st.nineDarters += n.stats.nineDarters;
    this.app.save.persist();
    if (this.won) {
      this.bar.say([
        { speaker: 'BARREL', text: "That's the night! That's the actual night! I need to sit down.", triggerId: 'win', priority: 100 },
        { speaker: 'NOCK', text: 'Eight legs, fewer visits each time, and the slate paid for the rest. It is finished, and it was done properly.', triggerId: 'win', priority: 100 },
      ]);
    } else {
      // Never mock the player on the loss screen (TDD §10.3).
      const legsWon = n.stats.legsWon;
      this.bar.say([
        {
          speaker: 'NOCK',
          text: legsWon > 0 ? `${legsWon} leg${legsWon === 1 ? '' : 's'} won tonight. The board keeps no grudge, and neither do I.` : 'The board held. It does that. The seed is written down if you want it again.',
          triggerId: 'loss',
          priority: 100,
        },
        { speaker: 'BARREL', text: 'Same time tomorrow! Gerald is buying! Gerald does not know this yet!', triggerId: 'loss', priority: 100 },
      ]);
    }
  }

  exit(): void {
    this.app.audio.setCrowdTension(0);
  }

  resize(): void {
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    this.bar.lines = this.portrait ? 4 : 2;
    this.buildButtons();
  }

  /** Where the action row sits. Everything above is laid out from it upward. */
  private get buttonsY(): number {
    return this.portrait ? 254 : 140;
  }

  private buildButtons(): void {
    const b = this.buttons;
    b.clear();
    const actions: { id: string; label: string; icon?: number; primary?: boolean; onPress: () => void }[] = [
      {
        id: 'again',
        label: 'AGAIN',
        icon: 15,
        primary: true,
        onPress: () => {
          this.app.sfx('ui_confirm');
          this.app.startNight(this.app.chosenSeed, this.night.oche);
        },
      },
      {
        id: 'menu',
        label: 'MENU',
        onPress: () => {
          this.app.sfx('ui_back');
          this.app.toTitle();
        },
      },
    ];
    if (this.won) {
      actions.push({
        id: 'credits',
        label: 'CREDITS',
        onPress: () => {
          this.app.sfx('ui_confirm');
          this.app.toCredits();
        },
      });
    }
    // One row that always fits: AGAIN must be reachable in a single input.
    const gap = 6;
    const total = this.w - 12;
    const bw = Math.min(96, Math.floor((total - gap * (actions.length - 1)) / actions.length));
    const rowW = bw * actions.length + gap * (actions.length - 1);
    const x0 = Math.floor((this.w - rowW) / 2);
    actions.forEach((a, i) => b.add({ ...a, rect: { x: x0 + i * (bw + gap), y: this.buttonsY, w: bw, h: 16 } }));
    b.focusFirst();
  }

  onDown(p: Pointer): void {
    this.keyboardFocus = false;
    this.buttons.down(p.x, p.y);
  }

  onMove(p: Pointer): void {
    this.buttons.move(p.x, p.y);
  }

  onUp(p: Pointer): void {
    this.buttons.up(p.x, p.y);
  }

  onKey(key: string): void {
    if (this.buttons.key(key)) this.keyboardFocus = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.bar.update(dt);
    this.particles.update(dt);
    if (this.won) {
      this.confettiTimer -= dt;
      if (this.confettiTimer <= 0) {
        this.confettiTimer = 0.35;
        this.particles.emit(6, (i) => ({ x: rndRange(0, this.w), y: -4, vx: rndRange(-20, 20), vy: rndRange(20, 50), life: rndRange(2, 4), gravity: 12, drag: 0.4, sprite: 'confetti', frame: i % 4 }));
      }
    }
  }

  draw(r: Renderer): void {
    r.clear(P.DEEP);
    if (this.portrait) {
      r.sprite('wall', -70, 0);
      r.sprite('wall', -70, 132);
      r.sprite('oche_floor', 0, 272);
    } else {
      r.sprite('wall', 0, 0);
      r.sprite('oche_floor', 0, 132);
    }
    const n = this.night;
    const s = n.stats;
    const led = readLedger(n);
    const pw = this.portrait ? 172 : 268;
    const px = Math.floor((this.w - pw) / 2);
    const leg = n.legs[n.legs.length - 1];
    const head = this.won
      ? 'EIGHT LEGS. CHECKED OUT. FINISHED.'
      : leg
        ? `${legName(leg.index).toUpperCase()} · ${leg.score} LEFT AFTER ${leg.visitLimit} VISITS`
        : 'THE NIGHT RAN OUT';

    // The darts, then the slate. Both blocks are two columns in landscape and
    // one in portrait, so the row count differs but the content never does.
    const dartRows: [string, string][] = [
      ['LEGS WON', `${s.legsWon}/8`],
      ['180s', String(s.oneEighties)],
      ['BEST VISIT', String(s.bestVisit)],
      ['BEST CHECKOUT', s.bestCheckout ? String(s.bestCheckout) : '-'],
      ['BUSTS', String(s.busts)],
      ['CLEAN SHEET', s.bestStreak ? `${s.bestStreak} LEG${s.bestStreak === 1 ? '' : 'S'}` : '-'],
      ['POT EARNED', String(s.potEarned)],
      ['KIT BOUGHT', String(s.kitBought)],
    ];
    const slateRows: [string, string][] = [
      ['CONTRACTS', `${s.contractsTaken} TAKEN`],
      ['PAID', String(s.contractsPaid)],
      ['PRESSED', String(s.contractsPressed)],
      ['PULLED', String(led.pulled)],
      ['POT STAKED', String(s.potStaked)],
      ['POT WON', String(s.potWon)],
      ['BEST PAYOUT', s.bestPayout ? `+${s.bestPayout}` : '-'],
      ['NET ON THE SLATE', led.net > 0 ? `+${led.net}` : String(led.net)],
    ];

    const headLines = r.wrap(head, pw - 12);
    const rowsA = this.portrait ? dartRows.length : Math.ceil(dartRows.length / 2);
    const rowsB = this.portrait ? slateRows.length : Math.ceil(slateRows.length / 2);
    // The table and the headline are fixed; the observation gets whatever is
    // left between them and the buttons, so a long one can never push the
    // panel down over the only control that starts another night.
    const top = this.portrait ? 20 : 8;
    const fixed = 10 + headLines.length * 9 + 8 + rowsA * 8 + 8 + rowsB * 8 + 4 + 8 + 3;
    const wrapped = r.wrap(observation(n, led, this.won), pw - 12);
    const subRoom = Math.max(1, Math.floor((this.buttonsY - 4 - top - fixed) / 8));
    const subLines = wrapped.slice(0, subRoom);
    if (wrapped.length > subLines.length) subLines[subLines.length - 1] = `${subLines[subLines.length - 1]}…`;
    const ph = fixed + subLines.length * 8;
    const py = Math.max(2, Math.min(top, this.buttonsY - 4 - ph));
    drawPanel(r, { x: px, y: py, w: pw, h: ph }, this.won ? 'THE NIGHT IS YOURS' : 'TIMED OUT');

    const cx = px + Math.floor(pw / 2);
    let y = py + 10;
    for (const line of headLines) {
      r.text(line, cx, y, { color: this.won ? P.BRASS_LIT : P.EMBER, align: 'center' });
      y += 9;
    }
    // The observation carries the night's own bad news, so it is printed in
    // the same colour as any other loss rather than softened.
    for (const line of subLines) {
      r.text(line, cx, y, { color: led.net < 0 ? P.EMBER : P.MIST, align: 'center' });
      y += 8;
    }
    y += 4;
    const colW = this.portrait ? pw - 16 : Math.floor((pw - 24) / 2);
    const blink = Math.floor(this.time * 3) % 2 === 0;
    const block = (rows: [string, string][], colour: (row: [string, string], i: number) => number) => {
      drawRule(r, px + 8, y, pw - 16);
      y += 4;
      rows.forEach((row, i) => {
        const col = this.portrait ? 0 : i % 2;
        const rowI = this.portrait ? i : Math.floor(i / 2);
        const best = this.newBests.has(row[0]);
        drawRow(r, px + 8 + col * (colW + 8), y + rowI * 8, colW, row[0], row[1], best && blink ? P.CHALK : colour(row, i));
      });
      y += (this.portrait ? rows.length : Math.ceil(rows.length / 2)) * 8 + 4;
    };
    block(dartRows, (row, i) => (i === 1 && s.oneEighties > 0 ? P.EMBER : P.BRASS_LIT));
    block(slateRows, (row) => (row[0] === 'NET ON THE SLATE' ? (led.net < 0 ? P.EMBER : led.net > 0 ? P.BRASS_LIT : P.MIST) : P.BRASS_LIT));
    drawRule(r, px + 8, y, pw - 16);
    y += 4;
    this.drawFooter(r, cx, y, pw - 16, n);

    // Under the panel: what this night beat, or what the next one could
    // unlock. Only as many lines as there is room for above the buttons.
    const under = py + ph + 4;
    const room = Math.max(0, Math.floor((this.buttonsY - 3 - under) / 8));
    if (room > 0) this.drawNews(r, cx, under, px, pw, room, blink);

    this.buttons.draw(r, this.keyboardFocus);
    for (const p of this.particles.list) r.sprite(p.sprite, Math.round(p.x), Math.round(p.y), p.frame);
    this.bar.draw(r, this.portrait ? { x: 0, y: this.h - 36, w: this.w, h: 36 } : { x: 0, y: this.h - 20, w: this.w, h: 20 });
  }

  /** Seed and oche, with the night's unlock beside them when one fits. */
  private drawFooter(r: Renderer, cx: number, y: number, w: number, n: NightState): void {
    const seed = `SEED ${seedToString(n.seed)} · ${ocheName(n)}`;
    if (!n.achievements.length) {
      r.text(seed, cx, y, { color: P.PEWTER, align: 'center' });
      return;
    }
    const unlock = `UNLOCKED: ${n.achievements.map((a) => a.toUpperCase()).join(' ')}`;
    if (measureText(5, seed) + measureText(5, unlock) + 8 <= w) {
      r.text(seed, cx - Math.floor(w / 2), y, { color: P.PEWTER });
      r.text(unlock, cx + Math.floor(w / 2), y, { color: P.SKY_LIT, align: 'right' });
      return;
    }
    r.text(unlock, cx, y, { color: P.SKY_LIT, align: 'center' });
  }

  private drawNews(r: Renderer, cx: number, y: number, px: number, pw: number, room: number, blink: boolean): void {
    const strip = (lines: number) => r.dither(px, y - 2, pw, lines * 8 + 3, P.INK, 12);
    if (this.newBests.size) {
      strip(1);
      r.text(`NEW BEST · ${[...this.newBests].join(' · ')}`, cx, y, { color: blink ? P.BRASS_LIT : P.BRASS, align: 'center' });
      return;
    }
    const next = OCHES.find((o) => !this.app.save.isUnlocked(o.id));
    if (!next) return;
    strip(Math.min(2, room));
    r.text(`NEXT OCHE · ${next.name.toUpperCase()}`, cx, y, { color: P.MIST, align: 'center' });
    if (room > 1) r.text(next.unlock.toUpperCase(), cx, y + 8, { color: P.PEWTER, align: 'center' });
  }
}

function ocheName(n: NightState): string {
  return { local: 'THE LOCAL', sharp: 'THE SHARP', steady: 'THE STEADY', wide: 'THE WIDE', thin: 'THE THIN' }[n.oche];
}
