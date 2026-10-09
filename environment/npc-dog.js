// First Dog — Act I, Scene 1-2 of THE_HEARTH_ENTIRE_STORY_AND_SETTINGS_PLAN.md
// ("The player approaches dog... Objective Update: Follow the dog" / "Follow
// the dog through forest toward a collapsed cabin"). Unverified (no WebGL
// here, never rendered) — reasoning only.
//
// No dog model/animation asset exists in the project, so the body is a
// plain low-poly placeholder (capsule + cone ears/snout + a thin tail
// cylinder), flat-shaded and single-toned, the same honesty standard the
// audit already applied to the Serpent's Coil video card and the cave
// murals ("MURAL PLACEHOLDER" text instead of pretending finished art
// exists). This is a stand-in shape to hang the actual behavior on, not a
// finished character.
//
// State machine (doc's "NPC Behavior & State Machines" section, simplified
// to what Scene 1-2 actually needs — Reacting/Fear/Memory states from that
// section belong to later scenes, not implemented here):
//   'idle'      — wanders a small radius near the shore spawn, waiting to
//                 be approached. This is the doc's "dog appears... barks
//                 but stays at distance."
//   'greeting'  — one-time: player got close enough. Faces the player,
//                 barks, holds a moment, then starts leading.
//   'leading'   — walks toward the Ruined Cabin's coordinates (reusing
//                 pois.js's existing POI, not a new location), pausing and
//                 looking back / barking if the player falls far behind —
//                 doc: "follow... through forest" is the connective trail,
//                 not a cutscene.
//   'arrived'   — reached the cabin, sits and idles. Scene 2's actual cabin
//                 content (wall scratches, toy, bowl — see the doc's Scene
//                 2 prop list) is NOT built here; this module only carries
//                 the dog as far as the cabin's doorstep.
//
// Persisted to localStorage (one flag) so a reload after the player has
// already met the dog doesn't replay "appears at a distance, must be
// approached" every single time — it resumes at 'arrived' directly if the
// player had gotten that far, 'idle' otherwise. Mid-walk progress is not
// persisted (not worth the extra state for a one-time intro beat).
import * as THREE from 'three';
import { state } from '../core/state.js';
import { heightAt as getElevation } from '../core/heightmap.js';

const STATE_KEY = 'silvan-scene1-dog-state';
const APPROACH_RANGE = 7;      // player distance that triggers the greeting/leading transition
const CATCH_UP_RANGE = 18;     // leading resumes once player is back within this
const FAR_BEHIND_RANGE = 26;   // leading pauses (dog waits + barks) once player falls this far behind
const ARRIVE_RANGE = 12;       // distance from the cabin that counts as "arrived"
const WALK_SPEED = 3.2;        // u/s, deliberately slower than the player's own 12 so it never outruns a following player
const WANDER_RADIUS = 5;
const BARK_COOLDOWN_MS = 4000;

function buildPlaceholderDog() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85, flatShading: true });
    const furDark = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.85, flatShading: true });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.75, 2, 6), mat);
    body.rotation.z = Math.PI / 2;
    body.position.set(0, 0.42, 0);
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), mat);
    head.position.set(0.58, 0.52, 0);
    group.add(head);

    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 6), mat);
    snout.rotation.z = -Math.PI / 2;
    snout.position.set(0.82, 0.46, 0);
    group.add(snout);

    for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), furDark);
        ear.rotation.z = -Math.PI / 2.3;
        ear.position.set(0.62, 0.72, side * 0.14);
        group.add(ear);
    }

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 5), furDark);
    tail.rotation.z = Math.PI / 3.2;
    tail.position.set(-0.56, 0.58, 0);
    group.add(tail);
    group.userData.tail = tail;

    for (const [sx, sz] of [[0.25, 0.16], [0.25, -0.16], [-0.25, 0.16], [-0.25, -0.16]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 5), furDark);
        leg.position.set(sx, 0.2, sz);
        group.add(leg);
    }

    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
}

let dog = null;
let dogState = 'idle';       // 'idle' | 'greeting' | 'leading' | 'arrived'
let greetingT = 0;
let wanderTarget = new THREE.Vector3();
let wanderTimer = 0;
let lastBarkAt = -Infinity;
let cabinTarget = null;       // set by createShoreDog's caller (pois.js's ruined_cabin x/z)
let onObjectiveChange = null; // callback(text) — wired by scene-shore.js to the HUD + a narrative toast
let onBark = null;            // callback() — wired to actually play the bark sound

function loadPersistedState() {
    try { return localStorage.getItem(STATE_KEY) || 'idle'; } catch (e) { return 'idle'; }
}
function savePersistedState(s) {
    try { localStorage.setItem(STATE_KEY, s); } catch (e) { /* private mode — just won't persist */ }
}

function faceToward(obj, targetX, targetZ) {
    const dx = targetX - obj.position.x, dz = targetZ - obj.position.z;
    if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) obj.rotation.y = Math.atan2(dz, dx) * -1 + Math.PI / 2;
}

function settleY(obj) {
    obj.position.y = getElevation(obj.position.x, obj.position.z);
}

function bark() {
    const now = performance.now();
    if (now - lastBarkAt < BARK_COOLDOWN_MS) return;
    lastBarkAt = now;
    if (onBark) onBark();
}

export function createShoreDog(spawnX, spawnZ, cabinX, cabinZ, callbacks) {
    cabinTarget = { x: cabinX, z: cabinZ };
    onObjectiveChange = callbacks && callbacks.onObjectiveChange;
    onBark = callbacks && callbacks.onBark;

    dogState = loadPersistedState();
    // Resuming mid-story on reload: anything past 'idle' just resolves to
    // 'arrived' at the cabin directly (see header comment — mid-walk
    // progress isn't tracked), so the dog is never stuck wandering a spot
    // the player already passed.
    const startAtCabin = dogState !== 'idle';
    dog = buildPlaceholderDog();
    if (startAtCabin) {
        dog.position.set(cabinX, 0, cabinZ);
        dogState = 'arrived';
    } else {
        // B-31: used to spawn at (spawn + 6, +2) = ~6.3u from the player,
        // inside APPROACH_RANGE (7), so the greeting fired on the very first
        // frame and "Follow the dog." was already on screen at game start —
        // the doc's "dog appears at a distance, must be approached" beat
        // never happened (seen in a headless run's first screenshot). Place
        // it well outside that range, on the inland side toward the cabin
        // (away from the water the player wakes up next to).
        const toCabinX = cabinX - spawnX, toCabinZ = cabinZ - spawnZ;
        const toCabinLen = Math.hypot(toCabinX, toCabinZ) || 1;
        dog.position.set(spawnX + (toCabinX / toCabinLen) * 20, 0, spawnZ + (toCabinZ / toCabinLen) * 20);
        wanderTarget.set(dog.position.x, 0, dog.position.z);
    }
    settleY(dog);
    state.scene.add(dog);
    return dog;
}

function updateIdle(delta, playerPos) {
    wanderTimer -= delta;
    if (wanderTimer <= 0) {
        wanderTimer = 2 + Math.random() * 3;
        const a = Math.random() * Math.PI * 2;
        wanderTarget.set(dog.position.x + Math.cos(a) * WANDER_RADIUS, 0, dog.position.z + Math.sin(a) * WANDER_RADIUS);
    }
    const dx = wanderTarget.x - dog.position.x, dz = wanderTarget.z - dog.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.3) {
        const step = Math.min(d, WALK_SPEED * 0.4 * delta);
        dog.position.x += (dx / d) * step;
        dog.position.z += (dz / d) * step;
        faceToward(dog, wanderTarget.x, wanderTarget.z);
        settleY(dog);
    }

    const pdx = playerPos.x - dog.position.x, pdz = playerPos.z - dog.position.z;
    if (Math.hypot(pdx, pdz) < APPROACH_RANGE) {
        dogState = 'greeting';
        greetingT = 0;
        bark();
        savePersistedState('following'); // player has now met the dog — never re-plays the "approach me" beat again
        if (onObjectiveChange) onObjectiveChange('Follow the dog.');
    }
}

function updateGreeting(delta, playerPos) {
    faceToward(dog, playerPos.x, playerPos.z);
    greetingT += delta;
    if (greetingT > 1.4) dogState = 'leading';
}

function updateLeading(delta, playerPos) {
    const target = cabinTarget;
    const dx = target.x - dog.position.x, dz = target.z - dog.position.z;
    const distToCabin = Math.hypot(dx, dz);
    if (distToCabin < ARRIVE_RANGE) {
        dogState = 'arrived';
        savePersistedState('arrived');
        if (onObjectiveChange) onObjectiveChange('Investigate the cabin.');
        return;
    }

    const pdx = playerPos.x - dog.position.x, pdz = playerPos.z - dog.position.z;
    const playerDist = Math.hypot(pdx, pdz);
    if (playerDist > FAR_BEHIND_RANGE) {
        // Wait for the player rather than drag them along off-screen —
        // doc's NPC notes call for "Follow → Pause" at a gating moment,
        // and a dog that vanishes into the treeline defeats the whole
        // "follow the dog" objective.
        faceToward(dog, playerPos.x, playerPos.z);
        bark();
        return;
    }

    const step = Math.min(distToCabin, WALK_SPEED * delta);
    dog.position.x += (dx / distToCabin) * step;
    dog.position.z += (dz / distToCabin) * step;
    faceToward(dog, target.x, target.z);
    settleY(dog);
}

export function updateShoreDog(delta, playerPos) {
    if (!dog) return;
    // Tail wag — cheap idle animation so the placeholder shape doesn't
    // read as a static prop; small enough to not need its own state.
    if (dog.userData.tail) dog.userData.tail.rotation.y = Math.sin(performance.now() * 0.006) * 0.4;

    if (dogState === 'idle') updateIdle(delta, playerPos);
    else if (dogState === 'greeting') updateGreeting(delta, playerPos);
    else if (dogState === 'leading') updateLeading(delta, playerPos);
    // 'arrived': no-op, just sits where it stopped.
}
