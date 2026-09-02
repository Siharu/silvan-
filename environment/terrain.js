// Procedural terrain — height function ported EXACTLY from
// dynamic_procedural_terrain_engine.html's hash2/noise2D/cpuFbm/
// getCPUTerrainHeight (that reference kept a CPU-side copy of its GLSL
// noise in sync for player/vegetation placement, since sampling the GPU
// shader isn't possible from JS — same reason this needs to exist here).
//
// NOTE: this only ports the CPU height function + a plain
// MeshStandardMaterial terrain mesh for now, not the reference's full
// GLSL shader (fBm/ridged/domain-warp blend + sand/grass/rock/snow height
// banding + terracing). That shader is a much bigger port — flagging it
// as the next piece to bring over rather than silently giving you a
// flat-shaded placeholder forever.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';

function hash2(x, y) {
    const px = x * 127.1 + y * 311.7;
    const py = x * 269.5 + y * 183.3;
    const sinx = Math.sin(px) * 43758.5453123;
    const siny = Math.sin(py) * 43758.5453123;
    return [(sinx - Math.floor(sinx)) * 2 - 1, (siny - Math.floor(siny)) * 2 - 1];
}

function noise2D(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);

    const g00 = hash2(ix, iy), g10 = hash2(ix + 1, iy);
    const g01 = hash2(ix, iy + 1), g11 = hash2(ix + 1, iy + 1);

    const d00 = g00[0] * fx + g00[1] * fy;
    const d10 = g10[0] * (fx - 1) + g10[1] * fy;
    const d01 = g01[0] * fx + g01[1] * (fy - 1);
    const d11 = g11[0] * (fx - 1) + g11[1] * (fy - 1);

    const nx0 = d00 + ux * (d10 - d00);
    const nx1 = d01 + ux * (d11 - d01);
    return nx0 + uy * (nx1 - nx0);
}

// General-purpose noise export — other modules (flowers.js's biome
// clustering, grass bald-patch scatter, etc.) want raw noise, not the
// terrain-specific fbm/height curve below.
export function noise(x, y) {
    return noise2D(x, y);
}

function cpuFbm(x, y, octaves, persistence, lacunarity) {
    let total = 0, amp = 1.0, freq = 1.0, maxV = 0;
    for (let i = 0; i < octaves; i++) {
        total += noise2D(x * freq, y * freq) * amp;
        maxV += amp;
        amp *= persistence;
        freq *= lacunarity;
    }
    return total / maxV;
}

export function getElevation(x, z, state) {
    const p = state.terrainParams;
    const sampleX = (x + p.offsetX + p.seed) * p.scale;
    const sampleZ = (z + p.offsetY + p.seed) * p.scale;
    let h = cpuFbm(sampleX, sampleZ, p.octaves, p.persistence, p.lacunarity);
    h = Math.pow(Math.max(0, h + 0.5), 1.6);
    return h * p.elevation;
}

export function createTerrain(state) {
    const res = 256; // halved from the reference's 512 (262k verts) — that
    // was tuned for a GPU-shader-driven demo with no other scene content;
    // this project layers grass/forest/rocks/water on top, so starting
    // leaner here and raising it later if it looks too low-poly.
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res, res);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        posAttr.setY(i, getElevation(x, z, state));
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x4a6b3a, roughness: 1.0 });
    state.terrainMesh = new THREE.Mesh(geo, mat);
    state.terrainMesh.receiveShadow = true;
    state.scene.add(state.terrainMesh);
}
