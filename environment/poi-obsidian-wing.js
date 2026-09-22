// The Obsidian Wing (ancient monolith) — ported from
// the_hearth_isometric_map__1_.html's buildAncientMonolith(). Note in the
// source: fragments are placed at angle=i (raw index in radians, i=0..5),
// not i/6*2*PI — they cluster unevenly around the pillar rather than
// spacing perfectly even, kept as-is rather than "fixed" since that's
// the actual reference look.
import * as THREE from 'three';
import { state } from '../core/state.js';

export function createObsidianWing(x, y, z) {
    const group = new THREE.Group();

    const obsidianMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.1, metalness: 0.9 });
    const fragmentMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });

    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, 16, 6), obsidianMat);
    pillar.position.y = 7;
    group.add(pillar);

    for (let i = 0; i < 6; i++) {
        const frag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4), fragmentMat);
        frag.position.set(
            Math.cos(i) * 4,
            8 + (Math.random() - 0.5) * 4, // height 8±2
            Math.sin(i) * 4
        );
        frag.rotation.set(Math.random(), Math.random(), Math.random());
        group.add(frag);

        const fragLight = new THREE.PointLight(0xa855f7, 0.6, 6);
        fragLight.position.copy(frag.position);
        group.add(fragLight);
    }

    const mainLight = new THREE.PointLight(0xa855f7, 3, 25);
    mainLight.position.set(0, 8, 0);
    group.add(mainLight);

    group.position.set(x, y, z);
    group.rotation.y = THREE.MathUtils.degToRad(30);
    state.scene.add(group);
    return group;
}
