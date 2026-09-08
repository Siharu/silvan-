// View mode (Open World / Top-Down) toggle. Persisted reload-tier, same
// pattern as core/quality.js. main.js's setupPlayerController() reads this
// once at setup and branches the camera + adds a placeholder avatar mesh
// when set to 'topdown' — see that function's isTopDown block.
//
// Scoped deliberately, not a full Disco Elysium clone: WASD movement in
// fixed world axes (not mouselook-relative, since there's no mouselook in
// this mode) under a fixed high isometric camera angle, with a simple
// capsule standing in for a real character model. No click-to-move
// pathfinding/navmesh — that's a much bigger system this project doesn't
// have the foundation for yet (no navmesh, no click-to-terrain raycast
// pathing around colliders).

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
