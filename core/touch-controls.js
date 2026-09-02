// Mobile touch controls. index.html's #touch-controls markup and CSS were
// already complete (joystick bottom-left, look-drag zone right two-thirds,
// action buttons bottom-right) — this file is the missing piece that
// actually drives them, per PLAN.md's "Mobile / touch — NOT WIRED" entry.
//
// Reuses the exact same state main.js's WASD/mouselook path uses rather
// than inventing a parallel movement system: the joystick toggles
// state.move's booleans (the same object setupPlayerController's own
// keydown/keyup listeners write to — see main.js), and the look-drag zone
// calls state._applyLook(dx, dy), the same function the mousemove listener
// calls, so sensitivity/invert-Y from core/settings.js apply identically
// whether you're on mouse or touch. No changes needed to the movement/look
// math itself — only main.js needed to expose those two hooks on `state`.

function isTouchCapable() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

// Re-checked live (not just once) so a manual forceTouchControls toggle in
// Settings > Controls, which reloads the page (core/input.js), is picked
// up correctly on the reload rather than needing a second reload.
export function shouldShowTouchControls() {
    try {
        const raw = localStorage.getItem('silvan-settings');
        const stored = raw ? JSON.parse(raw) : {};
        if (stored.forceTouchControls) return true;
    } catch (e) { /* fall through to capability check */ }
    return isTouchCapable();
}

const JOYSTICK_DEADZONE = 0.22; // fraction of max radius before any direction registers — avoids drift from a stationary thumb
const JOYSTICK_RUN_THRESHOLD = 0.75; // push past this fraction of max radius to run, matching Shift's hold-to-run feel

function setupJoystick(state) {
    const zone = document.getElementById('touch-joystick-zone');
    const base = document.getElementById('touch-joystick-base');
    const knob = document.getElementById('touch-joystick-knob');
    if (!zone || !base || !knob) return;

    let activeTouchId = null;
    let baseRect = null;
    const maxRadius = 42; // px, matches .touch-joystick-base's 8.5rem (136px) diameter / 2 minus a small margin — knob shouldn't fully leave the base ring

    function resetMove() {
        state.move.forward = false;
        state.move.back = false;
        state.move.left = false;
        state.move.right = false;
        state.move.run = false;
    }

    function updateFromOffset(dx, dy) {
        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(dist, maxRadius);
        const angle = Math.atan2(dy, dx);
        knob.style.transform = `translate(${Math.cos(angle) * clamped}px, ${Math.sin(angle) * clamped}px)`;
        base.classList.add('active');

        const frac = dist / maxRadius;
        if (frac < JOYSTICK_DEADZONE) { resetMove(); return; }

        // Screen-space drag, not world-space — same as WASD, which is
        // relative to camera facing, not compass direction. Up on the
        // joystick = forward (dy negative), right = strafe right.
        state.move.forward = dy < -JOYSTICK_DEADZONE * maxRadius;
        state.move.back = dy > JOYSTICK_DEADZONE * maxRadius;
        state.move.left = dx < -JOYSTICK_DEADZONE * maxRadius;
        state.move.right = dx > JOYSTICK_DEADZONE * maxRadius;
        state.move.run = frac > JOYSTICK_RUN_THRESHOLD;
    }

    zone.addEventListener('touchstart', (e) => {
        if (state.isPaused || activeTouchId !== null) return;
        const touch = e.changedTouches[0];
        activeTouchId = touch.identifier;
        baseRect = base.getBoundingClientRect();
        e.preventDefault();
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
        if (activeTouchId === null) return;
        const touch = Array.from(e.changedTouches).find((t) => t.identifier === activeTouchId);
        if (!touch || !baseRect) return;
        const cx = baseRect.left + baseRect.width / 2;
        const cy = baseRect.top + baseRect.height / 2;
        updateFromOffset(touch.clientX - cx, touch.clientY - cy);
        e.preventDefault();
    }, { passive: false });

    function endTouch(e) {
        if (activeTouchId === null) return;
        const stillDown = Array.from(e.changedTouches).some((t) => t.identifier === activeTouchId);
        if (!stillDown) return;
        activeTouchId = null;
        baseRect = null;
        knob.style.transform = 'translate(0, 0)';
        base.classList.remove('active');
        resetMove();
    }
    zone.addEventListener('touchend', endTouch);
    zone.addEventListener('touchcancel', endTouch);
}

function setupLookZone(state) {
    const zone = document.getElementById('touch-look-zone');
    if (!zone) return;

    let activeTouchId = null;
    let lastX = 0, lastY = 0;

    zone.addEventListener('touchstart', (e) => {
        if (state.isPaused || activeTouchId !== null) return;
        const touch = e.changedTouches[0];
        activeTouchId = touch.identifier;
        lastX = touch.clientX;
        lastY = touch.clientY;
        e.preventDefault();
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
        if (activeTouchId === null) return;
        const touch = Array.from(e.changedTouches).find((t) => t.identifier === activeTouchId);
        if (!touch) return;
        const dx = touch.clientX - lastX;
        const dy = touch.clientY - lastY;
        lastX = touch.clientX;
        lastY = touch.clientY;
        // A touch drag has no movementX/Y like a locked mouse does — scaled
        // up so a thumb-width drag feels comparable to the mouselook speed
        // core/settings.js's sensitivity is tuned against.
        if (state._applyLook) state._applyLook(dx * 2.2, dy * 2.2);
        e.preventDefault();
    }, { passive: false });

    function endTouch(e) {
        const stillDown = Array.from(e.changedTouches).some((t) => t.identifier === activeTouchId);
        if (stillDown) activeTouchId = null;
    }
    zone.addEventListener('touchend', endTouch);
    zone.addEventListener('touchcancel', endTouch);
}

function setupActionButtons(state, attemptRecruitInteraction) {
    const sprintBtn = document.getElementById('touch-sprint-btn');
    if (sprintBtn) {
        // Hold-to-run, same semantics as Shift — not a toggle, so letting go
        // stops running immediately like the keyboard does.
        sprintBtn.addEventListener('touchstart', (e) => { state.move.run = true; sprintBtn.classList.add('active'); e.preventDefault(); }, { passive: false });
        const stop = () => { state.move.run = false; sprintBtn.classList.remove('active'); };
        sprintBtn.addEventListener('touchend', stop);
        sprintBtn.addEventListener('touchcancel', stop);
    }

    const interactBtn = document.getElementById('touch-interact-btn');
    if (interactBtn) {
        interactBtn.addEventListener('touchstart', (e) => {
            if (!state.isPaused) attemptRecruitInteraction(state);
            e.preventDefault();
        }, { passive: false });
    }

    // "Rest" (touch-rest-btn / HUD's "HOLD 'R' TO REST" hint) is left
    // unwired on purpose: there is no rest mechanic anywhere in this
    // rebuild — no KeyR listener in main.js, nothing it would call. The
    // button and HUD hint are leftover UI language from the old modular
    // project's design, same as the Modifiers tab's water hooks (PLAN.md)
    // — flagged rather than faked with a handler that does nothing real.

    // touch-pause-btn is already wired in core/input.js's setupPauseMenu()
    // — not duplicated here.
}

export function setupTouchControls(state, { attemptRecruitInteraction }) {
    const container = document.getElementById('touch-controls');
    if (!container) return;

    if (!shouldShowTouchControls()) return; // stays hidden; mouse/keyboard path is untouched

    container.classList.remove('hidden');
    document.body.classList.add('touch-active'); // lets index.html's CSS retarget crosshair/HUD/prompt layout for touch, see the .touch-active rules
    state.touchControlsActive = true;

    setupJoystick(state);
    setupLookZone(state);
    setupActionButtons(state, attemptRecruitInteraction);
}
