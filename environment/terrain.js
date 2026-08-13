// Value-noise terrain primitives + the ground mesh.
// getElevation() is imported by nearly every other environment/fx module
// (grass, flowers, forest, lake, puddles, rocks, player controller) to
// place things on/at the ground height.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';

export function hash(x, y) {
    let dot = x * 12.9898 + y * 78.233;
    return (Math.sin(dot) * 43758.5453) % 1;
}

export function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);
    const v1 = hash(ix, iy);
    const v2 = hash(ix + 1, iy);
    const v3 = hash(ix, iy + 1);
    const v4 = hash(ix + 1, iy + 1);
    const i1 = v1 * (1 - ux) + v2 * ux;
    const i2 = v3 * (1 - ux) + v4 * ux;
    return i1 * (1 - uy) + i2 * uy;
}

export function getElevation(x, z) {
    let y = noise(x * 0.015, z * 0.015) * 22;
    y += noise(x * 0.05, z * 0.05) * 4;
    // Create a massive central basin for the lake
    const centerDist = Math.sqrt(x*x + z*z);
    if(centerDist < 160) y -= (160 - centerDist) * 0.18;
    return y;
}


export function createTerrain(state) {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 300, 300);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, getElevation(x, z));
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ 
        color: 0x141a0f, 
        roughness: 1.0, 
        metalness: 0.0
    });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    state.scene.add(terrain);
}

