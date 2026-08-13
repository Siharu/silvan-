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
import { setupInput, onWindowResize } from './core/input.js';
import { updatePlayer } from './core/player-controller.js';

import { getElevation } from './environment/terrain.js';
import { createTerrain } from './environment/terrain.js';
import { createSky } from './environment/sky.js';
import { createLake } from './environment/lake.js';
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
import { spawnDemoAnimals, updateDemoAnimals } from './environment/animals.js';
import { createMountainBoundary } from './environment/mountain-boundary.js';

import { createAmbientAudio } from './audio/ambience.js';
import { updateAtmosphere } from './atmosphere/day-night-cycle.js';

const state = createWorldState();

function init() {
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

    state.sunLight = new THREE.DirectionalLight(0xffedc9, 1.25);
    state.sunLight.castShadow = true;
    // Optimized: Reduced shadow map resolution
    state.sunLight.shadow.mapSize.width = 1024;
    state.sunLight.shadow.mapSize.height = 1024;
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
    createLake(state);
    createGrass(state);
    createFlowers(state);
    createRocks(state);
    createPuddles(state);
    generateFractalForest(state);
    createDetailedPineTrees(state);
    createRainSystem(state);
    createRainSplashes(state);
    createFireflies(state);
    createDustParticles(state);
    createWindLeaves(state);
    spawnDemoAnimals(state);

    state.player.position.set(0, getElevation(0, 0) + state.player.height, 0);

    createAmbientAudio(state);

    window.addEventListener('resize', () => onWindowResize(state));
    setupInput(state);

    requestAnimationFrame(animate);
}

function animate(time) {
    requestAnimationFrame(animate);
    const delta = Math.min(time - state.lastTime, 100); state.lastTime = time;
    updateAtmosphere(state, delta); updatePlayer(state, delta / 1000);
    updateDemoAnimals(state, delta / 1000);
    state.composer.render();
}

window.onload = init;
