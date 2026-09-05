/**
 * Settings: sound, voice, crowd, checkout hint, tap-to-throw, shake,
 * flashes, orientation, volume, reset. Persisted via Save.
 */
import { P } from '../../art/palette';
import type { App } from '../app';
import type { Renderer } from '../draw';
import type { Pointer } from '../input';
import type { Scene } from '../scene';
import { ButtonSet, drawPanel } from '../widgets';

export class SettingsScreen implements Scene {
  buttons = new ButtonSet();
  keyboardFocus = false;
  w = 320;
  h = 180;
  confirmReset = false;

  constructor(
    public app: App,
    private back: () => void,
  ) {}

  get portrait(): boolean {
    return this.app.screen.orientation === 'portrait';
  }

  enter(): void {
    this.resize();
  }

  resize(): void {
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    this.build();
  }

  private build(): void {
    const s = this.app.save.data.settings;
    const b = this.buttons;
    const prevFocus = b.focus;
    b.clear();
    const bw = this.portrait ? 150 : 126;
    const colGap = 12;
    const x0 = this.portrait ? Math.floor((this.w - bw) / 2) : Math.floor((this.w - (bw * 2 + colGap)) / 2);
    const y0 = this.portrait ? 24 : 22;
    const rowH = 19;
    const items: { id: string; label: string; onPress: () => void; primary?: boolean }[] = [
      { id: 'sound', label: `SOUND: ${s.sound ? 'ON' : 'OFF'}`, onPress: () => { s.sound = !s.sound; } },
      { id: 'voice', label: `VOICE BLIPS: ${s.voice ? 'ON' : 'OFF'}`, onPress: () => { s.voice = !s.voice; } },
      { id: 'crowd', label: `CROWD: ${s.crowd ? 'ON' : 'OFF'}`, onPress: () => { s.crowd = !s.crowd; } },
      { id: 'volume', label: `VOLUME: ${Math.round(s.volume * 10)}`, onPress: () => { s.volume = s.volume >= 0.99 ? 0.1 : Math.min(1, s.volume + 0.1); } },
      { id: 'hint', label: `CHECKOUT HINT: ${s.checkoutHint ? 'ON' : 'OFF'}`, onPress: () => { s.checkoutHint = !s.checkoutHint; } },
      { id: 'tap', label: `TAP TO THROW: ${s.tapToThrow ? 'ON' : 'OFF'}`, onPress: () => { s.tapToThrow = !s.tapToThrow; } },
      { id: 'shake', label: `SCREEN SHAKE: ${s.screenShake ? 'ON' : 'OFF'}`, onPress: () => { s.screenShake = !s.screenShake; } },
      { id: 'flash', label: `FLASHES: ${s.flashes ? 'ON' : 'OFF'}`, onPress: () => { s.flashes = !s.flashes; } },
      { id: 'orient', label: `SCREEN: ${['AUTO', 'LANDSCAPE', 'PORTRAIT'][s.orientation]}`, onPress: () => { s.orientation = ((s.orientation + 1) % 3) as 0 | 1 | 2; } },
      { id: 'reset', label: this.confirmReset ? 'REALLY RESET? YES' : 'RESET SAVE DATA', onPress: () => this.reset() },
    ];
    items.forEach((it, i) => {
      const col = this.portrait ? 0 : i % 2;
      const row = this.portrait ? i : Math.floor(i / 2);
      b.add({
        id: it.id,
        rect: { x: x0 + col * (bw + colGap), y: y0 + row * rowH, w: bw, h: 16 },
        label: it.label,
        onPress: () => {
          it.onPress();
          this.app.sfx('ui_confirm');
          this.app.save.persist();
          this.app.applySettings();
          this.build();
        },
      });
    });
    const rows = this.portrait ? items.length : Math.ceil(items.length / 2);
    b.add({
      id: 'back',
      rect: { x: Math.floor((this.w - 96) / 2), y: y0 + rows * rowH + 6, w: 96, h: 16 },
      label: 'BACK',
      primary: true,
      onPress: () => {
        this.app.sfx('ui_back');
        this.back();
      },
    });
    b.focus = prevFocus >= 0 && prevFocus < b.buttons.length ? prevFocus : b.buttons.length - 1;
  }

  private reset(): void {
    if (!this.confirmReset) {
      this.confirmReset = true;
      return;
    }
    this.confirmReset = false;
    this.app.save.reset();
    this.app.chosenOche = 'local';
    this.app.applySettings();
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
    if (key === 'Escape') {
      this.back();
      return;
    }
    if (this.buttons.key(key)) this.keyboardFocus = true;
  }

  update(): void {}

  draw(r: Renderer): void {
    r.clear(P.DEEP);
    if (this.portrait) {
      r.sprite('wall', -70, 0);
      r.sprite('wall', -70, 132);
    } else r.sprite('wall', 0, 0);
    r.dither(0, 0, this.w, this.h, P.INK, 6);
    const pw = this.portrait ? 166 : 290;
    const ph = this.portrait ? 236 : 132;
    drawPanel(r, { x: Math.floor((this.w - pw) / 2), y: this.portrait ? 12 : 12, w: pw, h: ph }, 'SETTINGS');
    this.buttons.draw(r, this.keyboardFocus);
    const hint = 'KEYS: 1-4 PICK A CARD · ENTER THROWS · M MISSES ON PURPOSE · H TOGGLES THE HINT · ESC PAUSES';
    r.textWrap(hint, Math.floor((this.w - pw) / 2) + 8, this.portrait ? 12 + ph - 20 : 12 + ph - 12, pw - 16, { color: P.STONE });
  }
}
