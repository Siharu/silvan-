// Wires index.html's title-screen Settings panel and in-game pause menu to
// real state — this is PLAN.md #3. Two DOM instances share one schema
// (title-* / pause-* ids over the exact same core/settings.js keys, see
// index.html's own comment above #title-settings-panel), so every helper
// below takes a pair of ids and keeps both in sync rather than picking one
// as canonical.
//
// Split by how each control actually applies, same distinction
// core/settings.js's header comment draws:
//   - LIVE:    FOV, sensitivity, invert-Y, draw distance, fog density,
//              volumes — pushed into state/uniforms the instant they change.
//   - RELOAD:  quality preset, view mode, rock detail, force-touch —
//              persisted, then location.reload() so main.js's init() picks
//              them up fresh. Genuinely reload-tier (see quality.js's own
//              comment), not a shortcut taken here.
//   - STUBBED: rock detail value, top-down view mode, keybind remapping,
//              audio volume's actual effect — persisted correctly but
//              nothing downstream reads them yet (no modifiers.js, no
//              top-down controller, no remapping, no audio system exist in
//              this rebuild). Flagged in place, not faked.

import { getSettings, setSetting, DEFAULT_DRAW_DISTANCE } from './settings.js';
import { getQuality, setQuality } from './quality.js';
import { getViewMode, setViewMode } from './view-mode.js';
import { hasStartedGame, exportSaveFile, importSaveFile, startAutosaveLoop } from './save-system.js';

const KEYBINDS = [
    ['W / A / S / D', 'Move'],
    ['Shift', 'Run'],
    ['Mouse', 'Look (click to lock pointer)'],
    ['E', 'Interact / recruit'],
    ['Esc', 'Pause'],
];

function renderKeybindList(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = KEYBINDS.map(([key, action]) =>
        `<div class="keybind-row"><span class="keybind-key">${key}</span><span class="keybind-action">${action}</span></div>`
    ).join('');
}

function flashAutosaveIcon() {
    const el = document.getElementById('autosave-indicator');
    if (!el) return;
    el.classList.add('visible');
    clearTimeout(flashAutosaveIcon._t);
    flashAutosaveIcon._t = setTimeout(() => el.classList.remove('visible'), 1600);
}

// Mirrors one setting across its title/pause slider or checkbox pair,
// persists on change, and optionally pushes a live value straight into
// running state (camera, player controller, LOD uniforms, fog).
function wireLiveControl(state, { titleId, pauseId, key, isCheckbox = false, parse = Number, onLive }) {
    const settings = getSettings();
    const initial = key in settings ? settings[key] : undefined;
    const els = [document.getElementById(titleId), document.getElementById(pauseId)].filter(Boolean);
    if (els.length === 0) return;

    els.forEach((el) => {
        if (initial !== undefined) {
            if (isCheckbox) el.checked = !!initial; else el.value = initial;
        }
        el.addEventListener('input', () => {
            const value = isCheckbox ? el.checked : parse(el.value);
            // Keep the sibling control (title vs pause) in sync live rather
            // than waiting for the next panel open.
            els.forEach((other) => {
                if (other === el) return;
                if (isCheckbox) other.checked = value; else other.value = value;
            });
            setSetting(key, value);
            if (onLive) onLive(value, state);
        });
    });
}

// Reload-tier toggle-button groups (quality, view mode, rock detail) —
// marks the currently-persisted choice active in both panels and applies +
// reloads on click.
function wireToggleGroup({ titleIds, pauseIds, getValue, setValue, values }) {
    const current = getValue();
    [...(titleIds || []), ...(pauseIds || [])].forEach((id, i) => {
        const el = document.getElementById(id);
        if (!el) return;
        const value = values[i % values.length];
        el.classList.toggle('active', value === current);
        el.addEventListener('click', () => {
            setValue(value);
            location.reload();
        });
    });
}

function wireForceTouch(titleId, pauseId) {
    const settings = getSettings();
    [document.getElementById(titleId), document.getElementById(pauseId)].filter(Boolean).forEach((el) => {
        el.checked = !!settings.forceTouchControls;
        el.addEventListener('change', () => {
            setSetting('forceTouchControls', el.checked);
            location.reload();
        });
    });
}

function wireExportImport() {
    ['title-export-save-btn', 'pause-export-save-btn'].forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', exportSaveFile);
    });

    const importBtn = document.getElementById('title-import-save-btn');
    const importInput = document.getElementById('title-import-save-input');
    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', () => {
            const file = importInput.files && importInput.files[0];
            if (!file) return;
            importSaveFile(file, (ok) => {
                const status = document.getElementById('title-save-status');
                if (status) status.textContent = ok ? 'Save imported — reloading…' : 'Import failed: not a valid save file';
                if (ok) setTimeout(() => location.reload(), 600);
            });
        });
    }
}

// Keybind "Reset to Defaults" — stubbed: nothing in this rebuild lets keys
// be remapped in the first place (main.js's WASD/Shift/E listeners are
// hardcoded KeyboardEvent.code checks), so there's nothing to reset yet.
// Wired to a friendly no-op status message rather than silently doing
// nothing on click.
function wireKeybindResetStub(id, statusId) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
        const status = statusId && document.getElementById(statusId);
        if (status) {
            status.textContent = 'Controls aren\'t remappable yet — nothing to reset';
            setTimeout(() => { status.textContent = ''; }, 2000);
        }
    });
}

function openPanel(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
}
function closeAllTitlePanels() {
    document.querySelectorAll('.title-panel.open').forEach((p) => p.classList.remove('open'));
}

function setupTitleMenu() {
    const settingsBtn = document.getElementById('title-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => openPanel('title-settings-panel'));

    const creditsBtn = document.getElementById('title-credits-btn');
    if (creditsBtn) creditsBtn.addEventListener('click', () => openPanel('title-credits-panel'));

    const regainBtn = document.getElementById('title-regain-btn');
    if (regainBtn && hasStartedGame()) regainBtn.classList.remove('hidden');

    const quitBtn = document.getElementById('title-quit-btn');
    const farewell = document.getElementById('title-farewell');
    if (quitBtn && farewell) {
        quitBtn.addEventListener('click', () => {
            // No real "quit" for a page in a browser tab — this is a
            // farewell flourish, matching the button's own subtext, not a
            // window.close() that browsers block on non-script-opened tabs
            // anyway.
            closeAllTitlePanels();
            farewell.classList.add('visible');
        });
    }
}

// Escape-to-pause + pointer-lock release/reacquire. Only active once the
// engine has actually started (state.renderer exists) — Escape does
// nothing useful over the title screen.
function setupPauseMenu(state) {
    const pauseLayer = document.getElementById('pause-layer');
    const resumeBtn = document.getElementById('pause-resume-btn');
    const settingsBtn = document.getElementById('pause-settings-btn');
    const pauseSettings = document.getElementById('pause-settings');
    const quitBtn = document.getElementById('pause-quit-btn');
    const touchPauseBtn = document.getElementById('touch-pause-btn');
    if (!pauseLayer) return;

    function isPaused() { return pauseLayer.classList.contains('visible'); }

    function pause() {
        pauseLayer.classList.add('visible');
        state.isPaused = true;
        if (document.pointerLockElement) document.exitPointerLock();
    }

    function resume() {
        pauseLayer.classList.remove('visible');
        if (pauseSettings) pauseSettings.classList.remove('open');
        state.isPaused = false;
        // Reacquire pointer lock so movement/look keep working immediately
        // — same click-to-lock element the player controller's own
        // click listener targets in main.js.
        if (state.renderer && state.renderer.domElement) {
            state.renderer.domElement.requestPointerLock();
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.code !== 'Escape') return;
        if (!state.clock || !state.clock.running) return; // engine not started yet
        if (isPaused()) resume(); else pause();
    });

    if (resumeBtn) resumeBtn.addEventListener('click', resume);
    if (settingsBtn && pauseSettings) settingsBtn.addEventListener('click', () => pauseSettings.classList.toggle('open'));
    if (quitBtn) quitBtn.addEventListener('click', () => location.reload()); // back to title, freshest possible state
    if (touchPauseBtn) touchPauseBtn.addEventListener('click', () => { if (isPaused()) resume(); else pause(); });
}

const TIME_FF_BASE_SPEED = 0.02; // matches day-night-cycle.js's createDayNightCycle() default
const TIME_FF_FAST_MULT = 20; // ~20x — full day/night cycle in a couple minutes instead of ~20

// Shared between the on-screen button (below) and main.js's R keydown
// listener, so pressing R updates the button's active-highlight state too
// and clicking the button keeps a later R press toggling the right way —
// single source of truth on state.timeFastForwardActive rather than two
// separate local booleans that could drift out of sync.
export function toggleTimeFastForward(state) {
    state.timeFastForwardActive = !state.timeFastForwardActive;
    state.timeSpeed = state.timeFastForwardActive ? TIME_FF_BASE_SPEED * TIME_FF_FAST_MULT : TIME_FF_BASE_SPEED;
    const btn = document.getElementById('time-ff-btn');
    if (btn) btn.classList.toggle('active', state.timeFastForwardActive);
}

function setupTimeFastForward(state) {
    const btn = document.getElementById('time-ff-btn');
    if (!btn) return;
    btn.addEventListener('click', () => toggleTimeFastForward(state));
}

export function setupInput(state) {
    renderKeybindList('title-keybind-list');
    renderKeybindList('pause-keybind-list');

    setupTitleMenu();
    setupPauseMenu(state);
    setupTimeFastForward(state);

    // --- Live controls ---
    wireLiveControl(state, {
        titleId: 'title-fov-slider', pauseId: 'pause-fov-slider', key: 'fov',
        onLive: (value, s) => {
            if (!s.camera) return;
            s.camera.fov = value;
            s.camera.updateProjectionMatrix();
        },
    });
    wireLiveControl(state, {
        titleId: 'title-sensitivity-slider', pauseId: 'pause-sensitivity-slider', key: 'mouseSensitivity',
        onLive: (value, s) => { s.settings.mouseSensitivity = value; },
    });
    wireLiveControl(state, {
        titleId: 'title-invert-y-checkbox', pauseId: 'pause-invert-y-checkbox', key: 'invertY', isCheckbox: true,
        onLive: (value, s) => { s.settings.invertY = value; },
    });
    wireLiveControl(state, {
        titleId: 'title-draw-distance-slider', pauseId: 'pause-draw-distance-slider', key: 'drawDistance',
        onLive: (value, s) => { s.lodUniforms.forEach((u) => { u.value = value; }); },
    });
    wireLiveControl(state, {
        titleId: 'title-fog-density-slider', pauseId: 'pause-fog-density-slider', key: 'fogDensityMult',
        onLive: (value, s) => {
            if (s.scene && s.scene.fog) s.scene.fog.density = 0.0052 * value; // matches main.js's base FogExp2 density
        },
    });
    // Volume sliders: persisted correctly, but this rebuild has no audio
    // system yet (no Howl/Howler usage anywhere in the codebase) — nothing
    // downstream to push the live value into. Stubbed honestly rather than
    // pretending a volume control that controls nothing is fully wired.
    wireLiveControl(state, { titleId: 'title-volume-slider', pauseId: 'pause-volume-slider', key: 'masterVolume' });
    wireLiveControl(state, { titleId: 'title-ambience-volume-slider', pauseId: 'pause-ambience-volume-slider', key: 'ambienceVolume' });
    wireLiveControl(state, { titleId: 'title-sfx-volume-slider', pauseId: 'pause-sfx-volume-slider', key: 'sfxVolume' });

    // --- Reload-tier controls ---
    wireToggleGroup({
        titleIds: ['title-quality-high-btn', 'title-quality-med-btn', 'title-quality-low-btn'],
        pauseIds: ['pause-quality-high-btn', 'pause-quality-med-btn', 'pause-quality-low-btn'],
        values: ['high', 'medium', 'low'],
        getValue: getQuality, setValue: setQuality,
    });
    wireToggleGroup({
        titleIds: ['title-view-firstperson-btn', 'title-view-topdown-btn'],
        pauseIds: ['pause-view-firstperson-btn', 'pause-view-topdown-btn'],
        values: ['firstperson', 'topdown'],
        getValue: getViewMode, setValue: setViewMode,
    });
    // Rock detail (title Modifiers tab only) — stubbed: environment/rocks.js's
    // createRocks(state) takes no detail param, so this persists a choice
    // nothing reads yet. Left wired (not removed) so the control isn't
    // silently dead on click, and so a future rocks.js pass has a value
    // ready to consume.
    wireToggleGroup({
        titleIds: ['title-rock-detail-low-btn', 'title-rock-detail-med-btn', 'title-rock-detail-high-btn'],
        values: ['low', 'med', 'high'],
        getValue: () => getSettings().rockDetail || 'med',
        setValue: (v) => setSetting('rockDetail', v),
    });

    wireForceTouch('title-force-touch-checkbox', 'pause-force-touch-checkbox');
    wireExportImport();
    wireKeybindResetStub('title-keybind-reset-btn', 'title-save-status');
    wireKeybindResetStub('pause-keybind-reset-btn', 'pause-save-status');

    // Modifiers tab's wave-height/wave-speed/storm-reactivity sliders and
    // its "Reset to defaults" button are NOT wired here — water.js has no
    // exported modifier hook (no setWaterModifier-style function exists in
    // this rebuild's environment/water.js), unlike the settings.js header
    // comment's aspirational reference to one. Genuinely unstarted, same
    // as PLAN.md flagged rock detail/top-down above — left for a dedicated
    // pass once water.js grows that hook.

    startAutosaveLoop(flashAutosaveIcon);
}