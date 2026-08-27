// Mobile touch controls — virtual joystick for movement, drag-to-look zone,
// and action buttons (Interact/Sprint/Rest/Pause). Deliberately fakes the
// exact same inputs core/input.js's keyboard/mouse listeners already
// produce (state.keys.w/a/s/d booleans, the same camera-rotation math the
// mousemove handler uses) rather than inventing a parallel touch-specific
// movement path — core/player-controller.js needed zero changes to support
// this.
//
// Pointer Lock doesn't work well on touch (iOS Safari doesn't support the
// API at all), so touch play reuses the exact pattern core/input.js already
// established for top-down mode: skip requestPointerLock() entirely and
// set state.isLocked directly. See setupTouchControls's isLocked wiring
// below and core/input.js's enterPlayMode()/requestPlayLock() comments for
// the original precedent this follows.

export function isTouchCapable() {
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

const JOYSTICK_DEADZONE = 0.25; // fraction of max radius below which no direction registers at all — avoids drift from a barely-off-center thumb
const LOOK_SENSITIVITY_BASE = 0.0035; // touch drag needs a different base than mouse's 0.0018 (core/input.js) — screen-pixel drag distances and mouse movementX deltas aren't the same unit/scale

export function setupTouchControls(state) {
    const container = document.getElementById('touch-controls');
    if (!container) return;

    const forceOn = state.settings && state.settings.forceTouchControls;
    if (!isTouchCapable() && !forceOn) return; // desktop mouse/keyboard players never see this at all, and it never attaches a single listener

    container.classList.remove('hidden');
    // Hint text on the HUD was written for a keyboard — swap it to match
    // what's actually on screen now, same two ids core/input.js's HUD
    // update leaves alone otherwise.
    const pauseHint = document.getElementById('hud-pause-hint');
    const restHint = document.getElementById('hud-rest-hint');
    if (pauseHint) pauseHint.textContent = 'TAP ☰ TO PAUSE';
    if (restHint) restHint.textContent = "HOLD REST TO REST";

    // --- Joystick: movement ---
    const joyZone = document.getElementById('touch-joystick-zone');
    const joyBase = document.getElementById('touch-joystick-base');
    const joyKnob = document.getElementById('touch-joystick-knob');
    let joyTouchId = null;
    let joyCenter = { x: 0, y: 0 };
    const JOY_RADIUS = 68; // px — half of .touch-joystick-base's 8.5rem width (see index.html), knob travel clamps to this

    function resetJoystick() {
        joyTouchId = null;
        joyKnob.style.transform = 'translate(0px, 0px)';
        joyBase.classList.remove('active');
        state.keys.w = false; state.keys.a = false; state.keys.s = false; state.keys.d = false;
    }

    function updateJoystick(dx, dy) {
        const dist = Math.min(Math.hypot(dx, dy), JOY_RADIUS);
        const angle = Math.atan2(dy, dx);
        const clampedX = Math.cos(angle) * dist;
        const clampedY = Math.sin(angle) * dist;
        joyKnob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;

        // Digital (on/off), not analog — matches how state.keys is read
        // everywhere else (a boolean per direction, no magnitude), so a
        // light nudge past the deadzone moves at full walk speed exactly
        // like a keyboard tap would, no separate analog-speed code path
        // needed in core/player-controller.js.
        const norm = dist / JOY_RADIUS;
        if (norm < JOYSTICK_DEADZONE) {
            state.keys.w = false; state.keys.a = false; state.keys.s = false; state.keys.d = false;
            return;
        }
        // Screen space: +x right, +y down. Forward (w) is up-drag (-y).
        state.keys.w = dy < -JOY_RADIUS * JOYSTICK_DEADZONE * 0.4;
        state.keys.s = dy > JOY_RADIUS * JOYSTICK_DEADZONE * 0.4;
        state.keys.a = dx < -JOY_RADIUS * JOYSTICK_DEADZONE * 0.4;
        state.keys.d = dx > JOY_RADIUS * JOYSTICK_DEADZONE * 0.4;
    }

    // Listens on joyZone (the large invisible touch target), not joyBase
    // (the small ~136px visible circle) — joyBase.getBoundingClientRect()
    // is still what defines the knob's center, so the joystick still
    // visually anchors to the small circle; it's only the hit-test area
    // that's generous.
    joyZone.addEventListener('touchstart', (e) => {
        if (joyTouchId !== null) return; // already tracking a finger — ignore a second one landing on the zone
        const t = e.changedTouches[0];
        joyTouchId = t.identifier;
        const rect = joyBase.getBoundingClientRect();
        joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        joyBase.classList.add('active');
        e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (joyTouchId === null) return;
        const t = Array.from(e.changedTouches).find(t => t.identifier === joyTouchId);
        if (!t) return;
        updateJoystick(t.clientX - joyCenter.x, t.clientY - joyCenter.y);
        e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
        if (Array.from(e.changedTouches).some(t => t.identifier === joyTouchId)) resetJoystick();
    });
    window.addEventListener('touchcancel', (e) => {
        if (Array.from(e.changedTouches).some(t => t.identifier === joyTouchId)) resetJoystick();
    });

    // --- Look zone: drag to rotate camera ---
    // Same rotation math as core/input.js's mousemove handler — kept here
    // as its own copy rather than a shared export, since the two inputs
    // (touch drag distance in px vs. mouse movementX in OS-reported units)
    // genuinely need different sensitivity bases (LOOK_SENSITIVITY_BASE
    // above vs. core/input.js's 0.0018), so sharing a function would just
    // mean threading an extra base-multiplier parameter through it for one
    // call site each.
    const lookZone = document.getElementById('touch-look-zone');
    let lookTouchId = null;
    let lastLook = { x: 0, y: 0 };

    lookZone.addEventListener('touchstart', (e) => {
        if (lookTouchId !== null || !state.isLocked || state.cutsceneActive || state.viewMode === 'topdown') return;
        const t = e.changedTouches[0];
        lookTouchId = t.identifier;
        lastLook = { x: t.clientX, y: t.clientY };
        e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (lookTouchId === null) return;
        const t = Array.from(e.changedTouches).find(t => t.identifier === lookTouchId);
        if (!t) return;
        const dx = t.clientX - lastLook.x;
        const dy = t.clientY - lastLook.y;
        lastLook = { x: t.clientX, y: t.clientY };
        const sens = (state.settings ? state.settings.mouseSensitivity : 1.0) * LOOK_SENSITIVITY_BASE;
        const yInvert = (state.settings && state.settings.invertY) ? -1 : 1;
        state.player.rotation.y -= dx * sens;
        state.player.rotation.x -= dy * sens * yInvert;
        state.player.rotation.x = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, state.player.rotation.x));
        state.camera.quaternion.setFromEuler(state.player.rotation);
        e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
        if (Array.from(e.changedTouches).some(t => t.identifier === lookTouchId)) lookTouchId = null;
    });
    window.addEventListener('touchcancel', (e) => {
        if (Array.from(e.changedTouches).some(t => t.identifier === lookTouchId)) lookTouchId = null;
    });

    // --- Action buttons ---
    const sprintBtn = document.getElementById('touch-sprint-btn');
    const restBtn = document.getElementById('touch-rest-btn');
    const interactBtn = document.getElementById('touch-interact-btn');
    const pauseBtn = document.getElementById('touch-pause-btn');

    function bindHold(btn, key) {
        if (!btn) return;
        const start = (e) => { state.keys[key] = true; btn.classList.add('active'); e.preventDefault(); };
        const end = () => { state.keys[key] = false; btn.classList.remove('active'); };
        btn.addEventListener('touchstart', start, { passive: false });
        btn.addEventListener('touchend', end);
        btn.addEventListener('touchcancel', end);
    }
    bindHold(sprintBtn, 'shift');
    bindHold(restBtn, 'r');

    if (interactBtn) interactBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        interactBtn.classList.add('active');
        setTimeout(() => interactBtn.classList.remove('active'), 150);
        // core/input.js dispatches on the interact keybind's own KeyboardEvent
        // — rather than duplicating attemptTowerInteraction/
        // attemptRecruitInteraction's radio-tower-priority branching a second
        // time here, this fires the exact same synthetic key event so the
        // one real listener handles it identically for touch and keyboard.
        window.dispatchEvent(new KeyboardEvent('keydown', { code: state.keybinds.interact }));
    }, { passive: false });

    if (pauseBtn) pauseBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        // Same reasoning as Interact above — Escape's own pause handling in
        // core/input.js already exists and is stateful (pointer-lock exit,
        // cutscene-skip gating, etc.); re-dispatching it as a real event
        // reuses all of that instead of re-implementing it here.
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    }, { passive: false });
}
