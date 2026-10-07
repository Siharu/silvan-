import * as THREE from 'three';
import { state, WORLD_SIZE, WATER_LEVEL } from './state.js';
import { heightAt as getElevation } from './heightmap.js';
import { collidersNear } from './colliders.js';
import { exitCave, CAVE_BOUNDS } from '../environment/serpents-coil.js';

const SPRINT_MULTIPLIER = 1.6;
const JUMP_SPEED = 6.5;
const GRAVITY = 18;
const SPRINT_FOV_KICK = 7;      // degrees added while sprinting
let fovKick = 0;
let landDip = 0;
const MAX_CLIMB_SLOPE = 0.9;     // rise/run (~42 deg): steeper uphill motion is blocked (B-13)
const CURRENT_STRENGTH = 26;     // u/s at full depth — exceeds speed*SPRINT_MULTIPLIER (12*1.6=19.2) so the current always wins
const SAFETY = WORLD_SIZE / 2 + 300; // last-resort bound; the current above should make this unreachable in practice
let boundaryEl = null, boundaryT = 0;   // dead boundary-message CSS is now wired: shown while the ocean blocks you
function touchBoundary(delta) {
    if (!boundaryEl) boundaryEl = document.getElementById('boundary-message');
    if (!boundaryEl) return;
    const on = boundaryT > 0;
    boundaryEl.classList.toggle('visible', on);
}
const _dir = new THREE.Vector3(), _right = new THREE.Vector3();  // reused: no per-frame garbage                // camera sinks briefly after a hard landing

// Phase 6 #37: jump didn't exist for keyboard OR touch before this — the
// dedicated touch-jump-btn in index.html pointed at nothing. Edge-triggered
// (call once per press), not a held key, so both keyboard (input.js's
// Space keydown) and touch (touch-controls.js's jump button) can drive it
// through the same function instead of each needing their own state.keys
// entry and gravity logic.
export function triggerJump() {
    if (!state.isPlaying || !state.player.isGrounded) return;
    state.player.verticalVelocity = JUMP_SPEED;
    state.player.isGrounded = false;
}

export function updatePlayer(delta) {
    // Was state.isLocked — real pointer lock never fires on touch devices,
    // which would leave movement permanently dead-gated there even once
    // touch-controls.js sets state.isPlaying=true. isPlaying is already
    // true whenever isLocked is (see input.js's pointerlockchange handler),
    // so this is a strict superset for desktop and the actual fix for touch.
    if (!state.isPlaying) return;
    if (state.debugTour) { state.camera.position.copy(state.player.position); return; } // perf tour drives the camera
    if (state.isResting) return; // B-17: frozen during the rest fade/skip/fade-back sequence
    if (state.inCave) { updateCaveMovement(delta); return; } // Serpent's Coil cave room — flat floor, rectangular bounds, no heightmap/current/slope logic at all
    if (boundaryT > 0) boundaryT -= delta;
    touchBoundary(delta);
    if (state.debugNoclip) {   // debug free-cam (core/debug.js): fly along the view direction, ignore ground/colliders
        state.camera.getWorldDirection(_dir);
        const sp = state.player.speed * (state.keys.shift ? 4 : 1.5) * delta;
        if (state.keys.w) state.player.position.addScaledVector(_dir, sp);
        if (state.keys.s) state.player.position.addScaledVector(_dir, -sp);
        state.camera.position.copy(state.player.position);
        return;
    }
    state.player.velocity.set(0, 0, 0);
    const dir = _dir; state.camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    // Phase 7 #38: was cross(up, dir), which points LEFT — A/D were swapped
    // below to compensate. cross(dir, up) is the true right vector, and
    // D now adds it / A subtracts it.
    const right = _right.crossVectors(dir, state.camera.up).normalize();
    if (state.keys.w) state.player.velocity.add(dir); if (state.keys.s) state.player.velocity.sub(dir);
    if (state.keys.d) state.player.velocity.add(right); if (state.keys.a) state.player.velocity.sub(right);
    if (state.player.velocity.lengthSq() > 0) {
        const sprintFactor = state.keys.shift ? SPRINT_MULTIPLIER : 1;
        state.player.velocity.normalize().multiplyScalar(state.player.speed * sprintFactor * delta);
        let nX = state.player.position.x + state.player.velocity.x; let nZ = state.player.position.z + state.player.velocity.z;
        let colX = false, colZ = false;
        // B-21: grid broadphase — a step is < 1 u, so the cell under the current and the next position covers every candidate
        const cx = state.player.position.x, cz = state.player.position.z;
        const near1 = collidersNear(cx, cz), near2 = collidersNear(nX, nZ);
        for (let pass = 0; pass < 2; pass++) {
            const list = pass === 0 ? near1 : near2;
            if (pass === 1 && near2 === near1) break;
            for (let i = 0; i < list.length; i++) {
                const col = list[i];
                if ((nX-col.x)**2 + (cz-col.z)**2 < col.r**2) colX = true;
                if ((cx-col.x)**2 + (nZ-col.z)**2 < col.r**2) colZ = true;
            }
        }
        // Verticality (standing on rocks/decks/POI structures) is punted —
        // Y always tracks bare terrain elevation (getElevation below), never
        // a raycast against nearby props. Revisit for v3 if a POI needs the
        // player to climb onto it; not needed for Map 1's current design.
        const px = state.player.position.x, pz = state.player.position.z;
        const h0 = getElevation(px, pz);
        const hX = getElevation(nX, pz), hZ = getElevation(px, nZ);
        // Terrain v2 / B-20: ocean is a CURRENT, not a wall. Was a hard
        // block the moment ground dipped below WATER_LEVEL (plus a flat
        // Math.abs(n) < WORLD_SIZE/2 clamp below) — you'd hit it like
        // glass. Now wading in is allowed; past the shoreline, a push back
        // toward the island centre ramps in with depth (full strength by
        // 6u underwater) until it exceeds even a sprinting swim speed, so
        // the player drifts to a dead stop in the shallows instead of being
        // stopped outright. CURRENT_STRENGTH (26) > speed*SPRINT_MULTIPLIER
        // (12*1.6=19.2) is what guarantees that.
        // state.effectiveWaterLevel instead of the WATER_LEVEL constant —
        // during a torrential storm's surge (atmosphere/day-night-cycle.js)
        // this is eased above WATER_LEVEL, so the current/shallows line
        // actually creeps inland with the flood instead of staying pinned
        // to the normal shoreline while only the visible water mesh rises.
        let pushX = 0, pushZ = 0;
        const depthX = state.effectiveWaterLevel - hX, depthZ = state.effectiveWaterLevel - hZ;
        if (depthX > 0) { pushX = -Math.sign(nX || 1) * Math.min(1, depthX / 6) * CURRENT_STRENGTH * delta; boundaryT = 1.6; }
        if (depthZ > 0) { pushZ = -Math.sign(nZ || 1) * Math.min(1, depthZ / 6) * CURRENT_STRENGTH * delta; boundaryT = 1.6; }
        // Slope limiter: block only the uphill component, so you slide along steep walls instead of climbing them.
        if (Math.abs(nX - px) > 1e-5 && (hX - h0) / Math.abs(nX - px) > MAX_CLIMB_SLOPE) colX = true;
        if (Math.abs(nZ - pz) > 1e-5 && (hZ - h0) / Math.abs(nZ - pz) > MAX_CLIMB_SLOPE) colZ = true;
        // SAFETY is a last-resort bound (never meant to be felt - the current
        // above should always win first), not the primary edge mechanism.
        if (!colX) state.player.position.x = THREE.MathUtils.clamp(nX + pushX, -SAFETY, SAFETY);
        if (!colZ) state.player.position.z = THREE.MathUtils.clamp(nZ + pushZ, -SAFETY, SAFETY);
        const stepGap = state.keys.shift ? 300 : 450;
        if (performance.now() - state.stepTimer > stepGap && state.player.isGrounded) {
            state.stepAudio.rate(0.92 + Math.random() * 0.22); // vary pitch so steps don't sound looped
            state.stepAudio.play(); state.stepTimer = performance.now();
        }
    }
    const gY = Math.max(getElevation(state.player.position.x, state.player.position.z), state.effectiveWaterLevel);
    if (state.player.isGrounded) {
        const b = state.player.velocity.lengthSq() > 0 ? Math.sin(performance.now()*0.012*(state.keys.shift ? 1.35 : 1))*(state.keys.shift ? 0.15 : 0.1) : 0;
        const easing = state.player.velocity.lengthSq() > 0 ? 12.0 : 8.0;
        state.player.position.y += (gY + state.player.height + b - state.player.position.y) * (1.0 - Math.exp(-easing * delta));
    } else {
        // Airborne: integrate gravity directly instead of easing toward
        // ground height, then land the moment we'd sink back through it.
        state.player.verticalVelocity -= GRAVITY * delta;
        state.player.position.y += state.player.verticalVelocity * delta;
        const groundY = gY + state.player.height;
        if (state.player.position.y <= groundY) {
            state.player.position.y = groundY;
            landDip = Math.min(0.4, Math.abs(state.player.verticalVelocity) * 0.045);
            state.player.verticalVelocity = 0;
            state.player.isGrounded = true;
        }
    }
    // Sprint FOV kick + landing dip, both eased so they read as weight, not snaps.
    const moving = state.player.velocity.lengthSq() > 0;
    const targetKick = (state.keys.shift && moving) ? SPRINT_FOV_KICK : 0;
    fovKick += (targetKick - fovKick) * (1.0 - Math.exp(-6.0 * delta));
    const wantFov = (state.baseFov || 75) + fovKick;
    if (Math.abs(state.camera.fov - wantFov) > 0.01) { state.camera.fov = wantFov; state.camera.updateProjectionMatrix(); }
    landDip *= Math.exp(-9.0 * delta);
    state.camera.position.copy(state.player.position);
    state.camera.position.y -= landDip;
}

// Serpent's Coil cave room (environment/serpents-coil.js): deliberately NOT
// the same movement model as the surface. The surface's Y every frame comes
// from heightAt() — a single-valued heightfield, which by construction
// can't represent a room sitting under its own terrain (see that file's
// header). Rather than fight the heightmap for an underground space, the
// cave is a separate, tiny, flat-floored box the player teleports into,
// with its own trivial movement: 8-directional WASD relative to look yaw,
// clamped to the room's rectangle, fixed floor height, no gravity/jump/
// slope/current/collider logic at all (none of it applies in a single
// empty room). Walking back up to the exit marker calls exitCave(), which
// restores the surface position/rotation saved the moment the cutscene
// committed to entering.
const _caveDir = new THREE.Vector3();
export function updateCaveMovement(delta) {
    const b = CAVE_BOUNDS;
    state.camera.getWorldDirection(_caveDir); _caveDir.y = 0; _caveDir.normalize();
    const right = _right.crossVectors(_caveDir, state.camera.up).normalize();
    const move = _dir.set(0, 0, 0);
    if (state.keys.w) move.add(_caveDir); if (state.keys.s) move.sub(_caveDir);
    if (state.keys.d) move.add(right); if (state.keys.a) move.sub(right);
    if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(state.player.speed * (state.keys.shift ? SPRINT_MULTIPLIER : 1) * delta);
        const nX = THREE.MathUtils.clamp(state.player.position.x + move.x, b.center.x - b.halfW + 1, b.center.x + b.halfW - 1);
        const nZ = THREE.MathUtils.clamp(state.player.position.z + move.z, b.center.z - b.halfD + 1, b.center.z + b.halfD - 1);
        state.player.position.x = nX;
        state.player.position.z = nZ;
    }
    state.player.position.y = b.center.y + state.player.height;
    state.player.verticalVelocity = 0;
    state.player.isGrounded = true;
    state.camera.position.copy(state.player.position);

    const dx = state.player.position.x - b.exitTrigger.x, dz = state.player.position.z - b.exitTrigger.z;
    if (Math.hypot(dx, dz) < 3) exitCave();
}