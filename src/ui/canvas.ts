/**
 * The screen: a fixed internal resolution (320×180 landscape or 180×320
 * portrait) blitted to the page canvas at an integer scale with
 * nearest-neighbour filtering and black letterboxing (TDD §11.2).
 */
export const LANDSCAPE_W = 320;
export const LANDSCAPE_H = 180;

export type Orientation = 'landscape' | 'portrait';

export class Screen {
  readonly page: HTMLCanvasElement;
  readonly pageCtx: CanvasRenderingContext2D;
  readonly buffer: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  width = LANDSCAPE_W;
  height = LANDSCAPE_H;
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  orientation: Orientation = 'landscape';
  /** Force an orientation regardless of the window shape (settings). */
  forced: Orientation | null = null;
  onResize: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.page = document.createElement('canvas');
    this.page.tabIndex = 0;
    this.page.setAttribute('aria-label', 'DOUBLE OUT game');
    this.page.style.cursor = 'default';
    parent.appendChild(this.page);
    this.pageCtx = this.page.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.buffer = document.createElement('canvas');
    this.ctx = this.buffer.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    window.addEventListener('resize', () => this.fit());
    window.addEventListener('orientationchange', () => setTimeout(() => this.fit(), 50));
    this.fit();
  }

  fit(): void {
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    const wanted: Orientation = this.forced ?? (wh > ww ? 'portrait' : 'landscape');
    const changed = wanted !== this.orientation || this.buffer.width !== this.width;
    this.orientation = wanted;
    if (wanted === 'portrait') {
      this.width = LANDSCAPE_H;
      this.height = LANDSCAPE_W;
    } else {
      this.width = LANDSCAPE_W;
      this.height = LANDSCAPE_H;
    }
    this.buffer.width = this.width;
    this.buffer.height = this.height;
    this.ctx.imageSmoothingEnabled = false;
    // Integer scale only; ×1 minimum. Never stretch, never fractional.
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const sx = Math.floor((ww * dpr) / this.width);
    const sy = Math.floor((wh * dpr) / this.height);
    this.scale = Math.max(1, Math.min(sx, sy));
    const pw = this.width * this.scale;
    const ph = this.height * this.scale;
    this.page.width = pw;
    this.page.height = ph;
    this.page.style.width = `${pw / dpr}px`;
    this.page.style.height = `${ph / dpr}px`;
    this.pageCtx.imageSmoothingEnabled = false;
    const rect = this.page.getBoundingClientRect();
    this.offsetX = rect.left;
    this.offsetY = rect.top;
    if (changed && this.onResize) this.onResize();
  }

  /** Map a client (CSS pixel) coordinate to internal pixels. */
  toInternal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.page.getBoundingClientRect();
    const cssScale = rect.width / this.width;
    return { x: (clientX - rect.left) / cssScale, y: (clientY - rect.top) / cssScale };
  }

  /** Blit the internal buffer to the page canvas. */
  present(): void {
    this.pageCtx.imageSmoothingEnabled = false;
    this.pageCtx.drawImage(this.buffer, 0, 0, this.width, this.height, 0, 0, this.page.width, this.page.height);
  }
}
