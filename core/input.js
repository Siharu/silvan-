// Keyboard/mouse/pointer-lock listeners and the start-button wiring.
// Movement + collision logic lives in core/player-controller.js — this file
// only owns raw event listeners and state.keys/state.isPlaying/state.isLocked.

import { resumeAmbientAudio, pauseAmbientAudio, setMasterVolume, setSfxVolume } from '../audio/ambience.js';
import { attemptRecruitInteraction } from '../environment/animals.js';
import { attemptTowerInteraction } from '../environment/radio-tower.js';
import { getQualityLevel, setQualityLevel } from './quality.js';
import { getModifiers, setWaterModifier, setRockModifier, resetModifiers } from './modifiers.js';
import { getViewMode, setViewMode } from './view-mode.js';
import { setSetting } from './settings.js';
import { getKeybinds, setKeybind, resetKeybinds, buildCodeToAction, ACTION_LABELS } from './keybinds.js';
import { isTouchCapable, setupTouchControls } from './touch-controls.js';
import { hasLocalSave, readLocalSave, applySavedState, exportSaveFile, importSaveFile, writeLocalSave } from './save-system.js';

export function setupInput(state) {
    // Keybinds — see core/keybinds.js. codeToAction is a reverse lookup
    // (event.code -> action id) rebuilt whenever a bind changes, so the
    // keydown/keyup listeners further down stay a single generic lookup
    // instead of one hardcoded branch per action.
    state.keybinds = getKeybinds();
    // Touch play never uses real Pointer Lock (iOS Safari doesn't support
    // the API at all, and a virtual joystick/drag-look makes it pointless
    // even where it is supported) — computed once here since it gates both
    // enterPlayMode()/requestPlayLock() below and the topdown-style manual
    // Escape handling further down, not just core/touch-controls.js's own
    // listeners.
    state.usesFakeLock = isTouchCapable() || (state.settings && state.settings.forceTouchControls);
    function rebuildCodeToAction() {
        state.codeToAction = buildCodeToAction(state.keybinds);
        // Preserves the original hardcoded behavior (either physical Shift
        // key worked, since the old listener matched e.key === 'Shift'
        // rather than a specific code) as long as the player hasn't
        // deliberately rebound 'shift' to some other key entirely — once
        // they have, only that key applies, no forced dual-shift fallback.
        if (state.keybinds.shift === 'ShiftLeft') state.codeToAction.ShiftRight = 'shift';
        else if (state.keybinds.shift === 'ShiftRight') state.codeToAction.ShiftLeft = 'shift';
    }
    rebuildCodeToAction();

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
    // top-down and touch have no mouse-look to lock for (touch uses a
    // drag-look zone instead — see core/touch-controls.js — and can't rely
    // on the Pointer Lock API anyway), so both skip the browser API
    // entirely and just flip state.isLocked + the UI directly — see
    // updatePlayer()'s early-return gate in core/player-controller.js,
    // which only checks state.isLocked, not document.pointerLockElement, so
    // this is a legitimate way to "enter play" for a mode that was never
    // locked. Used by the pause-resume button, where the click is
    // immediate and synchronous — nothing to wait on, so request-lock and
    // show-UI can happen together. The very first entry (Remember/Regain)
    // can't use this: see requestPlayLock()/enterPlayModeAfterLoad() below.
    function enterPlayMode() {
        if (state.viewMode === 'topdown' || state.usesFakeLock) {
            state.isLocked = true;
            showPlayingUI();
        } else {
            document.body.requestPointerLock();
        }
    }

    // requestPointerLock() only succeeds inside a live user gesture — call
    // it any later (e.g. after an async engine load) and browsers refuse
    // it silently, pointerlockchange never fires "locked", and the game
    // would appear to just dump the player back on the title screen once
    // the loading screen hides. So this fires synchronously from inside
    // the Remember/Regain click itself, before state.startEngine's
    // multi-second build even starts. Top-down and touch need no browser
    // API, so it's a no-op here — handled entirely by
    // enterPlayModeAfterLoad.
    function requestPlayLock() {
        if (state.viewMode !== 'topdown' && !state.usesFakeLock) document.body.requestPointerLock();
    }

    // Reveals gameplay UI once state.startEngine's ready-callback fires —
    // unconditionally, rather than waiting on a pointerlockchange event
    // from requestPlayLock() above. That lock request may have already
    // resolved (or been silently denied by the browser/OS) well before
    // the engine finished loading; either way the player should land in
    // the actual game, not get stuck staring at a hidden loading screen
    // with nothing under it.
    function enterPlayModeAfterLoad() {
        if (state.viewMode === 'topdown' || state.usesFakeLock) state.isLocked = true;
        showPlayingUI();
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
        requestPlayLock();
        // The engine (scene/terrain/forest/player etc.) hasn't been built
        // yet — see main.js's state.startEngine. It shows the loading
        // screen and runs init(), then calls us back once state.scene and
        // everything else actually exist and it's safe to enter play.
        state.startEngine(() => {
            state.hasStartedGame = true;
            enterPlayModeAfterLoad();
        });
    });

    regainBtn.addEventListener('click', () => {
        requestPlayLock();
        state.startEngine(() => {
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
            enterPlayModeAfterLoad();
        });
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
        // requestPlayLock() (Remember/Regain) can resolve the lock while
        // the loading screen is still up, well before init() has built a
        // scene/HUD to reveal — ignore it here; enterPlayModeAfterLoad()
        // shows the playing UI explicitly once the engine actually is
        // ready. Once state.engineReady is true this behaves exactly as
        // before (Escape to pause, click to resume, etc.).
        if (!state.engineReady) return;
        if (state.isLocked) showPlayingUI();
        else showPausedUI();
    });

    // Top-down and touch have no pointer lock to exit, so nothing generates
    // a native pointerlockchange event when the player wants to pause —
    // Escape has to be handled manually here instead (and, for touch, the
    // pause button dispatches this same synthetic Escape keydown — see
    // core/touch-controls.js). Real first-person mouse play doesn't need
    // this: the browser exits pointer lock on Escape by itself, which the
    // listener above already reacts to.
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'Escape' || (state.viewMode !== 'topdown' && !state.usesFakeLock) || !state.isLocked) return;
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

    // Graphics quality toggle — title, pause, and now Medium alongside
    // High/Low (core/quality.js). All copies wire to the same
    // setQualityLevel(), which persists to localStorage and reloads the
    // page (see core/quality.js for why a reload rather than live
    // rebuilding). Every button triple gets its "active" state reflected
    // on load, in case the player only ever sees one of the two panels.
    const currentQuality = getQualityLevel();
    const qualityButtonTriples = [
        [document.getElementById('title-quality-high-btn'), document.getElementById('title-quality-med-btn'), document.getElementById('title-quality-low-btn')],
        [document.getElementById('pause-quality-high-btn'), document.getElementById('pause-quality-med-btn'), document.getElementById('pause-quality-low-btn')],
    ];
    for (const [highBtn, medBtn, lowBtn] of qualityButtonTriples) {
        if (!highBtn || !medBtn || !lowBtn) continue;
        highBtn.classList.toggle('active', currentQuality === 'high');
        medBtn.classList.toggle('active', currentQuality === 'medium');
        lowBtn.classList.toggle('active', currentQuality === 'low');
        highBtn.addEventListener('click', () => setQualityLevel('high'));
        medBtn.addEventListener('click', () => setQualityLevel('medium'));
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

    // Camera/Graphics/Audio live settings (core/settings.js) — every one of
    // these applies immediately with no reload, so unlike the quality/view-
    // mode toggles above these just need to persist + push the value
    // straight into state/uniforms on 'input'. Title and pause copies of
    // each control are bound together in a small array so both panels
    // always agree, same duplication convention as the quality/view-mode
    // button pairs above rather than inventing a new pattern this late.
    function bindPairedSliders(titleId, pauseId, key, onApply) {
        const els = [document.getElementById(titleId), document.getElementById(pauseId)].filter(Boolean);
        if (els.length === 0) return;
        const initial = state.settings[key];
        els.forEach(el => { el.value = initial; });
        els.forEach(el => el.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            state.settings = setSetting(key, v);
            els.forEach(other => { if (other !== e.target) other.value = v; }); // keep both panels' sliders in sync if the player has one visible while paused mid-drag on the other — shouldn't normally happen, but cheap to guarantee
            onApply(v);
        }));
    }

    bindPairedSliders('title-fov-slider', 'pause-fov-slider', 'fov', (v) => {
        if (state.viewMode !== 'topdown') { state.camera.fov = v; state.camera.updateProjectionMatrix(); }
    });
    bindPairedSliders('title-sensitivity-slider', 'pause-sensitivity-slider', 'mouseSensitivity', () => {}); // read live off state.settings in the mousemove handler itself, nothing to push
    bindPairedSliders('title-draw-distance-slider', 'pause-draw-distance-slider', 'drawDistance', () => {}); // fed to uSwitchDist every frame in atmosphere/day-night-cycle.js's generic traverse loop, nothing to push here
    bindPairedSliders('title-fog-density-slider', 'pause-fog-density-slider', 'fogDensityMult', (v) => {
        state.scene.fog.density = state.baseFogDensity * v;
    });
    bindPairedSliders('title-ambience-volume-slider', 'pause-ambience-volume-slider', 'ambienceVolume', () => {}); // read live off state.settings inside setAmbientVolume() every frame, nothing to push
    bindPairedSliders('title-sfx-volume-slider', 'pause-sfx-volume-slider', 'sfxVolume', (v) => setSfxVolume(state, v));

    const invertYCheckboxes = [document.getElementById('title-invert-y-checkbox'), document.getElementById('pause-invert-y-checkbox')].filter(Boolean);
    invertYCheckboxes.forEach(el => { el.checked = state.settings.invertY; });
    invertYCheckboxes.forEach(el => el.addEventListener('change', (e) => {
        state.settings = setSetting('invertY', e.target.checked);
        invertYCheckboxes.forEach(other => { if (other !== e.target) other.checked = e.target.checked; });
    }));

    // Force Touch Controls — reload-required, same as the quality/view-mode
    // toggles: core/touch-controls.js only attaches its listeners once, at
    // setupTouchControls() during this very setupInput() call, so flipping
    // this mid-session wouldn't retroactively spawn the joystick/buttons
    // without a full re-init. Simplest to just be honest about that in the
    // label (see index.html's "(applies on reload)" note) rather than build
    // a live-attach path for a testing/accessibility toggle.
    const forceTouchCheckboxes = [document.getElementById('title-force-touch-checkbox'), document.getElementById('pause-force-touch-checkbox')].filter(Boolean);
    forceTouchCheckboxes.forEach(el => { el.checked = !!state.settings.forceTouchControls; });
    forceTouchCheckboxes.forEach(el => el.addEventListener('change', (e) => {
        state.settings = setSetting('forceTouchControls', e.target.checked);
        forceTouchCheckboxes.forEach(other => { if (other !== e.target) other.checked = e.target.checked; });
    }));

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

    // Rewired for environment/water-shader.js's Gerstner shader — the old
    // uWaveHeightMult/uWaveSpeedMult/uStormReactivityMult uniforms belonged
    // to a since-replaced shader and no longer exist on either material,
    // which left these three sliders silently inert. Height/speed now
    // scale each material's own baseSteepness/baseSpeed (see
    // environment/water-shader.js's createWaterMaterial) rather than
    // setting an absolute value, so the lake and ocean keep their distinct
    // calm-vs-choppy character instead of both landing on whatever number
    // the slider shows. Storm reactivity no longer has a literal "storm"
    // shader mode to hook into, so it's repurposed as how much extra wave
    // height rain adds on top of the height slider — applied continuously
    // every frame in atmosphere/day-night-cycle.js's water uniform feed
    // (reads state.modifiers directly), not here, so it stays live as rain
    // intensity changes rather than only updating when a slider moves.
    function applyLiveWaterUniform(kind, mult) {
        for (const mat of [state.waterMaterial, state.oceanMaterial]) {
            if (!mat || !mat.uniforms || !mat.userData) continue;
            if (kind === 'speed' && mat.userData.baseSpeed !== undefined) {
                mat.uniforms.u_speed.value = mat.userData.baseSpeed * mult;
            }
        }
    }
    if (waveHeightSlider) waveHeightSlider.addEventListener('input', (e) => {
        state.modifiers = setWaterModifier('waterWaveHeight', parseFloat(e.target.value));
    });
    if (waveSpeedSlider) waveSpeedSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        state.modifiers = setWaterModifier('waterWaveSpeed', v);
        applyLiveWaterUniform('speed', v);
    });
    if (stormReactivitySlider) stormReactivitySlider.addEventListener('input', (e) => {
        state.modifiers = setWaterModifier('waterStormReactivity', parseFloat(e.target.value));
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
    if (modifiersResetBtn) modifiersResetBtn.addEventListener('click', () => {
        const before = getModifiers();
        const defaults = resetModifiers();
        state.modifiers = defaults; // was previously discarded — day-night-cycle.js's per-frame wave-height/storm-reactivity feed reads state.modifiers directly, so this must be updated for the reset to actually take effect
        if (waveHeightSlider) waveHeightSlider.value = defaults.waterWaveHeight;
        if (waveSpeedSlider) waveSpeedSlider.value = defaults.waterWaveSpeed;
        if (stormReactivitySlider) stormReactivitySlider.value = defaults.waterStormReactivity;
        applyLiveWaterUniform('speed', defaults.waterWaveSpeed); // wave height/storm reactivity are read live from state.modifiers each frame, but speed is baked into the uniform on change, so it needs an explicit push here
        // Rock detail/roughness are baked into InstancedMesh geometry at
        // creation time (see file header), so a reset only needs a reload
        // if either one had actually drifted from default — a pure water
        // reset shouldn't cost the player a reload.
        if (before.rockDetail !== defaults.rockDetail || before.rockRoughness !== defaults.rockRoughness) {
            location.reload();
            return;
        }
        for (const btn of rockDetailButtons) btn.classList.toggle('active', defaults.rockDetail === btn.dataset.value);
        if (rockRoughnessSlider) rockRoughnessSlider.value = defaults.rockRoughness;
    });

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

    // Keybind rebind UI (Controls tab) — built dynamically from
    // ACTION_LABELS/state.keybinds rather than hardcoded rows, so title and
    // pause always show the same list and never drift from what
    // core/keybinds.js actually defines. Mouse Look isn't a real key-code
    // binding (mouse, not keyboard), so it's listed as a fixed read-only
    // chip rather than a rebindable one.
    const MOUSE_ONLY_CHIPS = [{ label: 'Look', key: 'Mouse' }];
    function codeToDisplay(code) {
        if (!code) return '—';
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
        if (code === 'Space') return 'Space';
        return code;
    }
    function buildKeybindList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        for (const action of Object.keys(ACTION_LABELS)) {
            const btn = document.createElement('button');
            btn.className = 'control-chip';
            btn.type = 'button';
            btn.innerHTML = `<span class="control-key">${codeToDisplay(state.keybinds[action])}</span><span class="control-label">${ACTION_LABELS[action]}</span>`;
            btn.addEventListener('click', () => startListening(btn, action));
            container.appendChild(btn);
        }
        for (const chip of MOUSE_ONLY_CHIPS) {
            const div = document.createElement('div');
            div.className = 'control-chip';
            div.innerHTML = `<span class="control-key">${chip.key}</span><span class="control-label">${chip.label}</span>`;
            container.appendChild(div);
        }
    }
    let listeningBtn = null;
    let activeCapture = null; // the live keydown listener for listeningBtn, if any — torn down before a new one starts so it can never fire again after being superseded
    function stopListening() {
        if (activeCapture) window.removeEventListener('keydown', activeCapture, true);
        activeCapture = null;
        if (listeningBtn) {
            listeningBtn.classList.remove('listening');
            buildKeybindList('title-keybind-list');
            buildKeybindList('pause-keybind-list'); // restores the cancelled chip's real key label, since it was overwritten with "Press any key…"
        }
        listeningBtn = null;
    }
    function startListening(btn, action) {
        stopListening(); // only one chip captures input at a time — this also removes the previous chip's still-live capture listener, not just its CSS class
        listeningBtn = btn;
        btn.classList.add('listening');
        btn.querySelector('.control-key').textContent = 'Press any key…';
        const capture = (e) => {
            e.preventDefault();
            if (e.code === 'Escape') { stopListening(); return; } // cancel without binding Escape itself
            state.keybinds = setKeybind(action, e.code);
            rebuildCodeToAction();
            listeningBtn = null;
            activeCapture = null;
            window.removeEventListener('keydown', capture, true);
            buildKeybindList('title-keybind-list');
            buildKeybindList('pause-keybind-list'); // rebuild both lists — a swap (see setKeybind's conflict handling) can change a row in the OTHER list too
        };
        activeCapture = capture;
        // capture phase + true so this runs before the movement keydown
        // listener below and Escape can be used to cancel a rebind without
        // accidentally pausing the game mid-capture.
        window.addEventListener('keydown', capture, true);
    }
    buildKeybindList('title-keybind-list');
    buildKeybindList('pause-keybind-list');
    const keybindResetBtns = [document.getElementById('title-keybind-reset-btn'), document.getElementById('pause-keybind-reset-btn')].filter(Boolean);
    keybindResetBtns.forEach(btn => btn.addEventListener('click', () => {
        state.keybinds = resetKeybinds();
        rebuildCodeToAction();
        buildKeybindList('title-keybind-list');
        buildKeybindList('pause-keybind-list');
    }));

    window.addEventListener('keydown', (e) => {
        const action = state.codeToAction[e.code];
        if (!action) return;
        if (action === 'interact') {
            // Edge-triggered (not tracked in state.keys) so holding the
            // interact key doesn't spam recruit attempts every frame;
            // ported from Bloodwoods' handleInteraction, see
            // environment/animals.js. The radio tower takes priority when
            // both happen to be in range at once (TOWER_INTERACT_RANGE is
            // much larger than RECRUIT_RANGE, so this mostly matters right
            // at the tower's edge zone rather than being a real everyday
            // conflict).
            if (!state.isLocked || state.cutsceneActive) return;
            if (state.nearRadioTower) attemptTowerInteraction(state);
            else attemptRecruitInteraction(state);
            return;
        }
        if (state.keys[action] !== undefined) state.keys[action] = true;
    });
    window.addEventListener('keyup', (e) => {
        const action = state.codeToAction[e.code];
        if (action && state.keys[action] !== undefined) state.keys[action] = false;
    });
    document.addEventListener('mousemove', (e) => {
        if (!state.isLocked || state.cutsceneActive || state.viewMode === 'topdown') return;
        const sens = (state.settings ? state.settings.mouseSensitivity : 1.0) * 0.0018;
        const yInvert = (state.settings && state.settings.invertY) ? -1 : 1;
        state.player.rotation.y -= e.movementX * sens;
        state.player.rotation.x -= e.movementY * sens * yInvert;
        state.player.rotation.x = Math.max(-Math.PI/2.1, Math.min(Math.PI/2.1, state.player.rotation.x));
        state.camera.quaternion.setFromEuler(state.player.rotation);
    });

    setupTouchControls(state);
}

export function onWindowResize(state) {
    state.camera.aspect = window.innerWidth / window.innerHeight; state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
}