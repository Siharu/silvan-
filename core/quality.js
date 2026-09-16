// Quality presets. Now genuinely scales instance counts too, not just
// drawDistance/fogDensityMult — forest.js was already written expecting a
// state.quality.treeCount (with a `|| 350` fallback for when this didn't
// exist yet), so that half of the wiring predates this pass. Every
// generator below now reads its count the same way: state.quality's field
// if present, else its own original hardcoded default, so nothing breaks
// if a generator is ever called without state.quality set.
//
// Reload-tier, not live: these are baked into InstancedMesh sizes at
// generation time in main.js's init(), same as before — see
// core/settings.js's comment on the live vs. reload-tier split.

import { getSettings, setSetting } from './settings.js';

export const QUALITY_PRESETS = {
    high: {
        drawDistance: 220, fogDensityMult: 0.8,
        treeCount: 380, bladeCount: 220000, rockCount: 90,
        bushLeafCount: 45000, bushClusterCount: 700,
        flowerCount: 12000, fireflyCount: 1200, dustCount: 3500, puddleCount: 120,
        vegetationRadius: 375, // full range — matches forest.js's original hardcoded WORLD_SIZE/2-50 max
    },
    medium: {
        drawDistance: 150, fogDensityMult: 1.0,
        treeCount: 260, bladeCount: 130000, rockCount: 60,
        bushLeafCount: 28000, bushClusterCount: 450,
        flowerCount: 7000, fireflyCount: 800, dustCount: 2200, puddleCount: 80,
        vegetationRadius: 300,
    },
    low: {
        // The actual "Silent Hill" trick: trees only get placed within a
        // much smaller radius of world origin (see forest.js's clustering
        // loop, which now clamps its max spawn radius to this value
        // instead of always using the full island), and fogDensityMult is
        // pushed up enough that FogExp2's falloff makes that cutoff ring
        // solidly invisible well before you'd reach it on foot — you never
        // see vegetation "end", it's just always past what you can see.
        // This is a real instance-count win (fewer trees actually exist,
        // not just cheaper-shaded ones), unlike drawDistance's existing
        // LOD-collapse trick which only cheapens vertex complexity of
        // trees that still exist and still get processed every frame.
        drawDistance: 90, fogDensityMult: 2.0,
        treeCount: 150, bladeCount: 55000, rockCount: 35,
        bushLeafCount: 12000, bushClusterCount: 220,
        flowerCount: 3000, fireflyCount: 400, dustCount: 1000, puddleCount: 40,
        vegetationRadius: 170,
    },
};

const QUALITY_KEY = 'quality';
const DEFAULT_QUALITY = 'medium';

export function getQuality() {
    return getSettings()[QUALITY_KEY] || DEFAULT_QUALITY;
}

export function getQualityCounts() {
    return QUALITY_PRESETS[getQuality()] || QUALITY_PRESETS[DEFAULT_QUALITY];
}

export function setQuality(level) {
    if (!QUALITY_PRESETS[level]) return;
    setSetting(QUALITY_KEY, level);
    const preset = QUALITY_PRESETS[level];
    setSetting('drawDistance', preset.drawDistance);
    setSetting('fogDensityMult', preset.fogDensityMult);
}
