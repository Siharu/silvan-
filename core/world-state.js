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
export const WORLD_SIZE = 1150;
export const WATER_LEVEL = 1.6; // Must match waterMesh.position.y in environment/lake.js
// Tree count now lives in core/quality.js's presets (state.quality.treeCount)
// rather than as a fixed constant here, since it's one of the values the
// graphics-quality toggle scales for lower-end devices.
// Base day/night cycle length: a full in-game day/night cycle takes 50
// real-world minutes to pass — landing in the middle of the 45-60 min
// target so a normal play session sees both daylight and full darkness
// without the clock feeling like it's stuck or racing.
export const DAY_LENGTH_MS = 50 * 60 * 1000; // 3,000,000 ms

export function createWorldState() {
    return {
        // --- time / progression ---
        timeMultiplier: 1,
        isPlaying: false,

        // True once the player has clicked past the title screen at least
        // once. Distinguishes the very first pointer-lock-exit (still show
        // the title screen) from every subsequent one during play (show
        // the pause menu instead) — see core/input.js's pointerlockchange
        // handler.
        hasStartedGame: false,

        // 0-1 master volume the pause menu's slider controls, applied via
        // Howler's global volume gain node (see setMasterVolume() in
        // audio/ambience.js) — reaches every audio channel uniformly,
        // including one-shot sounds like footsteps that only ever set
        // their own volume once at creation.
        masterVolume: 1.0,

        // The active graphics quality preset object (grass/tree/rock/
        // particle counts, shadow map size, bloom on/off) — see
        // core/quality.js. Populated in main.js immediately after this
        // function returns, before any geometry-creating call reads it.
        quality: undefined,
        isLocked: false,
        gameTime: 0.35,
        daysPassed: 1,
        lastTime: performance.now(),
        stepTimer: 0,

        // --- weather ---
        currentRainIntensity: 1.0,
        targetRainIntensity: 0.0, // starts transitioning to clear
        currentCloudiness: 0.5,
        targetCloudiness: 0.5, // rolled independently of rain so overcast-but-dry and clear-but-drizzling skies can both happen
        weatherChangeTimer: 0,

        // --- three.js core ---
        scene: undefined,
        camera: undefined,
        renderer: undefined,
        composer: undefined,
        bloomPass: undefined,

        // Offscreen target the sky/mountain backdrop renders into each
        // frame, so terrain/forest/pines/rocks can fog toward the actual
        // sky/mountain color behind them instead of a flat fog color — see
        // fx/dynamic-fog.js.
        backgroundRenderTarget: undefined,

        // --- lighting / sky ---
        sunLight: undefined,
        moonLight: undefined,
        hemiLight: undefined,
        skyMat: undefined,
        moonSprite: undefined,
        sunSprite: undefined,
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

        // Nearest recruitable/following animal companion within interact
        // range, and interact-key edge-trigger state — see environment/animals.js.
        currentInteractableAnimal: undefined,

        // Cached reference to the underwater screen-tint overlay element
        // (see index.html #water-overlay). Populated lazily on first read
        // in core/player-controller.js.
        waterOverlayEl: undefined,

        // Demo animal rigs (Kat/Shuu/Bimo/Primo) — wander when unmet, follow
        // in a trailing arc once recruited. See environment/animals.js.
        demoAnimals: undefined,

        // World-boundary mountain backdrop rings, see environment/mountain-boundary.js.
        mountainFarMesh: undefined,
        mountainNearMesh: undefined,

        // WNCORE radio tower — geometry group + its beacon/marker light
        // list, and the mast-tip height offset used by the awe cutscene's
        // look-at target, see environment/radio-tower.js.
        radioTowerGroup: undefined,
        radioTowerLights: undefined,
        radioTowerTopHeight: undefined,

        // Cached #boundary-message element + its last shown/hidden state,
        // see core/player-controller.js.
        boundaryMsgEl: undefined,
        boundaryMsgVisible: false,

        // Cached #interact-prompt element and the pending result-message
        // timeout id (JOIN/NOT-THIS-TIME text, tower cutscene prompt), see
        // environment/animals.js.
        interactPromptEl: undefined,
        interactPromptTimer: undefined,

        // True when within TOWER_INTERACT_RANGE of the radio tower, see
        // environment/radio-tower.js. Takes priority over the animal
        // recruit prompt when both would otherwise want the same
        // #interact-prompt element — see updateInteractPrompt() in
        // environment/animals.js.
        nearRadioTower: false,

        // Scripted "look up at the tower in awe" camera sequence — see
        // attemptTowerInteraction()/updateTowerCutscene() in
        // environment/radio-tower.js. While active, core/player-controller.js
        // freezes normal movement/mouse-look and this script drives
        // player.rotation directly instead.
        cutsceneActive: false,
        cutsceneTimer: 0,
        cutsceneStartRotX: 0,
        cutsceneStartRotY: 0,
        cutsceneTargetRotX: 0,
        cutsceneTargetRotY: 0,
        cutsceneCaptionEl: undefined,
        cutsceneKeysHeldAtStart: undefined,
    };
}
