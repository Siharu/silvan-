// Deciduous / maple trees — B-24 (audit 6.4 follow-up).
//
// Before: every tree ran its own recursive growBranch() call straight into
// THREE GLOBAL shared buffers (state.branchMatrices/leafMatrices etc.), so
// the whole forest's deciduous trees were only ever 3 InstancedMeshes
// (hi-res trunk, lo-res branch, leaf quad) built from thousands of
// per-branch/per-leaf matrices. Correct, but it meant every tree was a
// unique one-off shape baked straight into shared draw calls with no LOD —
// the opposite of what pine-tree.js does.
//
// After: same two-tier treatment pines got. DECID_VARIANTS seeded shapes,
// each one grown once and merged into TWO BufferGeometries (wood, leaves)
// => 2 draw calls per variant, one InstancedMesh instance per real tree.
// Per-tree biome colour (green vs autumn) rides on instanceColor so trees
// sharing a shape variant can still look different; per-depth bark
// darkening and per-leaf AO jitter are baked once into the geometry since
// they never varied per-tree anyway (same deterministic offsetHSL(depth)
// trick the old code used). A shared low-poly impostor swaps in past
// NEAR_RADIUS_DECID, exactly like pine's updatePineLOD.
import * as THREE from 'three';
import { state } from '../core/state.js';
import { mulberry32 } from '../core/rng.js';

export const DECID_VARIANTS = 6;
const BASE_LEN = 7.5, BASE_RAD = 0.75; // s=1 baseline; forest.js supplies per-tree scale via the placement matrix

// ---- shared unit geometries (built once, reused by every branch call) ----
function makeBumpyCylinder(radial, height) {
    const g = new THREE.CylinderGeometry(0.85, 1.25, 1, radial, height);
    const pos = g.attributes.position;
    for (let j = 0; j < pos.count; j++) {
        const x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
        const rad = Math.sqrt(x * x + z * z);
        if (rad > 0.1) {
            const angle = Math.atan2(z, x);
            const bump = 1.0 + 0.22 * Math.sin(angle * 4.0 + y * 8.0) + 0.15 * Math.cos(angle * 7.0 - y * 12.0) + 0.08 * Math.sin(angle * 13.0 + y * 20.0);
            const twist = y * 0.8;
            const nx = x * Math.cos(twist) - z * Math.sin(twist);
            const nz = x * Math.sin(twist) + z * Math.cos(twist);
            pos.setX(j, nx * bump); pos.setZ(j, nz * bump);
        }
    }
    g.computeVertexNormals();
    return g;
}
const HIGH_GEO = makeBumpyCylinder(16, 8); // depth 0-1: close enough to the eye to matter
const LOW_GEO = makeBumpyCylinder(6, 2);   // depth 2+: thin twigs, ~36 tris instead of 288
const LEAF_GEO = new THREE.PlaneGeometry(1.4, 1.4);

// ---- geometry accumulation (position/normal/color, non-indexed) ----------
class Acc {
    constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; }
    build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
        // B-38: the UVs were dropped here, so every leaf quad sampled texel (0,0) of the alpha-tested leaf
        // texture (transparent) and all leaves were discarded: the "bare trees" that got this LOD system reverted.
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.computeBoundingSphere();
        return g;
    }
}
const _v = new THREE.Vector3(), _n = new THREE.Vector3();
function addGeo(acc, geo, matrix, color) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uvs = geo.attributes.uv, idx = geo.index;
    const normalMat = new THREE.Matrix3().getNormalMatrix(matrix);
    const emit = (i) => {
        _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
        _n.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
        acc.p.push(_v.x, _v.y, _v.z); acc.n.push(_n.x, _n.y, _n.z);
        acc.c.push(color.r, color.g, color.b);
        if (uvs) acc.uv.push(uvs.getX(i), uvs.getY(i)); else acc.uv.push(0, 0);
    };
    if (idx) for (let i = 0; i < idx.count; i++) emit(idx.getX(i));
    else for (let i = 0; i < pos.count; i++) emit(i);
}

const baseTrunkColor = new THREE.Color(0x4b3b2d); // B-40: was 0x28201a, trunks read as black

function buildVariant(seed) {
    const rand = mulberry32(seed);
    const wood = new Acc(), leaves = new Acc();
    const maxDepth = rand() > 0.8 ? 5 : 4;

    function growBranch(matrix, depth, length, radius) {
        const branchMat = matrix.clone();
        const translate = new THREE.Matrix4().makeTranslation(0, length / 2, 0);
        const scale = new THREE.Matrix4().makeScale(radius, length, radius);
        branchMat.multiply(translate).multiply(scale);
        const bColor = baseTrunkColor.clone().offsetHSL(0, 0, depth * 0.04);
        addGeo(wood, depth <= 1 ? HIGH_GEO : LOW_GEO, branchMat, bColor);

        const endMat = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, length, 0));

        if (depth >= maxDepth) {
            for (let i = 0; i < 4; i++) {
                const leafRot = new THREE.Matrix4().makeRotationFromEuler(
                    new THREE.Euler(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
                );
                const leafScale = new THREE.Matrix4().makeScale(length * 3.2, length * 3.2, length * 3.2);
                const jitter = 0.82 + rand() * 0.36; // baked per-leaf AO/variation; multiplied by the tree's instance tint at draw time
                addGeo(leaves, LEAF_GEO, endMat.clone().multiply(leafRot).multiply(leafScale), new THREE.Color(jitter, jitter, jitter));
            }
            return;
        }

        const numSplits = depth === 0 ? 3 + Math.floor(rand() * 2) : (depth === 1 ? 3 : 2);
        for (let i = 0; i < numSplits; i++) {
            const angleY = (Math.PI * 2 / numSplits) * i + (rand() * 0.8 - 0.4);
            const angleX = 0.35 + (depth * 0.12) + (rand() * 0.2);
            const rotMat = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(angleX, angleY, 0, 'YXZ'));
            growBranch(endMat.clone().multiply(rotMat), depth + 1, length * (0.68 + rand() * 0.12), radius * 0.65);
        }
    }
    growBranch(new THREE.Matrix4(), 0, BASE_LEN, BASE_RAD);
    // B-40: AGGREGATE NORMALS (Peterson & Lee, "Simplified tree lighting using aggregate normals"; the
    // stylised-foliage trick behind BotW/Genshin canopies). A single leaf quad's own normal points in a random
    // direction, and double-sided quads facing away from the sun render black: the canopy looked like black
    // confetti. Blend each leaf's normal 85% toward "away from the canopy centre" (+ a little up) so the whole
    // crown shades as one soft sphere: lit on the sun side, gently darker underneath, never black.
    {
        const P = leaves.p, N = leaves.n;
        let cx = 0, cy = 0, cz = 0; const n = P.length / 3;
        for (let i = 0; i < P.length; i += 3) { cx += P[i]; cy += P[i + 1]; cz += P[i + 2]; }
        cx /= n; cy /= n; cz /= n;
        for (let i = 0; i < P.length; i += 3) {
            let ax = P[i] - cx, ay = P[i + 1] - cy + 1.5, az = P[i + 2] - cz;
            const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
            let nx = N[i], ny = N[i + 1], nz = N[i + 2];
            if (nx * ax + ny * ay + nz * az < 0) { nx = -nx; ny = -ny; nz = -nz; }
            const mx = ax * 0.85 + nx * 0.15, my = ay * 0.85 + ny * 0.15, mz = az * 0.85 + nz * 0.15;
            const ml = Math.hypot(mx, my, mz) || 1;
            N[i] = mx / ml; N[i + 1] = my / ml; N[i + 2] = mz / ml;
        }
    }
    return { wood: wood.build(), leaves: leaves.build() };
}

// ---- LOD (mirrors pine-tree.js's updatePineLOD) ---------------------------
const NEAR_RADIUS_DECID = 65;
const FAR_RADIUS_DECID = 520;   // beyond this the fog has swallowed the tree: draw nothing
const LOD_HYSTERESIS_DECID = 10;

// B-46: the far impostor was a 3.4u sphere on a 5.5u stick (~9.6u tall). The real trees measure
// ~22-30u tall with a ~15u crown radius, so at the 65u swap every tree shrank to a third of its size
// and read as a lollipop. This one is built to the real tree's measured envelope: a tall bare-ish
// trunk, then a wide lumpy crown made of several displaced blobs. Normals are "aggregate" normals
// (away from the crown centre, same trick as the near canopy in buildVariant) so it shades as one
// soft mass, and vertex colour darkens the underside. Three seeded shapes so the far forest is not
// one clone repeated. ~300 tris each.
const IMPOSTOR_SHAPES = 3;
const CROWN_CENTRE = new THREE.Vector3(0, 17.5, 0);
function impNoise(x, y, z, o) {
    return Math.sin(x * 0.9 + o) * Math.sin(y * 1.1 + o * 1.7) * Math.sin(z * 0.8 - o * 0.6) * 0.6
         + Math.sin(x * 2.1 - z * 1.7 + o * 2.3) * Math.sin(y * 1.9 + x * 1.3) * 0.4;
}
function buildImpostorGeometry(seed) {
    const rand = mulberry32(seed);
    const P = [], N = [], C = [], L = [];   // L = 1 for crown vertices (take the biome tint), 0 for trunk
    const woodCol = new THREE.Color(0x4b3b2d);
    {   // trunk: tapered, runs well up into the crown so the gap under it is never see-through
        const g = new THREE.CylinderGeometry(0.55, 1.0, 17, 6, 1).toNonIndexed();
        g.translate(0, 8.5, 0);
        const pa = g.attributes.position, na = g.attributes.normal;
        for (let i = 0; i < pa.count; i++) {
            P.push(pa.getX(i), pa.getY(i), pa.getZ(i)); N.push(na.getX(i), na.getY(i), na.getZ(i));
            C.push(woodCol.r, woodCol.g, woodCol.b); L.push(0);
        }
    }
    // blobs: [cx, cy, cz, rx, ry, rz, icosa detail]; first three are fixed (broad base, body, top), the rest scatter
    const blobs = [
        [0, 12.8, 0, 9.5 + rand() * 1.5, 4.2, 9.5 + rand() * 1.5, 1],
        [0, 18.0, 0, 11.5 + rand() * 1.5, 8.5, 11.5 + rand() * 1.5, 1],
        [(rand() - 0.5) * 2, 24.6, (rand() - 0.5) * 2, 6.8 + rand(), 5.2, 6.8 + rand(), 1],
    ];
    const nSat = 3;
    const a0 = rand() * Math.PI * 2;
    for (let i = 0; i < nSat; i++) {
        const a = a0 + (i / nSat) * Math.PI * 2 + (rand() - 0.5) * 0.9;
        const r = 7.5 + rand() * 2.5, y = 13.5 + rand() * 8;
        blobs.push([Math.cos(a) * r, y, Math.sin(a) * r, 5.2 + rand() * 1.4, 4.2 + rand(), 5.2 + rand() * 1.4, 0]);
    }
    const noiseOff = rand() * 40;
    const v = new THREE.Vector3(), out = new THREE.Vector3(), agg = new THREE.Vector3();
    for (const [cx, cy, cz, rx, ry, rz, det] of blobs) {
        const g = new THREE.IcosahedronGeometry(1, det);          // non-indexed: 3 verts per tri
        const pa = g.attributes.position;
        for (let i = 0; i < pa.count; i++) {
            out.set(pa.getX(i), pa.getY(i), pa.getZ(i)).normalize();   // blob-local outward direction
            v.set(cx + out.x * rx, cy + out.y * ry, cz + out.z * rz);
            const k = 1 + 0.17 * impNoise(v.x, v.y, v.z, noiseOff);     // lumpy, deterministic per position so shared verts stay welded
            v.set(cx + out.x * rx * k, cy + out.y * ry * k, cz + out.z * rz * k);
            // aggregate normal: mostly "away from the crown centre" (+ a little up), a little blob form
            agg.copy(v).sub(CROWN_CENTRE); agg.y += 1.5; agg.normalize();
            const nx = agg.x * 0.65 + out.x * 0.35, ny = agg.y * 0.65 + out.y * 0.35, nz = agg.z * 0.65 + out.z * 0.35;
            const nl = Math.hypot(nx, ny, nz) || 1;
            // brightness: dark underside / lower crown, lighter top, mild mottling; instance tint multiplies this
            const t = THREE.MathUtils.clamp((v.y - 8) / 22, 0, 1);
            let b = 0.58 + 0.52 * t + 0.07 * impNoise(v.x * 1.7, v.y * 1.7, v.z * 1.7, noiseOff + 9);
            if (out.y < 0) b *= 0.86 + 0.14 * (1 + out.y);
            P.push(v.x, v.y, v.z); N.push(nx / nl, ny / nl, nz / nl); C.push(b, b, b); L.push(1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(L, 1));
    g.computeBoundingSphere();
    return g;
}

// Impostor material: trunk must NOT take the biome tint (instanceColor multiplies every vertex by default),
// and a little world-space mottling breaks up the flat look of an unlit-ish low-poly mass at range.
function makeImpostorMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aLeaf;\nvarying float vLeaf;\nvarying vec3 vImpPos;')
            .replace('#include <color_vertex>', `#include <color_vertex>
            #ifdef USE_INSTANCING_COLOR
            vColor.xyz = mix(vColor.xyz / max(instanceColor.xyz, vec3(1e-4)), vColor.xyz, aLeaf);
            #endif
            vLeaf = aLeaf;`)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvImpPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vLeaf;\nvarying vec3 vImpPos;')
            .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
            float impM1 = sin(vImpPos.x * 1.3 + vImpPos.y * 0.6) * sin(vImpPos.z * 1.1 - vImpPos.y * 0.8);
            float impM2 = sin(vImpPos.x * 3.1 + vImpPos.z * 2.7) * sin(vImpPos.y * 2.9 + vImpPos.x * 1.7);
            diffuseColor.rgb *= 1.0 + vLeaf * (0.10 * impM1 + 0.06 * impM2);`);
    };
    return m;
}

const impostorMeshes = [];   // one InstancedMesh per far shape (variant v uses shape v % IMPOSTOR_SHAPES)
let variants = null;
const buckets = []; // per variant: { m: Matrix4[], c: number[] } — c is the per-tree leaf tint (biome colour)
const nearWood = [], nearLeaves = [];
let lodLastPx = null, lodLastPz = null;
let uTime = { value: 0 };

export function beginDeciduous(seedBase = 0x7a21) {
    variants = [];
    for (let v = 0; v < DECID_VARIANTS; v++) { variants.push(buildVariant(seedBase + v * 7919)); buckets.push({ m: [], c: [] }); }
}

export function pickDeciduousVariant(rand) { return Math.floor(rand() * DECID_VARIANTS); }

// baseMatrix = world placement (translate + yaw), s = uniform size factor, leafColor = THREE.Color biome tint
export function addDeciduous(variant, baseMatrix, s, leafColor) {
    const mat = baseMatrix.clone().multiply(new THREE.Matrix4().makeScale(s, s, s));
    buckets[variant].m.push(mat);
    buckets[variant].c.push(leafColor.r, leafColor.g, leafColor.b);
}

export function finishDeciduous(leafTexture) {
    const trunkMat = new THREE.MeshStandardMaterial({ roughness: 0.95, color: 0xffffff, vertexColors: true });
    trunkMat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n varying vec3 vLocalPos;\n varying vec3 vWorldNormal;\n varying vec3 vWorldPos;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>\n vLocalPos = position;\n vWorldPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`)
            .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>\n vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n varying vec3 vLocalPos;\n varying vec3 vWorldNormal;\n varying vec3 vWorldPos;`)
            .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
            vec4 diffuseColor = vec4( diffuse, opacity );
            float barkNoise = sin(vLocalPos.x * 12.0 + vLocalPos.y * 4.0) * cos(vLocalPos.z * 12.0 + vLocalPos.y * 4.0);
            barkNoise = smoothstep(-1.0, 1.0, barkNoise);
            vec3 barkDark = diffuse * 0.35;
            diffuseColor.rgb = mix(barkDark, diffuse, barkNoise * 0.5 + 0.5);
            float upFactor = clamp(vWorldNormal.y + 0.1, 0.0, 1.0);
            float heightFactor = clamp(1.0 - (vWorldPos.y / 25.0), 0.0, 1.0);
            float n = sin(vWorldPos.x * 6.0) * cos(vWorldPos.y * 8.0) * sin(vWorldPos.z * 6.0);
            float mossAmount = clamp((upFactor * heightFactor * 0.95) + (n * 0.25), 0.0, 1.0);
            vec3 mossColor = vec3(0.12, 0.28, 0.08);
            diffuseColor.rgb = mix(diffuseColor.rgb, mossColor, mossAmount);
            `);
    };

    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide, map: leafTexture, alphaTest: 0.4, transparent: true, vertexColors: true });
    leafMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uTime;
        leafMat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n uniform float uTime;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
            vec4 leafWorldPos = instanceMatrix * vec4(position, 1.0);
            float flutter = sin(leafWorldPos.x * 4.0 + uTime * 2.5) * cos(leafWorldPos.z * 4.0 + uTime * 1.8) * 0.08;
            transformed.xyz += flutter;`);
    };

    for (let v = 0; v < DECID_VARIANTS; v++) {
        const b = buckets[v];
        if (!b.m.length) { nearWood.push(null); nearLeaves.push(null); continue; }
        const make = (geo, mat, castsShadow, tinted) => {
            const im = new THREE.InstancedMesh(geo, mat, b.m.length);
            for (let i = 0; i < b.m.length; i++) im.setMatrixAt(i, b.m[i]);
            // Bark colour is baked (depth-based darkening only, same every tree) — only the
            // leaf mesh gets the per-tree biome tint (green/autumn) via instanceColor.
            const colArr = tinted ? new Float32Array(b.c) : new Float32Array(b.m.length * 3).fill(1);
            im.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
            im.castShadow = castsShadow; im.receiveShadow = true;
            im.computeBoundingSphere();
            state.scene.add(im);
            return im;
        };
        const w = make(variants[v].wood, trunkMat, true, false); w.count = 0; nearWood.push(w);
        // leaf shadows disabled: same overdraw reasoning as the old forest.js leaf mesh (overlapping transparent shadows x thousands of instances)
        const lf = make(variants[v].leaves, leafMat, false, true); lf.count = 0; nearLeaves.push(lf);
    }

    const impostorMat = makeImpostorMaterial();
    for (let g = 0; g < IMPOSTOR_SHAPES; g++) {
        let cap = 0;
        for (let v = g; v < DECID_VARIANTS; v += IMPOSTOR_SHAPES) cap += buckets[v].m.length;
        if (cap <= 0) { impostorMeshes.push(null); continue; }
        const im = new THREE.InstancedMesh(buildImpostorGeometry(0x1d3a + g * 7717), impostorMat, cap);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        im.count = 0;
        im.castShadow = false;
        im.receiveShadow = true;
        im.frustumCulled = false; // buffer contents keep changing as the player moves; see pine-tree.js's identical note
        state.scene.add(im);
        impostorMeshes.push(im);
    }
    lodLastPx = null;
}

export function updateDeciduousLOD(px, pz) {
    if (!impostorMeshes.length) return;
    if (lodLastPx !== null) {
        const moved = Math.hypot(px - lodLastPx, pz - lodLastPz);
        if (moved < LOD_HYSTERESIS_DECID) return;
    }
    lodLastPx = px; lodLastPz = pz;

    const r2 = NEAR_RADIUS_DECID * NEAR_RADIUS_DECID, f2 = FAR_RADIUS_DECID * FAR_RADIUS_DECID;
    const farI = new Array(IMPOSTOR_SHAPES).fill(0);
    for (let v = 0; v < DECID_VARIANTS; v++) {
        const b = buckets[v];
        const wood = nearWood[v], leaf = nearLeaves[v];
        const imp = impostorMeshes[v % IMPOSTOR_SHAPES], gi = v % IMPOSTOR_SHAPES;
        if (!wood) continue;
        let nearI = 0;
        for (let i = 0; i < b.m.length; i++) {
            const m = b.m[i];
            const dx = m.elements[12] - px, dz = m.elements[14] - pz;
            if (dx * dx + dz * dz <= r2) {
                wood.setMatrixAt(nearI, m);
                leaf.setMatrixAt(nearI, m);
                leaf.instanceColor.setXYZ(nearI, b.c[i * 3], b.c[i * 3 + 1], b.c[i * 3 + 2]);
                nearI++;
            } else if (dx * dx + dz * dz <= f2) {
                imp.setMatrixAt(farI[gi], m);
                imp.instanceColor.setXYZ(farI[gi], b.c[i * 3], b.c[i * 3 + 1], b.c[i * 3 + 2]);
                farI[gi]++;
            }
        }
        wood.count = nearI; leaf.count = nearI;
        wood.instanceMatrix.needsUpdate = true; leaf.instanceMatrix.needsUpdate = true;
        leaf.instanceColor.needsUpdate = true;
    }
    for (let g = 0; g < IMPOSTOR_SHAPES; g++) {
        const im = impostorMeshes[g]; if (!im) continue;
        im.count = farI[g];
        im.instanceMatrix.needsUpdate = true;
        im.instanceColor.needsUpdate = true;
    }
}

export function updateDeciduousSway(dt) { uTime.value += dt; }