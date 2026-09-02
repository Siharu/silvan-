// Procedural textures for grass.js's GhibliGrass-style shader. The
// reference (ghibli-grass) sourced these from Blender renders/hand-picked
// noise; this project has no art pipeline for that, so all three are
// generated at runtime instead:
//   - heightmap: baked directly from terrain.js's getElevation(), so it's
//     pixel-exact against the actual terrain (no separate authoring step
//     to keep in sync, no export/render round-trip).
//   - noise: smooth blurred value-noise (small random grid upscaled with
//     bilinear filtering), close enough to a curl-noise texture for the
//     shader's wind/height-variation sampling.
//   - diffuse: mottled green speckle, standing in for the reference's
//     hand-painted grass color map.

import * as THREE from 'three';
import { WORLD_SIZE } from './world-state.js';
import { getElevation } from '../environment/terrain.js';

export function bakeHeightMapTexture(state, resolution = 256) {
    const half = WORLD_SIZE / 2;
    const heights = new Float32Array(resolution * resolution);
    let minY = Infinity, maxY = -Infinity;

    for (let j = 0; j < resolution; j++) {
        const z = (j / (resolution - 1)) * WORLD_SIZE - half;
        for (let i = 0; i < resolution; i++) {
            const x = (i / (resolution - 1)) * WORLD_SIZE - half;
            const h = getElevation(x, z, state);
            heights[j * resolution + i] = h;
            if (h < minY) minY = h;
            if (h > maxY) maxY = h;
        }
    }

    const range = (maxY - minY) || 1;
    const data = new Uint8Array(resolution * resolution);
    for (let k = 0; k < heights.length; k++) {
        data[k] = Math.round(((heights[k] - minY) / range) * 255);
    }

    const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.UnsignedByteType);
    texture.needsUpdate = true;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    return {
        texture,
        boundsMin: new THREE.Vector3(-half, minY, -half),
        boundsMax: new THREE.Vector3(half, maxY, half),
    };
}

export function makeSmoothNoiseTexture(size = 256, cells = 20) {
    const small = document.createElement('canvas');
    small.width = small.height = cells;
    const sctx = small.getContext('2d');
    const simg = sctx.createImageData(cells, cells);
    for (let i = 0; i < cells * cells; i++) {
        simg.data[i * 4 + 0] = Math.random() * 255;
        simg.data[i * 4 + 1] = Math.random() * 255;
        simg.data[i * 4 + 2] = Math.random() * 255;
        simg.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(simg, 0, 0);

    const big = document.createElement('canvas');
    big.width = big.height = size;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(small, 0, 0, size, size);

    const texture = new THREE.CanvasTexture(big);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
}

export function makeGrassDiffuseTexture(size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3d661d';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const shade = 0.55 + Math.random() * 0.7;
        const r = Math.round(45 * shade);
        const g = Math.round(95 * shade + 30);
        const b = Math.round(20 * shade);
        ctx.fillStyle = `rgba(${r},${g},${b},0.55)`;
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + Math.random() * 2.2, 0, Math.PI * 2);
        ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
}
