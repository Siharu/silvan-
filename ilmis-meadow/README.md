# Silvan — Map 3: Ilmis Meadow

Standalone map (each Silvan map is its own game). Open `ilmis-meadow/index.html` from any static
server — e.g. `cd ilmis-meadow && python3 -m http.server 4180`. No build step; three.js r128 is
vendored in `vendor/` so it works offline.

## What's here
| file | role |
|---|---|
| `planet.js` | The original LIMINAL planet engine (1,188 km radius, biomes, chunked terrain, Ghibli grass, weather, cottage valley). Patched only with `Game.*` hooks (pause/lock, sensitivity, grass density, per-frame update). |
| `game.js` | Game shell: title / loading / pause menu (Journal · Settings · Controls), save + continue (localStorage), settings, procedural audio (wind, water, rain, crickets, birds, pad, 88.7 FM static, dialogue blip), interaction prompt, journal, touch E button. |
| `dialogue.js` | Port of Hearth's `core/dialogue.js` — typewriter, speaker, choices (tap / 1-9 / W-S + E), freeze-on-choice, auto-close, text speed + size + reduce-motion settings. Same `show(lines, onComplete, opts)` shape. |
| `content.js` | World content: 11 valley landmarks, Tuuli (fox) and Marren (heron) with branching dialogue, resting spots, the Stillstone network (cottage stone + 7 stones in the other biomes, fast travel via dialogue choices), self-lighting lanterns, glowing Ring, a scarecrow that only moves when unwatched. |

## Systems ported from Hearth
dialogue system · pause/settings menu · journal with discovery count + toast · autosave (45 s, on discovery, on tab hide) ·
loading screen with staged progress · touch controls + phone layout · reduce-motion · day/night cycle (length is a setting) ·
resting (time skip) · proximity interact prompt.

## Not ported (on purpose)
Hearth's Vite modules, Howler asset audio, keybind remapping, quality tiers (Ilmis has a pixel-size + grass-density setting instead),
and the radial world boundary (the world is a closed sphere).

## Testing notes
Headless Chromium (SwiftShader) at 1100x650, 412x780 touch, 780x360 touch: title → load → play, every POI interaction, fast travel,
Esc pause (time freezes), save → reload → Continue restores position/flags/discoveries, night views. Zero page errors.
Not tested: real phone feel/FPS, real audio output (synth is written but only checked for not throwing), real GPU performance.
