// Keyboard/mouse/pointer-lock listeners and the start-button wiring.
// Movement + collision logic lives in core/player-controller.js — this file
// only owns raw event listeners and state.keys/state.isPlaying/state.isLocked.

import { resumeAmbientAudio, pauseAmbientAudio, setMasterVolume } from '../audio/ambience.js';
import { attemptRecruitInteraction } from '../environment/animals.js';
import { attemptTowerInteraction } from '../environment/radio-tower.js';
import { getQualityLevel, setQualityLevel } from './quality.js';

export function setupInput(state) {
    const ui = document.getElementById('ui-layer');
    const hud = document.getElementById('hud-layer');
    const cross = document.getElementById('crosshair');
    const pauseLayer = document.getElementById('pause-layer');
    const pauseSettings = document.getElementById('pause-settings');
    const volumeSlider = document.getElementById('pause-volume-slider');

    const rememberBtn = document.getElementById('title-remember-btn');
    const regainBtn = document.getElementById('title-regain-btn');
    const settingsBtn = document.getElementById('title-settings-btn');
    const creditsBtn = document.getElementById('title-credits-btn');
    const quitBtn = document.getElementById('title-quit-btn');
    const settingsPanel = document.getElementById('title-settings-panel');
    const creditsPanel = document.getElementById('title-credits-panel');
    const titleVolumeSlider = document.getElementById('title-volume-slider');
    const farewell = document.getElementById('title-farewell');

    // "Regain" (Continue) only makes sense — and only appears — once there's
    // an actual in-progress session to continue. Before that, showing it
    // next to "Remember" would just be a second button that does the exact
    // same first-entry thing under a false label.
    function refreshTitleMenuState() {
        regainBtn.classList.toggle('hidden', !state.hasStartedGame);
    }
    refreshTitleMenuState();

    rememberBtn.addEventListener('click', () => {
        if (state.hasStartedGame) {
            // A real "New Game": reloads for a genuinely fresh session,
            // rather than relabeling a button that'd otherwise just resume
            // exactly where the player left off (same reason "Regain" is
            // hidden above — a label should match what actually happens).
            location.reload();
            return;
        }
        state.hasStartedGame = true;
        document.body.requestPointerLock();
    });

    regainBtn.addEventListener('click', () => {
        document.body.requestPointerLock();
    });

    settingsBtn.addEventListener('click', () => {
        creditsPanel.classList.remove('open');
        settingsPanel.classList.toggle('open');
    });

    creditsBtn.addEventListener('click', () => {
        settingsPanel.classList.remove('open');
        creditsPanel.classList.toggle('open');
    });

    titleVolumeSlider.addEventListener('input', (e) => {
        setMasterVolume(state, parseFloat(e.target.value));
    });

    quitBtn.addEventListener('click', () => {
        // Non-destructive "farewell" beat — fades out rather than actually
        // tearing anything down (a browser tab can't reliably close itself
        // anyway outside a script-opened window), then eases back to the
        // title after a moment so clicking this out of curiosity doesn't
        // soft-lock the page.
        farewell.classList.add('visible');
        setTimeout(() => {
            farewell.classList.remove('visible');
            settingsPanel.classList.remove('open');
            creditsPanel.classList.remove('open');
        }, 3200);
    });

    document.addEventListener('pointerlockchange', () => {
        state.isLocked = document.pointerLockElement === document.body;
        if (state.isLocked) {
            state.isPlaying = true;
            ui.classList.add('hidden'); pauseLayer.classList.remove('visible');
            hud.classList.remove('hidden'); cross.classList.remove('hidden');
            // Resuming audio here (rather than only in the Remember/Regain
            // click handlers, which was the original bug) means it correctly
            // resumes on every re-lock — first entry AND every subsequent
            // Resume-from-pause — instead of only working the very first
            // time and then staying silent for the rest of the session.
            resumeAmbientAudio(state);
        } else {
            state.isPlaying = false;
            hud.classList.add('hidden'); cross.classList.add('hidden');
            // First-ever exit (before the player has clicked Remember even
            // once — e.g. accidental Escape on the title screen) still shows
            // the title screen; every exit after the game has actually
            // started shows the pause menu instead.
            if (state.hasStartedGame) pauseLayer.classList.add('visible');
            else ui.classList.remove('hidden');
            refreshTitleMenuState();
            pauseAmbientAudio(state);
        }
    });

    document.getElementById('pause-resume-btn').addEventListener('click', () => {
        document.body.requestPointerLock();
    });

    document.getElementById('pause-settings-btn').addEventListener('click', () => {
        pauseSettings.classList.toggle('open');
    });

    volumeSlider.addEventListener('input', (e) => {
        setMasterVolume(state, parseFloat(e.target.value));
    });

    document.getElementById('pause-quit-btn').addEventListener('click', () => {
        // "Quit to title" is a view swap, not a real reset — game state
        // (player position, time of day, recruited animals, etc.) is left
        // untouched, same as most games' pause-menu quit option actually
        // just returning to a menu rather than wiping progress. Clicking
        // "Regain" again just re-locks the pointer and play continues from
        // exactly where it was; "Remember" now genuinely reloads instead
        // (see refreshTitleMenuState above).
        pauseLayer.classList.remove('visible');
        pauseSettings.classList.remove('open');
        ui.classList.remove('hidden');
        refreshTitleMenuState();
    });

    // Graphics quality toggle — both the title-screen and pause-menu copies
    // wire to the same setQualityLevel(), which persists to localStorage
    // and reloads the page (see core/quality.js for why a reload rather
    // than live rebuilding). Both button pairs get their "active" state
    // reflected on load, in case the player only ever sees one of the two.
    const currentQuality = getQualityLevel();
    const qualityButtonPairs = [
        [document.getElementById('title-quality-high-btn'), document.getElementById('title-quality-low-btn')],
        [document.getElementById('pause-quality-high-btn'), document.getElementById('pause-quality-low-btn')],
    ];
    for (const [highBtn, lowBtn] of qualityButtonPairs) {
        if (!highBtn || !lowBtn) continue;
        highBtn.classList.toggle('active', currentQuality === 'high');
        lowBtn.classList.toggle('active', currentQuality === 'low');
        highBtn.addEventListener('click', () => setQualityLevel('high'));
        lowBtn.addEventListener('click', () => setQualityLevel('low'));
    }

    window.addEventListener('keydown', (e) => { if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = true; });
    window.addEventListener('keyup', (e) => { if(state.keys[e.code.toLowerCase().replace('key', '')] !== undefined) state.keys[e.code.toLowerCase().replace('key', '')] = false; });
    // Shift doesn't follow the KeyX code pattern above, so it gets its own pair.
    window.addEventListener('keydown', (e) => { if (e.key === 'Shift') state.keys.shift = true; });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') state.keys.shift = false; });
    // Interact — edge-triggered (not tracked in state.keys) so holding E
    // doesn't spam recruit attempts every frame; ported from Bloodwoods'
    // handleInteraction, see environment/animals.js. The radio tower takes
    // priority when both happen to be in range at once (TOWER_INTERACT_RANGE
    // is much larger than RECRUIT_RANGE, so this mostly matters right at
    // the tower's edge zone rather than being a real everyday conflict).
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyE' || !state.isLocked || state.cutsceneActive) return;
        if (state.nearRadioTower) attemptTowerInteraction(state);
        else attemptRecruitInteraction(state);
    });
    document.addEventListener('mousemove', (e) => {
        if (!state.isLocked || state.cutsceneActive) return;
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
