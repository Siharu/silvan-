// Single source of truth for ground height (B-05, B-13).
//
//  1. bakeHeightmap() runs the sample grid ONCE in a Web Worker
//     (core/heightmap-worker.js), over utils.js/elevation-core.js's
//     getElevation(), into a Float32Array (2049 x 2049 nodes over
//     WORLD_SIZE = ~0.5 u spacing). Terrain v2 4.2: this used to be a
//     main-thread loop yielding every 64 rows; now it's off-thread entirely.
//  2. B-05 REBUILD (was still open as of the last audit re-read): terrain v2
//     chunking (environment/terrain.js) made the DRAWN mesh sample this bake
//     directly via analyticHeightAt() at each chunk's own LOD resolution (as
//     fine as 1u near the player) — but heightAt() here was still resampling
//     the bake onto a SEPARATE, fixed 256-segment (4u-cell) grid first, and
//     every non-terrain-geometry consumer (player Y, colliders, grass's
//     height texture, forest/rocks/flowers/POI placement, slope/normal) read
//     THAT grid. Two ground truths again, same shape as the original bug:
//     the player/grass/trees could sit up to ~1.8u off the ground actually
//     being drawn under them (worst case measured at the crater rim before
//     terrain v2; the chunked LOD only widened the gap by making the drawn
//     mesh finer while the consumer grid stayed fixed).
//     FIX: heightAt() now bilinear-samples the bake directly — no
//     intermediate resample — so it IS analyticHeightAt(), and every caller
//     above reads the exact same field terrain.js's fillChunkHeights() draws
//     from. Grass's GPU height texture (getBakeHeights()/HM_RES, below)
//     switched from the old 257x257 resample to this same 2049x2049 bake for
//     the same reason. One array, read the same way everywhere.
//  3. normalAt(x,z) / shoreDistanceAt(x,z): central-difference helpers for
//     anything that wants a ground normal or an approximate distance to the
//     WATER_LEVEL contour (core/splat.js's biome mask, future terrain
//     shading) without every caller re-deriving it from heightAt.
import { WORLD_SIZE, WATER_LEVEL } from './state.js';

export const HM_RES = 2049;              // bake nodes per side (~0.5 u/texel) — was 1025
const HALF = WORLD_SIZE / 2;
const HM_STEP = WORLD_SIZE / (HM_RES - 1);

let bake = null;       // Float32Array HM_RES^2
let worker = null;

export function isHeightmapReady() { return bake !== null; }

export function bakeHeightmap(onProgress) {
    return new Promise((resolve, reject) => {
        worker = new Worker(new URL('./heightmap-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'progress') {
                if (onProgress) onProgress(msg.value);
            } else if (msg.type === 'done') {
                bake = new Float32Array(msg.buffer);
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

// Raw bake array + its side length, for anything that needs to feed the GPU
// directly (grass.js's height texture) rather than calling heightAt() per
// texel on the CPU.
export function getBakeHeights() { return bake; }

// Height of the ground — bilinear on the bake, same sample every consumer
// (player, colliders, grass, vegetation/POI placement, and terrain.js's own
// chunk vertices) reads, so roots/feet/collision all agree with what's drawn.
export function heightAt(x, z) {
    let fx = (x + HALF) / HM_STEP, fz = (z + HALF) / HM_STEP;
    fx = Math.min(Math.max(fx, 0), HM_RES - 1.0001);
    fz = Math.min(Math.max(fz, 0), HM_RES - 1.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const h00 = bake[iz * HM_RES + ix], h10 = bake[iz * HM_RES + ix + 1];
    const h01 = bake[(iz + 1) * HM_RES + ix], h11 = bake[(iz + 1) * HM_RES + ix + 1];
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}

// Kept as a name for callers that want to be explicit that they're reading
// the true analytic shape (terrain.js's fillChunkHeights) — identical to
// heightAt() now that there is only the one field.
export const analyticHeightAt = heightAt;

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
