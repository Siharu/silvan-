// Single shared mutable-state object replacing the scattered top-level `let`s
// from the original monolithic build. Every module that needs to read or
// write shared game state imports `createWorldState()` (called once, in
// main.js) and receives this same object by reference.
//
// Fields are grouped to mirror the original inventory in
// MODULARIZATION_PLAN.md. Nothing here is computed — it's just structure.

import * as THREE from 'three';

// World-tuning constants shared across many modules. Not part of the mutable
// state object since nothing ever reassigns them.
export const WORLD_SIZE = 800;
export const WATER_LEVEL = 1.6; // Must match waterMesh.position.y in environment/lake.js
export const TREE_COUNT = 380;
// Base day/night cycle length: a full in-game day takes 1/4 of a real-world
// day to pass (24h / 4 = 6h), i.e. the world runs 4x real-world speed by
// default. Holding 'R' to rest stacks state.timeMultiplier (50x) on top of
// this baseline — see atmosphere/day-night-cycle.js.
export const DAY_LENGTH_MS = 6 * 60 * 60 * 1000; // 21,600,000 ms

export function createWorldState() {
    return {
        // --- time / progression ---
        timeMultiplier: 1,
        isPlaying: false,
        isLocked: false,
        gameTime: 0.35,
        daysPassed: 1,
        lastTime: performance.now(),
        stepTimer: 0,

        // --- weather ---
        currentRainIntensity: 1.0,
        targetRainIntensity: 0.0, // starts transitioning to clear
        weatherChangeTimer: 0,

        // --- three.js core ---
        scene: undefined,
        camera: undefined,
        renderer: undefined,
        composer: undefined,
        bloomPass: undefined,

        // --- lighting / sky ---
        sunLight: undefined,
        moonLight: undefined,
        skyMat: undefined,
        moonSprite: undefined,
        cloudMesh: undefined,
        cloudMat: undefined,
        starMesh: undefined,
        starMat: undefined,

        // --- audio (Howl instances, wired up in audio/ambience.js) ---
        dayAmbientAudio: undefined,
        nightAmbientAudio: undefined,
        windAudio: undefined,
        waterAudio: undefined,
        rainAudio: undefined,
        stepAudio: undefined,

        // --- weather fx meshes ---
        rainMesh: undefined,
        rainMaterial: undefined,
        rainSplashMesh: undefined,
        rainSplashMat: undefined,
        fireflyMesh: undefined,
        fireflyMat: undefined,
        dustMesh: undefined,
        dustMat: undefined,
        windLeavesMesh: undefined,
        windLeavesMat: undefined,

        // --- terrain dressing ---
        grassMesh: undefined,
        grassMat: undefined,
        puddleMesh: undefined,
        puddleMaterial: undefined,
        waterMesh: undefined,
        waterMaterial: undefined,
        flowerMesh: undefined,

        // --- shared canvas textures (leaf/moon/flower) ---
        globalTextures: undefined,

        // --- forest instancing scratch arrays ---
        branchMatrices: [],
        leafMatrices: [],
        branchColors: [],
        leafColors: [],

        // --- player / input ---
        player: {
            position: new THREE.Vector3(0, 0, 0),
            velocity: new THREE.Vector3(),
            rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
            speed: 12,
            height: 2.1,
            // Camera-only "swimming" feel (not real swim/dive physics — see
            // core/player-controller.js). True whenever the ground beneath
            // the player is below WATER_LEVEL, i.e. they're out over the lake.
            isInWater: false,
            // Sprint, disabled while isInWater is true.
            isRunning: false,
        },
        keys: { w: false, a: false, s: false, d: false, r: false, shift: false },
        colliders: [],

        // Cached reference to the underwater screen-tint overlay element
        // (see index.html #water-overlay). Populated lazily on first read
        // in core/player-controller.js.
        waterOverlayEl: undefined,

        // Demo animal rigs (Kat/Shuu/Bimo/Primo), see environment/animals.js.
        demoAnimals: undefined,

        // World-boundary mountain backdrop rings, see environment/mountain-boundary.js.
        mountainFarMesh: undefined,
        mountainNearMesh: undefined,
    };
}
