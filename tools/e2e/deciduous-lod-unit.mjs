// B-46 unit test: environment/deciduous-tree.js's LOD math, in isolation from the live game.
//
// Why not drive this through phone-test.mjs/live-views.mjs: this file's LOD swap is keyed on
// state.camera.position, which player-controller.js's updatePlayer() recomputes every frame from its
// own authoritative movement/physics state — setting window.silvanDebug.state.player.position directly
// from a test script gets silently overwritten next frame (confirmed: two teleports of +2000u and
// +300u/-300u both left camera position unchanged on readback). Fighting that isn't this bug's concern.
//
// deciduous-tree.js itself needs no WebGL: THREE.BufferGeometry/InstancedMesh/Scene are plain data
// structures, so this imports the REAL module (not a reimplementation) and drives it directly with a
// synthetic forest — exactly forest.js's own calling convention (beginDeciduous -> addDeciduous x N ->
// finishDeciduous -> updateDeciduousLOD(px, pz)) — then checks the invariant the LOD system promises:
// every near-tier instance is within NEAR_RADIUS_DECID of the query point, every impostor instance is
// between NEAR_RADIUS_DECID and FAR_RADIUS_DECID, nothing beyond FAR_RADIUS_DECID is drawn at all, and
// a tree that crosses the boundary as the query point moves actually migrates between tiers.
//
// Run: node tools/e2e/deciduous-lod-unit.mjs   (plain node, no browser, no build step)
import * as THREE from 'three';
import { state } from '../../core/state.js';
import * as D from '../../environment/deciduous-tree.js';

state.scene = new THREE.Scene();
state.globalTextures = { leaf: new THREE.Texture() }; // finishDeciduous only reads this to hand to the leaf material's `map`; never samples it here.

let fail = false;
const ok = (cond, msg) => { console.log((cond ? 'ok: ' : 'FAIL: ') + msg); if (!cond) fail = true; };

// ---- build a synthetic forest: a ring of trees at known distances from the origin, so we know
// exactly which tier each one SHOULD land in at query point (0,0). ----
D.beginDeciduous(0x1234);
const GREEN = new THREE.Color(0x3a6b2e);
const NEAR_RADIUS_DECID = 65, FAR_RADIUS_DECID = 520;
// distances deliberately straddling both LOD boundaries
const distances = [10, 40, 64, 66, 100, 300, 519, 521, 600, 1000];
const rand = () => Math.random();
for (const dist of distances) {
  const angle = rand() * Math.PI * 2;
  const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
  const m = new THREE.Matrix4().makeTranslation(x, 0, z);
  D.addDeciduous(D.pickDeciduousVariant(rand), m, 1, GREEN);
}
D.finishDeciduous(state.globalTextures.leaf);

// ---- helper: read back every drawn instance across near-tier meshes and impostor meshes ----
function collect() {
  const near = [], imp = [];
  state.scene.traverse(o => {
    if (!o.isInstancedMesh || !o.count) return;
    const g = o.geometry;
    const arr = o.instanceMatrix.array;
    const bucket = g.attributes.aLeaf ? imp : (g.attributes.uv && o.castShadow ? near : null); // castShadow:true singles out the trunk mesh so each tree counts once, not once per wood+leaf mesh pair
    if (!bucket) return;
    for (let i = 0; i < o.count; i++) bucket.push({ x: arr[i * 16 + 12], z: arr[i * 16 + 14] });
  });
  return { near, imp };
}

// ---- query at origin: every tree's true distance is already known from how we placed it ----
D.updateDeciduousLOD(0, 0);
let { near, imp } = collect();
console.log(`origin query: ${near.length} near-tier instances, ${imp.length} impostor instances drawn (of ${distances.length} placed)`);

const distTo = (p, x, z) => Math.hypot(p.x - x, p.z - z);
for (const p of near) ok(distTo(p, 0, 0) <= NEAR_RADIUS_DECID + 0.01, `near-tier instance at dist ${distTo(p, 0, 0).toFixed(1)} is within NEAR_RADIUS_DECID (${NEAR_RADIUS_DECID})`);
for (const p of imp) ok(distTo(p, 0, 0) > NEAR_RADIUS_DECID - 0.01 && distTo(p, 0, 0) <= FAR_RADIUS_DECID + 0.01, `impostor instance at dist ${distTo(p, 0, 0).toFixed(1)} is within (NEAR_RADIUS_DECID, FAR_RADIUS_DECID] (${NEAR_RADIUS_DECID}, ${FAR_RADIUS_DECID}]`);

const expectedNear = distances.filter(d => d <= NEAR_RADIUS_DECID).length;
const expectedImp = distances.filter(d => d > NEAR_RADIUS_DECID && d <= FAR_RADIUS_DECID).length;
const expectedCulled = distances.filter(d => d > FAR_RADIUS_DECID).length;
ok(near.length === expectedNear, `near-tier draws exactly the ${expectedNear} trees within range (got ${near.length})`);
ok(imp.length === expectedImp, `impostor tier draws exactly the ${expectedImp} trees in its band (got ${imp.length})`);
ok(near.length + imp.length === distances.length - expectedCulled, `${expectedCulled} tree(s) beyond FAR_RADIUS_DECID are drawn nowhere (culled), rest accounted for`);

// ---- move the query point far past the hysteresis threshold (LOD_HYSTERESIS_DECID=10) and recheck:
// a tree that was near-tier at origin should now, from 2000 units away, be either impostor or culled,
// never still near-tier. This is the actual "LOD swap" behaviour that querying the live game's camera
// position couldn't exercise reliably. ----
D.updateDeciduousLOD(2000, 2000);
({ near, imp } = collect());
ok(near.length === 0, `querying from 2000u away: near-tier is empty (got ${near.length}) — nothing stays "close" just because it was close before`);
console.log(`2000u-away query: ${near.length} near-tier, ${imp.length} impostor instances drawn`);
for (const p of imp) ok(distTo(p, 2000, 2000) <= FAR_RADIUS_DECID + 0.01, `impostor instance still within FAR_RADIUS_DECID of the new query point (dist ${distTo(p, 2000, 2000).toFixed(1)})`);

// ---- move back near origin (crossing the hysteresis gate again) and confirm near-tier repopulates —
// proves the LOD_HYSTERESIS_DECID early-return doesn't get the system stuck after a large jump. ----
D.updateDeciduousLOD(0, 0);
({ near, imp } = collect());
ok(near.length === expectedNear, `querying back at origin: near-tier repopulates to ${expectedNear} (got ${near.length}) — LOD isn't stuck from the big jump`);

console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(fail ? 1 : 0);
