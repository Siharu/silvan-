// The Broken Shell (sunken freighter) — the only POI supplied as a real
// authored model (broken_shell.glb) rather than a procedural build, so it
// loads through GLTFLoader instead of constructing THREE geometry by hand.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { state, WATER_LEVEL } from '../core/state.js';
import * as THREE from 'three';

const loader = new GLTFLoader();

export function createBrokenShell(x, _y, z) {
    return new Promise((resolve, reject) => {
        loader.load(
            './assets/broken_shell.glb',
            (gltf) => {
                const model = gltf.scene;
                // -35m alt in the source map (underwater) — placed relative
                // to WATER_LEVEL rather than getElevation(x, z), since this
                // sits on the open ocean floor away from the island, not on
                // island terrain the way the other POIs do.
                model.position.set(x, WATER_LEVEL - 10, z);
                model.traverse((child) => {
                    if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
                });
                state.scene.add(model);

                const light = new THREE.PointLight(0x06b6d4, 2, 40);
                light.position.set(x, WATER_LEVEL - 6, z);
                state.scene.add(light);

                resolve(model);
            },
            undefined,
            (err) => {
                console.error('Failed to load broken_shell.glb', err);
                reject(err);
            }
        );
    });
}
