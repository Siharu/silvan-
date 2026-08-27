// Inland lake water plane. Uses the shared Gerstner shader in
// environment/water-shader.js, tuned to the reference demo's "Calm Lake"
// preset — see /mnt/user-data/uploads/ocean-water.html (Image 1: Time Speed
// 0.5, Wave Height Scale 1, Wave 2 dir 120/steepness 0.03/wavelength 8,
// matching that preset's defaults exactly).
//
// Sun/moon direction and sky color are fed live each frame from
// atmosphere/day-night-cycle.js via state.waterMaterial.userData.shader.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { createWaterMaterial } from './water-shader.js';
import { getElevation } from './terrain.js';

const CALM_LAKE_PRESET = {
    speed: 0.5,
    elevationScale: 1.0,
    depthColor: '#07182e',
    surfaceColor: '#1f6580',
    foamColor: '#ffffff',
    colorOffset: 0.5,
    colorMultiplier: 1.5,
    foamThreshold: 2.0,
    opacity: 0.45,
    waves: [
        { dir: 45,  steep: 0.05, len: 15 },
        { dir: 120, steep: 0.03, len: 8 },
        { dir: 200, steep: 0.01, len: 3 },
        { dir: 0,   steep: 0.0,  len: 1 }
    ]
};

export function createLake(state) {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 128, 128);
    geo.rotateX(-Math.PI / 2);

    state.waterMaterial = createWaterMaterial(CALM_LAKE_PRESET);
    state.waterMesh = new THREE.Mesh(geo, state.waterMaterial);
    state.waterMesh.position.y = 1.6; // Water surface level
    state.scene.add(state.waterMesh);

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
