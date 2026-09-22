import { state } from './state.js';

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
export function wireTitleScreen(onStart) {
    document.getElementById('title-remember-btn').addEventListener('click', () => {
        document.body.requestPointerLock();
        onStart();
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
export function setupInput() {
    const ui = document.getElementById('ui-layer');
    const hud = document.getElementById('hud-layer');
    const cross = document.getElementById('crosshair');

    document.addEventListener('pointerlockchange', () => {
        state.isLocked = document.pointerLockElement === document.body;
        if (state.isLocked) {
            state.isPlaying = true; ui.classList.add('hidden'); hud.classList.remove('hidden'); cross.classList.remove('hidden');
        } else {
            state.isPlaying = false; ui.classList.remove('hidden'); hud.classList.add('hidden'); cross.classList.add('hidden');
            if (state.dayAmbientAudio) state.dayAmbientAudio.pause();
            if (state.nightAmbientAudio) state.nightAmbientAudio.pause();
            if (state.windAudio) state.windAudio.pause();
            if (state.waterAudio) state.waterAudio.pause();
            if (state.rainAudio) state.rainAudio.pause();
        }
    });

    window.addEventListener('keydown', (e) => { if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = true; });
    window.addEventListener('keyup', (e) => { if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = false; });
    document.addEventListener('mousemove', (e) => {
        if (!state.isLocked || !state.camera) return; // !state.camera: pointer lock can grant (and fire mousemove) while init() is still building the scene, during the loading screen
        state.player.rotation.y -= e.movementX * 0.0018;
        state.player.rotation.x -= e.movementY * 0.0018;
        state.player.rotation.x = Math.max(-Math.PI/2.1, Math.min(Math.PI/2.1, state.player.rotation.x));
        state.camera.quaternion.setFromEuler(state.player.rotation);
    });
}

export function onWindowResize() {
    state.camera.aspect = window.innerWidth / window.innerHeight; state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight); state.composer.setSize(window.innerWidth, window.innerHeight);
}
