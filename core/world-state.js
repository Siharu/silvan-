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
export const OCEAN_LEVEL = 1.6; // Sea level for environment/ocean.js — same height as the inland lake's WATER_LEVEL, must match oceanMesh.position.y
// Tree count now lives in core/quality.js's presets (state.quality.treeCount)
// rather than as a fixed constant here, since it's one of the values the
// graphics-quality toggle scales for lower-end devices.
// Base day/night cycle length: a full in-game day/night cycle takes 50
// real-world minutes to pass — landing in the middle of the 45-60 min
// target so a normal play session sees both daylight and full darkness
// without the clock feeling like it's stuck or racing.
export const DAY_LENGTH_MS = 50 * 60 * 1000; // 3,000,000 ms

// A fixed, deliberately flattened clearing packed with extra-dense trees —
// used as the animal spawn point (environment/animals.js's spawnDemoAnimals)
// instead of findDryAnchor()'s "first dry patch found walking outward from
// the lake" spot, which is just wherever the noise happens to clear 160
// units out along +Z=0 — never guaranteed flat or wooded. Chosen well clear
// of both the lake basin (centerDist<160, see terrain.js) and the coastal
// foothills/mountain ring (islandRadiusAt() usually >500 in this direction),
// and off the +X/z=0 axis findDryAnchor() walks, so it doesn't overlap the
// player's own default spawn.
export const GROVE_CENTER = { x: -230, z: 210 };
export const GROVE_FLATTEN_RADIUS = 45; // fully flat within this radius
export const GROVE_BLEND_RADIUS = 90; // fades back to normal terrain by this radius
export const GROVE_TARGET_ELEVATION = 6.5; // flat height, comfortably above the y>3 "dry land" threshold used elsewhere

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
        // Timestamp of the last successful autosave write (core/save-
        // system.js) — undefined until the first one, so main.js's
        // animate() can tell "never saved yet this session" apart from
        // "saved recently" without a separate flag.
        lastAutosaveTime: undefined,
        stepTimer: 0,

        // --- weather ---
        // Was 1.0/0.5 — a session always opened mid-storm/overcast and had
        // to visibly ease down to clear over the first couple seconds.
        // Starting clear and letting the first weatherChangeTimer roll (25s
        // in) introduce whatever's next reads as a calm start instead.
        currentRainIntensity: 0.0,
        targetRainIntensity: 0.0,
        currentCloudiness: 0.15,
        targetCloudiness: 0.15, // rolled independently of rain so overcast-but-dry and clear-but-drizzling skies can both happen
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
            // Eases 0->1 while a movement key is held and 1->0 on release
            // (core/player-controller.js) — movement used to jump straight
            // from zero to full speed and back on every keydown/keyup,
            // which read as janky/twitchy. This scales velocity's magnitude
            // for a short ramp in/out instead of a hard on/off.
            speedEase: 0,
            // Facing angle (radians, world Y-up) Kat's visible rig turns
            // toward — driven from actual movement direction rather than
            // camera look direction, so top-down (no mouse-look) still
            // turns her to face where she's walking. See updatePlayer().
            facingAngle: 0,
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

        // Demo animal rigs (Shuu/Bimo/Primo) — wander when unmet, follow
        // in a trailing arc once recruited. See environment/animals.js.
        demoAnimals: undefined,

        // The player's own visible body — Kat's rig (same buildAnimalRig()
        // animals.js uses for the companions), positioned/rotated to follow
        // state.player each frame by core/player-controller.js. Hidden in
        // first-person (the camera sits at her eye height, so her own body
        // would just clip the view), visible in top-down so you can
        // actually see who you're controlling. See updatePlayer().
        playerRig: undefined,

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