/**
 * Pointer + keyboard input in internal pixel coordinates. Touch, mouse and
 * pen all arrive as pointer events. The active scene receives callbacks.
 */
import type { Screen } from './canvas';

export interface Pointer {
  x: number;
  y: number;
  /** Milliseconds (performance.now()). */
  t: number;
  id: number;
}

export interface InputHandler {
  onDown?(p: Pointer): void;
  onMove?(p: Pointer): void;
  onUp?(p: Pointer): void;
  onCancel?(p: Pointer): void;
  onKey?(key: string, e: KeyboardEvent): void;
  onWheel?(dy: number): void;
}

export class Input {
  handler: InputHandler | null = null;
  /** Fires on the very first user gesture (to unlock audio). */
  onFirstGesture: (() => void) | null = null;
  private gestureSeen = false;
  private activeId: number | null = null;
  /** Last known pointer position (for hover). */
  hover: { x: number; y: number } | null = null;
  isTouch = false;
  /** Milliseconds since last user input; drives idle commentary. */
  lastActivity = performance.now();

  constructor(private screen: Screen) {
    const el = screen.page;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.gesture();
      this.isTouch = e.pointerType === 'touch';
      if (this.activeId !== null) return; // single-pointer game
      this.activeId = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const p = this.map(e);
      this.hover = { x: p.x, y: p.y };
      this.handler?.onDown?.(p);
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.map(e);
      this.hover = { x: p.x, y: p.y };
      if (this.activeId !== null && e.pointerId !== this.activeId) return;
      if (this.activeId !== null) this.lastActivity = performance.now();
      this.handler?.onMove?.(p);
    });
    const up = (e: PointerEvent, cancel: boolean) => {
      if (e.pointerId !== this.activeId) return;
      this.activeId = null;
      const p = this.map(e);
      this.lastActivity = performance.now();
      if (cancel) this.handler?.onCancel?.(p);
      else this.handler?.onUp?.(p);
    };
    el.addEventListener('pointerup', (e) => up(e, false));
    el.addEventListener('pointercancel', (e) => up(e, true));
    el.addEventListener('lostpointercapture', (e) => {
      if (e.pointerId === this.activeId) up(e, true);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.handler?.onWheel?.(Math.sign(e.deltaY));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.gesture();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
      this.handler?.onKey?.(e.key, e);
    });
    el.focus();
  }

  private gesture(): void {
    this.lastActivity = performance.now();
    if (this.gestureSeen) return;
    this.gestureSeen = true;
    this.onFirstGesture?.();
  }

  private map(e: PointerEvent): Pointer {
    const { x, y } = this.screen.toInternal(e.clientX, e.clientY);
    return { x, y, t: performance.now(), id: e.pointerId };
  }

  get idleSeconds(): number {
    return (performance.now() - this.lastActivity) / 1000;
  }

  touchActivity(): void {
    this.lastActivity = performance.now();
  }
}

export function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}
