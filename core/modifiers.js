// Exposes the rock.html / ocean-water.html-style tuning knobs (noise
// character, wave height/speed, storm reactivity) inside the actual
// Settings panel instead of leaving them as hardcoded constants only
// editable by hand in environment/rocks.js and environment/lake.js /
// ocean.js. Deliberately mirrors core/quality.js's storage/apply pattern
// rather than inventing a new one — same localStorage-namespace-plus-
// defaults shape, same distinction between "live" and "reload to apply."
//
// WATER modifiers apply live: wave height/speed/storm-reactivity are read
// directly from state.modifiers every frame (see
// atmosphere/day-night-cycle.js's water-uniform feed) and mapped onto
// THREE.Water's distortionScale/time uniforms (environment/water-reflective.js)
// with zero rebuild cost.
//
// ROCK modifiers do NOT apply live, same reasoning as core/quality.js:
// detail/roughness are baked into InstancedMesh geometry at creation time
// in environment/rocks.js's buildRockVariant(), not read per-frame. Runtime
// disposal/rebuild of six InstancedMesh geometries + their instance
// transform buffers is real scene surgery for a settings-panel nicety —
// "applies on reload" is the same tradeoff quality.js already makes for
// grass/tree/rock counts, and staying consistent with that beats a
// one-off live-rebuild path that only rocks would have.

const STORAGE_KEY = 'silvan-modifiers';

// rockDetail preset triangle costs, computed and checked against the
// ~1,100-instance render budget before picking these (see HANDOFF.md's
// InstancedMesh section for why "detail" can't just be maxed): smooth-type
// detail / flatShaded-type detail per tier.
//   low:  2,420 / 1,620 tris  -> ~2.4M tris/frame total across the field
//   med:  5,780 / 3,380 tris  -> ~5.5M tris/frame (previous fixed default)
//   high: 10,580 / 5,780 tris -> ~9.9M tris/frame
// "high" intentionally stops well short of the reference demo's max (100,
// which alone would be ~224M tris/frame at this instance count).
export const ROCK_DETAIL_PRESETS = {
    low:  { smooth: 10, flat: 8 },
    med:  { smooth: 16, flat: 12 },
    high: { smooth: 22, flat: 16 },
};

const DEFAULT_MODIFIERS = {
    waterWaveHeight: 1.0,      // multiplies Gerstner wave steepness (lake + ocean)
    waterWaveSpeed: 1.0,       // multiplies wave phase speed (lake + ocean)
    waterStormReactivity: 1.0, // multiplies how much storms amplify height/speed/chop on top of the above
    rockDetail: 'med',         // 'low' | 'med' | 'high' — see ROCK_DETAIL_PRESETS
    rockRoughness: 1.0,        // multiplies each rock type's noiseScale + disp together
};

export function getModifiers() {
    let stored = {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) stored = JSON.parse(raw);
    } catch (e) { /* localStorage unavailable or corrupt value — fall back to defaults */ }
    return { ...DEFAULT_MODIFIERS, ...stored };
}

function persist(modifiers) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(modifiers)); } catch (e) { /* private browsing etc. — won't persist across reload, but still applies this session */ }
}

// Live water modifiers: persist + return the merged object so the caller
// (core/input.js) can immediately push the new value into both materials'
// uniforms without a reload.
export function setWaterModifier(key, value) {
    const modifiers = getModifiers();
    modifiers[key] = value;
    persist(modifiers);
    return modifiers;
}

// Rock modifiers: persist and reload, same as core/quality.js's
// setQualityLevel — see file header for why this one isn't live.
export function setRockModifier(key, value) {
    const modifiers = getModifiers();
    modifiers[key] = value;
    persist(modifiers);
    location.reload();
}

// Unlike setRockModifier, this does NOT reload itself — water modifiers are
// live (no reload needed) and reloading unconditionally would blow away the
// live update path for no reason, plus silently discard the defaults this
// returns before the caller ever gets to use them. The caller (core/input.js)
// is responsible for pushing the returned defaults into state.modifiers, the
// slider DOM, and the live water uniforms, and for reloading only if a
// baked (non-live) rock setting actually needs to be re-applied.
export function resetModifiers() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* no-op */ }
    return { ...DEFAULT_MODIFIERS };
}
