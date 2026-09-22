# Silvan (Modular Restart) — Plan

Restart of the Silvan animal-afterlife walking sim, module-per-system
architecture. Map 1 is **The Hearth**, sourced from
`the_hearth_isometric_map__1_.html` (final version), with two reverts:
Radio Tower and Ruined Cabin keep their plain original names/flavor text,
not the "Iron Antler"/"Sunken Ribcage" lore reskins from that file.

## Terrain, ocean, grass — DONE
`core/utils.js`'s `getElevation()`: island radial falloff → central
volcanic peak ("The Serpent's Coil", dist < 0.38 of half-map) → offset
crater pit → shoreline dune texture, ported from the mockup's
`sampleElevation()` and re-derived for this project's `WORLD_SIZE = 800`
(mockup used 320). `environment/terrain.js` colors per-vertex by
elevation band with a magma blend near the crater. `environment/lake.js`
is now conceptually the ocean (already spans the full world plane and
shades by depth via `getElevation()` — no reshaping needed once the
terrain flipped from basin to island); lily pads removed.

Grass: old billboard `InstancedMesh` scatter replaced with the
GhibliGrass sliding-window shader system, ported from `silvan-main`.
New `core/procedural-textures.js` bakes its heightmap straight from
`getElevation()`. Wired into the animate loop via `updateGrass()`.

Player spawn: `(200, 0)` — verified stable lowland.

Three blocking `ReferenceError`-class import bugs fixed along the way
(`terrain.js`/`forest.js`/`lake.js` each used a name from another module
without importing it).

**Deferred on purpose:** vegetation placement bands (forest/rocks/
flowers/grass elevation thresholds still reference old lake-basin
assumptions in places).

## Playable-state foundation — DONE
`main.js` used to run its entire heavy scene build (`init()`) directly on
`window.onload`, before the title screen could even be interacted with —
meaning the whole terrain/grass/forest generation froze the tab before
the browser could paint anything, loading screen included. Restructured:
- `init()` is now `async` and only runs after the Remember click, with
  `nextFrame()` yields between each heavy step so the loading screen's
  progress bar (`setLoadingProgress()`) actually repaints between them
  instead of just jumping to 100% at the end.
- Pointer lock is requested synchronously inside the click handler itself
  (`input.js`'s `wireTitleScreen()`), *before* any of the async loading
  work starts — browsers only honor `requestPointerLock()` as a direct
  continuation of a user gesture, and the loading `await`s would have
  broken that if the lock request had stayed inside the post-init
  "enter game" logic.
- `setupInput()` (keydown/mousemove/pointerlockchange) now wires
  immediately on `DOMContentLoaded`, not at the end of `init()` — pointer
  lock can succeed and fire `pointerlockchange` while the loading screen
  is still up, so the listener has to already exist by then or the title
  UI never hides. `mousemove` gained a `state.camera` null-guard for the
  same reason (camera doesn't exist yet during that window).

Net effect: title screen → Remember → loading screen with real progress →
game world, pointer already locked, no dead frozen tab in between.

**Correction to an earlier note in this file:** HUD time/day/weather text
was already fully wired before this — `atmosphere/day-night-cycle.js`
writes `#time-display`/`#day-display`/`#weather-display` directly every
frame. An earlier version of this plan incorrectly listed it as an open
item; it isn't.

New `core/settings.js` — quality presets (High/Med/Low, persisted via
localStorage, read at the start of `init()` so `state.quality.bladeCount`
exists before `createGrass()` needs it — only `bladeCount` is actually
quality-driven so far, other quality-scalable values aren't wired yet),
fullscreen toggle button, and a twice-a-second FPS counter — all backing
controls that already existed in `index.html` with nothing behind them.

## Points of Interest
Workflow: each POI gets designed/built as its own standalone Three.js
HTML mockup first (or, for Broken Shell, delivered as a real `.glb`);
once ready, ported into `silvan-modular` as its own module under
`environment/`, registered in `environment/pois.js`, placed at its map
coordinate scaled from the mockup's 320-unit map to this project's
800-unit `WORLD_SIZE` (factor 2.5x).

`environment/pois.js` is the central registry + interact system:
per-frame proximity check against the player, `#interact-prompt` shows
`[E] <name>` in range, pressing E drops the POI's description into the
existing `#cutscene-caption` box for a few seconds. Deliberately simple —
not real branching dialogue, that's a later phase.

| # | POI | Status |
|---|-----|--------|
| 1 | Radio Tower | **Ported** (`environment/poi-radio-tower.js`) — 3-legged tapering lattice tower, broken/tilted viewing platform, antennas + bent damaged one + dish, pulsing red beacon, 3 drooping guy-wires with ground anchors, rusted base shack with flickering porch light. Unlike the other ported POIs this one has real per-frame animation (beacon throb + shack-light flicker), wired via a new `update` field on the POI entry and a generic `updatePOIs()` called from `main.js`'s animate loop. Dropped from the port: the mockup's own textured ground plane and ambient dust field — those belonged to its standalone scene, not the tower prop. |
| 2 | The Warm Paw (campfire) | **Ported** (`environment/poi-warm-paw.js`) — much larger than the name suggests: fenced palisade compound (permanently ajar gate, no click-to-open wiring — see file header), stone ring, log stack + ash/coal/twig/chip debris, central billboarded fire + rising embers, cooking tripod/pot, 2 benches, 2 stumps, sleeping bed, candle-lit lantern, ring of 6 torches (each with its own small fire system + light), 35 drifting fireflies, paw prints leading up to camp. All particle/light animation (fire flicker, ember spawn/rise, firefly drift, lantern-flame sway, torch color shift) wired via `update`, same pattern as Radio Tower/Howling Maw. Dropped: the mockup's own ground plane, canvas-noise stone/wood textures (flat colors instead, matching this project's other ported POIs), and the raycaster-driven gate-toggle button (no UI hookup for it in-game). |
| 3 | Ruined Cabin | **Ported** (`environment/poi-ruined-cabin.js`) — deck planks, 3 broken wall sections, crumbling stone chimney, warm point light. |
| 4 | The Howling Maw (cave) | **Ported** (`environment/poi-howling-maw.js`) — clustered fang-shard cave mouth (front fangs, arch, backing wall/arch, 25 scattered outlying rocks) built from a shared `createCraggyFang()` distorted-dodecahedron helper, a bottomless tunnel void behind the mouth, roof + ground icicle fields. Animated: unsteady red "dread" glow (`dreadLight`) plus a rarer reddish-violet "pulse" flash on a random cycle, same `update`-field pattern as Radio Tower. Dropped from the port: the mockup's own terrain pit / rock bump texture (this map has its own terrain) and its custom-shader mist + ash particle systems — left as a possible later `fx/` pass using the simpler `PointsMaterial` approach already used elsewhere in this project, rather than porting the bespoke shader. |
| 5 | The Serpent's Coil (crater) | **Done** — this one is terrain, not a prop; built into `getElevation()`/`terrain.js`'s crater + magma blend + red point light. (A standalone `SERPENT_COIL.html` mountain model also exists but wasn't needed — the terrain-level version already covers this POI.) |
| 6 | The Broken Shell (sunken freighter) | **Ported** (`environment/poi-broken-shell.js`) — the only POI delivered as a real authored model (`broken_shell.glb`, copied into `assets/`) rather than a procedural build; loads via `GLTFLoader`, positioned relative to `WATER_LEVEL` (open-ocean floor) rather than `getElevation()` since it sits away from the island. |
| 7 | The Chrysalis (overgrown bunker) | **Ported** (`environment/poi-chrysalis.js`) — half-buried curved shell, blast door, red security light. |
| 8 | The Obsidian Wing (ancient monolith) | **Ported** (`environment/poi-obsidian-wing.js`) — obsidian pillar, 6 floating fragments, purple lighting. |
| 9 | Greenite Mouth | **Ported** (`environment/poi-greenite-mouth.js`) — asymmetric rock-fang archway, dark void interior, 9 glowing crystal spikes, green lighting. |

An `animated_ocean_scene_tutorial_example_1.glb` was also uploaded — not
one of the 9 POIs, likely reference/replacement material for the ocean
surface itself. Not yet evaluated or used.

## Next steps
All 9 POIs are now ported. Remaining work:
1. Real pause menu (ESC currently just re-shows the title screen wholesale
   rather than a distinct paused-game overlay — the HTML/CSS for a proper
   one already exists in `index.html`, just unwired).
2. Vegetation placement-band pass (deferred, see Terrain section above).
3. Extend quality presets beyond grass blade count (shadow map size,
   tree/rock counts) now that `core/settings.js`'s pattern exists for it.
   Warm Paw in particular is the heaviest POI by far (35 fireflies + 15+6×6
   fire particles + fence geometry) and is a good first target for a
   quality-scaled particle/instance count.
4. Wire the Resolution buttons (1080p/720p/480p) — same panel as Quality,
   not yet touched.
5. Optional: port the Howling Maw's frost-mist/ash atmosphere and the
   Radio Tower's dust field into `fx/` using this project's existing
   `PointsMaterial` particle pattern (see fx/fireflies.js), rather than
   the mockups' bespoke shaders — dropped during porting, see the POI
   table above.
6. Deferred indefinitely, not required for playability: Save/Continue
   (Regain) + autosave indicator, rest/nap mechanic, touch controls, full
   camera/audio/keybind settings persistence, underwater screen overlay,
   boundary message.
