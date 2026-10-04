import '../src/tailwind.css';
import { Howl, Howler } from 'howler';
window.Howl = Howl; window.Howler = Howler; // audio.js/settings.js/blip.js/input.js use the globals
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { updatePines } from '../environment/pine-tree.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
// Reflector removed — real-time mirror reflections were the source of the star-blob
// and grazing-angle stripe artifacts. Water now fakes its reflectivity via fresnel
// + sky tint + a sun/moon glint in the shader below instead.

import { state } from './state.js';
import { createProceduralTextures, shouldShowTouchControls } from './utils.js';
import { initAudio, updateAudioListener } from './audio.js';
import { setupInput, onWindowResize, wireTitleScreen, wireTitleMenu, wirePauseMenu, enterGame, showGameplayUI } from './input.js';
import { initTouchControls } from './touch-controls.js';
import { startTutorial, updateTutorial } from './tutorial.js';
import { loadQuality, wireSettingsButtons, wireCameraAudioSettings, updateFpsCounter } from './settings.js';
import { updatePlayer } from './player-controller.js';
import { updateRest } from './rest.js';
import { bakeHeightmap, heightAt } from './heightmap.js';
import { bakeSplat } from './splat.js';
import { applyQuality, noteGrassBuilt, updateShadowFollow, updateAdaptiveRes } from './render-quality.js';
import { initDebug, debugFrame } from './debug.js';
import { updateAtmosphere } from '../atmosphere/day-night-cycle.js';

import { createSky } from '../environment/sky.js';
import { createTerrainChunks, updateTerrainChunks } from '../environment/terrain.js';
import { createPuddles } from '../environment/puddles.js';
import { createGrass, updateGrass } from '../environment/grass.js';
import { createGrassMidRing, updateGrassMidRing } from '../environment/grass-midring.js';
import { createLake, updateLake } from '../environment/lake.js';
import { createFlowers, updateFlowerLOD } from '../environment/flowers.js';
import { generateFractalForest } from '../environment/forest.js';
import { createRocks, updateRockLOD } from '../environment/rocks.js';
import { createGrandBlueTrees, createLeaningPalms, updateLeaningPalms, updateGrandBlueGlow, updateGrandBlueCanopy } from '../environment/landmark-trees.js';
import { createRainSystem, createRainSplashes } from '../fx/rain.js';
import { createFireflies } from '../fx/fireflies.js';
import { createDustParticles } from '../fx/dust.js';
import { POIS, createPOIs, updatePOIInteraction, updatePOIs } from '../environment/pois.js';

// Yields one real animation frame — used between init()'s heavy steps below
// so the loading-screen progress bar actually gets a chance to repaint
// between them, instead of the whole build running as one uninterrupted
// synchronous task with the DOM writes only flushing at the very end.
function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

function setLoadingProgress(pct, label) {
    lastProgressAt = performance.now();
    const fill = document.getElementById('loading-screen-fill');
    const pctEl = document.getElementById('loading-screen-pct');
    const labelEl = document.getElementById('loading-screen-label');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = String(Math.round(pct)).padStart(2, '0') + '%';
    if (labelEl && label) labelEl.textContent = label;
}

// B-19: was a 15 s cap on the WHOLE init() (incl. network fetch of the .glb) —
// a slow laptop or connection tripped it though nothing was broken. Now only
// fails if the loading bar makes NO progress for INIT_STALL_MS.
function wireContextLoss(canvas) {
    const note = document.createElement('div');
    note.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.85);color:#f0a545;font:1.1rem monospace;z-index:99998;text-align:center;padding:2rem';
    note.textContent = 'the light flickered out — recovering the world…';
    document.body.appendChild(note);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); state.contextLost = true; note.style.display = 'flex'; console.warn('[webgl] context lost'); });
    canvas.addEventListener('webglcontextrestored', () => { state.contextLost = false; note.style.display = 'none'; console.warn('[webgl] context restored'); });
}

const INIT_STALL_MS = 30000;
let lastProgressAt = performance.now();

// Puts the loading screen into a visible, explicit failure state instead
// of leaving the bar frozen with no signal anything's wrong (Phase 0 #3).
// Reload is the only recovery path here on purpose — init() isn't
// re-entrant (it mutates module-level `state` unconditionally), so a
// "retry" button would need init() split into a resettable form first.
function showLoadingError(message) {
    const bar = document.querySelector('.loading-screen-bar');
    const pctEl = document.getElementById('loading-screen-pct');
    const labelEl = document.getElementById('loading-screen-label');
    const errorBox = document.getElementById('loading-screen-error');
    const errorText = document.getElementById('loading-screen-error-text');
    if (bar) bar.style.display = 'none';
    if (pctEl) pctEl.style.display = 'none';
    if (labelEl) labelEl.style.display = 'none';
    if (errorText) errorText.textContent = message;
    if (errorBox) errorBox.classList.add('visible');
}

function stallWatchdog(ms) {
    let id; lastProgressAt = performance.now();
    const promise = new Promise((_, reject) => {
        id = setInterval(() => {
            if (performance.now() - lastProgressAt > ms) { clearInterval(id); reject(new Error(`init() made no progress for ${ms}ms`)); }
        }, 1000);
    });
    return { promise, cancel: () => clearInterval(id) };
}

// Was called directly on window.onload — meaning this entire scene build
// (300x300 terrain, 130k grass blades, forest/rocks/flowers generation)
// ran synchronously before the browser could even paint the title screen,
// let alone the loading screen meant to cover it. Now it only runs once
// startGame() (below) is invoked from the Remember click, with the loading
// screen already up and a real per-step progress readout.
async function init() {
    loadQuality(); // must run before createGrass() reads state.quality.bladeCount
    state.scene = new THREE.Scene();
    state.scene.fog = new THREE.FogExp2(0x111625, 0.007);

    state.globalTextures = createProceduralTextures();

    state.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.25, 2000); // far must exceed sky dome radius (1200) + player offset from origin

    state.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" }) // B-14: the default framebuffer is only touched by OutputPass; MSAA lives on the composer targets below;
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25)); // Optimized pixel ratio
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 1.08;
    document.getElementById('canvas-container').appendChild(state.renderer.domElement);
    wireContextLoss(state.renderer.domElement);

    const renderScene = new RenderPass(state.scene, state.camera);
    // Optimized: Half-resolution bloom pass for better performance
    state.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 1.0, 0.5, 0.8);
    state.bloomPass.threshold = 0.3;
    state.bloomPass.strength = 0.5;
    state.bloomPass.radius = 0.4;

    // B-14: MSAA on the composer's own render targets (renderer antialias only covers the
    // default framebuffer, which the scene never renders into). Sample count is tier-driven
    // (render-quality.js applyQuality) — this is the initial value from the saved tier.
    const _pr = state.renderer.getPixelRatio();
    const _rt = new THREE.WebGLRenderTarget(Math.floor(window.innerWidth * _pr), Math.floor(window.innerHeight * _pr), {
        type: THREE.HalfFloatType, samples: (state.quality && state.quality.msaa) || 0,
    });
    state.composer = new EffectComposer(state.renderer, _rt);
    state.composer.addPass(renderScene);
    state.composer.addPass(state.bloomPass);
    state.composer.addPass(new OutputPass()); // B-01: tone mapping + sRGB happen here, LAST

    // Ambient retuned after OutputPass (B-01) — the old 1.15 compensated for missing output stage
    const hemiLight = new THREE.HemisphereLight(0x94a3c2, 0x223318, 0.55);
    state.scene.add(hemiLight);
    state.hemiLight = hemiLight;

    state.sunLight = new THREE.DirectionalLight(0xffedc9, 1.25);
    state.sunLight.castShadow = true;
    // Optimized: Reduced shadow map resolution
    state.sunLight.shadow.mapSize.width = 1024;
    state.sunLight.shadow.mapSize.height = 1024;
    state.sunLight.shadow.camera.near = 10;
    state.sunLight.shadow.camera.far = 1000;
    const d = 500;
    state.sunLight.shadow.camera.left = -d;
    state.sunLight.shadow.camera.right = d;
    state.sunLight.shadow.camera.top = d;
    state.sunLight.shadow.camera.bottom = -d;
    state.sunLight.shadow.camera.updateProjectionMatrix();
    state.sunLight.shadow.normalBias = 0.6;
    state.sunLight.shadow.bias = -0.0002;
    state.scene.add(state.sunLight);

    state.moonLight = new THREE.DirectionalLight(0x7799ff, 0.3);
    state.scene.add(state.moonLight);

    setLoadingProgress(5, 'waking the sky');
    createSky();
    await nextFrame();

    setLoadingProgress(8, 'measuring the ground');
    await bakeHeightmap((f) => setLoadingProgress(8 + f * 8, 'measuring the ground'));
    await bakeSplat(POIS, (f) => setLoadingProgress(16 + f * 4, 'marking the trails'));

    setLoadingProgress(20, 'raising the hearth');
    createTerrainChunks(200, 0);
    await nextFrame();

    setLoadingProgress(35, 'filling the shallows');
    createLake();
    updateLake(200, 0); // ocean ring (B-20): centre on the known spawn point, same reasoning as createTerrainChunks(200,0) above
    await nextFrame();

    setLoadingProgress(55, 'growing the undergrowth');
    createGrass();
    createGrassMidRing();
    noteGrassBuilt();
    await nextFrame();

    setLoadingProgress(65, 'scattering wildflowers');
    createFlowers();
    await nextFrame();

    setLoadingProgress(75, 'settling the stones');
    createRocks();
    createPuddles();
    await nextFrame();

    setLoadingProgress(88, 'planting the forest');
    generateFractalForest();
    createGrandBlueTrees();
    createLeaningPalms();
    await nextFrame();

    setLoadingProgress(95, 'stirring the weather');
    createRainSystem();
    createRainSplashes();
    createFireflies();
    createDustParticles();
    await nextFrame();

    setLoadingProgress(98, 'placing the sanctuaries');
    await createPOIs(); // async: broken_shell.glb loads over the network
    await nextFrame();

    applyQuality(state.qualityKey); // tier: pixel ratio, shadows, bloom, particle budgets

    // (200, 0) sits on stable lowland well clear of the central crater/peak
    // and the surrounding ocean — world origin (0,0) is now partway up
    // The Serpent's Coil massif under the island terrain.
    state.player.position.set(200, heightAt(200, 0) + state.player.height, 0);

    initAudio();
    setLoadingProgress(100, 'the hearth is still');

    window.addEventListener('resize', onWindowResize);

    requestAnimationFrame(animate);
}

async function startGame() {
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.classList.remove('hidden');

    // Double-rAF hop: the first rAF fires at the end of the frame that's
    // already in flight (the loading screen's 'hidden' class was just
    // removed, but that frame hasn't been painted yet); the second one
    // guarantees an actual paint has happened in between, so the loading
    // screen is genuinely visible before init()'s synchronous work begins.
    await nextFrame();
    await nextFrame();

    const watchdog = stallWatchdog(INIT_STALL_MS);
    try {
        await Promise.race([init(), watchdog.promise]);
        watchdog.cancel();
    } catch (err) {
        watchdog.cancel();
        console.error('[startGame] init() failed or timed out — the hearth never lit.', err);
        showLoadingError('the hearth failed to catch — something went wrong loading the world.');
        return; // leave the loading screen up in its error state; don't call enterGame()
    }

    loadingScreen.classList.add('hidden');
    enterGame();
    // Phase 3 #18: the pixel-sky canvas loop (index.html) only matters
    // behind the title screen; once the real scene is up it's fully
    // covered and would otherwise keep redrawing forever for nothing.
    if (typeof window.stopPixelSky === 'function') window.stopPixelSky();
    // Marks the game as fully built — see core/input.js's pointerlockchange
    // handler for why losing pointer lock only opens the pause overlay
    // (rather than falling back to the title screen) once this is true.
    state.hasStarted = true;
    startTutorial(); // no-op if already completed
    // Phase 6 #36: touch never gets a real pointer lock, so the
    // pointerlockchange handler that normally hides the title UI, shows
    // the HUD and sets isPlaying never fires there. Enter gameplay directly.
    if (shouldShowTouchControls()) showGameplayUI();
}

function animate(time) {
    requestAnimationFrame(animate);
    const delta = Math.min(time - state.lastTime, 100); state.lastTime = time;
    // Phase 4 #26: world time/weather and POI animation (beacon throb, fire,
    // flicker) now freeze while paused, matching state.isPlaying's existing
    // use to gate POI prompts and ambient audio. updatePlayer already no-ops
    // via isPlaying; grass keeps animating off wall-clock time since it's
    // purely cosmetic and imperceptible while the pause menu covers it.
    if (state.isPlaying) {
        updateAtmosphere(delta);
        updateLeaningPalms(delta * state.timeMultiplier);
        updateGrandBlueGlow(delta / 1000);
        updateGrandBlueCanopy(delta / 1000);
        updatePines(delta / 1000);
        updatePOIs(delta / 1000);
        updateTutorial(delta / 1000);
        updateRest(delta / 1000);
    }
    updatePlayer(delta / 1000);
    updateShadowFollow(); // after atmosphere: re-centres the sun's shadow rig on the player
    updateTerrainChunks(state.player.position.x, state.player.position.z);
    updateLake(state.player.position.x, state.player.position.z);
    updateRockLOD(state.player.position.x, state.player.position.z);
    updateFlowerLOD(state.player.position.x, state.player.position.z);
    updateGrass(time / 1000);
    updateGrassMidRing(time / 1000);
    updatePOIInteraction(delta / 1000);
    updateFpsCounter(delta);
    // Phase 5 #35: keep Howler's listener on the camera so Warm Paw's
    // positional fire loop pans/attenuates as the player moves and looks.
    updateAudioListener(state.camera);
    updateAdaptiveRes(delta);
    debugFrame(delta);
    if (!state.contextLost) state.composer.render();
}

// setupInput() (keydown/keyup/mousemove/pointerlockchange) is wired
// immediately, independent of init() — see its own header comment for why
// it can't wait until after init() finishes.
setupInput();
window.addEventListener('DOMContentLoaded', () => {
    wireTitleScreen(startGame);
    wireTitleMenu();
    wireSettingsButtons();
    wireCameraAudioSettings();
    wirePauseMenu();
    initTouchControls();
    initDebug();
});