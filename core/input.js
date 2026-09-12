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
//   - STUBBED: nothing left in this category — rock detail, top-down view
//              mode, keybind remapping, and audio volume (core/audio.js's
//              gain buses) are all real now. Audio still has no actual
//              sound files to play (see core/audio.js's header), but the
//              volume controls themselves apply live, same as everything
//              else on this list.

import { getSettings, setSetting, DEFAULT_DRAW_DISTANCE } from './settings.js';
import { getQuality, setQuality } from './quality.js';
import { getViewMode, setViewMode } from './view-mode.js';
import { hasStartedGame, exportSaveFile, importSaveFile, startAutosaveLoop } from './save-system.js';
import { getKeybinds, setKeybind, resetKeybinds, ACTION_LABELS, codeToLabel } from './keybinds.js';
import { triggerKatNap } from './rest.js';

function renderKeybindList(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const kb = getKeybinds();
    el.innerHTML = Object.keys(ACTION_LABELS).map((action) =>
        `<div class="keybind-row">
            <span class="keybind-action">${ACTION_LABELS[action]}</span>
            <button type="button" class="keybind-key keybind-rebind-btn" data-action="${action}">${codeToLabel(kb[action])}</button>
        </div>`
    ).join('') + `<div class="keybind-row"><span class="keybind-action">Look</span><span class="keybind-key">Mouse (click to lock pointer)</span></div>
                  <div class="keybind-row"><span class="keybind-action">Pause</span><span class="keybind-key">Esc</span></div>`;

    // One capturing listener on the container, not one per button — the
    // list gets rebuilt (innerHTML replaced) every render, which would
    // otherwise mean re-attaching per-button listeners each time or
    // leaking old ones.
    el.querySelectorAll('.keybind-rebind-btn').forEach((btn) => {
        btn.addEventListener('click', () => startRebindCapture(btn, btn.dataset.action));
    });
}

// Only one rebind capture active at a time, across BOTH the title and
// pause panels' keybind lists (renderKeybindList runs for each) — without
// this, listening for the next keydown on two buttons simultaneously
// (title's and pause's copy of the same action) would rebind from
// whichever panel's listener happened to be registered first.
let activeRebindCleanup = null;

function startRebindCapture(btn, action) {
    if (activeRebindCleanup) activeRebindCleanup();
    const original = btn.textContent;
    btn.textContent = 'Press a key…';
    btn.classList.add('rebinding');

    const onKeydown = (e) => {
        e.preventDefault();
        if (e.code === 'Escape') { // Escape cancels instead of binding — it's the pause-menu key, binding it to a movement action would be confusing
            cleanup();
            return;
        }
        setKeybind(action, e.code);
        cleanup();
        // Re-render both panels' lists (whichever exist) so a swapped
        // conflict action's displayed key updates too, not just this one.
        renderKeybindList('title-keybind-list');
        renderKeybindList('pause-keybind-list');
    };
    function cleanup() {
        document.removeEventListener('keydown', onKeydown, true);
        btn.classList.remove('rebinding');
        activeRebindCleanup = null;
    }
    activeRebindCleanup = cleanup;
    document.addEventListener('keydown', onKeydown, true); // capture phase — needs to intercept before main.js's own movement keydown listener acts on the key being pressed to rebind
}

function flashAutosaveIcon() {
    const el = document.getElementById('autosave-indicator');
    if (!el) return;
    // Was 'visible' — every bit of this element's CSS (the fade-in reveal
    // itself, plus the icon's draw-in animation) is keyed to '.active',
    // so this toggle never matched anything and the indicator has never
    // actually appeared on screen. Found while replacing the icon SVG,
    // unrelated bug.
    el.classList.add('active');
    clearTimeout(flashAutosaveIcon._t);
    flashAutosaveIcon._t = setTimeout(() => el.classList.remove('active'), 1600);
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

function wireReloadCheckbox(titleId, pauseId, key) {
    const settings = getSettings();
    [document.getElementById(titleId), document.getElementById(pauseId)].filter(Boolean).forEach((el) => {
        el.checked = settings[key] !== false; // works for both a true-default (antialiasing) and false-default (forceTouchControls) key, since !!settings.forceTouchControls === (settings.forceTouchControls !== false) when the stored value is only ever true/false/undefined
        el.addEventListener('change', () => {
            setSetting(key, el.checked);
            location.reload();
        });
    });
}

function wireReloadSlider(titleId, pauseId, key, defaultValue) {
    const settings = getSettings();
    [document.getElementById(titleId), document.getElementById(pauseId)].filter(Boolean).forEach((el) => {
        el.value = key in settings ? settings[key] : defaultValue;
        // 'change' (fires on release), not 'input' — this reloads the
        // page, so firing on every drag tick would reload mid-drag.
        el.addEventListener('change', () => {
            setSetting(key, Number(el.value));
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
function wireKeybindReset(id, statusId) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
        resetKeybinds();
        renderKeybindList('title-keybind-list');
        renderKeybindList('pause-keybind-list');
        const status = statusId && document.getElementById(statusId);
        if (status) {
            status.textContent = 'Controls reset to defaults';
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

// Was a toggle that multiplied state.timeSpeed 20x for a continuous
// fast-forward; replaced per your call with a one-shot nap — see
// core/rest.js's triggerKatNap() for the actual behavior (eyes-closed
// fade, random 5-6hr gameTime jump). Kept this wrapper (rather than
// having main.js/the button import triggerKatNap directly) only so the
// button's brief press-feedback lives next to the other input-wiring
// code in this file.
export function toggleTimeFastForward(state) {
    triggerKatNap(state);
    const btn = document.getElementById('time-ff-btn');
    if (!btn) return;
    btn.classList.add('active');
    setTimeout(() => btn.classList.remove('active'), 300); // brief press flash, not a persistent toggle state anymore
}

function setupTimeFastForward(state) {
    const btn = document.getElementById('time-ff-btn');
    if (!btn) return;
    btn.addEventListener('click', () => toggleTimeFastForward(state));
}

function setupFullscreenButton() {
    const btn = document.getElementById('fullscreen-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen().catch(() => { /* some browsers refuse without a more direct user gesture context — button click already counts as one in most, so this is just a safety net */ });
        }
    });
    document.addEventListener('fullscreenchange', () => {
        btn.classList.toggle('active', !!document.fullscreenElement);
    });
}

export function setupInput(state) {
    renderKeybindList('title-keybind-list');
    renderKeybindList('pause-keybind-list');

    setupTitleMenu();
    setupPauseMenu(state);
    setupTimeFastForward(state);
    setupFullscreenButton();

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
    // Volume sliders: now backed by core/audio.js's real gain buses (was:
    // persisted correctly but no audio system existed at all to push the
    // value into — see that file's header for what it does and doesn't do
    // yet, since no actual sound assets exist in the project). Each slider
    // pushes straight into its gain node's live .value, same as the FOV/
    // fog sliders above — audible the instant it moves, once a sound is
    // actually playing through that bus.
    wireLiveControl(state, {
        titleId: 'title-volume-slider', pauseId: 'pause-volume-slider', key: 'masterVolume',
        onLive: (value, s) => { if (s.audio) s.audio.masterGain.gain.value = value; },
    });
    wireLiveControl(state, {
        titleId: 'title-ambience-volume-slider', pauseId: 'pause-ambience-volume-slider', key: 'ambienceVolume',
        onLive: (value, s) => { if (s.audio) s.audio.ambienceGain.gain.value = value; },
    });
    wireLiveControl(state, {
        titleId: 'title-sfx-volume-slider', pauseId: 'pause-sfx-volume-slider', key: 'sfxVolume',
        onLive: (value, s) => { if (s.audio) s.audio.sfxGain.gain.value = value; },
    });

    // --- Reload-tier controls ---
    wireToggleGroup({
        titleIds: ['title-quality-high-btn', 'title-quality-med-btn', 'title-quality-low-btn'],
        pauseIds: ['pause-quality-high-btn', 'pause-quality-med-btn', 'pause-quality-low-btn'],
        values: ['high', 'medium', 'low'],
        getValue: getQuality, setValue: setQuality,
    });
    // Resolution scale — multiplies devicePixelRatio (main.js's
    // setupRenderer()). Separate from the quality preset above: quality
    // scales geometry/instance counts, this scales render resolution —
    // independently useful, since a low-end iGPU can be fill-rate bound
    // (resolution) rather than vertex/draw-call bound (instance counts),
    // or vice versa.
    wireToggleGroup({
        titleIds: ['title-resolution-full-btn', 'title-resolution-med-btn', 'title-resolution-low-btn'],
        pauseIds: ['pause-resolution-full-btn', 'pause-resolution-med-btn', 'pause-resolution-low-btn'],
        values: [1.0, 0.75, 0.5],
        getValue: () => getSettings().resolutionScale || 1.0,
        setValue: (v) => setSetting('resolutionScale', v),
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

    wireReloadCheckbox('title-force-touch-checkbox', 'pause-force-touch-checkbox', 'forceTouchControls');
    // Live checkboxes — both systems already read getSettings() fresh
    // (updateFpsCounter/updateWeather), so no onLive push needed, unlike
    // fov/sensitivity which write straight into camera/uniform state.
    wireLiveControl(state, { titleId: 'title-fps-counter-checkbox', pauseId: 'pause-fps-counter-checkbox', key: 'showFpsCounter', isCheckbox: true });
    wireLiveControl(state, { titleId: 'title-disable-weather-checkbox', pauseId: 'pause-disable-weather-checkbox', key: 'disableWeather', isCheckbox: true });
    wireLiveControl(state, { titleId: 'title-wave-height-slider', key: 'waveHeightMult' });
    wireLiveControl(state, { titleId: 'title-wave-speed-slider', key: 'waveSpeedMult' });
    wireLiveControl(state, { titleId: 'title-storm-reactivity-slider', key: 'stormReactivityMult' });
    wireReloadSlider('title-rock-roughness-slider', 'pause-rock-roughness-slider', 'rockRoughnessMult', 1.0);
    // Antialiasing — reload-tier, same as forceTouchControls: the
    // WebGLRenderer's antialias flag is a constructor-time option, can't
    // be flipped on a live renderer.
    wireReloadCheckbox('title-antialiasing-checkbox', 'pause-antialiasing-checkbox', 'antialiasing');
    wireExportImport();
    wireKeybindReset('title-keybind-reset-btn', 'title-save-status');
    wireKeybindReset('pause-keybind-reset-btn', 'pause-save-status');

    // Modifiers tab's wave-height/wave-speed/storm-reactivity sliders and
    // its "Reset to defaults" button are NOT wired here — water.js has no
    // exported modifier hook (no setWaterModifier-style function exists in
    // this rebuild's environment/water.js), unlike the settings.js header
    // comment's aspirational reference to one. Genuinely unstarted, same
    // as PLAN.md flagged rock detail/top-down above — left for a dedicated
    // pass once water.js grows that hook.

    startAutosaveLoop(flashAutosaveIcon);
}
