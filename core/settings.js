// Live-apply Camera/Graphics/Audio settings — FOV, mouse sensitivity,
// invert-Y, draw distance, fog density, ambience/SFX volume. Mirrors
// core/modifiers.js's pattern (persist to localStorage, return the merged
// object so core/input.js can push values straight into state/uniforms with
// zero rebuild cost) rather than core/quality.js's reload pattern, because
// every one of these is genuinely cheap to change live: FOV is one
// camera.fov + updateProjectionMatrix() call, sensitivity/invertY are read
// fresh on every mousemove anyway, draw distance is just the uSwitchDist
// uniform the tree LOD system (environment/forest.js) already reads every
// frame, fog density is one scene.fog.density write, and ambience/SFX
// volume are multipliers Howler reads on the next play()/volume() call.
// None of these are baked into geometry or instance counts at creation
// time the way quality.js's grass/tree/rock counts are, so there's no
// "applies on reload" tradeoff to make here.

const STORAGE_KEY = 'silvan-settings';

// Matches environment/forest.js's own LOD_SWITCH_DIST default exactly —
// duplicated here rather than imported so this module (loaded very early,
// before the scene exists) doesn't have to pull in forest.js's THREE-heavy
// generation code just for one constant.
const DEFAULT_DRAW_DISTANCE = 150;

const DEFAULT_SETTINGS = {
    fov: 75,               // matches main.js's default first-person camera FOV (topdown mode keeps its own fixed 62, not user-adjustable)
    mouseSensitivity: 1.0, // multiplies core/input.js's base 0.0018 look-speed constant
    invertY: false,
    drawDistance: DEFAULT_DRAW_DISTANCE, // tree LOD switch distance (environment/forest.js) — also loosely scales scene.fog density, see setDrawDistance below
    fogDensityMult: 1.0,   // multiplies main.js's base 0.0052 FogExp2 density
    masterVolume: 1.0,     // top-level multiplier over ambienceVolume/sfxVolume — persisted now, has nothing to apply to yet (see core/input.js's Audio-tab comment)
    ambienceVolume: 1.0,   // multiplies every ambient Howl's own per-frame target volume (day/night/wind/water/rain — see atmosphere/day-night-cycle.js)
    sfxVolume: 1.0,        // multiplies stepAudio's volume
    forceTouchControls: false, // shows the mobile touch UI (core/touch-controls.js) even on a device that doesn't report touch support — for testing on desktop, or a hybrid touchscreen laptop that the browser doesn't self-report correctly
};

export function getSettings() {
    let stored = {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) stored = JSON.parse(raw);
    } catch (e) { /* localStorage unavailable or corrupt value — fall back to defaults */ }
    return { ...DEFAULT_SETTINGS, ...stored };
}

function persist(settings) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* private browsing etc. — won't persist across reload, but still applies this session */ }
}

// Generic setter: persist + return the merged object, same shape as
// core/modifiers.js's setWaterModifier. Callers push the changed value into
// state/uniforms themselves right after calling this (see core/input.js) —
// kept separate rather than taking `state` here so this module has zero
// THREE/scene dependency.
export function setSetting(key, value) {
    const settings = getSettings();
    settings[key] = value;
    persist(settings);
    return settings;
}

export function resetSettings() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* no-op */ }
    return { ...DEFAULT_SETTINGS };
}

export { DEFAULT_SETTINGS, DEFAULT_DRAW_DISTANCE };
