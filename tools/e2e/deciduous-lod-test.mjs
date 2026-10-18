// B-46 live-render smoke test for deciduous-tree.js. Confirms it actually boots and draws in the
// real game (software-GL Chromium), not just that it imports cleanly.
//
// This is deliberately NOT where the LOD radius/hysteresis math is checked — see
// tools/e2e/deciduous-lod-unit.mjs for that. Two reasons it doesn't belong here:
//   1. player-controller.js recomputes state.player.position from its own authoritative movement
//      state every frame, so directly setting it from a test script gets silently overwritten next
//      frame (confirmed: teleports of +2000u and +300u/-300u both left camera position unchanged on
//      readback) — there's no reliable way to query the LOD system from a known position this way.
//   2. Scene-wide traversal can't cleanly tell a deciduous near-tier mesh apart from pine-tree.js's
//      own near-tier mesh or other forest geometry — both share "InstancedMesh with a uv attribute
//      and castShadow:true" — so a distance-invariant check attempted here was silently grading the
//      wrong meshes (caught during development: it flagged "violations" thousands of units away,
//      which turned out to be unrelated trees/rocks elsewhere in the world, not deciduous LOD misses).
// deciduous-lod-unit.mjs sidesteps both: it imports the real module directly and drives it with a
// synthetic, isolated scene it fully controls.
//
// See HEADLESS_TESTING.txt. Run: OUT=/dir/ node tools/e2e/deciduous-lod-test.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { readdirSync, mkdirSync } from 'node:fs';

const URL_ = process.env.URL || 'http://127.0.0.1:4173/?debug=1';
const OUT = process.env.OUT || '/tmp/silvan-decid-e2e/';
mkdirSync(OUT, { recursive: true });

const base = '/opt/pw-browsers/';
const dir = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
const executablePath = `${base}${dir}/chrome-linux/chrome`;

const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 780, height: 360 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
// B-43 rotate overlay / B-44 quality default — see HEADLESS_TESTING.txt gotchas 11-12.
await ctx.addInitScript(() => { try { sessionStorage.setItem('silvan-rotate-dismissed', '1'); if (!localStorage.getItem('silvan-quality')) localStorage.setItem('silvan-quality', 'medium'); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('CONSOLE ' + m.text().slice(0, 300)); });

const tap = async (sel) => { const el = await page.$(sel); if (!el) return false; const b = await el.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); return true; };

await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await tap('#title-remember-btn');
await page.waitForTimeout(1500);
await tap('#title-slot-panel.open .slot-pick-btn:not(.disabled)');

let playing = false;
for (let i = 0; i < 90 && !playing; i++) {
  await page.waitForTimeout(1500);
  playing = await page.evaluate(() => !document.getElementById('hud-layer').classList.contains('hidden'));
}
if (!playing) { console.log('FAIL: never reached gameplay'); console.log('ERRORS', errors.length ? errors : 'none'); await browser.close(); process.exit(1); }
await page.waitForTimeout(2000); // let world-gen settle

// Identify deciduous meshes specifically, not just "any InstancedMesh with a uv attribute" (pine
// trees and other forest geometry share that shape too, see note above). The leaf material's exact
// combination (alpha-tested, double-sided, textured, vertex-colored) and the impostor's aLeaf
// attribute are both unique to finishDeciduous() in this codebase.
const inventory = await page.evaluate(() => {
  const s = window.silvanDebug.state;
  const leafMeshes = [], impostorMeshes = [];
  s.scene.traverse(o => {
    if (!o.isInstancedMesh) return;
    const g = o.geometry, m = o.material;
    if (!g || !g.attributes || !m) return;
    if (g.attributes.aLeaf) impostorMeshes.push({ count: o.count, capacity: o.instanceMatrix.count });
    else if (m.alphaTest > 0 && m.side === 2 /* THREE.DoubleSide */ && m.vertexColors && m.map) leafMeshes.push({ count: o.count, capacity: o.instanceMatrix.count });
  });
  return { leafMeshes, impostorMeshes };
});
console.log('INVENTORY', JSON.stringify(inventory));

await page.screenshot({ path: OUT + 'decid-lod-final.png', timeout: 150000 });

console.log('--- VERDICT ---');
let fail = false;
const totalLeafDrawn = inventory.leafMeshes.reduce((a, b) => a + b.count, 0);
const totalImpDrawn = inventory.impostorMeshes.reduce((a, b) => a + b.count, 0);
if (inventory.leafMeshes.length === 0) { console.log('FAIL: no deciduous leaf InstancedMesh found in scene — finishDeciduous() may not be running, or forest.js stopped calling it'); fail = true; }
else console.log(`ok: ${inventory.leafMeshes.length} deciduous leaf-mesh variant(s) in scene, ${totalLeafDrawn} near-tier tree instances drawn at spawn`);
if (inventory.impostorMeshes.length === 0) { console.log('FAIL: no impostor InstancedMesh (aLeaf attribute) found in scene — far-LOD impostors missing'); fail = true; }
else console.log(`ok: ${inventory.impostorMeshes.length} impostor shape(s) in scene, ${totalImpDrawn} far-tier tree instances drawn at spawn`);
if (errors.length) { console.log('FAIL: page/console errors:', errors); fail = true; } else console.log('ok: zero page/console errors');

console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS');
console.log('NOT verified here: LOD radius/hysteresis correctness (see deciduous-lod-unit.mjs), real phone performance/framerate.');
await browser.close();
process.exit(fail ? 1 : 0);
