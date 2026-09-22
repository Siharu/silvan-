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

                // The source .glb has a ~100x scale baked into an internal
                // node matrix (leftover from its original FBX conversion),
                // so the file's native size is roughly 100x too large for
                // this world — normalize by measuring the actual world-space
                // bounding box (which respects all baked node transforms)
                // and rescaling to a fixed target size, rather than trusting
                // the file's own scale.
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const TARGET_LENGTH = 45; // desired longest-axis size, in world units
                const scale = TARGET_LENGTH / Math.max(size.x, size.y, size.z);
                model.scale.setScalar(scale);

                // Re-measure post-scale, then reposition so the model's
                // center (not its unrelated local origin) lands at (x, z),
                // resting on the ocean floor relative to WATER_LEVEL.
                const scaledCenter = center.multiplyScalar(scale);
                const scaledBox = new THREE.Box3().setFromObject(model);
                const scaledSize = scaledBox.getSize(new THREE.Vector3());
                model.position.set(
                    x - scaledCenter.x,
                    (WATER_LEVEL - 10) - scaledCenter.y + scaledSize.y / 2,
                    z - scaledCenter.z
                );

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