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
import { setupInput, onWindowResize } from './input.js';
import { updatePlayer } from './player-controller.js';
import { updateAtmosphere } from '../atmosphere/day-night-cycle.js';

import { createSky } from '../environment/sky.js';
import { createTerrain } from '../environment/terrain.js';
import { createPuddles } from '../environment/puddles.js';
import { createGrass } from '../environment/grass.js';
import { createLake } from '../environment/lake.js';
import { createFlowers } from '../environment/flowers.js';
import { generateFractalForest } from '../environment/forest.js';
import { createRocks } from '../environment/rocks.js';
import { createRainSystem, createRainSplashes } from '../fx/rain.js';
import { createFireflies } from '../fx/fireflies.js';
import { createDustParticles } from '../fx/dust.js';

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
    const d = 500;
    state.sunLight.shadow.camera.left = -d;
    state.sunLight.shadow.camera.right = d;
    state.sunLight.shadow.camera.top = d;
    state.sunLight.shadow.bottom = -d;
    state.sunLight.shadow.bias = -0.0001;
    state.scene.add(state.sunLight);

    state.moonLight = new THREE.DirectionalLight(0x7799ff, 0.3);
    state.scene.add(state.moonLight);

    createSky();
    createTerrain();
    createLake();
    createGrass();
    createFlowers();
    createRocks();
    createPuddles();
    generateFractalForest();
    createRainSystem();
    createRainSplashes();
    createFireflies();
    createDustParticles();

    state.player.position.set(0, getElevation(0, 0) + state.player.height, 0);

    initAudio();

    window.addEventListener('resize', onWindowResize);
    setupInput();

    requestAnimationFrame(animate);
}

function animate(time) {
    requestAnimationFrame(animate);
    const delta = Math.min(time - state.lastTime, 100); state.lastTime = time;
    updateAtmosphere(delta); updatePlayer(delta / 1000);
    state.composer.render();
}

window.onload = init;
