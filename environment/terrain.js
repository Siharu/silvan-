// Value-noise terrain primitives + the ground mesh.
// getElevation() is imported by nearly every other environment/fx module
// (grass, flowers, forest, lake, puddles, rocks, player controller) to
// place things on/at the ground height.

import * as THREE from 'three';
import { WORLD_SIZE, OCEAN_LEVEL } from '../core/world-state.js';
import { addDynamicFog } from '../fx/dynamic-fog.js';

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

// --- island shape ---
// The old boundary was a perfect circle (WORLD_SIZE/2), which is a big part
// of why the world reads as small/samey no matter which way you walk —
// every direction is geometrically identical. BASE_BOUNDARY_RADIUS is kept
// as the average the coastline wobbles around; player-controller.js and
// mountain-boundary.js both import islandRadiusAt() so the walkable edge,
// the visual mountain ring, and the terrain's own coastal rise (below) all
// agree on the same irregular silhouette instead of drifting out of sync.
export const BASE_BOUNDARY_RADIUS = WORLD_SIZE / 2;

// Two octaves of angular noise, sampled by walking a unit circle through
// the existing 2D noise() field (continuous in theta since cos/sin trace a
// smooth loop as theta increases). One big lobe/cove sweep, one tighter
// wobble for smaller headlands — coastline reads as irregular at both a
// glance and up close instead of a ring.
export function islandRadiusAt(theta) {
    const n1 = noise(Math.cos(theta) * 1.4 + 11.3, Math.sin(theta) * 1.4 - 4.7);
    const n2 = noise(Math.cos(theta) * 3.6 + 52.1, Math.sin(theta) * 3.6 + 8.9);
    const wobble = (n1 - 0.5) * 0.42 + (n2 - 0.5) * 0.14;
    return BASE_BOUNDARY_RADIUS * (1 + wobble);
}

export function getElevation(x, z) {
    // Macro ridges/valleys via domain warping: bend the sampling coordinates
    // themselves with a much lower-frequency noise field before reading the
    // main terrain noise. Plain noise(x*f, z*f) is isotropic at every point
    // — statistically the same hill in every direction — which is exactly
    // why the world felt small/linear. Warping makes ridgelines and valleys
    // curve and connect across the map, creating sightline-blocking terrain
    // and distinct pockets instead of uniform bumpy texture.
    const warpX = x + (noise(x * 0.0025, z * 0.0025) - 0.5) * 160;
    const warpZ = z + (noise(x * 0.0025 + 90, z * 0.0025 + 90) - 0.5) * 160;

    let y = noise(warpX * 0.015, warpZ * 0.015) * 22;
    y += noise(warpX * 0.05, warpZ * 0.05) * 4;
    // Slower, bigger ridge layer on top of the warped base — this is what
    // actually creates hidden coves/valleys rather than just added texture.
    y += noise(warpX * 0.0045, warpZ * 0.0045) * 18;

    // Create a massive central basin for the lake
    const centerDist = Math.sqrt(x*x + z*z);
    if(centerDist < 160) y -= (160 - centerDist) * 0.18;

    // Coastal rise: ground climbs into rockier foothills as it nears its
    // local, irregular island edge (same silhouette islandRadiusAt() gives
    // the boundary/mountains), instead of the plain just stopping flat at a
    // fixed radius and reading as an arbitrary wall.
    const theta = Math.atan2(z, x);
    const localRadius = islandRadiusAt(theta);
    const edgeT = Math.min(1, Math.max(0, (centerDist - (localRadius - 260)) / 260));
    if (edgeT > 0) y += edgeT * edgeT * 34;

    // Seafloor drop: once past the island's own irregular coastline
    // (localRadius), plunge the ground well below OCEAN_LEVEL over a short
    // distance so environment/ocean.js's flat disc — comfortably larger
    // than this island's radius — occludes it. Same "flat plane, occluded
    // by higher terrain" trick as the lake basin above, just inverted: the
    // ocean is the thing staying flat, and the land is what drops away.
    // Without this the coastal-rise foothills above would keep climbing
    // uncapped past the coast and could poke back up through the ocean
    // surface further out.
    const pastCoast = centerDist - localRadius;
    if (pastCoast > 0) {
        const dropT = Math.min(1, pastCoast / 120);
        y = y * (1 - dropT) + (OCEAN_LEVEL - 60) * dropT;
    }

    return y;
}


// Was a single unbroken synchronous loop over all ~130k vertices
// (361x360 plane), each calling getElevation() — itself several layered
// noise() lookups. Unlike grass/forest (already chunked, see their own
// comments), this ran as one uninterrupted block with no yield inside it,
// making it the single biggest unbroken freeze in the whole load — even
// though main.js wraps the call in an afterStep(), that only yields
// *after* the entire loop finished. Chunked the same way grass does:
// yield to the browser (and the loading-screen iframe) periodically
// instead of computing all 130k elevations back to back.
export async function createTerrain(state, onProgress) {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 360, 360);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const YIELD_EVERY = 8000;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, getElevation(x, z));

        if (i > 0 && i % YIELD_EVERY === 0) {
            if (onProgress) onProgress(i / pos.count);
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    }
    if (onProgress) onProgress(1);
    geo.computeVertexNormals();

    // Was 0x141a0f — near-black. This is the base under every grass
    // blade/tree/rock gap and the whole ocean floor, so a near-black
    // albedo read as "the world is dark" everywhere, independent of actual
    // light levels (roughness 1.0 has no specular to compensate — albedo
    // is all that's driving what you see). Brightened to a proper dark
    // forest-floor tone that still reads as shadowed dirt/undergrowth but
    // actually responds to sunLight/hemiLight instead of sitting flat.
    const mat = new THREE.MeshStandardMaterial({ 
        color: 0x2b3a1e, 
        roughness: 1.0, 
        metalness: 0.0
    });
    // The ground stretches all the way to the boundary, so this is one of
    // the two materials (alongside forest/rocks) that most needs to melt
    // into the mountain backdrop rather than fog to a flat color — see
    // fx/dynamic-fog.js.
    addDynamicFog(mat, state.backgroundRenderTarget.texture);
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    state.scene.add(terrain);
}