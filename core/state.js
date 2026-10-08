import * as THREE from 'three';

// Shared mutable game state. Every module reads/writes through this single
// object instead of module-level globals, so the split files stay decoupled.
// (Mirrors the state.userData.shader self-reference pattern used in the main
// Silvan codebase for day-night-cycle.js uniform feeds.)

// World size decision (audit section 11, #3): going straight to 3200, not
// the 1600 waypoint. Safe to bump directly — elevation-core.js's rawElevation()
// already expresses island radius as a FRACTION of WORLD_SIZE (dist scales
// with it) while noise wavelengths are fixed world-unit constants "chosen to
// reproduce the exact previous look... and simply hold steady if the world
// is widened later instead of stretching every hill with it" (its own
// comment, written for exactly this change) — so the island gets bigger and
// gets MORE terrain detail filling it, not a stretched version of the same
// detail. POI/_PAD coordinates and TREE_COUNT below already scale off
// WORLD_SIZE too.
// NOT free: core/heightmap.js's bake stays at a fixed HM_RES=2049 nodes/side
// regardless of WORLD_SIZE, so texel spacing goes from ~0.5u (at the old
// 1024) to ~1.56u at 3200 — a real loss of ground-sample precision (slope/
// normal/collision/placement all read off that same bake). Left as-is for
// now (bumping HM_RES to hold spacing would ~10x the worker bake's sample
// count); flagging as its own follow-up perf item rather than guessing at
// a resolution bump blind.
export const WORLD_SIZE = 3200;
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
//   assets/audio/thunder.mp3         - one-shot, played per lightning flash (fx/lightning.js) — not loaded yet, same B-16 warn-not-throw path as the other 7
export const SOUNDS = {
    dayAmbient: './assets/audio/day-ambient.mp3',
    nightAmbient: './assets/audio/night-ambient.mp3',
    wind: './assets/audio/wind.mp3',
    water: './assets/audio/water.mp3',
    rain: './assets/audio/rain.mp3',
    footstep: './assets/audio/footstep.mp3',
    fire: './assets/audio/fire-crackle.mp3',
    thunder: './assets/audio/thunder.mp3',
    dogBark: './assets/audio/dog-bark.mp3' // environment/npc-dog.js's First Dog (Act I Scene 1-2) — not loaded yet, same warn-not-throw path
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
    stormForced: false, // debug/settings override — natural "torrential" (currentRainIntensity>0.9) only comes up on ~5% of weather rolls, too rare to ever actually see/test without this
    effectiveWaterLevel: WATER_LEVEL, // WATER_LEVEL eased upward during a torrential storm surge (atmosphere/day-night-cycle.js) — player-controller.js and lake.js read this instead of the constant so the shoreline actually floods a little instead of just looking darker

    scene: null, camera: null, renderer: null, composer: null, bloomPass: null,
    sunLight: null, moonLight: null, hemiLight: null, skyMat: null,
    dayAmbientAudio: null, nightAmbientAudio: null, windAudio: null, waterAudio: null, rainAudio: null, stepAudio: null, fireAudio: null, thunderAudio: null, dogBarkAudio: null,
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

    // The Serpent's Coil quest (environment/serpents-coil.js). Phase itself
    // is NOT stored here — it's derived purely from state.daysPassed/
    // gameTime every frame, so it naturally replays correctly after a
    // Regain with no save-schema change needed. inCave/caveReturn ARE
    // session-only UI/physics state (not persisted — see that file's
    // header for why a mid-cave quit just resumes on the surface).
    inCave: false,        // true while player-controller.js should use the cave's flat-room movement instead of heightmap ground-follow
    caveReturn: null,     // {x, y, z, yaw} surface position to restore on exit — set the moment the cutscene commits to entering

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

    // Scratch buffers for forest.js's old (restored) inline growBranch()
    // recursion — the merged-mesh/LOD deciduous system that briefly
    // replaced it (deciduous-tree.js, since reverted) kept its own matrix
    // buffers internally and didn't need these on state, so they'd been
    // dropped from here. Put back since forest.js pushes into them.
    branchMatrices: [],
    branchColors: [],
    leafMatrices: [],
    leafColors: [],

    lastTime: performance.now(),
    stepTimer: 0
};