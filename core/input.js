// Keyboard/mouse/pointer-lock listeners and the start-button wiring.
// Movement + collision logic lives in core/player-controller.js — this file
// only owns raw event listeners and state.keys/state.isPlaying/state.isLocked.

import { resumeAmbientAudio, pauseAmbientAudio, setMasterVolume } from '../audio/ambience.js';
import { attemptRecruitInteraction } from '../environment/animals.js';
import { attemptTowerInteraction } from '../environment/radio-tower.js';
import { getQualityLevel, setQualityLevel } from './quality.js';
import { getModifiers, setWaterModifier, setRockModifier, resetModifiers } from './modifiers.js';
import { getViewMode, setViewMode } from './view-mode.js';
import { hasLocalSave, readLocalSave, applySavedState, exportSaveFile, importSaveFile, writeLocalSave } from './save-system.js';

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
    const helpToggleBtn = document.getElementById('title-help-toggle-btn');
    const controlsPanel = document.getElementById('title-controls-panel');

    // "Regain" (Continue) only makes sense — and only appears — once
    // there's something real to continue: either a live in-memory session
    // this tab (quit-to-title without a real page reload — state was
    // never torn down) or a real save on disk (core/save-system.js) from a
    // previous visit. Before either exists, showing it next to "Remember"
    // would just be a second button doing the exact same first-entry thing
    // under a false label.
    function refreshTitleMenuState() {
        regainBtn.classList.toggle('hidden', !state.hasStartedGame && !hasLocalSave());
    }
    refreshTitleMenuState();

    // Shared between the real pointerlockchange listener (first-person —
    // the browser fires this natively on lock/unlock) and top-down mode's
    // manual entry/pause path below (top-down never actually requests
    // pointer lock, since there's no mouse-look, so nothing would ever fire
    // that event for it). Keeping both paths funneled through the same two
    // functions means "what happens when play starts/pauses" only has one
    // definition instead of two that could quietly drift apart.
    function showPlayingUI() {
        state.isPlaying = true;
        ui.classList.add('hidden'); pauseLayer.classList.remove('visible');
        hud.classList.remove('hidden');
        if (state.viewMode !== 'topdown') cross.classList.remove('hidden'); // no aiming reticle in top-down — interactions are proximity-based (environment/animals.js), not raycast/crosshair-driven
        resumeAmbientAudio(state);
    }
    function showPausedUI() {
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
    // First-person requests real pointer lock (mouse-look needs it);
    // top-down has no mouse-look, so it skips the browser API entirely and
    // just flips state.isLocked + the UI directly — see updatePlayer()'s
    // early-return gate in core/player-controller.js, which only checks
    // state.isLocked, not document.pointerLockElement, so this is a
    // legitimate way to "enter play" for a mode that was never locked.
    function enterPlayMode() {
        if (state.viewMode === 'topdown') {
            state.isLocked = true;
            showPlayingUI();
        } else {
            document.body.requestPointerLock();
        }
    }

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
        enterPlayMode();
    });

    regainBtn.addEventListener('click', () => {
        // Two different situations both land here: (a) a live in-memory
        // session already exists this tab (came from quit-to-title, state
        // was never torn down) — nothing to load, just resume as-is. (b) a
        // genuinely fresh page load with no live session, but a real save
        // exists on disk from a previous visit — has to be applied now,
        // before entering play, or "Regain" would silently just start a
        // brand-new game at the default spawn instead of the saved one.
        if (!state.hasStartedGame && hasLocalSave()) {
            applySavedState(state, readLocalSave());
        }
        state.hasStartedGame = true;
        enterPlayMode();
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

    // WASD/Mouse/Shift/R control chips moved off the front title screen and
    // in behind this Help toggle inside Settings — collapsed by default so
    // returning players aren't shown a tutorial every time, one click away
    // for anyone who actually wants it.
    helpToggleBtn.addEventListener('click', () => {
        const nowOpen = controlsPanel.classList.toggle('open');
        helpToggleBtn.setAttribute('aria-expanded', String(nowOpen));
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
        // Only meaningful in first-person — top-down never requests
        // pointer lock, so document.pointerLockElement never points at
        // this page for it, and this listener simply won't fire for
        // top-down's enter/pause actions (those call showPlayingUI/
        // showPausedUI directly instead, see enterPlayMode above and the
        // topdown-escape listener below).
        if (state.viewMode === 'topdown') return;
        state.isLocked = document.pointerLockElement === document.body;
        if (state.isLocked) showPlayingUI();
        else showPausedUI();
    });

    // Top-down has no pointer lock to exit, so nothing generates a native
    // pointerlockchange event when the player wants to pause — Escape has
    // to be handled manually here instead. First-person doesn't need this:
    // the browser exits pointer lock on Escape by itself, which the
    // listener above already reacts to.
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'Escape' || state.viewMode !== 'topdown' || !state.isLocked) return;
        state.isLocked = false;
        showPausedUI();
    });

    document.getElementById('pause-resume-btn').addEventListener('click', enterPlayMode);

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
        //
        // Also a real save checkpoint (core/save-system.js) — belt-and-
        // suspenders alongside the periodic autosave in main.js's animate()
        // loop, so quitting deliberately never has to wait up to 30s for
        // the next periodic tick to actually capture where you stopped.
        writeLocalSave(state);
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

    // View mode toggle (core/view-mode.js) — Open World (first-person) vs.
    // Top-Down (low-end devices). Reload-to-apply, same reasoning as
    // Graphics: this changes which camera type gets built and forces the
    // quality preset in main.js's init(), neither of which this codebase
    // is set up to tear down and rebuild live.
    const currentViewMode = getViewMode();
    const viewModeButtonPairs = [
        [document.getElementById('title-view-firstperson-btn'), document.getElementById('title-view-topdown-btn')],
        [document.getElementById('pause-view-firstperson-btn'), document.getElementById('pause-view-topdown-btn')],
    ];
    for (const [fpBtn, tdBtn] of viewModeButtonPairs) {
        if (!fpBtn || !tdBtn) continue;
        fpBtn.classList.toggle('active', currentViewMode === 'firstperson');
        tdBtn.classList.toggle('active', currentViewMode === 'topdown');
        fpBtn.addEventListener('click', () => setViewMode('firstperson'));
        tdBtn.addEventListener('click', () => setViewMode('topdown'));
    }

    // Rock/water modifiers (core/modifiers.js) — exposes the rock.html /
    // ocean-water.html-style tuning knobs in Settings instead of leaving
    // them as hardcoded constants. Water sliders are live (no reload —
    // just uniform writes, see environment/lake.js + ocean.js); rock detail
    // and roughness bake into InstancedMesh geometry at creation time, so
    // those follow the same "reload to apply" pattern as the Graphics
    // toggle above rather than pretending they're free to preview live.
    const modifiersToggleBtn = document.getElementById('title-modifiers-toggle-btn');
    const modifiersPanel = document.getElementById('title-modifiers-panel');
    if (modifiersToggleBtn && modifiersPanel) {
        modifiersToggleBtn.addEventListener('click', () => {
            const nowOpen = modifiersPanel.classList.toggle('open');
            modifiersToggleBtn.setAttribute('aria-expanded', String(nowOpen));
        });
    }

    const waveHeightSlider = document.getElementById('title-wave-height-slider');
    const waveSpeedSlider = document.getElementById('title-wave-speed-slider');
    const stormReactivitySlider = document.getElementById('title-storm-reactivity-slider');
    const currentModifiers = getModifiers();
    if (waveHeightSlider) waveHeightSlider.value = currentModifiers.waterWaveHeight;
    if (waveSpeedSlider) waveSpeedSlider.value = currentModifiers.waterWaveSpeed;
    if (stormReactivitySlider) stormReactivitySlider.value = currentModifiers.waterStormReactivity;

    // Both materials expose the same three uniform names (see lake.js's and
    // ocean.js's uWaveHeightMult/uWaveSpeedMult/uStormReactivityMult) —
    // writing to both here keeps the lake and the distant sea tuned
    // together rather than needing two separate sets of sliders.
    function applyLiveWaterUniform(uniformName, value) {
        for (const mat of [state.waterMaterial, state.oceanMaterial]) {
            if (mat && mat.uniforms && mat.uniforms[uniformName]) {
                mat.uniforms[uniformName].value = value;
            }
        }
    }
    if (waveHeightSlider) waveHeightSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        setWaterModifier('waterWaveHeight', v);
        applyLiveWaterUniform('uWaveHeightMult', v);
    });
    if (waveSpeedSlider) waveSpeedSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        setWaterModifier('waterWaveSpeed', v);
        applyLiveWaterUniform('uWaveSpeedMult', v);
    });
    if (stormReactivitySlider) stormReactivitySlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        setWaterModifier('waterStormReactivity', v);
        applyLiveWaterUniform('uStormReactivityMult', v);
    });

    const rockDetailButtons = [
        document.getElementById('title-rock-detail-low-btn'),
        document.getElementById('title-rock-detail-med-btn'),
        document.getElementById('title-rock-detail-high-btn'),
    ].filter(Boolean);
    for (const btn of rockDetailButtons) {
        btn.classList.toggle('active', currentModifiers.rockDetail === btn.dataset.value);
        // Reloads immediately on click, same as the Graphics toggle — no
        // live rock preview is possible (baked geometry), so there's no
        // benefit to letting the player queue up multiple changes first.
        btn.addEventListener('click', () => setRockModifier('rockDetail', btn.dataset.value));
    }

    const rockRoughnessSlider = document.getElementById('title-rock-roughness-slider');
    if (rockRoughnessSlider) {
        rockRoughnessSlider.value = currentModifiers.rockRoughness;
        // 'change' (fires on release/commit), not 'input' (fires every tick
        // while dragging) — this one reloads the page, so it must only fire
        // once the player has actually settled on a value.
        rockRoughnessSlider.addEventListener('change', (e) => {
            setRockModifier('rockRoughness', parseFloat(e.target.value));
        });
    }

    const modifiersResetBtn = document.getElementById('title-modifiers-reset-btn');
    if (modifiersResetBtn) modifiersResetBtn.addEventListener('click', () => resetModifiers());

    // Save Data — Export downloads a real .json file (core/save-system.js);
    // Import reads one back in. Import only lives on the title screen (not
    // the pause menu) — loading a save mid-play would silently clobber
    // whatever the player's currently doing, which isn't a real use case
    // the way "export whenever, even mid-session" is.
    function setSaveStatus(el, message, isError) {
        if (!el) return;
        el.textContent = message;
        el.classList.toggle('error', !!isError);
    }

    const titleExportBtn = document.getElementById('title-export-save-btn');
    const titleImportBtn = document.getElementById('title-import-save-btn');
    const titleImportInput = document.getElementById('title-import-save-input');
    const titleSaveStatus = document.getElementById('title-save-status');
    if (titleExportBtn) titleExportBtn.addEventListener('click', () => {
        exportSaveFile(state);
        setSaveStatus(titleSaveStatus, 'Save file downloaded.', false);
    });
    if (titleImportBtn && titleImportInput) {
        titleImportBtn.addEventListener('click', () => titleImportInput.click());
        titleImportInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            titleImportInput.value = ''; // allow re-selecting the same file later
            if (!file) return;
            try {
                const data = await importSaveFile(file);
                applySavedState(state, data);
                writeLocalSave(state); // imported save becomes the new autosave baseline too
                state.hasStartedGame = true;
                setSaveStatus(titleSaveStatus, 'Save loaded — entering the forest…', false);
                enterPlayMode();
            } catch (err) {
                setSaveStatus(titleSaveStatus, err.message || 'Could not load that save file.', true);
            }
        });
    }

    const pauseExportBtn = document.getElementById('pause-export-save-btn');
    const pauseSaveStatus = document.getElementById('pause-save-status');
    if (pauseExportBtn) pauseExportBtn.addEventListener('click', () => {
        exportSaveFile(state);
        setSaveStatus(pauseSaveStatus, 'Save file downloaded.', false);
    });

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
        if (!state.isLocked || state.cutsceneActive || state.viewMode === 'topdown') return;
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
