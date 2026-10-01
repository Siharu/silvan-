import * as THREE from 'three';
import { state, WORLD_SIZE } from '../core/state.js';
import { analyticHeightAt } from '../core/heightmap.js';
import { getSplatTexture, CRATER } from '../core/splat.js';

// Terrain v2, 4.3: chunked LOD terrain. Was one PlaneGeometry(WORLD_SIZE,
// WORLD_SIZE, MESH_SEGMENTS, MESH_SEGMENTS) — 22.8k verts/45k tris fixed,
// 4 u cells everywhere including right at the player's feet. Now CHUNK_SIZE
// (64u) tiles, each built at one of 4 LOD resolutions by chebyshev distance
// (in chunks) from the player: 65/33/17/9 verts/side = 1/2/4/8 u spacing.
// [MEASURED, node script against the exact chunk-template math, includes
// skirts] ring counts 9+16+56+88 = 169 chunks total at DRAW_RADIUS=6 (a
// 13x13 chunk square), ~89.5k verts / ~168k tris — MORE than the old fixed mesh, but 5x sharper where the player is actually looking,
// and now independent of WORLD_SIZE: a bigger island costs the same
// per-frame budget, only bake time/memory grow (heightmap.js's concern,
// not this file's).
//
// Colour is still per-fragment from core/splat.js's mask + vWPos (world
// position) — see PALETTE/FRAG_* below, UNCHANGED from the single-mesh
// version. That shader never assumed one mesh; every chunk shares the same
// material instance, so splat/height/crater blending is seamless across
// chunk boundaries automatically. Chunking only had to solve the GEOMETRY
// problem (LOD selection, streaming, pooling, seams), not shading.
//
// Seams between adjacent DIFFERENT-LOD chunks (same-LOD neighbours share
// identical edge vertices, sampled from the same analytic bake at the same
// world coordinates, so those seams are exact) are hidden with a short
// vertical skirt dropped from each chunk's perimeter (buildChunkTemplate's
// skirt ring) rather than solved properly (stitching skirts is the
// industry-standard shortcut here — a proper T-junction fix would mean
// welding differing edge resolutions together per chunk pair).
const PALETTE = {
    oceanBed:   0x1b2a33,
    wetSand:    0x5b5240,
    drySand:    0x8d8262,
    grassA:     0x3f5f2c,
    grassB:     0x59703a,
    rockA:      0x5d5f60,
    rockB:      0x484b50,
    slate:      0x4b525c,
    peak:       0x2b2e35,
    ash:        0x2a2523,
    path:       0x74613f,
    magma:      0xdc2626,
};

const VERT_PARS = `
    varying vec3 vWPos;
`;
const VERT_BODY = `
    #include <begin_vertex>
    vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = `
    uniform sampler2D uSplat;
    uniform float uWorld;
    uniform vec2 uCrater;
    uniform float uTime;
    uniform vec3 uCOcean, uCWet, uCSand, uCGrassA, uCGrassB, uCRockA, uCRockB, uCSlate, uCPeak, uCAsh, uCPath, uCMagma;
    varying vec3 vWPos;
    float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float tNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x),
                   mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float gMagma;
`;

const FRAG_COLOR = `
    {
        vec2 suv = (vWPos.xz + 0.5 * uWorld) / uWorld;
        vec4 sp = texture2D(uSplat, suv);
        float h = vWPos.y;
        float nMacro = tNoise(vWPos.xz * 0.012);          // 100-300 u colour drift
        float nMid   = tNoise(vWPos.xz * 0.07);
        float nFine  = tNoise(vWPos.xz * 0.9);
        float grain  = (nMid * 0.6 + nFine * 0.4) - 0.5;

        // base ground by height: seabed -> wet sand -> dry sand
        vec3 col = mix(uCOcean, uCWet, smoothstep(-0.6, 1.4, h));
        col = mix(col, uCSand, smoothstep(1.6, 4.4, h));
        col *= 1.0 + grain * 0.22;

        // grass ground colour (the "ground-colour trick": blades only add parallax on top)
        vec3 gcol = mix(uCGrassA, uCGrassB, smoothstep(0.25, 0.75, nMacro + grain * 0.5));
        gcol *= 1.0 + grain * 0.3;
        col = mix(col, gcol, sp.r);

        // rock: two tones + a slate tint that takes over with altitude, dark near the summit
        vec3 rcol = mix(uCRockA, uCRockB, smoothstep(0.3, 0.7, nMid + grain));
        rcol = mix(rcol, uCSlate, smoothstep(26.0, 52.0, h));
        rcol = mix(rcol, uCPeak, smoothstep(58.0, 86.0, h));
        rcol *= 1.0 + grain * 0.35;
        col = mix(col, rcol, sp.g);

        // ash apron around the crater (B channel doubles as sand; only near the crater is it ash)
        float cd = distance(vWPos.xz, uCrater);
        float ashW = (1.0 - smoothstep(48.0, 84.0, cd)) * sp.b;
        col = mix(col, uCAsh * (1.0 + grain * 0.4), ashW);

        // trails + POI pads
        vec3 pcol = uCPath * (1.0 + grain * 0.5);
        pcol *= 0.85 + 0.15 * smoothstep(0.4, 1.0, sp.a);     // slightly darker packed centre
        col = mix(col, pcol, sp.a);

        // magma inside the crater bowl (same footprint as the old vertex blend)
        gMagma = (1.0 - smoothstep(10.0, 40.0, cd)) * (1.0 - smoothstep(50.0, 58.0, h));
        col = mix(col, uCMagma, gMagma);

        diffuseColor.rgb *= col;
    }
`;

const CHUNK_SIZE = 64;           // world units per chunk side
const DRAW_RADIUS = 6;           // chunks, chebyshev — 13x13 grid, matches fog (~380u at the corners)
const SKIRT_DEPTH = 6;           // vertical drop for the crack-hiding perimeter skirt
const ADDS_PER_FRAME = 2;        // chunk builds per animate() tick once the initial fill is done
// Chebyshev-radius ring -> vertex resolution. r<=1: 3x3=9 chunks, 1u spacing
// (finest, right around the player). r<=2: +16 chunks, 2u. r<=4: +56, 4u.
// r<=6 (DRAW_RADIUS): +88, 8u. [MEASURED] 9+16+56+88 = 169 total.
const LOD_RINGS = [
    { maxR: 1, res: 65 },
    { maxR: 2, res: 33 },
    { maxR: 4, res: 17 },
    { maxR: 6, res: 9 },
];

function lodForR(r) {
    for (const ring of LOD_RINGS) if (r <= ring.maxR) return ring.res;
    return 0; // outside DRAW_RADIUS — not drawn
}

function buildMaterial() {
    const mat = new THREE.MeshStandardMaterial({
        roughness: 0.92,
        metalness: 0.0,
        flatShading: true,
        side: THREE.DoubleSide, // skirts' winding isn't hand-verified; DoubleSide guarantees they never vanish from one angle
    });
    mat.onBeforeCompile = (shader) => {
        const c = (hex) => ({ value: new THREE.Color(hex) });
        shader.uniforms.uSplat = { value: getSplatTexture() };
        shader.uniforms.uWorld = { value: WORLD_SIZE };
        shader.uniforms.uCrater = { value: new THREE.Vector2(CRATER.x, CRATER.z) };
        shader.uniforms.uTime = { value: 0 }; // day-night-cycle.js feeds every material with userData.shader.uniforms.uTime
        shader.uniforms.uCOcean = c(PALETTE.oceanBed);
        shader.uniforms.uCWet = c(PALETTE.wetSand);
        shader.uniforms.uCSand = c(PALETTE.drySand);
        shader.uniforms.uCGrassA = c(PALETTE.grassA);
        shader.uniforms.uCGrassB = c(PALETTE.grassB);
        shader.uniforms.uCRockA = c(PALETTE.rockA);
        shader.uniforms.uCRockB = c(PALETTE.rockB);
        shader.uniforms.uCSlate = c(PALETTE.slate);
        shader.uniforms.uCPeak = c(PALETTE.peak);
        shader.uniforms.uCAsh = c(PALETTE.ash);
        shader.uniforms.uCPath = c(PALETTE.path);
        shader.uniforms.uCMagma = c(PALETTE.magma);
        mat.userData.shader = shader;

        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + VERT_PARS)
            .replace('#include <begin_vertex>', VERT_BODY);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
            // faint self-glow in the crater so it reads from spawn (audit acceptance)
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n    totalEmissiveRadiance += vec3(0.85, 0.10, 0.05) * gMagma * 0.55;');
    };
    return mat;
}

// One geometry template per LOD resolution: X/Z are chunk-LOCAL (relative to
// the chunk's own centre) and never change again — only Y (elevation, which
// differs per chunk instance) gets rewritten each time a pooled geometry is
// reassigned to a different chunk coordinate. This is the "reuse geometry
// buffers from a pool" the audit asked for: no new BufferGeometry allocation
// once the pool for a given LOD has warmed up.
function buildChunkTemplate(res) {
    const step = CHUNK_SIZE / (res - 1);
    const half = CHUNK_SIZE / 2;
    const topCount = res * res;
    const topIndexOf = (r, c) => r * res + c;

    // Perimeter walk (top row -> right col -> bottom row reversed -> left
    // col reversed), each corner counted once: length (res-1)*4.
    const perimTop = [];
    for (let c = 0; c < res; c++) perimTop.push(topIndexOf(0, c));
    for (let r = 1; r < res; r++) perimTop.push(topIndexOf(r, res - 1));
    for (let c = res - 2; c >= 0; c--) perimTop.push(topIndexOf(res - 1, c));
    for (let r = res - 2; r >= 1; r--) perimTop.push(topIndexOf(r, 0));

    const total = topCount + perimTop.length;
    const positions = new Float32Array(total * 3);
    for (let r = 0; r < res; r++) {
        for (let c = 0; c < res; c++) {
            const i = topIndexOf(r, c);
            positions[i * 3] = -half + c * step;
            positions[i * 3 + 1] = 0; // filled per-instance by fillChunkHeights()
            positions[i * 3 + 2] = -half + r * step;
        }
    }
    const skirtBase = topCount;
    for (let i = 0; i < perimTop.length; i++) {
        const ti = perimTop[i];
        positions[(skirtBase + i) * 3] = positions[ti * 3];
        positions[(skirtBase + i) * 3 + 1] = 0;
        positions[(skirtBase + i) * 3 + 2] = positions[ti * 3 + 2];
    }

    const indices = [];
    for (let r = 0; r < res - 1; r++) {
        for (let c = 0; c < res - 1; c++) {
            const a = topIndexOf(r, c), b = topIndexOf(r + 1, c), cc = topIndexOf(r + 1, c + 1), d = topIndexOf(r, c + 1);
            indices.push(a, b, d, b, cc, d);
        }
    }
    const m = perimTop.length;
    for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const t0 = perimTop[i], t1 = perimTop[j];
        const s0 = skirtBase + i, s1 = skirtBase + j;
        indices.push(t0, s0, t1, s0, s1, t1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    geo.setIndex(indices);
    geo.userData.perimTop = perimTop;
    geo.userData.topCount = topCount;
    return geo;
}

// Rewrites Y for every vertex of a (possibly pooled/reused) chunk geometry
// to the analytic bake's height at (cx,cz)'s world position, then drops the
// skirt ring by SKIRT_DEPTH and recomputes normals/bounds.
function fillChunkHeights(geo, cx, cz) {
    const pos = geo.attributes.position;
    const topCount = geo.userData.topCount;
    const wx0 = cx * CHUNK_SIZE, wz0 = cz * CHUNK_SIZE;
    for (let i = 0; i < topCount; i++) {
        pos.setY(i, analyticHeightAt(wx0 + pos.getX(i), wz0 + pos.getZ(i)));
    }
    const perimTop = geo.userData.perimTop;
    for (let i = 0; i < perimTop.length; i++) {
        pos.setY(topCount + i, pos.getY(perimTop[i]) - SKIRT_DEPTH);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
}

const key = (cx, cz) => cx + ',' + cz;

let sharedMat = null;
const active = new Map();          // key -> { mesh, cx, cz, res }
const pool = new Map();            // res -> Mesh[] (idle, geometry template reusable)
const pendingAdds = [];            // [{ cx, cz, res }] not yet built
const pendingKeys = new Set();     // dedupe against pendingAdds

function recycle(entry) {
    active.delete(key(entry.cx, entry.cz));
    entry.mesh.visible = false;
    let bucket = pool.get(entry.res);
    if (!bucket) { bucket = []; pool.set(entry.res, bucket); }
    bucket.push(entry.mesh);
}

function spawnChunk(cx, cz, res) {
    let mesh = (pool.get(res) || []).pop();
    if (mesh) {
        mesh.visible = true;
    } else {
        mesh = new THREE.Mesh(buildChunkTemplate(res), sharedMat);
        mesh.receiveShadow = true;
        mesh.castShadow = false; // B-07: avoid self-shadow acne — unchanged from the single-mesh version
        state.scene.add(mesh);
    }
    fillChunkHeights(mesh.geometry, cx, cz);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    active.set(key(cx, cz), { mesh, cx, cz, res });
}

// Diffs the desired chunk set against what's active, recycles anything
// stale immediately (cheap: just a visibility flag + pool push), and queues
// new builds to drain `budget` at a time — 1-2/frame during normal play so
// crossing into unexplored ground never spikes a frame, but a much larger
// budget on the very first call (during the loading screen already) so
// spawn isn't standing on bare ground waiting for chunks to trickle in.
function reconcile(px, pz, budget) {
    const pcx = Math.round(px / CHUNK_SIZE), pcz = Math.round(pz / CHUNK_SIZE);
    const desired = new Map();
    for (let dz = -DRAW_RADIUS; dz <= DRAW_RADIUS; dz++) {
        for (let dx = -DRAW_RADIUS; dx <= DRAW_RADIUS; dx++) {
            const r = Math.max(Math.abs(dx), Math.abs(dz));
            const res = lodForR(r);
            if (res) desired.set(key(pcx + dx, pcz + dz), { cx: pcx + dx, cz: pcz + dz, res });
        }
    }

    for (const [k, entry] of active) {
        const want = desired.get(k);
        if (!want || want.res !== entry.res) recycle(entry);
    }
    for (const [k, want] of desired) {
        if (active.has(k) || pendingKeys.has(k)) continue;
        pendingAdds.push(want);
        pendingKeys.add(k);
    }

    let n = 0;
    while (n < budget && pendingAdds.length) {
        const job = pendingAdds.shift();
        pendingKeys.delete(key(job.cx, job.cz));
        if (!active.has(key(job.cx, job.cz))) spawnChunk(job.cx, job.cz, job.res);
        n++;
    }
}

let lastPCX = null, lastPCZ = null;

export function createTerrainChunks(px, pz) {
    sharedMat = buildMaterial();
    reconcile(px, pz, Infinity); // full initial fill — this happens during the loading screen, same cost class as the old single-mesh build
    lastPCX = Math.round(px / CHUNK_SIZE); lastPCZ = Math.round(pz / CHUNK_SIZE);

    // Crater glow light - The Serpent's Coil
    const abyssLight = new THREE.PointLight(0xef4444, 5, 90);
    abyssLight.position.set(0, 40, -12);
    state.scene.add(abyssLight);
}

// Call every frame (main.js's animate()). Skips the O(169) desired-set
// rebuild entirely unless the player has actually crossed into a new chunk
// cell; pending builds from a previous crossing still drain at
// ADDS_PER_FRAME regardless, so a fast sprint across many chunks doesn't
// balloon a single frame.
export function updateTerrainChunks(px, pz) {
    if (!sharedMat) return;
    const pcx = Math.round(px / CHUNK_SIZE), pcz = Math.round(pz / CHUNK_SIZE);
    if (pcx !== lastPCX || pcz !== lastPCZ) {
        reconcile(px, pz, ADDS_PER_FRAME);
        lastPCX = pcx; lastPCZ = pcz;
    } else if (pendingAdds.length) {
        reconcile(px, pz, ADDS_PER_FRAME); // same cell, but still draining a previous crossing's queue
    }
}
