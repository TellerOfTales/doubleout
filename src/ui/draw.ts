/**
 * Renderer primitives over the internal buffer. Everything draws at integer
 * coordinates; no alpha blending — fades are ordered dithers so every pixel
 * on screen stays inside the 16-colour palette.
 */
import { BAYER4, P, PALETTE_HEX } from '../art/palette';
import { fontHeight, glyphAdvance, measureText, type FontId, type Sprites } from '../art/sprites';

export interface TextOpts {
  font?: FontId;
  color?: number;
  scale?: number;
  align?: 'left' | 'center' | 'right';
  /** Drop shadow colour (drawn at +1,+1 × scale). */
  shadow?: number;
  /** Outline colour (drawn at the 4 neighbours). */
  outline?: number;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  ox = 0;
  oy = 0;
  private ditherPatterns = new Map<string, CanvasPattern>();

  constructor(
    ctx: CanvasRenderingContext2D,
    public sprites: Sprites,
    public width: number,
    public height: number,
  ) {
    this.ctx = ctx;
  }

  setContext(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.ctx = ctx;
    this.width = w;
    this.height = h;
    this.ditherPatterns.clear();
  }

  clear(color: number = P.INK): void {
    this.ctx.fillStyle = PALETTE_HEX[color];
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = PALETTE_HEX[color & 15];
    this.ctx.fillRect(Math.round(x + this.ox), Math.round(y + this.oy), Math.round(w), Math.round(h));
  }

  rectOutline(x: number, y: number, w: number, h: number, color: number): void {
    this.rect(x, y, w, 1, color);
    this.rect(x, y + h - 1, w, 1, color);
    this.rect(x, y, 1, h, color);
    this.rect(x + w - 1, y, 1, h, color);
  }

  /** Rounded (2px corner) filled rect with outline. */
  panel(x: number, y: number, w: number, h: number, fill: number, outline: number): void {
    this.rect(x + 1, y, w - 2, h, fill);
    this.rect(x, y + 1, w, h - 2, fill);
    this.rect(x + 2, y, w - 4, 1, outline);
    this.rect(x + 2, y + h - 1, w - 4, 1, outline);
    this.rect(x, y + 2, 1, h - 4, outline);
    this.rect(x + w - 1, y + 2, 1, h - 4, outline);
    this.rect(x + 1, y + 1, 1, 1, outline);
    this.rect(x + w - 2, y + 1, 1, 1, outline);
    this.rect(x + 1, y + h - 2, 1, 1, outline);
    this.rect(x + w - 2, y + h - 2, 1, 1, outline);
  }

  pixel(x: number, y: number, color: number): void {
    this.rect(x, y, 1, 1, color);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 4096; i++) {
      this.pixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  circle(cx: number, cy: number, r: number, color: number, fill = false): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = x * x + y * y;
        if (fill ? d <= r * r + r : Math.abs(Math.sqrt(d) - r) < 0.6) this.pixel(cx + x, cy + y, color);
      }
    }
  }

  private pattern(color: number, level: number): CanvasPattern {
    const key = `${color}|${level}`;
    let p = this.ditherPatterns.get(key);
    if (p) return p;
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const cx = c.getContext('2d') as CanvasRenderingContext2D;
    cx.fillStyle = PALETTE_HEX[color & 15];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < level) cx.fillRect(x, y, 1, 1);
    p = this.ctx.createPattern(c, 'repeat') as CanvasPattern;
    this.ditherPatterns.set(key, p);
    return p;
  }

  /**
   * Ordered-dither fill: level 0 = nothing, 16 = solid. Used for fades,
   * flashes and shadows so no off-palette colour ever appears.
   */
  dither(x: number, y: number, w: number, h: number, color: number, level: number): void {
    level = Math.round(level);
    if (level <= 0 || w <= 0 || h <= 0) return;
    if (level >= 16) {
      this.rect(x, y, w, h, color);
      return;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.fillStyle = this.pattern(color, level);
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    ctx.restore();
  }

  private missing = new Set<string>();

  private fallback(name: string, x: number, y: number, w: number, h: number): void {
    if (!this.missing.has(name)) {
      this.missing.add(name);
      console.warn(`missing sprite: ${name}`);
    }
    this.rectOutline(x, y, w, h, P.CLARET_LIT);
  }

  sprite(name: string, x: number, y: number, frame = 0): void {
    if (!this.sprites.has(name)) return this.fallback(name, x, y, 8, 8);
    const s = this.sprites.get(name);
    const f = Math.max(0, Math.min(s.frames - 1, frame | 0));
    this.ctx.drawImage(
      s.canvas,
      f * s.frameW,
      0,
      s.frameW,
      s.frameH,
      Math.round(x + this.ox),
      Math.round(y + this.oy),
      s.frameW,
      s.frameH,
    );
  }

  /** Draw an arbitrary canvas (e.g. a tinted variant) whole or a frame of it. */
  canvas(c: HTMLCanvasElement, x: number, y: number, frameW?: number, frameH?: number, frame = 0): void {
    const fw = frameW ?? c.width;
    const fh = frameH ?? c.height;
    this.ctx.drawImage(c, frame * fw, 0, fw, fh, Math.round(x + this.ox), Math.round(y + this.oy), fw, fh);
  }

  /** Draw a sprite frame scaled by an integer factor. */
  spriteScaled(name: string, x: number, y: number, scale: number, frame = 0): void {
    if (!this.sprites.has(name)) return this.fallback(name, x, y, 8 * scale, 8 * scale);
    const s = this.sprites.get(name);
    const f = Math.max(0, Math.min(s.frames - 1, frame | 0));
    this.ctx.drawImage(
      s.canvas,
      f * s.frameW,
      0,
      s.frameW,
      s.frameH,
      Math.round(x + this.ox),
      Math.round(y + this.oy),
      s.frameW * scale,
      s.frameH * scale,
    );
  }

  /** Draw a sprite frame flipped/rotated by quarter turns (for portrait pieces). */
  spriteRot(name: string, x: number, y: number, quarterTurns: number, frame = 0): void {
    if (!this.sprites.has(name)) return this.fallback(name, x, y, 8, 8);
    const s = this.sprites.get(name);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(Math.round(x + this.ox), Math.round(y + this.oy));
    ctx.rotate((Math.PI / 2) * quarterTurns);
    ctx.drawImage(s.canvas, frame * s.frameW, 0, s.frameW, s.frameH, 0, 0, s.frameW, s.frameH);
    ctx.restore();
  }

  nineSlice(name: string, x: number, y: number, w: number, h: number, frame = 0): void {
    if (!this.sprites.has(name)) {
      this.rect(x, y, w, h, frame === 2 ? P.SHADE : frame === 1 ? P.PEWTER : P.STONE);
      this.rectOutline(x, y, w, h, P.INK);
      return;
    }
    const s = this.sprites.get(name);
    const ns = s.nineSlice ?? { l: 4, t: 4, r: 4, b: 4 };
    const sx = frame * s.frameW;
    const fw = s.frameW;
    const fh = s.frameH;
    x = Math.round(x + this.ox);
    y = Math.round(y + this.oy);
    w = Math.round(w);
    h = Math.round(h);
    const ctx = this.ctx;
    const c = s.canvas;
    const mw = fw - ns.l - ns.r;
    const mh = fh - ns.t - ns.b;
    const iw = Math.max(0, w - ns.l - ns.r);
    const ih = Math.max(0, h - ns.t - ns.b);
    // corners
    ctx.drawImage(c, sx, 0, ns.l, ns.t, x, y, ns.l, ns.t);
    ctx.drawImage(c, sx + fw - ns.r, 0, ns.r, ns.t, x + w - ns.r, y, ns.r, ns.t);
    ctx.drawImage(c, sx, fh - ns.b, ns.l, ns.b, x, y + h - ns.b, ns.l, ns.b);
    ctx.drawImage(c, sx + fw - ns.r, fh - ns.b, ns.r, ns.b, x + w - ns.r, y + h - ns.b, ns.r, ns.b);
    // edges
    if (iw > 0) {
      ctx.drawImage(c, sx + ns.l, 0, mw, ns.t, x + ns.l, y, iw, ns.t);
      ctx.drawImage(c, sx + ns.l, fh - ns.b, mw, ns.b, x + ns.l, y + h - ns.b, iw, ns.b);
    }
    if (ih > 0) {
      ctx.drawImage(c, sx, ns.t, ns.l, mh, x, y + ns.t, ns.l, ih);
      ctx.drawImage(c, sx + fw - ns.r, ns.t, ns.r, mh, x + w - ns.r, y + ns.t, ns.r, ih);
    }
    if (iw > 0 && ih > 0) ctx.drawImage(c, sx + ns.l, ns.t, mw, mh, x + ns.l, y + ns.t, iw, ih);
  }

  /** Draw text. Returns the drawn width. */
  text(str: string, x: number, y: number, opts: TextOpts = {}): number {
    const font = opts.font ?? 5;
    const color = opts.color ?? P.CHALK;
    const scale = opts.scale ?? 1;
    const adv = glyphAdvance(font) * scale;
    const w = measureText(font, str) * scale;
    let sx = Math.round(x + this.ox);
    if (opts.align === 'center') sx -= Math.floor(w / 2);
    else if (opts.align === 'right') sx -= w;
    const sy = Math.round(y + this.oy);
    const gw = (font === 5 ? 5 : 9) * scale;
    const gh = fontHeight(font) * scale;
    const ctx = this.ctx;
    const drawRun = (col: number, dx: number, dy: number) => {
      let cx = sx + dx;
      for (const ch of str) {
        if (ch !== ' ') {
          const g = this.sprites.glyph(font, ch, col);
          ctx.drawImage(g, cx, sy + dy, gw, gh);
        }
        cx += adv;
      }
    };
    if (opts.outline !== undefined) {
      drawRun(opts.outline, scale, 0);
      drawRun(opts.outline, -scale, 0);
      drawRun(opts.outline, 0, scale);
      drawRun(opts.outline, 0, -scale);
    }
    if (opts.shadow !== undefined) drawRun(opts.shadow, scale, scale);
    drawRun(color, 0, 0);
    return w;
  }

  /** Word-wrap text into lines of at most maxWidth pixels. */
  wrap(str: string, maxWidth: number, font: FontId = 5, scale = 1): string[] {
    const lines: string[] = [];
    for (const para of str.split('\n')) {
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (measureText(font, test) * scale <= maxWidth || !line) line = test;
        else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** Draw wrapped text; returns number of lines drawn. */
  textWrap(str: string, x: number, y: number, maxWidth: number, opts: TextOpts = {}, lineGap = 2): number {
    const font = opts.font ?? 5;
    const scale = opts.scale ?? 1;
    const lines = this.wrap(str, maxWidth, font, scale);
    const lh = fontHeight(font) * scale + lineGap;
    lines.forEach((l, i) => this.text(l, x, y + i * lh, opts));
    return lines.length;
  }

  clip(x: number, y: number, w: number, h: number, fn: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(x + this.ox), Math.round(y + this.oy), Math.round(w), Math.round(h));
    ctx.clip();
    fn();
    ctx.restore();
  }

  /** Temporarily offset all drawing (camera shake, panel slides). */
  offset(dx: number, dy: number, fn: () => void): void {
    const ox = this.ox;
    const oy = this.oy;
    this.ox += Math.round(dx);
    this.oy += Math.round(dy);
    fn();
    this.ox = ox;
    this.oy = oy;
  }
}
