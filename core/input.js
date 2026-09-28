import { state } from './state.js';
import { shouldShowTouchControls } from './utils.js';
import { triggerJump } from './player-controller.js';
import { renderObjectives } from './journal.js';
import { startTutorial } from './tutorial.js';
import { POIS } from '../environment/pois.js';

// Split out of what used to be one setupInput() so the Remember click can
// kick off the loading-screen/init() flow (main.js's startGame()) without
// waiting for init() to finish first — see main.js's header comment on why
// that ordering was backwards before.
//
// requestPointerLock() has to be called synchronously, directly inside the
// click handler: browsers only honor it as a continuation of a real user
// gesture, and the `await`s in main.js's startGame() (yielding frames so
// the loading screen actually paints, then awaiting init() itself) happen
// on later ticks that no longer count as "the click." So the lock request
// happens here, before any of that async work starts, not inside
// enterGame() after init() resolves.
const POINTER_LOCK_FALLBACK_MS = 1000;

export function wireTitleScreen(onStart) {
    document.getElementById('title-remember-btn').addEventListener('click', () => {
        // Phase 6 #36: pointer lock is a desktop mouse-look concept — on
        // touch devices requestPointerLock() either no-ops or is refused
        // outright, and 'pointerlockchange' never fires true. Skipping it
        // entirely for touch avoids relying on the fallback timer below
        // (which only ever hid #ui-layer, never actually entered gameplay
        // state — see showGameplayUI() for the touch-driven equivalent,
        // called directly from main.js once init() finishes on touch).
        if (shouldShowTouchControls()) { onStart(); return; }

        document.body.requestPointerLock();
        onStart();

        // requestPointerLock() can be silently refused — blocked by
        // browser/embedding policy, a prior lock exit still in its cooldown,
        // etc — with no error and no 'pointerlockchange' event ever firing.
        // Without this, #ui-layer only ever hides from inside that handler
        // (see setupInput() below), so a refusal leaves the title screen
        // permanently stuck on top of the loading screen/game underneath.
        // If lock hasn't actually landed shortly after the click, hide the
        // UI layer directly so the player isn't stranded (mouse-look just
        // won't work until they manage to lock some other way, e.g.
        // clicking the canvas, which is better than being unable to play
        // at all).
        setTimeout(() => {
            if (state.isLocked) return; // real lock landed in time — nothing to do
            const ui = document.getElementById('ui-layer');
            if (ui) ui.classList.add('hidden');
        }, POINTER_LOCK_FALLBACK_MS);
    }, { once: true });
}

// Ambient audio has looser user-gesture rules than pointer lock and is fine
// to start once init() has actually built the Howl instances (initAudio()
// runs partway through init(), so this can't happen any earlier than that).
export function enterGame() {
    if (Howler.ctx && Howler.ctx.state === 'suspended') Howler.ctx.resume();
    if (!state.dayAmbientAudio.playing()) state.dayAmbientAudio.play();
    if (!state.nightAmbientAudio.playing()) state.nightAmbientAudio.play();
    if (!state.windAudio.playing()) state.windAudio.play();
    if (!state.waterAudio.playing()) state.waterAudio.play();
    if (!state.rainAudio.playing()) state.rainAudio.play();
    if (state.fireAudio && !state.fireAudio.playing()) state.fireAudio.play();
}

// Called immediately (main.js, on DOMContentLoaded) rather than waiting for
// init() to finish — the pointer lock in wireTitleScreen's click handler
// can succeed and fire 'pointerlockchange' while the loading screen is
// still up, before init() has built state.scene/camera. If this listener
// weren't registered until after init(), that first lock event would fire
// with nothing listening and the title UI would never hide. keydown/
// mousemove are likewise safe to wire this early since they only read
// state.player (a plain object that already exists in state.js) and
// state.camera, guarded below for the brief window before init() creates it.
// Phase 6 #36: the actual "enter gameplay" / "open pause" transitions,
// pulled out of the pointerlockchange handler below so touch-controls.js
// can trigger the exact same UI state without a real OS pointer lock
// (which touch devices don't have/need — look is a drag gesture there,
// not a locked mouse cursor).
export function showGameplayUI() {
    const ui = document.getElementById('ui-layer');
    const hud = document.getElementById('hud-layer');
    const cross = document.getElementById('crosshair');
    const pauseLayer = document.getElementById('pause-layer');
    state.isPlaying = true; ui.classList.add('hidden'); hud.classList.remove('hidden');
    // Touch has no mouse reticle to aim with — interaction is the dedicated
    // touch-interact-btn instead, so the crosshair would just be visual
    // noise sitting over the joystick/action buttons.
    if (shouldShowTouchControls()) cross.classList.add('hidden'); else cross.classList.remove('hidden');
    pauseLayer.classList.remove('visible');
    // Only true once startGame() has actually finished building the world
    // and called enterGame() itself (see main.js) — without this guard,
    // the very first lock (fired mid-loading-screen, before
    // state.dayAmbientAudio etc. exist yet) would try to resume Howl
    // instances that haven't been created.
    if (state.hasStarted) enterGame();
}

export function pauseGame() {
    const hud = document.getElementById('hud-layer');
    const cross = document.getElementById('crosshair');
    const pauseLayer = document.getElementById('pause-layer');
    state.isPlaying = false; hud.classList.add('hidden'); cross.classList.add('hidden');
    // Release held inputs so nothing (sprint, a joystick direction) stays stuck while paused.
    for (const k in state.keys) state.keys[k] = false;
    renderObjectives(POIS);
    if (state.dayAmbientAudio) state.dayAmbientAudio.pause();
    if (state.nightAmbientAudio) state.nightAmbientAudio.pause();
    if (state.windAudio) state.windAudio.pause();
    if (state.waterAudio) state.waterAudio.pause();
    if (state.rainAudio) state.rainAudio.pause();
    if (state.fireAudio) state.fireAudio.pause();
    // Losing pointer lock mid-game (ESC, or the browser silently dropping
    // it) used to always fall through to re-showing the full title screen
    // — meaning "pause" and "quit" looked identical, and worse, the
    // Remember button's listener is { once: true } (see wireTitleScreen
    // below) so it had already been consumed and clicking Remember again
    // did nothing at all. Now: mid-game loss shows the dedicated pause
    // overlay instead; the title screen only reappears via the real
    // Quit-to-Title path (a full reload — see wirePauseMenu below).
    if (state.hasStarted) {
        pauseLayer.classList.add('visible');
    } else {
        document.getElementById('ui-layer').classList.remove('hidden');
    }
}

export function setupInput() {
    // Tab hidden / app backgrounded: pause instead of letting the world run unattended.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && state.isPlaying) pauseGame();
    });

    const pauseLayer = document.getElementById('pause-layer');

    document.addEventListener('pointerlockchange', () => {
        state.isLocked = document.pointerLockElement === document.body;
        if (state.isLocked) {
            showGameplayUI();
        } else {
            pauseGame();
        }
    });

    window.addEventListener('keydown', (e) => {
        if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = true;
        // Phase 6 #37: Space/Shift don't fit the generic KeyX->x mapping
        // above (Space's own code already lowercases to "space" so it's
        // harmless there, but jump is edge-triggered rather than a held
        // state — see player-controller.js's triggerJump — and Shift's
        // code is "ShiftLeft"/"ShiftRight", neither of which matches a
        // state.keys entry at all without this explicit handling).
        if (e.code === 'Space' && !e.repeat) triggerJump();
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.keys.shift = true;
        // Pointer-lock loss already opens the pause overlay (see above) —
        // that covers the *first* Escape press. The browser won't fire
        // another 'pointerlockchange' for a second Escape press since the
        // pointer is already unlocked by then, so resuming needs its own
        // explicit handling here to make Escape a real toggle.
        if (e.code === 'Escape' && pauseLayer.classList.contains('visible')) {
            document.body.requestPointerLock();
        }
    });
    window.addEventListener('keyup', (e) => {
        if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = false;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.keys.shift = false;
    });
    document.addEventListener('mousemove', (e) => {
        if (!state.isLocked || !state.camera) return; // !state.camera: pointer lock can grant (and fire mousemove) while init() is still building the scene, during the loading screen
        applyLookDelta(e.movementX, e.movementY);
    });
}

// Phase 6 #36: pulled out of the mousemove handler above so
// touch-controls.js's look-drag zone can apply the exact same rotation
// math from touchmove deltas instead of duplicating the scale/invert/
// clamp logic.
export function applyLookDelta(dx, dy) {
    if (!state.camera) return;
    const scale = 0.0018 * (state.sensitivity || 1);
    const invert = state.invertY ? -1 : 1;
    state.player.rotation.y -= dx * scale;
    state.player.rotation.x -= dy * scale * invert;
    state.player.rotation.x = Math.max(-Math.PI/2.1, Math.min(Math.PI/2.1, state.player.rotation.x));
    state.camera.quaternion.setFromEuler(state.player.rotation);
}

// Wires the pause overlay's own buttons: Resume (re-requests pointer lock;
// the pointerlockchange handler above does the actual hiding/resuming),
// Quit to Title (a full reload — this project has no scene-teardown
// system, so rebuilding via reload is the safe option rather than trying
// to hand-unwind every THREE.js object/listener the world holds), and the
// Objectives/Settings accordion toggles (only one open at a time, same
// single-panel-open feel as the title screen's own Settings/Credits
// panels). Quality and FPS-counter controls inside Settings already work
// via settings.js's wireSettingsButtons() — everything else in that panel
// (Resolution, Antialiasing, weather/draw-distance/fog, view mode, FOV,
// sensitivity, volume sliders, keybinds, Export Save) is still inert;
// see PLAN.md's Next Steps for what wiring those still needs.
export function wirePauseMenu() {
    const pauseLayer = document.getElementById('pause-layer');
    const resumeBtn = document.getElementById('pause-resume-btn');
    const quitBtn = document.getElementById('pause-quit-btn');
    if (resumeBtn) resumeBtn.addEventListener('click', () => {
        // Phase 6 #36: touch never had pointer lock to begin with, so
        // re-requesting it here would just silently do nothing and leave
        // the pause overlay stuck up. Drive the same UI transition
        // directly instead — mirrors wireTitleScreen's touch branch above.
        if (shouldShowTouchControls()) showGameplayUI();
        else document.body.requestPointerLock();
    });
    if (quitBtn) quitBtn.addEventListener('click', () => location.reload());

    // Accordion: opening one panel closes the others.
    const PANELS = ['pause-objectives', 'pause-controls', 'pause-settings'];
    function wireAccordion(btnId, panelId) {
        const btn = document.getElementById(btnId);
        const panel = document.getElementById(panelId);
        if (!btn || !panel) return;
        btn.addEventListener('click', () => {
            const opening = !panel.classList.contains('open');
            PANELS.forEach((id) => { const p = document.getElementById(id); if (p) p.classList.remove('open'); });
            panel.classList.toggle('open', opening);
        });
    }
    wireAccordion('pause-objectives-btn', 'pause-objectives');
    wireAccordion('pause-controls-btn', 'pause-controls');
    wireAccordion('pause-settings-btn', 'pause-settings');
    const tutBtn = document.getElementById('pause-tutorial-btn');
    if (tutBtn) tutBtn.addEventListener('click', () => { startTutorial(true); if (resumeBtn) resumeBtn.click(); });
}

// Wires the title screen's Settings/Credits menu buttons to the same
// .open toggle the click-outside-backdrop handler in index.html already
// expects (see that script's own comment) — the panels' CSS and the
// close-on-outside-click behavior were already in place, only the buttons
// themselves had no listener. Single-panel-open, same feel as the pause
// menu's Objectives/Settings accordion in wirePauseMenu().
export function wireTitleMenu() {
    function wireToggle(btnId, panelId, otherPanelId) {
        const btn = document.getElementById(btnId);
        const panel = document.getElementById(panelId);
        const other = otherPanelId ? document.getElementById(otherPanelId) : null;
        if (!btn || !panel) return;
        btn.addEventListener('click', () => {
            const opening = !panel.classList.contains('open');
            panel.classList.toggle('open', opening);
            if (opening && other) other.classList.remove('open');
        });
    }
    wireToggle('title-settings-btn', 'title-settings-panel', 'title-credits-panel');
    wireToggle('title-credits-btn', 'title-credits-panel', 'title-settings-panel');
}

export function onWindowResize() {
    state.camera.aspect = window.innerWidth / window.innerHeight; state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight); state.composer.setSize(window.innerWidth, window.innerHeight);
}