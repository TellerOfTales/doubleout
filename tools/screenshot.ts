/**
 * Playwright playtest harness. Opens dist/doubleout.html in the bundled
 * Chromium, drives the game with real pointer events (flicks included) and
 * writes screenshots to assets/screens/. Usage:
 *   node --experimental-strip-types tools/screenshot.ts [scenario ...]
 * Scenarios: title, tutorial, game, throw, shop, settings, loss, win,
 * portrait, all (default).
 */
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PW = any;
function loadPlaywright(): PW {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright'];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* next */
    }
  }
  throw new Error('playwright not found');
}

function chromiumPath(): string {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean) as string[];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const e of readdirSync(root)) {
      if (e.startsWith('chromium-')) {
        const p = join(root, e, 'chrome-linux', 'chrome');
        if (existsSync(p)) return p;
      }
    }
    const direct = join(root, 'chromium');
    if (existsSync(direct)) return direct;
  }
  return 'chromium';
}

const pw = loadPlaywright();
const outDir = join(process.cwd(), 'assets', 'screens');
mkdirSync(outDir, { recursive: true });
const htmlFile = 'file://' + join(process.cwd(), 'dist', 'doubleout.html');
const wanted = process.argv.slice(2);
const all = wanted.length === 0 || wanted.includes('all');
const want = (s: string) => all || wanted.includes(s);

interface Driver {
  page: PW;
  scale: number;
  ox: number;
  oy: number;
  shot(name: string): Promise<void>;
  click(x: number, y: number): Promise<void>;
  flick(x: number, y: number, dx: number, dy: number): Promise<void>;
  key(k: string): Promise<void>;
  wait(ms: number): Promise<void>;
  evalApp(js: string): Promise<unknown>;
}

async function driver(page: PW, prefix: string): Promise<Driver> {
  await page.goto(htmlFile);
  await page.waitForTimeout(400);
  const geom = (await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const w = (window as unknown as { __do: { screen: { width: number } } }).__do.screen.width;
    return { left: r.left, top: r.top, scale: r.width / w };
  })) as { left: number; top: number; scale: number };
  const d: Driver = {
    page,
    scale: geom.scale,
    ox: geom.left,
    oy: geom.top,
    async shot(name) {
      await page.screenshot({ path: join(outDir, `${prefix}${name}.png`) });
      console.log(`shot ${prefix}${name}`);
    },
    async click(x, y) {
      await page.mouse.click(geom.left + (x + 0.5) * geom.scale, geom.top + (y + 0.5) * geom.scale);
    },
    async flick(x, y, dx, dy) {
      const sx = geom.left + x * geom.scale;
      const sy = geom.top + y * geom.scale;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(sx + (dx * i * geom.scale) / steps, sy + (dy * i * geom.scale) / steps);
        await page.waitForTimeout(12);
      }
      await page.mouse.up();
    },
    async key(k) {
      await page.keyboard.press(k);
    },
    async wait(ms) {
      await page.waitForTimeout(ms);
    },
    async evalApp(js) {
      return page.evaluate(`(function(app){ return (${js}); })(window.__do)`);
    },
  };
  return d;
}

async function main(): Promise<void> {
  const browser = await pw.chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const errors: string[] = [];
  const run = async (name: string, viewport: { width: number; height: number }, fn: (d: Driver) => Promise<void>) => {
    if (!want(name)) return;
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', (e: Error) => errors.push(`[${name}] ${e.message}`));
    page.on('console', (m: { type(): string; text(): string }) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] console.${m.type()}: ${m.text()}`);
    });
    const d = await driver(page, `${name}_`);
    try {
      await fn(d);
    } catch (e) {
      errors.push(`[${name}] ${(e as Error).message}`);
    }
    await page.close();
  };
  const land = { width: 1280, height: 720 };
  const port = { width: 375, height: 667 };

  await run('title', land, async (d) => {
    await d.wait(600);
    await d.shot('01');
    // oche overlay
    await d.evalApp("app.scenes.current.buttons.get('oche').onPress()");
    await d.wait(200);
    await d.shot('02_oche');
    await d.key('Escape');
    await d.evalApp("app.scenes.current.buttons.get('seed').onPress()");
    await d.wait(200);
    await d.shot('03_seed');
    await d.key('Escape');
    await d.wait(3000);
    await d.shot('04_idle');
  });

  await run('game', land, async (d) => {
    await d.evalApp("app.startNight(12345, 'local')");
    await d.wait(900);
    await d.shot('01_hand');
    // select first card by keyboard
    await d.key('1');
    await d.wait(200);
    await d.shot('02_selected');
    await d.key('Enter');
    await d.wait(500);
    await d.shot('03_flight');
    await d.wait(1600);
    await d.shot('04_after');
    await d.key('2');
    await d.key('Enter');
    await d.wait(2200);
    await d.key('1');
    await d.key('Enter');
    await d.wait(2600);
    await d.shot('05_visit_end');
    await d.key('Escape');
    await d.wait(200);
    await d.shot('06_pause');
    await d.key('Escape');
    // chalk tip: tap first chip (none held) — tap the pause icon instead to check chrome
  });

  await run('throw', land, async (d) => {
    await d.evalApp("app.startNight(777, 'local')");
    await d.wait(900);
    const slot = (await d.evalApp("(function(){const l=app.scenes.current.layout; const n=app.night.legs[0].hand.length; const gap=n>=4?4:8; const total=n*40+(n-1)*gap; const start=l.hand.x+Math.floor((l.hand.w-total)/2); return {x:start+20,y:l.hand.y+28};})()")) as { x: number; y: number };
    await d.flick(slot.x, slot.y, -10, -70);
    await d.wait(250);
    await d.shot('01_flick_flight');
    await d.wait(2000);
    await d.shot('02_flick_landed');
  });

  // Regression: the pointer must be able to throw a whole visit. The lock that
  // once stuck after the first flick was invisible to keyboard-driven scenarios.
  await run('flick3', land, async (d) => {
    await d.evalApp("app.startNight(777, 'local')");
    await d.wait(900);
    const slot = async () => (await d.evalApp("(function(){const l=app.scenes.current.layout; const n=app.night.legs[0].hand.length; const gap=n>=4?4:8; const total=n*40+(n-1)*gap; const start=l.hand.x+Math.floor((l.hand.w-total)/2); return {x:start+20,y:l.hand.y+28};})()")) as { x: number; y: number };
    const settled = async () => {
      for (let i = 0; i < 200; i++) {
        const st = (await d.evalApp('(function(){const s=app.scenes.current; return {busy:s.busy, locked:s.hand.locked};})()')) as { busy: boolean; locked: boolean };
        if (!st.busy && !st.locked) return;
        await d.wait(25);
      }
      throw new Error('hand never unlocked after a flick');
    };
    for (let i = 0; i < 3; i++) {
      const p = await slot();
      await d.flick(p.x, p.y, -10, -70);
      await settled();
    }
    const visits = (await d.evalApp('app.night.legs[0].visits.length')) as number;
    if (visits !== 2) throw new Error(`three flicks should end the first visit; visits = ${visits}`);
    await d.shot('01_second_visit');
  });

  // The excitement package end to end: a Shanghai from a forced hand, the
  // two-of-three tease, the overlay row, and banking the crowd from the gauge.
  await run('package', land, async (d) => {
    await d.evalApp("app.startNight(2024, 'local')");
    await d.wait(900);
    // In range (the visit began at 150), the forced trio wins the leg off a dart that would have bust.
    await d.evalApp("(function(){const s=app.state; const n=app.night; const leg=n.legs[0]; leg.shanghai=16; leg.score=150; leg.visits[0].scoreAtVisitStart=150; leg.hand=['s16','d16','t16','s20','t20'].map((x)=>s.newCard(n,x)); const g=app.scenes.current; g.score.snap(150); g.hand.deal(leg.hand); g.refreshHints(); return leg.hand.length;})()");
    await d.wait(700);
    await d.shot('01_shanghai_hand');
    await d.key('1');
    await d.key('Enter');
    await d.wait(1800);
    await d.key('1');
    await d.key('Enter');
    await d.wait(1600);
    await d.shot('02_two_of_three');
    const reads = (await d.evalApp("(function(){const g=app.scenes.current; const t=app.night.legs[0].hand.find((c)=>c.defId==='t16'); return t ? g.hand.leaveKind.get(t.id) : 'gone';})()")) as string;
    if (reads !== 'finish') throw new Error(`the completing piece should read as a finish, not '${reads}'`);
    await d.key('1');
    await d.key('Enter');
    await d.wait(1300);
    await d.shot('03_shanghai');
    await d.wait(2600);
    await d.shot('04_shanghai_overlay');
    const won = (await d.evalApp("app.night.legs[0].status === 'CHECKED_OUT' && app.night.stats.shanghais === 1")) as boolean;
    if (!won) throw new Error('a single, a double and a treble of the called number in range did not win the leg');
    // the wall costs the crowd
    await d.evalApp("app.startNight(31, 'local')");
    await d.wait(900);
    await d.evalApp("(function(){const leg=app.night.legs[0]; leg.shanghai=3; leg.score=100000; leg.visits[0].scoreAtVisitStart=100000; app.scenes.current.score.snap(100000); app.scenes.current.refreshHints(); return 1;})()");
    for (let v = 0; v < 2; v++) {
      for (let t = 0; t < 3; t++) {
        await d.key('1');
        await d.key('Enter');
        await d.wait(t === 2 ? 2200 : 1500);
      }
    }
    const heat = (await d.evalApp('app.night.legs[0].heat')) as number;
    if (heat !== 2) throw new Error(`two clean visits should warm the crowd to 2, got ${heat}`);
    await d.shot('05_warm_crowd');
    await d.key('m');
    await d.wait(2600);
    const after = (await d.evalApp('app.night.legs[0].heat')) as number;
    if (after !== 0) throw new Error(`the wall should empty the crowd, heat is ${after}`);
    await d.shot('06_wall_cold');
  });

  await run('pocketdemo', land, async (d) => {
    await d.evalApp("app.startNight(31415, 'local')");
    await d.wait(900);
    await d.shot('01_visit_hand');
    await d.key('1');
    await d.wait(150);
    await d.key('p');
    await d.wait(400);
    await d.shot('02_kept');
    await d.key('2');
    await d.key('Enter');
    await d.wait(2200);
    await d.shot('03_after_throw');
    await d.key('1');
    await d.key('Enter');
    await d.wait(2200);
    await d.key('1');
    await d.key('Enter');
    await d.wait(2600);
    await d.shot('04_next_visit_kept_returns');
  });

  await run('chalk', land, async (d) => {
    await d.evalApp("(function(){app.startNight(4242,'local'); const s=window.__do.state; for (const id of ['heavy_tips','hot_twenty','oiled','split_tips','last_orders']) s.addChalk(app.night,id); app.scenes.current.refreshHints();})()");
    await d.wait(900);
    await d.shot('01_chalk_hand');
    await d.key('1');
    await d.key('Enter');
    await d.wait(1500);
    await d.shot('02_chain');
    await d.wait(1500);
    await d.shot('03_chain_done');
    // tap a chalk chip for the tooltip
    await d.click(12, 145);
    await d.wait(200);
    await d.shot('04_chalk_tip');
  });

  await run('shop', land, async (d) => {
    await d.evalApp("(function(){app.startNight(99,'local'); const s=window.__do.state; const n=app.night; n.pot=25; n.phase='SHOP'; n.legs[0].status='CHECKED_OUT'; n.shop=s.generateShop(n,0); app.toShop();})()");
    await d.wait(700);
    await d.shot('01_shop');
    await d.click(43, 84); // buy first card
    await d.wait(500);
    await d.shot('02_bought');
    await d.evalApp("app.scenes.current.buttons.get('library').onPress()");
    await d.wait(300);
    await d.shot('03_library');
    await d.key('Escape');
    await d.click(276, 84); // service → library picker
    await d.wait(300);
    await d.shot('04_service_pick');
    await d.key('Escape');
  });

  await run('checkout', land, async (d) => {
    await d.evalApp("(function(){app.startNight(31337,'local'); const s=window.__do.state; const leg=app.night.legs[0]; leg.score=40; leg.visits[0].scoreAtVisitStart=40; const d20=leg.deck.find(c=>c.defId==='d20')||leg.hand.find(c=>c.defId==='d20'); leg.deck=leg.deck.filter(c=>c!==d20); leg.hand=[d20, ...leg.hand.filter(c=>c!==d20)].slice(0,3); const sc=app.scenes.current; sc.score.snap(40); sc.hand.deal(leg.hand); sc.refreshHints();})()");
    await d.wait(900);
    await d.shot('01_forty');
    await d.key('1');
    await d.key('Enter');
    await d.wait(1800);
    await d.shot('02_gameshot');
    await d.wait(1500);
    await d.shot('03_overlay');
    await d.key('Enter');
    await d.wait(700);
    await d.shot('04_shop_after');
  });

  await run('bust', land, async (d) => {
    await d.evalApp("(function(){app.startNight(2024,'local'); const leg=app.night.legs[0]; leg.score=30; leg.visits[0].scoreAtVisitStart=30; const t20=leg.deck.find(c=>c.defId==='t20')||leg.hand.find(c=>c.defId==='t20'); leg.deck=leg.deck.filter(c=>c!==t20); leg.hand=[t20, ...leg.hand.filter(c=>c!==t20)].slice(0,3); const sc=app.scenes.current; sc.score.snap(30); sc.hand.deal(leg.hand); sc.refreshHints();})()");
    await d.wait(900);
    await d.shot('01_thirty');
    await d.key('1');
    await d.key('Enter');
    await d.wait(1400);
    await d.shot('02_bust');
    await d.wait(1600);
    await d.shot('03_after_bust');
  });

  await run('oneeighty', land, async (d) => {
    await d.evalApp("(function(){app.startNight(180,'local'); const s=window.__do.state; const n=app.night; const leg=n.legs[0]; const mk=(id)=>s.newCard(n,id); leg.hand=[mk('t20'),mk('s1'),mk('s3')]; leg.deck=[mk('t20'),mk('s5'),mk('s7'),mk('t20'),mk('s1'),mk('s3'),...leg.deck]; const sc=app.scenes.current; sc.hand.deal(leg.hand); sc.refreshHints();})()");
    await d.wait(900);
    await d.key('1');
    await d.key('Enter');
    await d.wait(2000);
    await d.key('1');
    await d.key('Enter');
    await d.wait(2000);
    await d.key('1');
    await d.key('Enter');
    await d.wait(1500);
    await d.shot('01_180');
    await d.wait(1500);
    await d.shot('02_180_after');
  });

  await run('results', land, async (d) => {
    await d.evalApp("(function(){app.startNight(5,'local'); app.night.stats.oneEighties=3; app.night.stats.bestVisit=140; app.night.stats.legsWon=4; app.night.legs[0].status='TIMED_OUT'; app.night.legs[0].score=88; app.night.status='LOST'; app.toLoss();})()");
    await d.wait(500);
    await d.shot('01_loss');
    await d.evalApp("(function(){app.startNight(6,'local'); app.night.stats.oneEighties=7; app.night.stats.legsWon=8; app.night.status='WON'; app.toWin();})()");
    await d.wait(1200);
    await d.shot('02_win');
  });

  await run('settings', land, async (d) => {
    await d.evalApp('app.toSettings(() => app.toTitle())');
    await d.wait(400);
    await d.shot('01');
    await d.evalApp('app.toCredits()');
    await d.wait(2500);
    await d.shot('02_credits');
  });

  await run('tutorial', land, async (d) => {
    await d.evalApp('app.toTutorial()');
    await d.wait(1200);
    await d.shot('01_welcome');
    await d.key('Enter');
    await d.wait(400);
    await d.shot('02_cards');
    await d.key('Enter');
    await d.wait(400);
    await d.shot('03_throw_prompt');
    await d.key('1');
    await d.key('Enter');
    await d.wait(2600);
    await d.shot('04_leaves');
    await d.key('Enter');
    await d.wait(500);
    await d.shot('05_keep');
    await d.key('Enter');
    await d.wait(400);
    await d.key('1');
    await d.key('Enter');
    await d.wait(2400);
    await d.key('1');
    await d.key('Enter');
    await d.wait(2800);
    await d.shot('06_heat');
    await d.key('Enter');
    await d.wait(700);
    await d.shot('07_finish_intro');
    await d.key('Enter');
    await d.wait(300);
    await d.key('1');
    await d.key('Enter');
    await d.wait(2300);
    await d.shot('06_decide');
    await d.key('Enter');
    await d.wait(300);
    await d.key('1');
    await d.key('Enter');
    await d.wait(2500);
    await d.shot('07_gameshot');
    await d.key('Enter');
    await d.wait(600);
    await d.shot('08_shop');
    await d.click(199, 84);
    await d.wait(400);
    await d.shot('09_bought_chalk');
    await d.click(262, 120);
    await d.wait(1200);
    await d.shot('10_leg2');
    await d.key('Enter');
    await d.wait(300);
    await d.key('1');
    await d.key('Enter');
    await d.wait(2600);
    await d.shot('11_chain');
    await d.key('Enter');
    await d.wait(300);
    await d.shot('12_done');
  });

  await run('portrait', port, async (d) => {
    await d.wait(500);
    await d.shot('01_title');
    await d.evalApp("app.startNight(12345, 'local')");
    await d.wait(900);
    await d.shot('02_game');
    await d.key('1');
    await d.key('Enter');
    await d.wait(2200);
    await d.shot('03_after_throw');
    await d.evalApp("(function(){const s=window.__do.state; const n=app.night; n.pot=20; n.phase='SHOP'; n.legs[0].status='CHECKED_OUT'; n.shop=s.generateShop(n,0); app.toShop();})()");
    await d.wait(600);
    await d.shot('04_shop');
    await d.evalApp('app.toTutorial()');
    await d.wait(1000);
    await d.shot('05_tutorial');
    await d.evalApp("(function(){app.startNight(5,'local'); app.night.status='LOST'; app.night.legs[0].status='TIMED_OUT'; app.toLoss();})()");
    await d.wait(500);
    await d.shot('06_loss');
    await d.evalApp('app.toSettings(() => app.toTitle())');
    await d.wait(300);
    await d.shot('07_settings');
  });

  await browser.close();
  if (errors.length) {
    console.log('\nERRORS/WARNINGS:');
    for (const e of errors) console.log('  ' + e);
    process.exitCode = 1;
  } else console.log('\nno page errors');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
