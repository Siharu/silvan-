// The Serpent's Coil quest event (audit section 11 decision #4). The coil
// itself (crater + magma blend + the dormant abyssLight) already exists,
// built into environment/terrain.js — this file owns everything that
// happens to/around it over time, plus the cave it eventually opens into.
//
// SPEC, as given:
//   - 3rd day, nighttime: the coil and surrounding area glow red.
//   - the following day: grass in the area starts burning.
//   - once burnt, the coil opens into a cave; walking in plays a
//     (not-yet-made) 5th-dimensional demoscene video, then takes the
//     player into a cave system with murals.
//
// PHASE is a pure function of state.daysPassed/state.gameTime (see phaseFor()
// below) — nothing about progress is written to the save payload. That's
// deliberate: it means the event replays correctly after a Regain with zero
// schema change (Day 5 always means "burning", whichever slot you loaded),
// at the cost of the glow/burn never being able to depend on anything other
// than the calendar (no "player must have visited first" gating, etc.) —
// flagging that trade rather than silently making it.
//
// NOT BUILT YET, clearly marked below:
//   - The actual video. #coil-cutscene-video has no <src> — drop a file at
//     ./assets/video/coil-vision.mp4 (same self-hosted-asset convention
//     state.js's SOUNDS block already uses) and it'll just play. Until then
//     triggerCutscene() falls back to a timed placeholder card instead of
//     failing or blocking entry.
//   - Real mural art. The cave interior has 4 placeholder mural planes,
//     flat-colored with a canvas-drawn label, positioned/sized so swapping
//     their .material.map for a real texture later is the only change
//     needed (see buildMuralPlaceholder()).
//   - Grass actually burning at the blade level: environment/grass.js's
//     shader would need a burn-center/radius uniform and fragment-side
//     color logic to char individual blades — real fire, not a decal under
//     them. Punted: that shader can't be verified without a WebGL context,
//     which isn't available in this environment, so a live visual edit to
//     it isn't something to ship unverified. What IS built — a growing
//     scorched-ground decal, dying/reddened point lights, ember-colored
//     fog tint pulled toward the crater — reads as "burning area" from a
//     distance without touching grass.js at all. Revisit once this can
//     actually be playtested.
import * as THREE from 'three';
import { state, WATER_LEVEL } from '../core/state.js';
import { heightAt } from '../core/heightmap.js';
import { POIS } from './pois.js';

const COIL = POIS.find((p) => p.id === 'serpents_coil');
const COIL_X = COIL ? COIL.x : 0;
const COIL_Z = COIL ? COIL.z : -50;

// Phase thresholds, straight from the spec above. daysPassed is 1-indexed
// (state.js: `daysPassed: 1` is the very first day), matching the #day-
// display text exactly — "3rd day" is daysPassed === 3, no off-by-one.
const GLOW_DAY = 3;
const BURN_DAY = GLOW_DAY + 1; // "the following day"
const NIGHT_LO = 0.25, NIGHT_HI = 0.79; // same cutoffs day-night-cycle.js / rest.js already use

function isNight() { return state.gameTime < NIGHT_LO || state.gameTime > NIGHT_HI; }

// 'dormant' -> 'glowing' (day 3, night only) -> 'burning' (day 4+, any
// time) -> once burning, the cave mouth is openable; entering it is a
// player action (walking close), not an automatic phase.
function phaseFor() {
    if (state.daysPassed >= BURN_DAY) return 'burning';
    if (state.daysPassed === GLOW_DAY && isNight()) return 'glowing';
    return 'dormant';
}

// --- Visuals: all additive (new objects), nothing here edits terrain.js's
// own dormant abyssLight or any existing shader. ---
let coilGroup = null;
let glowLight = null;      // ramps in during 'glowing', stays maxed through 'burning'
let scorchDecal = null;    // flat circle, grows + darkens from BURN_DAY onward
let caveMouth = null;      // dark disc + collider-less trigger volume, visible once 'burning'
let groundY = 0;

const MAX_SCORCH_RADIUS = 55;
const SCORCH_GROW_PER_DAY = 14; // radius added per day once burning starts
const TRIGGER_RADIUS = 7;       // walk this close to the coil center, once open, to enter the cave

export function createSerpentsCoilEvent() {
    groundY = heightAt(COIL_X, COIL_Z);
    coilGroup = new THREE.Group();
    coilGroup.position.set(COIL_X, groundY, COIL_Z);
    state.scene.add(coilGroup);

    glowLight = new THREE.PointLight(0xff2a1a, 0, 160);
    glowLight.position.set(0, 20, 0);
    coilGroup.add(glowLight);

    scorchDecal = new THREE.Mesh(
        new THREE.CircleGeometry(1, 40),
        new THREE.MeshBasicMaterial({ color: 0x120403, transparent: true, opacity: 0, depthWrite: false })
    );
    scorchDecal.rotation.x = -Math.PI / 2;
    scorchDecal.position.y = 0.08; // just above ground, avoids z-fighting with terrain
    scorchDecal.renderOrder = 1;
    scorchDecal.scale.set(0.001, 0.001, 1); // not 0 — a zero-scale circle can warn in some three.js versions on first raycast/bounds calc
    coilGroup.add(scorchDecal);

    caveMouth = new THREE.Mesh(
        new THREE.CircleGeometry(TRIGGER_RADIUS * 0.6, 24),
        new THREE.MeshBasicMaterial({ color: 0x030101 })
    );
    caveMouth.rotation.x = -Math.PI / 2;
    caveMouth.position.y = 0.12;
    caveMouth.visible = false;
    coilGroup.add(caveMouth);

    buildCaveInterior();
}

let lastPhase = 'dormant';
let cutsceneActive = false;

// Called every frame from main.js's animate() (inside the isPlaying gate,
// same as updatePOIs/updateRest).
export function updateSerpentsCoilEvent(delta) {
    if (!coilGroup) return;
    const phase = phaseFor();

    if (phase === 'dormant') {
        glowLight.intensity = THREE.MathUtils.lerp(glowLight.intensity, 0, Math.min(1, delta * 2));
        scorchDecal.material.opacity = 0;
        scorchDecal.scale.set(0.001, 0.001, 1);
        caveMouth.visible = false;
    } else if (phase === 'glowing') {
        const pulse = 0.75 + 0.25 * Math.sin(performance.now() * 0.004);
        glowLight.intensity = THREE.MathUtils.lerp(glowLight.intensity, 26 * pulse, Math.min(1, delta * 1.5));
        caveMouth.visible = false;
    } else { // 'burning'
        glowLight.intensity = THREE.MathUtils.lerp(glowLight.intensity, 30, Math.min(1, delta * 1.5));
        const daysBurning = state.daysPassed - BURN_DAY + 1; // 1 on the first burning day
        const radius = Math.min(MAX_SCORCH_RADIUS, 6 + daysBurning * SCORCH_GROW_PER_DAY);
        scorchDecal.scale.set(radius, radius, 1);
        scorchDecal.material.opacity = Math.min(0.85, scorchDecal.material.opacity + delta * 0.1);
        caveMouth.visible = true;
    }

    if (phase !== lastPhase) {
        // Keep the examine caption (pois.js's updatePOIInteraction reads
        // POI.desc directly, no extra wiring needed) honest about current
        // state rather than permanently describing the original dormant
        // crater.
        if (COIL) {
            COIL.desc = phase === 'burning'
                ? "The crater has burned open. A black throat leads down into the earth, heat still rolling off the scorched ground around it."
                : phase === 'glowing'
                    ? "The crater pulses with a deep red light that wasn't there before, bright enough to see from across the island."
                    : "The catastrophic central crater. A terrifying threshold where the earth pulses with crimson magma for only the bravest spirits.";
        }
        lastPhase = phase;
    }

    // Auto-enter: once open, walking close enough commits to the cutscene.
    // Not gated on an E-press — "when players enter there" in the spec
    // reads as a walk-in trigger, and pois.js's own E-press/caption system
    // already owns that input for the examine text above, so reusing it
    // here would mean two different things fighting over the same key.
    if (phase === 'burning' && !state.inCave && !cutsceneActive && state.player) {
        const dx = state.player.position.x - COIL_X, dz = state.player.position.z - COIL_Z;
        if (Math.hypot(dx, dz) < TRIGGER_RADIUS) triggerCutscene();
    }
}

// --- Cutscene + cave entry ---
let overlay = null, videoEl = null, placeholderEl = null;
const PLACEHOLDER_MS = 3200;

function els() {
    if (!overlay) overlay = document.getElementById('coil-cutscene-overlay');
    if (!videoEl) videoEl = document.getElementById('coil-cutscene-video');
    if (!placeholderEl) placeholderEl = document.getElementById('coil-cutscene-placeholder');
}

function triggerCutscene() {
    els();
    cutsceneActive = true;
    state.isResting = true; // reuses the same "freeze player movement" flag rest.js's updatePlayer gate already checks — no separate freeze needed
    if (!overlay) { enterCave(); return; } // markup missing — fail straight into the cave rather than getting stuck

    overlay.classList.add('active');
    const hasSrc = videoEl && videoEl.currentSrc || (videoEl && videoEl.querySelector('source') && videoEl.querySelector('source').src);

    const finish = () => {
        overlay.classList.remove('active');
        cutsceneActive = false;
        enterCave();
    };

    if (videoEl && hasSrc) {
        if (placeholderEl) placeholderEl.classList.remove('active');
        videoEl.classList.add('active');
        videoEl.currentTime = 0;
        videoEl.onended = finish;
        videoEl.onerror = () => { videoEl.classList.remove('active'); if (placeholderEl) placeholderEl.classList.add('active'); setTimeout(finish, PLACEHOLDER_MS); };
        const p = videoEl.play();
        if (p && p.catch) p.catch(() => { videoEl.classList.remove('active'); if (placeholderEl) placeholderEl.classList.add('active'); setTimeout(finish, PLACEHOLDER_MS); });
    } else {
        // No video file dropped in yet (see this file's header) — short
        // placeholder card instead of silently skipping or hanging.
        if (videoEl) videoEl.classList.remove('active');
        if (placeholderEl) placeholderEl.classList.add('active');
        setTimeout(finish, PLACEHOLDER_MS);
    }
}

// --- The cave room itself ---
// Placed far from the island (not underneath it — a single heightmap
// can't represent an overhang/cave, see this file's header) and well past
// player-controller.js's normal SAFETY clamp, so it can never be reached
// by walking. Distance + the scene's own fog (density 0.007, ~140u
// falloff) already keep it from ever being visible from the surface —
// no separate visibility/culling logic needed for the separation itself.
const CAVE_CENTER = new THREE.Vector3(0, -300, 4200);
const CAVE_HALF_W = 18, CAVE_HALF_D = 26, CAVE_H = 11;
const CAVE_SPAWN = new THREE.Vector3(CAVE_CENTER.x, CAVE_CENTER.y, CAVE_CENTER.z + CAVE_HALF_D - 6);
const CAVE_EXIT_TRIGGER = new THREE.Vector3(CAVE_CENTER.x, CAVE_CENTER.y, CAVE_CENTER.z + CAVE_HALF_D - 2);

function buildMuralPlaceholder(label, color) {
    // Canvas-drawn placeholder so it's immediately legible as "not final
    // art" rather than a mystery blank panel. Swap .material.map (and drop
    // .material.color back to white) for a real texture later — geometry/
    // placement doesn't need to change.
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 320;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, cv.width - 24, cv.height - 24);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MURAL PLACEHOLDER', cv.width / 2, cv.height / 2 - 14);
    ctx.font = '20px monospace';
    ctx.fillText(label, cv.width / 2, cv.height / 2 + 20);
    const tex = new THREE.CanvasTexture(cv);
    return new THREE.MeshBasicMaterial({ map: tex });
}

function buildCaveInterior() {
    const group = new THREE.Group();
    group.position.copy(CAVE_CENTER);
    state.scene.add(group);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1, side: THREE.BackSide });
    const room = new THREE.Mesh(new THREE.BoxGeometry(CAVE_HALF_W * 2, CAVE_H, CAVE_HALF_D * 2), wallMat);
    room.position.y = CAVE_H / 2;
    group.add(room);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x24211d, roughness: 1 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(CAVE_HALF_W * 2, CAVE_HALF_D * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    // 4 murals, two per long wall, facing inward.
    const muralDefs = [
        { x: -CAVE_HALF_W + 0.1, z: -CAVE_HALF_D * 0.4, ry: Math.PI / 2, label: 'west wall, panel 1', color: 0x5a3a2a },
        { x: -CAVE_HALF_W + 0.1, z: CAVE_HALF_D * 0.4, ry: Math.PI / 2, label: 'west wall, panel 2', color: 0x3a4a2a },
        { x: CAVE_HALF_W - 0.1, z: -CAVE_HALF_D * 0.4, ry: -Math.PI / 2, label: 'east wall, panel 1', color: 0x2a3a5a },
        { x: CAVE_HALF_W - 0.1, z: CAVE_HALF_D * 0.4, ry: -Math.PI / 2, label: 'east wall, panel 2', color: 0x5a2a4a },
    ];
    for (const m of muralDefs) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.5), buildMuralPlaceholder(m.label, m.color));
        mesh.position.set(m.x, CAVE_H / 2, m.z);
        mesh.rotation.y = m.ry;
        group.add(mesh);
    }

    // A couple of warm point lights — otherwise MeshStandardMaterial walls
    // with no light at all would render pure black (hemiLight/sunLight are
    // both scene-wide and tuned for the surface day/night cycle, not this
    // room, so this cave needs its own fixed lighting regardless of the
    // time of day the player entered at).
    const torch1 = new THREE.PointLight(0xffaa55, 8, 30);
    torch1.position.set(0, CAVE_H - 2, -CAVE_HALF_D * 0.6);
    group.add(torch1);
    const torch2 = new THREE.PointLight(0xffaa55, 8, 30);
    torch2.position.set(0, CAVE_H - 2, CAVE_HALF_D * 0.6);
    group.add(torch2);

    // Exit marker: a pale disc near the entrance side, same trigger-by-
    // proximity pattern as the coil mouth on the surface.
    const exitMarker = new THREE.Mesh(
        new THREE.CircleGeometry(3, 24),
        new THREE.MeshBasicMaterial({ color: 0x8899ff, transparent: true, opacity: 0.35 })
    );
    exitMarker.rotation.x = -Math.PI / 2;
    exitMarker.position.set(0, 0.05, CAVE_HALF_D - 2);
    group.add(exitMarker);
}

function enterCave() {
    state.caveReturn = {
        x: state.player.position.x, y: state.player.position.y, z: state.player.position.z,
        yaw: state.player.rotation.y,
    };
    state.player.position.set(CAVE_SPAWN.x, CAVE_SPAWN.y + state.player.height, CAVE_SPAWN.z);
    state.player.rotation.y = Math.PI; // face back into the room, away from the entrance wall
    state.player.verticalVelocity = 0;
    state.player.isGrounded = true;
    state.inCave = true;
    state.isResting = false; // release the movement freeze triggerCutscene() set
}

// Called from player-controller.js's cave-mode branch when the player
// walks back up to the exit marker.
export function exitCave() {
    if (!state.caveReturn) { state.inCave = false; return; } // shouldn't happen, but don't strand the player with no return point
    const r = state.caveReturn;
    const gy = Math.max(heightAt(r.x, r.z), WATER_LEVEL);
    state.player.position.set(r.x, gy + state.player.height, r.z);
    state.player.rotation.y = r.yaw;
    state.player.verticalVelocity = 0;
    state.player.isGrounded = true;
    state.inCave = false;
    state.caveReturn = null;
}

export const CAVE_BOUNDS = { center: CAVE_CENTER, halfW: CAVE_HALF_W, halfD: CAVE_HALF_D, exitTrigger: CAVE_EXIT_TRIGGER };
