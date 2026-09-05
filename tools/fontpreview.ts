/**
 * Render glyphs as ASCII art so a human (or an agent) can eyeball them, and
 * validate the bit arrays. Usage:
 *   node --experimental-strip-types tools/fontpreview.ts 5x7 [chars]
 *   node --experimental-strip-types tools/fontpreview.ts 9x12 [chars]
 * With no chars, prints every glyph and a coverage report.
 */
import { GLYPHS_5X7 } from '../src/art/glyphs5x7.ts';
import { GLYPHS_9X12 } from '../src/art/glyphs9x12.ts';

export const REQUIRED_LATIN1 = 'àâäçèéêëîïôöùûüÿáíóúñ¿¡ß';
export const REQUIRED_EXTRA = '←→↑↓•·×…';
export const REQUIRED_CHARS = (() => {
  let s = '';
  for (let c = 32; c <= 126; c++) s += String.fromCharCode(c);
  return s + REQUIRED_LATIN1 + REQUIRED_EXTRA;
})();

const which = process.argv[2] ?? '5x7';
const chars = process.argv[3];
const [w, h, table] = which === '9x12' ? [9, 12, GLYPHS_9X12] : [5, 7, GLYPHS_5X7];

let bad = 0;
const missing: string[] = [];
for (const ch of REQUIRED_CHARS) if (!table[ch]) missing.push(ch);

const list = chars ? [...chars] : Object.keys(table);
const perRow = Math.max(1, Math.floor(100 / (w + 2)));
for (let i = 0; i < list.length; i += perRow) {
  const group = list.slice(i, i + perRow);
  const lines: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (const ch of group) {
      const g = table[ch];
      if (!g) { line += '?'.repeat(w) + '  '; continue; }
      const row = g[y] ?? 0;
      for (let x = w - 1; x >= 0; x--) line += (row >> x) & 1 ? '#' : '.';
      line += '  ';
    }
    lines.push(line);
  }
  console.log(group.map((c) => (c + ' ').padEnd(w + 2)).join(''));
  console.log(lines.join('\n'));
  console.log();
}
for (const [ch, g] of Object.entries(table)) {
  if (g.length !== h) { console.error(`BAD ${JSON.stringify(ch)}: ${g.length} rows, expected ${h}`); bad++; }
  for (const row of g) if (row < 0 || row >= 1 << w) { console.error(`BAD ${JSON.stringify(ch)}: row ${row} exceeds ${w} bits`); bad++; }
}
console.log(`${which}: ${Object.keys(table).length} glyphs, ${missing.length} missing of ${REQUIRED_CHARS.length} required, ${bad} malformed`);
if (missing.length) console.log('missing:', missing.join(''));
process.exit(bad || missing.length ? 1 : 0);
