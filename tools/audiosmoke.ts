/**
 * Audio smoke test. Renders every SfxName, the crowd bed/roar, a chalk chain
 * and two blip sentences through a real OfflineAudioContext in Chromium, and
 * reports peak amplitude, RMS and duration for each. Fails if any sound is
 * silent, peaks above 1.0 (master clipping) or throws.
 *
 *   node --experimental-strip-types tools/audiosmoke.ts [--json] [--structural] [--browser]
 *
 * Browser drivers, in order of preference:
 *   1. Playwright, if `playwright` is importable (it usually is not in this repo:
 *      zero runtime deps, and it is not a build dep either).
 *   2. Raw Chrome DevTools Protocol over Node's built-in WebSocket against the
 *      Chromium under $PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers) or $CHROME_PATH.
 *   3. `--structural` / no browser found: a Node-side stub AudioContext that
 *      records node-graph construction. This proves the graphs are built, not
 *      how they sound; the report says so loudly.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioEngine } from '../src/audio/sfx.ts';
import { SFX_DEFS, SFX_NAMES, defDuration } from '../src/audio/defs.ts';
import type { AudioContextLike } from '../src/audio/synth.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SCRATCH_DEFAULT = '/tmp/claude-0/-home-user-doubleout/e2de3019-6ae4-5f37-8336-93003b19fa6e/scratchpad';

const args = new Set(process.argv.slice(2));
const wantJson = args.has('--json');
const forceStructural = args.has('--structural');
const forceBrowser = args.has('--browser');

interface Measure {
  name: string;
  peak: number;
  rms: number;
  duration: number;
  expected?: number;
  note?: string;
  error?: string;
}

interface Report {
  mode: 'playwright' | 'cdp' | 'structural';
  results: Measure[];
}

// ---------------------------------------------------------------------------
// Where to put temporary files.

function scratchDir(): string {
  const base = process.env.DOUBLEOUT_TMP ?? (existsSync(SCRATCH_DEFAULT) ? SCRATCH_DEFAULT : path.join(tmpdir(), 'doubleout'));
  const dir = path.join(base, 'audiosmoke');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Browser-side program. Written to a temp entry and bundled by Vite so the
// exact modules the game ships run inside a real OfflineAudioContext.

const BROWSER_ENTRY = `
import { AudioEngine } from '@audio/sfx';
import { SFX_DEFS, SFX_NAMES, defDuration } from '@audio/defs';

const SR = 44100;

function analyze(buf) {
  const ch = buf.getChannelData(0);
  let peak = 0, sum = 0, last = -1;
  for (let i = 0; i < ch.length; i++) {
    const v = ch[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
    if (a > 0.001) last = i;
  }
  return { peak, rms: Math.sqrt(sum / ch.length), duration: last < 0 ? 0 : (last + 1) / buf.sampleRate };
}

async function render(seconds, fn) {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  const eng = new AudioEngine({ context: ctx, cosmeticSeed: 1234 });
  eng.unlock();
  await fn(eng, ctx);
  const buf = await ctx.startRendering();
  return analyze(buf);
}

async function measure(name, seconds, fn, extra) {
  try {
    const m = await render(seconds, fn);
    return Object.assign({ name }, m, extra || {});
  } catch (err) {
    return { name, peak: 0, rms: 0, duration: 0, error: String(err && err.stack || err) };
  }
}

export async function run() {
  const out = [];
  for (const name of SFX_NAMES) {
    const expected = defDuration(SFX_DEFS[name]);
    out.push(await measure(name, expected + 0.6, (e) => e.play(name), { expected }));
  }
  for (let i = 0; i < 5; i++) {
    out.push(await measure('chalkFire(' + i + ')', 0.6, (e) => e.chalkFire(i)));
  }
  out.push(await measure('thud x30 @40ms', 1.8, (e) => {
    for (let i = 0; i < 30; i++) e.play('thud', { delay: i * 40, pitch: 0.95 + (i % 5) * 0.025 });
  }, { note: 'polyphony/limiter spam test' }));
  out.push(await measure('crowd bed t=0.2', 2.0, (e) => e.setCrowdTension(0.2), { note: 'murmur loop' }));
  out.push(await measure('crowd bed t=1.0', 2.0, (e) => e.setCrowdTension(1.0), { note: 'murmur loop' }));
  out.push(await measure('crowdRoar(0.3)', 1.6, (e) => e.crowdRoar(0.3)));
  out.push(await measure('crowdRoar(1.0)', 2.2, (e) => e.crowdRoar(1.0)));
  const sentences = [
    ['BARREL', "Oh, that's a big one!"],
    ['NOCK', 'Statistically, that should not have happened.'],
  ];
  for (const [speaker, text] of sentences) {
    let total = 0;
    out.push(await measure('blip ' + speaker, 3.5, (e) => {
      let t = 0;
      for (const ch of text) t += e.blip(speaker, ch, { delay: t });
      total = t;
    }, { note: text }));
    out[out.length - 1].expected = total / 1000;
  }
  return out;
}
`;

async function bundleBrowserProgram(): Promise<string> {
  const dir = scratchDir();
  const entry = path.join(dir, 'entry.js');
  writeFileSync(entry, BROWSER_ENTRY);
  const outDir = path.join(dir, 'out');
  const vite = await import('vite');
  await vite.build({
    configFile: false,
    root: REPO,
    logLevel: 'silent',
    resolve: { alias: { '@audio': path.join(REPO, 'src', 'audio') } },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      target: 'es2020',
      lib: { entry, formats: ['iife'], name: 'DoubleOutAudioSmoke', fileName: () => 'audiosmoke.js' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  return readFileSync(path.join(outDir, 'audiosmoke.js'), 'utf8');
}

// ---------------------------------------------------------------------------
// Chromium discovery.

function findChromium(): string | undefined {
  const candidates: string[] = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(process.env.HOME ?? '', '.cache', 'ms-playwright')].filter(Boolean) as string[];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    candidates.push(path.join(root, 'chromium'));
    let entries: string[] = [];
    try { entries = readdirSync(root); } catch { entries = []; }
    for (const e of entries.sort().reverse()) {
      if (e.startsWith('chromium-')) candidates.push(path.join(root, e, 'chrome-linux', 'chrome'));
    }
    for (const e of entries.sort().reverse()) {
      if (e.startsWith('chromium_headless_shell-')) candidates.push(path.join(root, e, 'chrome-linux', 'headless_shell'));
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  return candidates.find((c) => existsSync(c));
}

// ---------------------------------------------------------------------------
// Driver 1: Playwright (dynamic import; absent from this repo's dependencies).

async function runWithPlaywright(bundle: string, executablePath: string): Promise<Measure[] | undefined> {
  const modName = 'playwright';
  let pw: { chromium?: { launch(o: unknown): Promise<unknown> } } | undefined;
  try {
    pw = (await import(/* @vite-ignore */ modName)) as typeof pw;
  } catch {
    return undefined;
  }
  if (!pw?.chromium) return undefined;
  const browser = (await pw.chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })) as {
    newPage(): Promise<{ addScriptTag(o: { content: string }): Promise<unknown>; evaluate(s: string): Promise<unknown> }>;
    close(): Promise<void>;
  };
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle });
    return (await page.evaluate('DoubleOutAudioSmoke.run()')) as Measure[];
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Driver 2: raw CDP over Node's built-in WebSocket.

function waitForDevTools(proc: ChildProcess, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chromium did not announce a DevTools endpoint within ' + ms + 'ms\n' + buf.slice(-2000))), ms);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    proc.stderr?.on('data', onData);
    proc.stdout?.on('data', onData);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Chromium exited early with code ' + code + '\n' + buf.slice(-2000)));
    });
  });
}

class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; error?: { message: string }; result?: unknown };
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error('WebSocket error connecting to ' + url)));
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string, awaitPromise = false): Promise<T> {
    const r = await this.send<{ result: { value?: T; description?: string }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, awaitPromise, returnByValue: true },
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  close(): void {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

async function runWithCdp(bundle: string, chromePath: string): Promise<Measure[]> {
  const userDir = mkdtempSync(path.join(scratchDir(), 'profile-'));
  const proc = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const browserWs = await waitForDevTools(proc, 20000);
    const origin = browserWs.replace(/^ws:\/\//, 'http://').replace(/\/devtools\/browser\/.*$/, '');
    let pageWs: string | undefined;
    for (let i = 0; i < 50 && !pageWs; i++) {
      try {
        const list = (await (await fetch(origin + '/json/list')).json()) as { type: string; webSocketDebuggerUrl: string }[];
        pageWs = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
      } catch { /* not up yet */ }
      if (!pageWs) await new Promise((r) => setTimeout(r, 100));
    }
    if (!pageWs) throw new Error('No page target found at ' + origin);
    const cdp = await Cdp.connect(pageWs);
    try {
      await cdp.send('Runtime.enable');
      await cdp.evaluate(bundle);
      return await cdp.evaluate<Measure[]>('DoubleOutAudioSmoke.run()', true);
    } finally {
      cdp.close();
    }
  } finally {
    proc.kill('SIGKILL');
    try { rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Driver 3: structural stub (no browser). Records graph construction only.

function runStructural(): Measure[] {
  class Param {
    events = 0;
    constructor(public value = 0) {}
    setValueAtTime() { this.events++; return this; }
    linearRampToValueAtTime() { this.events++; return this; }
    exponentialRampToValueAtTime(v: number) { if (!(v > 0)) throw new Error('exp ramp to <= 0'); this.events++; return this; }
    setTargetAtTime() { this.events++; return this; }
    cancelScheduledValues() { return this; }
  }
  class Node {
    constructor(readonly kind: string, ctx: Stub) { ctx.nodes.push(this); }
    connect(d: unknown) { return d; }
    disconnect() { /* noop */ }
  }
  class Stub implements AudioContextLike {
    currentTime = 0;
    sampleRate = 44100;
    state = 'running';
    nodes: Node[] = [];
    starts = 0;
    envelopes = 0;
    destination = new Node('destination', this);
    createGain() {
      const n = Object.assign(new Node('gain', this), { gain: new Param(1) });
      return n;
    }
    createOscillator() {
      const self = this;
      return Object.assign(new Node('osc', this), {
        type: 'sine', frequency: new Param(440), detune: new Param(0), onended: null,
        start() { self.starts++; }, stop() { /* noop */ }, setPeriodicWave() { /* noop */ },
      });
    }
    createBufferSource() {
      const self = this;
      return Object.assign(new Node('buffer', this), {
        buffer: null, loop: false, playbackRate: new Param(1), onended: null,
        start() { self.starts++; }, stop() { /* noop */ },
      });
    }
    createBiquadFilter() { return Object.assign(new Node('biquad', this), { type: 'lowpass', frequency: new Param(350), Q: new Param(1) }); }
    createDynamicsCompressor() {
      return Object.assign(new Node('compressor', this), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
    }
    createPeriodicWave() { return {}; }
    createBuffer(_c: number, length: number, sampleRate: number) { const d = new Float32Array(length); return { sampleRate, length, getChannelData: () => d }; }
    envelopeCount(): number {
      return this.nodes.filter((n) => n.kind === 'gain' && ((n as unknown as { gain: Param }).gain.events > 2)).length;
    }
  }

  const out: Measure[] = [];
  const probe = (name: string, fn: (e: AudioEngine) => void, expected?: number): void => {
    const ctx = new Stub();
    try {
      const e = new AudioEngine({ context: ctx });
      e.unlock();
      const before = ctx.nodes.length;
      fn(e);
      const sources = ctx.starts;
      const envs = ctx.envelopeCount();
      out.push({ name, peak: sources > 0 && envs > 0 ? 0.5 : 0, rms: envs, duration: expected ?? 0, expected, note: `${ctx.nodes.length - before} nodes, ${sources} sources, ${envs} envelopes` });
    } catch (err) {
      out.push({ name, peak: 0, rms: 0, duration: 0, error: String(err) });
    }
  };
  for (const name of SFX_NAMES) probe(name, (e) => e.play(name), defDuration(SFX_DEFS[name]));
  for (let i = 0; i < 5; i++) probe(`chalkFire(${i})`, (e) => e.chalkFire(i));
  probe('crowd bed t=1.0', (e) => e.setCrowdTension(1));
  probe('crowdRoar(1.0)', (e) => e.crowdRoar(1));
  probe('blip BARREL', (e) => { for (const ch of "Oh, that's a big one!") e.blip('BARREL', ch); });
  probe('blip NOCK', (e) => { for (const ch of 'Statistically, that should not have happened.') e.blip('NOCK', ch); });
  return out;
}

// ---------------------------------------------------------------------------

function fmt(n: number, d = 3): string {
  return n.toFixed(d).padStart(7);
}

function printReport(r: Report): boolean {
  let ok = true;
  const structural = r.mode === 'structural';
  console.log(`audio smoke — mode: ${r.mode}${structural ? '  (NO BROWSER: structural stub only — graph construction verified, sound NOT rendered)' : ''}`);
  console.log(structural
    ? 'name                 built   graph'
    : 'name                 peak     rms      dur     exp    verdict');
  for (const m of r.results) {
    let verdict = 'ok';
    if (m.error) { verdict = 'ERROR ' + m.error.split('\n')[0]; ok = false; }
    else if (structural) { if (m.peak <= 0) { verdict = 'NO GRAPH'; ok = false; } }
    else {
      if (m.peak < 0.01) { verdict = 'SILENT'; ok = false; }
      else if (m.peak > 1.0) { verdict = 'CLIP'; ok = false; }
      else if (m.peak > 0.9) verdict = 'hot';
      if (m.expected !== undefined && !m.error) {
        if (m.duration < m.expected * 0.4) verdict += ' short';
        if (m.duration > m.expected + 1.0) verdict += ' long';
      }
    }
    const name = m.name.padEnd(20);
    if (structural) {
      console.log(`${name} ${m.peak > 0 ? 'yes' : 'NO '}     ${m.note ?? ''} ${verdict !== 'ok' ? verdict : ''}`);
    } else {
      const exp = m.expected !== undefined ? fmt(m.expected, 2) : '      -';
      console.log(`${name}${fmt(m.peak)} ${fmt(m.rms, 4)} ${fmt(m.duration, 2)} ${exp}  ${verdict}${m.note ? '   ' + m.note : ''}`);
    }
  }
  if (!structural) {
    const bed02 = r.results.find((m) => m.name === 'crowd bed t=0.2');
    const bed10 = r.results.find((m) => m.name === 'crowd bed t=1.0');
    if (bed02 && bed10 && !(bed10.rms > bed02.rms)) { console.log('FAIL: crowd bed does not get louder with tension'); ok = false; }
    const roar03 = r.results.find((m) => m.name === 'crowdRoar(0.3)');
    const roar10 = r.results.find((m) => m.name === 'crowdRoar(1.0)');
    if (roar03 && roar10 && !(roar10.rms > roar03.rms && roar10.duration > roar03.duration)) { console.log('FAIL: crowd roar does not scale with intensity'); ok = false; }
  }
  console.log(ok ? 'AUDIO SMOKE PASSED' : 'AUDIO SMOKE FAILED');
  return ok;
}

async function main(): Promise<number> {
  let report: Report | undefined;
  if (!forceStructural) {
    const chrome = findChromium();
    if (!chrome) {
      console.error('No Chromium binary found (set CHROME_PATH or PLAYWRIGHT_BROWSERS_PATH).');
      if (forceBrowser) return 2;
    } else {
      try {
        const bundle = await bundleBrowserProgram();
        const viaPw = await runWithPlaywright(bundle, chrome).catch((e: Error) => { console.error('Playwright failed: ' + e.message); return undefined; });
        if (viaPw) report = { mode: 'playwright', results: viaPw };
        else {
          console.error('Playwright not importable; driving ' + chrome + ' over raw CDP.');
          report = { mode: 'cdp', results: await runWithCdp(bundle, chrome) };
        }
      } catch (err) {
        console.error('Browser render failed: ' + String((err as Error).stack ?? err));
        if (forceBrowser) return 2;
      }
    }
  }
  if (!report) {
    console.error('Falling back to the Node-side structural stub (no sound rendered).');
    report = { mode: 'structural', results: runStructural() };
  }
  if (wantJson) console.log(JSON.stringify(report, null, 2));
  return printReport(report) ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(2); });
