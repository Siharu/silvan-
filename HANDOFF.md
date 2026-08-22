# Silvan — Session Handoff

Covers: water rewrite (lake + ocean), rock geometry fix, sun-ray fix, title
screen import. Read this before touching any of the files below — several
of these changes fix real bugs from *before* this session, not just style
passes, and the "why" matters for not reintroducing them.

---

## 1. Lake water — `environment/lake.js`

**Full rewrite.** Was `MeshStandardMaterial` + `onBeforeCompile`, patching
color/normal logic on top of three's PBR pipeline. That pipeline mutes
everything through scene ambient/tone-mapping, which is why the water read
as flat and "underwater-murky" no matter what colors were set. Converted to
a genuine `THREE.ShaderMaterial` with fully self-contained lighting — ported
from `ocean-water.html` (a reference demo), adapted to fit our geometry:

- **Real Gerstner waves** (not a sine-slope approximation): 3 stacked waves
  with analytic tangent/binormal-derived normals, defined in `uWaves`
  uniform (dirX, dirY, steepness, wavelength). Wavelengths (120/70/44) are
  rescaled up from the demo's 20/10/5/2 — the demo's plane was 200 units /
  256 segments (~0.78-unit vertex spacing); ours is 1150 units / 56
  segments (~20.5-unit spacing). Anything under ~41 units aliases into
  jagged noise on our sparser grid. The demo's 4th high-freq wave (2 units)
  was dropped entirely — even rescaled it's below the aliasing floor; the
  chop layer covers that frequency band instead.
- **Chop layer** feeds into the same tangent/binormal as the Gerstner waves
  (not a separate normal mixed in after) — one coherent final normal.
- **Blinn-Phong diffuse + specular** against sun and moon directions, real
  fresnel-to-sky mix. Steepness/speed/chop all scale with `uStormIntensity`
  (same value driving rain/wind audio — storms and rough water are the same
  weather event, not independent knobs).
- **Depth-graded shoreline** via a real `aDepth` vertex attribute sampled
  from `terrain.js`'s `getElevation()` at build time — not a fake elevation
  gradient, follows the actual basin shape.
- **Crest foam + shore foam + whitecaps**, plus rain ripple rings (tiled
  concentric expanding rings, perturbing the normal).
- **Fog**: raw `ShaderMaterial` does NOT get `fogColor`/`fogDensity` merged
  into its uniforms automatically the way `MeshStandardMaterial` does. This
  caused a hard crash (`Cannot read properties of undefined (reading
  'value')` in `refreshFogUniforms`) the first time this shipped — three's
  fog refresh writes into whatever's already in `material.uniforms`, and
  those keys didn't exist. **Fixed by declaring both uniforms explicitly**
  plus `defines: { FOG_EXP2: '' }` to match `main.js`'s `THREE.FogExp2` (not
  the linear `THREE.Fog` variant — using the wrong define here means fog
  silently does nothing, not a crash, so it's an easy miss).
- **Traded away**: shadow receiving on the water surface. A raw
  `ShaderMaterial` doesn't get this for free — would need the shadowmap
  GLSL chunks wired in manually. Not currently worth the lift; water
  receiving shadow dapple wasn't doing much visible work under this
  shading model.
- `day-night-cycle.js` reads sun/moon/storm uniforms via
  `state.waterMaterial.userData.shader.uniforms` — written for the old
  `onBeforeCompile` pattern where the real shader only existed inside
  `userData` post-compile. Kept working unmodified via a self-reference:
  `state.waterMaterial.userData.shader = state.waterMaterial`.

## 2. Ocean (world-border vista) — `environment/ocean.js`

**Full rewrite, same fix as the lake.** This file already *was* the
Vanishing-of-Ethan-Carter "vast sea beyond the coastline" system — its own
header comments say so — but was still running through
`MeshStandardMaterial`, same muting problem as the old lake. Converted to
`ShaderMaterial` with the same Blinn-Phong + fresnel lighting model as the
lake, simplified (no per-vertex depth attribute — not visible at this
distance, and no Gerstner — a far hazy backdrop doesn't need real wave
physics, the two-sine swell is sufficient and cheaper).

**Critical piece preserved exactly**: `fx/dynamic-fog.js`'s
`addDynamicFog()` call, which patches in a *per-pixel background-texture*
fog blend so the ocean's horizon melts into the actual live sky/mountain
color on screen, instead of hard-cutting to a flat fog color. This is the
single biggest thing that sells "endless sea" over "big blue floor with an
edge" — if this material is ever touched again, do not drop the
`addDynamicFog(state.oceanMaterial, state.backgroundRenderTarget.texture)`
call or its required `#include <fog_vertex>` / `#include
<clipping_planes_pars_fragment>` / `#include <fog_fragment>` markers in the
shader text (that function string-patches those markers at compile time; it
doesn't care what material produced the shader, but the markers must be
literally present).

Same `fogColor`/`fogDensity`/`FOG_EXP2` fix as the lake applies here too —
copy this file's uniform block if writing a third custom water material.

Punched up `uDeepColor`/`uHorizonColor` defaults to be less murky than the
old PBR-muted look, closer to a real open-water vista.

## 3. Rock geometry — `environment/rocks.js`

**Two real bugs found and fixed, not a style pass.**

**Bug 1 — face count math.** A prior session bumped
`IcosahedronGeometry(1, detail)` from detail 3 to 4 believing that reached
"~5,120 faces." The actual formula is `20 * detail²`, verified directly
against three.js (not assumed): detail 4 is only **500 triangles**. At the
biggest rocks' ~5.5x base-radius scale, up close, 500 faces reads as flat
geometric panels rather than stone — especially on `flatShaded` types
(basalt, slate) where every face is a hard-edged panel with no normal
blending to hide it.

**Fix, and why it's not just "set detail to max":** the reference
`rock.html` demo's detail slider (5–100) edits **one live rock**. We render
**~1,100 instances** via `InstancedMesh`. Instancing shares the geometry
*buffer* in VRAM, but the GPU still rasterizes every triangle for every
instance separately at render time — triangle throughput scales with
instance count regardless of instancing. Detail 100 (204,020 tris/rock) ×
~1,100 instances ≈ **224 million triangles/frame** for rocks alone, before
grass (1.1M blade instances), trees, or anything else. That's not a
tradeoff, it would tank the frame rate outright.

Current fix, split by shading type (each `ROCK_TYPES` entry now has its own
`detail` field) — following the demo's own noted tradeoff ("if flat
shading, lower detail looks better; if smooth, higher detail is needed":
pouring detail into flat-shaded facets past a point just makes them
expensively *look* smooth, defeating the point):
- Flat-shaded (basalt, slate): detail **12** → 3,380 tris/rock
- Smooth (granite, sandstone, redrock, limestone): detail **16** → 5,780
  tris/rock
- Total across the field: **~5.5M triangles/frame** — a real ~3x jump from
  the previous flat-detail-8 fix (1.8M) without an unreasonable budget.

**If it's still visibly panel-y after this**, the next lever isn't more
global detail — check whether it's specifically the largest rocks (`s = 1.0
+ Math.random() * 4.5` lets an instance hit ~5.5x base radius). Options:
cap max scale, or give oversized instances their own higher-detail variant
rather than raising the field-wide baseline again.

**Bug 2 — JS `%` vs GLSL `fract()`.** The per-vertex jitter used
`((Math.sin(jitterSeed) * 43758.5453) % 1)` ported from a GLSL hash. JS's
`%` returns a negative result for a negative operand (e.g. `-30000.4 % 1 ===
-0.4`), while GLSL's `fract()` is always positive `[0, 1)`. This skewed the
jitter asymmetrically instead of centering on 1.0. Fixed by folding negative
results back into `[0, 1)` before use. Worth grepping for this exact pattern
(`... % 1` on a `Math.sin(...) * big number` expression) anywhere else GLSL
hash functions were ported to JS in this codebase — it's an easy, silent
miss.

## 4. Sun-ray sprite — `fx/textures.js` + `atmosphere/day-night-cycle.js`

**Bug, not a style pass.** The sun-ray burst texture drew wedges around a
**full 360° circle** from a point — randomized width/reach/gaps per beam
(an earlier session's attempt at fixing this), but the *silhouette* — an
even ring of spokes around a point — is inherently the "generic clipart
sunburst icon" look, no matter how uneven the individual spokes are.
Randomizing spoke width doesn't change that; the full-circle wrap is the
actual problem.

**Why real light doesn't look like that:** crepuscular rays don't radiate
outward in all directions from their source. They're near-parallel beams
fanning in one general direction (down, toward the viewer), which only
*appear* to diverge from a point due to perspective foreshortening — same
reason parallel train tracks look like they meet at a vanishing point.

**Fix**: restricted the beam-generation loop in `fx/textures.js` to a
~109° arc (`fanSpread = 0.95` radians each side of straight-down) instead
of the full `2π`. Also: longer/thinner beams, softer multi-stop gradient
falloff (previous 3-stop gradient had a visible hard cutoff at the beam's
far edge from the circular arc; now fades to nothing well before that edge
is reached).

**Downstream consequence, also fixed**: `day-night-cycle.js` used to spin
the ray sprite's `material.rotation` continuously
(`+= delta * 0.00004`) for a "living" feel — harmless on the old symmetric
ring (rotating a circle looks the same at any angle), but would visibly
carry a *directional* fan sideways and upside-down over a single day/night
cycle. Replaced with a small `Math.sin`-based sway that never drifts the
fan's general orientation away from "toward the viewer."

Verified by literally rendering the canvas texture locally (node + the
`canvas` package) before shipping rather than guessing at the shape from
code alone — worth doing again for any further canvas-texture tweaks in
this file, it caught the fix actually working before it ever hit the
browser.

## 5. Title screen — `index.html` + `core/input.js`

Reskinned using `titlescreenn.html`'s menu UI/UX (Cinzel + Cormorant
Garamond fonts, vertical menu-item list with hover glow + italic subtext)
while **keeping the existing live-3D scene background** — this was not a
full replacement, the uploaded demo's own procedural-forest/audio/camera
system was explicitly not ported in.

Menu items map to what Silvan actually has, chosen to avoid a button that
lies about what it does (there's no save/reset system, so a fake "New
Game" vs "Continue" split would've been dishonest UX):

- **Remember** — always visible. First-ever click is the genuine entry.
  Once `state.hasStartedGame` is true, clicking it again does `location.
  reload()` for a truly fresh session, rather than silently just resuming
  (which is what "Regain" is for).
- **Regain** — only rendered once `state.hasStartedGame` is true (toggled
  by `refreshTitleMenuState()` in `core/input.js`, called both on the
  `pointerlockchange` unlock path and the pause menu's "Quit to Title"
  path — both had to be updated, easy to miss one). Resumes exactly where
  the player left off; state is never torn down on quit-to-title.
- **Settings** — folds in the existing volume slider + graphics quality
  toggle (same `title-quality-high-btn`/`title-quality-low-btn` ids
  `core/input.js`'s `qualityButtonPairs` array already expected — kept
  those ids unchanged specifically so that wiring didn't need touching).
- **Credits** — static Cygnus Signal Series / Silvan — Map 1 text.
- **Return to your world** (Quit) — a non-destructive "Farewell" fade.
  Does *not* actually try to close the tab (unreliable outside a
  script-opened window) — fades back to the title after ~3.2s so clicking
  it out of curiosity doesn't soft-lock the page.

Dead CSS cleanup: removed the now-unused `.start-btn` fallback rules, but
had to be careful not to also delete the adjacent `#ui-layer h1/h2/p`
Tailwind-CDN-fallback rules in the same block — those still style the
title/subtitle/description text and needed to stay.

## 6. Rock/water modifiers — `core/modifiers.js` (new)

**New system, not a fix.** Exposes the `rock.html`/`ocean-water.html`-style
tuning knobs inside the actual Settings panel instead of leaving them as
hardcoded constants in `rocks.js`/`lake.js`/`ocean.js`. Mirrors `core/
quality.js`'s existing storage/apply pattern rather than inventing a new
one — same localStorage-namespace-plus-defaults shape.

**Water modifiers apply live** — `waterWaveHeight`, `waterWaveSpeed`,
`waterStormReactivity` are just uniform multipliers
(`uWaveHeightMult`/`uWaveSpeedMult`/`uStormReactivityMult`, read every frame
in both the lake's and ocean's vertex shaders), so a slider writes straight
into `state.waterMaterial.uniforms`/`state.oceanMaterial.uniforms` with zero
rebuild cost. `uStormReactivityMult` scales only the `* uStormIntensity`
storm terms specifically, independent of the base height/speed multipliers
— lets a player have big calm swells or small wild ones instead of one
uniform knob controlling both axes.

**Rock modifiers do NOT apply live** — `rockDetail` (`'low'`/`'med'`/`'high'`,
mapped through `ROCK_DETAIL_PRESETS`) and `rockRoughness` (multiplies
`noiseScale` + `disp` together) are baked into `InstancedMesh` geometry at
creation time in `rocks.js`'s `buildRockVariant()`, not read per-frame.
Follows the exact same "persist + `location.reload()`" pattern `quality.js`
already uses for grass/tree/rock counts — deliberately not building a
one-off live-rebuild path that disposes/reconstructs six `InstancedMesh`
geometries just for this.

`ROCK_DETAIL_PRESETS` triangle costs, computed the same way as the earlier
rock-detail fix (§3) — checked against the ~1,100-instance render budget
before picking numbers, not guessed:
- `low`: 2,420 / 1,620 tris (smooth/flat) → ~2.4M tris/frame total
- `med`: 5,780 / 3,380 tris → ~5.5M tris/frame (previous fixed default)
- `high`: 10,580 / 5,780 tris → ~9.9M tris/frame

`high` intentionally stops well short of the reference demo's max detail
(100), which alone would be ~224M tris/frame at this instance count — see
§3 and the "Standing gotchas" section below for why.

**Bug caught before shipping, worth knowing about if touching this file
again**: `buildRockVariant()` originally declared a local `const disp` for
the modifier-scaled displacement amount, but the per-vertex loop *inside*
that function already declares its own `const disp` (the per-vertex radius
scale factor, a completely different value) in a nested block scope. That
shadows the outer one silently — no error, but the modifier value would
never actually reach the calculation. Renamed the outer one to `dispAmount`
to avoid the collision. If this function is edited again, keep those two
names distinct.

`main.js` resolves `state.modifiers = getModifiers()` right after
`state.quality = resolveQualityPreset()`, before any of `createLake`/
`createOcean`/`createRocks` run — same position/order `quality` uses, for
the same reason (everything downstream reads it at creation time).

**Wiring**: `index.html` adds a "Modifiers" fold-out inside the Settings
panel (same collapsed-by-default toggle pattern as the "Help" fold-out —
see §5), with the three water sliders, a Low/Med/High rock-detail row
(reusing `.quality-toggle-btn` styling), a rock-roughness slider, and a
"Reset to defaults" button. `core/input.js` wires it: water sliders fire on
`input` (live, every drag tick); rock detail buttons and the rock-roughness
slider fire on click/`change` respectively (not `input` — that one reloads
the page, so it must only fire once the player has actually committed to a
value, not on every intermediate tick while dragging).

## 7. Top-down view mode — `core/view-mode.js` (new), `core/player-controller.js`, `core/input.js`, `main.js`

**New system, built as "Option A" from scoping**: the same 3D scene/
terrain/InstancedMesh work already in place, viewed through a fixed
overhead camera instead of mouse-look, rather than a genuinely separate
lightweight asset pipeline (the bigger DRIFTER-style rebuild that was the
other option discussed). Chose this specifically because it reuses
everything already built instead of duplicating it — flag clearly if the
bigger rebuild turns out to be what's actually wanted after trying this;
`core/view-mode.js` is kept small/isolated so it doesn't block that later.

**Storage/apply pattern**: identical to `quality.js`/`modifiers.js` —
localStorage + `location.reload()`, since view mode changes which camera
type gets built and forces the quality preset in `main.js`'s `init()`,
neither of which this codebase tears down and rebuilds live.

**Forced quality**: `main.js` sets `state.quality = QUALITY_PRESETS.low`
outright when `state.viewMode === 'topdown'`, overriding whatever the
player separately chose in the Graphics toggle — reuses the existing `low`
preset object rather than defining a new "potato" tier, so there's exactly
one place that defines "cheap." Top-down mode is specifically *for*
low-end hardware; it wouldn't make sense to let a manual Graphics: High
choice silently defeat that.

**Camera**: still a `THREE.PerspectiveCamera` in both modes (not a true
orthographic one) — narrower FOV in top-down (50° vs 75°, less fisheye
distortion at a steep downward pitch), positioned as a fixed-angle "chase
rig" that follows `player.position.x/z` via `camera.lookAt()` rather than a
hand-built quaternion (`TOPDOWN_HEIGHT`/`TOPDOWN_BACK_OFFSET` constants in
`player-controller.js`). Deliberately **not angled a full 90° straight
down** — `environment/animals.js`'s follower-positioning code flattens
`camera.getWorldDirection()` to XZ and normalizes it; a dead-vertical
camera flattens to a near-zero-length vector there, a real NaN risk for
follower positions, not just a visual nitpick. Staying off dead-vertical
sidesteps it entirely rather than needing a guard clause downstream.

**Movement**: WASD maps to fixed world axes in top-down (`TOPDOWN_FORWARD
= (0,0,-1)`) instead of camera-relative ones, since there's no mouse-look
to derive "forward" from. Both modes still compute `right` via the exact
same `crossVectors(camera.up, dir)` call — deliberately not hand-deriving
a separate sign convention for top-down, to avoid a subtle inverted-
controls bug from getting the cross-product direction backwards by hand.

**Pointer lock**: top-down never requests it (no mouse-look needs it), so
`document.pointerLockElement` never points at the page for that mode, and
the real `pointerlockchange` listener simply never fires for it. Entry/exit
UI logic was factored out into two shared functions,
`showPlayingUI()`/`showPausedUI()`, called both by that listener
(first-person) and directly by a manual path for top-down: `enterPlayMode()`
branches on `state.viewMode`, and a dedicated `Escape` keydown listener
(guarded to only act when `state.viewMode === 'topdown'`) handles pausing,
since first-person gets that for free from the browser's native
exit-pointer-lock-on-Escape behavior and top-down has nothing to trigger
off of otherwise. If this entry/exit logic is touched again, both modes
need to keep going through these two shared functions rather than one
picking up new behavior the other doesn't mirror.

**Crosshair**: hidden outright in top-down (`showPlayingUI()` only
un-hides it in first-person) — confirmed first that recruit/tower
interactions are proximity-based (`environment/animals.js`, `radio-
tower.js`), not raycast/crosshair-driven, before doing this, so nothing
actually depends on it being visible.

**Cutscene interaction**: the radio-tower awe cutscene
(`state.cutsceneActive`, scripted via `player.rotation`) is a first-person
narrative beat — top-down's camera doesn't read `player.rotation` at all,
so `updatePlayer()`'s cutscene early-return branch now checks
`state.viewMode` and keeps the top-down rig running normally instead of
snapping to a first-person pose that wouldn't mean anything from an
overhead angle. State/position tracking still proceeds either way; only
the camera-orientation half of the cutscene is first-person-specific.

**Swim roll**: intentionally not applied in top-down (see the code
comment at the camera-update site) — it's a first-person immersion touch
(the horizon visibly tilting), and would just read as the camera rig
itself glitching from a fixed overhead angle rather than communicating
"rougher water."

**UI**: `index.html` adds an Open World / Top-Down toggle row (reusing
`.quality-toggle-btn` styling) in *both* the title screen's and the pause
menu's Settings panels — the pause-menu copy was easy to forget since the
title-screen one was built first; both need to exist and both need their
`active` state reflected in `core/input.js`'s `viewModeButtonPairs` loop,
same reasoning as why the Graphics toggle already has two copies.

## 8. Loading screen + real save system — `core/save-system.js` (new), `main.js`, `core/input.js`, `index.html`

**Two features, built together since the autosave icon needed something
real underneath it.** Before this, clicking a save-icon idea without an
actual save system would've been the same kind of dishonest UI as a fake
"New Game"/"Continue" split — a pulsing icon tied to nothing. Built the
real thing first.

### Save system (`core/save-system.js`)

Serializes: player position + yaw rotation, `gameTime`/`daysPassed`, and
which animals are currently `.following` (by name, matched back against
`state.demoAnimals` on load — the roster itself is rebuilt fresh by
`spawnDemoAnimals()` every load, only the recruited flag is restored).
Deliberately does **not** save any story/quest-completion flag, because
none currently exist in the codebase (`radio-tower.js`'s cutscene has no
"already seen" flag, it can replay every time) — not inventing one just to
have something to persist.

**Two storage paths, same serialized shape:**
- **localStorage autosave** — convenient, survives quit-to-title, wiped by
  a cache clear. Written every `AUTOSAVE_INTERVAL_MS` (30s) while
  `state.isPlaying` in `main.js`'s `animate()` loop, plus as a checkpoint
  on `pause-quit-btn` and as a `beforeunload` last-chance net.
- **Export/Import file** — a real downloaded `.json`, survives a cache
  clear or switching devices/browsers. Built as the primary "portable
  save" path now, not bolted on later, specifically because it's already
  the shape a future Electron/APK build would want for real disk writes —
  swapping what's behind `exportSaveFile()`/`importSaveFile()` for actual
  filesystem calls later shouldn't require rebuilding the save shape or
  the calling code in `input.js`.

**"Regain" now sources from two different places** depending on
situation, both funneled through the same button: a live in-memory
session this tab (quit-to-title without a real reload — nothing to load,
just resume) vs. a genuinely fresh page load with a real save on disk from
a previous visit (`applySavedState()` runs before entering play). `core/
input.js`'s `refreshTitleMenuState()` now also checks `hasLocalSave()`, not
just `state.hasStartedGame` — Regain can now correctly appear on a true
fresh boot, not only after quitting within the same tab.

**Import validates before applying** — `importSaveFile()` rejects (doesn't
silently apply) anything that isn't valid JSON or is missing a `player`
field, specifically to avoid importing garbage and teleporting the player
to `(0,0,0)` with no error. Import only lives on the title screen, not the
pause menu — loading a save mid-play would silently clobber whatever the
player's doing right now, which isn't a real use case the way "export
whenever, even mid-session" is (Export exists on both).

### Loading screen

`#loading-screen` is visible **by default** in the HTML/CSS (not toggled
on) — it's the very first thing painted, before `main.js`'s `init()` runs
its long synchronous scene-construction work (terrain/grass/rocks/forest
generation, etc.), and `init()` hides it once that's done, right before
the render loop starts.

**Honest framing, not oversold**: `window.onload` now does a double-`
requestAnimationFrame` hop before calling `init()`. This guarantees the
loading screen actually gets *painted* before the blocking work starts —
without it, the browser could end up doing the paint and the freeze in the
same frame, and the loading screen would never actually be seen before
things locked up. **This does not make `init()`'s blocking synchronous
cost go away** — it's still one long call, the tab still freezes for
however long scene generation takes. The fix only guarantees that freeze
has a visible "Loading Silvan…" label first instead of risking the
default-visible title screen painting first and the freeze reading as a
hung/broken page. A real fix for the freeze itself (chunking `init()`'s
work across frames, `requestIdleCallback`, etc.) is a bigger refactor,
not attempted here.

### Autosave HUD icon

Flashes for 1.8s in the bottom-right (`#autosave-indicator`, toggled by
`main.js`'s `flashAutosaveIcon()`) **exactly when `writeLocalSave()`
actually succeeds** — not a decorative independent timer. If this is ever
touched again, keep it wired to a real write's return value, not a fixed
interval running in parallel to (and potentially out of sync with) the
actual save calls.

---



## Standing gotchas worth remembering going forward

- **Raw `THREE.ShaderMaterial` + `fog: true` needs `fogColor`/`fogDensity`
  uniforms declared explicitly**, plus the correct `defines: { FOG_EXP2: ''
  }` (or `fogNear`/`fogFar` with no define, for linear fog) matching
  whatever `scene.fog` type `main.js` actually sets. `MeshStandardMaterial`
  gets this for free; a raw `ShaderMaterial` does not, and the failure mode
  for the *wrong define* (rather than missing uniforms) is silent — fog
  just doesn't render — not a crash, so it's easy to miss in testing.
- **`InstancedMesh` shares the geometry buffer, not the render cost.**
  Bumping a shared geometry's poly count is only "free" in the sense of
  build-time cost and VRAM; the GPU still rasterizes base-geometry-tris ×
  instance-count every frame. Always multiply through before matching a
  reference demo's "max settings" — that demo almost certainly wasn't
  built with 1,100 instances in mind.
- **`THREE.PolyhedronGeometry`-family face counts follow `20 *
  detail²`for an icosahedron**, not any kind of exponential/doubling
  growth — verify against the actual three.js output
  (`geometry.attributes.position.count / 3`) rather than trusting a
  comment or memory, this was wrong once already this session.
- **JS `%` is not GLSL `fract()`** for negative operands. Any hash/noise
  function ported from GLSL to JS using `(x * bigNumber) % 1` needs the
  negative-wraparound fix (`frac < 0 ? frac + 1 : frac`) or it silently
  skews asymmetric.
