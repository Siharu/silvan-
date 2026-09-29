// Single source of truth for ground height (B-05, B-13).
//
//  1. bakeHeightmap() samples utils.js getElevation() ONCE into a Float32Array
//     (1025 x 1025 nodes over WORLD_SIZE = 0.78 u spacing).
//  2. buildMeshHeights() resamples that array at the terrain mesh's vertex
//     grid. The terrain mesh, the grass shader's height texture, the player,
//     colliders' Y, tree/rock/flower/POI placement ALL read this mesh grid,
//     so roots sit on exactly the ground that is drawn.
//  3. heightAt(x,z) = triangle-exact height of the DRAWN mesh (PlaneGeometry
//     splits each cell along the b-d diagonal). analyticHeightAt() = raw
//     high-res bilinear on the bake, for things that want the "true" shape.
import { WORLD_SIZE } from './state.js';
import { getElevation } from './utils.js';

export const HM_RES = 1025;              // bake nodes per side
export const MESH_SEGMENTS = 256;        // terrain mesh segments per side (3.125 u cells = 4 bake cells)
const HALF = WORLD_SIZE / 2;
const HM_STEP = WORLD_SIZE / (HM_RES - 1);
const MESH_STEP = WORLD_SIZE / MESH_SEGMENTS;
const MESH_N = MESH_SEGMENTS + 1;

let bake = null;       // Float32Array HM_RES^2
let meshH = null;      // Float32Array MESH_N^2

export function isHeightmapReady() { return meshH !== null; }

// Yields to the event loop every `rowsPerYield` rows so the loading bar paints.
export async function bakeHeightmap(onProgress) {
    bake = new Float32Array(HM_RES * HM_RES);
    const rowsPerYield = 64;
    for (let j = 0; j < HM_RES; j++) {
        const z = -HALF + j * HM_STEP;
        const row = j * HM_RES;
        for (let i = 0; i < HM_RES; i++) bake[row + i] = getElevation(-HALF + i * HM_STEP, z);
        if (j % rowsPerYield === rowsPerYield - 1) {
            if (onProgress) onProgress(j / HM_RES);
            await new Promise((r) => setTimeout(r, 0));
        }
    }
    buildMeshHeights();
}

function buildMeshHeights() {
    meshH = new Float32Array(MESH_N * MESH_N);
    const k = MESH_STEP / HM_STEP; // = 4 exactly for 1024/256
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
