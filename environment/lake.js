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

// Values from a hand-tuned JSON preset (water-style.json). skyColor isn't
// part of this shape: it's not a static preset value at all, it's fed live
// every frame from the actual sky gradient (u_skyColor, see
// atmosphere/day-night-cycle.js's updateAtmosphere) so the horizon fresnel
// always matches whatever's really behind it — a fixed skyColor here would
// just be overwritten the next frame, so it's intentionally left out
// rather than silently ignored.
const CALM_LAKE_PRESET = {
    speed: 0.2552,
    elevationScale: 1.3601,
    depthColor: '#07182e',
    surfaceColor: '#7cd9fd',
    foamColor: '#ffffff',
    colorOffset: 0.853,
    // Previous fix (opacity 0.1->0.62) wasn't enough — misread the shader
    // formula. It's NOT `colorOffset + waveHeight*colorMultiplier`, it's
    // `(vElevation + colorOffset) * colorMultiplier` (water-shader.js line
    // ~106). At the old colorMultiplier 0.1, mixStrength on calm water
    // (vElevation≈0) was (0+0.853)*0.1≈0.085 — smoothstep collapses that
    // to nearly 0, so the lake was rendering almost pure u_depthColor
    // (#07182e, near-black navy), not the bright cyan u_surfaceColor —
    // opaque now, but opaquely dark, which reads just as "invisible" against
    // equally-dark surrounding ground. 0.45 (my last attempt) only got
    // mixStrength to ~0.38 — still mostly depthColor. 1.1 puts calm water
    // at mixStrength≈0.94 (mostly bright surfaceColor), while wave troughs
    // still pull it toward depthColor for actual depth variation instead of
    // a flat color.
    colorMultiplier: 1.1,
    foamThreshold: 3,
    opacity: 0.7,
    waves: [
        { dir: 45,  steep: 0.05, len: 15 },
        { dir: 120, steep: 0.03, len: 8 },
        { dir: 200, steep: 0.01, len: 3 },
        { dir: 0,   steep: 0,    len: 1 }
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