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

// placements: array of { x, y, z, scaleX, scaleY, scaleZ, rotX, rotY, rotZ, colorHex?, extraValue? }
// rotX/rotZ are optional (default 0) — only bushes.js's leaf clumps need
// full 3-axis rotation; flowers.js/fireflies.js only ever needed rotY.
//
// extraAttribute (optional): { name, getValue } — for fields that need a
// genuine per-instance shader input beyond transform/color (rocks.js's
// per-instance displacement seed, which used to be a per-Mesh uniform
// before rocks were converted to instancing here). getValue(item) reads
// the value off each placement item; stored as a 1-component
// InstancedBufferAttribute named `name`, so the material's vertex shader
// can read it as `attribute float <name>;`.
//
// Note on why this needs its own geometry per chunk rather than reusing
// the single shared `geometry` param directly: instanced custom
// attributes live on the geometry object, and `geometry` here is shared
// across every chunk (cheap — no data duplication for the base
// position/normal/uv/index buffers). Writing a per-chunk attribute
// straight onto that shared object would have each new chunk silently
// overwrite the previous chunk's seed data. So when extraAttribute is
// used, each chunk gets a lightweight BufferGeometry that shares the
// base geometry's attribute buffers by reference (no copying — index,
// position, normal, uv all reused as-is) and only owns its own unique
// instanced attribute.
export function buildChunkedInstancedField({ scene, geometry, material, worldExtent, cellSize, drawDistance, placements, extraAttribute, boundsPadding = 0 }) {
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
        let chunkGeometry = geometry;
        if (extraAttribute) {
            chunkGeometry = new THREE.BufferGeometry();
            chunkGeometry.index = geometry.index;
            for (const attrName in geometry.attributes) chunkGeometry.setAttribute(attrName, geometry.attributes[attrName]);
            // NOT copying geometry.boundingSphere here — on a freshly
            // built geometry (e.g. rocks.js's IcosahedronGeometry) it's
            // null until something computes it, and cloning null would
            // throw. mesh.computeBoundingSphere() below already computes
            // it fresh from chunkGeometry's own position attribute (which
            // is a real shared reference, not a copy, so this is a cheap
            // one-time-per-chunk read, not duplicated vertex data) if it
            // isn't already set — no need to pre-seed it here.
            const values = new Float32Array(items.length);
            for (let i = 0; i < items.length; i++) values[i] = extraAttribute.getValue(items[i]);
            chunkGeometry.setAttribute(extraAttribute.name, new THREE.InstancedBufferAttribute(values, 1));
        }

        const mesh = new THREE.InstancedMesh(chunkGeometry, material, items.length);
        let hasColor = false;

        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            dummy.position.set(it.x, it.y, it.z);
            dummy.scale.set(it.scaleX ?? 1, it.scaleY ?? 1, it.scaleZ ?? 1);
            dummy.rotation.set(it.rotX ?? 0, it.rotY ?? 0, it.rotZ ?? 0);
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
        if (boundsPadding > 0) mesh.boundingSphere.radius += boundsPadding; // for materials that displace vertices in the shader beyond the base geometry's bounds (rocks.js's noise displacement) — computeBoundingSphere() only knows about the undisplaced geometry+transform, so without this, chunks could pop in/out right at the screen edge where the cull test disagrees with what's actually rendered

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
