// POI registry + interact system. All 9 POIs are now ported (see
// PLAN.md's table for build notes and what was trimmed from each
// mockup). serpents_coil stays build: null on purpose — it's terrain,
// not a prop, built into environment/terrain.js's crater + magma blend.
import { state, WORLD_SIZE } from '../core/state.js';
import { getElevation } from '../core/utils.js';
import { createRuinedCabin } from './poi-ruined-cabin.js';
import { createChrysalis } from './poi-chrysalis.js';
import { createObsidianWing } from './poi-obsidian-wing.js';
import { createGreeniteMouth } from './poi-greenite-mouth.js';
import { createBrokenShell } from './poi-broken-shell.js';
import { createRadioTower, updateRadioTower } from './poi-radio-tower.js';
import { createHowlingMaw, updateHowlingMaw } from './poi-howling-maw.js';
import { createWarmPaw, updateWarmPaw } from './poi-warm-paw.js';

// the_hearth_isometric_map's mockup used a 320-unit map; this project's
// WORLD_SIZE is 800 — every POI (x, z) below is the mockup's coordinate
// times this factor (see PLAN.md's POI table for the un-scaled originals).
const SCALE = WORLD_SIZE / 320;

export const POIS = [
    { id: 'radio_tower', name: 'Radio Tower', x: 45 * SCALE, z: -60 * SCALE, radius: 10,
      desc: "A skeletal steel spire perched on an eastern ridge. Its rusty red beacon blinks continuously into the fog.",
      build: createRadioTower, update: updateRadioTower },
    { id: 'warm_paw', name: 'The Warm Paw', x: -70 * SCALE, z: -25 * SCALE, radius: 12,
      desc: "Fresh embers glow in a ring of blackened stones. Animal spirits rest here to regain their warmth before the long crossing.",
      build: createWarmPaw, update: updateWarmPaw },
    { id: 'ruined_cabin', name: 'Ruined Cabin', x: 85 * SCALE, z: 65 * SCALE, radius: 8,
      desc: "Rotting driftwood beams collapse over dark wet sands. High tides submerge the lower floor twice daily.",
      build: createRuinedCabin },
    { id: 'howling_maw', name: 'The Howling Maw', x: -35 * SCALE, z: 45 * SCALE, radius: 10,
      desc: "A jagged jaw-like fissure torn into the steep granite cliff. Freezing air cascades out of the darkness.",
      build: createHowlingMaw, update: updateHowlingMaw },
    { id: 'serpents_coil', name: "The Serpent's Coil", x: 0, z: -5 * SCALE, radius: 20,
      desc: "The catastrophic central crater. A terrifying threshold where the earth pulses with crimson magma for only the bravest spirits.",
      build: null }, // already terrain — see environment/terrain.js's crater + magma blend, not a prop to place here
    { id: 'broken_shell', name: 'The Broken Shell', x: -95 * SCALE, z: 80 * SCALE, radius: 12,
      desc: "A rusted vessel swallowed by the sea, its metal hull echoing with the deep-water laments of forgotten beasts.",
      build: createBrokenShell },
    { id: 'chrysalis', name: 'The Chrysalis', x: 90 * SCALE, z: -75 * SCALE, radius: 8,
      desc: "A concrete burrow choked by glowing moss. Spirits of the small and winged shelter safely behind its heavy doors.",
      build: createChrysalis },
    { id: 'obsidian_wing', name: 'The Obsidian Wing', x: -100 * SCALE, z: -15 * SCALE, radius: 8,
      desc: "A perfectly smooth, black stone feather jutting from the earth. Purple bioluminescence guides the flying ones home.",
      build: createObsidianWing },
    { id: 'greenite_mouth', name: 'Greenite Mouth', x: 30 * SCALE, z: 120 * SCALE, radius: 8,
      desc: "A subterranean cavern throat encrusted with glowing greenite crystal clusters. The air radiates with strange, radioactive soul-energy.",
      build: createGreeniteMouth },
];

export async function createPOIs() {
    for (const poi of POIS) {
        if (!poi.build) continue; // not yet ported — see header comment / PLAN.md
        const y = getElevation(poi.x, poi.z);
        await poi.build(poi.x, y, poi.z);
    }
}

// Per-frame hook for POIs with their own animated bits (Radio Tower's
// beacon/shack-light, Howling Maw's dread/pulse lights, Warm Paw's fire/
// embers/fireflies/lantern flame). Most POIs are static and have no
// `update`, so this is a no-op for them.
export function updatePOIs(delta) {
    for (const poi of POIS) {
        if (poi.update) poi.update(delta);
    }
}

let ePressedLastFrame = false;
let captionTimer = 0;
const INTERACT_RANGE_MARGIN = 6; // extra distance beyond each POI's own radius before the prompt appears
const CAPTION_SECONDS = 6;

// Called every frame from main.js's animate() with delta in seconds.
// Deliberately simple (proximity check + a description in the existing
// cutscene-caption box) rather than real branching dialogue — enough for
// each POI to read as content, not a placeholder for the dialogue system
// PLAN.md defers to a later phase.
export function updatePOIInteraction(delta) {
    const prompt = document.getElementById('interact-prompt');
    const caption = document.getElementById('cutscene-caption');
    const captionSpeaker = document.getElementById('cutscene-speaker');
    const captionText = document.getElementById('cutscene-text');
    if (!prompt || !caption || !state.player || !state.isPlaying) return;

    let nearest = null;
    let nearestDist = Infinity;
    for (const poi of POIS) {
        const dx = state.player.position.x - poi.x;
        const dz = state.player.position.z - poi.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const range = poi.radius + INTERACT_RANGE_MARGIN;
        if (dist < range && dist < nearestDist) {
            nearest = poi;
            nearestDist = dist;
        }
    }

    if (captionTimer > 0) {
        captionTimer -= delta;
        if (captionTimer <= 0) caption.classList.remove('visible');
    }

    if (nearest) {
        prompt.textContent = `[E] ${nearest.name}`;
        prompt.classList.add('visible');
        if (state.keys.e && !ePressedLastFrame) {
            captionSpeaker.textContent = nearest.name;
            captionText.textContent = nearest.desc;
            caption.classList.add('visible');
            captionTimer = CAPTION_SECONDS;
        }
    } else {
        prompt.classList.remove('visible');
    }
    ePressedLastFrame = state.keys.e;
}
