// Act I Scene 1-2 wiring — THE_HEARTH_ENTIRE_STORY_AND_SETTINGS_PLAN.md's
// "WAKING" beat: player comes to on the shore, a dog appears, leads them
// toward the Ruined Cabin. Unverified (no WebGL here, never rendered) —
// reasoning only, same as every other new module this session.
//
// What this file actually builds, honestly:
//   - Two placeholder narrative props near the spawn point (a scrap of
//     cloth, a half-buried stick) — reused the EXISTING POI interact
//     system (environment/pois.js's updatePOIInteraction) rather than
//     building a second parallel prompt/caption system, since that system
//     already does everything these two props need (proximity prompt,
//     typewriter caption, one-time discovery tracking). Flagged
//     `narrative: true` so pois.js's journal/toast code (which already
//     filters on that flag — see journal.js's renderObjectives) keeps
//     them out of the "X of 9 places found" landmark count.
//   - The dog (environment/npc-dog.js), wired to the HUD objective line
//     and the narrative toast/bark sound.
//
// NOT built here (next slice, not this one): Scene 2's actual cabin-
// interior clue props (wall scratches, a toy, a bowl). This module only
// carries the player as far as the cabin's doorstep.
import * as THREE from 'three';
import { state } from '../core/state.js';
import { heightAt as getElevation } from '../core/heightmap.js';
import { showNarrativeToast } from '../core/journal.js';
import { createShoreDog, updateShoreDog } from './npc-dog.js';

let objectiveEl = null;

function setObjective(text) {
    if (!objectiveEl) objectiveEl = document.getElementById('hud-objective');
    if (!objectiveEl) return;
    objectiveEl.textContent = text;
    objectiveEl.classList.remove('hidden');
}

function buildClothProp(x, z) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9c8a6b, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6, 2, 2), mat);
    cloth.rotation.x = -Math.PI / 2 + 0.15;
    cloth.rotation.z = 0.6;
    cloth.position.y = 0.04;
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    group.add(cloth);
    group.position.set(x, getElevation(x, z), z);
    return group;
}

function buildStickProp(x, z) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a4328, roughness: 0.9, flatShading: true });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.3, 5), mat);
    stick.rotation.z = Math.PI / 2.4;
    stick.rotation.y = 0.4;
    stick.position.y = 0.08;
    stick.castShadow = true;
    stick.receiveShadow = true;
    group.add(stick);
    group.position.set(x, getElevation(x, z), z);
    return group;
}

// Returns the two narrative POI-shaped entries so main.js can splice them
// into pois.js's POIS array (see that file's header comment for why they
// live there instead of a second system) and have them picked up by the
// existing build loop/interact loop with zero changes to either.
export function createShoreNarrativeProps(spawnX, spawnZ) {
    const clothX = spawnX - 4, clothZ = spawnZ + 5;
    const stickX = spawnX + 3, stickZ = spawnZ - 6;
    return [
        {
            id: 'shore_cloth', name: 'A Familiar Cloth', x: clothX, z: clothZ, radius: 2.5,
            narrative: true,
            desc: "A scrap of cloth, half-buried in the sand. The weave feels like it should mean something, but the memory won't surface.",
            build: (x, y, z) => { const g = buildClothProp(x, z); state.scene.add(g); return g; },
        },
        {
            id: 'shore_stick', name: 'A Worn Stick', x: stickX, z: stickZ, radius: 2.5,
            narrative: true,
            desc: "A stick, smoothed by handling rather than the tide. Something used it to dig, or to play.",
            build: (x, y, z) => { const g = buildStickProp(x, z); state.scene.add(g); return g; },
        },
    ];
}

export function initShoreDog(spawnX, spawnZ, cabinX, cabinZ) {
    createShoreDog(spawnX, spawnZ, cabinX, cabinZ, {
        onObjectiveChange: (text) => { setObjective(text); showNarrativeToast(text); },
        onBark: () => { if (state.dogBarkAudio) state.dogBarkAudio.play(); },
    });
}

export function updateShoreScene(delta) {
    if (!state.player) return;
    updateShoreDog(delta, state.player.position);
}
