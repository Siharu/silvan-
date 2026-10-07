// B-18 / section 9.B: SAVE / CONTINUE, now with 3 independent slots.
// Versioned JSON in localStorage per slot — player pos/yaw, gameTime, days,
// weather, discovered POIs, tutorial done. Autosaves on rest, on POI
// discovery, and every 60s while playing, all to whichever slot is
// "active" for the current session, plus on quit-to-title / tab-hide /
// actual page unload so a refresh never loses more than a few seconds.
// Export/import as a portable text string for backup, per slot. A corrupt
// save falls back to that slot's own backup copy instead of crashing or
// losing the file outright.
//
// NOT included yet: a real `seed` for world regeneration. B-23 (forest.js/
// rocks.js/flowers.js/grass.js still call Math.random(), only terrain
// itself is hash-noise-deterministic) means there is no seed to save that
// would actually reproduce prop placement — trees/rocks/flowers already
// shift on every reload with or without this save existing. The field is
// reserved (always null) so schemaVersion 1 saves don't need a migration
// once B-23 lands; wire it up then, don't invent a fake number now.
import { state, WORLD_SIZE, WATER_LEVEL } from './state.js';
import { heightAt } from './heightmap.js';
import { initJournal } from './journal.js';

export const SLOT_COUNT = 3;
const ACTIVE_SLOT_KEY = 'silvan-active-slot';
const DISCOVERED_KEY = 'silvan-discovered';     // journal.js's own key — mirrored so initJournal() stays in sync after a Regain
const TUTORIAL_DONE_KEY = 'silvan-tutorial-done'; // tutorial.js's own key — same reasoning
const SCHEMA_VERSION = 1;
const AUTOSAVE_INTERVAL_MS = 60000;

// Pre-slot saves lived under one flat 'silvan-save' / 'silvan-save-backup'
// pair. Migrated into Slot 1 the first time this module loads post-update
// so nobody who already has a save loses it to the slot rework — see
// migrateLegacySave() below, called once at module init time.
const LEGACY_SAVE_KEY = 'silvan-save';
const LEGACY_BACKUP_KEY = 'silvan-save-backup';

function saveKey(slot) { return `silvan-save-${slot}`; }
function backupKey(slot) { return `silvan-save-${slot}-backup`; }

function clampSlot(slot) {
    const n = Number(slot);
    return (Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT) ? n : 1;
}

export function getActiveSlot() {
    try {
        const v = localStorage.getItem(ACTIVE_SLOT_KEY);
        return v ? clampSlot(parseInt(v, 10)) : 1;
    } catch (e) { return 1; }
}

export function setActiveSlot(slot) {
    const s = clampSlot(slot);
    try { localStorage.setItem(ACTIVE_SLOT_KEY, String(s)); } catch (e) { /* ignore — falls back to slot 1 next read */ }
    return s;
}

function readTutorialDone() {
    try { return localStorage.getItem(TUTORIAL_DONE_KEY) === '1'; } catch (e) { return false; }
}

function buildPayload() {
    initJournal(); // guarantees state.discovered exists even if no POI has been examined yet
    return {
        schemaVersion: SCHEMA_VERSION,
        savedAt: Date.now(),
        seed: null, // see header note — not meaningful until B-23 seeds world gen
        player: {
            x: state.player.position.x,
            z: state.player.position.z,
            yaw: state.player.rotation.y,
        },
        gameTime: state.gameTime,
        daysPassed: state.daysPassed,
        weather: {
            current: state.currentRainIntensity,
            target: state.targetRainIntensity,
            changeTimer: state.weatherChangeTimer,
        },
        discovered: [...state.discovered],
        tutorialDone: readTutorialDone(),
        // Quality/sensitivity/invertY/volume persist independently via
        // core/settings.js's own localStorage keys — intentionally not
        // duplicated here, so there's exactly one place that can go stale.
        settings: 'stored separately — see core/settings.js',
    };
}

// Bounds the save was always supposed to respect (same half-extent
// player-controller.js's own SAFETY clamp uses) — a hand-edited import
// with an absurd x/z used to pass validation and silently teleport the
// player to the heightmap bake's edge (heightAt() clamps its internal
// sample coords); now it's rejected the same way a corrupt string is.
const MAX_COORD = WORLD_SIZE / 2 + 300;

function isValidPayload(p) {
    return !!p && typeof p === 'object'
        && typeof p.schemaVersion === 'number'
        && p.player
        && Number.isFinite(p.player.x) && Math.abs(p.player.x) <= MAX_COORD
        && Number.isFinite(p.player.z) && Math.abs(p.player.z) <= MAX_COORD
        && Number.isFinite(p.player.yaw)
        && Number.isFinite(p.gameTime) && Number.isFinite(p.daysPassed)
        && p.weather && Number.isFinite(p.weather.current) && Number.isFinite(p.weather.target) && Number.isFinite(p.weather.changeTimer)
        && Array.isArray(p.discovered);
}

function tryParse(json) {
    if (!json) return null;
    try {
        const p = JSON.parse(json);
        return isValidPayload(p) ? p : null;
    } catch (e) { return null; }
}

// One-time migration: if the old flat (pre-slot) keys hold a valid save
// and Slot 1 doesn't have one yet, move it into Slot 1 rather than
// orphaning it. Runs once at import time; cheap no-op on every load after
// the first (either there's nothing left to migrate, or Slot 1 already
// has something of its own).
(function migrateLegacySave() {
    try {
        if (localStorage.getItem(saveKey(1)) != null) return; // Slot 1 already has its own save — don't clobber it
        const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
        const legacyBackup = localStorage.getItem(LEGACY_BACKUP_KEY);
        if (legacy == null && legacyBackup == null) return;
        if (legacy != null) localStorage.setItem(saveKey(1), legacy);
        if (legacyBackup != null) localStorage.setItem(backupKey(1), legacyBackup);
        localStorage.removeItem(LEGACY_SAVE_KEY);
        localStorage.removeItem(LEGACY_BACKUP_KEY);
    } catch (e) { /* private mode / quota — legacy save just stays where it was, next load retries */ }
})();

export function hasSave(slot) {
    const s = clampSlot(slot);
    try { return !!tryParse(localStorage.getItem(saveKey(s))) || !!tryParse(localStorage.getItem(backupKey(s))); }
    catch (e) { return false; }
}

export function hasAnySave() {
    for (let s = 1; s <= SLOT_COUNT; s++) if (hasSave(s)) return true;
    return false;
}

// One row per slot for UI: whether it has a save, and (if so) a short
// human summary — "Day N, HH:MM" — built from the payload itself rather
// than stored separately, so the summary can never drift from the save.
export function listSaveSlots() {
    const out = [];
    for (let s = 1; s <= SLOT_COUNT; s++) {
        const payload = readLocalSave(s);
        out.push({ slot: s, exists: !!payload, summary: payload ? summarize(payload) : null });
    }
    return out;
}

function summarize(payload) {
    const day = (payload.daysPassed || 0) + 1;
    const totalMin = Math.round((payload.gameTime || 0) * 24 * 60);
    const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    const found = Array.isArray(payload.discovered) ? payload.discovered.length : 0;
    return `Day ${day}, ${hh}:${mm} — ${found} found`;
}

// Reads a slot's primary save; falls back to that slot's own backup (last
// known-good, written just before the primary is overwritten) if the
// primary is missing or corrupt. Never throws. Defaults to the active slot.
export function readLocalSave(slot = getActiveSlot()) {
    const s = clampSlot(slot);
    let primary;
    try { primary = tryParse(localStorage.getItem(saveKey(s))); } catch (e) { primary = null; }
    if (primary) return primary;
    try {
        const backup = tryParse(localStorage.getItem(backupKey(s)));
        if (backup) console.warn(`[save-system] Slot ${s} primary save missing/corrupt, used backup slot`);
        return backup;
    } catch (e) { return null; }
}

let flashTimer = null;
function flashAutosaveIcon() {
    const el = document.getElementById('autosave-indicator');
    if (!el) return;
    el.classList.add('active');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('active'), 1800);
}

// The one write path. Keeps a slot's previous primary as that slot's own
// backup before overwriting it, so an interrupted write (tab killed
// mid-string, storage quota) can't take out both copies of the SAME slot
// at once — the other two slots are untouched either way. Defaults to the
// active slot (every autosave trigger calls this with no argument).
export function writeLocalSave(slot = getActiveSlot()) {
    const s = clampSlot(slot);
    let json;
    try { json = JSON.stringify(buildPayload()); }
    catch (e) { console.warn('[save-system] could not serialize save', e); return false; }
    try {
        const prev = localStorage.getItem(saveKey(s));
        if (prev) { try { localStorage.setItem(backupKey(s), prev); } catch (e) { /* quota — proceed without a fresh backup rather than losing the new save too */ } }
        localStorage.setItem(saveKey(s), json);
        flashAutosaveIcon();
        return true;
    } catch (e) {
        console.warn('[save-system] write failed (quota / private mode) — progress just won\'t persist', e);
        return false;
    }
}

// Applies a loaded payload onto live state. Called from main.js's init(),
// after the normal fresh-spawn defaults are set, so Regain overrides them
// rather than racing them. Y is always recomputed from heightAt(x,z) rather
// than trusting a stored Y — terrain itself IS deterministic (hash-noise,
// see state.js), so this is both safe and immune to any future terrain
// tweak leaving an old save's Y buried or floating.
//
// B-24 fix: groundY is now clamped to WATER_LEVEL, the same clamp
// player-controller.js's own per-frame Y update already applies
// (`Math.max(getElevation(...), WATER_LEVEL)`). Without it, a save written
// while standing in the shallows — reachable since B-20 made the ocean a
// current instead of a wall — loaded the player back in sunk into the
// terrain under the waterline instead of at the clamped height normal
// gameplay guarantees everywhere else.
export function applySave(payload) {
    if (!payload) return false;
    const groundY = Math.max(heightAt(payload.player.x, payload.player.z), WATER_LEVEL);
    state.player.position.set(payload.player.x, groundY + state.player.height, payload.player.z);
    state.player.rotation.y = payload.player.yaw;
    state.player.verticalVelocity = 0;
    state.player.isGrounded = true;
    state.gameTime = payload.gameTime;
    state.daysPassed = payload.daysPassed;
    state.currentRainIntensity = payload.weather.current;
    state.targetRainIntensity = payload.weather.target;
    state.weatherChangeTimer = payload.weather.changeTimer;

    // atmosphere.js only rewrites #day-display's text on a day-boundary
    // crossing (state.gameTime wrapping past 1.0) — without this, a loaded
    // save with daysPassed > 1 would keep showing the HTML's hardcoded
    // "Day 1" until the in-game day actually rolled over post-load.
    // #time-display needs no such fix: it's rewritten unconditionally every
    // frame regardless of day boundaries.
    const dayEl = document.getElementById('day-display');
    if (dayEl) dayEl.textContent = `Day ${state.daysPassed}`;

    // Discovered POIs: reset to exactly what the loaded slot has, not a
    // merge — without this, Regain-ing a different slot than whatever (if
    // anything) was already in memory this page-life would only ever grow
    // state.discovered, never let a slot with fewer finds show fewer.
    state.discovered = new Set(payload.discovered);
    try { localStorage.setItem(DISCOVERED_KEY, JSON.stringify([...state.discovered])); } catch (e) { /* ignore */ }
    if (payload.tutorialDone) { try { localStorage.setItem(TUTORIAL_DONE_KEY, '1'); } catch (e) { /* ignore */ } }
    return true;
}

let autosaveIntervalId = null;
// Call once, after startGame() has actually finished building the world.
// Guards on state.isPlaying so it never fires over the title/pause screens
// or mid-rest (updateRest's own hooks cover the rest case explicitly).
// Captures the SESSION's active slot once at call time and always writes
// there — it does not re-read the active slot per tick, so changing the
// "panel slot" in the Save-tab UI to peek at another slot's export/import
// never redirects where this session's own autosaves land.
export function startAutosaveTimer() {
    if (autosaveIntervalId) return; // idempotent — a second Regain/Remember in one page life shouldn't stack timers
    const slot = getActiveSlot();
    autosaveIntervalId = setInterval(() => {
        if (state.isPlaying && !state.isResting) writeLocalSave(slot);
    }, AUTOSAVE_INTERVAL_MS);
}

// --- Export / import as a portable text string (section 9.B "backup") ---
// Prefixed + base64'd so it round-trips cleanly through a text field / chat
// paste without whitespace or line-wrap mangling the JSON; a bare JSON
// paste is still accepted on import for anyone who edits it by hand.
const EXPORT_PREFIX = 'SILVAN1:';

export function exportSaveString(slot = getActiveSlot()) {
    // The active slot exports the LIVE in-memory session (matches Save
    // Now's own "writes whatever state currently holds" semantics); any
    // other slot exports whatever is already on disk for it.
    const json = (clampSlot(slot) === getActiveSlot() && state.hasStarted)
        ? JSON.stringify(buildPayload())
        : JSON.stringify(readLocalSave(slot));
    return EXPORT_PREFIX + btoa(unescape(encodeURIComponent(json)));
}

export function importSaveString(text, slot = getActiveSlot()) {
    const s = clampSlot(slot);
    const trimmed = (text || '').trim();
    if (!trimmed) return { ok: false, error: 'Paste a save string first.' };
    let json = trimmed;
    if (trimmed.startsWith(EXPORT_PREFIX)) {
        try { json = decodeURIComponent(escape(atob(trimmed.slice(EXPORT_PREFIX.length)))); }
        catch (e) { return { ok: false, error: 'That save string is corrupted.' }; }
    }
    const payload = tryParse(json);
    if (!payload) return { ok: false, error: 'Not a valid Silvan save.' };
    try {
        const prev = localStorage.getItem(saveKey(s));
        if (prev) { try { localStorage.setItem(backupKey(s), prev); } catch (e) { /* ignore */ } }
        localStorage.setItem(saveKey(s), JSON.stringify(payload));
    } catch (e) { return { ok: false, error: 'Could not write to storage (quota / private mode).' }; }
    return { ok: true, slot: s };
}

// Wires the Save tab that exists in both the title screen's Settings panel
// and the pause menu's Settings panel (title-/pause- id prefix convention —
// same as core/settings.js's quality/camera/audio wiring), plus the 3
// slot-select buttons added alongside it. The selected "panel slot" is
// purely a UI target for Export/Import in that tab — it starts on whatever
// the session's active slot is. Save Now always targets the session's
// actual active slot (refuses otherwise, with a status message) since
// writing live in-memory state into a slot you're not playing would
// silently clobber that other slot's own progress. Called once on
// DOMContentLoaded, independent of init(), same as wireSettingsButtons().
export function wireSaveButtons() {
    for (const prefix of ['title', 'pause']) {
        let panelSlot = getActiveSlot();

        const saveNowBtn = document.getElementById(`${prefix}-save-now-btn`);
        const exportBtn = document.getElementById(`${prefix}-export-save-btn`);
        const importBtn = document.getElementById(`${prefix}-import-save-btn`);
        const textarea = document.getElementById(`${prefix}-save-textarea`);
        const status = document.getElementById(`${prefix}-save-status`);
        const slotBtns = [1, 2, 3].map(s => document.getElementById(`${prefix}-slot-select-${s}-btn`));

        const setStatus = (msg, isError) => {
            if (!status) return;
            status.textContent = msg;
            status.classList.toggle('error', !!isError);
        };

        const refreshSlotUI = () => {
            const rows = listSaveSlots();
            slotBtns.forEach((btn, i) => {
                if (!btn) return;
                const s = i + 1;
                const entry = rows[i];
                btn.classList.toggle('active-slot', s === panelSlot);
                btn.title = entry.exists ? entry.summary : 'Empty';
                btn.textContent = `Slot ${s}${s === getActiveSlot() ? ' (current)' : ''}`;
            });
        };

        slotBtns.forEach((btn, i) => {
            if (!btn) return;
            const s = i + 1;
            btn.addEventListener('click', () => {
                panelSlot = s;
                refreshSlotUI();
                const entry = listSaveSlots()[i];
                setStatus(`Slot ${s} selected — ${entry.exists ? entry.summary : 'empty'}.`, false);
            });
        });
        refreshSlotUI();

        if (saveNowBtn) saveNowBtn.addEventListener('click', () => {
            if (!state.hasStarted) { setStatus('Nothing to save yet.', true); return; }
            if (panelSlot !== getActiveSlot()) {
                setStatus(`Slot ${panelSlot} isn't your current session's slot — Save Now only writes the active slot.`, true);
                return;
            }
            const ok = writeLocalSave(panelSlot);
            setStatus(ok ? `Saved to Slot ${panelSlot}.` : 'Save failed — storage unavailable.', !ok);
            refreshSlotUI();
        });

        if (exportBtn) exportBtn.addEventListener('click', () => {
            if (panelSlot === getActiveSlot() && !state.hasStarted) { setStatus('Nothing to export yet.', true); return; }
            if (panelSlot !== getActiveSlot() && !hasSave(panelSlot)) { setStatus(`Slot ${panelSlot} is empty.`, true); return; }
            const str = exportSaveString(panelSlot);
            if (textarea) { textarea.value = str; textarea.select(); }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(str).then(
                    () => setStatus(`Slot ${panelSlot} copied to clipboard.`, false),
                    () => setStatus('Exported below — copy it manually.', false)
                );
            } else {
                setStatus('Exported below — copy it manually.', false);
            }
        });

        if (importBtn) importBtn.addEventListener('click', () => {
            const result = importSaveString(textarea ? textarea.value : '', panelSlot);
            setStatus(result.ok ? `Imported into Slot ${panelSlot} — Regain that slot from the title screen to load it.` : result.error, !result.ok);
            refreshSlotUI();
        });
    }
}
