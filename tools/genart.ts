/**
 * Write every generated asset to assets/generated/<name>.png plus a
 * manifest.json (TDD §11.1). Deterministic: running twice yields
 * byte-identical files.
 *
 *   node --experimental-strip-types tools/genart.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import { generateAll, type GeneratedAsset } from '../src/art/gen/index.ts';
import { PALETTE_RGB, TRANSPARENT, assertPalette, type Pixmap } from '../src/art/palette.ts';

const { PNG } = pngjs;
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.join(HERE, '..', 'assets', 'generated');

/** Palette indices → RGBA PNG bytes (TRANSPARENT → alpha 0). */
export function pixmapToPng(p: Pixmap): Buffer {
  const png = new PNG({ width: p.w, height: p.h, colorType: 6 });
  for (let i = 0; i < p.data.length; i++) {
    const v = p.data[i];
    const o = i * 4;
    if (v === TRANSPARENT) {
      png.data[o] = 0;
      png.data[o + 1] = 0;
      png.data[o + 2] = 0;
      png.data[o + 3] = 0;
    } else {
      const [r, g, b] = PALETTE_RGB[v];
      png.data[o] = r;
      png.data[o + 1] = g;
      png.data[o + 2] = b;
      png.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(png, { colorType: 6 });
}

export interface ManifestEntry {
  frameH: number;
  frameW: number;
  frames: number;
  h: number;
  name: string;
  nineSlice: { b: number; l: number; r: number; t: number } | null;
  sha256: string;
  w: number;
}

export function manifestEntry(a: GeneratedAsset): ManifestEntry {
  const ns = a.nineSlice;
  return {
    frameH: a.frameH ?? a.pixmap.h,
    frameW: a.frameW ?? a.pixmap.w,
    frames: a.frames ?? 1,
    h: a.pixmap.h,
    name: a.name,
    nineSlice: ns ? { b: ns.b, l: ns.l, r: ns.r, t: ns.t } : null,
    sha256: createHash('sha256').update(a.pixmap.data).digest('hex'),
    w: a.pixmap.w,
  };
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const assets = generateAll();
  const entries: ManifestEntry[] = [];
  for (const a of assets) {
    assertPalette(a.pixmap, a.name);
    const file = path.join(OUT_DIR, `${a.name}.png`);
    writeFileSync(file, pixmapToPng(a.pixmap));
    const e = manifestEntry(a);
    entries.push(e);
    const frames = e.frames > 1 ? ` ×${e.frames} (${e.frameW}×${e.frameH})` : '';
    console.log(`${a.name.padEnd(18)} ${String(e.w).padStart(4)}×${String(e.h).padEnd(4)}${frames}  ${e.sha256.slice(0, 12)}`);
  }
  entries.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  // keys are already emitted in sorted order by manifestEntry; stringify keeps insertion order
  writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({ assets: entries }, null, 2) + '\n');
  console.log(`${entries.length} assets → ${path.relative(process.cwd(), OUT_DIR)}`);
}

// Only run when invoked directly (artpreview imports this module for pixmapToPng).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
