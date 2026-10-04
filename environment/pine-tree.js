// Nyctinastic Pine — ported from interactive_pine_tree.html.
//
// Prototype: one Group per branch (92 branches), each with its own
// InstancedMesh of needle tufts, animated on the CPU. That is ~100 draw calls
// and ~1M triangles for ONE tree — unusable for a forest. Port strategy:
//   - PINE_VARIANTS seeded variants, each merged into TWO BufferGeometries
//     (wood, needles) => 2 draw calls per variant, one instance per tree.
//   - The branch "sleep" fold (open by day, folded upward at night) moves to
//     the vertex shader: every vertex carries its branch's pivot, yaw and
//     open/closed angles, and a single shared uClump uniform drives all trees.
//   - Needle tufts are 7 wide triangles instead of 65 hair-thin ones (thin
//     tris shimmer to nothing past ~20 u). Vertex colour fakes AO: darker at
//     the tuft base, lighter at the tips.
//   - The same fold runs in customDepthMaterial so shadows follow the pose.
// Trunk vertices have pivot (0,0,0) and zero angles => they never move.
import * as THREE from 'three';
import { state } from '../core/state.js';
import { mulberry32 } from '../core/rng.js';

export const PINE_VARIANTS = 4;
export const PINE_BASE_HEIGHT = 25;           // prototype tree height; instances scale from this

const CFG = {
    levels: 14, height: PINE_BASE_HEIGHT, baseRadius: 1.15,
    branchesPerLevel: 7, branchLengthBase: 8.6, branchRadiusBase: 0.32,
};
const NEEDLES_PER_TUFT = 9;

// Shared by every pine material (main + depth) so one write moves all trees.
const U = { uClump: { value: 0 }, uPineTime: { value: 0 }, uPineH: { value: PINE_BASE_HEIGHT } };

const FOLD_PARS = /* glsl */`
attribute vec3 aPivot;
attribute vec4 aFold;   // x = yaw, y = open Z angle, z = closed Z angle, w = wind phase
uniform float uClump;
uniform float uPineTime;
uniform float uPineH;
mat3 pineRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 pineRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 pineFold() {
    float amp = 0.02 * aPivot.y / uPineH;                       // more sway near the top; 0 for the trunk
    float wind = sin(uPineTime * 1.5 + aFold.w * 10.0 + aPivot.y) * amp;
    float z = mix(aFold.y, aFold.z, uClump) + wind;
    return pineRotY(aFold.x) * pineRotZ(z);
}
`;

function patchFold(shader) {
    shader.uniforms.uClump = U.uClump;
    shader.uniforms.uPineTime = U.uPineTime;
    shader.uniforms.uPineH = U.uPineH;
    shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + FOLD_PARS)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n    mat3 pFold = pineFold();\n    objectNormal = pFold * objectNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n    transformed = pFold * transformed + aPivot;');
}

// The depth material has no beginnormal chunk that matters, but it does share
// begin_vertex — declare pFold ourselves there.
function patchFoldDepth(shader) {
    shader.uniforms.uClump = U.uClump;
    shader.uniforms.uPineTime = U.uPineTime;
    shader.uniforms.uPineH = U.uPineH;
    shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + FOLD_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n    transformed = pineFold() * transformed + aPivot;');
}

// ---- geometry accumulation ------------------------------------------------
class Acc {
    constructor(withColor) { this.p = []; this.n = []; this.pv = []; this.f = []; this.c = withColor ? [] : null; }
    vert(px, py, pz, nx, ny, nz, pivot, fold, col) {
        this.p.push(px, py, pz); this.n.push(nx, ny, nz);
        this.pv.push(pivot.x, pivot.y, pivot.z); this.f.push(fold[0], fold[1], fold[2], fold[3]);
        if (this.c) this.c.push(col, col, col);
    }
    build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
        g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.pv, 3));
        g.setAttribute('aFold', new THREE.Float32BufferAttribute(this.f, 4));
        if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
        g.computeBoundingSphere();
        return g;
    }
}

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
const ZERO = new THREE.Vector3(), NOFOLD = [0, 0, 0, 0];

// Append an indexed BufferGeometry (already transformed) into the accumulator.
function addGeo(acc, geo, matrix, pivot, fold, col) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index;
    const normalMat = new THREE.Matrix3().getNormalMatrix(matrix);
    const emit = (i) => {
        _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
        _n.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
        acc.vert(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, pivot, fold, col);
    };
    if (idx) for (let i = 0; i < idx.count; i++) emit(idx.getX(i));
    else for (let i = 0; i < pos.count; i++) emit(i);
}

// One needle tuft: NEEDLES_PER_TUFT wide spikes fanning around +Y. Built once
// (seeded) and reused by every tuft of every variant, like the prototype.
function makeTuft(rand) {
    const P = [], N = [], C = [];
    for (let i = 0; i < NEEDLES_PER_TUFT; i++) {
        const angle = rand() * Math.PI * 2;
        const spread = Math.pow(rand(), 1.4) * Math.PI * 0.28 + 0.06;
        const len = 0.55 + rand() * 0.45;
        const dir = new THREE.Vector3(Math.sin(spread) * Math.cos(angle), Math.cos(spread), Math.sin(spread) * Math.sin(angle));
        const tip = dir.clone().multiplyScalar(len);
        const w = 0.11;
        const ta = rand() * Math.PI;
        const tx = Math.cos(ta) * w, tz = Math.sin(ta) * w;
        const a = new THREE.Vector3(-tx, 0, -tz), b = new THREE.Vector3(tx, 0, tz);
        const nrm = new THREE.Vector3().subVectors(tip, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
        // needles are double-sided in the material; point the stored normal up-and-out so lighting reads as foliage, not slivers
        nrm.lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize();
        P.push(a.x, a.y, a.z, b.x, b.y, b.z, tip.x, tip.y, tip.z);
        for (let k = 0; k < 3; k++) N.push(nrm.x, nrm.y, nrm.z);
        C.push(0.78, 0.78, 1.3);   // AO ramp: base, base, tip — was 0.55/1.15, too dark under ACES tonemapping
    }
    return { P, N, C };
}

function buildVariant(seed) {
    const rand = mulberry32(seed);
    const wood = new Acc(false), needles = new Acc(true);
    const tuft = makeTuft(mulberry32(seed ^ 0x9e3779b9));
    const H = CFG.height;

    // Trunk: tapered, lightly noised, open-ended (caps never seen).
    {
        const g = new THREE.CylinderGeometry(CFG.baseRadius * 0.16, CFG.baseRadius, H, 9, 5, true);
        g.translate(0, H / 2, 0);
        const pa = g.attributes.position;
        for (let i = 0; i < pa.count; i++) {
            const y = pa.getY(i);
            if (y > 0.01 && y < H - 0.01) { pa.setX(i, pa.getX(i) + (rand() - 0.5) * 0.14); pa.setZ(i, pa.getZ(i) + (rand() - 0.5) * 0.14); }
        }
        g.computeVertexNormals();
        addGeo(wood, g, new THREE.Matrix4(), ZERO, NOFOLD, 1);
    }

    for (let level = 0; level < CFG.levels; level++) {
        const hr = level / (CFG.levels - 1);
        const yPos = H * (0.28 + hr * 0.70);
        const len = CFG.branchLengthBase * Math.pow(1 - hr, 1.2) + 0.8;
        const rad = CFG.branchRadiusBase * (1 - hr * 0.8);
        const nb = level > CFG.levels - 3 ? 4 : CFG.branchesPerLevel;
        const step = (Math.PI * 2) / nb;
        const off = rand() * Math.PI;
        const geo = new THREE.CylinderGeometry(rad * 0.4, rad, len, 5, 1, true);
        geo.translate(0, len / 2, 0);

        for (let b = 0; b < nb; b++) {
            const yaw = b * step + off + (rand() * 0.4 - 0.2);
            const openZ = Math.PI / 2 + 0.05 * (1 - hr) - 0.5 * hr;
            const closedZ = Math.PI / 6 + hr * 0.15;
            const pivot = new THREE.Vector3(0, yPos, 0);
            const fold = [yaw, openZ, closedZ, rand()];

            addGeo(wood, geo, new THREE.Matrix4(), pivot, fold, 1);

            // tufts along the branch (branch-local space, same frame as the wood)
            const tuftCount = Math.max(2, Math.round(len * 0.62));
            const skip = 0.3 * (1 - hr);
            for (let c = 1; c <= tuftCount; c++) {
                const along = (c / tuftCount) * len;
                if (along < len * skip) continue;
                const size = (1 - (c / tuftCount) * 0.3) * 1.85;
                const perPoint = hr > 0.6 ? 1 : 2;
                for (let t = 0; t < perPoint; t++) {
                    const sd = (rand() * 0.4 + 0.1) * size, sa = rand() * Math.PI * 2;
                    _e.set(Math.PI / 2 + (rand() * 0.4 - 0.1), sa, (rand() - 0.5) * 0.5);
                    _q.setFromEuler(_e);
                    _m.compose(_v.set(Math.cos(sa) * sd, along, Math.sin(sa) * sd), _q, new THREE.Vector3(size, size, size));
                    addTuft(needles, tuft, _m, pivot, fold);
                }
            }
            // tip tuft, pointing straight out
            _e.set(rand() * 0.2, 0, 0); _q.setFromEuler(_e);
            _m.compose(_v.set(0, len, 0), _q, new THREE.Vector3(1.9, 1.9, 1.9));
            addTuft(needles, tuft, _m, pivot, fold);
        }
    }

    // Crown: a small blended top cluster + 3 upright ones (no bare spike, B-08).
    const topFold = NOFOLD;
    const topPivot = ZERO;
    _q.identity();
    _m.compose(_v.set(0, H * 0.985, 0), _q, new THREE.Vector3(1.9, 1.9, 1.9));
    addTuft(needles, tuft, _m, topPivot, topFold);
    for (let i = 0; i < 3; i++) {
        _e.set((rand() - 0.5) * 0.5, rand() * 6.28, (rand() - 0.5) * 0.5); _q.setFromEuler(_e);
        _m.compose(_v.set((rand() - 0.5) * 0.2, H * 0.95 + rand() * 0.5, (rand() - 0.5) * 0.2), _q, new THREE.Vector3(1.3, 1.3, 1.3));
        addTuft(needles, tuft, _m, topPivot, topFold);
    }

    return { wood: wood.build(), needles: needles.build() };
}

function addTuft(acc, tuft, matrix, pivot, fold) {
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < tuft.P.length; i += 3) {
        _v.set(tuft.P[i], tuft.P[i + 1], tuft.P[i + 2]).applyMatrix4(matrix);
        _n.set(tuft.N[i], tuft.N[i + 1], tuft.N[i + 2]).applyMatrix3(nm).normalize();
        acc.vert(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, pivot, fold, tuft.C[i / 3]);
    }
}

// ---- pine LOD (audit STEP 3) ------------------------------------------------
// Every pine drew its full wood+needle geometry (thousands of tris: 14
// branch levels x 7 branches x several needle tufts each) at any distance.
// Fine for the ~5-10 pines actually near the player, wasteful for the rest
// of a forest that can run to the draw-distance fog line. Trees are static,
// so rather than a per-frame CPU sort, this is a two-tier swap just like
// rocks.js's: a simple trunk+cone impostor (no branch fold, no sway - not
// visible at the range it's used) stands in beyond NEAR_RADIUS_PINE, and
// updatePineLOD() re-partitions the REAL per-variant wood/needle meshes
// (built once, at full capacity) down to just the near subset, compacted to
// the front of each buffer, whenever the player has moved far enough for the
// split to matter.
const NEAR_RADIUS_PINE = 85;
const LOD_HYSTERESIS_PINE = 12;

// One shared low-poly silhouette: thin trunk cylinder + a cone canopy,
// merged by hand (same technique flowers.js uses for its crossed planes) so
// both pieces are one draw call, with vertex colours standing in for the
// wood/needle material split since the impostor doesn't carry two materials.
function buildImpostorGeometry() {
    const H = PINE_BASE_HEIGHT;
    const trunk = new THREE.CylinderGeometry(CFG.baseRadius * 0.3, CFG.baseRadius * 0.8, H * 0.55, 5, 1);
    trunk.translate(0, H * 0.275, 0);
    const canopy = new THREE.ConeGeometry(H * 0.26, H * 0.75, 7);
    canopy.translate(0, H * 0.58, 0);

    const woodCol = new THREE.Color(0x4a3620), needleCol = new THREE.Color(0x3b7f5c);
    const merge = (geoA, colA, geoB, colB) => {
        const pa = geoA.attributes.position, pb = geoB.attributes.position;
        const positions = new Float32Array((pa.count + pb.count) * 3);
        positions.set(pa.array, 0); positions.set(pb.array, pa.array.length);
        const normals = new Float32Array((pa.count + pb.count) * 3);
        normals.set(geoA.attributes.normal.array, 0); normals.set(geoB.attributes.normal.array, geoA.attributes.normal.array.length);
        const colors = new Float32Array((pa.count + pb.count) * 3);
        for (let i = 0; i < pa.count; i++) colors.set([colA.r, colA.g, colA.b], i * 3);
        for (let i = 0; i < pb.count; i++) colors.set([colB.r, colB.g, colB.b], (pa.count + i) * 3);
        const ia = geoA.index.array, ib = geoB.index.array;
        const indices = new Uint32Array(ia.length + ib.length);
        indices.set(ia, 0);
        for (let i = 0; i < ib.length; i++) indices[ia.length + i] = ib[i] + pa.count;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        g.setIndex(new THREE.BufferAttribute(indices, 1));
        return g;
    };
    return merge(trunk, woodCol, canopy, needleCol); // ~5+7 radial segments, a couple dozen tris total
}

let impostorMesh = null;
let impostorCapacity = 0;

// ---- public API -------------------------------------------------------------
let variants = null;
const buckets = [];          // per variant: { m: Matrix4[], c: number[] }
const nearWood = [], nearNeedles = [];    // per variant InstancedMesh, built at full capacity
let lodLastPx = null, lodLastPz = null;
const NEEDLE_BASE = new THREE.Color(0x3b7f5c);

export function beginPines(seedBase = 0x51ee) {
    variants = [];
    for (let v = 0; v < PINE_VARIANTS; v++) { variants.push(buildVariant(seedBase + v * 7919)); buckets.push({ m: [], c: [] }); }
}

export function pickPineVariant(rand) { return Math.floor(rand() * PINE_VARIANTS); }

// matrix = world placement (translation + yaw), s = size factor: tree height = H units
export function addPine(variant, baseMatrix, heightUnits, rand) {
    const k = heightUnits / PINE_BASE_HEIGHT;
    const mat = baseMatrix.clone().multiply(new THREE.Matrix4().makeScale(k, k, k));
    const col = NEEDLE_BASE.clone().offsetHSL(rand() * 0.03 - 0.015, 0.04, rand() * 0.05 - 0.025);
    buckets[variant].m.push(mat); buckets[variant].c.push(col.r, col.g, col.b);
    return k;
}

export const PINE_TRUNK_RADIUS = CFG.baseRadius;

export function finishPines() {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3620, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    woodMat.onBeforeCompile = patchFold;
    const needleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    needleMat.onBeforeCompile = patchFold;
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depthMat.onBeforeCompile = patchFoldDepth;
    let tris = 0;

    for (let v = 0; v < PINE_VARIANTS; v++) {
        const b = buckets[v];
        if (!b.m.length) { nearWood.push(null); nearNeedles.push(null); continue; }
        const make = (geo, mat, colored, castsShadow) => {
            const im = new THREE.InstancedMesh(geo, mat, b.m.length);
            for (let i = 0; i < b.m.length; i++) im.setMatrixAt(i, b.m[i]);
            if (colored) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(b.c), 3);
            im.castShadow = castsShadow; im.receiveShadow = true;
            im.customDepthMaterial = depthMat;
            im.computeBoundingSphere();
            // branches fold/sway a little outside the baked bounds; pad so culling never pops a tree
            im.boundingSphere.radius += 12;
            state.scene.add(im);
            return im;
        };
        // Needles: dense, thin, overlapping tuft geometry (~0.15u wide) vs the
        // scene's global sun.shadow.normalBias (0.6, tuned for terrain acne in
        // main.js) — the bias pushes the shadow sample past a needle's own
        // thickness into its neighbours in the same tuft, so it falsely
        // self-shadows and the blotches merge into a solid black mass at any
        // tier where shadows are actually on (medium/high; potato disables
        // shadows outright, which is why it never showed there). Needles still
        // receive shadow from the trunk/branches/terrain; they just don't cast.
        nearWood.push(make(variants[v].wood, woodMat, false, true));
        nearNeedles.push(make(variants[v].needles, needleMat, true, false));
        tris += b.m.length * (variants[v].wood.attributes.position.count + variants[v].needles.attributes.position.count) / 3;
    }
    state.pineStats = { trees: buckets.reduce((s, b) => s + b.m.length, 0), instancedTris: Math.round(tris) };

    // Far impostor (pine LOD): one InstancedMesh, capacity = every pine
    // across all variants, filled in by updatePineLOD() below rather than
    // here — at build time we don't know player position yet (this runs
    // before main.js sets state.player.position), so count starts at 0 and
    // the very first updatePineLOD() call (every frame, before render)
    // fills in the real split before anything is drawn.
    impostorCapacity = state.pineStats.trees;
    if (impostorCapacity > 0) {
        const impostorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
        impostorMesh = new THREE.InstancedMesh(buildImpostorGeometry(), impostorMat, impostorCapacity);
        impostorMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(impostorCapacity * 3), 3);
        impostorMesh.count = 0;
        impostorMesh.castShadow = false; // far enough that a shadow blob isn't worth the cost
        impostorMesh.receiveShadow = true;
        // Same reasoning as rocks.js's LOD meshes: which trees occupy this
        // buffer keeps changing as the player moves, so a bounding sphere
        // frozen at build time (when it's still empty, count 0) would cull
        // everything forever. Skip the test entirely instead.
        impostorMesh.frustumCulled = false;
        state.scene.add(impostorMesh);
    }
}

// Re-partitions every pine between its variant's near (full-detail) mesh and
// the shared far impostor, by distance to (px,pz). Rewrites each near mesh's
// matrix/colour buffers with just its current subset compacted to the front
// (InstancedMesh.count controls how many of those get drawn) — cheap at
// pine-forest scale (a few hundred trees total), so the only reason to
// throttle is avoiding needless work on frames the player barely moved.
export function updatePineLOD(px, pz) {
    if (!impostorMesh) return;
    if (lodLastPx !== null) {
        const moved = Math.hypot(px - lodLastPx, pz - lodLastPz);
        if (moved < LOD_HYSTERESIS_PINE) return;
    }
    lodLastPx = px; lodLastPz = pz;

    const r2 = NEAR_RADIUS_PINE * NEAR_RADIUS_PINE;
    let farI = 0;
    for (let v = 0; v < PINE_VARIANTS; v++) {
        const b = buckets[v];
        const wood = nearWood[v], needles = nearNeedles[v];
        if (!wood) continue;
        let nearI = 0;
        for (let i = 0; i < b.m.length; i++) {
            const m = b.m[i];
            const dx = m.elements[12] - px, dz = m.elements[14] - pz;
            if (dx * dx + dz * dz <= r2) {
                wood.setMatrixAt(nearI, m);
                needles.setMatrixAt(nearI, m);
                needles.instanceColor.setXYZ(nearI, b.c[i * 3], b.c[i * 3 + 1], b.c[i * 3 + 2]);
                nearI++;
            } else {
                impostorMesh.setMatrixAt(farI, m);
                impostorMesh.instanceColor.setXYZ(farI, b.c[i * 3], b.c[i * 3 + 1], b.c[i * 3 + 2]);
                farI++;
            }
        }
        wood.count = nearI; needles.count = nearI;
        wood.instanceMatrix.needsUpdate = true;
        needles.instanceMatrix.needsUpdate = true;
        needles.instanceColor.needsUpdate = true;
    }
    impostorMesh.count = farI;
    impostorMesh.instanceMatrix.needsUpdate = true;
    impostorMesh.instanceColor.needsUpdate = true;
}

// Sleep cycle: same night window as day-night-cycle.js (gameTime < 0.25 || > 0.79),
// with a soft dusk/dawn edge so branches fold and open over a few in-game hours.
const sstep = THREE.MathUtils.smoothstep;
export function updatePines(dt) {
    U.uPineTime.value += dt;
    const t = state.gameTime;
    let night;
    if (t > 0.79 || t < 0.25) night = 1;
    else if (t >= 0.25 && t < 0.33) night = 1 - sstep(t, 0.25, 0.33);
    else if (t > 0.70) night = sstep(t, 0.70, 0.79);
    else night = 0;
    U.uClump.value = night;
}

export function pineFoldAmount() { return U.uClump.value; }
