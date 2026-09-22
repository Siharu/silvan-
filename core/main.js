import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
// Reflector removed — real-time mirror reflections were the source of the star-blob
// and grazing-angle stripe artifacts. Water now fakes its reflectivity via fresnel
// + sky tint + a sun/moon glint in the shader below instead.

import { state } from './state.js';
import { getElevation, createProceduralTextures } from './utils.js';
import { initAudio } from './audio.js';
import { setupInput, onWindowResize, wireTitleScreen, enterGame } from './input.js';
import { loadQuality, wireSettingsButtons, updateFpsCounter } from './settings.js';
import { updatePlayer } from './player-controller.js';
import { updateAtmosphere } from '../atmosphere/day-night-cycle.js';

import { createSky } from '../environment/sky.js';
import { createTerrain } from '../environment/terrain.js';
import { createPuddles } from '../environment/puddles.js';
import { createGrass, updateGrass } from '../environment/grass.js';
import { createLake } from '../environment/lake.js';
import { createFlowers } from '../environment/flowers.js';
import { generateFractalForest } from '../environment/forest.js';
import { createRocks } from '../environment/rocks.js';
import { createRainSystem, createRainSplashes } from '../fx/rain.js';
import { createFireflies } from '../fx/fireflies.js';
import { createDustParticles } from '../fx/dust.js';
import { createPOIs, updatePOIInteraction, updatePOIs } from '../environment/pois.js';

// Yields one real animation frame — used between init()'s heavy steps below
// so the loading-screen progress bar actually gets a chance to repaint
// between them, instead of the whole build running as one uninterrupted
// synchronous task with the DOM writes only flushing at the very end.
function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

function setLoadingProgress(pct, label) {
    const fill = document.getElementById('loading-screen-fill');
    const pctEl = document.getElementById('loading-screen-pct');
    const labelEl = document.getElementById('loading-screen-label');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = String(Math.round(pct)).padStart(2, '0') + '%';
    if (labelEl && label) labelEl.textContent = label;
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

    state.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1500);

    state.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25)); // Optimized pixel ratio
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 1.08;
    document.getElementById('canvas-container').appendChild(state.renderer.domElement);

    const renderScene = new RenderPass(state.scene, state.camera);
    // Optimized: Half-resolution bloom pass for better performance
    state.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 1.0, 0.5, 0.8);
    state.bloomPass.threshold = 0.3;
    state.bloomPass.strength = 0.5;
    state.bloomPass.radius = 0.4;

    state.composer = new EffectComposer(state.renderer);
    state.composer.addPass(renderScene);
    state.composer.addPass(state.bloomPass);

    // Boosted ambient light to fix pitch-black grass/shadows
    const hemiLight = new THREE.HemisphereLight(0x94a3c2, 0x223318, 1.15);
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
    state.sunLight.shadow.bottom = -d;
    state.sunLight.shadow.bias = -0.0001;
    state.scene.add(state.sunLight);

    state.moonLight = new THREE.DirectionalLight(0x7799ff, 0.3);
    state.scene.add(state.moonLight);

    setLoadingProgress(5, 'waking the sky');
    createSky();
    await nextFrame();

    setLoadingProgress(20, 'raising the hearth');
    createTerrain();
    await nextFrame();

    setLoadingProgress(35, 'filling the shallows');
    createLake();
    await nextFrame();

    setLoadingProgress(55, 'growing the undergrowth');
    createGrass();
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

    // (200, 0) sits on stable lowland well clear of the central crater/peak
    // and the surrounding ocean — world origin (0,0) is now partway up
    // The Serpent's Coil massif under the island terrain.
    state.player.position.set(200, getElevation(200, 0) + state.player.height, 0);

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

    await init();

    loadingScreen.classList.add('hidden');
    enterGame();
}

function animate(time) {
    requestAnimationFrame(animate);
    const delta = Math.min(time - state.lastTime, 100); state.lastTime = time;
    updateAtmosphere(delta); updatePlayer(delta / 1000);
    updateGrass(time / 1000);
    updatePOIInteraction(delta / 1000);
    updatePOIs(delta / 1000);
    updateFpsCounter(delta);
    state.composer.render();
}

// setupInput() (keydown/keyup/mousemove/pointerlockchange) is wired
// immediately, independent of init() — see its own header comment for why
// it can't wait until after init() finishes.
setupInput();
window.addEventListener('DOMContentLoaded', () => {
    wireTitleScreen(startGame);
    wireSettingsButtons();
});
