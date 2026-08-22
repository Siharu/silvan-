// Real game-state persistence — player position/rotation, time of day, day
// count, and which animals have been recruited. Two storage paths, both
// serializing the exact same shape via serializeGameState():
//
// 1. localStorage autosave — convenient, survives quitting to title and
//    reopening the tab, but wiped by clearing site data/cache. Written
//    periodically while playing (see AUTOSAVE_INTERVAL_MS) plus at a few
//    natural checkpoints (pausing, an animal joining), not on some
//    decorative timer disconnected from real writes — the HUD's autosave
//    icon (wired in main.js) flashes exactly when writeLocalSave() below
//    actually runs, nothing more.
// 2. Export/Import file — downloads a real .json save file the player
//    keeps on their PC/phone, survives a cache clear or switching
//    browsers/devices entirely. Deliberately built as the primary
//    "portable save" path now (not bolted on later) because it's also
//    exactly the mechanism a future Electron/APK build would want for
//    writing to actual disk — the export/import boundary here already
//    matches what a native save-file dialog would do, so wiring an APK's
//    real filesystem access in later means swapping what's behind
//    exportSaveFile()/importSaveFile(), not rebuilding the save shape or
//    the calling code in main.js/input.js.
//
// What's NOT saved, and why: no story/quest-completion flags, because none
// currently exist in the codebase to save (environment/radio-tower.js's
// cutscene has no "already seen" flag — it can replay every time). Not
// inventing one here; this only serializes state that's actually real.

const STORAGE_KEY = 'silvan-save';
const SAVE_VERSION = 1;

export const AUTOSAVE_INTERVAL_MS = 30000; // 30s while playing

export function serializeGameState(state) {
    return {
        version: SAVE_VERSION,
        savedAt: Date.now(),
        player: {
            x: state.player.position.x,
            y: state.player.position.y,
            z: state.player.position.z,
            rotationY: state.player.rotation.y, // yaw only — pitch resets on load rather than restoring a possibly-disorienting look angle, and top-down mode doesn't use rotation at all (see core/player-controller.js)
        },
        gameTime: state.gameTime,
        daysPassed: state.daysPassed,
        // Names of every animal currently following the player — spawnDemoAnimals()
        // rebuilds the full roster fresh on load (fixed spawn points/config), this
        // just re-marks which ones had already been recruited.
        recruitedAnimals: (state.demoAnimals || []).filter(r => r.following).map(r => r.name),
    };
}

// Applies a previously-serialized save onto live state. Must run AFTER
// spawnDemoAnimals(state) and the default spawn-position assignment in
// main.js's init() — it overwrites both, and needs state.demoAnimals to
// already contain the full roster to mark recruited names against.
export function applySavedState(state, save) {
    if (!save || typeof save !== 'object') return false;
    try {
        if (save.player) {
            state.player.position.set(save.player.x, save.player.y, save.player.z);
            state.player.rotation.y = save.player.rotationY || 0;
            state.camera.quaternion.setFromEuler(state.player.rotation);
        }
        if (typeof save.gameTime === 'number') state.gameTime = save.gameTime;
        if (typeof save.daysPassed === 'number') state.daysPassed = save.daysPassed;
        if (Array.isArray(save.recruitedAnimals) && state.demoAnimals) {
            const recruitedSet = new Set(save.recruitedAnimals);
            for (const rig of state.demoAnimals) {
                if (recruitedSet.has(rig.name)) rig.following = true;
            }
        }
        return true;
    } catch (e) {
        console.warn('Silvan: failed to apply save data', e);
        return false;
    }
}

export function writeLocalSave(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeGameState(state)));
        return true;
    } catch (e) {
        // Private browsing / storage quota — fails silently for autosave;
        // this is exactly the case Export exists for as a real fallback,
        // not just a nicety.
        return false;
    }
}

export function readLocalSave() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

export function hasLocalSave() {
    try { return localStorage.getItem(STORAGE_KEY) !== null; } catch (e) { return false; }
}

// Triggers a real file download — the actual "save to my PC/phone" path.
// Prefers the live in-memory state if currently playing (freshest possible
// snapshot); falls back to whatever's in localStorage if called from the
// title screen after a quit, since there's no live state to pull from there.
export function exportSaveFile(state) {
    const data = state.isPlaying ? serializeGameState(state) : (readLocalSave() || serializeGameState(state));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date(data.savedAt || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `silvan-save-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Reads a File (from an <input type="file"> change event) and resolves to
// parsed save data, or rejects if it's not valid JSON / not a Silvan save.
// Deliberately checks for the `player` field rather than trusting any JSON
// blob — importing garbage should fail loudly (reject) rather than silently
// applying a save with no position and teleporting the player to (0,0,0).
export function importSaveFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                if (!data || typeof data !== 'object' || !data.player) {
                    reject(new Error('Not a valid Silvan save file.'));
                    return;
                }
                resolve(data);
            } catch (e) {
                reject(new Error('Could not parse save file.'));
            }
        };
        reader.onerror = () => reject(new Error('Could not read file.'));
        reader.readAsText(file);
    });
}
