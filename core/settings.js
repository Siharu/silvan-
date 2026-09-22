// Quality presets, fullscreen toggle, FPS counter. Small, self-contained
// wiring for controls that already exist in index.html but nothing reads
// or writes yet. Persisted choices use localStorage directly rather than
// a save-system module (core/save-system.js doesn't exist — see PLAN.md's
// deferred list; this is display/performance preference, not game state).
import { state } from './state.js';

const QUALITY_KEY = 'silvan-quality';
const FPS_KEY = 'silvan-show-fps';

// bladeCount is the only quality-driven value anything currently reads
// (environment/grass.js's `(state.quality && state.quality.bladeCount) ||
// BLADE_COUNT` fallback). Other quality-scaled values (shadow map size,
// tree/rock counts) aren't wired to state.quality yet — same fallback
// pattern would extend to them later without changing this file's shape.
export const QUALITY_PRESETS = {
    high: { bladeCount: 220000 },
    medium: { bladeCount: 130000 },
    low: { bladeCount: 50000 },
};

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
    state.qualityKey = key;
    highlightActiveQualityButtons(key);
    // Labeled "(applies on reload)" in index.html — bladeCount only feeds
    // createGrass() at init() time, so this intentionally doesn't try to
    // rebuild the grass mesh live; the stored value takes effect next load.
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

let fpsFrameCount = 0;
let fpsAccumMs = 0;

// Called every frame from main.js's animate() with the frame's delta in ms.
// Refreshes twice a second rather than every frame — a number that changes
// 60 times a second is unreadable and just adds noise.
export function updateFpsCounter(deltaMs) {
    const fpsEl = document.getElementById('fps-counter');
    if (!fpsEl || fpsEl.classList.contains('hidden')) return;
    fpsFrameCount++;
    fpsAccumMs += deltaMs;
    if (fpsAccumMs >= 500) {
        fpsEl.textContent = `${Math.round(fpsFrameCount / (fpsAccumMs / 1000))} FPS`;
        fpsFrameCount = 0;
        fpsAccumMs = 0;
    }
}
