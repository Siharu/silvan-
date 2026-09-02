// Central mutable state bag shared across all modules. Ported forward from
// the old modular project's core/world-state.js pattern — every module
// takes `state` as its first argument instead of importing globals, so
// systems stay independently testable/swappable during this rebuild.

export const WORLD_SIZE = 800; // matches dynamic_procedural_terrain_engine.html's 800x800 plane
export const WATER_LEVEL = -2; // matches terrainParams.waterLevel below / environment/rain.js

export function createWorldState() {
    return {
        scene: null,
        camera: null,
        renderer: null,
        clock: null,

        player: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            height: 1.7,
            isRunning: false,
            isInWater: false,
        },

        // Terrain params — ported 1:1 from terrainParams in
        // dynamic_procedural_terrain_engine.html so getElevation() (see
        // environment/terrain.js) produces the exact same heightfield the
        // GUI-tuned reference was authored against.
        terrainParams: {
            scale: 0.015,
            elevation: 25,
            octaves: 5,
            persistence: 0.5,
            lacunarity: 2.0,
            offsetX: 0,
            offsetY: 0,
            seed: 0,
            waterLevel: -2,
        },

        quality: null, // assigned by core/quality.js at init
        gameTime: 0.3, // 0..1, matches day_night_cycle.html's default daytime start

        // Populated by environment/pine-trees.js (trunk positions/radii) —
        // no collision system reads this yet in this rebuild, but the
        // array needs to exist since that module pushes to it
        // unconditionally as trees are placed.
        colliders: [],

        // Every LOD material's uSwitchDist uniform object (trunk/imposter/
        // leaf shaders in environment/forest.js), pushed at material-build
        // time so core/input.js's Tree Draw Distance slider can mutate
        // `.value` on all of them live with zero rebuild — same live-apply
        // reasoning as core/settings.js's other sliders.
        lodUniforms: [],

        // Populated by environment/forest.js's growBranch() as it walks
        // each tree's fractal branch structure — every leaf instance's
        // matrix/color gets pushed here during generateFractalForest(),
        // then read back out once to build the actual InstancedMesh at
        // the end of that function. Needs to exist as arrays before that
        // first push() call, same reasoning as colliders above.
        leafMatrices: [],
        leafColors: [],
    };
}
