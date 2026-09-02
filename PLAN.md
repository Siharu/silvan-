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
