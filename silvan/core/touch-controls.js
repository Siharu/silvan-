// Phase 6 #36: real touch-control wiring. index.html's #touch-controls
// markup (joystick, look zone, action buttons, pause button) already
// existed with full CSS — this file is what was missing, so nothing in
// it ever actually did anything.
//
// This drives the exact same state the keyboard/mouse path drives —
// state.keys.w/a/s/d/shift/e/g for movement/actions, input.js's
// applyLookDelta() for look, player-controller.js's triggerJump() for
// jumping — rather than a separate parallel input scheme, so
// player-controller.js and pois.js needed zero touch-specific branches.
import { state } from './state.js';
import { shouldShowTouchControls } from './utils.js';
import { applyLookDelta, pauseGame } from './input.js';
import { triggerJump } from './player-controller.js';

const JOYSTICK_MAX_RADIUS = 45; // px the knob can travel from center before clamping
const JOYSTICK_DEADZONE = 0.25; // fraction of max radius before a direction registers at all
const IDLE_TIMEOUT_MS = 10000;

let joystickTouchId = null;
let joystickBaseRect = null;
let lookTouchId = null;
let lookLastX = 0;
let lookLastY = 0;
let lastInputTime = 0;
let idleCheckHandle = null;

function markActive(el) {
    lastInputTime = performance.now();
    el.classList.remove('idle');
}

function resetJoystickKeys() {
    state.keys.w = false; state.keys.a = false; state.keys.s = false; state.keys.d = false;
}

// Converts a joystick offset into the same w/a/s/d booleans the keyboard
// sets, rather than adding a second analog-movement code path that
// player-controller.js would also need to understand. A little blunter
// than true analog movement, but keeps the rest of the game input-agnostic.
function applyJoystickOffset(dx, dy, base) {
    const dist = Math.hypot(dx, dy);
    resetJoystickKeys();
    if (dist < JOYSTICK_MAX_RADIUS * JOYSTICK_DEADZONE) {
        base.knob.style.transform = 'translate(0px, 0px)';
        return;
    }
    const clamped = Math.min(dist, JOYSTICK_MAX_RADIUS);
    const angle = Math.atan2(dy, dx);
    base.knob.style.transform = `translate(${Math.cos(angle) * clamped}px, ${Math.sin(angle) * clamped}px)`;

    // 8-directional: forward/back is screen-up/down on the pad, strafe is
    // left/right — matches a standard virtual joystick's feel.
    const nx = Math.cos(angle), ny = Math.sin(angle);
    if (ny < -0.35) state.keys.w = true;
    if (ny > 0.35) state.keys.s = true;
    if (nx < -0.35) state.keys.a = true;
    if (nx > 0.35) state.keys.d = true;
}

function wireJoystick(zone) {
    const base = document.getElementById('touch-joystick-base');
    const knob = document.getElementById('touch-joystick-knob');
    const baseCtl = { knob };

    zone.addEventListener('touchstart', (e) => {
        if (joystickTouchId !== null) return;
        const t = e.changedTouches[0];
        joystickTouchId = t.identifier;
        joystickBaseRect = base.getBoundingClientRect();
        markActive(zone.closest('.touch-controls'));
        e.preventDefault();
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
        const t = Array.from(e.changedTouches).find((t) => t.identifier === joystickTouchId);
        if (!t || !joystickBaseRect) return;
        const cx = joystickBaseRect.left + joystickBaseRect.width / 2;
        const cy = joystickBaseRect.top + joystickBaseRect.height / 2;
        applyJoystickOffset(t.clientX - cx, t.clientY - cy, baseCtl);
        markActive(zone.closest('.touch-controls'));
        e.preventDefault();
    }, { passive: false });

    function release(e) {
        const t = Array.from(e.changedTouches).find((t) => t.identifier === joystickTouchId);
        if (!t) return;
        joystickTouchId = null;
        joystickBaseRect = null;
        resetJoystickKeys();
        knob.style.transform = 'translate(0px, 0px)';
    }
    zone.addEventListener('touchend', release);
    zone.addEventListener('touchcancel', release);
}

function wireLookZone(zone) {
    zone.addEventListener('touchstart', (e) => {
        if (lookTouchId !== null) return;
        const t = e.changedTouches[0];
        lookTouchId = t.identifier;
        lookLastX = t.clientX; lookLastY = t.clientY;
        markActive(zone.closest('.touch-controls'));
        e.preventDefault();
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
        const t = Array.from(e.changedTouches).find((t) => t.identifier === lookTouchId);
        if (!t) return;
        const dx = t.clientX - lookLastX;
        const dy = t.clientY - lookLastY;
        lookLastX = t.clientX; lookLastY = t.clientY;
        // Touch look is naturally slower/coarser than a mouse — scale the
        // same delta-based math input.js's mousemove listener uses up a
        // bit so a full-width drag actually turns the camera meaningfully.
        applyLookDelta(dx * 2.2, dy * 2.2);
        markActive(zone.closest('.touch-controls'));
        e.preventDefault();
    }, { passive: false });

    function release(e) {
        const t = Array.from(e.changedTouches).find((t) => t.identifier === lookTouchId);
        if (!t) return;
        lookTouchId = null;
    }
    zone.addEventListener('touchend', release);
    zone.addEventListener('touchcancel', release);
}

// Rest ('g') and Sprint (shift) are true held states on keyboard, so
// touchstart/touchend just holds the same state.keys flag for as long as
// the finger is down — Interact ('e') follows the same held pattern since
// pois.js's interact prompt already expects a held key, not a tap event.
function wireHoldButton(id, key) {
    const btn = document.getElementById(id);
    if (!btn) return;
    const press = (e) => { state.keys[key] = true; markActive(btn.closest('.touch-controls')); e.preventDefault(); };
    const release = (e) => { state.keys[key] = false; e.preventDefault(); };
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release);
    btn.addEventListener('touchcancel', release);
}

function wireJumpButton() {
    const btn = document.getElementById('touch-jump-btn');
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => {
        triggerJump();
        markActive(btn.closest('.touch-controls'));
        e.preventDefault();
    }, { passive: false });
}

function wirePauseButton() {
    const btn = document.getElementById('touch-pause-btn');
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => {
        pauseGame();
        e.preventDefault();
    }, { passive: false });
}

// Idle-fade (index.html's .touch-controls.idle CSS already exists — this
// is the timer that was missing). Runs on a plain interval rather than
// rAF since it only needs to check roughly once a second, not every frame.
function startIdleWatcher(root) {
    lastInputTime = performance.now();
    idleCheckHandle = setInterval(() => {
        if (performance.now() - lastInputTime > IDLE_TIMEOUT_MS) root.classList.add('idle');
    }, 1000);
}

export function initTouchControls() {
    if (!shouldShowTouchControls()) return;
    const root = document.getElementById('touch-controls');
    if (!root) return;
    root.classList.remove('hidden');
    // index.html's .touch-active CSS (hides crosshair/pause hint, moves the
    // interact prompt clear of the joystick) keys off this body class.
    document.body.classList.add('touch-active');

    wireJoystick(document.getElementById('touch-joystick-zone'));
    wireLookZone(document.getElementById('touch-look-zone'));
    wireHoldButton('touch-rest-btn', 'g');
    wireHoldButton('touch-sprint-btn', 'shift');
    wireHoldButton('touch-interact-btn', 'e');
    wireJumpButton();
    wirePauseButton();
    startIdleWatcher(root);
}
