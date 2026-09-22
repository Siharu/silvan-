import * as THREE from 'three';
import { state, WORLD_SIZE, WATER_LEVEL } from './state.js';
import { getElevation } from './utils.js';

export function updatePlayer(delta) {
    if (!state.isLocked) return;
    state.player.velocity.set(0, 0, 0);
    const dir = new THREE.Vector3(); state.camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const right = new THREE.Vector3().crossVectors(state.camera.up, dir).normalize();
    if (state.keys.w) state.player.velocity.add(dir); if (state.keys.s) state.player.velocity.sub(dir);
    if (state.keys.a) state.player.velocity.add(right); if (state.keys.d) state.player.velocity.sub(right);
    if (state.player.velocity.lengthSq() > 0) {
        state.player.velocity.normalize().multiplyScalar(state.player.speed * delta);
        let nX = state.player.position.x + state.player.velocity.x; let nZ = state.player.position.z + state.player.velocity.z;
        let colX = false, colZ = false;
        for (const col of state.colliders) {
            if ((nX-col.x)**2 + (state.player.position.z-col.z)**2 < col.r**2) colX = true;
            if ((state.player.position.x-col.x)**2 + (nZ-col.z)**2 < col.r**2) colZ = true;
        }
        // Ocean acts as a wall: block movement onto any ground tile that
        // sits below the water surface, same pattern as the collider check
        // above (per-axis, so grazing the shoreline at an angle still slides).
        if (getElevation(nX, state.player.position.z) < WATER_LEVEL) colX = true;
        if (getElevation(state.player.position.x, nZ) < WATER_LEVEL) colZ = true;
        if (!colX && Math.abs(nX) < WORLD_SIZE/2) state.player.position.x = nX;
        if (!colZ && Math.abs(nZ) < WORLD_SIZE/2) state.player.position.z = nZ;
        if (performance.now() - state.stepTimer > 450) { state.stepAudio.play(); state.stepTimer = performance.now(); }
        const b = Math.sin(performance.now()*0.012)*0.1;
        const gY = Math.max(getElevation(state.player.position.x, state.player.position.z), WATER_LEVEL);
        state.player.position.y += (gY + state.player.height + b - state.player.position.y) * (1.0 - Math.exp(-12.0 * delta));
    } else {
        const gY = Math.max(getElevation(state.player.position.x, state.player.position.z), WATER_LEVEL);
        state.player.position.y += (gY + state.player.height - state.player.position.y) * (1.0 - Math.exp(-8.0 * delta));
    }
    state.camera.position.copy(state.player.position);
}