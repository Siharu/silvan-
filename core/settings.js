// Quality presets, fullscreen toggle, FPS counter. Small, self-contained
// wiring for controls that already exist in index.html but nothing reads
// or writes yet. Persisted choices use localStorage directly rather than
// a save-system module (core/save-system.js doesn't exist — see PLAN.md's
// deferred list; this is display/performance preference, not game state).
import { state } from './state.js';

const QUALITY_KEY = 'silvan-quality';
const FPS_KEY = 'silvan-show-fps';

// Tier table lives in render-quality.js (applied live, no reload).
import { QUALITY_PRESETS, applyQuality } from './render-quality.js';
export { QUALITY_PRESETS };

// Called once at the start of main.js's init(), before createGrass() runs,
// so state.quality exists by the time anything reads it.
export function loadQuality() {
    const stored = localStorage.getItem(QUALITY_KEY);
    const key = QUALITY_PRESETS[stored] ? stored : 'medium';
    state.quality = QUALITY_PRESETS[key];
    state.qualityKey = key;
    return key;
}

function setQuality(key) {
    if (!QUALITY_PRESETS[key]) return;
    localStorage.setItem(QUALITY_KEY, key);
    highlightActiveQualityButtons(key);
    applyQuality(key); // live: pixel ratio, shadows, bloom, particles, grass rebuild
}

function highlightActiveQualityButtons(key) {
    document.querySelectorAll('[data-quality-btn]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.qualityBtn === key);
    });
}

// Called once on DOMContentLoaded (main.js), independent of init() —
// these buttons live in the title screen AND the pause menu, both present
// in the DOM (even if the pause menu is display:none) well before the
// player ever clicks Remember.
export function wireSettingsButtons() {
    const qualityButtons = [
        ['title-quality-high-btn', 'high'], ['title-quality-med-btn', 'medium'], ['title-quality-low-btn', 'low'],
        ['pause-quality-high-btn', 'high'], ['pause-quality-med-btn', 'medium'], ['pause-quality-low-btn', 'low'],
    ];
    qualityButtons.forEach(([id, key]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.dataset.qualityBtn = key;
        btn.addEventListener('click', () => setQuality(key));
    });
    highlightActiveQualityButtons(state.qualityKey || loadQuality());

    const fsBtn = document.getElementById('fullscreen-btn');
    if (fsBtn) {
        fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
            else document.exitFullscreen();
        });
    }

    const fpsEl = document.getElementById('fps-counter');
    const fpsCheckboxes = [
        document.getElementById('title-fps-counter-checkbox'),
        document.getElementById('pause-fps-counter-checkbox'),
    ];
    const showFps = localStorage.getItem(FPS_KEY) === '1';
    if (fpsEl) fpsEl.classList.toggle('hidden', !showFps);
    fpsCheckboxes.forEach((cb) => {
        if (!cb) return;
        cb.checked = showFps;
        cb.addEventListener('change', () => {
            const show = cb.checked;
            localStorage.setItem(FPS_KEY, show ? '1' : '0');
            fpsCheckboxes.forEach((other) => { if (other && other !== cb) other.checked = show; });
            if (fpsEl) fpsEl.classList.toggle('hidden', !show);
        });
    });
}

// FOV / sensitivity / invert-Y / master volume — the four Camera+Audio
// controls that map onto something that actually exists (camera.fov, the
// mousemove multiplier, a sign flip, Howler's global volume). The rest of
// Settings (Resolution, Antialiasing, Disable Weather, View Mode, Draw
// Distance, Fog Density, per-category Ambience/SFX volume, wave/storm/rock
// Modifiers, keybind remapping) was stripped from index.html rather than
// wired here — each needs a real backing system (renderer resize, a fog
// object, a weather toggle, a camera-mode switch, per-shader uniforms, or
// an input-remap architecture) that doesn't exist yet, so leaving the
// controls in place would just trade one kind of lying UI for another.
const SENSITIVITY_KEY = 'silvan-sensitivity';
const INVERT_Y_KEY = 'silvan-invert-y';
const VOLUME_KEY = 'silvan-volume';
const BASE_FOV = 75;

export function loadCameraAudioSettings() {
    state.sensitivity = parseFloat(localStorage.getItem(SENSITIVITY_KEY)) || 1;
    state.invertY = localStorage.getItem(INVERT_Y_KEY) === '1';
    const vol = parseFloat(localStorage.getItem(VOLUME_KEY));
    state.masterVolume = Number.isFinite(vol) ? vol : 1;
    Howler.volume(state.masterVolume);
}

export function wireCameraAudioSettings() {
    loadCameraAudioSettings();

    const fovSliders = [document.getElementById('title-fov-slider'), document.getElementById('pause-fov-slider')];
    fovSliders.forEach((s) => {
        if (!s) return;
        s.value = BASE_FOV;
        s.addEventListener('input', () => {
            const fov = parseFloat(s.value);
            fovSliders.forEach((other) => { if (other && other !== s) other.value = fov; });
            state.baseFov = fov;
            if (state.camera) { state.camera.fov = fov; state.camera.updateProjectionMatrix(); }
        });
    });

    const sensSliders = [document.getElementById('title-sensitivity-slider'), document.getElementById('pause-sensitivity-slider')];
    sensSliders.forEach((s) => {
        if (!s) return;
        s.value = state.sensitivity;
        s.addEventListener('input', () => {
            const val = parseFloat(s.value);
            sensSliders.forEach((other) => { if (other && other !== s) other.value = val; });
            state.sensitivity = val;
            localStorage.setItem(SENSITIVITY_KEY, String(val));
        });
    });

    const invertBoxes = [document.getElementById('title-invert-y-checkbox'), document.getElementById('pause-invert-y-checkbox')];
    invertBoxes.forEach((cb) => {
        if (!cb) return;
        cb.checked = state.invertY;
        cb.addEventListener('change', () => {
            invertBoxes.forEach((other) => { if (other && other !== cb) other.checked = cb.checked; });
            state.invertY = cb.checked;
            localStorage.setItem(INVERT_Y_KEY, cb.checked ? '1' : '0');
        });
    });

    // Debug/testing toggle — natural torrential weather (lightning +
    // storm-surge flooding, see atmosphere/day-night-cycle.js) is only
    // ~5% of weather rolls, which makes it impractical to ever actually
    // see or test without a way to force it. Session-only (not persisted
    // to localStorage) since it's a testing aid, not a real preference —
    // unchecked on every fresh load.
    const stormBoxes = [document.getElementById('title-storm-forced-checkbox'), document.getElementById('pause-storm-forced-checkbox')];
    stormBoxes.forEach((cb) => {
        if (!cb) return;
        cb.checked = false;
        cb.addEventListener('change', () => {
            stormBoxes.forEach((other) => { if (other && other !== cb) other.checked = cb.checked; });
            state.stormForced = cb.checked;
            if (cb.checked) state.weatherChangeTimer = Infinity; // force the next tick in updateAtmosphere() to re-roll immediately instead of waiting out whatever's left of the current interval
        });
    });

    const volSliders = [document.getElementById('title-volume-slider'), document.getElementById('pause-volume-slider')];
    volSliders.forEach((s) => {
        if (!s) return;
        s.value = state.masterVolume;
        s.addEventListener('input', () => {
            const val = parseFloat(s.value);
            volSliders.forEach((other) => { if (other && other !== s) other.value = val; });
            state.masterVolume = val;
            localStorage.setItem(VOLUME_KEY, String(val));
            Howler.volume(val);
        });
    });
}

let fpsFrameCount = 0;
let fpsAccumMs = 0;
let cachedFpsEl = null;

// Called every frame from main.js's animate() with the frame's delta in ms.
// Refreshes twice a second rather than every frame — a number that changes
// 60 times a second is unreadable and just adds noise.
export function updateFpsCounter(deltaMs) {
    if (!cachedFpsEl) cachedFpsEl = document.getElementById('fps-counter');
    const fpsEl = cachedFpsEl;
    if (!fpsEl || fpsEl.classList.contains('hidden')) return;
    fpsFrameCount++;
    fpsAccumMs += deltaMs;
    if (fpsAccumMs >= 500) {
        fpsEl.textContent = `${Math.round(fpsFrameCount / (fpsAccumMs / 1000))} FPS`;
        fpsFrameCount = 0;
        fpsAccumMs = 0;
    }
}
