// main.js — wires every ported system together into an actual running
// game. This is new code (not a port) since none of the reference HTML
// files shared one scene/init/animate structure this project could copy
// wholesale — each was its own standalone demo.
//
// NOT wired up here, flagged plainly: index.html's settings tabs, pause
// menu, save system, and quality/view-mode toggles reference
// core/input.js, core/save-system.js, core/quality.js, core/view-mode.js,
// none of which exist in this rebuild yet. This file only hooks the
// title screen's "Remember" button (id="title-remember-btn") to start the
// engine, and core/settings.js's getSettings() for FOV/sensitivity
// defaults where relevant. Everything else on the title/pause UI will
// render but not function yet — same caveat given when index.html was
// first copied over.

import * as THREE from 'three';
import { createWorldState } from './core/world-state.js';
import { getSettings } from './core/settings.js';

import { createTerrain, getElevation } from './environment/terrain.js';
import { createGrass, updateGrass } from './environment/grass.js';
import { createRainSystem, createRainSplashes, updateRain } from './environment/rain.js';
import { createFerns, updateFoliage } from './environment/foliage.js';
import { createRocks } from './environment/rocks.js';
import { createDetailedPineTrees } from './environment/pine-trees.js';
import { createWater, updateWater } from './environment/water.js';
import { createRadioTower, updateRadioTower } from './environment/radio-tower.js';
import { spawnDemoAnimals, updateDemoAnimals, updateInteractPrompt, attemptRecruitInteraction } from './environment/animals.js';
import { createDayNightCycle, updateDayNightCycle, updateStars } from './atmosphere/day-night-cycle.js';

const state = createWorldState();
window._silvanState = state; // console-debuggable, same convenience the old project's main.js had

function setLoadingProgress(fraction, label) {
    const frame = document.getElementById('loading-screen-frame');
    if (frame && frame.contentWindow && frame.contentWindow.postMessage) {
        frame.contentWindow.postMessage({ type: 'progress', fraction, label }, '*');
    }
}

async function afterStep() {
    // Yields a frame so the loading screen can actually paint between
    // heavy synchronous steps below — same pattern the old project used.
    await new Promise((resolve) => requestAnimationFrame(resolve));
}

function setupRenderer() {
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x87CEEB);
    state.scene.fog = new THREE.FogExp2(0x87CEEB, 0.0025);

    const settings = getSettings();
    state.camera = new THREE.PerspectiveCamera(settings.fov || 75, window.innerWidth / window.innerHeight, 0.1, 20000);
    state.camera.position.set(0, 5, 20);

    state.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
function setupPlayerController() {
    const settings = getSettings();
    const move = { forward: false, back: false, left: false, right: false, run: false };
    let yaw = 0, pitch = 0;
    const PLAYER_SPEED = 8;
    const RUN_MULT = 1.9;

    document.addEventListener('keydown', (e) => {
        if (e.code === 'KeyW') move.forward = true;
        if (e.code === 'KeyS') move.back = true;
        if (e.code === 'KeyA') move.left = true;
        if (e.code === 'KeyD') move.right = true;
        if (e.code === 'ShiftLeft') move.run = true;
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'KeyW') move.forward = false;
        if (e.code === 'KeyS') move.back = false;
        if (e.code === 'KeyA') move.left = false;
        if (e.code === 'KeyD') move.right = false;
        if (e.code === 'ShiftLeft') move.run = false;
        if (e.code === 'KeyE') attemptRecruitInteraction(state);
    });

    state.renderer.domElement.addEventListener('click', () => {
        state.renderer.domElement.requestPointerLock();
    });

    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== state.renderer.domElement) return;
        const sens = (settings.sensitivity || 1) * 0.0022;
        yaw -= e.movementX * sens;
        pitch -= e.movementY * sens * (settings.invertY ? -1 : 1);
        pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    });

    state.player.position.x = 0;
    state.player.position.z = 20;
    state.player.position.y = getElevation(0, 20, state) + state.player.height;

    state._updatePlayer = function updatePlayer(delta) {
        const speed = PLAYER_SPEED * (move.run ? RUN_MULT : 1) * delta;
        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const right = new THREE.Vector3(Math.sin(yaw + Math.PI / 2), 0, Math.cos(yaw + Math.PI / 2));

        const dir = new THREE.Vector3();
        if (move.forward) dir.add(forward);
        if (move.back) dir.sub(forward);
        if (move.right) dir.add(right);
        if (move.left) dir.sub(right);
        if (dir.lengthSq() > 0) {
            dir.normalize().multiplyScalar(speed);
            state.player.position.x += dir.x;
            state.player.position.z += dir.z;
        }
        state.player.isRunning = move.run && dir.lengthSq() > 0;

        const groundY = getElevation(state.player.position.x, state.player.position.z, state) + state.player.height;
        state.player.position.y += (groundY - state.player.position.y) * Math.min(1, delta * 10); // smoothed, not snapped, so slopes don't feel jittery

        state.camera.position.set(state.player.position.x, state.player.position.y, state.player.position.z);
        state.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    };
}

async function init() {
    setLoadingProgress(0.02, 'Setting up renderer');
    setupRenderer();
    await afterStep();

    setLoadingProgress(0.08, 'Growing terrain');
    createTerrain(state);
    await afterStep();

    setLoadingProgress(0.18, 'Filling the sky');
    createDayNightCycle(state);
    await afterStep();

    setLoadingProgress(0.28, 'Pouring the lake');
    createWater(state);
    await afterStep();

    setLoadingProgress(0.4, 'Planting pines');
    createDetailedPineTrees(state);
    await afterStep();

    setLoadingProgress(0.55, 'Growing ferns');
    await createFerns(state, (f) => setLoadingProgress(0.55 + f * 0.15, 'Growing ferns'));

    setLoadingProgress(0.72, 'Scattering rocks');
    createRocks(state);
    await afterStep();

    setLoadingProgress(0.82, 'Growing grass');
    createGrass(state);
    await afterStep();

    setLoadingProgress(0.88, 'Loading rain');
    createRainSystem(state);
    createRainSplashes(state);
    state.currentRainIntensity = 0; // clear by default; weather system TBD
    await afterStep();

    setLoadingProgress(0.93, 'Raising the tower');
    createRadioTower(state, new THREE.Vector3(120, 0, -140));
    await afterStep();

    setLoadingProgress(0.97, 'Waking the animals');
    spawnDemoAnimals(state);
    await afterStep();

    setupPlayerController();

    setLoadingProgress(1.0, 'Ready');
    startEngine();
}

function startEngine() {
    const loadingScreen = document.getElementById('loading-screen');
    const titlePanelBackdrop = document.getElementById('title-panel-backdrop');
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (loadingScreen) loadingScreen.classList.add('hidden');
        if (titlePanelBackdrop) titlePanelBackdrop.style.display = 'none';
        const titleMenu = document.getElementById('title-menu');
        if (titleMenu) titleMenu.style.display = 'none';

        state.clock.start();
        animate();
    }));
}

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(0.1, state.clock.getDelta()); // clamp so a tab-switch stall doesn't teleport anything
    const ts = state.clock.elapsedTime;

    if (state._updatePlayer) state._updatePlayer(delta);

    updateDayNightCycle(state, delta);
    updateStars(state, delta);
    updateWater(state, ts);
    updateGrass(state, ts);
    updateFoliage(state, ts);
    updateRain(state, ts);
    updateRadioTower(state, ts);
    updateDemoAnimals(state, delta);
    updateInteractPrompt(state);

    state.renderer.render(state.scene, state.camera);
}

// --- Title screen hookup ---
const rememberBtn = document.getElementById('title-remember-btn');
if (rememberBtn) {
    rememberBtn.addEventListener('click', () => {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) loadingScreen.classList.remove('hidden');
        init();
    });
} else {
    // No title screen button found (e.g. testing index.html standalone) —
    // start immediately rather than leaving the game unreachable.
    init();
}
