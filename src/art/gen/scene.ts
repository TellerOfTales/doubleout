/**
 * The pub: carpet, wall panelling, light cone, vignette and the crowd.
 * All noise comes from hash2 with a fixed seed per texture.
 */
import { P, createPixmap, px, type Pixmap } from '../palette.ts';
import { ditherOn, ditherQuantise, fromAscii, hLine, hash2, sheet } from './draw.ts';

/** 320×48: pub carpet — 2px noise dither in deep/shade/stone, a claret diamond motif, brass oche line at y=40. Tiles horizontally. */
export function genOcheFloor(): Pixmap {
  const W = 320;
  const H = 48;
  const p = createPixmap(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const h = hash2(x >> 1, y >> 1, 0xf100);
      // weighted: mostly deep, some shade, a rare stone fleck
      let v: number = h < 0.72 ? P.DEEP : h < 0.97 ? P.SHADE : P.STONE;
      // diamond motif on a 16×8 lattice (period 16 divides 320)
      const mx = ((x % 16) + 16) % 16;
      const my = y % 8;
      const cx = (Math.floor(y / 8) % 2 === 0 ? 4 : 12);
      const d = Math.abs(mx - cx) + Math.abs(my - 4);
      const d2 = Math.abs(mx - cx - 16) + Math.abs(my - 4);
      // A sparse claret diamond: the motif should read as a pattern, not as confetti.
      if (d === 0 || d2 === 0) v = P.CLARET;
      else if (d === 1 || d2 === 1) v = hash2(x, y, 0xf101) < 0.45 ? P.CLARET : v;
      p.data[y * W + x] = v;
    }
  }
  // oche line and its shadow
  hLine(p, 0, W - 1, 40, P.BRASS);
  hLine(p, 0, W - 1, 41, P.INK);
  return p;
}

/** 320×132: dark wood panelling, 16px planks, ink seams, knots, a stone dado rail at y=100. */
export function genWall(): Pixmap {
  const W = 320;
  const H = 132;
  const RAIL = 100;
  const p = createPixmap(W, H, P.DEEP);
  for (let x = 0; x < W; x++) {
    const plank = Math.floor(x / 16);
    const inPlank = x % 16;
    const grainA = 3 + Math.floor(hash2(plank, 1, 0x3a11) * 4); // 3..6
    const grainB = 9 + Math.floor(hash2(plank, 2, 0x3a11) * 5); // 9..13
    for (let y = 0; y < H; y++) {
      const lower = y > RAIL + 2;
      let v: number = lower ? P.SHADE : P.DEEP;
      const grain = lower ? P.DEEP : P.SHADE;
      if (inPlank === 0) v = P.INK; // seam
      else if (inPlank === grainA || inPlank === grainB) {
        // broken grain line, sparse
        if (hash2(plank, y >> 4, 0x3a12 + inPlank) < 0.45) v = grain;
      }
      p.data[y * W + x] = v;
    }
    // knot on some planks
    if (inPlank === 8 && hash2(plank, 7, 0x3a14) < 0.22) {
      const ky = 8 + Math.floor(hash2(plank, 8, 0x3a14) * (RAIL - 20));
      const kc = lowerKnot(ky, RAIL);
      px(p, x - 1, ky, P.INK);
      px(p, x, ky - 1, P.INK);
      px(p, x + 1, ky, P.INK);
      px(p, x, ky + 1, P.INK);
      px(p, x - 2, ky, kc);
      px(p, x + 2, ky, kc);
      px(p, x, ky, kc);
    }
  }
  // dado rail: highlight, stone body, shadow
  hLine(p, 0, W - 1, RAIL - 1, P.PEWTER);
  hLine(p, 0, W - 1, RAIL, P.STONE);
  hLine(p, 0, W - 1, RAIL + 1, P.STONE);
  hLine(p, 0, W - 1, RAIL + 2, P.INK);
  // skirting at the bottom so the floor has something to sit on
  hLine(p, 0, W - 1, H - 2, P.STONE);
  hLine(p, 0, W - 1, H - 1, P.INK);
  return p;
}

function lowerKnot(y: number, rail: number): number {
  return y > rail ? P.DEEP : P.SHADE;
}

/** 64×80: a cone of light from the top centre, Bayer-dithered into stone/pewter/mist over transparent. */
export function genLightCone(): Pixmap {
  const W = 64;
  const H = 80;
  const p = createPixmap(W, H);
  const levels = [255, P.STONE, P.PEWTER, P.MIST];
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const halfW = 5 + t * 27;
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2;
      if (Math.abs(dx) > halfW) continue;
      const radial = Math.max(0, 1 - Math.sqrt(dx * dx + y * y) / 96);
      const edge = 1 - Math.pow(Math.abs(dx) / halfW, 2);
      const b = radial * radial * edge;
      const q = ditherQuantise(x, y, b * 3.4, 3);
      if (q > 0) p.data[y * W + x] = levels[q];
    }
  }
  return p;
}

/** 320×180: transparent centre, edges darkening to ink over the outer ~36px, corners darkest. */
export function genVignette(): Pixmap {
  const W = 320;
  const H = 180;
  const p = createPixmap(W, H);
  const R = 30;
  // Deliberately gentle: the vignette should suggest a dim room, not speckle the
  // chrome. The top 13 rows (chrome) and bottom 21 (commentary) are left alone.
  for (let y = 13; y < H - 21; y++) {
    for (let x = 0; x < W; x++) {
      const ex = Math.min(x, W - 1 - x);
      const ey = Math.min(y - 13, H - 22 - y);
      const tx = Math.max(0, 1 - ex / R);
      const ty = Math.max(0, 1 - ey / R);
      const t = 1 - (1 - tx) * (1 - ty);
      const v = t * t * 0.38;
      if (ditherOn(x, y, v)) p.data[y * W + x] = P.INK;
    }
  }
  return p;
}

/** 8×8 × 6 head-and-shoulders silhouettes in shade (the runtime recolours P.SHADE). */
export function genCrowdHead(): Pixmap {
  const heads: string[][] = [
    // round
    ['...kk...', '..kkkk..', '..kkkk..', '..kkkk..', '...kk...', '.kkkkkk.', 'kkkkkkkk', 'kkkkkkkk'],
    // tall
    ['...kk...', '..kkkk..', '..kkkk..', '..kkkk..', '..kkkk..', '...kk...', '.kkkkkk.', 'kkkkkkkk'],
    // hat
    ['..kkkk..', '.kkkkkk.', 'kkkkkkkk', '..kkkk..', '..kkkk..', '...kk...', '.kkkkkk.', 'kkkkkkkk'],
    // big hair
    ['.kkkkkk.', 'kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk', '.kkkkkk.', '...kk...', '.kkkkkk.', 'kkkkkkkk'],
    // cap
    ['..kkkkk.', '.kkkkkkk', '..kkkk..', '..kkkk..', '..kkkk..', '...kk...', '.kkkkkk.', 'kkkkkkkk'],
    // ponytail
    ['..kkkk..', '.kkkkkk.', '.kkkkkkk', '..kkkkk.', '..kkkk.k', '...kk...', '.kkkkkk.', 'kkkkkkkk'],
  ];
  return sheet(8, 8, 6, (f, i) => {
    const art = fromAscii(heads[i]);
    for (let k = 0; k < art.data.length; k++) f.data[k] = art.data[k];
  });
}
