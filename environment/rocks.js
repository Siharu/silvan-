import * as THREE from 'three';
import { state, WATER_LEVEL, WORLD_SIZE } from '../core/state.js';
import { heightAt as getElevation } from '../core/heightmap.js';
import { pathAt } from '../core/splat.js';

import { rngFor } from '../core/rng.js';
const rand = rngFor('rocks');
export function createRocks() {
    const rockCount = 900; // was 550, scaled by 1.64x world area
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const pos = geo.attributes.position;
    for(let i=0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        v.multiplyScalar(1.0 + 0.25 * Math.sin(v.x * 4.0) * Math.cos(v.y * 4.0));
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    
    const rockMat = new THREE.MeshStandardMaterial({ 
        color: 0x4a4f55, 
        roughness: 0.9, 
        metalness: 0.1 
    });
    
    const rockMesh = new THREE.InstancedMesh(geo, rockMat, rockCount);
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let i = 0; i < 123; i++) { // was 75, scaled by 1.64x world area
        const r = 25 + rand() * (WORLD_SIZE * 0.4 - 25); // was hardcoded 320 (0.4 * old 800) — now scales with world size
        const th = rand() * Math.PI * 2;
        const cx = Math.cos(th) * r; const cz = Math.sin(th) * r;
        const num = 2 + Math.floor(rand() * 5);
        for (let j = 0; j < num && idx < rockCount; j++) {
            const rx = cx + (rand() - 0.5) * 12;
            const rz = cz + (rand() - 0.5) * 12;
            let ry = getElevation(rx, rz);
            // Phase 7 #39: elevation floor, matching forest.js/flowers.js — skip
            // rocks that would spawn on seabed under the water surface.
            if (ry < WATER_LEVEL) continue;
            if (pathAt(rx, rz) > 0.2) continue; // keep trails walkable
            const s = 1.0 + rand() * 4.5;
            dummy.position.set(rx, ry - s*0.2, rz);
            dummy.rotation.set(0, rand()*Math.PI*2, 0);
            dummy.scale.set(s*(0.8+rand()*0.4), s*(0.6+rand()*0.4), s*(0.8+rand()*0.4));
            dummy.updateMatrix();
            rockMesh.setMatrixAt(idx++, dummy.matrix);
            state.colliders.push({ x: rx, z: rz, r: s * 0.75 });
        }
    }
    rockMesh.count = idx; // only draw instances actually placed (unset ones sat at the origin)
    state.scene.add(rockMesh);
}

