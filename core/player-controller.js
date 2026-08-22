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
import { WATER_LEVEL } from './world-state.js';
import { getElevation, islandRadiusAt, BASE_BOUNDARY_RADIUS } from '../environment/terrain.js';

// Soft world boundary — instead of a hard clamp that reads as an invisible
// wall, movement gets increasingly resisted ("wind") as the player nears
// the mountain ring, and a Genshin/Wuwa-style "no need to go there" message
// fades in. A hard radial cap still exists as a failsafe, but under normal
// play the resistance alone turns the player back before they'd ever hit it.
//
// The boundary now follows islandRadiusAt(theta) instead of a fixed circle,
// matching the irregular coastline terrain.js/mountain-boundary.js draw —
// coves let you get closer to the visual mountains in some directions,
// headlands push you back sooner in others, instead of one identical
// distance in every direction.
const BOUNDARY_SOFT_ZONE = 70;

// Conservative fixed radius kept for placement logic elsewhere (e.g.
// environment/radio-tower.js) that just needs a single safe "don't place
// past here" cap rather than the full per-angle shape — approximates the
// tightest cove so it never assumes more clearance than actually exists in
// every direction.
export const BOUNDARY_START = BASE_BOUNDARY_RADIUS * 0.55 - BOUNDARY_SOFT_ZONE;

const _radialDir = new THREE.Vector3();

const RUN_MULTIPLIER = 1.8;
const SWIM_SPEED_MULTIPLIER = 0.55; // swimming is slower than walking
const WALK_BOB_AMPLITUDE = 0.1;
const WALK_BOB_FREQUENCY = 0.012;
const SWIM_BOB_AMPLITUDE = 0.22;
const SWIM_BOB_FREQUENCY = 0.005;
const SWIM_ROLL_AMPLITUDE = 0.035;
const SWIM_ROLL_FREQUENCY = 0.0009;
const SWIM_FLOAT_HEIGHT = 0.55; // how much of player.height stays above the waterline

// Top-down camera rig — a fixed-angle "chase cam" that follows player.
// position.x/z, never rotates with input. Positioned back (+Z) and above
// the player, using camera.lookAt() rather than a hand-built quaternion so
// camera.getWorldDirection() is always well-defined (points from the rig
// toward the player, never degenerate). That matters beyond just this
// file: environment/animals.js's follower-positioning code flattens
// camera-forward to XZ and normalizes it — a true 90°-straight-down look
// would flatten to a near-zero-length vector there and risk NaN followers.
// Staying off dead-vertical avoids that entirely instead of guarding for it.
const TOPDOWN_HEIGHT = 34;
const TOPDOWN_BACK_OFFSET = 16;

// WASD in top-down mode maps to fixed world axes (there's no mouse-look to
// derive "forward" from — see updatePlayer's movement block) rather than
// camera-relative ones. "North" here is an arbitrary but fixed choice —
// what actually matters is that it's the same fixed direction the top-down
// camera rig above is offset along, so the camera consistently sits
// "behind" whichever way the fixed axes call forward.
const TOPDOWN_FORWARD = new THREE.Vector3(0, 0, -1);

const _rollQuat = new THREE.Quaternion();
const _forwardAxis = new THREE.Vector3(0, 0, 1);

function getWaterOverlayEl(state) {
    if (state.waterOverlayEl === undefined) {
        state.waterOverlayEl = document.getElementById('water-overlay');
    }
    return state.waterOverlayEl;
}

function getBoundaryMessageEl(state) {
    if (state.boundaryMsgEl === undefined) {
        state.boundaryMsgEl = document.getElementById('boundary-message');
    }
    return state.boundaryMsgEl;
}

// Toggles the boundary message purely off distance-from-center, no debounce
// needed — the CSS opacity transition on #boundary-message already smooths
// the fade, so rapid in/out near the threshold just looks like flicker-free
// breathing rather than a hard on/off.
function updateBoundaryMessage(state, distFromCenter, msgThreshold) {
    const shouldShow = distFromCenter > msgThreshold;
    if (shouldShow === state.boundaryMsgVisible) return;
    state.boundaryMsgVisible = shouldShow;
    const el = getBoundaryMessageEl(state);
    if (el) el.classList.toggle('visible', shouldShow);
}

export function updatePlayer(state, delta) {
    if (!state.isLocked) return;

    // While the tower-awe cutscene is running (see
    // environment/radio-tower.js), it drives player.rotation directly —
    // skip normal WASD movement and let the scripted look take over, but
    // still sync the camera to whatever rotation it just set so the look
    // actually renders. Ground-height is still tracked so the player
    // doesn't sink/float if the cutscene runs mid-step.
    if (state.cutsceneActive) {
        const gY = getElevation(state.player.position.x, state.player.position.z);
        state.player.position.y += (gY + state.player.height - state.player.position.y) * (1.0 - Math.exp(-8.0 * delta));
        if (state.viewMode === 'topdown') {
            // The tower cutscene's scripted look (radio-tower.js writing
            // player.rotation directly) is a first-person narrative beat —
            // top-down's camera doesn't read player.rotation at all, so it
            // just keeps following the rig instead of snapping to a
            // first-person pose that wouldn't mean anything here.
            state.camera.position.set(state.player.position.x, state.player.position.y + TOPDOWN_HEIGHT, state.player.position.z + TOPDOWN_BACK_OFFSET);
            state.camera.lookAt(state.player.position.x, state.player.position.y, state.player.position.z);
        } else {
            state.camera.position.copy(state.player.position);
            state.camera.quaternion.setFromEuler(state.player.rotation);
        }
        return;
    }

    const gY = getElevation(state.player.position.x, state.player.position.z);
    state.player.isInWater = gY < WATER_LEVEL;
    state.player.isRunning = state.keys.shift && !state.player.isInWater;

    const speedMultiplier =
        (state.player.isRunning ? RUN_MULTIPLIER : 1) *
        (state.player.isInWater ? SWIM_SPEED_MULTIPLIER : 1);

    state.player.velocity.set(0, 0, 0);
    // Top-down mode: fixed world-space axes, since there's no mouse-look to
    // derive "forward" from. First-person: unchanged, camera-relative as
    // before. Both branches feed the same cross-product for `right` so the
    // a/d sign convention stays identical either way instead of risking a
    // hand-derived sign flip in a separate code path.
    const dir = new THREE.Vector3();
    if (state.viewMode === 'topdown') {
        dir.copy(TOPDOWN_FORWARD);
    } else {
        state.camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    }
    const right = new THREE.Vector3().crossVectors(state.camera.up, dir).normalize();
    if (state.keys.w) state.player.velocity.add(dir); if (state.keys.s) state.player.velocity.sub(dir);
    if (state.keys.a) state.player.velocity.add(right); if (state.keys.d) state.player.velocity.sub(right);

    const distFromCenter = Math.hypot(state.player.position.x, state.player.position.z);
    // theta of the player's current position picks out the local coastline
    // radius for this frame — cheap (one atan2 + two noise() calls) and
    // self-correcting as the player moves around the irregular shape.
    const theta = Math.atan2(state.player.position.z, state.player.position.x);
    const localBoundaryRadius = islandRadiusAt(theta);
    const localBoundaryStart = localBoundaryRadius - BOUNDARY_SOFT_ZONE;
    updateBoundaryMessage(state, distFromCenter, localBoundaryStart + BOUNDARY_SOFT_ZONE * 0.35);

    if (state.player.velocity.lengthSq() > 0) {
        state.player.velocity.normalize().multiplyScalar(state.player.speed * speedMultiplier * delta);

        // Wind resistance: past the local boundary start, cancel out however
        // much of the velocity points further outward, ramping in (eased, so
        // it's subtle at the zone's inner edge and firm by the time the
        // mountain ring is close).
        if (distFromCenter > localBoundaryStart) {
            _radialDir.set(state.player.position.x, 0, state.player.position.z).normalize();
            const outward = state.player.velocity.dot(_radialDir);
            if (outward > 0) {
                const zoneT = Math.min(1, (distFromCenter - localBoundaryStart) / BOUNDARY_SOFT_ZONE);
                state.player.velocity.addScaledVector(_radialDir, -outward * zoneT * zoneT);
            }
        }

        let nX = state.player.position.x + state.player.velocity.x; let nZ = state.player.position.z + state.player.velocity.z;
        let colX = false, colZ = false;
        for (const col of state.colliders) {
            if ((nX-col.x)**2 + (state.player.position.z-col.z)**2 < col.r**2) colX = true;
            if ((state.player.position.x-col.x)**2 + (nZ-col.z)**2 < col.r**2) colZ = true;
        }
        // Failsafe hard cap — resistance alone should always turn the player
        // back first, this just guarantees they can never clip past the ring.
        // Re-derives theta for the new position rather than reusing this
        // frame's, since a big diagonal move near a headland could otherwise
        // let the old angle's (larger) radius approve a point that's
        // actually past the new angle's (smaller) local coastline.
        const nDist = Math.hypot(nX, nZ);
        const nBoundaryRadius = islandRadiusAt(Math.atan2(nZ, nX));
        if (nDist > nBoundaryRadius) {
            const scale = nBoundaryRadius / nDist;
            nX *= scale; nZ *= scale;
        }
        if (!colX) state.player.position.x = nX;
        if (!colZ) state.player.position.z = nZ;

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

    if (state.viewMode === 'topdown') {
        // Fixed-angle rig — see the TOPDOWN_* constants' comment above for
        // why lookAt() rather than a hand-built quaternion, and why no
        // swim-roll: roll is a first-person immersion touch (the horizon
        // visibly tilting), which doesn't read as anything meaningful from
        // a fixed overhead angle — it would just make the rig itself look
        // like it's glitching rather than the water feeling rougher.
        state.camera.position.set(state.player.position.x, state.player.position.y + TOPDOWN_HEIGHT, state.player.position.z + TOPDOWN_BACK_OFFSET);
        state.camera.lookAt(state.player.position.x, state.player.position.y, state.player.position.z);
    } else {
        state.camera.position.copy(state.player.position);

        // Re-derive the camera orientation from player.rotation every frame
        // (cheap, and self-correcting) rather than touching camera.rotation.z
        // directly — camera.rotation defaults to XYZ Euler order, but
        // player.rotation is YXZ (see core/world-state.js), and mixing the two
        // via direct .rotation.z writes causes the quaternion to drift/spin
        // over time as the player looks around. Applying the swim roll as a
        // local-space quaternion multiply instead sidesteps that entirely.
        state.camera.quaternion.setFromEuler(state.player.rotation);
        if (state.player.isInWater) {
            const roll = Math.sin(performance.now() * SWIM_ROLL_FREQUENCY) * SWIM_ROLL_AMPLITUDE;
            _rollQuat.setFromAxisAngle(_forwardAxis, roll);
            state.camera.quaternion.multiply(_rollQuat);
        }
    }

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
