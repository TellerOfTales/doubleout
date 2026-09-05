/**
 * Boot: generate art, build the screen, wire input and audio, run the loop.
 */
import { Sprites } from './art/sprites';
import { AudioEngine } from './audio/sfx';
import { Commentary } from './core/commentary';
import * as state from './core/state';
const { beginLeg, createNight } = state;
import type { OcheId } from './core/types';
import type { App } from './ui/app';
import { Screen } from './ui/canvas';
import { Renderer } from './ui/draw';
import { Input } from './ui/input';
import { Save } from './ui/save';
import { SceneManager } from './ui/scene';
import { CreditsScreen } from './ui/screens/credits';
import { GameScreen } from './ui/screens/game';
import { ResultsScreen } from './ui/screens/results';
import { SettingsScreen } from './ui/screens/settings';
import { ShopScreen } from './ui/screens/shop';
import { TitleScreen } from './ui/screens/title';
import { startTutorial } from './ui/screens/tutorial';

function boot(): void {
  const root = document.body;
  const screen = new Screen(root);
  const sprites = new Sprites();
  sprites.load();
  const renderer = new Renderer(screen.ctx, sprites, screen.width, screen.height);
  const audio = new AudioEngine();
  const save = new Save();
  save.load();
  const input = new Input(screen);
  const scenes = new SceneManager();
  input.handler = scenes.handler();

  const app: App = {
    screen,
    renderer,
    sprites,
    audio,
    save,
    input,
    scenes,
    commentary: new Commentary(Math.floor(Math.random() * 0xffffffff)),
    night: null,
    chosenSeed: null,
    chosenOche: save.data.lastOche,
    toTitle() {
      app.night = null;
      scenes.go(new TitleScreen(app));
    },
    startNight(seed: number | null, oche: OcheId) {
      const s = seed === null ? app.randomSeed() : seed;
      app.night = createNight(s, oche);
      app.commentary = new Commentary(s ^ 0x9e3779b9);
      beginLeg(app.night);
      scenes.go(new GameScreen(app), true);
    },
    toGame() {
      scenes.go(new GameScreen(app));
    },
    toShop() {
      scenes.go(new ShopScreen(app));
    },
    toWin() {
      scenes.go(new ResultsScreen(app, true));
    },
    toLoss() {
      scenes.go(new ResultsScreen(app, false), true);
    },
    toTutorial() {
      startTutorial(app);
    },
    toSettings(back: () => void) {
      scenes.go(new SettingsScreen(app, back));
    },
    toCredits() {
      scenes.go(new CreditsScreen(app));
    },
    applySettings() {
      const s = save.data.settings;
      audio.setMuted(!s.sound);
      audio.setMasterVolume(s.volume);
      audio.setVoiceVolume(s.voice ? 1 : 0);
      audio.setCrowdEnabled(s.crowd);
      screen.forced = s.orientation === 1 ? 'landscape' : s.orientation === 2 ? 'portrait' : null;
      screen.fit();
    },
    sfx(name, opts) {
      if (!save.data.settings.sound) return;
      audio.play(name, opts);
    },
    randomSeed() {
      return (Math.random() * 0xffffffff) >>> 0;
    },
  };

  if (!save.isUnlocked('local')) save.unlock('local');
  if (!save.isUnlocked(app.chosenOche)) app.chosenOche = 'local';

  input.onFirstGesture = () => {
    audio.unlock();
    app.applySettings();
  };
  screen.onResize = () => {
    renderer.setContext(screen.ctx, screen.width, screen.height);
    scenes.current?.resize?.();
  };
  app.applySettings();

  scenes.go(new TitleScreen(app), true);

  // Test/automation hooks (harmless in production; no network, no state leak).
  (window as unknown as { __do: unknown }).__do = Object.assign(app, { state });

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      scenes.update(dt);
      renderer.setContext(screen.ctx, screen.width, screen.height);
      scenes.draw(renderer);
      screen.present();
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') audio.unlock();
  });
}

boot();
