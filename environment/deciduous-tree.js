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
    constructor() { this.p = []; this.n = []; this.c = []; }
    build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
        g.computeBoundingSphere();
        return g;
    }
}
const _v = new THREE.Vector3(), _n = new THREE.Vector3();
function addGeo(acc, geo, matrix, color) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index;
    const normalMat = new THREE.Matrix3().getNormalMatrix(matrix);
    const emit = (i) => {
        _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
        _n.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
        acc.p.push(_v.x, _v.y, _v.z); acc.n.push(_n.x, _n.y, _n.z);
        acc.c.push(color.r, color.g, color.b);
    };
    if (idx) for (let i = 0; i < idx.count; i++) emit(idx.getX(i));
    else for (let i = 0; i < pos.count; i++) emit(i);
}

const baseTrunkColor = new THREE.Color(0x28201a);

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
    return { wood: wood.build(), leaves: leaves.build() };
}

// ---- LOD (mirrors pine-tree.js's updatePineLOD) ---------------------------
const NEAR_RADIUS_DECID = 70;
const LOD_HYSTERESIS_DECID = 12;

function buildImpostorGeometry() {
    const trunk = new THREE.CylinderGeometry(0.5, 0.9, 5.5, 5, 1);
    trunk.translate(0, 2.75, 0);
    const canopy = new THREE.SphereGeometry(3.4, 7, 5);
    canopy.translate(0, 6.2, 0);
    const woodCol = new THREE.Color(0x3a2e22), leafCol = new THREE.Color(0xffffff); // leafCol stays white so instance tint (biome colour) reads true at distance
    const pa = trunk.attributes.position, pb = canopy.attributes.position;
    const positions = new Float32Array((pa.count + pb.count) * 3);
    positions.set(pa.array, 0); positions.set(pb.array, pa.array.length);
    const normals = new Float32Array((pa.count + pb.count) * 3);
    normals.set(trunk.attributes.normal.array, 0); normals.set(canopy.attributes.normal.array, trunk.attributes.normal.array.length);
    const colors = new Float32Array((pa.count + pb.count) * 3);
    for (let i = 0; i < pa.count; i++) colors.set([woodCol.r, woodCol.g, woodCol.b], i * 3);
    for (let i = 0; i < pb.count; i++) colors.set([leafCol.r, leafCol.g, leafCol.b], (pa.count + i) * 3);
    const ia = trunk.index.array, ib = canopy.index.array;
    const indices = new Uint32Array(ia.length + ib.length);
    indices.set(ia, 0);
    for (let i = 0; i < ib.length; i++) indices[ia.length + i] = ib[i] + pa.count;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    return g;
}

let impostorMesh = null, impostorCapacity = 0;
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
        nearWood.push(make(variants[v].wood, trunkMat, true, false));
        // leaf shadows disabled: same overdraw reasoning as the old forest.js leaf mesh (overlapping transparent shadows x thousands of instances)
        nearLeaves.push(make(variants[v].leaves, leafMat, false, true));
    }

    impostorCapacity = buckets.reduce((s, b) => s + b.m.length, 0);
    if (impostorCapacity > 0) {
        const impostorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
        impostorMesh = new THREE.InstancedMesh(buildImpostorGeometry(), impostorMat, impostorCapacity);
        impostorMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(impostorCapacity * 3), 3);
        impostorMesh.count = 0;
        impostorMesh.castShadow = false;
        impostorMesh.receiveShadow = true;
        impostorMesh.frustumCulled = false; // buffer contents keep changing as the player moves; see pine-tree.js's identical note
        state.scene.add(impostorMesh);
    }
}

export function updateDeciduousLOD(px, pz) {
    if (!impostorMesh) return;
    if (lodLastPx !== null) {
        const moved = Math.hypot(px - lodLastPx, pz - lodLastPz);
        if (moved < LOD_HYSTERESIS_DECID) return;
    }
    lodLastPx = px; lodLastPz = pz;

    const r2 = NEAR_RADIUS_DECID * NEAR_RADIUS_DECID;
    let farI = 0;
    for (let v = 0; v < DECID_VARIANTS; v++) {
        const b = buckets[v];
        const wood = nearWood[v], leaf = nearLeaves[v];
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
            } else {
                impostorMesh.setMatrixAt(farI, m);
                impostorMesh.instanceColor.setXYZ(farI, b.c[i * 3], b.c[i * 3 + 1], b.c[i * 3 + 2]);
                farI++;
            }
        }
        wood.count = nearI; leaf.count = nearI;
        wood.instanceMatrix.needsUpdate = true; leaf.instanceMatrix.needsUpdate = true;
        leaf.instanceColor.needsUpdate = true;
    }
    impostorMesh.count = farI;
    impostorMesh.instanceMatrix.needsUpdate = true;
    impostorMesh.instanceColor.needsUpdate = true;
}

export function updateDeciduousSway(dt) { uTime.value += dt; }
