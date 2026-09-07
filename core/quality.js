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
        treeCount: 380, bladeCount: 120000, rockCount: 90,
        bushLeafCount: 45000, bushClusterCount: 700,
        flowerCount: 12000, fireflyCount: 1200, dustCount: 3500, puddleCount: 120,
    },
    medium: {
        drawDistance: 150, fogDensityMult: 1.0,
        treeCount: 260, bladeCount: 70000, rockCount: 60,
        bushLeafCount: 28000, bushClusterCount: 450,
        flowerCount: 7000, fireflyCount: 800, dustCount: 2200, puddleCount: 80,
    },
    low: {
        drawDistance: 90, fogDensityMult: 1.3,
        treeCount: 150, bladeCount: 30000, rockCount: 35,
        bushLeafCount: 12000, bushClusterCount: 220,
        flowerCount: 3000, fireflyCount: 400, dustCount: 1000, puddleCount: 40,
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
