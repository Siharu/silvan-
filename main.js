// init() + the animate() render loop. This is the only place that sequences
// module calls — order matters because of the getElevation() dependency
// chain (see MODULARIZATION_PLAN.md): createSky -> createTerrain ->
// createLake -> createGrass -> createFlowers -> createRocks ->
// createPuddles -> generateFractalForest -> createFerns -> createMossClusters ->
// createRainSystem -> createRainSplashes -> createFireflies -> createDustParticles.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createGodRaysPass } from './fx/god-rays.js';

import { createWorldState } from './core/world-state.js';
import { resolveQualityPreset, QUALITY_PRESETS } from './core/quality.js';
import { getModifiers } from './core/modifiers.js';
import { getSettings } from './core/settings.js';
import { getViewMode } from './core/view-mode.js';
import { writeLocalSave, AUTOSAVE_INTERVAL_MS } from './core/save-system.js';
import { setupInput, onWindowResize } from './core/input.js';
import { updatePlayer } from './core/player-controller.js';

import { getElevation } from './environment/terrain.js';
import { createTerrain } from './environment/terrain.js';
import { createSky } from './environment/sky.js';
import { createLake } from './environment/lake.js';
import { createOcean } from './environment/ocean.js';
// createMountainBoundary import removed — see the removed call in the
// init sequence below for why (island now visually fades into open ocean
// at the edge instead of a painted mountain ring).
import { createDistantIslands } from './environment/distant-islands.js';
import { createGrass } from './environment/grass.js';
import { createFlowers } from './environment/flowers.js';
import { createRocks } from './environment/rocks.js';
import { createFerns, createMossClusters } from './environment/foliage.js';
import { createPuddles } from './environment/puddles.js';
import { generateFractalForest } from './environment/forest.js';
import { createDetailedPineTrees } from './environment/pine-trees.js';

import { createRainSystem, createRainSplashes } from './fx/rain.js';
import { createFireflies } from './fx/fireflies.js';
import { createDustParticles } from './fx/dust.js';
import { createProceduralTextures } from './fx/textures.js';
import { createWindLeaves } from './fx/wind-leaves.js';
import { spawnDemoAnimals, updateDemoAnimals, updateInteractPrompt, findDryAnchor, buildAnimalRig, ANIMAL_CONFIGS } from './environment/animals.js';
import { createRadioTower } from './environment/radio-tower.js';

import { createAmbientAudio } from './audio/ambience.js';
import { updateAtmosphere } from './atmosphere/day-night-cycle.js';
import { createBackgroundRenderTarget, resizeBackgroundRenderTarget, renderBackgroundPass } from './fx/dynamic-fog.js';

const state = createWorldState();
state.viewMode = getViewMode(); // 'firstperson' | 'topdown' — see core/view-mode.js
state.quality = resolveQualityPreset();
state.settings = getSettings(); // Camera/Graphics/Audio live settings — core/settings.js
state.baseFogDensity = 0.0052; // main.js's own historical default, kept as a named constant so settings.js's fogDensityMult has a fixed base to multiply rather than compounding against whatever scene.fog.density last was
if (state.viewMode === 'topdown') {
    // Top-down mode still forces the cheap instance-count tier regardless
    // of whatever the player separately chose in the Graphics toggle — the
    // heavy cost here (grass/tree/rock counts) doesn't get cheaper just
    // because the camera's further away. Uses its own 'topdown' preset now
    // rather than reusing 'low' outright — 'low' also killed bloom and cut
    // fireflies/dust to the floor, for no real perf reason, which is a big
    // part of why top-down felt dark and lost its ambient atmosphere. See
    // core/quality.js.
    state.quality = QUALITY_PRESETS.topdown;
}
state.modifiers = getModifiers(); // rock/water tuning — see core/modifiers.js

// Title screen is interactive immediately on page load now — nothing
// heavy runs until the player actually clicks Remember/Regain. input.js
// calls this (via state.startEngine) from those two click handlers; it
// shows the loading-screen.html moon-run iframe, then defers the actual
// synchronous scene build (init(), below) a couple of frames so that
// iframe gets a real paint first instead of racing init()'s freeze.
// afterReady runs once init() has finished (engine/scene/player all
// exist), so the caller can safely apply a save and/or enter play mode.
state.engineReady = false;
let engineStarting = false;
let readyCallbacks = [];
state.startEngine = function startEngine(afterReady) {
    if (afterReady) readyCallbacks.push(afterReady);
    if (engineStarting || state.engineReady) return;
    engineStarting = true;
    const loadingScreen = document.getElementById('loading-screen');
    const loadingFrame = document.getElementById('loading-screen-frame');

    function runInit() {
        // Two more rAF hops here (on top of however long the iframe took
        // to load) so its first couple of real frames — stars, moon,
        // progress bar — actually get composited to screen before init()'s
        // synchronous terrain/forest/grass/rocks work freezes the tab.
        // Without this, the freeze can land on the iframe's very first
        // paint before its own script has drawn anything, which reads as
        // the screen just going dark instead of showing a loading screen.
        requestAnimationFrame(() => requestAnimationFrame(async () => {
            await init();
            state.engineReady = true;
            // Explicit 100% ping rather than relying on the last afterStep()
            // call alone — belt-and-suspenders in case a future step gets
            // added/removed and INIT_STEP_COUNT drifts out of sync, so the
            // bar can never get stuck short of full right as the overlay
            // that shows it disappears.
            initStepsDone = INIT_STEP_COUNT;
            reportLoadProgress();
            if (loadingScreen) loadingScreen.classList.add('hidden');
            // Freed once it's hidden rather than kept running behind the
            // title/HUD — it's got its own live Three.js render loop and
            // minigame input listeners that have no reason to keep ticking
            // once the real game has taken over the frame.
            if (loadingFrame) loadingFrame.src = '';
            const callbacks = readyCallbacks; readyCallbacks = [];
            callbacks.forEach(cb => cb());
        }));
    }

    if (loadingScreen) loadingScreen.classList.remove('hidden');
    if (loadingFrame) {
        // Safety net: if loading-screen.html's own CDN fetch (Three.js
        // from jsdelivr) is slow, blocked, or offline, 'load' may never
        // fire — don't leave the player staring at a permanently dark
        // screen waiting for it. Whichever happens first wins; the other
        // is a no-op since runInit only ever actually starts init() once
        // (guarded by engineStarting/state.engineReady above it, and this
        // local guard for the timeout/load race specifically).
        let started = false;
        const start = () => { if (started) return; started = true; runInit(); };
        loadingFrame.addEventListener('load', start, { once: true });
        setTimeout(start, 2500);
        loadingFrame.src = 'loading-screen.html';
    } else {
        runInit();
    }
};

// Wired immediately (not from inside init()) so every title-screen control
// — Remember, Regain, Settings, Credits, the volume slider — responds the
// instant the page loads, instead of sitting dead until init()'s terrain/
// forest/grass/rocks generation happens to finish.
setupInput(state);

function nextFrame() {
    // Lets the browser actually paint a frame — and, crucially, lets the
    // loading-screen.html iframe's own render loop tick and animate —
    // between each heavy synchronous scene-build step below. Without this,
    // init() was one unbroken block of work; the tab (and the iframe
    // riding on the same thread) couldn't paint anything in between, so
    // the "animated" loading screen only ever showed its very first,
    // mostly-static frame for the entire load.
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

// init() is chunked into these steps (each followed by nextFrame()) purely
// so loading-screen.html's progress bar can track real work instead of
// running its own disconnected timer (that was the "loading screen isn't
// in sync" bug: the bar used to climb to 100%/READY on a fixed clock with
// no idea whether init() had actually finished). reportLoadProgress posts
// the fraction of these steps completed so far into the iframe; it's a
// no-op if the frame hasn't loaded or the postMessage listener isn't up
// yet, which is fine — the next call catches it up to the current real
// percentage instead of trying to replay missed increments.
const INIT_STEP_COUNT = 13; // bumped 12->13 for the compileAsync() step added at the end of init(), below
let initStepsDone = 0;
// fraction (0..1): how far through the *current* step we are. Only the two
// steps that chunk themselves (createGrass, generateFractalForest — see
// below) ever pass this; everything else reports whole steps.
function reportLoadProgress(fraction = 0) {
    const loadingFrame = document.getElementById('loading-screen-frame');
    if (!loadingFrame || !loadingFrame.contentWindow) return;
    const percent = Math.min(100, Math.round(((initStepsDone + fraction) / INIT_STEP_COUNT) * 100));
    try {
        loadingFrame.contentWindow.postMessage({ type: 'silvan-loading-progress', percent }, '*');
    } catch (e) { /* iframe not ready / navigated away — safe to ignore */ }
}
async function afterStep() {
    initStepsDone++;
    reportLoadProgress();
    await nextFrame();
}

async function init() {
    state.scene = new THREE.Scene();
    // Density nudged down (0.007 -> 0.0052) — stacked with the near-black
    // old terrain color and the 0.85 exposure, distance was going murky
    // fast; the color-melt into the real sky/backdrop (fx/dynamic-fog.js)
    // still does the actual "hide the edge of the world" job, so this only
    // needed to be thick enough to soften pop-in, not to actively darken
    // mid-distance terrain.
    state.scene.fog = new THREE.FogExp2(0x111625, state.baseFogDensity * state.settings.fogDensityMult);

    state.globalTextures = createProceduralTextures();

    // Top-down mode uses a narrower FOV than first-person (still a
    // perspective camera at a steep angle, not a true orthographic one —
    // see core/player-controller.js's TOPDOWN_* constants for why). Bumped
    // 50 -> 62 alongside player-controller.js's TOPDOWN_HEIGHT/
    // TOPDOWN_BACK_OFFSET increase — the old 34-unit-high rig only ever
    // framed a small patch of ground around Kat, reading as a close
    // chase-cam rather than an actual overhead map view. Kept short of
    // first-person's 75 so it still doesn't fisheye at the steeper
    // downward pitch.
    state.camera = new THREE.PerspectiveCamera(state.viewMode === 'topdown' ? 62 : 75, window.innerWidth / window.innerHeight, 0.1, 1500);
    if (state.viewMode !== 'topdown') { state.camera.fov = state.settings.fov; state.camera.updateProjectionMatrix(); } // user FOV setting — topdown keeps its own fixed framing, see comment above

    state.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
    // three.js r155+ defaults useLegacyLights to false (physically-correct
    // light units), which reads roughly 3x dimmer than the same intensity
    // number under the old default. Every light value in this file
    // (sunLight/hemiLight/moonLight below, tuned via the exposure/peak
    // comments throughout) was authored against the old legacy model, so
    // without this the sky dome (a self-lit shader material, untouched by
    // scene lighting) looks normal while every MeshStandardMaterial surface
    // — terrain, forest, rocks, grass — reads as near-black.
    state.renderer.useLegacyLights = true;
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.quality.pixelRatioCap));
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Was 1.08 with sunLight peaking at 1.5 + hemi at 1.15 constant — the two
    // stacked pushed midday well past ACES's shoulder into a blown-white sky
    // (see day screenshot). Dropped exposure and the sun/hemi peaks below
    // instead of just crushing exposure alone, which would've flattened
    // contrast everywhere including night. Nudged back up from 0.85 — that
    // fix overcorrected and left the whole world reading dim/muddy even at
    // midday; 0.95 keeps the sun/hemi peaks (still trimmed below, see
    // day-night-cycle.js) from re-clipping while giving midday its
    // brightness back.
    // Nudged again (0.95->1.15) alongside the sun/hemi peak bump above —
    // still well under ACES's clip point, this is what actually lets the
    // higher light values above translate into visibly brighter midday
    // instead of tone-mapping most of the increase back away.
    state.renderer.toneMappingExposure = 1.15;
    document.getElementById('canvas-container').appendChild(state.renderer.domElement);

    // Offscreen target the sky/mountain backdrop renders into each frame —
    // see fx/dynamic-fog.js. Created before any of the create*() calls
    // below so terrain/forest/pines/rocks/grass can wire their materials to
    // state.backgroundRenderTarget.texture as they're built.
    state.backgroundRenderTarget = createBackgroundRenderTarget();

    const renderScene = new RenderPass(state.scene, state.camera);
    state.composer = new EffectComposer(state.renderer);
    state.composer.addPass(renderScene);
    if (state.quality.bloomEnabled) {
        // Optimized: Half-resolution bloom pass for better performance
        // threshold was 0.3 — since sky.js's cloud/horizon color is pure
        // white (0xffffff, already max luminance), almost the entire sky
        // cleared that bar and bloomed, washing the whole frame out to
        // white instead of just glowing the sun disc/water glints like
        // intended. Raised so only genuinely bright highlights bloom.
        state.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 1.0, 0.5, 0.8);
        state.bloomPass.threshold = 0.88;
        state.bloomPass.strength = 0.4;
        state.bloomPass.radius = 0.4;
        state.composer.addPass(state.bloomPass);
    }

    // Screen-space volumetric god rays (fx/god-rays.js) — replaces the old
    // sprite-based ray texture. Added after bloom so the rays themselves
    // can still catch a touch of bloom glow at their brightest, same as
    // everything else in frame. state.sunGlowFactor/state.sunSprite are fed
    // into it every frame from animate() below, driven by
    // atmosphere/day-night-cycle.js's actual sun math.
    state.godRaysPass = createGodRaysPass(state.renderer, state.scene, state.camera);
    state.composer.addPass(state.godRaysPass);

    // Ambient fill light — intensity now modulated per-frame in
    // atmosphere/day-night-cycle.js (day/night instead of a flat 1.15) so
    // it can add a proper night floor without also blowing out midday.
    state.hemiLight = new THREE.HemisphereLight(0x94a3c2, 0x223318, 1.15);
    state.scene.add(state.hemiLight);

    state.sunLight = new THREE.DirectionalLight(0xffedc9, 1.25);
    state.sunLight.castShadow = true;
    // Optimized: Reduced shadow map resolution
    state.sunLight.shadow.mapSize.width = state.quality.shadowMapSize;
    state.sunLight.shadow.mapSize.height = state.quality.shadowMapSize;
    state.sunLight.shadow.camera.near = 10;
    state.sunLight.shadow.camera.far = 1000;
    const d = 620;
    state.sunLight.shadow.camera.left = -d;
    state.sunLight.shadow.camera.right = d;
    state.sunLight.shadow.camera.top = d;
    // Was `state.sunLight.shadow.bottom` — DirectionalLightShadow has no
    // `.bottom` property; that's on `.camera`. The typo silently created a
    // stray property and left shadow.camera.bottom at THREE's default (-5),
    // while left/right/top were correctly set to the full ±620 extent. That
    // lopsided orthographic shadow frustum (effectively 5 units tall on one
    // side vs. 1240 on the other/across) meant almost every fragment on the
    // ground sampled outside the light's actual shadow coverage and came
    // back reading as fully shadowed — this is why the sky (a self-lit
    // shader material, untouched by shadows) looked correctly bright while
    // terrain/grass/trees rendered near-black regardless of time of day.
    state.sunLight.shadow.camera.bottom = -d;
    state.sunLight.shadow.bias = -0.0001;
    state.scene.add(state.sunLight);

    state.moonLight = new THREE.DirectionalLight(0x7799ff, 0.3);
    state.scene.add(state.moonLight);

    reportLoadProgress(); // 0% — as soon as the scene/renderer above exist, before the first heavy step

    createSky(state);
    await afterStep();
    // Now chunked internally (see terrain.js) — was the single biggest
    // unbroken synchronous block in the whole load (~130k vertex elevation
    // lookups with zero yields inside the loop itself).
    await createTerrain(state, reportLoadProgress);
    await afterStep();
    // Each of these four was previously back-to-back with no yield between
    // them, only after the whole group — individually fast, but stacked
    // they could still add up to a noticeable stall before the next paint.
    createOcean(state);
    await nextFrame();
    createLake(state);
    await nextFrame();
    // createMountainBoundary(state) removed — painted mountain ring worked
    // against the "small island in a vast, empty ocean" feeling: it put a
    // visible wall of peaks close around the coastline instead of letting
    // the water actually read as endless. The ocean disc (environment/
    // ocean.js) already extends well past where the mountain ring used to
    // sit and dynamic-fogs into the real sky at the horizon (see its own
    // comment) — with the mountains gone, that horizon blend is now what
    // the player actually sees past the coastline, which is the "there's
    // more out there" read this was going for. environment/distant-islands.js
    // (specks of land far out on the water) is still in the init sequence
    // below and reinforces the same idea. mountain-boundary.js itself is
    // untouched, just no longer called, in case this ever needs revisiting.
    await nextFrame();
    createDistantIslands(state);
    await afterStep();
    // Grass is a single 1.1M-instance loop (see core/quality.js — "the
    // single heaviest thing in the scene") — left synchronous, this was one
    // multi-second unbroken block where nothing on the page, including the
    // loading screen itself, could paint a single frame. Now yields
    // periodically and reports sub-step progress instead of freezing then
    // jumping straight from this step's start % to its end %.
    await createGrass(state, reportLoadProgress);
    await afterStep();
    createFlowers(state);
    await nextFrame();
    createRocks(state);
    await afterStep();
    createPuddles(state);
    await afterStep();
    // Same story as grass: 780 trees, each a recursive fractal branch walk
    // (depth up to 5, 2-4 way splits per node) — chunked for the same
    // reason.
    await generateFractalForest(state, reportLoadProgress);
    await afterStep();
    createDetailedPineTrees(state, state.quality.pineTreeCount);
    await afterStep();
    createFerns(state);
    await nextFrame();
    createMossClusters(state);
    await afterStep();
    createRainSystem(state);
    await nextFrame();
    createRainSplashes(state);
    await afterStep();
    createFireflies(state);
    await nextFrame();
    createDustParticles(state);
    await afterStep();
    createWindLeaves(state);
    await nextFrame();
    spawnDemoAnimals(state);
    await nextFrame();
    // Heaviest of this trio (procedural lattice/strut geometry plus a
    // findTowerAnchor() search that samples getElevation() ~1,200 times) —
    // gets its own yield on both sides now instead of being sandwiched
    // between the other two with no breathing room.
    createRadioTower(state);
    await afterStep();

    // Was (0, getElevation(0,0)+height, 0) — origin is the lake basin
    // center (see environment/terrain.js), so the player spawned ~29
    // units underwater and only looked fine because player-controller.js
    // floats the camera to the water surface once isInWater kicks in on
    // frame 1. Spawning on the same dry anchor the animals use instead,
    // so you actually start standing on ground.
    const spawnAnchor = findDryAnchor();
    state.player.position.set(spawnAnchor.x, getElevation(spawnAnchor.x, spawnAnchor.z) + state.player.height, spawnAnchor.z);

    // Kat's own visible body — was entirely absent before (the "player" was
    // just a bare camera), most noticeable in top-down where there's
    // nothing on screen to say what you're actually controlling. Reuses
    // the exact rig animals.js already builds for the companions.
    // core/player-controller.js positions/rotates/animates it every frame.
    state.playerRig = buildAnimalRig('Kat', ANIMAL_CONFIGS.Kat);
    state.scene.add(state.playerRig.root);

    createAmbientAudio(state);

    window.addEventListener('resize', () => { onWindowResize(state); resizeBackgroundRenderTarget(state.backgroundRenderTarget); });

    // Last-chance save: if the tab is closing mid-play, this is the only
    // hook that reliably still gets to run. Not a substitute for the
    // periodic autosave in animate() below (beforeunload can be skipped
    // entirely by some mobile browsers on backgrounding), just a net under
    // the net.
    window.addEventListener('beforeunload', () => {
        if (state.isPlaying) writeLocalSave(state);
    });

    // Force every material's shader to compile now, while the loading
    // overlay is still covering the screen, instead of letting it happen
    // lazily on this scene's actual first render. WebGL shader compilation
    // is lazy per-material — with dozens of custom ShaderMaterials in this
    // scene (water, sky, clouds, grass wind, rock noise, god-rays, bloom),
    // they'd all compile at once on the very first real frame, which is a
    // well-documented multi-hundred-ms hitch. That hitch used to land
    // exactly when the loading screen faded away (see index.html's 0.5s
    // opacity transition), turning the reveal itself into the stutter.
    // Paying that cost here instead means it happens under the loading
    // screen where a brief pause is invisible, not during the reveal.
    await state.renderer.compileAsync(state.scene, state.camera);
    await afterStep();

    requestAnimationFrame(animate);
}

// Autosave HUD icon — flashes briefly exactly when writeLocalSave() below
// actually runs, not on a decorative independent timer, so it's an honest
// signal rather than UI theater (see core/save-system.js's header comment
// for the broader reasoning). Grabbed lazily/once rather than at module
// load, matching the getXEl() lazy-cache pattern already used in
// core/player-controller.js for #water-overlay/#boundary-message.
let _autosaveIconEl;
function flashAutosaveIcon() {
    if (_autosaveIconEl === undefined) _autosaveIconEl = document.getElementById('autosave-indicator');
    if (!_autosaveIconEl) return;
    _autosaveIconEl.classList.add('active');
    clearTimeout(_autosaveIconEl._hideTimer);
    _autosaveIconEl._hideTimer = setTimeout(() => _autosaveIconEl.classList.remove('active'), 1800);
}

function animate(time) {
    requestAnimationFrame(animate);
    const delta = Math.min(time - state.lastTime, 100); state.lastTime = time;
    updateAtmosphere(state, delta); updatePlayer(state, delta / 1000);
    updateDemoAnimals(state, delta / 1000);
    updateInteractPrompt(state); // after both updateAtmosphere (tower proximity) and updateDemoAnimals (animal proximity) have set their flags this frame

    // Periodic autosave while actually playing — skipped during the tower
    // cutscene so a save can't land mid-scripted-camera-move with
    // state.cutsceneActive stuck true if the page were closed right then.
    if (state.isPlaying && !state.cutsceneActive) {
        if (!state.lastAutosaveTime) state.lastAutosaveTime = time;
        if (time - state.lastAutosaveTime > AUTOSAVE_INTERVAL_MS) {
            state.lastAutosaveTime = time;
            if (writeLocalSave(state)) flashAutosaveIcon();
        }
    }

    renderBackgroundPass(state, state.backgroundRenderTarget); // capture sky/mountain backdrop before the main pass below so this frame's dynamic fog (fx/dynamic-fog.js) reads current colors, not last frame's
    // Feed the god-rays pass this frame's sun position/strength —
    // day-night-cycle.js computed sunSprite's position and sunGlowFactor
    // just above (via updateAtmosphere), the pass itself only owns the
    // screen-space occlusion/radial-blur side, not any day-night logic.
    if (state.godRaysPass && state.sunSprite) {
        state.godRaysPass.sunWorldPosition.copy(state.sunSprite.position);
        state.godRaysPass.intensity = state.sunGlowFactor || 0;
    }
    state.composer.render();
}