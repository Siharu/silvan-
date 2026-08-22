// Graphics quality presets — Low exists for lower-end/"potato" devices.
// Nothing here changes at runtime once the scene is built (InstancedMesh
// capacities, shadow map size, and the bloom pass are all baked in during
// main.js's init()), so switching quality writes the choice to
// localStorage and reloads the page rather than trying to dispose/rebuild
// live geometry — much simpler and safer than runtime scene surgery, and
// "changes apply after reload" is a completely standard, expected pattern
// for graphics settings in real games.
//
// Grass is by a wide margin the single heaviest thing in the scene
// (1.1 million blade instances at High) — it's the first thing Low quality
// cuts, and the biggest win a toggle can offer.

const STORAGE_KEY = 'silvan-quality';

export const QUALITY_PRESETS = {
    high: {
        grassCount: 1100000,
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
        shadowMapSize: 1024,
        pixelRatioCap: 1.25,
        bloomEnabled: true,
    },
    low: {
        grassCount: 140000,
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
        shadowMapSize: 512,
        pixelRatioCap: 1.0,
        bloomEnabled: false, // UnrealBloomPass runs several extra blur passes every frame — the single most expensive line item after grass
    },
    // Top-down mode used to just force QUALITY_PRESETS.low outright — same
    // instance counts as low-end-device mode, but it ALSO turned off bloom
    // and cut fireflies/dust to low's floor, so top-down lost the ambient
    // atmospheric layer (glow, drifting motes) on top of feeling dark. The
    // heavy cost in this scene is grass/tree/rock instance counts (still
    // rasterized per-instance regardless of camera distance, see
    // SILVAN_PLAN.md §3) — keep those at low's numbers, but bloom and the
    // particle atmosphere effects are comparatively cheap and were cut for
    // no real perf reason, so give them back here.
    topdown: {
        grassCount: 140000,
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
        shadowMapSize: 512,
        pixelRatioCap: 1.0,
        bloomEnabled: true,
    },
};

export function getQualityLevel() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'high' || stored === 'low') return stored;
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
    if (level !== 'high' && level !== 'low') return;
    try { localStorage.setItem(STORAGE_KEY, level); } catch (e) { /* private browsing etc. — setting won't persist, but still apply for this session via reload */ }
    location.reload();
}
