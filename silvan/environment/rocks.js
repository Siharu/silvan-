import * as THREE from 'three';
import { state, WATER_LEVEL, WORLD_SIZE } from '../core/state.js';
import { heightAt as getElevation } from '../core/heightmap.js';
import { pathAt } from '../core/splat.js';

import { rngFor } from '../core/rng.js';
const rand = rngFor('rocks');

// Rock LOD (audit STEP 3): every rock used to draw the same detail-2
// icosahedron (~320 tris) regardless of distance - at up to 900 rocks that's
// ~290k triangles paid for even on rocks the player will never see up close.
// Two InstancedMeshes sharing one material, same bumpy-deformation function
// applied to both so the low-poly version reads as "the same rock, fewer
// facets" rather than a visibly different shape when it swaps in:
//   NEAR (within ROCK_LOD_RADIUS): detail-2, ~320 tris.
//   FAR: detail-0, 20 tris - a rock silhouette is still legible that coarse
//   from the distance where it switches, and nobody stands still long enough
//   at the LOD boundary to see facets changing (it only recomputes when the
//   player has moved ROCK_LOD_HYSTERESIS to avoid redoing this every frame).
// Both meshes are sized to the full rock count up front (cheap: capacity,
// not draw cost - only .count instances in each actually render) and
// re-partitioned by updateRockLOD(), which rewrites each mesh's matrix
// buffer with just its current subset compacted to the front.
const ROCK_LOD_RADIUS = 55;
const ROCK_LOD_HYSTERESIS = 10; // re-partition only after the player moves this far

function deform(geo) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        v.multiplyScalar(1.0 + 0.25 * Math.sin(v.x * 4.0) * Math.cos(v.y * 4.0));
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
}

let rockData = [];               // { matrix, x, z } for every rock actually placed
let meshNear = null, meshFar = null;
let lastPx = null, lastPz = null;

export function createRocks() {
    const rockCount = 900; // was 550, scaled by 1.64x world area
    const rockMat = new THREE.MeshStandardMaterial({
        color: 0x4a4f55,
        roughness: 0.9,
        metalness: 0.1
    });

    meshNear = new THREE.InstancedMesh(deform(new THREE.IcosahedronGeometry(1, 2)), rockMat, rockCount);
    meshFar = new THREE.InstancedMesh(deform(new THREE.IcosahedronGeometry(1, 0)), rockMat, rockCount);
    meshNear.count = 0; meshFar.count = 0; // updateRockLOD() fills these in before the first render
    // The LOD split keeps reassigning which rocks occupy which mesh, so a
    // bounding sphere computed once at build time (or lazily from whatever
    // happens to be in the buffer at that moment) would go stale and could
    // cull rocks that are actually on screen. Same call grass.js makes for
    // the same reason.
    meshNear.frustumCulled = false;
    meshFar.frustumCulled = false;
    state.scene.add(meshNear);
    state.scene.add(meshFar);

    const dummy = new THREE.Object3D();
    rockData = [];
    for (let i = 0; i < 123; i++) { // was 75, scaled by 1.64x world area
        const r = 25 + rand() * (WORLD_SIZE * 0.4 - 25); // was hardcoded 320 (0.4 * old 800) — now scales with world size
        const th = rand() * Math.PI * 2;
        const cx = Math.cos(th) * r; const cz = Math.sin(th) * r;
        const num = 2 + Math.floor(rand() * 5);
        for (let j = 0; j < num && rockData.length < rockCount; j++) {
            const rx = cx + (rand() - 0.5) * 12;
            const rz = cz + (rand() - 0.5) * 12;
            let ry = getElevation(rx, rz);
            // Phase 7 #39: elevation floor, matching forest.js/flowers.js — skip
            // rocks that would spawn on seabed under the water surface.
            if (ry < WATER_LEVEL) continue;
            if (pathAt(rx, rz) > 0.2) continue; // keep trails walkable
            const s = 1.0 + rand() * 4.5;
            dummy.position.set(rx, ry - s*0.2, rz);
            dummy.rotation.set(0, rand()*Math.PI*2, 0);
            dummy.scale.set(s*(0.8+rand()*0.4), s*(0.6+rand()*0.4), s*(0.8+rand()*0.4));
            dummy.updateMatrix();
            rockData.push({ matrix: dummy.matrix.clone(), x: rx, z: rz });
            state.colliders.push({ x: rx, z: rz, r: s * 0.75 });
        }
    }
}

// Re-partitions rockData into meshNear/meshFar by distance to (px,pz).
// Cheap (≤900 distance checks + matrix writes), so the only reason to
// throttle at all is to avoid doing it every single frame for nothing.
export function updateRockLOD(px, pz) {
    if (!rockData.length) return;
    if (lastPx !== null) {
        const moved = Math.hypot(px - lastPx, pz - lastPz);
        if (moved < ROCK_LOD_HYSTERESIS) return;
    }
    lastPx = px; lastPz = pz;

    const r2 = ROCK_LOD_RADIUS * ROCK_LOD_RADIUS;
    let nearI = 0, farI = 0;
    for (const rock of rockData) {
        const dx = rock.x - px, dz = rock.z - pz;
        if (dx * dx + dz * dz <= r2) meshNear.setMatrixAt(nearI++, rock.matrix);
        else meshFar.setMatrixAt(farI++, rock.matrix);
    }
    meshNear.count = nearI; meshFar.count = farI;
    meshNear.instanceMatrix.needsUpdate = true;
    meshFar.instanceMatrix.needsUpdate = true;
}

