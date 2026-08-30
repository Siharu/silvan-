// Graphics quality presets — Low exists for lower-end/"potato" devices.
// Nothing here changes at runtime once the scene is built (InstancedMesh
// capacities are baked in during main.js's init() — shadow mapping and
// bloom have both been removed for performance, see main.js), so switching quality writes the choice to
// localStorage and reloads the page rather than trying to dispose/rebuild
// live geometry — much simpler and safer than runtime scene surgery, and
// "changes apply after reload" is a completely standard, expected pattern
// for graphics settings in real games.
//
// Grass (environment/grass.js) was, by a wide margin, the single heaviest
// thing in the scene — up to 1.1 million static blade instances scattered
// across the whole GRASS_RADIUS disc regardless of where the player
// actually was, rasterized every frame no matter the camera distance.
// Rewritten per "Making Grass with Triangles in GLSL using Three.js"
// (Peter Adams, Antaeus AR): a much smaller patch of blades slides around
// with the player instead of covering the whole map, so grassCount below
// is now "how many blades exist in the always-nearby patch," not "how many
// blades exist in the world" — visual density near the player is
// comparable or better than before at a fraction of the vertex count.

const STORAGE_KEY = 'silvan-quality';

export const QUALITY_PRESETS = {
    high: {
        grassCount: 260000,
        grassPatchSize: 140,
        treeCount: 780,
        pineTreeCount: 16,
        rockCount: 1100,
        fernClusterCount: 45,
        mossCount: 9000,
        dustCount: 3500,
        fireflyCount: 1200,
        rainCount: 45000,
        rainSplashCount: 400,
        windLeafCount: 220,
        pixelRatioCap: 1.25,
    },
    // Sits between low and high across every instance count and shadow/
    // pixel-ratio setting — a genuine middle tier, not just an alias for
    // one of the other two. Bloom stays on (it's cheap relative to
    // instance counts, see 'low's own comment on why it cuts bloom but
    // this tier doesn't need to).
    medium: {
        grassCount: 150000,
        grassPatchSize: 110,
        treeCount: 480,
        pineTreeCount: 12,
        rockCount: 650,
        fernClusterCount: 26,
        mossCount: 4800,
        dustCount: 1800,
        fireflyCount: 700,
        rainCount: 22000,
        rainSplashCount: 220,
        windLeafCount: 130,
        pixelRatioCap: 1.1,
    },
    low: {
        grassCount: 60000,
        grassPatchSize: 75,
        treeCount: 260,
        pineTreeCount: 8,
        rockCount: 350,
        fernClusterCount: 12,
        mossCount: 1800,
        dustCount: 700,
        fireflyCount: 350,
        rainCount: 10000,
        rainSplashCount: 100,
        windLeafCount: 60,
        pixelRatioCap: 1.0,
    },
    // Top-down mode used to just force QUALITY_PRESETS.low outright — same
    // instance counts as low-end-device mode, but it ALSO turned off bloom
    // and cut fireflies/dust to low's floor, so top-down lost the ambient
    // atmospheric layer (glow, drifting motes) on top of feeling dark. The
    // heavy cost in this scene used to be grass/tree/rock instance counts
    // (grass is now windowed around the player, see the file comment above;
    // trees/rocks still rasterize per-instance regardless of camera
    // distance) — keep those at low's numbers, but bloom and the particle
    // atmosphere effects are comparatively cheap and were cut for no real
    // perf reason, so give them back here.
    topdown: {
        grassCount: 60000,
        grassPatchSize: 75,
        treeCount: 260,
        pineTreeCount: 8,
        rockCount: 350,
        fernClusterCount: 12,
        mossCount: 1800,
        dustCount: 1600,
        fireflyCount: 700,
        rainCount: 10000,
        rainSplashCount: 100,
        windLeafCount: 60,
        pixelRatioCap: 1.0,
    },
};

export function getQualityLevel() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'high' || stored === 'medium' || stored === 'low') return stored;
    } catch (e) { /* localStorage unavailable (private browsing, etc.) — fall through to default */ }
    return 'high';
}

// Reads the saved level and returns its full preset object — call once,
// right after createWorldState(), and hang the result on state.quality so
// every creation function downstream can read from it.
export function resolveQualityPreset() {
    return QUALITY_PRESETS[getQualityLevel()];
}

// Persists the choice and reloads immediately — see the file-level comment
// for why a reload is the deliberate, simpler approach here rather than
// live scene rebuilding.
export function setQualityLevel(level) {
    if (level !== 'high' && level !== 'medium' && level !== 'low') return;
    try { localStorage.setItem(STORAGE_KEY, level); } catch (e) { /* private browsing etc. — setting won't persist, but still apply for this session via reload */ }
    location.reload();
}
