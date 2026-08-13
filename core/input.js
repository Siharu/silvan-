// Keyboard/mouse/pointer-lock listeners and the start-button wiring.
// Movement + collision logic lives in core/player-controller.js — this file
// only owns raw event listeners and state.keys/state.isPlaying/state.isLocked.

import { resumeAmbientAudio, pauseAmbientAudio } from '../audio/ambience.js';
import { attemptRecruitInteraction } from '../environment/animals.js';

export function setupInput(state) {
    const ui = document.getElementById('ui-layer');
    const hud = document.getElementById('hud-layer');
    const cross = document.getElementById('crosshair');

    document.getElementById('start-btn').addEventListener('click', () => {
        resumeAmbientAudio(state);
        document.body.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        state.isLocked = document.pointerLockElement === document.body;
        if (state.isLocked) {
            state.isPlaying = true; ui.classList.add('hidden'); hud.classList.remove('hidden'); cross.classList.remove('hidden');
        } else {
            state.isPlaying = false; ui.classList.remove('hidden'); hud.classList.add('hidden'); cross.classList.add('hidden');
            pauseAmbientAudio(state);
        }
    });

    window.addEventListener('keydown', (e) => { if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = true; });
    window.addEventListener('keyup', (e) => { if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = false; });
    // Shift doesn't follow the KeyX code pattern above, so it gets its own pair.
    window.addEventListener('keydown', (e) => { if (e.key === 'Shift') state.keys.shift = true; });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') state.keys.shift = false; });
    // Interact — edge-triggered (not tracked in state.keys) so holding E
    // doesn't spam recruit attempts every frame; ported from Bloodwoods'
    // handleInteraction, see environment/animals.js.
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyE' || !state.isLocked) return;
        attemptRecruitInteraction(state);
    });
    document.addEventListener('mousemove', (e) => {
        if (!state.isLocked) return;
        state.player.rotation.y -= e.movementX * 0.0018;
        state.player.rotation.x -= e.movementY * 0.0018;
        state.player.rotation.x = Math.max(-Math.PI/2.1, Math.min(Math.PI/2.1, state.player.rotation.x));
        state.camera.quaternion.setFromEuler(state.player.rotation);
    });
}

export function onWindowResize(state) {
    state.camera.aspect = window.innerWidth / window.innerHeight; state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight); state.composer.setSize(window.innerWidth, window.innerHeight);
}
