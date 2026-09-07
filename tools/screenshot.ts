/**
 * Playwright playtest harness. Opens dist/doubleout.html in the bundled
 * Chromium, drives the game with real pointer events (flicks included) and
 * writes screenshots to assets/screens/. Usage:
 *   node --experimental-strip-types tools/screenshot.ts [scenario ...]
 * Scenarios: title, game, aim, slate, paid, chalk, checkout, bust, oneeighty,
 * shop, results, settings, tutorial, portrait, all (default).
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

  // ---------------------------------------------------------------- helpers

  /** Point the sights at a target without going through the pointer. */
  const aimAt = (d: Driver, notation: string) =>
    d.evalApp(`(function(){const s=app.scenes.current; s.aim=window.__do.board.parseTarget('${notation}'); s.refreshPreview(); return window.__do.board.targetNotation(s.aim);})()`);

  /**
   * Wait until the screen is interactive again, or fail loudly. A leg that
   * ends takes the game screen with it, so leaving it counts as settled.
   */
  const settled = async (d: Driver, why: string) => {
    for (let i = 0; i < 400; i++) {
      const st = (await d.evalApp(
        '(function(){const s=app.scenes.current; return {busy: !!s.busy, locked: !!s.locked, game: typeof s.aim !== "undefined", overlay: s.overlay};})()',
      )) as { busy: boolean; locked: boolean; game: boolean; overlay: string };
      if (!st.game) return;
      if (st.overlay && st.overlay !== 'none') return;
      if (!st.busy && !st.locked) return;
      await d.wait(25);
    }
    throw new Error(`never became interactive again: ${why}`);
  };

  /** Aim and throw one dart, then wait for the screen to come back. */
  const throwAt = async (d: Driver, notation: string) => {
    await aimAt(d, notation);
    await d.key('Enter');
    await settled(d, `after throwing ${notation}`);
  };

  await run('title', land, async (d) => {
    await d.wait(600);
    await d.shot('01');
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

  // The screen at rest: the board with the sights on it, the fan of where the
  // dart might finish, and three contracts chalked up.
  await run('game', land, async (d) => {
    await d.evalApp("app.startNight(12345, 'local')");
    await settled(d, 'the leg never became interactive');
    await d.shot('01_oche');
    await aimAt(d, 'T20');
    await d.wait(200);
    await d.shot('02_aim_treble');
    await aimAt(d, 'S20');
    await d.wait(200);
    await d.shot('03_aim_single');
    await aimAt(d, 'D20');
    await d.wait(200);
    await d.shot('04_aim_double');
    await throwAt(d, 'T20');
    await d.shot('05_after_first');
    await throwAt(d, 'T20');
    await throwAt(d, 'T20');
    await d.shot('06_visit_end');
    await d.key('Escape');
    await d.wait(200);
    await d.shot('07_pause');
    await d.key('Escape');
  });

  // Aiming with the pointer. The board is the input surface now, so this is
  // the interaction that matters most and the one worth a regression test.
  await run('aim', land, async (d) => {
    await d.evalApp("app.startNight(777, 'local')");
    await settled(d, 'the leg never became interactive');
    // Geometry mirrored from src/ui/aim.ts: bed angle, then ring radius.
    const spot = (await d.evalApp(
      "(function(){const l=app.scenes.current.layout; const c=l.boardCentre; const i=[20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5].indexOf(20); const a=(-90+i*18)*Math.PI/180; return {x: Math.round(c.x+Math.cos(a)*28), y: Math.round(c.y+Math.sin(a)*28)};})()",
    )) as { x: number; y: number };
    await d.click(spot.x, spot.y);
    await d.wait(200);
    const called = (await d.evalApp('window.__do.board.targetNotation(app.scenes.current.aim)')) as string;
    if (called !== 'T20') throw new Error(`tapping the treble twenty called ${called}`);
    await d.shot('01_tapped_treble');
    // A second tap on the same target throws it.
    await d.click(spot.x, spot.y);
    await settled(d, 'tap-to-throw never resolved');
    const thrown = (await d.evalApp('app.night.legs[0].visits[0].throws.length')) as number;
    if (thrown !== 1) throw new Error(`the second tap should have thrown; ${thrown} darts made`);
    await d.shot('02_thrown');
    // And the whole visit must be playable by pointer alone.
    for (let i = 0; i < 2; i++) {
      await d.click(spot.x, spot.y);
      await d.wait(120);
      await d.click(spot.x, spot.y);
      await settled(d, `pointer dart ${i + 2}`);
    }
    const visits = (await d.evalApp('app.night.legs[0].visits.length')) as number;
    if (visits !== 2) throw new Error(`three pointer darts should end the visit; visits = ${visits}`);
    await d.shot('03_second_visit');
  });

  // The slate, end to end: take a contract, land it, press it, and watch a
  // bust take the lot. This is the loop the rebuild exists for.
  await run('slate', land, async (d) => {
    await d.evalApp("app.startNight(2024, 'local')");
    await settled(d, 'the leg never became interactive');
    await d.evalApp("(function(){const n=app.night; n.legs[0].offer=['ton','treble','clean_hands']; app.scenes.current.refresh();})()");
    await d.wait(250);
    await d.shot('01_offer');
    const take = (await d.evalApp(
      "(function(){const s=app.scenes.current; const c=s.slate.cards.find(x=>x.defId==='treble'); if(!c) return null; const v=c.verbs[0]; return {x: v.rect.x+Math.floor(v.rect.w/2), y: v.rect.y+5};})()",
    )) as { x: number; y: number } | null;
    if (!take) throw new Error('A TREBLE was never offered');
    await d.click(take.x, take.y);
    await d.wait(300);
    const taken = (await d.evalApp('app.night.legs[0].slate.length')) as number;
    if (taken !== 1) throw new Error(`taking a contract did not put it on the slate (${taken})`);
    await d.shot('02_taken');
    // Land it, then read the verbs that appear.
    await d.evalApp("app.scenes.current.forceLanding = window.__do.board.parseTarget('T20')");
    await throwAt(d, 'T20');
    await d.shot('03_made');
    // It pays the instant it lands, so the money is already in the Pot and the
    // only verb left on it is the press.
    const paid = (await d.evalApp("app.night.legs[0].ledger.some(c=>c.defId==='treble' && c.settled && c.settled.how==='PAID')")) as boolean;
    if (!paid) throw new Error('a contract that landed did not pay at once');
    const verbs = (await d.evalApp(
      "(function(){const c=app.scenes.current.slate.cards.find(x=>x.defId==='treble'); return c ? c.verbs.map(v=>v.id).join(',') : 'none';})()",
    )) as string;
    if (!verbs.includes('PRESS')) throw new Error(`a contract that has paid should offer PRESS, offered '${verbs}'`);
    // Press it.
    const press = (await d.evalApp(
      "(function(){const c=app.scenes.current.slate.cards.find(x=>x.defId==='treble'); const v=c.verbs.find(x=>x.id==='PRESS'); return {x: v.rect.x+Math.floor(v.rect.w/2), y: v.rect.y+5};})()",
    )) as { x: number; y: number };
    await d.click(press.x, press.y);
    await d.wait(400);
    const pressed = (await d.evalApp('app.night.legs[0].slate[app.night.legs[0].slate.length-1].defId')) as string;
    if (pressed !== 'two_trebles') throw new Error(`pressing A TREBLE should give TWO TREBLES, gave ${pressed}`);
    await d.shot('04_pressed');
    // Now bust the visit and prove what is still being chased goes with it.
    // The pressed contract is the one at risk: the first one has been paid.
    await d.evalApp("(function(){const leg=app.night.legs[0]; leg.score=10; const g=app.scenes.current; g.score.snap(10); g.refresh();})()");
    await d.evalApp("app.scenes.current.forceLanding = window.__do.board.parseTarget('T20')");
    await throwAt(d, 'T20');
    await d.shot('05_bust_took_it');
    const lost = (await d.evalApp("app.night.legs[0].ledger.some(c=>c.settled && c.settled.how==='LOST')")) as boolean;
    const stillLive = (await d.evalApp('app.night.legs[0].slate.filter(c=>!c.settled).length')) as number;
    if (!lost && stillLive > 0) throw new Error('a bust did not take the contract still being chased');
  });

  // Money already won survives the slate being wiped. The other half of the rule.
  await run('paid', land, async (d) => {
    await d.evalApp("app.startNight(4242, 'local')");
    await settled(d, 'the leg never became interactive');
    await d.evalApp("(function(){const n=app.night; n.legs[0].offer=['treble','ton','clean_hands']; app.scenes.current.refresh(); return window.__do.state.takeContract(n,'treble').ok;})()");
    await d.evalApp("(function(){const n=app.night; n.legs[0].offer=['ton','clean_hands']; return window.__do.state.takeContract(n,'ton').ok;})()");
    await d.evalApp('app.scenes.current.refresh()');
    const potBefore = (await d.evalApp('app.night.pot')) as number;
    await d.evalApp("app.scenes.current.forceLanding = window.__do.board.parseTarget('T20')");
    await throwAt(d, 'T20');
    const potAfter = (await d.evalApp('app.night.pot')) as number;
    if (potAfter <= potBefore) throw new Error(`a contract that landed should pay at once: ${potBefore} → ${potAfter}`);
    await d.shot('01_paid');
    // Now bust, which takes everything still chasing but cannot touch the payout.
    await d.evalApp("(function(){const leg=app.night.legs[0]; leg.score=10; const g=app.scenes.current; g.score.snap(10); g.refresh();})()");
    await d.evalApp("app.scenes.current.forceLanding = window.__do.board.parseTarget('T20')");
    await throwAt(d, 'T20');
    const kept = (await d.evalApp('app.night.pot')) as number;
    if (kept < potAfter) throw new Error(`a bust took money that had already been paid: ${potAfter} → ${kept}`);
    await d.shot('02_bust_after_paying');
  });

  await run('chalk', land, async (d) => {
    await d.evalApp("(function(){app.startNight(4242,'local'); const s=window.__do.state; for (const id of ['heavy_tips','hot_twenty','oiled','split_tips','last_orders']) s.addChalk(app.night,id); app.scenes.current.refresh();})()");
    await settled(d, 'the leg never became interactive');
    await d.shot('01_chalk');
    await aimAt(d, 'T20');
    await d.key('Enter');
    await d.wait(1500);
    await d.shot('02_chain');
    await settled(d, 'the chalk chain never finished');
    await d.shot('03_chain_done');
    await d.click(115, 137);
    await d.wait(200);
    await d.shot('04_chalk_tip');
  });

  await run('checkout', land, async (d) => {
    await d.evalApp("(function(){app.startNight(31337,'local'); const leg=app.night.legs[0]; leg.score=40; leg.visits[0].scoreAtVisitStart=40; const g=app.scenes.current; g.score.snap(40); g.refresh();})()");
    await settled(d, 'the leg never became interactive');
    await d.shot('01_forty');
    const route = (await d.evalApp("(function(){const h=app.scenes.current.hints; return h && h.best ? h.best.targets.map(window.__do.board.targetNotation).join(' ') : 'none';})()")) as string;
    if (route !== 'D20') throw new Error(`forty left should route through the double twenty, routed '${route}'`);
    await d.evalApp("app.scenes.current.forceLanding = window.__do.board.parseTarget('D20')");
    await throwAt(d, 'D20');
    await d.shot('02_gameshot');
    await d.wait(1600);
    await d.shot('03_overlay');
    await d.key('Enter');
    await d.wait(800);
    await d.shot('04_shop_after');
  });

  await run('bust', land, async (d) => {
    await d.evalApp("(function(){app.startNight(2024,'local'); const leg=app.night.legs[0]; leg.score=30; leg.visits[0].scoreAtVisitStart=30; const g=app.scenes.current; g.score.snap(30); g.refresh();})()");
    await settled(d, 'the leg never became interactive');
    await d.shot('01_thirty');
    await d.evalApp("app.scenes.current.forceLanding = window.__do.board.parseTarget('T20')");
    await aimAt(d, 'T20');
    await d.key('Enter');
    await d.wait(1400);
    await d.shot('02_bust');
    await settled(d, 'the bust never resolved');
    await d.shot('03_after_bust');
  });

  await run('oneeighty', land, async (d) => {
    await d.evalApp("app.startNight(180,'local')");
    await settled(d, 'the leg never became interactive');
    for (let i = 0; i < 3; i++) {
      await d.evalApp("app.scenes.current.forceLanding = window.__do.board.parseTarget('T20')");
      await aimAt(d, 'T20');
      await d.key('Enter');
      await d.wait(i === 2 ? 1500 : 100);
      await settled(d, `dart ${i + 1} of the maximum`);
    }
    await d.shot('01_180');
    await d.wait(1500);
    await d.shot('02_180_after');
  });

  await run('shop', land, async (d) => {
    await d.evalApp("(function(){app.startNight(99,'local'); const s=window.__do.state; const n=app.night; n.pot=25; n.paid={ton:2, treble:1}; n.phase='SHOP'; n.legs[0].status='CHECKED_OUT'; n.shop=s.generateShop(n,0); app.toShop();})()");
    await d.wait(800);
    await d.shot('01_shop');
    await d.click(43, 84);
    await d.wait(500);
    await d.shot('02_bought');
  });

  await run('results', land, async (d) => {
    await d.evalApp(
      "(function(){app.startNight(5,'local'); const st=app.night.stats; st.oneEighties=3; st.bestVisit=140; st.legsWon=4; st.contractsTaken=22; st.contractsPaid=12; st.contractsPressed=5; st.potStaked=61; st.potWon=48; st.bestPayout=30; app.night.legs[0].status='TIMED_OUT'; app.night.legs[0].score=88; app.night.status='LOST'; app.toLoss();})()",
    );
    await d.wait(600);
    await d.shot('01_loss');
    await d.evalApp(
      "(function(){app.startNight(6,'local'); const st=app.night.stats; st.oneEighties=7; st.legsWon=8; st.contractsTaken=40; st.contractsPaid=25; st.contractsPressed=11; st.potStaked=120; st.potWon=155; st.bestPayout=40; app.night.status='WON'; app.toWin();})()",
    );
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

  // The tutorial has to run all the way to the end without a dead stop. The
  // previous one trapped the player at "40 left", so this walks every step and
  // fails if any of them leaves the screen with nothing to do.
  await run('tutorial', land, async (d) => {
    await d.evalApp('app.toTutorial()');
    await d.wait(1200);
    await d.shot('01_welcome');
    let shots = 0;
    for (let step = 0; step < 140; step++) {
      // Wait out whatever is animating without spending a step on it: a bust
      // takes seconds to play, and the budget is for inputs, not for frames.
      let waited = 0;
      for (;;) {
        const st = (await d.evalApp(
          '(function(){const s=app.scenes.current; return {busy: !!s.busy, throwing: !!s.dart, game: typeof s.aim !== "undefined"};})()',
        )) as { busy: boolean; throwing: boolean; game: boolean };
        if (!st.game || (!st.busy && !st.throwing)) break;
        if (waited > 12000) throw new Error('the tutorial stopped animating and never came back');
        await d.wait(120);
        waited += 120;
      }
      const done = (await d.evalApp("!!(app.save && app.save.data.stats.tutorialDone) && app.night === null")) as boolean;
      if (done) break;
      // Enter advances a button prompt; when the prompt is waiting on an
      // action the tutorial has already called the aim, so Enter throws it.
      // Every few steps nudge the sights as well, which is the only thing the
      // two aim lessons are waiting for.
      // Cycle the whole keyboard vocabulary: Enter advances or throws, the
      // arrows move the sights (which is all the two aim lessons want), and
      // the number keys work the slate. A tutorial that cannot be finished on
      // a keyboard alone is not finished.
      const keys = ['Enter', 'Enter', '1', 'ArrowRight', 'Enter', '2', 'ArrowUp', 'Enter', '3'];
      await d.key(keys[step % keys.length]);
      await d.wait(300);
      if (step % 6 === 0 && shots < 10) {
        shots++;
        await d.shot(`${String(shots).padStart(2, '0')}_step`);
      }
    }
    const finished = (await d.evalApp('!!(app.save && app.save.data.stats.tutorialDone)')) as boolean;
    if (!finished) {
      const where = (await d.evalApp(
        "(function(){const s=app.scenes.current; const h=s.hooks||{}; const leg=app.night&&app.night.legs[app.night.legs.length-1]; const v=leg&&leg.visits[leg.visits.length-1]; return (h.stage||'?') + ' locked=' + !!s.locked + ' busy=' + !!s.busy + ' allowed=' + JSON.stringify(h.allowedTargets) + ' verbs=' + JSON.stringify(h.allowedVerbs) + ' pot=' + (app.night&&app.night.pot) + ' thrown=' + (v&&v.throws.length) + ' offer=' + JSON.stringify(leg&&leg.offer) + ' cards=' + JSON.stringify((s.slate&&s.slate.cards||[]).map(function(c){return c.defId+':'+c.mode+':'+c.verbs.map(function(x){return x.id+(x.disabled?'!':'');}).join('/');}));})()",
      )) as string;
      throw new Error(`the tutorial did not reach the end: stuck at ${where}`);
    }
    await d.shot('99_finished');
  });

  await run('portrait', port, async (d) => {
    await d.wait(500);
    await d.shot('01_title');
    await d.evalApp("app.startNight(12345, 'local')");
    await settled(d, 'the portrait leg never became interactive');
    await d.shot('02_game');
    await aimAt(d, 'T20');
    await d.wait(200);
    await d.shot('03_aimed');
    await throwAt(d, 'T20');
    await d.shot('04_after_throw');
    await d.evalApp("(function(){const s=window.__do.state; const n=app.night; n.pot=20; n.phase='SHOP'; n.legs[0].status='CHECKED_OUT'; n.shop=s.generateShop(n,0); app.toShop();})()");
    await d.wait(700);
    await d.shot('05_shop');
    await d.evalApp('app.toTutorial()');
    await d.wait(1200);
    await d.shot('06_tutorial');
    await d.evalApp("(function(){app.startNight(5,'local'); app.night.status='LOST'; app.night.legs[0].status='TIMED_OUT'; app.toLoss();})()");
    await d.wait(600);
    await d.shot('07_loss');
    await d.evalApp('app.toSettings(() => app.toTitle())');
    await d.wait(400);
    await d.shot('08_settings');
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
