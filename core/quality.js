// Quality presets. Genuinely reload-tier, not a shortcut: grass slot count
// (environment/grass.js), forest/leaf instance counts (environment/forest.js),
// and rock counts (environment/rocks.js) are all fixed InstancedMesh sizes
// baked in main.js's init() at generation time, not values read from a live
// uniform the way FOV/sensitivity/volume are (see core/settings.js's own
// comment on that split). index.html's quality-toggle-rows are all labeled
// "(applies on reload)" for exactly this reason.
//
// What each preset actually changes today: drawDistance and fogDensityMult,
// both real live-tunable settings (core/settings.js) that also happen to be
// good perf/fidelity proxies. It does NOT yet scale instance counts —
// wiring quality into the generators themselves (createGrass,
// generateFractalForest, createRocks all currently take no count param) is
// unstarted, same "not yet" as the settings menu's own #3 was before this
// pass. Flagged rather than faked.

import { getSettings, setSetting } from './settings.js';

export const QUALITY_PRESETS = {
    high:   { drawDistance: 220, fogDensityMult: 0.8 },
    medium: { drawDistance: 150, fogDensityMult: 1.0 },
    low:    { drawDistance: 90,  fogDensityMult: 1.3 },
};

const QUALITY_KEY = 'quality';
const DEFAULT_QUALITY = 'medium';

export function getQuality() {
    return getSettings()[QUALITY_KEY] || DEFAULT_QUALITY;
}

export function setQuality(level) {
    if (!QUALITY_PRESETS[level]) return;
    setSetting(QUALITY_KEY, level);
    const preset = QUALITY_PRESETS[level];
    setSetting('drawDistance', preset.drawDistance);
    setSetting('fogDensityMult', preset.fogDensityMult);
}
