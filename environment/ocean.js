// A vast ocean surrounding the island coastline. Uses THREE.Water (see
// environment/water-reflective.js) for real-time reflection — replaces
// the old custom Gerstner shader entirely (see water-reflective.js's
// header comment for why).
//
// environment/terrain.js drops the seafloor below OCEAN_LEVEL past the
// coastline so this shows through naturally. Dynamic per-pixel fog
// blending (fx/dynamic-fog.js) was already removed for performance before
// this swap and stays removed — THREE.Water has its own `fog: true` option
// instead, which reads off the standard scene.fog the same way built-in
// materials do.

import * as THREE from 'three';
import { WORLD_SIZE, OCEAN_LEVEL } from '../core/world-state.js';
import { createReflectiveWater } from './water-reflective.js';

export function createOcean(state) {
    // RingGeometry, not CircleGeometry — CircleGeometry has no radial
    // subdivision (just one fan of triangles from center to rim), so the
    // reflection sampling geometry would have almost nothing to actually
    // vary across a mesh this size. innerRadius stays small (well inside
    // the tightest cove's coastline, see environment/terrain.js's
    // islandRadiusAt) so it's never visible — it exists purely to avoid
    // wasting the radial segment budget on the island's own interior, which
    // the ocean is never seen under.
    //
    // Deliberately NOT pre-rotated here (no geo.rotateX call) — unlike the
    // old custom-shader mesh, THREE.Water's own constructor expects an
    // unrotated geometry and applies the -90° X rotation itself on the
    // returned mesh object (see water-reflective.js). Pre-rotating here
    // too would double-rotate the water onto its side.
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

    state.oceanMesh = createReflectiveWater(state, {
        geometry: geo,
        y: OCEAN_LEVEL,
        waterColor: 0x041018,
        distortionScale: 3.2,
        baseSize: 8.0,
        sunColorDay: 0xffffff,
        sunColorNight: 0x7c93ff,
    });
    state.oceanMaterial = state.oceanMesh.material;
}
