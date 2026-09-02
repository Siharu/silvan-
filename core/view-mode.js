// View mode (Open World / Top-Down) toggle. Persisted the same reload-tier
// way as core/quality.js, but stubbed honestly: main.js's setupRenderer()
// builds one first-person THREE.PerspectiveCamera and
// setupPlayerController() builds one pointer-lock WASD controller — there
// is no top-down camera or controller implementation anywhere in this
// rebuild yet (the old modular project's core/view-mode.js was never
// ported, same gap PLAN.md #3 already flagged for input.js/save-system.js).
// Selecting "Top-Down" here persists the choice correctly but has zero
// visible effect until that mode is actually built. Not faked with a fake
// camera swap that doesn't really behave differently.

import { getSettings, setSetting } from './settings.js';

const VIEW_MODE_KEY = 'viewMode';
const DEFAULT_VIEW_MODE = 'firstperson';

export function getViewMode() {
    return getSettings()[VIEW_MODE_KEY] || DEFAULT_VIEW_MODE;
}

export function setViewMode(mode) {
    if (mode !== 'firstperson' && mode !== 'topdown') return;
    setSetting(VIEW_MODE_KEY, mode);
}
