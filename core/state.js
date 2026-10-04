import * as THREE from 'three';

// Shared mutable game state. Every module reads/writes through this single
// object instead of module-level globals, so the split files stay decoupled.
// (Mirrors the state.userData.shader self-reference pattern used in the main
// Silvan codebase for day-night-cycle.js uniform feeds.)

export const WORLD_SIZE = 1024; // was 800 (terrain v2: bigger island). Kept a multiple of 256/1024 so heightmap.js's bake-to-mesh ratio (k=4) stays exact.
export const WATER_LEVEL = 1.6; // Must match waterMesh.position.y in environment/lake.js createLake()
export const TREE_COUNT = 620; // was 380, scaled by new/old world area (1.64x) to keep density constant
// Phase 4 #25: was 90000 (90 real seconds per full day) — a normal
// wandering session blew through several day/night cycles by accident.
// 20 real minutes per cycle reads as a proper day without dragging.
export const DAY_LENGTH_MS = 1200000;
// Was checked every 25000ms — at the old 90s day that's ~3-4 rerolls per
// day (already a lot); at any longer day length it'd be dozens. 5 real
// minutes gives roughly 4 weather changes per 20-minute day.
export const WEATHER_CHANGE_INTERVAL_MS = 300000;

// Phase 5 #33 + #34: all six slots used to point at third-party hosts
// (mixkit.co / freesound.org), with nightAmbient, wind, and water all
// literally the same file (#33). That also left every slot exposed to
// #34 — freesound's /data/previews/ URLs aren't a stable public CDN:
// they can 403 on hotlinking depending on referer policy, and there's
// no guarantee they keep resolving the same way from a Vercel-hosted
// origin as they do locally. Self-hosting under ./assets/audio/ (same
// convention this project already uses for rain-drop.png and
// broken_shell.glb) removes that risk entirely rather than just
// "verifying" it — there's no external host left to break.
//
// These files are NOT included in this zip — drop your own royalty-free
// loops in at these exact paths before deploying, one distinct file per
// slot:
//   assets/audio/day-ambient.mp3     - daytime birds/forest layer
//   assets/audio/night-ambient.mp3   - night base layer (crickets/owls)
//   assets/audio/wind.mp3            - wind-through-trees loop
//   assets/audio/water.mp3           - lake/water lapping loop
//   assets/audio/rain.mp3            - rainfall loop
//   assets/audio/footstep.mp3        - single footstep one-shot
//   assets/audio/fire-crackle.mp3    - Phase 5 #35: Warm Paw's positional fire loop
export const SOUNDS = {
    dayAmbient: './assets/audio/day-ambient.mp3',
    nightAmbient: './assets/audio/night-ambient.mp3',
    wind: './assets/audio/wind.mp3',
    water: './assets/audio/water.mp3',
    rain: './assets/audio/rain.mp3',
    footstep: './assets/audio/footstep.mp3',
    fire: './assets/audio/fire-crackle.mp3'
};

export const state = {
    timeMultiplier: 1,
    isPlaying: false,
    isResting: false,   // true for the whole rest.js fade/skip/fade-back sequence — freezes player movement
    isLocked: false,
    hasStarted: false, // true once init() has fully built the game world — see main.js's startGame() / core/input.js's pause-vs-title branching
    gameTime: 0.35,
    daysPassed: 1,

    currentRainIntensity: 0.0, // starts clear (was 1.0: first thing a new player saw was a storm clearing)
    targetRainIntensity: 0.0, // Starts transitioning to clear so you can immediately see the shift
    weatherChangeTimer: 0,

    scene: null, camera: null, renderer: null, composer: null, bloomPass: null,
    sunLight: null, moonLight: null, hemiLight: null, skyMat: null,
    dayAmbientAudio: null, nightAmbientAudio: null, windAudio: null, waterAudio: null, rainAudio: null, stepAudio: null, fireAudio: null,
    rainMesh: null, rainMaterial: null, rainAnchor: null,
    rainSplashMesh: null, rainSplashMat: null,
    fireflyMesh: null, fireflyMat: null,
    dustMesh: null, dustMat: null, starMesh: null, starMat: null,
    grassMesh: null, grassMat: null,
    grassMidMesh: null, grassMidMat: null, // mid-ring crossed-card tufts (audit 5.2)
    moonSprite: null, cloudMesh: null, cloudMat: null,
    puddleMesh: null, puddleMaterial: null,
    waterMesh: null, waterMaterial: null,
    flowerMesh: null,
    flowerStemMesh: null,
    globalTextures: null,
    interactors: [], // B-5.6: NPC/animal THREE.Vector3 positions (beyond the player) that bend grass away; populated by whatever system owns them

    player: {
position: new THREE.Vector3(0, 0, 0),
velocity: new THREE.Vector3(),
rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
speed: 12,
height: 2.1,
// Phase 6 #37: jump/gravity state — didn't exist at all before (neither
// keyboard nor touch had a working jump). verticalVelocity drives Y
// while airborne; isGrounded switches updatePlayer() between that and
// the existing smooth ground-follow lerp.
verticalVelocity: 0,
isGrounded: true
    },
    keys: { w: false, a: false, s: false, d: false, g: false, e: false, shift: false, k: false },
    colliders: [],

    lastTime: performance.now(),
    stepTimer: 0
};