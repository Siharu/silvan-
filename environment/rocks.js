// Rock clusters + their colliders (pushed onto state.colliders).
//
// Previously all 1100 rock instances shared one InstancedMesh geometry with
// a single deterministic sin(x)*cos(y) deformation — since every instance
// reuses the exact same base geometry (just scaled/rotated per instance),
// every rock had the identical bump pattern, and the underlying icosahedron
// facets stayed visually obvious at any real size. Generated several
// distinct geometry variants with per-vertex jitter and non-uniform
// stretch so the field reads as irregular stone rather than repeated
// icosahedrons.
//
// Displacement noise upgraded from hand-rolled sin/cos octaves to real
// value-noise fBm (ported from a standalone rock-generator demo that did
// this via a live GLSL onBeforeCompile shader — fine for one rock, but
// wrong tool here: that approach recomputes noise on the GPU every frame
// for a single live-editable mesh, whereas we need geometry baked once
// into a handful of InstancedMesh variants shared across ~1,100 instances,
// so the noise is computed in JS at build time instead, same place the old
// sin/cos octaves ran). Also ported that demo's "rock type" concept
// (ROCK_TYPES below): distinct color-palette/roughness/flat-shading
// presets so the field actually reads as different kinds of stone —
// granite, sandstone, basalt, etc — not just the same gray boulder
// resized, plus its base/accent color-blend trick (there: a fragment
// shader mixing two colors by noise value; here: baked per-vertex colors
// on the InstancedMesh geometry, since there's no per-instance shader
// uniform to drive it live without breaking batching).
//
// Base geometry detail was bumped from 3 to 4 in an earlier pass under the
// belief that got to ~5,120 faces — that math was wrong. THREE.Icosahedron
// Geometry's actual face count is 20 * detail^2, not something like
// 20*4^4: detail 3 is 320 faces, detail 4 is only 500 (verified directly
// against three.js, not assumed). At the biggest rocks' ~5.5x base-radius
// scale, with the player able to walk right up against one, 500 faces —
// and even the first fix's 1,620 (detail 8) — wasn't enough to disappear
// into the noise deformation at close range.
//
// The temptation is to just crank detail way up (the reference rock-
// generator demo's own slider goes to 100), but that demo edits ONE live
// rock — we render ~1,100 instances via InstancedMesh. Instancing shares
// the geometry *buffer* (so building it at high detail doesn't cost more
// VRAM per instance), but the GPU still rasterizes every triangle for
// every instance separately — triangle throughput scales with instance
// count regardless of instancing. Detail 100 would be 204,020 triangles
// per rock; at ~1,100 instances that's ~224 million triangles/frame for
// rocks alone, on top of grass (1.1M blade instances), trees, and
// everything else — nowhere near an acceptable per-frame budget.
//
// Split by shading type instead of one flat number, following the source
// demo's own noted tradeoff ("if flat shading, lower detail looks better;
// if smooth, higher detail is needed" — flat-shaded facets stop reading as
// "crystalline" and start just being expensive once they're small enough
// to look smooth anyway, so pouring detail into basalt/slate past a point
// is pure waste). flatShaded types get detail 12 (3,380 tris), smooth types
// get detail 16 (5,780 tris) — averaged across ~1,100 instances split
// roughly evenly over 6 types, that's roughly 5.5M triangles/frame total
// for the whole rock field: a large jump from the previous 1.8M (detail 8
// flat everywhere) without approaching an unreasonable budget.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { getElevation } from './terrain.js';
import { addDynamicFog } from '../fx/dynamic-fog.js';
import { ROCK_DETAIL_PRESETS } from '../core/modifiers.js';

// Deterministic 3D hash -> [0,1). Same sin-based approach the old code used
// for jitter, extended to 3 inputs + a seed so it can drive real value
// noise below instead of just per-vertex jitter.
function hash3(x, y, z, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 269.5) * 43758.5453;
    return s - Math.floor(s);
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

// Trilinear-interpolated value noise — a lighter-weight stand-in for the
// demo's simplex noise (that ported cleanly to GLSL for live per-frame GPU
// evaluation; a full simplex implementation in JS is a lot more code for a
// difference that disappears once it's baked into static geometry and
// smoothed by multiple fBm octaves anyway).
function valueNoise3D(x, y, z, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const c000 = hash3(xi, yi, zi, seed), c100 = hash3(xi + 1, yi, zi, seed);
    const c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed);
    const c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed);
    const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return (y0 + (y1 - y0) * w) * 2 - 1; // remap [0,1] -> [-1,1]
}

// Fractal Brownian Motion: several octaves of the above, each higher-
// frequency octave contributing less (roughness) as frequency climbs
// (lacunarity) — same fBm structure as the source demo's GLSL version.
function fbm3D(x, y, z, freq, roughness, lacunarity, octaves, seed) {
    let amp = 1, f = freq, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * valueNoise3D(x * f, y * f, z * f, seed + o * 17.13);
        norm += amp;
        amp *= roughness;
        f *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0; // ~[-1, 1]
}

// Rock "types" — ported from the source demo's randomizeParams() palette
// list, with per-type noise character (noiseScale/roughness/lacunarity/
// octaves/displacement) instead of one shared look. flatShaded types get
// non-indexed geometry so normals aren't averaged across faces (a proper
// low-poly/crystalline look instead of the smoothed default).
//
// noiseScale/roughness/lacunarity/octaves were tuned down hard from an
// earlier pass after the detail-12/16 fix (see the detail-count history
// above) revealed a second problem: these values were originally chosen
// back when the geometry was too coarse to resolve them (detail 4, ~500
// tris), so the noise's higher octaves were aliasing into essentially
// random per-vertex jitter rather than a real coherent bump pattern — an
// accidental "anti-aliasing" that hid how genuinely high-frequency this
// noise field is. Once vertex density went up, that same noise became
// fully resolved, and it turned out to be way too high-frequency: rather
// than smooth rolling bumps, it produced a fine, dense sandpaper/static
// stipple across the whole surface (visibly "still looks like pixels"
// close up, even with plenty of polygons to work with — the poly count was
// never the remaining problem, the noise field's own spatial frequency
// was). Verified numerically (not just by eye) before landing on these
// numbers: computed the RMS noise difference between two points one
// typical vertex-spacing apart at each type's actual detail level, scaled
// by that type's displacement amount, as a proxy for the slope between
// adjacent triangles — old params produced slopes around 0.4-0.5 (a sharp
// ~20-25° normal swing vertex-to-vertex, exactly what reads as stippling
// under lighting); these produce 0.06-0.24, with the higher end
// intentionally kept for basalt/slate since those are meant to read
// craggier than sandstone/limestone, not because the noise is under-tuned.
//
// `detail` below is the "med" baseline only — the actual per-instance
// value used at build time comes from ROCK_DETAIL_PRESETS[state.modifiers.
// rockDetail] (core/modifiers.js, Settings-panel controlled) via
// buildRockVariant()'s `detailOverride` param, so this field exists mainly
// as documentation of what "med" (the default) means for each type.
// `noiseScale`/`disp` are similarly multiplied by state.modifiers.
// rockRoughness at build time rather than edited directly here.
const ROCK_TYPES = [
    { name: 'granite',   base: 0x5c6061, accent: 0x323536, noiseScale: 0.75, roughness: 0.35, lacunarity: 1.7, octaves: 3, disp: 0.32, flatShaded: false, detail: 16 },
    { name: 'sandstone', base: 0x8b7355, accent: 0x5c4033, noiseScale: 0.55, roughness: 0.3,  lacunarity: 1.6, octaves: 2, disp: 0.26, flatShaded: false, detail: 16 },
    { name: 'basalt',    base: 0x4a4a4a, accent: 0x212121, noiseScale: 1.0,  roughness: 0.35, lacunarity: 1.8, octaves: 3, disp: 0.38, flatShaded: true,  detail: 12 },
    { name: 'redrock',   base: 0xa86f58, accent: 0x693724, noiseScale: 0.65, roughness: 0.3,  lacunarity: 1.6, octaves: 2, disp: 0.3,  flatShaded: false, detail: 16 },
    { name: 'slate',     base: 0x707a75, accent: 0x45504a, noiseScale: 1.1,  roughness: 0.3,  lacunarity: 1.7, octaves: 3, disp: 0.4,  flatShaded: true,  detail: 12 },
    { name: 'limestone', base: 0xd1cdc2, accent: 0x8f8c85, noiseScale: 0.5,  roughness: 0.35, lacunarity: 1.6, octaves: 2, disp: 0.22, flatShaded: false, detail: 16 },
];

function buildRockVariant(type, seed, modifiers) {
    const detailPreset = ROCK_DETAIL_PRESETS[modifiers.rockDetail] || ROCK_DETAIL_PRESETS.med;
    const detail = type.flatShaded ? detailPreset.flat : detailPreset.smooth;
    // Named distinctly from the per-vertex `disp` local below (radius scale
    // factor for one vertex) — same name for two different things here
    // would silently shadow, and the modifier value would never actually
    // reach line ~196's calculation.
    const noiseScale = type.noiseScale * modifiers.rockRoughness;
    const dispAmount = type.disp * modifiers.rockRoughness;

    let geo = new THREE.IcosahedronGeometry(1, detail);
    if (type.flatShaded) geo = geo.toNonIndexed(); // no shared vertices -> computeVertexNormals below yields per-face (flat) normals

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // Deterministic per-variant hash so stretch/jitter still vary between
    // variants of the same type without needing a shared PRNG object.
    const hv = (n) => hash3(n, seed * 1.7, seed * 0.3, seed);
    const stretch = new THREE.Vector3(
        0.85 + hv(10) * 0.3,
        0.75 + hv(11) * 0.35,
        0.85 + hv(12) * 0.3
    );

    const baseColor = new THREE.Color(type.base);
    const accentColor = new THREE.Color(type.accent);
    const blendColor = new THREE.Color();

    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);

        const n = fbm3D(v.x, v.y, v.z, noiseScale, type.roughness, type.lacunarity, type.octaves, seed);

        // Small genuine per-vertex jitter on top of the smooth fBm, same
        // purpose as before — kills the "clearly a deformed platonic
        // solid" read at close range that pure smooth noise alone leaves.
        // Ported from a GLSL fract()-based hash, but JS's % isn't GLSL's
        // fract() — % returns a negative result for a negative operand
        // (e.g. -30000.4 % 1 === -0.4), while fract() is always positive.
        // That skewed this jitter asymmetrically instead of centering on 1.0.
        const jitterSeed = i * 12.9898 + seed * 78.233;
        const rawFrac = (Math.sin(jitterSeed) * 43758.5453) % 1;
        const frac = rawFrac < 0 ? rawFrac + 1 : rawFrac; // now matches GLSL fract()'s [0, 1) range
        const jitter = 1.0 + (frac - 0.5) * 0.06;

        const disp = 1.0 + n * dispAmount;
        v.multiplyScalar(disp * jitter);
        v.multiply(stretch);
        pos.setXYZ(i, v.x, v.y, v.z);

        // Bake the same noise value into a per-vertex base/accent color
        // blend the source demo did live in its fragment shader — darker
        // accent color pools in the noise troughs, base color on the
        // raised ridges, instead of one flat material color.
        const blend = THREE.MathUtils.smoothstep((n + 1) * 0.5, 0.3, 0.7);
        blendColor.copy(accentColor).lerp(baseColor, blend);
        colors[i * 3] = blendColor.r; colors[i * 3 + 1] = blendColor.g; colors[i * 3 + 2] = blendColor.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
}

export function createRocks(state) {
    const ROCK_FIELD_RADIUS = WORLD_SIZE * 0.4;
    const rockCount = state.quality.rockCount;
    const variantCount = ROCK_TYPES.length;

    const variantGeos = ROCK_TYPES.map((type, vi) => buildRockVariant(type, vi * 97.3 + 13, state.modifiers));

    // vertexColors on so each type's baked base/accent blend actually
    // shows — color left white since the per-vertex attribute now carries
    // the real color.
    const rockMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.1
    });
    addDynamicFog(rockMat, state.backgroundRenderTarget.texture);

    // Instances-per-variant capacity, sized with headroom since assignment
    // is now per-cluster (a whole outcrop shares one type — see below) not
    // strict round-robin, so variant counts won't come out perfectly even.
    // Guarded below with a skip-if-full check rather than trusting the
    // math exactly, since overflowing an InstancedMesh's fixed instance
    // buffer via setMatrixAt is a hard crash, not a graceful clamp.
    const capacityPerVariant = Math.ceil((rockCount / variantCount) * 1.6);
    const rockMeshes = variantGeos.map(g => new THREE.InstancedMesh(g, rockMat, capacityPerVariant));
    const instanceCounts = new Array(variantCount).fill(0);

    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let i = 0; i < 155; i++) {
        const r = 25 + Math.random() * ROCK_FIELD_RADIUS;
        const th = Math.random() * Math.PI * 2;
        const cx = Math.cos(th) * r; const cz = Math.sin(th) * r;
        const num = 2 + Math.floor(Math.random() * 5);
        // Each cluster rolls one type for every rock in it — clusters read
        // as an outcrop of the same stone rather than a grab-bag of random
        // types piled together.
        const clusterVariant = Math.floor(Math.random() * variantCount);
        for (let j = 0; j < num && idx < rockCount; j++) {
            const rx = cx + (Math.random() - 0.5) * 12;
            const rz = cz + (Math.random() - 0.5) * 12;
            let ry = getElevation(rx, rz);
            const s = 1.0 + Math.random() * 4.5;
            dummy.position.set(rx, ry - s * 0.2, rz);
            dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
            dummy.scale.set(s * (0.8 + Math.random() * 0.4), s * (0.6 + Math.random() * 0.4), s * (0.8 + Math.random() * 0.4));
            dummy.updateMatrix();

            if (instanceCounts[clusterVariant] >= capacityPerVariant) continue; // that type's InstancedMesh is full — skip rather than overflow its fixed instance buffer
            rockMeshes[clusterVariant].setMatrixAt(instanceCounts[clusterVariant]++, dummy.matrix);
            state.colliders.push({ x: rx, z: rz, r: s * 0.75 });
            idx++;
        }
    }

    rockMeshes.forEach((mesh, vi) => {
        mesh.count = instanceCounts[vi]; // trim unused instance slots so nothing renders at the origin/identity matrix
        state.scene.add(mesh);
    });
}
