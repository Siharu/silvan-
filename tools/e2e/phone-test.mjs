// Headless phone smoke test for Silvan. See HEADLESS_TESTING.txt (repo root).
// Usage: serve dist/ (npx vite preview --port 4173 --host 127.0.0.1), then
//   URL=http://127.0.0.1:4173/ W=412 H=780 OUT=/some/dir/ node tools/e2e/phone-test.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { readdirSync } from 'node:fs';

const URL_ = process.env.URL || 'http://127.0.0.1:4173/';
const W = +(process.env.W || 412), H = +(process.env.H || 780);
const OUT = (process.env.OUT || '/tmp/silvan-e2e/');
import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });

// Find whichever chromium build is installed instead of hard-coding a version.
const base = '/opt/pw-browsers/';
const dir = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
const executablePath = `${base}${dir}/chrome-linux/chrome`;

const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('CONSOLE ' + m.text().slice(0, 300)); });

const tapEl = async (sel) => { const el = await page.$(sel); if (!el) return false; const b = await el.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); return true; };
const rect = (id) => page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }, id);

await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const title = await page.evaluate(() => ({
  innerW: innerWidth, innerH: innerHeight,
  scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
  touchControls: document.getElementById('touch-controls').className,
}));
console.log('TITLE', JSON.stringify(title));
console.log(title.scrollW > title.innerW || title.scrollH > title.innerH ? '  FAIL: title screen overflows the viewport' : '  ok: no overflow');
console.log(/hidden/.test(title.touchControls) ? '  ok: touch controls hidden on title' : '  FAIL: touch controls visible on title');
await page.screenshot({ path: OUT + `title-${W}x${H}.png`, timeout: 150000 });

await tapEl('#title-remember-btn');
await page.waitForTimeout(1500);
await tapEl('#title-slot-panel.open .slot-pick-btn:not(.disabled)');

let playing = false;
for (let i = 0; i < 90 && !playing; i++) {
  await page.waitForTimeout(1500);
  playing = await page.evaluate(() => !document.getElementById('hud-layer').classList.contains('hidden'));
}
console.log('GAMEPLAY STARTED:', playing);
if (playing) {
  const cls = await page.evaluate(() => document.getElementById('touch-controls').className);
  console.log('  touch-controls class at start:', cls, /hidden/.test(cls) ? '(FAIL: still hidden)' : /idle/.test(cls) ? '(idle: usually just the slow software renderer outlasting the 10s fade timer; confirm with a MutationObserver, see HEADLESS_TESTING.txt gotcha 9)' : '(ok)');
  await page.screenshot({ path: OUT + `ingame-${W}x${H}.png`, timeout: 150000 });
  const g = await page.evaluate(() => ({ scrollH: document.documentElement.scrollHeight, innerH: innerHeight }));
  const joy = await rect('touch-joystick-base');
  console.log('  joystick', JSON.stringify(joy), 'actions', JSON.stringify(await rect('touch-action-buttons')), 'pause', JSON.stringify(await rect('touch-pause-btn')), 'hud', JSON.stringify(await rect('hud-layer')));
  console.log(g.scrollH > g.innerH ? '  FAIL: in-game page scrolls' : '  ok: in-game no overflow');

  const cdp = await ctx.newCDPSession(page);
  const cx = joy.x + joy.w / 2, cy = joy.y + joy.h / 2;
  const knob = () => page.evaluate(() => document.getElementById('touch-joystick-knob').style.transform);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 40, id: 1 }] });
  await page.waitForTimeout(300);
  console.log('  knob after drag up:', await knob());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  console.log('  knob after release:', await knob());
}
console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'none');
await browser.close();
