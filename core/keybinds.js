// Real keybind remapping — replaces core/input.js's old static KEYBINDS
// display array (which was never more than a read-only reference list;
// clicking "Reset to Defaults" literally just told the player "Controls
// aren't remappable yet"). Own localStorage key/module, same pattern as
// core/quality.js and core/view-mode.js, rather than cramming a nested
// dict into core/settings.js's flat key=value store.

const STORAGE_KEY = 'silvan-keybinds';

// KeyboardEvent.code values, not .key — code is layout-independent (WASD
// stays in the same physical position on an AZERTY keyboard, for example),
// matching what main.js's listeners already compared against before this.
export const DEFAULT_KEYBINDS = {
    moveForward: 'KeyW',
    moveBack: 'KeyS',
    moveLeft: 'KeyA',
    moveRight: 'KeyD',
    run: 'ShiftLeft',
    jump: 'Space',
    interact: 'KeyE',
    fastForward: 'KeyR',
    rest: 'KeyG', // 'R' is already claimed by fast-forward — see main.js's rest-handling comment
};

export const ACTION_LABELS = {
    moveForward: 'Move Forward',
    moveBack: 'Move Backward',
    moveLeft: 'Move Left',
    moveRight: 'Move Right',
    run: 'Run',
    jump: 'Jump / Swim Up',
    interact: 'Interact',
    fastForward: 'Fast-Forward Time',
    rest: 'Rest (Sleep to Morning)',
};

function loadKeybinds() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_KEYBINDS };
        return { ...DEFAULT_KEYBINDS, ...JSON.parse(raw) }; // spread over defaults so a future new action added to DEFAULT_KEYBINDS isn't undefined for players with an older saved blob
    } catch {
        return { ...DEFAULT_KEYBINDS };
    }
}

export function getKeybinds() {
    return loadKeybinds();
}

export function getKeybind(action) {
    return loadKeybinds()[action] || DEFAULT_KEYBINDS[action];
}

// Swap-on-conflict: if `code` is already bound to a different action, that
// action gets `action`'s old code instead — so two actions never end up
// silently sharing one key with no way to tell which one fires.
export function setKeybind(action, code) {
    const kb = loadKeybinds();
    const oldCode = kb[action];
    const conflictAction = Object.keys(kb).find((a) => a !== action && kb[a] === code);
    if (conflictAction) kb[conflictAction] = oldCode;
    kb[action] = code;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kb));
    return kb;
}

export function resetKeybinds() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_KEYBINDS));
}

// Human-readable label for a KeyboardEvent.code — good enough for the
// common cases this project actually binds to (letters, Space, Shift);
// not an exhaustive code->display-name table.
export function codeToLabel(code) {
    if (!code) return '?';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code === 'Space') return 'Space';
    if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
    if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
    if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
    return code;
}
