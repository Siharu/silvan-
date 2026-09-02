// Chunked instancing — the actual perf lever for large scattered fields
// (grass, foliage, rocks) that were previously one InstancedMesh spanning
// the whole map. A single mesh like that has one bounding sphere covering
// every instance, so Three's default per-object frustum cull can never
// discard it — it's "on screen" from the object's perspective even when
// 95% of its instances are behind the camera. Splitting into a grid of
// small InstancedMeshes gives each chunk a bounding sphere tight enough
// for frustum culling to actually reject most of them, plus lets whole
// chunks be hidden past a draw-distance radius (distance culling).
//
// True occlusion culling (hiding geometry blocked by nearer geometry, not
// just outside the view frustum) isn't implemented here — Three.js has no
// built-in occlusion query path, and a hand-rolled GPU-query version is a
// lot of complexity for a scene like this where distance + frustum
// culling already remove the vast majority of the cost. Flagging that
// explicitly rather than silently only doing half the ask.

import * as THREE from 'three';

// placements: array of { x, y, z, scaleX, scaleY, scaleZ, rotY, colorHex? }
export function buildChunkedInstancedField({ scene, geometry, material, worldExtent, cellSize, drawDistance, placements }) {
    const half = worldExtent / 2;
    const cells = new Map();

    for (const p of placements) {
        const cx = Math.floor((p.x + half) / cellSize);
        const cz = Math.floor((p.z + half) / cellSize);
        const key = cx + ',' + cz;
        let bucket = cells.get(key);
        if (!bucket) cells.set(key, bucket = []);
        bucket.push(p);
    }

    const dummy = new THREE.Object3D();
    const chunks = [];

    for (const [key, items] of cells) {
        const mesh = new THREE.InstancedMesh(geometry, material, items.length);
        let hasColor = false;

        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            dummy.position.set(it.x, it.y, it.z);
            dummy.scale.set(it.scaleX ?? 1, it.scaleY ?? 1, it.scaleZ ?? 1);
            dummy.rotation.set(0, it.rotY ?? 0, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            if (it.colorHex !== undefined) {
                hasColor = true;
                mesh.setColorAt(i, new THREE.Color(it.colorHex));
            }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (hasColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        mesh.frustumCulled = true;
        // InstancedMesh's own computeBoundingSphere() (distinct from the
        // base geometry's) accounts for every instance's transform, so
        // this chunk's cull test is against its actual instance spread,
        // not the single-blade/single-frond geometry bounds.
        mesh.computeBoundingSphere();

        const [cx, cz] = key.split(',').map(Number);
        mesh.userData.chunkCenterX = (cx + 0.5) * cellSize - half;
        mesh.userData.chunkCenterZ = (cz + 0.5) * cellSize - half;

        scene.add(mesh);
        chunks.push(mesh);
    }

    return {
        chunks,
        // Call once per frame with the camera's world position.
        update(camPos) {
            const dd2 = drawDistance * drawDistance;
            for (const mesh of chunks) {
                const dx = camPos.x - mesh.userData.chunkCenterX;
                const dz = camPos.z - mesh.userData.chunkCenterZ;
                mesh.visible = (dx * dx + dz * dz) < dd2;
            }
        }
    };
}
