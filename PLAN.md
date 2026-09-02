# Silvan Remake — Open Issues Plan

## 1. W/S movement reversed — FIXED this session
Root cause: `main.js`'s player controller computed `forward` as
`(sin(yaw), 0, cos(yaw))`, which at yaw=0 evaluates to `(0,0,1)` — that's
+Z, the opposite of a Three.js camera's default -Z look direction. W
(`move.forward`) was pushing the player backward relative to view, S
forward. `right` had the same class of sign error.

Fixed to `forward=(-sin(yaw),-cos(yaw))`, `right=(cos(yaw),-sin(yaw))` —
the correct pair for a camera using `rotation.set(pitch, yaw, 0, 'YXZ')`.
No longer an open issue.

## 2. Radio tower texture looks worse than the reference
NOT a porting error — checked `createProceduralTexture`'s params
(canvas size, density values, repeat) against `radio.html` byte-for-byte;
they match exactly. The actual cause: this session disabled
`renderer.shadowMap.enabled` entirely (previous turn, to fix reported
lag). The tower's strut/platform geometry was built with
`castShadow`/`receiveShadow` specifically so its rust/steel textures
would read with real depth and grime in the shadowed crevices between
lattice struts — with shadows off globally, all of that geometry reads
flatter, which is what's showing up as "texture looks less than
original" even though the texture data itself is unchanged.

This is a genuine tradeoff (fps vs. tower fidelity), not a bug. Options,
not yet decided:
- Leave shadows off globally (current state) — tower stays flatter.
- Re-enable shadows ONLY for the tower's own light-casting needs via a
  second small-frustum shadow-casting light scoped just to the tower
  (cheap since it's one static structure, not the whole scene) — matches
  the "compromise, don't just re-enable everything" approach used
  earlier for the sun/moon shadow camera sizing.
- Accept the flatter look as the perf-mode tradeoff and move on.

**Needs a decision from you before implementing.**

## 3. No in-gameplay settings menu
Real gap, not yet touched this session. The old modular project's
`index.html` markup for the pause menu / settings tabs
(`core/input.js`, `core/save-system.js`, `core/quality.js`,
`core/view-mode.js`) was never ported into this rebuild — `main.js`
only wires the title screen's "Remember" button. Right now there's no
Escape-to-pause, no in-game settings access, no quality/view-mode
toggle, no save system at all.

This is the single biggest remaining piece of unported functionality
from the old project. Scope, roughly:
- `core/input.js` — Escape key -> pause menu open/close, pointer-lock
  release/reacquire on pause
- Wiring index.html's already-present (but currently non-functional)
  pause panel markup to actual state (FOV, sensitivity, quality preset,
  view mode, volume sliders)
- `core/save-system.js` if you want settings/progress to persist across
  sessions (localStorage), vs. just in-session settings that reset on
  reload

**Not started. Needs explicit go-ahead and, given the size, will take a
dedicated pass rather than a quick fix alongside other bugs.**

## Also flagged, unresolved
- Shadow mapping is globally off (see #2) — real fps win, real visual
  cost across every shadow-cast-dependent surface, not just the tower
  (grass root shading, rock crevices, forest canopy gaps all lose some
  depth too).
- No collision beyond the `state.colliders` array being populated by
  pine-trees.js/forest.js — nothing currently reads it, so you can walk
  through tree trunks.
- No swim/jump state on the player controller (placeholder, flagged when
  first written).

## 4. Island/beach + culling/LOD pass — DONE this session
`terrain.js`'s heightfield ran edge-to-edge across the full 800x800
plane before this — no coastline, land everywhere, the ocean plane just
sat around/under it. Fixed:
- Radial falloff in `getElevation()`: land holds full height inside
  ~220u of center, blends to a real seabed trench (`waterLevel - 16`) by
  ~370u. Actual island now, not a heightfield that happens to have water
  nearby.
- Sand/wet-sand band added to the terrain fragment shader, slope-gated
  so cliffs stay cliffs and only gentle shoreline reads as beach.

Culling: before this, only `forest.js` had real LOD (billboard imposter
swap past 150u). Everything else — grass especially — had zero
effective frustum culling: one `InstancedMesh` spanning the whole map
has one bounding sphere covering every instance, so it's never culled
regardless of camera angle. Rocks (90 individual meshes) and pine trees
(per-tree meshes) already cull fine on their own — small object count,
tight per-object bounds — left alone.

Built `core/chunks.js` — splits a scattered instanced field into a grid,
each chunk gets its own real bounding sphere (frustum-cullable) and gets
hidden outright past a draw distance. Wired into the *old* grass system
before it was replaced (see #5) — kept in the codebase since
rocks/foliage could use the same treatment later if they get heavier.

True occlusion culling (hiding geometry blocked by nearer geometry) was
evaluated and skipped on purpose — Three.js has no native GPU occlusion
query path, and a hand-rolled version isn't worth the complexity next to
what frustum + distance culling already buys.

## 5. Grass replaced with the GhibliGrass technique — DONE this session
User linked a reference (Peter Adams' `ghibli-grass` /
medium.com/antaeus-ar "Making Grass with Triangles in GLSL using
Three.js") and the actual source zip. Old grass (scattered 400k-instance
field, then chunked per #4) replaced entirely with a straight port of
that technique in `environment/grass.js`:
- Fixed pool of 120,000 blade "slots" whose world XZ is
  `mod(origin - playerPos, patchSize)` — a sliding window that tiles
  infinitely around the player instead of scattering across a fixed
  radius. No pop-in, no per-frame regeneration, no scatter-radius edge.
- Height comes from a heightmap texture baked directly from this
  project's own `getElevation()` (`core/procedural-textures.js`,
  `bakeHeightMapTexture()`) — pixel-exact against the real terrain, no
  separate Blender export/asset step like the reference used. Same file
  also bakes a smooth value-noise texture (wind/height variation, stands
  in for the reference's curl-noise) and a mottled green diffuse
  texture.
- One structural adaptation: the reference parents the grass mesh to a
  player rig `Object3D` and lets `modelMatrix` add the player position
  for free. This project has no such rig (`main.js` moves
  `state.camera` directly) — mesh sits in the scene at identity, and the
  shader adds `uPlayerPosition` into the transformed position itself
  instead (see comments at the top of `grass.js`).
- One addition beyond the reference: a shoreline fade so grass doesn't
  grow across the new beach/underwater band from #4.

`state.grassMesh`/`state.grassMat` names kept the same on purpose, so
nothing else in the project needed touching. `core/chunks.js` is no
longer used by grass (a small fixed-size patch has nothing worth
frustum-culling) but is kept in the codebase for rocks/foliage if they
need it later.

## 6. Rain replaced with a point-sprite system — DONE this session
User linked another reference + source zip (Peter Adams' `rain-demo`,
rain-demo.vercel.app). Old rain (instanced billboard quads with
hand-built cylindrical camera-facing alignment) replaced with the
reference's actual technique in `environment/rain.js`:
- GPU point sprites (`gl.POINTS`), not instanced quads — Y wraps via
  `mod()` in the vertex shader so a small fixed drop pool loops through
  a vertical band forever, no respawn logic needed. Point size
  attenuates with distance; the drop texture's UV squashes horizontally
  as the camera tilts up/down so looking down doesn't read as long
  streaks.
- The actual `rainDrop.png` from the reference's assets is now in
  `environment/textures/rainDrop.png` and loaded from there.
- Adaptation: reference parents the rain group to a player rig; this
  project has none, so `updateRain()` copies `state.camera.position`
  onto the rain mesh every frame instead — same effect.
- Kept from the previous implementation (the reference has no water, so
  there was nothing to port for this): the water-level discard/fade —
  now reading world Y off `modelMatrix[3].y` plus the wrapped local Y,
  cheaper than a separate synced uniform — and the lake-surface splash
  ring system (`createRainSplashes()`), untouched.

`state.currentRainIntensity` still drives visibility/opacity the same
way it did before; nothing else in the project needed to change.

## 7. Bush/undergrowth layer added — DONE this session
User provided a standalone `FoliageSystem` module (procedural branch +
leaf-clump generator with wind-shader injection). As given it was
tree-canopy scale (150k leaves, 2500 full trees, flat `y=0` ground) —
would have duplicated what `forest.js`/`pine-trees.js` already do rather
than adding an undergrowth layer. Adapted into `environment/bushes.js`:
- Leaf count 150k -> 45k, clump count 2500 -> 700, branch recursion
  depth 2 -> 1, clump height range 12 -> ~1.2-3.5 — shrub-sized, not
  tree-sized.
- Every placement now goes through this project's `getElevation(x, z,
  state)` instead of assuming flat ground, and skips the beach/
  underwater band from #4.
- New second placement pass seeds small extra clumps directly around
  existing `state.colliders` entries (populated by
  `forest.js`/`pine-trees.js`) — bushes actually cluster around the
  trees that are already there, not just scattered independently over
  the island.

Wind shader injection, leaf geometry/bend, color-variation logic, and
the branch `LineSegments` rendering are otherwise unchanged from the
source module. Wired into `main.js`: `createBushes(state)` runs after
the forest/pine pass (so colliders exist to seed around) and before
rocks; `updateBushes(state, ts)` added to the animate loop.

## 2. Radio tower shadow tradeoff — DECIDED this session
Went with "accept the flatter look as the perf-mode tradeoff" — the
zero-code option. Shadow mapping stays globally off
(`renderer.shadowMap.enabled = false` in `main.js`); the tower's texture
data was always correct, only its shadowed depth reads flatter. Not
revisiting unless the fps budget changes enough to afford shadows again.

## 3. In-gameplay settings menu — WIRED this session
Built `core/input.js`, `core/save-system.js`, `core/quality.js`,
`core/view-mode.js` and wired all four into `main.js`. What's real:
- Escape-to-pause with pointer-lock release/reacquire, player movement
  frozen while paused (not just new input ignored — held keys stop too).
- FOV, mouse sensitivity, invert-Y, tree draw distance, and fog density
  are genuinely LIVE — no reload needed. Draw distance required a small
  `environment/forest.js` patch (LOD shader uniforms now pushed onto
  `state.lodUniforms` at build time) and a new `state.lodUniforms` array
  in `core/world-state.js`.
- Quality preset and view mode are RELOAD-tier by design (persist +
  `location.reload()`) — matches index.html's own "(applies on reload)"
  labels, since grass/tree/rock counts are baked in at generation time,
  not live uniforms.
- Export/Import save (title screen) and Export save (pause) work against
  the real settings blob; autosave runs every 30s and flashes the
  existing `#autosave-indicator`.
- Title screen's Settings/Credits panels, Regain button visibility, and
  the Quit "farewell" flourish are wired too — `setupInput(state)` runs
  immediately on load, before the title screen's own "Remember" click,
  not gated behind engine start.

Honestly stubbed, not faked — persisted correctly but nothing downstream
reads them yet:
- Rock detail toggle (`environment/rocks.js` has no detail param).
- Top-down view mode (no top-down camera/controller exists at all).
- Keybind "Reset to Defaults" (keys aren't remappable in the first place).
- Audio volume sliders (no Howler/audio system exists anywhere yet).
- Modifiers tab (wave height/speed, storm reactivity) — `water.js` has no
  exported modifier hook to wire against; left completely untouched this
  session, unlike the others above which at least persist a value.

## Collision (trees, rocks) — WIRED this session
`state.colliders` was populated (forest.js/pine-trees.js) but nothing read
it. Now:
- `environment/rocks.js` pushes its own `{x, z, r}` entries too — rocks
  were the one placement pass that didn't contribute to `state.colliders`
  at all before this.
- `main.js` gained `resolveColliderPush(state)`: simple circle-vs-circle
  push-out, run against every collider (not just the nearest) so standing
  between two trees resolves against both instead of tunneling through
  the second after the first push. Runs after XZ movement, before the
  ground-height snap and camera update, each frame.
- XZ-only, ignores Y — matches the colliders' own shape (ground-level,
  no height data) and is fine given there's still no jump, so nothing can
  currently get above a trunk/rock to test vertical cases anyway.
- Bush clumps (environment/bushes.js) still aren't collidable — flagged
  again below, unchanged.

## Mobile / touch — WIRED this session
Built `core/touch-controls.js` and hooked it into `main.js`. What's real:
- `setupPlayerController()` now exposes `state.move` (the same booleans
  the WASD keydown/keyup listeners already set) and `state._applyLook`
  (the same yaw/pitch function the mousemove listener calls) instead of
  keeping both as private closures — the only change `main.js` needed to
  support a second input method without a parallel movement system.
- Joystick (bottom-left): drag toggles `state.move`'s booleans by screen-
  space quadrant (not world-space — same as WASD, relative to camera
  facing); pushing past ~75% of the joystick's radius sets `run`, same
  hold-to-run feel as Shift. Deadzone so a stationary thumb doesn't drift.
- Look-drag zone (right two-thirds of screen): calls `state._applyLook`
  directly, so sensitivity/invert-Y from Settings > Camera apply
  identically to mouse and touch — one math path, not two.
- Sprint/Interact buttons wired to the same `state.move.run` and
  `attemptRecruitInteraction(state)` the keyboard uses. Pause button was
  already wired (`core/input.js`'s `setupPauseMenu`), not duplicated.
- Shown via touch-capability detection (`ontouchstart`/`maxTouchPoints`)
  OR the existing `forceTouchControls` setting — both already read
  correctly on the reload that toggling that setting triggers.
- Canvas click no longer requests pointer lock when touch controls are
  active (most mobile browsers handle Pointer Lock poorly or not at all).
- Added `.touch-active` CSS (index.html): hides the crosshair and the
  keyboard-only "ESC TO PAUSE" hint, shrinks/repositions the HUD, and
  moves the interact/boundary-message prompts up so they clear the
  joystick's footprint.

Stubbed, not faked: `touch-rest-btn` (and the HUD's "HOLD 'R' TO REST"
hint) still do nothing — there is no rest mechanic anywhere in this
rebuild, no `KeyR` listener in `main.js` for it to mirror. Left inert
rather than wired to a handler that doesn't do anything real.

Not touched this session: broader responsive layout beyond the
`.touch-active` rules above and one `pause-panel` padding tweak at
≤640px — title menu, credits panel, and settings-tab layout at very
narrow/short viewports (e.g. landscape phone) haven't been audited.

## Still open, unchanged by this session
- Modifiers tab (wave height/speed, storm reactivity) — needs a `water.js`
  hook before it can be wired at all, even at the stub level.
- Rock detail / top-down mode / keybind remapping / audio — need their
  underlying systems built before their already-wired settings do anything.
- Rest mechanic (`touch-rest-btn`, "HOLD 'R' TO REST" HUD hint) — no
  implementation anywhere, keyboard or touch.
- Bush clumps have no colliders (bushes.js's own placements never push to
  `state.colliders`).
- No swim/jump state on the player controller.
- Full responsive audit beyond the touch-control layout fixes above —
  narrow/short viewport layout for title menu, credits, and settings tabs
  hasn't been checked.
