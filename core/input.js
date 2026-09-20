import { state } from './state.js';

export function setupInput() {
    const ui = document.getElementById('ui-layer');
    const hud = document.getElementById('hud-layer');
    const cross = document.getElementById('crosshair');

    // NOTE: the real index.html's title screen uses 'title-remember-btn'
    // (Remember/Regain menu), not the old demo's 'start-btn'. This only
    // wires the Remember entry — Regain, Settings, Credits, Quit, pause
    // menu, touch controls, loading-screen progress, and save/load are
    // all systems from the real title-screen/main.js this extraction
    // doesn't have source for, so they stay unwired here.
    document.getElementById('title-remember-btn').addEventListener('click', () => {
        if (Howler.ctx && Howler.ctx.state === 'suspended') Howler.ctx.resume();
        if (!state.dayAmbientAudio.playing()) state.dayAmbientAudio.play();
        if (!state.nightAmbientAudio.playing()) state.nightAmbientAudio.play();
        if (!state.windAudio.playing()) state.windAudio.play();
        if (!state.waterAudio.playing()) state.waterAudio.play();
        if (!state.rainAudio.playing()) state.rainAudio.play();
        document.body.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        state.isLocked = document.pointerLockElement === document.body;
        if (state.isLocked) {
            state.isPlaying = true; ui.classList.add('hidden'); hud.classList.remove('hidden'); cross.classList.remove('hidden');
        } else {
            state.isPlaying = false; ui.classList.remove('hidden'); hud.classList.add('hidden'); cross.classList.add('hidden');
            state.dayAmbientAudio.pause(); state.nightAmbientAudio.pause(); state.windAudio.pause(); state.waterAudio.pause(); state.rainAudio.pause();
        }
    });

    window.addEventListener('keydown', (e) => { if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = true; });
    window.addEventListener('keyup', (e) => { if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = false; });
    document.addEventListener('mousemove', (e) => {
        if (!state.isLocked) return;
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

