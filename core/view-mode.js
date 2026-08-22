// View mode: first-person open-world (default) vs. a lightweight top-down
// camera mode aimed at low-end devices. This is "Option A" from scoping —
// the SAME 3D scene/terrain/InstancedMesh work already built, just viewed
// through a fixed overhead camera instead of mouse-look, and forced onto
// the cheapest quality tier regardless of the separate Graphics setting
// (see core/quality.js) — the whole point of this mode is running
// acceptably on hardware that can't handle the full experience.
//
// Deliberately NOT the other option discussed (a genuinely separate
// lightweight asset pipeline, closer to DRIFTER's approach) — that's a
// much bigger build (its own simplified geometry/rendering built cheap
// from the ground up, not a camera swap over the existing expensive
// scene). Went with this one because it reuses everything already in
// place rather than duplicating it. Flag clearly if the bigger rebuild
// turns out to be what's actually wanted after trying this in practice —
// this module is intentionally small/isolated so it doesn't block that
// later if needed.
//
// Same localStorage + reload pattern as core/quality.js and
// core/modifiers.js, for the same reason: view mode changes what camera
// type/rig gets built and what quality preset gets forced in main.js's
// init() — none of that is set up to be torn down and rebuilt live.

const STORAGE_KEY = 'silvan-view-mode';

export function getViewMode() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'topdown') return 'topdown';
    } catch (e) { /* localStorage unavailable — fall through to default */ }
    return 'firstperson';
}

export function setViewMode(mode) {
    if (mode !== 'firstperson' && mode !== 'topdown') return;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) { /* private browsing etc. — won't persist, but still applies this session via reload */ }
    location.reload();
}
