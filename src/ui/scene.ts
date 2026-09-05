/**
 * Scenes and transitions. A scene owns its input handling and drawing; the
 * manager runs one scene at a time with an ordered-dither wipe between them.
 */
import { P } from '../art/palette';
import type { Renderer } from './draw';
import type { InputHandler } from './input';
import { clamp01 } from './tween';

export interface Scene extends InputHandler {
  enter?(): void;
  exit?(): void;
  update(dt: number): void;
  draw(r: Renderer): void;
  /** Called when the orientation / internal size changes. */
  resize?(): void;
}

export class SceneManager {
  current: Scene | null = null;
  private next: Scene | null = null;
  private wipe = 0; // 0..1 out, then in
  private wipeDir: 0 | 1 | -1 = 0;
  private wipeSpeed = 6;

  go(scene: Scene, instant = false): void {
    if (instant || !this.current) {
      this.current?.exit?.();
      this.current = scene;
      scene.enter?.();
      this.wipeDir = -1;
      this.wipe = instant ? 0 : 1;
      return;
    }
    this.next = scene;
    this.wipeDir = 1;
  }

  update(dt: number): void {
    if (this.wipeDir === 1) {
      this.wipe = clamp01(this.wipe + dt * this.wipeSpeed);
      if (this.wipe >= 1 && this.next) {
        this.current?.exit?.();
        this.current = this.next;
        this.next = null;
        this.current.enter?.();
        this.wipeDir = -1;
      }
    } else if (this.wipeDir === -1) {
      this.wipe = clamp01(this.wipe - dt * this.wipeSpeed);
      if (this.wipe <= 0) this.wipeDir = 0;
    }
    this.current?.update(dt);
  }

  draw(r: Renderer): void {
    this.current?.draw(r);
    if (this.wipe > 0) r.dither(0, 0, r.width, r.height, P.INK, this.wipe * 16);
  }

  get transitioning(): boolean {
    return this.wipeDir !== 0;
  }

  handler(): InputHandler {
    return {
      onDown: (p) => {
        if (!this.transitioning) this.current?.onDown?.(p);
      },
      onMove: (p) => this.current?.onMove?.(p),
      onUp: (p) => this.current?.onUp?.(p),
      onCancel: (p) => this.current?.onCancel?.(p),
      onKey: (k, e) => {
        if (!this.transitioning) this.current?.onKey?.(k, e);
      },
      onWheel: (d) => this.current?.onWheel?.(d),
    };
  }
}
