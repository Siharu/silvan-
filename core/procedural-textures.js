// Procedural textures for grass.js's GhibliGrass-style shader. Ported from
// the old silvan-main project's core/procedural-textures.js, adapted to
// this project's module layout (WORLD_SIZE lives in ./state.js here, and
// getElevation() takes just (x, z) — no state param).
//
// The reference (ghibli-grass) sourced these from Blender renders/hand-
// picked noise; this project has no art pipeline for that, so all three
// are generated at runtime instead:
//   - heightmap: baked directly from utils.js's getElevation(), so it's
//     pixel-exact against the actual terrain (no separate authoring step
//     to keep in sync, no export/render round-trip).
//   - noise: smooth blurred value-noise (small random grid upscaled with
//     bilinear filtering), close enough to a curl-noise texture for the
//     shader's wind/height-variation sampling.
//   - diffuse: mottled green speckle, standing in for the reference's
//     hand-painted grass color map.

import * as THREE from 'three';

import { rngFor } from './rng.js';
const rand = rngFor('ptex');
export function makeSmoothNoiseTexture(size = 256, cells = 20) {
    const small = document.createElement('canvas');
    small.width = small.height = cells;
    const sctx = small.getContext('2d');
    const simg = sctx.createImageData(cells, cells);
    for (let i = 0; i < cells * cells; i++) {
        simg.data[i * 4 + 0] = rand() * 255;
        simg.data[i * 4 + 1] = rand() * 255;
        simg.data[i * 4 + 2] = rand() * 255;
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
    // Dark olive/brown base + speckles, deliberately not green-dominant so
    // vColor *= texture sample in grass.js doesn't reintroduce a flat
    // green cast once the shader's own lighting/darkening is applied.
    ctx.fillStyle = '#20281a';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const shade = 0.5 + rand() * 0.6;
        const r = Math.round(28 * shade);
        const g = Math.round(34 * shade + 6);
        const b = Math.round(16 * shade);
        ctx.fillStyle = `rgba(${r},${g},${b},0.55)`;
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + rand() * 2.2, 0, Math.PI * 2);
        ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
}
