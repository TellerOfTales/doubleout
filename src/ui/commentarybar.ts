/**
 * The commentary bar: BARREL and NOCK, typed out one character at a time
 * with procedural voice blips. Higher-priority barks interrupt.
 */
import { P } from '../art/palette';
import { measureText } from '../art/sprites';
import type { Bark } from '../core/commentary';
import type { Renderer } from './draw';
import type { Rect } from './layout';

interface Active {
  bark: Bark;
  shown: number; // characters revealed
  timer: number; // seconds until next char / until dismissal
  done: boolean;
  hold: number;
}

export class CommentaryBar {
  private queue: Bark[] = [];
  private active: Active | null = null;
  /** Blip callback: returns ms until the next character. */
  blip: (speaker: 'BARREL' | 'NOCK', ch: string) => number = () => 30;
  /** Bark history for the tutorial / debugging. */
  history: Bark[] = [];
  enabled = true;
  /** Lines of text available (2 in landscape, 4 in portrait). */
  lines = 2;

  say(barks: Bark[]): void {
    if (!this.enabled) return;
    for (const b of barks) {
      // Interrupt a lower-priority bark that has finished typing; otherwise queue.
      if (this.active && !this.active.done && b.priority > this.active.bark.priority + 15) {
        this.queue.unshift(b);
        this.active = null;
        continue;
      }
      this.queue.push(b);
    }
    if (this.queue.length > 4) this.queue.splice(0, this.queue.length - 4);
  }

  clear(): void {
    this.queue = [];
    this.active = null;
  }

  get speaking(): boolean {
    return !!this.active && !this.active.done;
  }

  get idle(): boolean {
    return !this.active && this.queue.length === 0;
  }

  update(dt: number): void {
    if (!this.active) {
      const next = this.queue.shift();
      if (!next) return;
      this.active = { bark: next, shown: 0, timer: 0.15, done: false, hold: 2.2 + next.text.length * 0.03 };
      this.history.push(next);
      if (this.history.length > 40) this.history.shift();
    }
    const a = this.active;
    a.timer -= dt;
    if (!a.done) {
      while (a.timer <= 0 && !a.done) {
        const ch = a.bark.text[a.shown];
        a.shown++;
        if (a.shown >= a.bark.text.length) {
          a.done = true;
          a.timer = a.hold;
          break;
        }
        a.timer += this.blip(a.bark.speaker, ch) / 1000;
      }
    } else if (a.timer <= 0) {
      // Leave the last line up if nothing else is waiting; otherwise advance.
      if (this.queue.length > 0) this.active = null;
    }
  }

  /** Skip the typing of the current bark (tap on the bar). */
  skip(): void {
    const a = this.active;
    if (!a) return;
    if (!a.done) {
      a.shown = a.bark.text.length;
      a.done = true;
      a.timer = a.hold;
    } else if (this.queue.length > 0) {
      this.active = null;
    }
  }

  draw(r: Renderer, rect: Rect): void {
    r.rect(rect.x, rect.y, rect.w, rect.h, P.DEEP);
    r.rect(rect.x, rect.y, rect.w, 1, P.STONE);
    // chalk dust noise on the slate
    for (let i = 0; i < rect.w; i += 7) r.pixel(rect.x + ((i * 13) % rect.w), rect.y + 2 + ((i * 7) % (rect.h - 4)), P.SHADE);
    const a = this.active;
    if (!a) return;
    const speaker = a.bark.speaker;
    const tag = `${speaker}:`;
    const tagColor = speaker === 'BARREL' ? P.CLARET_LIT : P.SKY_LIT;
    const x = rect.x + 4;
    const y = rect.y + 3;
    const maxW = rect.w - 8;
    const text = a.bark.text.slice(0, a.shown);
    // Wrap the full text so the layout does not jump while typing, then reveal.
    const full = a.bark.text;
    const tagW = measureText(5, tag) + 4;
    const lines = wrapWithIndent(r, full, maxW, tagW);
    let revealed = 0;
    r.text(tag, x, y, { color: tagColor });
    for (let i = 0; i < lines.length && i < this.lines; i++) {
      const line = lines[i];
      const take = Math.max(0, Math.min(line.length, text.length - revealed));
      const part = line.slice(0, take);
      r.text(part, x + (i === 0 ? tagW : 0), y + i * 9, { color: P.CHALK });
      revealed += line.length + 1; // +1 for the space swallowed by the wrap
      if (revealed > text.length) break;
    }
    if (a.done && this.queue.length > 0) {
      const blink = Math.floor(performance.now() / 400) % 2 === 0;
      if (blink) r.sprite('icons', rect.x + rect.w - 10, rect.y + rect.h - 9, 19);
    }
  }
}

function wrapWithIndent(r: Renderer, text: string, maxW: number, firstIndent: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  let limit = maxW - firstIndent;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (measureText(5, test) <= limit || !line) line = test;
    else {
      lines.push(line);
      line = w;
      limit = maxW;
    }
  }
  lines.push(line);
  return lines;
}
