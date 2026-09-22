import * as THREE from 'three';

// Shared mutable game state. Every module reads/writes through this single
// object instead of module-level globals, so the split files stay decoupled.
// (Mirrors the state.userData.shader self-reference pattern used in the main
// Silvan codebase for day-night-cycle.js uniform feeds.)

export const WORLD_SIZE = 800;
export const WATER_LEVEL = 1.6; // Must match waterMesh.position.y in environment/lake.js createLake()
export const TREE_COUNT = 380;
export const DAY_LENGTH_MS = 90000;

export const SOUNDS = {
    dayAmbient: 'https://assets.mixkit.co/sfx/download/mixkit-forest-birds-ambience-1210.mp3', // Daytime birds/forest layer
    nightAmbient: 'https://freesound.org/data/previews/174/174763_2437358-lq.mp3', // Fallback night/base layer - swap for a crickets/owl loop if you have one
    wind: 'https://freesound.org/data/previews/174/174763_2437358-lq.mp3', // TODO: swap for a dedicated wind-through-trees loop
    water: 'https://freesound.org/data/previews/174/174763_2437358-lq.mp3', // TODO: swap for a dedicated lake/water lapping loop
    rain: 'https://freesound.org/data/previews/258/258113_3263906-lq.mp3',
    footstep: 'https://freesound.org/data/previews/336/336598_5121236-lq.mp3'
};

export const state = {
    timeMultiplier: 1,
    isPlaying: false,
    isLocked: false,
    hasStarted: false, // true once init() has fully built the game world — see main.js's startGame() / core/input.js's pause-vs-title branching
    gameTime: 0.35,
    daysPassed: 1,

    currentRainIntensity: 1.0,
    targetRainIntensity: 0.0, // Starts transitioning to clear so you can immediately see the shift
    weatherChangeTimer: 0,

    scene: null, camera: null, renderer: null, composer: null, bloomPass: null,
    sunLight: null, moonLight: null, hemiLight: null, skyMat: null,
    dayAmbientAudio: null, nightAmbientAudio: null, windAudio: null, waterAudio: null, rainAudio: null, stepAudio: null,
    rainMesh: null, rainMaterial: null,
    rainSplashMesh: null, rainSplashMat: null,
    fireflyMesh: null, fireflyMat: null,
    dustMesh: null, dustMat: null, starMesh: null, starMat: null,
    grassMesh: null, grassMat: null,
    moonSprite: null, cloudMesh: null, cloudMat: null,
    puddleMesh: null, puddleMaterial: null,
    waterMesh: null, waterMaterial: null,
    flowerMesh: null,
    globalTextures: null,

    branchMatrices: [],
    leafMatrices: [],
    branchColors: [],
    leafColors: [],

    player: {
position: new THREE.Vector3(0, 0, 0),
velocity: new THREE.Vector3(),
rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
speed: 12,
height: 2.1
    },
    keys: { w: false, a: false, s: false, d: false, r: false, e: false },
    colliders: [],

    lastTime: performance.now(),
    stepTimer: 0
};