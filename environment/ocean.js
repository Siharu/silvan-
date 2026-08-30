// A vast ocean surrounding the island coastline. Uses the same shared
// Gerstner shader as the lake (see environment/water-shader.js), tuned to
// the reference demo's "Ocean Breeze" preset with the darker custom
// surface/foam colors from Image 2 — see /mnt/user-data/uploads/ocean-water.html.
//
// environment/terrain.js drops the seafloor below OCEAN_LEVEL past the
// coastline so this shows through naturally, and — critically —
// fx/dynamic-fog.js's per-pixel background-texture fog is still wired in via
// addDynamicFog() below, so the horizon still melts into the actual sky
// color on screen instead of hard-cutting to a flat fog color. That dynamic
// horizon blend is the single biggest thing that sells "endless sea" over
// "big blue floor with an edge", and matters even more now that
// mountain-boundary.js's painted ring isn't there to cap the view — this
// water is the entire read past the coastline now, so the horizon has to
// actually disappear into sky rather than hit a visible far edge.

import * as THREE from 'three';
import { WORLD_SIZE, OCEAN_LEVEL } from '../core/world-state.js';
// addDynamicFog import removed — dynamic fog itself was removed for performance, see main.js.
import { createWaterMaterial } from './water-shader.js';

// Values below came from a hand-tuned JSON preset (not the reference
// demo's original numbers anymore — see the original OCEAN_BREEZE_PRESET
// this replaced for those). skyColor isn't part of this shape: it's not a
// static preset value at all, it's fed live every frame from the actual
// sky gradient (u_skyColor, see atmosphere/day-night-cycle.js's
// updateAtmosphere) so the horizon fresnel always matches whatever's
// really behind it — a fixed skyColor here would just be overwritten the
// next frame, so it's intentionally left out rather than silently ignored.
const OCEAN_BREEZE_PRESET = {
    speed: 1.8,
    elevationScale: 1.5,
    depthColor: '#050c14',
    surfaceColor: '#1a334d',
    foamColor: '#000000',
    colorOffset: 0.1,
    colorMultiplier: 1,
    foamThreshold: 0.8,
    opacity: 0.95,
    waves: [
        { dir: 45,  steep: 0.35, len: 35 },
        { dir: 120, steep: 0.25, len: 18 },
        { dir: 200, steep: 0.2,  len: 8 },
        { dir: 0,   steep: 0.15, len: 3 }
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
    // Was WORLD_SIZE * 1.4, then 1.2 — both mistakes: environment/sky.js's
    // dome sits at a fixed radius 1200, and the cloud dome at 1100 (neither
    // scales with WORLD_SIZE). WORLD_SIZE*1.2 = 1380, which is past BOTH —
    // part of the ocean disc was extending outside the sky sphere entirely,
    // producing a visible seam/cutoff right where the sky dome's surface
    // occluded the farther-out ring of water instead of it fading out via
    // fog like the rest of the ocean does. Capped well inside both domes.
    const outerRadius = 1000;
    const geo = new THREE.RingGeometry(innerRadius, outerRadius, 128, 48);
    geo.rotateX(-Math.PI / 2);

    state.oceanMaterial = createWaterMaterial(OCEAN_BREEZE_PRESET);

    // Melts into the actual sky/mountain color at the horizon instead of
    // hard-cutting to flat fog — see fx/dynamic-fog.js. Relies on the
    // #include <fog_vertex>/<fog_fragment> markers water-shader.js's shaders
    // carry for exactly this reason.
    // addDynamicFog(state.oceanMaterial, ...) removed — dynamic fog removed for performance, see main.js.

    state.oceanMesh = new THREE.Mesh(geo, state.oceanMaterial);
    state.oceanMesh.position.y = OCEAN_LEVEL;
    state.scene.add(state.oceanMesh);
}