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

  // Overlap check: compare every pair of on-screen UI rects instead of eyeballing
  // printed numbers (an 18px joystick/Rest overlap went unnoticed that way).
  // Give the tutorial card a chance to appear first; it's the largest HUD box.
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => document.getElementById('tutorial-card')?.classList.contains('visible'))) break;
    await page.waitForTimeout(1000);
  }
  // If the real tutorial hasn't started (it runs on its own schedule), fill the
  // card with the longest real step text so its LAYOUT can still be checked.
  const forced = await page.evaluate(() => {
    const c = document.getElementById('tutorial-card');
    if (!c || c.classList.contains('visible')) return false;
    document.getElementById('tut-step').textContent = 'step 6 of 7';
    document.getElementById('tut-text').textContent = 'Find a place on the island and walk up close. When its name appears, tap Interact to examine it.';
    const g = document.getElementById('tut-guide'); g.style.display = 'flex'; document.getElementById('tut-guide-text').textContent = "The Serpent's Coil, 55 m away";
    document.getElementById('tut-skip').textContent = 'skip';
    c.classList.add('visible'); c.style.setProperty('transition', 'none', 'important'); c.style.setProperty('opacity', '1', 'important'); return true; // pinned: the tutorial module re-hides it on its next frame; transition off because software GL produces so few frames the fade never finishes
  });
  if (forced) console.log('  (tutorial card was not showing, filled it with sample text to test layout)');
  await page.waitForTimeout(500);
  console.log('  card state before screenshot:', JSON.stringify(await page.evaluate(() => { const c = document.getElementById('tutorial-card'); const cs = getComputedStyle(c); const r = c.getBoundingClientRect(); return { cls: c.className, opacity: cs.opacity, display: cs.display, vis: cs.visibility, z: cs.zIndex, top: Math.round(r.top), h: Math.round(r.height), parent: c.parentElement.tagName + '#' + c.parentElement.id }; })));
  await page.screenshot({ path: OUT + `ingame-ui-${W}x${H}.png`, timeout: 150000 });
  const boxes = await page.evaluate(() => {
    const items = { joystick: '#touch-joystick-base', rest: '#touch-rest-btn', jump: '#touch-jump-btn', sprint: '#touch-sprint-btn', interact: '#touch-interact-btn',
      pause: '#touch-pause-btn', fullscreen: '#fullscreen-btn', hudPlaque: '.hud-plaque', tutorial: '#tutorial-card.visible', discoveryToast: '#discovery-toast.visible' };
    const out = {};
    for (const [k, sel] of Object.entries(items)) {
      const el = document.querySelector(sel); if (!el) continue;
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      out[k] = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }
    return out;
  });
  const names = Object.keys(boxes); let overlaps = 0;
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = boxes[names[i]], b = boxes[names[j]];
    if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) { overlaps++; console.log(`  FAIL: ${names[i]} overlaps ${names[j]}`); }
  }
  const offscreen = names.filter(n => boxes[n].l < -1 || boxes[n].t < -1 || boxes[n].r > W + 1 || boxes[n].b > H + 1);
  offscreen.forEach(n => console.log(`  FAIL: ${n} is partly off-screen`));
  console.log(overlaps || offscreen.length ? '' : `  ok: no overlaps among ${names.length} UI boxes (${names.join(', ')})`);
  console.log('  tutorial card visible:', !!boxes.tutorial, boxes.tutorial ? `(${Math.round(boxes.tutorial.r - boxes.tutorial.l)}x${Math.round(boxes.tutorial.b - boxes.tutorial.t)}px)` : '');

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
