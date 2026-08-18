// init() + the animate() render loop. This is the only place that sequences
// module calls — order matters because of the getElevation() dependency
// chain (see MODULARIZATION_PLAN.md): createSky -> createTerrain ->
// createLake -> createGrass -> createFlowers -> createRocks ->
// createPuddles -> generateFractalForest -> createRainSystem ->
// createRainSplashes -> createFireflies -> createDustParticles.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { createWorldState } from './core/world-state.js';
import { resolveQualityPreset } from './core/quality.js';
import { setupInput, onWindowResize } from './core/input.js';
import { updatePlayer } from './core/player-controller.js';

import { getElevation } from './environment/terrain.js';
import { createTerrain } from './environment/terrain.js';
import { createSky } from './environment/sky.js';
import { createLake } from './environment/lake.js';
import { createOcean } from './environment/ocean.js';
import { createGrass } from './environment/grass.js';
import { createFlowers } from './environment/flowers.js';
import { createRocks } from './environment/rocks.js';
import { createPuddles } from './environment/puddles.js';
import { generateFractalForest } from './environment/forest.js';
import { createDetailedPineTrees } from './environment/pine-trees.js';

import { createRainSystem, createRainSplashes } from './fx/rain.js';
import { createFireflies } from './fx/fireflies.js';
import { createDustParticles } from './fx/dust.js';
import { createProceduralTextures } from './fx/textures.js';
import { createWindLeaves } from './fx/wind-leaves.js';
import { spawnDemoAnimals, updateDemoAnimals, updateInteractPrompt, findDryAnchor } from './environment/animals.js';
import { createMountainBoundary } from './environment/mountain-boundary.js';
import { createRadioTower } from './environment/radio-tower.js';

import { createAmbientAudio } from './audio/ambience.js';
import { updateAtmosphere } from './atmosphere/day-night-cycle.js';
import { createBackgroundRenderTarget, resizeBackgroundRenderTarget, renderBackgroundPass } from './fx/dynamic-fog.js';

const state = createWorldState();
state.quality = resolveQualityPreset();

function init() {
    state.scene = new THREE.Scene();
    state.scene.fog = new THREE.FogExp2(0x111625, 0.007);

    state.globalTextures = createProceduralTextures();

    state.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1500);

    state.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.quality.pixelRatioCap));
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Was 1.08 with sunLight peaking at 1.5 + hemi at 1.15 constant — the two
    // stacked pushed midday well past ACES's shoulder into a blown-white sky
    // (see day screenshot). Dropped exposure and the sun/hemi peaks below
    // instead of just crushing exposure alone, which would've flattened
    // contrast everywhere including night.
    state.renderer.toneMappingExposure = 0.85;
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
    state.sunLight.shadow.bottom = -d;
    state.sunLight.shadow.bias = -0.0001;
    state.scene.add(state.sunLight);

    state.moonLight = new THREE.DirectionalLight(0x7799ff, 0.3);
    state.scene.add(state.moonLight);

    createSky(state);
    createMountainBoundary(state);
    createTerrain(state);
    createOcean(state);
    createLake(state);
    createGrass(state);
    createFlowers(state);
    createRocks(state);
    createPuddles(state);
    generateFractalForest(state);
    createDetailedPineTrees(state, state.quality.pineTreeCount);
    createRainSystem(state);
    createRainSplashes(state);
    createFireflies(state);
    createDustParticles(state);
    createWindLeaves(state);
    spawnDemoAnimals(state);
    createRadioTower(state);

    // Was (0, getElevation(0,0)+height, 0) — origin is the lake basin
    // center (see environment/terrain.js), so the player spawned ~29
    // units underwater and only looked fine because player-controller.js
    // floats the camera to the water surface once isInWater kicks in on
    // frame 1. Spawning on the same dry anchor the animals use instead,
    // so you actually start standing on ground.
    const spawnAnchor = findDryAnchor();
    state.player.position.set(spawnAnchor.x, getElevation(spawnAnchor.x, spawnAnchor.z) + state.player.height, spawnAnchor.z);

    createAmbientAudio(state);

    window.addEventListener('resize', () => { onWindowResize(state); resizeBackgroundRenderTarget(state.backgroundRenderTarget); });
    setupInput(state);

    requestAnimationFrame(animate);
}

function animate(time) {
    requestAnimationFrame(animate);
    const delta = Math.min(time - state.lastTime, 100); state.lastTime = time;
    updateAtmosphere(state, delta); updatePlayer(state, delta / 1000);
    updateDemoAnimals(state, delta / 1000);
    updateInteractPrompt(state); // after both updateAtmosphere (tower proximity) and updateDemoAnimals (animal proximity) have set their flags this frame
    renderBackgroundPass(state, state.backgroundRenderTarget); // capture sky/mountain backdrop before the main pass below so this frame's dynamic fog (fx/dynamic-fog.js) reads current colors, not last frame's
    state.composer.render();
}

window.onload = init;
