// Single source of truth for ground height (B-05, B-13).
//
//  1. bakeHeightmap() runs the sample grid ONCE in a Web Worker
//     (core/heightmap-worker.js), over utils.js/elevation-core.js's
//     getElevation(), into a Float32Array (2049 x 2049 nodes over
//     WORLD_SIZE = ~0.5 u spacing). Terrain v2 4.2: this used to be a
//     main-thread loop yielding every 64 rows; now it's off-thread entirely.
//  2. buildMeshHeights() resamples that array at the terrain mesh's vertex
//     grid. The terrain mesh, the grass shader's height texture, the player,
//     colliders' Y, tree/rock/flower/POI placement ALL read this mesh grid,
//     so roots sit on exactly the ground that is drawn.
//  3. heightAt(x,z) = triangle-exact height of the DRAWN mesh (PlaneGeometry
//     splits each cell along the b-d diagonal). analyticHeightAt() = raw
//     high-res bilinear on the bake, for things that want the "true" shape.
//  4. normalAt(x,z) / shoreDistanceAt(x,z): central-difference helpers for
//     anything that wants a ground normal or an approximate distance to the
//     WATER_LEVEL contour (core/splat.js's biome mask, future terrain
//     shading) without every caller re-deriving it from heightAt.
import { WORLD_SIZE, WATER_LEVEL } from './state.js';

export const HM_RES = 2049;              // bake nodes per side (~0.5 u/texel) — was 1025
export const MESH_SEGMENTS = 256;        // terrain mesh segments per side (4 u cells = 8 bake cells)
const HALF = WORLD_SIZE / 2;
const HM_STEP = WORLD_SIZE / (HM_RES - 1);
const MESH_STEP = WORLD_SIZE / MESH_SEGMENTS;
const MESH_N = MESH_SEGMENTS + 1;

let bake = null;       // Float32Array HM_RES^2
let meshH = null;      // Float32Array MESH_N^2
let worker = null;

export function isHeightmapReady() { return meshH !== null; }

export function bakeHeightmap(onProgress) {
    return new Promise((resolve, reject) => {
        worker = new Worker(new URL('./heightmap-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'progress') {
                if (onProgress) onProgress(msg.value);
            } else if (msg.type === 'done') {
                bake = new Float32Array(msg.buffer);
                buildMeshHeights();
                worker.terminate();
                worker = null;
                resolve();
            }
        };
        worker.onerror = (err) => {
            worker.terminate();
            worker = null;
            reject(err);
        };
        worker.postMessage({ res: HM_RES });
    });
}

function buildMeshHeights() {
    meshH = new Float32Array(MESH_N * MESH_N);
    const k = MESH_STEP / HM_STEP; // = 8 exactly (4u mesh cells / 0.5u bake cells)
    for (let j = 0; j < MESH_N; j++)
        for (let i = 0; i < MESH_N; i++)
            meshH[j * MESH_N + i] = bake[Math.round(j * k) * HM_RES + Math.round(i * k)];
}

export function getMeshHeights() { return meshH; }

// Height of the DRAWN terrain mesh (triangle-exact).
export function heightAt(x, z) {
    let fx = (x + HALF) / MESH_STEP, fz = (z + HALF) / MESH_STEP;
    fx = Math.min(Math.max(fx, 0), MESH_N - 1.0001);
    fz = Math.min(Math.max(fz, 0), MESH_N - 1.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const a = meshH[iz * MESH_N + ix];               // (0,0)
    const b = meshH[(iz + 1) * MESH_N + ix];         // (0,1)
    const c = meshH[(iz + 1) * MESH_N + ix + 1];     // (1,1)
    const d = meshH[iz * MESH_N + ix + 1];           // (1,0)
    return (u + v <= 1)
        ? a + u * (d - a) + v * (b - a)
        : c + (1 - u) * (b - c) + (1 - v) * (d - c);
}

// High-res analytic bilinear on the bake (true island shape, not the mesh).
export function analyticHeightAt(x, z) {
    let fx = (x + HALF) / HM_STEP, fz = (z + HALF) / HM_STEP;
    fx = Math.min(Math.max(fx, 0), HM_RES - 1.0001);
    fz = Math.min(Math.max(fz, 0), HM_RES - 1.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const h00 = bake[iz * HM_RES + ix], h10 = bake[iz * HM_RES + ix + 1];
    const h01 = bake[(iz + 1) * HM_RES + ix], h11 = bake[(iz + 1) * HM_RES + ix + 1];
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}

// Slope in degrees from the mesh (central difference, 2 u baseline).
export function slopeAt(x, z) {
    const e = 1.0;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return Math.atan(Math.hypot(dx, dz)) * 57.29578;
}

// Ground normal (same central difference as slopeAt, reused as a unit
// vector instead of an angle). Plain {x,y,z} rather than THREE.Vector3 —
// this file has no THREE dependency and callers that want a Vector3 can
// wrap the result themselves.
export function normalAt(x, z) {
    const e = 1.0;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    const len = Math.hypot(dx, 1, dz);
    return { x: -dx / len, y: 1 / len, z: -dz / len };
}

// Approximate signed distance (world units) to the WATER_LEVEL contour:
// positive = inland/above water, negative = underwater. Uses the standard
// distance-to-isocontour estimate d = (h - h_water) / |grad h| — exact for
// a locally planar slope, approximate elsewhere (no real distance
// transform), which is enough for a mask input (core/splat.js) rather than
// precise shoreline geometry.
export function shoreDistanceAt(x, z) {
    const e = 1.0;
    const h = heightAt(x, z);
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    const grad = Math.hypot(dx, dz) || 1e-4;
    return (h - WATER_LEVEL) / grad;
}
