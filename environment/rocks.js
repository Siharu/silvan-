// Rock clusters + their colliders (pushed onto state.colliders).
//
// Previously all 1100 rock instances shared one InstancedMesh geometry with
// a single deterministic sin(x)*cos(y) deformation — since every instance
// reuses the exact same base geometry (just scaled/rotated per instance),
// every rock had the identical bump pattern, and the underlying icosahedron
// facets stayed visually obvious at any real size. Now generates several
// distinct geometry variants, each deformed with its own randomized
// multi-octave noise (different frequencies/phases/amplitudes per variant,
// plus genuine per-vertex jitter) and a slight non-uniform stretch, so the
// rock field actually reads as irregular stone rather than repeated
// geometric icosahedrons. One InstancedMesh per variant — instances are
// still batched for performance, just spread across a handful of shapes
// instead of one.
//
// Base geometry detail was 3 (1,280 faces) — fine at a distance, but the
// biggest rocks scale up to ~5.5x base radius (see the `s` roll below) and
// the player can walk right up against one, at which point each of those
// 1,280 faces covers enough screen space to read as a flat geometric plane
// rather than stone. Bumped to detail 4 (5,120 faces) so close-range facets
// stay small enough to disappear into the noise deformation instead of
// standing out as panels.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { getElevation } from './terrain.js';
import { addDynamicFog } from '../fx/dynamic-fog.js';

const ROCK_VARIANT_COUNT = 5;

function buildRockVariant(seed) {
    // Simple deterministic hash so each variant is reproducible run-to-run
    // (matters for consistent colliders/visuals) without needing a shared
    // PRNG object passed around.
    function hash(n) {
        const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
        return s - Math.floor(s);
    }

    const geo = new THREE.IcosahedronGeometry(1, 4);
    const pos = geo.attributes.position;

    // Each variant gets its own randomized frequency/phase/amplitude per
    // octave, so variants don't just look like phase-shifted copies of the
    // same wave.
    const octaves = [
        { freq: 1.5 + hash(seed + 1) * 2.0, amp: 0.22 + hash(seed + 2) * 0.1, phase: hash(seed + 3) * 6.28 },
        { freq: 3.0 + hash(seed + 4) * 3.0, amp: 0.09 + hash(seed + 5) * 0.06, phase: hash(seed + 6) * 6.28 },
        { freq: 6.0 + hash(seed + 7) * 5.0, amp: 0.04 + hash(seed + 8) * 0.03, phase: hash(seed + 9) * 6.28 },
    ];
    // Slight non-uniform axis stretch, baked into the geometry itself
    // (distinct from the per-instance dummy.scale applied later) — breaks
    // up the otherwise-perfect icosahedral silhouette further.
    const stretch = new THREE.Vector3(
        0.85 + hash(seed + 10) * 0.3,
        0.75 + hash(seed + 11) * 0.35,
        0.85 + hash(seed + 12) * 0.3
    );

    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let disp = 1.0;
        for (const o of octaves) {
            disp += o.amp * Math.sin(v.x * o.freq + o.phase) * Math.cos(v.y * o.freq * 0.87 + o.phase * 1.3) * Math.sin(v.z * o.freq * 0.6 + o.phase * 0.7);
        }
        // Small genuine per-vertex jitter on top of the smooth noise, so
        // even neighboring vertices aren't perfectly predictable from the
        // wave functions alone — this is what actually kills the "clearly
        // a deformed platonic solid" read at close range.
        const jitterSeed = i * 12.9898 + seed * 78.233;
        const jitter = 1.0 + (((Math.sin(jitterSeed) * 43758.5453) % 1) - 0.5) * 0.06;
        v.multiplyScalar(disp * jitter);
        v.multiply(stretch);
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
}

export function createRocks(state) {
    const ROCK_FIELD_RADIUS = WORLD_SIZE * 0.4;
    const rockCount = state.quality.rockCount;

    const variantGeos = [];
    for (let vi = 0; vi < ROCK_VARIANT_COUNT; vi++) variantGeos.push(buildRockVariant(vi * 97.3 + 13));

    const rockMat = new THREE.MeshStandardMaterial({
        color: 0x4a4f55,
        roughness: 0.9,
        metalness: 0.1
    });
    addDynamicFog(rockMat, state.backgroundRenderTarget.texture);

    // Instances-per-variant capacity, sized exactly to fit since assignment
    // below is round-robin (not random) — guarantees every rock that gets a
    // collider also gets a visible mesh slot, with no possibility of a
    // variant overflowing and silently leaving an invisible-but-still-
    // collidable rock (which random assignment with a "probably enough"
    // headroom could risk).
    const capacityPerVariant = Math.ceil(rockCount / ROCK_VARIANT_COUNT);
    const rockMeshes = variantGeos.map(g => new THREE.InstancedMesh(g, rockMat, capacityPerVariant));
    const instanceCounts = new Array(ROCK_VARIANT_COUNT).fill(0);

    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let i = 0; i < 155; i++) {
        const r = 25 + Math.random() * ROCK_FIELD_RADIUS;
        const th = Math.random() * Math.PI * 2;
        const cx = Math.cos(th) * r; const cz = Math.sin(th) * r;
        const num = 2 + Math.floor(Math.random() * 5);
        for (let j = 0; j < num && idx < rockCount; j++) {
            const rx = cx + (Math.random() - 0.5) * 12;
            const rz = cz + (Math.random() - 0.5) * 12;
            let ry = getElevation(rx, rz);
            const s = 1.0 + Math.random() * 4.5;
            dummy.position.set(rx, ry - s * 0.2, rz);
            dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
            dummy.scale.set(s * (0.8 + Math.random() * 0.4), s * (0.6 + Math.random() * 0.4), s * (0.8 + Math.random() * 0.4));
            dummy.updateMatrix();

            const variant = idx % ROCK_VARIANT_COUNT; // round-robin, not random — see capacity comment above
            rockMeshes[variant].setMatrixAt(instanceCounts[variant]++, dummy.matrix);
            state.colliders.push({ x: rx, z: rz, r: s * 0.75 });
            idx++;
        }
    }

    rockMeshes.forEach((mesh, vi) => {
        mesh.count = instanceCounts[vi]; // trim unused instance slots so nothing renders at the origin/identity matrix
        state.scene.add(mesh);
    });
}

