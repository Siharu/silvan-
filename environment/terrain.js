import * as THREE from 'three';
import { state } from '../core/state.js';
import { getElevation } from '../core/utils.js';

export function createTerrain() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 300, 300);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, getElevation(x, z));
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ 
        color: 0x141a0f, 
        roughness: 1.0, 
        metalness: 0.0
    });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    state.scene.add(terrain);
}

