import * as THREE from 'three';
import { state, WORLD_SIZE, WATER_LEVEL } from './state.js';
import { heightAt as getElevation } from './heightmap.js';

const SPRINT_MULTIPLIER = 1.6;
const JUMP_SPEED = 6.5;
const GRAVITY = 18;
const SPRINT_FOV_KICK = 7;      // degrees added while sprinting
let fovKick = 0;
let landDip = 0;
const MAX_CLIMB_SLOPE = 0.9;     // rise/run (~42 deg): steeper uphill motion is blocked (B-13)
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
        for (const col of state.colliders) {
            if ((nX-col.x)**2 + (state.player.position.z-col.z)**2 < col.r**2) colX = true;
            if ((state.player.position.x-col.x)**2 + (nZ-col.z)**2 < col.r**2) colZ = true;
        }
        // Verticality (standing on rocks/decks/POI structures) is punted —
        // Y always tracks bare terrain elevation (getElevation below), never
        // a raycast against nearby props. Revisit for v3 if a POI needs the
        // player to climb onto it; not needed for Map 1's current design.
        // Ocean acts as a wall: block movement onto any ground tile that
        // sits below the water surface, same pattern as the collider check
        // above (per-axis, so grazing the shoreline at an angle still slides).
        const px = state.player.position.x, pz = state.player.position.z;
        const h0 = getElevation(px, pz);
        const hX = getElevation(nX, pz), hZ = getElevation(px, nZ);
        if (hX < WATER_LEVEL) colX = true;
        if (hZ < WATER_LEVEL) colZ = true;
        // Slope limiter: block only the uphill component, so you slide along steep walls instead of climbing them.
        if (Math.abs(nX - px) > 1e-5 && (hX - h0) / Math.abs(nX - px) > MAX_CLIMB_SLOPE) colX = true;
        if (Math.abs(nZ - pz) > 1e-5 && (hZ - h0) / Math.abs(nZ - pz) > MAX_CLIMB_SLOPE) colZ = true;
        if (!colX && Math.abs(nX) < WORLD_SIZE/2) state.player.position.x = nX;
        if (!colZ && Math.abs(nZ) < WORLD_SIZE/2) state.player.position.z = nZ;
        const stepGap = state.keys.shift ? 300 : 450;
        if (performance.now() - state.stepTimer > stepGap && state.player.isGrounded) {
            state.stepAudio.rate(0.92 + Math.random() * 0.22); // vary pitch so steps don't sound looped
            state.stepAudio.play(); state.stepTimer = performance.now();
        }
    }
    const gY = Math.max(getElevation(state.player.position.x, state.player.position.z), WATER_LEVEL);
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