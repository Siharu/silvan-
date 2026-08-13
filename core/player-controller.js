// Movement + collision-vs-colliders, footstep audio, ground-snap, sprint,
// and the "swimming" camera feel used when the player is out over the lake.
//
// This is NOT real swim/dive physics — there's no breath meter or vertical
// dive control. It's a camera/movement treatment: when the ground beneath
// the player dips below WATER_LEVEL, movement slows, the walk-bob becomes a
// slower/wider float-bob, a faint roll sways the camera, footsteps go
// silent, the water ambience swells, and a screen-edge tint (#water-overlay
// in index.html) fades in. All of it hangs off state.player.isInWater, so
// swapping to a cat POV later just means retargeting what reads that flag —
// the flag itself doesn't assume first-person.

import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL } from './world-state.js';
import { getElevation } from '../environment/terrain.js';

const RUN_MULTIPLIER = 1.8;
const SWIM_SPEED_MULTIPLIER = 0.55; // swimming is slower than walking
const WALK_BOB_AMPLITUDE = 0.1;
const WALK_BOB_FREQUENCY = 0.012;
const SWIM_BOB_AMPLITUDE = 0.22;
const SWIM_BOB_FREQUENCY = 0.005;
const SWIM_ROLL_AMPLITUDE = 0.035;
const SWIM_ROLL_FREQUENCY = 0.0009;
const SWIM_FLOAT_HEIGHT = 0.55; // how much of player.height stays above the waterline

function getWaterOverlayEl(state) {
    if (state.waterOverlayEl === undefined) {
        state.waterOverlayEl = document.getElementById('water-overlay');
    }
    return state.waterOverlayEl;
}

export function updatePlayer(state, delta) {
    if (!state.isLocked) return;

    const gY = getElevation(state.player.position.x, state.player.position.z);
    state.player.isInWater = gY < WATER_LEVEL;
    state.player.isRunning = state.keys.shift && !state.player.isInWater;

    const speedMultiplier =
        (state.player.isRunning ? RUN_MULTIPLIER : 1) *
        (state.player.isInWater ? SWIM_SPEED_MULTIPLIER : 1);

    state.player.velocity.set(0, 0, 0);
    const dir = new THREE.Vector3(); state.camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const right = new THREE.Vector3().crossVectors(state.camera.up, dir).normalize();
    if (state.keys.w) state.player.velocity.add(dir); if (state.keys.s) state.player.velocity.sub(dir);
    if (state.keys.a) state.player.velocity.add(right); if (state.keys.d) state.player.velocity.sub(right);

    if (state.player.velocity.lengthSq() > 0) {
        state.player.velocity.normalize().multiplyScalar(state.player.speed * speedMultiplier * delta);
        let nX = state.player.position.x + state.player.velocity.x; let nZ = state.player.position.z + state.player.velocity.z;
        let colX = false, colZ = false;
        for (const col of state.colliders) {
            if ((nX-col.x)**2 + (state.player.position.z-col.z)**2 < col.r**2) colX = true;
            if ((state.player.position.x-col.x)**2 + (nZ-col.z)**2 < col.r**2) colZ = true;
        }
        if (!colX && Math.abs(nX) < WORLD_SIZE/2) state.player.position.x = nX;
        if (!colZ && Math.abs(nZ) < WORLD_SIZE/2) state.player.position.z = nZ;

        if (!state.player.isInWater && performance.now() - state.stepTimer > 450) {
            state.stepAudio.play(); state.stepTimer = performance.now();
        }

        const bobAmp = state.player.isInWater ? SWIM_BOB_AMPLITUDE : WALK_BOB_AMPLITUDE;
        const bobFreq = state.player.isInWater ? SWIM_BOB_FREQUENCY : WALK_BOB_FREQUENCY;
        const b = Math.sin(performance.now() * bobFreq) * bobAmp;

        const targetY = state.player.isInWater
            ? WATER_LEVEL + state.player.height * SWIM_FLOAT_HEIGHT + b
            : gY + state.player.height + b;
        state.player.position.y += (targetY - state.player.position.y) * (1.0 - Math.exp(-12.0 * delta));
    } else {
        const targetY = state.player.isInWater
            ? WATER_LEVEL + state.player.height * SWIM_FLOAT_HEIGHT
            : gY + state.player.height;
        state.player.position.y += (targetY - state.player.position.y) * (1.0 - Math.exp(-8.0 * delta));
    }

    state.camera.position.copy(state.player.position);

    // Faint side-to-side roll while swimming; settles back to level on land.
    state.camera.rotation.z = state.player.isInWater
        ? Math.sin(performance.now() * SWIM_ROLL_FREQUENCY) * SWIM_ROLL_AMPLITUDE
        : 0;

    // Water ambience swells when actually out over the lake, beyond the
    // gentler shoreline-proximity fade atmosphere/day-night-cycle.js already
    // applies every frame before this runs.
    if (state.player.isInWater && state.isPlaying) {
        state.waterAudio.volume(0.55);
    }

    // Screen-edge tint so the water reads as water, not just a slowdown.
    const overlay = getWaterOverlayEl(state);
    if (overlay) overlay.style.opacity = state.player.isInWater ? '1' : '0';
}
