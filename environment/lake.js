// Inland lake water plane. Uses THREE.Water (see
// environment/water-reflective.js) for real-time reflection — replaces the
// old custom Gerstner shader entirely (see water-reflective.js's header
// comment for why).
//
// Sun/moon direction and color are fed live each frame from
// atmosphere/day-night-cycle.js via state.waterMesh.userData/.material.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { createReflectiveWater } from './water-reflective.js';
import { getElevation } from './terrain.js';

export function createLake(state) {
    // Was a full WORLD_SIZE x WORLD_SIZE (1150x1150) plane — the terrain
    // only actually carves one lake basin near the origin (terrain.js:
    // `if (centerDist < 160) y -= ...`), but the water plane blanketed the
    // *entire* island regardless. Every other spot on the map where the
    // ordinary hill/valley noise happened to dip below y=1.6 on its own
    // (unrelated to the lake basin) showed through as fake pond/puddle
    // water, scattered everywhere instead of just the one real lake — this
    // was the actual cause of "too many puddles inside the island", not
    // puddles.js's rain decals. Sized to comfortably cover the basin
    // (radius 160) plus its shoreline out to ~250, and nothing further.
    const LAKE_SIZE = 520;
    // Deliberately NOT pre-rotated (no geo.rotateX call) — THREE.Water's
    // own constructor expects an unrotated geometry and applies the -90°
    // X rotation itself on the returned mesh object (see
    // water-reflective.js). See ocean.js for the same note.
    const geo = new THREE.PlaneGeometry(LAKE_SIZE, LAKE_SIZE, 96, 96);

    state.waterMesh = createReflectiveWater(state, {
        geometry: geo,
        y: 1.6, // Water surface level
        waterColor: 0x0c3b2e,
        distortionScale: 1.6,
        baseSize: 2.2,
        sunColorDay: 0xffffff,
        sunColorNight: 0x7c93ff,
    });
    state.waterMaterial = state.waterMesh.material;

    // Add stylized Lily Pads to the lake
    const lilyCount = 500;
    const LILY_RADIUS = WORLD_SIZE * 0.19; // stays within the lake basin, which doesn't grow 1:1 with WORLD_SIZE
    // Cylinder with a slice removed to look like a pac-man lily pad
    const lilyGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.05, 14, 1, false, 0, Math.PI * 1.8);
    const lilyMat = new THREE.MeshStandardMaterial({ color: 0x3d7a31, roughness: 0.9 });
    const lilyMesh = new THREE.InstancedMesh(lilyGeo, lilyMat, lilyCount);
    lilyMesh.receiveShadow = true;

    const lilyDummy = new THREE.Object3D();
    let lIdx = 0;
    for(let i=0; i < lilyCount * 3 && lIdx < lilyCount; i++) {
        const r = Math.random() * LILY_RADIUS;
        const th = Math.random() * Math.PI * 2;
        const x = Math.cos(th)*r; const z = Math.sin(th)*r;
        const y = getElevation(x,z);
        if(y < 1.4) { // Only place in the water basin
            lilyDummy.position.set(x, 1.62, z); // Sits on water
            lilyDummy.rotation.set(0, Math.random()*Math.PI*2, 0);
            const s = 0.4 + Math.random()*0.7;
            lilyDummy.scale.set(s, 1, s);
            lilyDummy.updateMatrix();
            lilyMesh.setMatrixAt(lIdx++, lilyDummy.matrix);
        }
    }
    lilyMesh.count = lIdx;
    state.scene.add(lilyMesh);
}