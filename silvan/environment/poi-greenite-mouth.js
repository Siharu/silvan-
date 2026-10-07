// Greenite Mouth — ported from the_hearth_isometric_map__1_.html's
// buildGreeniteMouth(). The two "fang" cones are deliberately asymmetric
// (different sizes/tilts), matching the reference's torn-open-jaw look
// rather than a mirrored archway.
import * as THREE from 'three';
import { state } from '../core/state.js';

import { rngFor } from '../core/rng.js';
const rand = rngFor('greenite');
export function createGreeniteMouth(x, y, z) {
    const group = new THREE.Group();

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x1b2821, flatShading: true, roughness: 1 });
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x050a06 });
    // Phase 4 #32: was saturated neon green (0x22c55e/0x15803d) — sci-fi
    // coded, clashed with Map 1's cozy-first pacing. Warmed to a gold
    // crystal glow so the spikes still read as "mineral and lit" without
    // the toxic/alien cue.
    const crystalMat = new THREE.MeshStandardMaterial({
        color: 0xd4a017, emissive: 0x8a5a12, roughness: 0.3, metalness: 0.6
    });

    const leftFang = new THREE.Mesh(new THREE.ConeGeometry(3.5, 9, 5), rockMat);
    leftFang.position.set(-2.5, 4.5, 0);
    leftFang.rotation.z = -0.3;
    group.add(leftFang);

    const rightFang = new THREE.Mesh(new THREE.ConeGeometry(4.0, 11, 5), rockMat);
    rightFang.position.set(2.8, 5.5, 0);
    rightFang.rotation.z = 0.35;
    group.add(rightFang);

    const voidInterior = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 4, 6), voidMat);
    voidInterior.rotation.z = Math.PI / 2;
    voidInterior.position.set(0, 2.5, -1.5);
    group.add(voidInterior);

    // 9 crystal spikes in a ~216-degree arc facing outward from the mouth
    for (let i = 0; i < 9; i++) {
        const angle = THREE.MathUtils.degToRad((i / 8) * 216 - 108);
        const radius = 1.8 + rand() * 1.0;
        const spike = new THREE.Mesh(
            new THREE.ConeGeometry(0.4 + rand() * 0.4, 2 + rand() * 2.5, 6),
            crystalMat
        );
        spike.position.set(Math.cos(angle) * radius, 1.5, Math.sin(angle) * radius);
        spike.rotation.set(
            (rand() - 0.5) * 0.6,
            rand() * Math.PI * 2,
            (rand() - 0.5) * 0.6
        );
        group.add(spike);
    }

    const light = new THREE.PointLight(0xd4a017, 3.5, 20);
    light.position.set(0, 2.5, 0);
    group.add(light);

    group.position.set(x, y, z);
    group.rotation.y = THREE.MathUtils.degToRad(60);
    state.scene.add(group);
    return group;
}
