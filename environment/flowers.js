// Flower fields — ported from silvan_part2_with_original_grass.html's
// createFlowers(). Crossed-plane billboards (two perpendicular quads, same
// technique bushes.js/foliage.js use elsewhere in this project) clustered
// into biome-noise "fields" rather than scattered uniformly.
//
// The reference's `biome > 0.5` threshold doesn't transfer directly: that
// build's noise() is simple value-noise (spreads close to the full ±1
// range), while this project's noise() (terrain.js) is true gradient/
// Perlin noise, whose actual output here never exceeds roughly ±0.65 and
// empirically maxes out closer to ±0.5 — the exact same range mismatch
// that made forest.js's ported `biomeVal > 0.65` autumn-color threshold
// unreachable (see that file's fix). Recalibrated to 0.15 here, this
// noise function's rough ~85th percentile, for a similar "occasional
// field, not everywhere" coverage to what the reference intended.

import * as THREE from 'three';
import { WATER_LEVEL } from '../core/world-state.js';
import { getElevation, noise } from './terrain.js';
import { buildChunkedInstancedField } from '../core/chunks.js';
import { getSettings } from '../core/settings.js';

const FLOWER_COUNT = 12000;
const SCATTER_RADIUS = 280;
const BIOME_THRESHOLD = 0.15;

function createFlowerTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 7; i++) {
        ctx.save();
        ctx.translate(64, 64);
        ctx.rotate((Math.PI * 2 / 7) * i);
        ctx.beginPath();
        ctx.ellipse(0, 26, 12, 34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(64, 64, 14, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function buildCrossedPlaneGeometry() {
    const basePlane = new THREE.PlaneGeometry(1.2, 1.2);
    basePlane.translate(0, 0.6, 0); // anchor at bottom
    const plane2 = basePlane.clone();
    plane2.rotateY(Math.PI / 2);

    const pos1 = basePlane.attributes.position.array;
    const pos2 = plane2.attributes.position.array;
    const uv1 = basePlane.attributes.uv.array;

    const mergedPos = new Float32Array([...pos1, ...pos2]);
    const mergedUv = new Float32Array([...uv1, ...uv1]);
    const idx1 = basePlane.index.array;
    const idx2 = Array.from(idx1).map((i) => i + 4);
    const mergedIdx = new Uint16Array([...idx1, ...idx2]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
    geo.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
    geo.computeVertexNormals();
    return geo;
}

export function createFlowers(state) {
    const flowerCount = (state.quality && state.quality.flowerCount) || FLOWER_COUNT;
    const flowerGeo = buildCrossedPlaneGeometry();

    const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: createFlowerTexture(),
        transparent: true,
        alphaTest: 0.3,
        side: THREE.DoubleSide,
        roughness: 0.9,
    });

    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        mat.userData.shader = shader; // fed each frame by updateFlowers() — see that function. Shared across every chunk mesh below (same material object), so this is set once per compiled program, not per chunk.
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime;`);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vec4 wPos = instanceMatrix * vec4(position, 1.0);
            transformed.x += sin(wPos.x * 4.0 + uTime * 1.5) * 0.15 * position.y;
            transformed.z += cos(wPos.z * 4.0 + uTime * 1.5) * 0.15 * position.y;
        `);
    };

    // White Daisy, Blue Forget-me-not, Violet, Goldenrod
    const palette = [new THREE.Color(0xffffff), new THREE.Color(0x4488ff), new THREE.Color(0xa255ff), new THREE.Color(0xffcc22)];

    // Build a flat placements array instead of one map-spanning
    // InstancedMesh — was a single mesh with one bounding sphere covering
    // the whole 280-unit scatter radius, so Three's frustum culling could
    // never discard any of it even when facing away from most flowers.
    // core/chunks.js splits this into a grid of small InstancedMeshes,
    // each cullable on its own, plus real distance culling past
    // drawDistance (see updateFlowers below).
    const placements = [];
    let attempts = 0;
    while (placements.length < flowerCount && attempts < flowerCount * 3) {
        attempts++;
        const r = Math.sqrt(Math.random()) * SCATTER_RADIUS;
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z, state);

        if (y < WATER_LEVEL + 3.8) continue; // keep off the shoreline/lake, matches bushes.js's own shoreline gate style

        const biome = noise(x * 0.02, z * 0.02);
        if (biome > BIOME_THRESHOLD) {
            const s = 0.4 + Math.random() * 0.6;
            const c = palette[Math.floor((biome - BIOME_THRESHOLD) * 2 * palette.length) % palette.length] || palette[0];
            placements.push({
                x, y: y - 0.1, z, // sink into grass slightly
                scaleX: s, scaleY: s, scaleZ: s,
                rotY: Math.random() * Math.PI,
                colorHex: c.getHex(),
            });
        }
    }

    const field = buildChunkedInstancedField({
        scene: state.scene,
        geometry: flowerGeo,
        material: mat,
        worldExtent: SCATTER_RADIUS * 2 + 40,
        cellSize: 40,
        drawDistance: (getSettings().drawDistance || 150) * 1.2, // slightly past tree LOD switch distance so flowers don't visibly pop before trees do
        placements,
    });

    state.flowerMat = mat;
    state.flowerField = field; // update(camPos) called each frame by updateFlowers()
}

export function updateFlowers(state, ts) {
    if (state.flowerMat && state.flowerMat.userData.shader) {
        state.flowerMat.userData.shader.uniforms.uTime.value = ts;
    }
    if (state.flowerField && state.camera) {
        state.flowerField.update(state.camera.position);
    }
}
