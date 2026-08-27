// A vast ocean filling the gap between the coastline cliffs and the painted
// mountain backdrop. Uses the same shared Gerstner shader as the lake (see
// environment/water-shader.js), tuned to the reference demo's "Ocean
// Breeze" preset with the darker custom surface/foam colors from Image 2 —
// see /mnt/user-data/uploads/ocean-water.html.
//
// environment/terrain.js drops the seafloor below OCEAN_LEVEL past the
// coastline so this shows through naturally, and — critically —
// fx/dynamic-fog.js's per-pixel background-texture fog is still wired in via
// addDynamicFog() below, so the horizon still melts into the actual sky/
// mountain color on screen instead of hard-cutting to a flat fog color.
// That dynamic horizon blend is the single biggest thing that sells "endless
// sea" over "big blue floor with an edge" and is preserved exactly as it was.

import * as THREE from 'three';
import { WORLD_SIZE, OCEAN_LEVEL } from '../core/world-state.js';
import { addDynamicFog } from '../fx/dynamic-fog.js';
import { createWaterMaterial } from './water-shader.js';

const OCEAN_BREEZE_PRESET = {
    speed: 1.0,
    elevationScale: 1.0,
    depthColor: '#0a1d3a',
    surfaceColor: '#113040', // custom — darker/more muted than the demo's default #1ca3ec cyan
    foamColor: '#0c1531',    // custom — darker than the demo's default white, keeps foam subtle rather than bright
    colorOffset: 0.25,
    colorMultiplier: 2.0,
    foamThreshold: 1.2,
    opacity: 0.7,
    waves: [
        { dir: 45,  steep: 0.15, len: 20 },
        { dir: 120, steep: 0.15, len: 10 },
        { dir: 200, steep: 0.1,  len: 5 },
        { dir: 0,   steep: 0.05, len: 2 }
    ]
};

export function createOcean(state) {
    // RingGeometry, not CircleGeometry — CircleGeometry has no radial
    // subdivision (just one fan of triangles from center to rim), so the
    // Gerstner displacement would have almost nothing to actually displace
    // on a mesh this size. innerRadius stays small (well inside the
    // tightest cove's coastline, see environment/terrain.js's
    // islandRadiusAt) so it's never visible — it exists purely to avoid
    // wasting the radial segment budget on the island's own interior, which
    // the ocean is never seen under.
    const innerRadius = 120;
    const outerRadius = WORLD_SIZE * 0.72; // comfortably past the mountain-boundary far ring
    const geo = new THREE.RingGeometry(innerRadius, outerRadius, 128, 48);
    geo.rotateX(-Math.PI / 2);

    state.oceanMaterial = createWaterMaterial(OCEAN_BREEZE_PRESET);

    // Melts into the actual sky/mountain color at the horizon instead of
    // hard-cutting to flat fog — see fx/dynamic-fog.js. Relies on the
    // #include <fog_vertex>/<fog_fragment> markers water-shader.js's shaders
    // carry for exactly this reason.
    addDynamicFog(state.oceanMaterial, state.backgroundRenderTarget.texture);

    state.oceanMesh = new THREE.Mesh(geo, state.oceanMaterial);
    state.oceanMesh.position.y = OCEAN_LEVEL;
    state.scene.add(state.oceanMesh);
}
