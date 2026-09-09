// main.js — wires every ported system together into an actual running
// game. This is new code (not a port) since none of the reference HTML
// files shared one scene/init/animate structure this project could copy
// wholesale — each was its own standalone demo.
//
// PLAN.md #3 (settings menu / pause menu) is now wired: core/input.js,
// core/save-system.js, core/quality.js, core/view-mode.js all exist and
// setupInput(state) is called right below, before the title screen's
// "Remember" button is ever clicked. See core/input.js's own header
// comment for exactly which controls are live, reload-tier, or still
// honestly stubbed (rock detail, top-down mode, keybind remapping, and
// audio volume all persist correctly but have nothing downstream to apply
// to yet — no modifiers.js, no top-down controller, no remapping, no audio
// system exist in this rebuild).

import * as THREE from 'three';
import { createWorldState, WATER_LEVEL } from './core/world-state.js';
import { getSettings } from './core/settings.js';
import { getQualityCounts } from './core/quality.js';
import { getViewMode } from './core/view-mode.js';
import { getKeybinds } from './core/keybinds.js';
import { setupInput, toggleTimeFastForward } from './core/input.js';
import { ensureAudioContext } from './core/audio.js';
import { updateRestHold } from './core/rest.js';
import { markGameStarted } from './core/save-system.js';

import { createTerrain, getElevation } from './environment/terrain.js';
import { createGrass, updateGrass } from './environment/grass.js';
import { createRainSystem, createRainSplashes, updateRain } from './environment/rain.js';
import { createWeather, updateWeather } from './atmosphere/weather.js';
import { createFlowers, updateFlowers } from './environment/flowers.js';
import { createPuddles, updatePuddles } from './environment/puddles.js';
import { createFireflies, updateFireflies } from './environment/fireflies.js';
import { createDustParticles, updateDustParticles } from './environment/dust.js';
import { createFerns, updateFoliage } from './environment/foliage.js';
import { createBushes, updateBushes } from './environment/bushes.js';
import { generateFractalForest, updateForestLOD } from './environment/forest.js';
import { createRocks, updateRocks } from './environment/rocks.js';
import { createDetailedPineTrees } from './environment/pine-trees.js';
import { createWater, updateWater } from './environment/water.js';
import { createRadioTower, updateRadioTower } from './environment/radio-tower.js';
import { spawnDemoAnimals, updateDemoAnimals, updateInteractPrompt, attemptRecruitInteraction, updateRadioTowerProximity } from './environment/animals.js';
import { createDayNightCycle, updateDayNightCycle, updateStars } from './atmosphere/day-night-cycle.js';
import { setupTouchControls } from './core/touch-controls.js';

const state = createWorldState();
window._silvanState = state; // console-debuggable, same convenience the old project's main.js had

// Live-mutable settings snapshot — core/input.js writes straight into this
// object on every slider change, so the player controller's mousemove
// handler (a closure created once in setupPlayerController, long before
// input.js exists as a separate module) reads live values every frame
// instead of a stale getSettings() snapshot taken at controller-setup time.
state.settings = getSettings();
state.isPaused = false;

// PLAN.md #3: wired here, immediately, rather than inside init() — the
// title screen's Settings/Credits panels need to work before the
// "Remember" button is ever clicked (state.camera/state.renderer are still
// null at this point; every input.js control that touches them is
// null-guarded so this is safe to call this early).
setupInput(state);

// Ominous progress labels, same tone/spirit as the old canvas loading
// screen's poetic state text — cycled by percent threshold rather than
// literal step names ("Generating forest" etc reads like a debug log,
// not this game's voice).
const LOADING_LABELS = [
    { at: 0, text: 'the hearth is still' },
    { at: 15, text: 'something is taking root' },
    { at: 35, text: 'the trees remember first' },
    { at: 55, text: 'water finds its level' },
    { at: 75, text: 'small things begin to move' },
    { at: 92, text: 'you are almost there' },
    { at: 100, text: 'go on then' },
];
function labelForPercent(p) {
    let l = LOADING_LABELS[0];
    for (const entry of LOADING_LABELS) { if (p >= entry.at) l = entry; else break; }
    return l.text;
}

// Periodic chromatic-split glitch flicker on the loading title, same
// mechanism/timing family as the title screen's own #title-glitch-fx —
// keeps the loading screen from reading as a generic clean progress bar.
let loadingGlitchTimer = null;
function startLoadingGlitch() {
    const titleEl = document.getElementById('loading-screen-title');
    if (!titleEl) return;
    stopLoadingGlitch();
    const tick = () => {
        titleEl.classList.add('flicker');
        setTimeout(() => titleEl.classList.remove('flicker'), 120 + Math.random() * 100);
        loadingGlitchTimer = setTimeout(tick, 1800 + Math.random() * 2200);
    };
    loadingGlitchTimer = setTimeout(tick, 900);
}
function stopLoadingGlitch() {
    if (loadingGlitchTimer) { clearTimeout(loadingGlitchTimer); loadingGlitchTimer = null; }
    const titleEl = document.getElementById('loading-screen-title');
    if (titleEl) titleEl.classList.remove('flicker');
}

function setLoadingProgress(fraction, label) {
    // Inline DOM writes now — no iframe, no postMessage contract to keep
    // in sync across two documents. See index.html's .loading-screen CSS
    // comment for why the iframe version was replaced.
    const fill = document.getElementById('loading-screen-fill');
    const pct = document.getElementById('loading-screen-pct');
    const labelEl = document.getElementById('loading-screen-label');
    const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    if (fill) fill.style.width = percent + '%';
    if (pct) pct.textContent = String(percent).padStart(2, '0') + '%';
    // label param from call sites is now just a threshold nudge, not the
    // literal displayed text — the atmospheric line is picked from
    // LOADING_LABELS by percent so it stays in the game's voice
    // regardless of which internal init() step happens to be running.
    if (labelEl) labelEl.textContent = labelForPercent(percent);
}

async function afterStep() {
    // Yields a frame so the loading screen can actually paint between
    // heavy synchronous steps below — same pattern the old project used.
    await new Promise((resolve) => requestAnimationFrame(resolve));
}

function setupRenderer() {
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x87CEEB);
    // Was 0x87CEEB (sky blue) — same as scene.background, and never
    // touched again by day-night-cycle.js or anything else, so it was a
    // flat pale-blue haze blending into every distant surface regardless
    // of lighting or time of day. Ground/grass seen through it (especially
    // up close between grass blades, low camera angle) read as washed-out
    // pale green-gray instead of the actual dark soil color underneath.
    // Darker, desaturated tone matches this game's dark-forest atmosphere
    // instead of a bright daytime sky tint.
    state.scene.fog = new THREE.FogExp2(0x1c1f1a, 0.0025);

    const settings = getSettings();
    state.camera = new THREE.PerspectiveCamera(settings.fov || 75, window.innerWidth / window.innerHeight, 0.1, 20000);
    state.camera.position.set(0, 5, 20);

    state.renderer = new THREE.WebGLRenderer({ antialias: settings.antialiasing !== false, powerPreference: 'high-performance' });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    // resolutionScale (default 1.0) multiplies devicePixelRatio — a cheap,
    // high-impact lever for weak iGPUs: dropping to e.g. 0.75 cuts fragment
    // shader work ~44% (0.75^2) with a much smaller visual cost than
    // lowering instance counts further. Reload-tier like quality's counts,
    // not live, since changing a renderer's pixel ratio after creation on
    // some browsers doesn't reliably resize internal buffers.
    const resolutionScale = settings.resolutionScale || 1.0;
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * resolutionScale);
    state.renderer.shadowMap.enabled = false; // was true (PCFSoftShadowMap,
    // two 2048x2048 maps from sunLight+moonLight) — this was flagged as
    // the single biggest perf cost multiple times while it was being
    // added; cutting it now that lag is the actual blocking complaint.
    // Lighting itself (sunLight/moonLight/hemiLight direct illumination)
    // is untouched — this only removes cast/received shadow detail.
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 0.8;
    state.renderer.outputColorSpace = THREE.SRGBColorSpace;

    document.getElementById('canvas-container').appendChild(state.renderer.domElement);

    window.addEventListener('resize', () => {
        state.camera.aspect = window.innerWidth / window.innerHeight;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    state.clock = new THREE.Clock();
}

// --- Minimal pointer-lock player controller ---
// Not a port of anything — core/player-controller.js from the old project
// wasn't ported this session (you didn't ask for it), so this is a
// deliberately small WASD + mouselook controller just so the game is
// actually playable while everything else gets wired up. Ground-follows
// via getElevation() each frame; no jumping/swimming/collision beyond
// that — flag this as a placeholder to replace, not a finished system.
// Stashes its per-frame update function onto state._updatePlayer so the
// top-level animate() loop (which doesn't have this closure in scope) can
// call it every frame.
// --- Collision (PLAN.md: "No collision beyond state.colliders being
// populated — nothing currently reads it") ---
// Simple circle-vs-circle push-out against every {x, z, r} entry in
// state.colliders (trees: forest.js/pine-trees.js, rocks: rocks.js — see
// each file's own push site). XZ-only, ignores Y entirely, matching the
// colliders' own shape (they're placed at ground level with no height
// data) — fine for trunks/boulders since the player can't currently
// jump onto or over anything anyway (no jump state yet, PLAN.md's other
// open item). Runs every colliding pair, not just the nearest one, so
// standing in the gap between two trees resolves against both instead of
// tunneling through the second after being pushed off the first.
const PLAYER_RADIUS = 0.4;

function resolveColliderPush(state) {
    const colliders = state.colliders;
    if (!colliders || colliders.length === 0) return;
    const p = state.player.position;
    for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const dx = p.x - c.x, dz = p.z - c.z;
        const minDist = PLAYER_RADIUS + c.r;
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDist * minDist || distSq < 1e-8) continue;
        const dist = Math.sqrt(distSq);
        const push = (minDist - dist) / dist;
        p.x += dx * push;
        p.z += dz * push;
    }
}

function setupPlayerController() {
    // Exposed on state (not just a closure var) so core/touch-controls.js's
    // joystick can toggle the exact same booleans the keydown/keyup
    // listeners below set — one movement path, two input methods, per
    // PLAN.md's mobile scope note.
    const move = { forward: false, back: false, left: false, right: false, run: false, jumpPressed: false, jumpHeld: false, restHeld: false };
    state.move = move;
    let yaw = 0, pitch = 0;
    const PLAYER_SPEED = 8;
    const RUN_MULT = 1.9;

    // Same reasoning as `move` above: shared with touch-controls.js's
    // look-drag zone so sensitivity/invert-Y (core/settings.js) apply
    // identically on mouse and touch instead of two separate math paths
    // drifting out of sync over time.
    function applyLook(movementX, movementY) {
        const sens = (state.settings.mouseSensitivity || 1) * 0.0022;
        yaw -= movementX * sens;
        pitch -= movementY * sens * (state.settings.invertY ? -1 : 1);
        pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    }
    state._applyLook = applyLook;

    document.addEventListener('keydown', (e) => {
        if (state.isPaused) return;
        const kb = getKeybinds();
        if (e.code === kb.moveForward) move.forward = true;
        if (e.code === kb.moveBack) move.back = true;
        if (e.code === kb.moveLeft) move.left = true;
        if (e.code === kb.moveRight) move.right = true;
        if (e.code === kb.run) move.run = true;
        if (e.code === kb.jump) { move.jumpPressed = true; move.jumpHeld = true; }
        if (e.code === kb.rest) move.restHeld = true;
    });
    document.addEventListener('keyup', (e) => {
        const kb = getKeybinds();
        if (e.code === kb.moveForward) move.forward = false;
        if (e.code === kb.moveBack) move.back = false;
        if (e.code === kb.moveLeft) move.left = false;
        if (e.code === kb.moveRight) move.right = false;
        if (e.code === kb.run) move.run = false;
        if (e.code === kb.jump) move.jumpHeld = false;
        if (e.code === kb.rest) move.restHeld = false;
        if (e.code === kb.interact && !state.isPaused) attemptRecruitInteraction(state);
        if (e.code === kb.fastForward && !state.isPaused) toggleTimeFastForward(state);
    });

    state.renderer.domElement.addEventListener('click', () => {
        if (state.isPaused) return; // don't re-lock the pointer by clicking through the pause panel
        if (state.touchControlsActive) return; // touch devices drive look via the drag zone, not pointer lock — most mobile browsers handle it poorly/not at all anyway
        if (getViewMode() === 'topdown') return; // fixed isometric angle — no mouselook to lock the pointer for
        state.renderer.domElement.requestPointerLock();
        ensureAudioContext(state); // first real user gesture in the game — browsers refuse to start an AudioContext before one, see core/audio.js
    });

    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== state.renderer.domElement) return;
        applyLook(e.movementX, e.movementY);
    });

    state.player.position.x = 0;
    state.player.position.z = 20;
    state.player.position.y = getElevation(0, 20, state) + state.player.height;
    state.player.velocityY = 0;
    state.player.grounded = true;
    state.player.swimming = false;

    // Top-down mode needs something to actually look down AT — this
    // project is first-person only otherwise, no player avatar exists at
    // all. Simple placeholder capsule, not a real character model (out of
    // scope) — see getViewMode()'s own comment on what this mode does and
    // doesn't include (fixed isometric camera + a visible body; no click-
    // to-move pathfinding, no detailed model).
    const isTopDown = getViewMode() === 'topdown';
    if (isTopDown) {
        const avatarGeo = new THREE.CapsuleGeometry(0.35, state.player.height - 0.7, 4, 8);
        const avatarMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.8 });
        state.playerAvatar = new THREE.Mesh(avatarGeo, avatarMat);
        state.playerAvatar.castShadow = false; // shadows are off project-wide (main.js's setupRenderer) — flatShading/no-shadow keeps this consistent rather than half-implementing shadow casting for one mesh
        state.scene.add(state.playerAvatar);
    }

    const GRAVITY = 22;
    const JUMP_SPEED = 8.5;
    const SWIM_SPEED_MULT = 0.55; // slower than walking — water resistance
    const SWIM_FLOAT_SPEED = 4; // vertical rise/sink rate while swimming

    state._updatePlayer = function updatePlayer(delta) {
        if (state.isPaused) return; // freeze movement entirely rather than just ignoring new key events —
        // keys already held down when Escape was pressed would otherwise keep the player sliding under the pause panel
        if (state.isResting) return; // same freeze during the sleep/time-skip transition — see core/rest.js
        const jumpRequested = move.jumpPressed;
        move.jumpPressed = false; // consume every frame regardless of outcome — see keydown handler's comment on why this doesn't need a keyup reset too

        // Computed against the PRE-move position, purely to decide this
        // frame's speed multiplier — re-derived against the POST-move
        // position below for the actual vertical resolution (matches the
        // original single-groundY structure, just needs an earlier read
        // too since swim speed has to apply to the horizontal move itself).
        const groundYBefore = getElevation(state.player.position.x, state.player.position.z, state) + state.player.height;
        // "Swimming" = standing over terrain whose surface sits below the
        // waterline (a lake/ocean floor), not just being near WATER_LEVEL
        // in general — matches how bushes.js/flowers.js/puddles.js already
        // gate their own placement off real ground elevation vs WATER_LEVEL.
        const overWater = groundYBefore < WATER_LEVEL + state.player.height;
        state.player.swimming = overWater;

        const speedMult = (move.run ? RUN_MULT : 1) * (overWater ? SWIM_SPEED_MULT : 1);
        const speed = PLAYER_SPEED * speedMult * delta;
        // FIXED: at yaw=0 a Three.js camera looks down -Z by default. The
        // previous forward=(sin(yaw),cos(yaw)) evaluated to (0,0,1) at
        // yaw=0 — that's +Z, the OPPOSITE of the camera's actual look
        // direction — so W was pushing the player backward relative to
        // view and S forward. Correct forward/right for a -Z-facing
        // camera: forward=(-sin(yaw),-cos(yaw)), right=(cos(yaw),-sin(yaw)).
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

        const dir = new THREE.Vector3();
        if (move.forward) dir.add(forward);
        if (move.back) dir.sub(forward);
        if (move.right) dir.add(right);
        if (move.left) dir.sub(right);
        if (dir.lengthSq() > 0) {
            dir.normalize().multiplyScalar(speed);
            state.player.position.x += dir.x;
            state.player.position.z += dir.z;
            resolveColliderPush(state);
        }
        state.player.isRunning = move.run && dir.lengthSq() > 0;

        const groundY = getElevation(state.player.position.x, state.player.position.z, state) + state.player.height;

        if (overWater) {
            // Float at the water surface instead of sinking to the
            // underwater terrain floor. Space rises, nothing held sinks
            // slowly back toward the surface (never below groundY, so you
            // can still walk out the shallow end onto real ground).
            const waterSurfaceY = WATER_LEVEL + state.player.height;
            const targetY = jumpRequested || move.jumpHeld
                ? state.player.position.y + SWIM_FLOAT_SPEED * delta
                : waterSurfaceY;
            state.player.position.y = THREE.MathUtils.clamp(
                state.player.position.y + (targetY - state.player.position.y) * Math.min(1, delta * 4),
                groundY, waterSurfaceY + 1.5
            );
            state.player.velocityY = 0;
            state.player.grounded = false;
        } else if (state.player.grounded && !jumpRequested) {
            // Normal ground-follow — smoothed, not snapped, so slopes don't feel jittery.
            state.player.position.y += (groundY - state.player.position.y) * Math.min(1, delta * 10);
        } else {
            // Airborne: real ballistic motion (jump arc or falling off a ledge).
            if (jumpRequested && state.player.grounded) {
                state.player.velocityY = JUMP_SPEED;
                state.player.grounded = false;
            }
            state.player.velocityY -= GRAVITY * delta;
            state.player.position.y += state.player.velocityY * delta;
            if (state.player.position.y <= groundY) {
                state.player.position.y = groundY;
                state.player.velocityY = 0;
                state.player.grounded = true;
            }
        }

        if (isTopDown && state.playerAvatar) {
            // Fixed isometric offset — Disco Elysium's signature high,
            // steep-angle follow camera, not mouselook. Distance/height
            // tuned for a wide-ish view without feeling like a minimap.
            const ISO_DIST = 9, ISO_HEIGHT = 12;
            state.camera.position.set(
                state.player.position.x,
                state.player.position.y + ISO_HEIGHT,
                state.player.position.z + ISO_DIST
            );
            state.camera.lookAt(state.player.position.x, state.player.position.y, state.player.position.z);

            state.playerAvatar.position.set(state.player.position.x, state.player.position.y - state.player.height / 2 + 0.35, state.player.position.z);
            if (dir.lengthSq() > 0) {
                // Face the actual movement direction, not the (unused,
                // always-zero in this mode) mouselook yaw.
                state.playerAvatar.rotation.y = Math.atan2(dir.x, dir.z);
            }
        } else {
            state.camera.position.set(state.player.position.x, state.player.position.y, state.player.position.z);
            state.camera.rotation.set(pitch, yaw, 0, 'YXZ');
        }
    };
}
async function init() {
    setLoadingProgress(0.02, 'Setting up renderer');
    setupRenderer();
    await afterStep();

    // Must happen before any generator below — createGrass/generateFractalForest/
    // createRocks/createBushes/createFlowers/createFireflies/createDustParticles/
    // createPuddles all read state.quality's per-system count fields (falling
    // back to their own hardcoded default if it's missing). This was the
    // missing link: quality.js's presets already had real count fields and
    // every generator already knew how to read them, but nothing ever set
    // state.quality itself, so "Low (potato mode)" only ever changed draw
    // distance/fog — not actual instance counts.
    state.quality = getQualityCounts();

    setLoadingProgress(0.08, 'Growing terrain');
    createTerrain(state);
    await afterStep();

    setLoadingProgress(0.18, 'Filling the sky');
    createDayNightCycle(state);
    await afterStep();

    setLoadingProgress(0.28, 'Pouring the lake');
    createWater(state);
    await afterStep();

    setLoadingProgress(0.4, 'Growing the forest');
    // Detailed pine trees (environment/pine-trees.js) restored — their
    // needle-density bug is fixed now (see that file's collectNeedleMatrices
    // comment): was ~523,000 needle instances per tree (~8.3 million across
    // all 16) from a 7x-redundant per-segment calculation, now ~14,000 per
    // tree (~230,000 total), same visual density/whorl coverage.
    await generateFractalForest(state, (f) => setLoadingProgress(0.4 + f * 0.15, 'Growing the forest'));
    createDetailedPineTrees(state, 16);
    await afterStep();

    setLoadingProgress(0.55, 'Growing ferns');
    await createFerns(state, (f) => setLoadingProgress(0.55 + f * 0.15, 'Growing ferns'));

    setLoadingProgress(0.68, 'Planting bushes');
    // After forest.js/pine-trees.js so state.colliders is already
    // populated — bushes.js's pass 2 seeds undergrowth clumps around
    // those existing tree positions.
    createBushes(state);
    await afterStep();

    setLoadingProgress(0.72, 'Scattering rocks');
    createRocks(state);
    await afterStep();

    setLoadingProgress(0.82, 'Growing grass');
    createGrass(state);
    await afterStep();

    setLoadingProgress(0.85, 'Blooming flowers');
    createFlowers(state);
    await afterStep();

    setLoadingProgress(0.88, 'Loading rain');
    createRainSystem(state);
    createRainSplashes(state);
    createWeather(state); // drives state.currentRainIntensity over time — see atmosphere/weather.js; was hardcoded to 0 forever before this
    await afterStep();

    setLoadingProgress(0.90, 'Filling puddles');
    createPuddles(state);
    await afterStep();

    setLoadingProgress(0.93, 'Raising the tower');
    createRadioTower(state, new THREE.Vector3(120, 0, -140));
    await afterStep();

    setLoadingProgress(0.95, 'Lighting fireflies');
    createFireflies(state);
    createDustParticles(state);
    await afterStep();

    setLoadingProgress(0.97, 'Waking the animals');
    spawnDemoAnimals(state);
    await afterStep();

    setupPlayerController();
    setupTouchControls(state, { attemptRecruitInteraction });

    setLoadingProgress(1.0, 'Ready');
    startEngine();
}

function startEngine() {
    const loadingScreen = document.getElementById('loading-screen');
    const uiLayer = document.getElementById('ui-layer'); // wraps #pixel-sky canvas +
    // .title-vignette/.title-scrim + title-content — all sit above
    // #canvas-container (z-index 10 vs 1). Hiding only title-panel-backdrop/
    // title-menu (as this used to do) left the vignette/scrim gradients and
    // the pixel-sky canvas covering the real game canvas the whole time —
    // that's what was actually showing as "black screen", not a render
    // failure underneath.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (loadingScreen) loadingScreen.classList.add('hidden');
        if (uiLayer) uiLayer.classList.add('hidden');
        stopLoadingGlitch();

        state.clock.start();
        animate();
    }));
}

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(0.1, state.clock.getDelta()); // clamp so a tab-switch stall doesn't teleport anything
    const ts = state.clock.elapsedTime;

    if (state._updatePlayer) state._updatePlayer(delta);
    updateRestHold(state, state.move.restHeld || state.touchRestHeld);

    updateDayNightCycle(state, delta);
    updateStars(state, delta);
    updateWeather(state, delta); // must run before updateRain/updatePuddles/updateFireflies/updateDustParticles — they all read state.currentRainIntensity this same frame
    updateWater(state, ts);
    updateGrass(state, ts);
    updateFoliage(state, ts);
    updateBushes(state, ts);
    updateRocks(state);
    updateRain(state, ts);
    updateFlowers(state, ts);
    updatePuddles(state, ts);
    updateFireflies(state, ts);
    updateDustParticles(state, ts);
    updateRadioTower(state, ts);
    updateDemoAnimals(state, delta);
    updateRadioTowerProximity(state);
    updateInteractPrompt(state);
    updateForestLOD(state, ts); // camera position + leaf-flutter wind uTime feed for forest.js's shaders — see forest.js's export comment
    updateFpsCounter(state);

    state.renderer.render(state.scene, state.camera);
}

let _fpsFrames = 0;
let _fpsLastSample = 0;
function updateFpsCounter(state) {
    const el = state._fpsCounterEl || (state._fpsCounterEl = document.getElementById('fps-counter'));
    if (!el) return;
    const show = !!getSettings().showFpsCounter;
    el.classList.toggle('hidden', !show);
    if (!show) return;
    _fpsFrames++;
    const now = performance.now();
    if (now - _fpsLastSample >= 500) { // update twice a second — a counter that changes every frame is unreadable
        const fps = Math.round((_fpsFrames * 1000) / (now - _fpsLastSample));
        el.textContent = fps + ' FPS';
        _fpsFrames = 0;
        _fpsLastSample = now;
    }
}

// --- Title screen hookup ---
const rememberBtn = document.getElementById('title-remember-btn');
if (rememberBtn) {
    rememberBtn.addEventListener('click', () => {
        markGameStarted(); // so a later visit's title screen shows "Regain" honestly — this is the real first entry, not a decorative flag
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            // Force-skip the 0.5s opacity fade-in for THIS reveal — the CSS
            // transition means classList.remove('hidden') doesn't snap
            // visible, it fades in over 500ms, which used to freeze
            // near-invisible for the whole load once init()'s heavy
            // synchronous work locked the main thread a frame or two later.
            // Disabling the transition for one reflow forces it straight to
            // opacity:1 immediately; re-enabling it right after (via rAF)
            // preserves the fade for the fade-OUT startEngine() does at the
            // end of loading.
            loadingScreen.style.transition = 'none';
            loadingScreen.classList.remove('hidden');
            void loadingScreen.offsetHeight; // force a synchronous reflow so opacity:1 actually applies before...
            requestAnimationFrame(() => { loadingScreen.style.transition = ''; }); // ...this restores the transition for later toggles
        }
        startLoadingGlitch();
        setLoadingProgress(0, '');
        // Single rAF hop before the heavy synchronous init() work — enough
        // now that the loading screen is inline markup in this same
        // document (no iframe navigation or nested document to wait on),
        // just needs one paint to actually show before the freeze.
        requestAnimationFrame(() => {
            init();
        });
    });
} else {
    // No title screen button found (e.g. testing index.html standalone) —
    // start immediately rather than leaving the game unreachable.
    init();
}

// "Regain (Continue)" — only shown by core/input.js once
// save-system.js's hasStartedGame() is true. This rebuild has no real
// progression state to resume (see save-system.js's own comment: only
// settings persist today), so Regain currently just re-enters the world
// the same way Remember does, rather than pretending to restore a game
// state that doesn't exist yet.
const regainBtn = document.getElementById('title-regain-btn');
if (regainBtn && rememberBtn) {
    regainBtn.addEventListener('click', () => rememberBtn.click());
}
