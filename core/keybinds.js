// PC keybind remapping. Action ids intentionally reuse core/world-state.js's
// own state.keys property names (w/a/s/d/r/shift) plus 'interact' — so
// rebinding never has to touch player-controller.js's movement code, which
// only ever reads state.keys.w/a/s/d/r/shift as booleans regardless of
// which physical key set them. Mirrors core/settings.js's pattern
// (localStorage-persisted, live-apply, no reload needed).

const STORAGE_KEY = 'silvan-keybinds';

// event.code values (not .key) — code is layout-independent (KeyW stays
// KeyW on an AZERTY keyboard even though the physical key prints "Z"),
// which is what the existing hardcoded bindings already used and what the
// rebind-capture UI below records.
const DEFAULT_KEYBINDS = {
    w: 'KeyW',
    a: 'KeyA',
    s: 'KeyS',
    d: 'KeyD',
    r: 'KeyR',
    shift: 'ShiftLeft',
    interact: 'KeyE',
};

// Display labels for the Controls tab — action id -> human name. Kept here
// rather than duplicated in index.html so the rebind UI can build its rows
// from this single list and never drift out of sync with what actually
// exists in DEFAULT_KEYBINDS.
export const ACTION_LABELS = {
    w: 'Move Forward',
    a: 'Move Left',
    s: 'Move Backward',
    d: 'Move Right',
    shift: 'Sprint',
    r: 'Rest (hold)',
    interact: 'Interact',
};

export function getKeybinds() {
    let stored = {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) stored = JSON.parse(raw);
    } catch (e) { /* localStorage unavailable or corrupt value — fall back to defaults */ }
    return { ...DEFAULT_KEYBINDS, ...stored };
}

function persist(binds) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(binds)); } catch (e) { /* private browsing etc. */ }
}

// Rebinding to a code already used by another action SWAPS the two rather
// than leaving two actions on the same key (which would make one of them
// permanently unreachable) — e.g. if 'w' is bound to KeyW and the player
// rebinds 'shift' to KeyW, 'w' picks up whatever 'shift' used to be.
export function setKeybind(action, code) {
    const binds = getKeybinds();
    const conflictingAction = Object.keys(binds).find(a => a !== action && binds[a] === code);
    if (conflictingAction) binds[conflictingAction] = binds[action];
    binds[action] = code;
    persist(binds);
    return binds;
}

export function resetKeybinds() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* no-op */ }
    return { ...DEFAULT_KEYBINDS };
}

// Built fresh whenever keybinds change (see core/input.js) rather than
// reversed on every keydown — a reverse lookup built once per change is
// cheap; rebuilding it 60 times a second on every keystroke isn't
// meaningfully more correct, just wasteful.
export function buildCodeToAction(binds) {
    const map = {};
    for (const [action, code] of Object.entries(binds)) map[code] = action;
    return map;
}

export { DEFAULT_KEYBINDS };
