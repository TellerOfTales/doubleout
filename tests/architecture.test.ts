/**
 * Architectural rules (TDD §14, §17.4, §17.6, AGENT_BRIEF ground rules):
 * the headless core, no network code, no Math.random in game logic, zero
 * runtime dependencies, and permissive licences only.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mts|cts)$/.test(name)) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const ALLOWED_LICENCES = ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', '0BSD', 'Zlib', 'CC0-1.0', 'Python-2.0', 'BlueOak-1.0.0'];

function packages(): { name: string; dir: string }[] {
  const nm = join(ROOT, 'node_modules');
  const out: { name: string; dir: string }[] = [];
  for (const entry of readdirSync(nm)) {
    if (entry.startsWith('.')) continue;
    const p = join(nm, entry);
    if (!statSync(p).isDirectory()) continue;
    if (entry.startsWith('@')) {
      for (const sub of readdirSync(p)) {
        const q = join(p, sub);
        if (statSync(q).isDirectory()) out.push({ name: `${entry}/${sub}`, dir: q });
      }
    } else out.push({ name: entry, dir: p });
  }
  return out;
}

describe('the core is headless (TDD §14.1)', () => {
  const coreFiles = walk(join(SRC, 'core'));

  it('src/core has files to check', () => {
    expect(coreFiles.length).toBeGreaterThan(5);
  });

  it('src/core/**/*.ts never imports from src/ui, src/art or src/audio', () => {
    const offenders: string[] = [];
    for (const f of coreFiles) {
      for (const spec of importsOf(f)) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(f, '..', spec);
        const rel = relative(SRC, target).replace(/\\/g, '/');
        if (/^(ui|art|audio)(\/|$)/.test(rel)) offenders.push(`${relative(ROOT, f)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/core and src/content only import from src/core, src/content and each other', () => {
    const offenders: string[] = [];
    for (const f of [...coreFiles, ...walk(join(SRC, 'content'))]) {
      for (const spec of importsOf(f)) {
        if (!spec.startsWith('.')) {
          offenders.push(`${relative(ROOT, f)} → ${spec} (bare import)`);
          continue;
        }
        const rel = relative(SRC, resolve(f, '..', spec)).replace(/\\/g, '/');
        if (!/^(core|content)\//.test(rel)) offenders.push(`${relative(ROOT, f)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the core imports no DOM or browser globals by name', () => {
    const offenders: string[] = [];
    for (const f of coreFiles) {
      const src = readFileSync(f, 'utf8');
      if (/\b(document|window|navigator|localStorage|AudioContext|requestAnimationFrame)\b\s*[.(]/.test(src)) offenders.push(relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });
});

describe('the house rules on words (TDD §2)', () => {
  it('no gambling terminology anywhere in the build', () => {
    // The TDD bans the word outright. A pub slate, a wire and a press are
    // darts; a casino is not what this is.
    const banned = /\b(bet|bets|betting|bettor|casino|jackpot|wager|wagers|wagered|wagering|odds-?on favourite)\b/i;
    for (const f of walk('src')) {
      const src = readFileSync(f, 'utf8');
      // Strip block and line comments: what ships is the strings, not the prose.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const hit = code.split('\n').findIndex((l) => banned.test(l));
      expect(hit, `${f}:${hit + 1} — ${code.split('\n')[hit]}`).toBe(-1);
    }
  });
});

describe('no network (TDD §17.6, C6)', () => {
  it('fetch(, XMLHttpRequest and WebSocket appear nowhere under src/', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, 'utf8');
      for (const needle of ['fetch(', 'XMLHttpRequest', 'WebSocket']) {
        if (src.includes(needle)) offenders.push(`${relative(ROOT, f)}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no http(s) URLs are requested from src/ (string literals with a scheme)', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/['"`]https?:\/\/[^'"`\s]+['"`]/g)) offenders.push(`${relative(ROOT, f)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('no Math.random in game logic (TDD §8)', () => {
  it('src/core and src/content never call Math.random(', () => {
    const offenders: string[] = [];
    for (const dir of ['core', 'content']) {
      for (const f of walk(join(SRC, dir))) {
        const src = readFileSync(f, 'utf8');
        // strip comments before searching so a doc comment about the rule does not trip it
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (code.includes('Math.random(')) offenders.push(relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/core and src/content never read Date.now or performance.now (time is not an input to the rules)', () => {
    const offenders: string[] = [];
    for (const dir of ['core', 'content']) {
      for (const f of walk(join(SRC, dir))) {
        const code = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (/\bDate\.now\(|\bperformance\.now\(|\bnew Date\(/.test(code)) offenders.push(relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('zero runtime dependencies (TDD §14)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;

  it('package.json has no "dependencies"', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
  });

  it('build dependencies are only vite, typescript, vitest, pngjs and type packages', () => {
    const dev = Object.keys((pkg.devDependencies as Record<string, string>) ?? {});
    const allowed = ['vite', 'typescript', 'vitest', 'pngjs'];
    for (const d of dev) expect(allowed.includes(d) || d.startsWith('@types/'), d).toBe(true);
  });

  it('the project itself is MIT and private', () => {
    expect(pkg.license).toBe('MIT');
    expect(pkg.private).toBe(true);
  });
});

describe('licence audit (TDD §17.4, C3)', () => {
  const pkgs = packages();

  it('node_modules is populated', () => {
    expect(pkgs.length).toBeGreaterThan(10);
  });

  it('every package with a licence field uses a permissive licence; packages without one are listed, not failed', () => {
    const bad: string[] = [];
    const unlicensed: string[] = [];
    for (const p of pkgs) {
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')) as Record<string, unknown>;
      } catch {
        unlicensed.push(`${p.name} (no package.json)`);
        continue;
      }
      let lic = meta.license ?? meta.licenses;
      if (Array.isArray(lic)) lic = lic.map((l: unknown) => (typeof l === 'string' ? l : (l as { type?: string }).type)).join(' OR ');
      else if (lic && typeof lic === 'object') lic = (lic as { type?: string }).type;
      if (!lic) {
        unlicensed.push(p.name);
        continue;
      }
      const text = String(lic).replace(/[()]/g, '');
      const parts = text.split(/\s+(?:OR|AND)\s+/i).map((s) => s.trim());
      // an OR expression is fine if any branch is permissive; AND needs all
      const ok = /\sOR\s/i.test(text) ? parts.some((x) => ALLOWED_LICENCES.includes(x)) : parts.every((x) => ALLOWED_LICENCES.includes(x));
      if (!ok) bad.push(`${p.name}: ${text}`);
    }
    if (unlicensed.length) console.log(`packages without a licence field: ${unlicensed.join(', ')}`);
    expect(bad).toEqual([]);
  });
});
