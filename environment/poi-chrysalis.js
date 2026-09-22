// The Chrysalis (overgrown bunker) — ported from
// the_hearth_isometric_map__1_.html's buildOvergrownBunker(). Note in the
// source: the "glowing moss" in the POI's flavor text has no actual
// geometry built for it here — just the concrete shell, door, and light.
import * as THREE from 'three';
import { state } from '../core/state.js';

export function createChrysalis(x, y, z) {
    const group = new THREE.Group();

    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x4a4f4c, flatShading: true, roughness: 0.95 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1a, metalness: 0.6, roughness: 0.4 });

    const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(4.5, 4.5, 6, 10, 1, false, 0, Math.PI),
        concreteMat
    );
    shell.rotation.z = Math.PI / 2; // lying on its side, half-buried dome look
    group.add(shell);

    const door = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, 0.4), doorMat);
    door.position.set(3, 0, 0);
    group.add(door);

    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.3), doorMat);
    bracket.position.set(3, 2, 0);
    group.add(bracket);

    const securityLight = new THREE.PointLight(0xff0000, 2.5, 15);
    securityLight.position.set(3, 2.1, 0);
    group.add(securityLight);

    group.position.set(x, y, z);
    group.rotation.y = THREE.MathUtils.degToRad(120);
    state.scene.add(group);
    return group;
}
