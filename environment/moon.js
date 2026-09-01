// Visual moon mesh + glow, ported from day_night_cycle.html's
// moonMesh/moonGlow setup. Positioned each frame in
// atmosphere/day-night-cycle.js alongside moonLight (same direction,
// just pushed out to a fixed visual distance instead of the light's
// short gameplay-range position).

import * as THREE from 'three';

export const MOON_DISTANCE = 900; // inside camera.far (1500, see main.js) with margin

export function createMoon(state) {
    const moonGeo = new THREE.SphereGeometry(30, 32, 32);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xdfe6f5 });
    state.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    state.moonMesh.castShadow = false;
    state.moonMesh.receiveShadow = false;

    // Soft point light for a localized glow — cheap (no shadow casting),
    // separate from moonLight (the actual directional gameplay light).
    state.moonGlow = new THREE.PointLight(0x99aaff, 1.2, 400);
    state.moonMesh.add(state.moonGlow);

    state.scene.add(state.moonMesh);
}
