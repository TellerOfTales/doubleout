/**
 * Title screen / main menu: PLAY, TUTORIAL, EXIT plus oche choice, seed
 * entry, settings and credits. The commentators warm up in the bar.
 */
import { P } from '../../art/palette';
import { measureText } from '../../art/sprites';
import { OCHES, OCHE_BY_ID } from '../../content/oches';
import { buildBarkContext } from '../../core/commentary';
import { parseSeed, seedToString } from '../../core/rng';
import { createNight } from '../../core/state';
import type { OcheId } from '../../core/types';
import type { App } from '../app';
import { CommentaryBar } from '../commentarybar';
import type { Renderer } from '../draw';
import { inRect, type Pointer } from '../input';
import type { Rect } from '../layout';
import type { Scene } from '../scene';
import { Particles, rndRange } from '../tween';
import { ButtonSet, drawPanel, drawRow } from '../widgets';

const SEED_KEYS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class TitleScreen implements Scene {
  buttons = new ButtonSet();
  bar = new CommentaryBar();
  particles = new Particles();
  keyboardFocus = false;
  time = 0;
  overlay: 'none' | 'oche' | 'seed' | 'exit' = 'none';
  overlayButtons = new ButtonSet();
  seedText = '';
  crowd: { x: number; y: number; frame: number; tint: number; phase: number }[] = [];
  idleDart: { t: number; from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
  private idleTimer = 4;
  private chatterTimer = 2.5;
  private stuck: { x: number; y: number; f: number }[] = [];
  private w = 320;
  private h = 180;

  constructor(public app: App) {
    this.bar.blip = (s, ch) => (app.save.data.settings.voice ? app.audio.blip(s, ch) : 25);
  }

  get portrait(): boolean {
    return this.app.screen.orientation === 'portrait';
  }

  enter(): void {
    this.resize();
    this.app.audio.setCrowdTension(0.12);
    this.chatterTimer = 1.2;
  }

  exit(): void {
    this.app.audio.setCrowdTension(0);
  }

  resize(): void {
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    this.bar.lines = this.portrait ? 4 : 2;
    this.buildButtons();
    this.buildCrowd();
  }

  private buildCrowd(): void {
    this.crowd = [];
    const n = this.portrait ? 14 : 24;
    const y = this.portrait ? 262 : 128;
    for (let i = 0; i < n; i++) {
      const x = 2 + Math.round((i / (n - 1)) * (this.w - 12)) + Math.round(rndRange(-2, 2));
      this.crowd.push({ x, y: y + Math.round(rndRange(0, 4)), frame: Math.floor(rndRange(0, 6)), tint: Math.floor(rndRange(0, 5)), phase: rndRange(0, 6.28) });
    }
    this.crowd.sort((a, b) => a.y - b.y);
  }

  private menuRect(): Rect {
    return this.portrait ? { x: 16, y: 148, w: 148, h: 118 } : { x: 170, y: 40, w: 142, h: 114 };
  }

  private buildButtons(): void {
    const b = this.buttons;
    b.clear();
    const m = this.menuRect();
    const bw = m.w;
    const bh = 16;
    const gap = 3;
    let y = m.y;
    const add = (id: string, label: string, primary: boolean, onPress: () => void, icon?: number) => {
      b.add({ id, rect: { x: m.x, y, w: bw, h: bh }, label, primary, icon, onPress });
      y += bh + gap;
    };
    add('play', 'PLAY', true, () => this.play(), 15);
    add('tutorial', 'TUTORIAL', false, () => {
      this.app.sfx('ui_confirm');
      this.app.toTutorial();
    }, 30);
    add('oche', `OCHE: ${OCHE_BY_ID[this.app.chosenOche].name.toUpperCase()}`, false, () => this.openOche());
    add('seed', `SEED: ${this.app.chosenSeed === null ? 'RANDOM' : seedToString(this.app.chosenSeed)}`, false, () => this.openSeed());
    add('settings', 'SETTINGS', false, () => {
      this.app.sfx('ui_confirm');
      this.app.toSettings(() => this.app.toTitle());
    }, 14);
    add('exit', 'EXIT', false, () => this.exitGame());
    b.focusFirst();
  }

  private play(): void {
    this.app.sfx('ui_confirm');
    this.app.startNight(this.app.chosenSeed, this.app.chosenOche);
  }

  private exitGame(): void {
    this.app.sfx('ui_back');
    this.overlay = 'exit';
    this.overlayButtons.clear();
    const cx = Math.floor(this.w / 2);
    const cy = Math.floor(this.h / 2);
    this.overlayButtons.add({ id: 'back', rect: { x: cx - 40, y: cy + 18, w: 80, h: 16 }, label: 'STAY', primary: true, onPress: () => this.closeOverlay() });
    this.overlayButtons.focusFirst();
    try {
      // Only works for windows opened by script; otherwise the message below stands.
      window.close();
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- overlays

  private openOche(): void {
    this.app.sfx('ui_confirm');
    this.overlay = 'oche';
    this.overlayButtons.clear();
    const pw = this.portrait ? 168 : 250;
    const px = Math.floor((this.w - pw) / 2);
    const py = this.portrait ? 40 : 20;
    OCHES.forEach((o, i) => {
      const unlocked = this.app.save.isUnlocked(o.id);
      this.overlayButtons.add({
        id: o.id,
        rect: { x: px + 8, y: py + 14 + i * 24, w: 70, h: 16 },
        label: o.name.toUpperCase(),
        icon: unlocked ? undefined : 10,
        disabled: !unlocked,
        primary: o.id === this.app.chosenOche,
        onPress: () => {
          this.app.chosenOche = o.id;
          this.app.save.data.lastOche = o.id;
          this.app.save.persist();
          this.app.sfx('ui_confirm');
          this.buildButtons();
          this.closeOverlay();
        },
      });
    });
    this.overlayButtons.add({ id: 'close', rect: { x: px + pw - 60, y: py + 14 + 5 * 24, w: 52, h: 16 }, label: 'BACK', onPress: () => this.closeOverlay() });
    this.overlayButtons.focusFirst();
  }

  private openSeed(): void {
    this.app.sfx('ui_confirm');
    this.overlay = 'seed';
    this.seedText = this.app.chosenSeed === null ? '' : seedToString(this.app.chosenSeed);
    this.overlayButtons.clear();
    const pw = this.portrait ? 172 : 220;
    const px = Math.floor((this.w - pw) / 2);
    const py = this.portrait ? 60 : 24;
    // on-screen keys: 4 rows × 8
    const kw = this.portrait ? 18 : 24;
    const kh = 14;
    for (let i = 0; i < SEED_KEYS.length; i++) {
      const row = Math.floor(i / 8);
      const col = i % 8;
      const ch = SEED_KEYS[i];
      this.overlayButtons.add({
        id: `k${ch}`,
        rect: { x: px + 8 + col * (kw + 2), y: py + 30 + row * (kh + 2), w: kw, h: kh },
        label: ch,
        onPress: () => this.seedKey(ch),
      });
    }
    const by = py + 30 + 4 * (kh + 2) + 4;
    this.overlayButtons.add({ id: 'del', rect: { x: px + 8, y: by, w: 44, h: 16 }, label: 'DEL', onPress: () => this.seedKey('Backspace') });
    this.overlayButtons.add({ id: 'rnd', rect: { x: px + 56, y: by, w: 56, h: 16 }, label: 'RANDOM', onPress: () => this.seedKey('Random') });
    this.overlayButtons.add({ id: 'ok', rect: { x: px + pw - 68, y: by, w: 60, h: 16 }, label: 'USE SEED', primary: true, onPress: () => this.seedKey('Enter') });
    this.overlayButtons.focus = this.overlayButtons.buttons.length - 1;
  }

  private seedKey(k: string): void {
    if (k === 'Backspace') {
      this.seedText = this.seedText.slice(0, -1);
      this.app.sfx('ui_move');
    } else if (k === 'Random') {
      this.seedText = '';
      this.app.chosenSeed = null;
      this.app.sfx('ui_confirm');
      this.buildButtons();
      this.closeOverlay();
    } else if (k === 'Enter') {
      this.app.chosenSeed = this.seedText.trim() === '' ? null : parseSeed(this.seedText);
      this.app.sfx('ui_confirm');
      this.buildButtons();
      this.closeOverlay();
    } else if (k === 'Escape') {
      this.closeOverlay();
    } else if (k.length === 1 && this.seedText.length < 12) {
      const up = k.toUpperCase();
      if (/[A-Z0-9]/.test(up)) {
        this.seedText += up;
        this.app.sfx('ui_move');
      }
    }
  }

  private closeOverlay(): void {
    this.overlay = 'none';
    this.overlayButtons.clear();
    this.app.sfx('ui_back');
  }

  // ---------------------------------------------------------------- input

  onDown(p: Pointer): void {
    this.keyboardFocus = false;
    if (this.overlay !== 'none') {
      this.overlayButtons.down(p.x, p.y);
      return;
    }
    if (inRect(p.x, p.y, this.barRect())) {
      this.bar.skip();
      return;
    }
    this.buttons.down(p.x, p.y);
  }

  onMove(p: Pointer): void {
    (this.overlay !== 'none' ? this.overlayButtons : this.buttons).move(p.x, p.y);
  }

  onUp(p: Pointer): void {
    if (this.overlay !== 'none') {
      this.overlayButtons.up(p.x, p.y);
      return;
    }
    this.buttons.up(p.x, p.y);
  }

  onKey(key: string): void {
    if (this.overlay === 'seed') {
      if (key === 'Backspace' || key === 'Enter' || key === 'Escape' || key.length === 1) {
        this.seedKey(key);
        return;
      }
    }
    if (this.overlay !== 'none') {
      if (key === 'Escape') {
        this.closeOverlay();
        return;
      }
      if (this.overlayButtons.key(key)) this.keyboardFocus = true;
      return;
    }
    if (this.buttons.key(key)) {
      this.keyboardFocus = true;
      if (key !== 'Enter' && key !== ' ') this.app.sfx('ui_move');
    }
  }

  // ---------------------------------------------------------------- update / draw

  private barRect(): Rect {
    return this.portrait ? { x: 0, y: this.h - 36, w: this.w, h: 36 } : { x: 0, y: this.h - 20, w: this.w, h: 20 };
  }

  update(dt: number): void {
    this.time += dt;
    this.bar.update(dt);
    this.particles.update(dt);
    this.idleTimer -= dt;
    if (this.idleTimer <= 0 && !this.idleDart) {
      const board = this.boardRect();
      const c = { x: board.x + board.w / 2, y: board.y + board.h / 2 };
      const a = rndRange(0, Math.PI * 2);
      const r = rndRange(4, board.w * 0.42);
      this.idleDart = { t: 0, from: { x: this.portrait ? 160 : 60, y: this.h + 10 }, to: { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r } };
      this.app.sfx('throw', { volume: 0.4 });
      this.idleTimer = rndRange(3, 6);
    }
    if (this.idleDart) {
      this.idleDart.t += dt * 2.6;
      if (this.idleDart.t >= 1) {
        const d = this.idleDart;
        this.stuck.push({ x: Math.round(d.to.x), y: Math.round(d.to.y), f: Math.floor(rndRange(0, 4)) });
        if (this.stuck.length > 3) this.stuck.shift();
        this.app.sfx('thud', { volume: 0.5, pitch: 1 + rndRange(-0.1, 0.1) });
        this.particles.emit(4, () => ({ x: d.to.x, y: d.to.y, vx: rndRange(-40, 40), vy: rndRange(-50, 0), life: 0.3, sprite: 'spark', frame: 1 }));
        this.idleDart = null;
      }
    }
    this.chatterTimer -= dt;
    if (this.chatterTimer <= 0 && this.bar.idle) {
      this.chatterTimer = rndRange(9, 16);
      try {
        const night = this.app.night ?? createNight(1, 'local');
        const ctx = buildBarkContext(night, { type: 'IDLE', seconds: 20 });
        const barks = this.app.commentary.react(ctx);
        if (barks.length) this.bar.say(barks);
      } catch {
        /* ignore */
      }
    }
  }

  private boardRect(): Rect {
    // 96 in both orientations: the word-mark band owns the top 34px, so a
    // 128px board would hang below the floor line.
    return this.portrait ? { x: 42, y: 44, w: 96, h: 96 } : { x: 34, y: 36, w: 96, h: 96 };
  }

  draw(r: Renderer): void {
    r.clear(P.DEEP);
    if (this.portrait) {
      r.sprite('wall', -70, 0);
      r.sprite('wall', -70, 132);
      r.sprite('oche_floor', 0, 268);
    } else {
      r.sprite('wall', 0, 0);
      r.sprite('oche_floor', 0, 132);
    }
    const b = this.boardRect();
    r.sprite('light_cone', b.x + b.w / 2 - 32, b.y - 24);
    r.dither(b.x + 3, b.y + 4, b.w, b.h, P.INK, 8);
    r.sprite('board_96', b.x, b.y);
    for (const s of this.stuck) r.sprite('dart_stuck', s.x - 2, s.y - 2, s.f);
    // crowd
    for (const c of this.crowd) {
      const bob = Math.round(Math.sin(this.time * 2 + c.phase) * 1.3);
      const canvas = r.sprites.tinted('crowd_head', `t${c.tint}`, (idx) => (idx === P.SHADE ? [P.SHADE, P.STONE, P.DEEP, P.PEWTER, P.CLARET][c.tint] : idx));
      r.canvas(canvas, c.x, c.y + bob, 8, 8, c.frame);
    }
    // idle dart
    if (this.idleDart) {
      const d = this.idleDart;
      const t = d.t;
      const x = d.from.x + (d.to.x - d.from.x) * t;
      const y = d.from.y + (d.to.y - d.from.y) * t - Math.sin(t * Math.PI) * 30;
      r.sprite('dart', Math.round(x) - 4, Math.round(y) - 4, 0);
    }
    for (const p of this.particles.list) r.sprite(p.sprite, Math.round(p.x), Math.round(p.y), p.frame);
    // word mark across the top, with a dark band so it reads over the wall
    const logoW = 180;
    const logoX = Math.floor((this.w - logoW) / 2);
    const logoY = this.portrait ? 6 : 2;
    const bob = Math.round(Math.sin(this.time * 1.5) * 1);
    r.dither(0, logoY - 2, this.w, 34, P.INK, 12);
    r.sprite('logo', logoX, logoY + bob);
    // menu
    this.buttons.draw(r, this.keyboardFocus);
    // lifetime stats
    const st = this.app.save.data.stats;
    if (st.nightsPlayed > 0) {
      const sx = this.portrait ? 8 : 4;
      const sy = this.portrait ? 272 : 160 - 12;
      const txt = `NIGHTS ${st.nightsWon}/${st.nightsPlayed} · BEST LEG ${st.bestLeg} · BEST POT ${st.bestPot} · 180s ${st.oneEighties}`;
      r.text(txt, sx, sy, { color: P.STONE });
      // The next thing to chase, so a run always has a reason beyond the run.
      const next = OCHES.find((o) => !this.app.save.isUnlocked(o.id));
      if (next && this.overlay === 'none') {
        r.text(`NEXT OCHE · ${next.name.toUpperCase()} · ${next.unlock.toUpperCase()}`, sx, sy + 8, { color: P.STONE });
      }
    }
    r.text('v1.0', this.w - 3, 2, { color: P.STONE, align: 'right' });
    if (!this.app.save.data.stats.tutorialDone && this.overlay === 'none') {
      const m = this.menuRect();
      const on = Math.floor(this.time * 2) % 2 === 0;
      r.text('NEW? START HERE', m.x + m.w + 4, m.y + 19 + 4, { color: on ? P.BRASS_LIT : P.BRASS });
      if (this.portrait) r.text('', 0, 0);
    }
    this.bar.draw(r, this.barRect());
    if (r.sprites.has('vignette') && !this.portrait) r.sprite('vignette', 0, 0);
    if (this.overlay === 'oche') this.drawOcheOverlay(r);
    if (this.overlay === 'seed') this.drawSeedOverlay(r);
    if (this.overlay === 'exit') this.drawExitOverlay(r);
  }

  private drawOcheOverlay(r: Renderer): void {
    r.dither(0, 0, this.w, this.h, P.INK, 10);
    const pw = this.portrait ? 168 : 250;
    const px = Math.floor((this.w - pw) / 2);
    const py = this.portrait ? 40 : 20;
    drawPanel(r, { x: px, y: py, w: pw, h: 14 + 6 * 24 }, 'CHOOSE YOUR OCHE');
    OCHES.forEach((o, i) => {
      const unlocked = this.app.save.isUnlocked(o.id);
      const y = py + 14 + i * 24;
      const tx = px + 84;
      if (this.portrait) {
        r.textWrap(unlocked ? o.change : `LOCKED: ${o.unlock}`, tx, y + 1, pw - 92, { color: unlocked ? P.MIST : P.PEWTER }, 1);
      } else {
        r.text(unlocked ? o.change : `LOCKED: ${o.unlock}`, tx, y + 1, { color: unlocked ? P.MIST : P.PEWTER });
        r.text(unlocked ? o.flavour : '', tx, y + 10, { color: P.STONE });
      }
    });
    this.overlayButtons.draw(r, this.keyboardFocus);
  }

  private drawSeedOverlay(r: Renderer): void {
    r.dither(0, 0, this.w, this.h, P.INK, 10);
    const pw = this.portrait ? 172 : 220;
    const px = Math.floor((this.w - pw) / 2);
    const py = this.portrait ? 60 : 24;
    drawPanel(r, { x: px, y: py, w: pw, h: this.portrait ? 132 : 122 }, 'SEED');
    const shown = this.seedText || 'RANDOM';
    const blink = Math.floor(this.time * 2) % 2 === 0 ? '_' : ' ';
    r.rect(px + 8, py + 12, pw - 16, 13, P.INK);
    r.text(`${shown}${this.seedText ? blink : ''}`, px + pw / 2, py + 15, { color: this.seedText ? P.BRASS_LIT : P.PEWTER, align: 'center' });
    this.overlayButtons.draw(r, this.keyboardFocus);
    r.text('SAME SEED + SAME CHOICES = SAME NIGHT', px + pw / 2, py + (this.portrait ? 122 : 112), { color: P.STONE, align: 'center' });
  }

  private drawExitOverlay(r: Renderer): void {
    r.dither(0, 0, this.w, this.h, P.INK, 13);
    const cx = Math.floor(this.w / 2);
    const cy = Math.floor(this.h / 2);
    r.text('THANKS FOR PLAYING', cx, cy - 26, { color: P.CHALK, align: 'center', font: 5, scale: 1 });
    r.text('You can close this tab now.', cx, cy - 12, { color: P.MIST, align: 'center' });
    r.text('The board will be here when you get back.', cx, cy - 3, { color: P.PEWTER, align: 'center' });
    this.overlayButtons.draw(r, this.keyboardFocus);
  }
}

export function ocheLabel(id: OcheId): string {
  return OCHE_BY_ID[id].name;
}

export { drawRow, measureText };
