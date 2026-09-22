// Ruined Cabin — ported from the_hearth_isometric_map__1_.html's
// buildRuinedCabin(). Kept the plain original name/description per the
// revert away from "The Sunken Ribcage" lore reskin — geometry itself is
// unchanged from that file either way.
import * as THREE from 'three';
import { state } from '../core/state.js';

export function createRuinedCabin(x, y, z) {
    const group = new THREE.Group();

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, flatShading: true });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x211510, flatShading: true });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x374151, flatShading: true, roughness: 1 });

    // Deck planks
    for (let px = -3; px <= 3; px += 0.8) {
        if (Math.random() < 0.15) continue; // gaps in the deck
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.15, 6), woodMat);
        plank.position.set(px, 0.075, 0);
        plank.rotation.y = (Math.random() - 0.5) * 0.08;
        group.add(plank);
    }

    function buildWall(px, pz, h, rotX, rotZ) {
        const wall = new THREE.Group();
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), postMat);
        post.position.y = h / 2;
        wall.add(post);
        for (let wy = 0.3; wy < h; wy += 0.55) {
            if (Math.random() < 0.3) continue; // decayed gaps
            const log = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 2.5), woodMat);
            log.position.set(0, wy, 1.2);
            wall.add(log);
        }
        wall.position.set(px, 0, pz);
        wall.rotation.x = rotX;
        wall.rotation.z = rotZ;
        group.add(wall);
    }
    buildWall(-3.2, 0, 3.2, 0, 0.08);
    buildWall(3.2, 0, 2.8, 0, -0.15);
    buildWall(0, -3, 3.0, 0.12, 0);

    // Crumbling stone chimney
    const chimney = new THREE.Group();
    for (let course = 0; course < 11; course++) {
        if (course > 7 && Math.random() < 0.45) continue; // collapsing upper courses
        const brick = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.4), stoneMat);
        brick.position.set(
            (Math.random() - 0.5) * 0.15,
            course * 0.4 + 0.2,
            (Math.random() - 0.5) * 0.15
        );
        chimney.add(brick);
    }
    chimney.position.set(2.8, 0, -2.2);
    group.add(chimney);

    const light = new THREE.PointLight(0xeab308, 1.8, 14);
    light.position.set(0, 1.2, 0);
    group.add(light);

    group.position.set(x, y, z);
    group.rotation.y = -Math.PI / 4;
    state.scene.add(group);
    return group;
}
