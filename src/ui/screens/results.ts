/**
 * Night over: the loss screen (seed + one-input AGAIN, TDD §9.1) and the
 * win screen (the game says plainly that it is finished, §9.3).
 */
import { P } from '../../art/palette';
import { OCHES } from '../../content/oches';
import { seedToString } from '../../core/rng';
import { legName } from '../../core/state';
import type { NightState } from '../../core/types';
import type { App } from '../app';
import { CommentaryBar } from '../commentarybar';
import type { Renderer } from '../draw';
import type { Pointer } from '../input';
import type { Scene } from '../scene';
import { Particles, rndRange } from '../tween';
import { ButtonSet, drawPanel, drawRow, drawRule } from '../widgets';

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
        { speaker: 'NOCK', text: 'Eight legs. Fewer visits each time. It is finished, and it was done properly.', triggerId: 'win', priority: 100 },
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
    const y = this.portrait ? 254 : 138;
    actions.forEach((a, i) => b.add({ ...a, rect: { x: x0 + i * (bw + gap), y, w: bw, h: 18 } }));
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
    const pw = this.portrait ? 172 : 268;
    const px = Math.floor((this.w - pw) / 2);
    const py = this.portrait ? 20 : 10;
    const ph = this.portrait ? 202 : 106;
    drawPanel(r, { x: px, y: py, w: pw, h: ph }, this.won ? 'THE NIGHT IS YOURS' : 'TIMED OUT');
    const cx = px + Math.floor(pw / 2);
    let y = py + 12;
    const blurb = (head: string, headColor: number, sub: string) => {
      for (const line of r.wrap(head, pw - 12)) {
        r.text(line, cx, y, { color: headColor, align: 'center' });
        y += 9;
      }
      for (const line of r.wrap(sub, pw - 12)) {
        r.text(line, cx, y, { color: P.MIST, align: 'center' });
        y += 8;
      }
      y += 4;
    };
    if (this.won) {
      blurb('EIGHT LEGS. CHECKED OUT. FINISHED.', P.BRASS_LIT, "That's the game. There is no endless mode. Go outside.");
    } else {
      const leg = n.legs[n.legs.length - 1];
      blurb(`${legName(leg.index).toUpperCase()} · ${leg.score} LEFT AFTER ${leg.visitLimit} VISITS`, P.EMBER, 'Nothing is lost. Nothing decays. Have another go.');
    }
    drawRule(r, px + 8, y, pw - 16);
    y += 4;
    const colW = this.portrait ? pw - 16 : Math.floor((pw - 24) / 2);
    const rows: [string, string][] = [
      ['LEGS WON', `${n.stats.legsWon}/8`],
      ['180s', String(n.stats.oneEighties)],
      ['BEST VISIT', String(n.stats.bestVisit)],
      ['BEST CHECKOUT', n.stats.bestCheckout ? String(n.stats.bestCheckout) : '-'],
      ['BUSTS', String(n.stats.busts)],
      ['SHANGHAIS', String(n.stats.shanghais)],
      ['CLEAN SHEET', n.stats.bestStreak ? `${n.stats.bestStreak} LEG${n.stats.bestStreak === 1 ? '' : 'S'}` : '-'],
      ['POT EARNED', String(n.stats.potEarned)],
    ];
    const blink = Math.floor(this.time * 3) % 2 === 0;
    rows.forEach((row, i) => {
      const col = this.portrait ? 0 : i % 2;
      const rowI = this.portrait ? i : Math.floor(i / 2);
      const x = px + 8 + col * (colW + 8);
      const best = this.newBests.has(row[0]);
      const label = row[0];
      drawRow(r, x, y + rowI * 9, colW, label, row[1], best && blink ? P.CHALK : i === 1 && n.stats.oneEighties > 0 ? P.EMBER : P.BRASS_LIT);
    });
    y += (this.portrait ? rows.length : rows.length / 2) * 9 + 4;
    drawRule(r, px + 8, y, pw - 16);
    y += 4;
    r.text(`SEED ${seedToString(n.seed)} · ${ocheName(n)}`, cx, y, { color: P.PEWTER, align: 'center' });
    if (n.achievements.length) {
      y += 9;
      r.text(`OCHE UNLOCKED: ${n.achievements.map((a) => a.toUpperCase()).join(', ')}`, cx, y, { color: P.SKY_LIT, align: 'center' });
    }
    // Under the panel: what this night beat, or what the next one could unlock.
    const under = py + ph + 4;
    const strip = (lines: number) => r.dither(px, under - 2, pw, lines * 8 + 3, P.INK, 12);
    if (this.newBests.size) {
      strip(1);
      r.text(`NEW BEST · ${[...this.newBests].join(' · ')}`, cx, under, { color: blink ? P.BRASS_LIT : P.BRASS, align: 'center' });
    } else if (!n.achievements.length) {
      const next = OCHES.find((o) => !this.app.save.isUnlocked(o.id));
      if (next) {
        strip(2);
        r.text(`NEXT OCHE · ${next.name.toUpperCase()}`, cx, under, { color: P.MIST, align: 'center' });
        r.text(next.unlock.toUpperCase(), cx, under + 8, { color: P.PEWTER, align: 'center' });
      }
    }
    this.buttons.draw(r, this.keyboardFocus);
    for (const p of this.particles.list) r.sprite(p.sprite, Math.round(p.x), Math.round(p.y), p.frame);
    this.bar.draw(r, this.portrait ? { x: 0, y: this.h - 36, w: this.w, h: 36 } : { x: 0, y: this.h - 20, w: this.w, h: 20 });
  }
}

function ocheName(n: NightState): string {
  return { local: 'THE LOCAL', sharp: 'THE SHARP', steady: 'THE STEADY', wide: 'THE WIDE', thin: 'THE THIN' }[n.oche];
}
