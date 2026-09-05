/**
 * Post-build: inline the Vite bundle into one self-contained HTML file so
 * the game can be opened from disk, offline, or published as a single
 * artifact page. Writes dist/doubleout.html (full document) and
 * dist/doubleout.artifact.html (body-only fragment with <title>/<style>
 * up top, for hosts that wrap the page themselves).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const htmlPath = join(dist, 'index.html');
if (!existsSync(htmlPath)) {
  console.error('dist/index.html not found — run vite build first');
  process.exit(1);
}
let html = readFileSync(htmlPath, 'utf8');
const js = readFileSync(join(dist, 'doubleout.js'), 'utf8');
const cssPath = join(dist, 'doubleout.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';

// Replace the module script tag (any attributes/order) with the inlined bundle.
html = html.replace(/<script[^>]*src="[^"]*doubleout\.js"[^>]*><\/script>/, () => `<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>`);
html = html.replace(/<link[^>]*href="[^"]*doubleout\.css"[^>]*>/, () => (css ? `<style>${css}</style>` : ''));
writeFileSync(join(dist, 'doubleout.html'), html);

// Artifact fragment: title + style + body content, no html/head/body tags.
const style = `<style>
  html, body { margin: 0; padding: 0; background: #0d0b12 !important; height: 100%; overflow: hidden; overscroll-behavior: none; color-scheme: dark; }
  body { display: flex; align-items: center; justify-content: center; touch-action: none; -webkit-user-select: none; user-select: none; }
  canvas { image-rendering: pixelated; image-rendering: crisp-edges; display: block; touch-action: none; outline: none; }
</style>`;
const fragment = `<title>DOUBLE OUT</title>\n${style}\n<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>\n`;
writeFileSync(join(dist, 'doubleout.artifact.html'), fragment);
console.log(`singlefile: dist/doubleout.html (${(html.length / 1024).toFixed(0)} KB), dist/doubleout.artifact.html (${(fragment.length / 1024).toFixed(0)} KB)`);
