import * as THREE from 'three';
import { state, WATER_LEVEL } from '../core/state.js';
import { getElevation } from '../core/utils.js';

export function createRocks() {
    const rockCount = 550; 
    const geo = new THREE.IcosahedronGeometry(1, 3);
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
    for (let i = 0; i < 75; i++) {
        const r = 25 + Math.random() * 320;
        const th = Math.random() * Math.PI * 2;
        const cx = Math.cos(th) * r; const cz = Math.sin(th) * r;
        const num = 2 + Math.floor(Math.random() * 5);
        for (let j = 0; j < num && idx < rockCount; j++) {
            const rx = cx + (Math.random() - 0.5) * 12;
            const rz = cz + (Math.random() - 0.5) * 12;
            let ry = getElevation(rx, rz);
            // Phase 7 #39: elevation floor, matching forest.js/flowers.js — skip
            // rocks that would spawn on seabed under the water surface.
            if (ry < WATER_LEVEL) continue;
            const s = 1.0 + Math.random() * 4.5;
            dummy.position.set(rx, ry - s*0.2, rz);
            dummy.rotation.set(0, Math.random()*Math.PI*2, 0);
            dummy.scale.set(s*(0.8+Math.random()*0.4), s*(0.6+Math.random()*0.4), s*(0.8+Math.random()*0.4));
            dummy.updateMatrix();
            rockMesh.setMatrixAt(idx++, dummy.matrix);
            state.colliders.push({ x: rx, z: rz, r: s * 0.75 });
        }
    }
    rockMesh.count = idx; // only draw instances actually placed (unset ones sat at the origin)
    state.scene.add(rockMesh);
}

