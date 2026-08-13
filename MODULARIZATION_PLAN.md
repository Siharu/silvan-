# Silvan Modularization Plan

Source analyzed: `silvan_part2_with_original_grass.html` (1561 lines, single `<script type="module">`, one flat closure scope).

## Core problem

Almost every function reads/writes the same top-level `let` variables (`scene`, `player`, `colliders`, `branchMatrices`, `gameTime`, etc.) via shared closure scope instead of explicit params/returns. Before splitting into files, each function needs an explicit interface — otherwise the modules will just re-create the same coupling across file boundaries via imports.

## Current function inventory (line numbers as of this snapshot)

| Function | Line | Role |
|---|---|---|
| `hash`, `noise` | 229, 233 | Value-noise primitives used by terrain/biome logic |
| `getElevation` | 248 | Terrain height + lake carving — depended on by nearly everything that places objects |
| `createProceduralTextures` | 257 | Canvas-generated leaf/moon/flower textures, shared across forest/sky/flowers |
| `init` | 305 | Scene/renderer/lights/composer setup, calls all `create*` in order |
| `createSky` | 382 | Sky dome, sun/moon sprite, sun/moon position math |
| `createTerrain` | 533 | Ground mesh from `getElevation` heightfield |
| `createPuddles` | 555 | Rain puddle decals |
| `createGrass` | 625 | Billboard triangle-blade grass (the "clever trick") |
| `createLake` | 721 | Water plane, `Reflector` mirror surface, lily pads |
| `createFlowers` | 804 | Flower field instancing |
| `generateFractalForest` | 886 | Recursive branch generator, pine tree variant, trunk/leaf materials |
| `createRocks` | 1129 | Rock clusters + colliders |
| `createRainSystem` | 1170 | Rain particle streaks |
| `createFireflies` | 1271 | Firefly particles |
| `createDustParticles` | 1316 | Ambient dust motes |
| `setupInput` | 1374 | Keyboard/mouse/pointer-lock listeners, start button, day/night audio play/pause |
| `onWindowResize` | 1410 | Resize handler |
| `updateAtmosphere` | 1418 | Per-frame: time-of-day, weather transitions, sky/fog/light uniforms, ambient audio volumes — currently the largest, most tangled function |
| `updatePlayer` | 1525 | Movement, collision vs `colliders`, footstep audio, ground-snap |
| `animate` | 1553 | Main render loop |

Shared state currently living as bare globals: `scene, camera, renderer, composer, bloomPass, sunLight, moonLight, skyMat, dayAmbientAudio, nightAmbientAudio, windAudio, waterAudio, rainAudio, stepAudio, rainMesh, rainMaterial, fireflyMesh, fireflyMat, dustMesh, dustMat, starMesh, starMat, grassMesh, grassMat, moonSprite, cloudMesh, cloudMat, puddleMesh, puddleMaterial, waterMesh, waterMaterial, waterReflector, flowerMesh, globalTextures, branchMatrices, leafMatrices, branchColors, leafColors, player, keys, colliders, gameTime, daysPassed, currentRainIntensity, targetRainIntensity, weatherChangeTimer, isPlaying, isLocked`.

## Proposed folder structure

```
/silvan
  index.html                 — shell only: canvas div, UI markup, CSS, <script type="module" src="main.js">
  main.js                    — init(), animate loop, orchestrates module calls in dependency order

  /core
    world-state.js           — single exported state object replacing the scattered globals
    input.js                 — setupInput(): keys, pointer lock, mousemove, start-button wiring
    player-controller.js     — updatePlayer(): movement + collision-vs-colliders (future home of swim/dive state)

  /environment
    terrain.js               — hash(), noise(), getElevation(), createTerrain()
    sky.js                   — createSky(), sun/moon position math, skyMat uniforms
    lake.js                  — createLake(), Reflector setup, lily pads
    grass.js                 — createGrass() (billboard triangle-blade shader trick)
    flowers.js               — createFlowers()
    forest.js                — generateFractalForest(): branch recursion, pine variant, trunk/leaf materials
    rocks.js                 — createRocks()
    puddles.js               — createPuddles()

  /fx
    rain.js                  — createRainSystem() (rain-vs-water fix lands here later)
    fireflies.js             — createFireflies()
    dust.js                  — createDustParticles()
    textures.js              — createProceduralTextures() (shared canvas textures)

  /audio
    ambience.js              — SOUNDS config, Howl setup, day/night/wind/water crossfade logic

  /atmosphere
    day-night-cycle.js       — updateAtmosphere() split out from audio: gameTime, weather transitions, sky/fog/light/particle uniforms
```

## Why this split

- **`environment/*`** are all "spawn once at init" generators. Each depends on `terrain.js` for `getElevation()` and pushes into the shared `colliders` array — that's their only real coupling, so it's a clean boundary once `world-state.js` exists.
- **`atmosphere/day-night-cycle.js`** is currently the ugliest function — 100+ lines touching sky, fog, rain tint, firefly opacity, dust visibility, *and* audio volumes all in one blob. Pulling the audio piece into `audio/ambience.js` alone makes this dramatically more readable.
- **`fx/textures.js`** exists because `createSky()`, `generateFractalForest()`, and `createFlowers()` all call the same `createProceduralTextures()` and share `globalTextures` — worth making that an explicit shared resource other modules import rather than reach into a global.
- **`core/player-controller.js`** is split out from `core/input.js` because movement/collision logic and raw key/mouse listeners are currently tangled together inside `setupInput()`. This is also exactly where swim/dive state will slot in later without touching input wiring.

## Migration approach

Don't rewrite from scratch — migrate function-by-function, keeping the game runnable after each step:

1. Introduce `core/world-state.js` as one exported object holding everything currently a bare `let`. Every module imports and mutates fields on that object instead of relying on shared closure scope.
2. Move functions file-by-file, changing signatures to accept `state` (and any other needed params) explicitly — e.g. `createGrass(state)` instead of implicitly closing over `getElevation` and `grassMesh`.
3. Keep `main.js` as the only place that sequences init order. Order currently matters because of the `getElevation` dependency chain (`createSky → createTerrain → createLake → createGrass → createFlowers → createRocks → createPuddles → generateFractalForest → createRainSystem → createFireflies → createDustParticles`) — this must be preserved exactly.
4. After each module extraction, verify the game still runs in a real browser tab before moving to the next one (artifact preview sandboxes have shown false negatives on this project — see pointer-lock issue).

## Open items to fold in during or after modularization

- Pine tree visual rework (currently the `ConeGeometry` layered-cone system inside `generateFractalForest`)
- Moon light intensity / night brightness tuning
- Rain-vs-water collision (rain currently passes through the lake surface)
- Swim/dive state (net-new system, belongs in `core/player-controller.js`)
- Replace placeholder ambience URLs (`wind`, `water`, `nightAmbient` in `audio/ambience.js`) with verified tracks
