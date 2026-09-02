// Minimal local save system. This rebuild has no progression state yet —
// no quest flags, no collected-animal list, createWorldState() only holds
// live scene/runtime data — so "save" here genuinely only covers
// core/settings.js's own localStorage blob, plus a hasStartedGame flag for
// the title screen's Remember/Regain split. Export/Import move that blob
// between browsers/machines; there's nothing bigger to persist until real
// game-progress state exists. Flagged honestly rather than faking a save
// system with nothing behind it.

import { getSettings, DEFAULT_SETTINGS } from './settings.js';

const SETTINGS_KEY = 'silvan-settings';
const HAS_STARTED_KEY = 'silvan-has-started';
const AUTOSAVE_INTERVAL_MS = 30000;

export function markGameStarted() {
    try { localStorage.setItem(HAS_STARTED_KEY, '1'); } catch (e) { /* no-op */ }
}

export function hasStartedGame() {
    try { return localStorage.getItem(HAS_STARTED_KEY) === '1'; } catch (e) { return false; }
}

// Settings already persist themselves the instant they change (see
// core/settings.js's setSetting) — writeLocalSave() exists so main.js has
// one function to call on an interval, and so the autosave indicator
// (index.html's #autosave-indicator) has something honest to flash for
// rather than firing on a decorative timer with nothing behind it.
export function writeLocalSave() {
    return getSettings();
}

export function exportSaveFile() {
    const data = JSON.stringify(getSettings(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'silvan-save.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Validates against DEFAULT_SETTINGS's own keys so an imported file can't
// inject arbitrary junk into the settings blob other modules read from.
export function importSaveFile(file, onDone) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            const clean = {};
            for (const key of Object.keys(DEFAULT_SETTINGS)) {
                if (key in parsed) clean[key] = parsed[key];
            }
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...clean }));
            if (onDone) onDone(true);
        } catch (e) {
            if (onDone) onDone(false);
        }
    };
    reader.onerror = () => { if (onDone) onDone(false); };
    reader.readAsText(file);
}

export function startAutosaveLoop(onSave) {
    setInterval(() => {
        writeLocalSave();
        if (onSave) onSave();
    }, AUTOSAVE_INTERVAL_MS);
}
