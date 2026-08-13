// Flower field instancing — crossed double-plane billboards, biome-based
// color palette selection via noise().

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { getElevation, noise } from './terrain.js';

export function createFlowers(state) {
    const FLOWER_RADIUS = WORLD_SIZE * 0.35;
    const count = 24000;
    
    // Manually construct crossed planes for foliage billboarding
    const basePlane = new THREE.PlaneGeometry(1.2, 1.2);
    basePlane.translate(0, 0.6, 0); // anchor at bottom
    const plane2 = basePlane.clone(); plane2.rotateY(Math.PI / 2);
    
    const pos1 = basePlane.attributes.position.array;
    const pos2 = plane2.attributes.position.array;
    const uv1 = basePlane.attributes.uv.array;
    
    const mergedPos = new Float32Array([...pos1, ...pos2]);
    const mergedUv = new Float32Array([...uv1, ...uv1]);
    const idx1 = basePlane.index.array;
    const idx2 = idx1.map(i => i + 4);
    const mergedIdx = new Uint16Array([...idx1, ...idx2]);
    
    const flowerGeo = new THREE.BufferGeometry();
    flowerGeo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    flowerGeo.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
    flowerGeo.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
    flowerGeo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ 
        color: 0xffffff, 
        map: state.globalTextures.flower,
        transparent: true,
        alphaTest: 0.3, // Removes background
        side: THREE.DoubleSide,
        roughness: 0.9 
    });
    
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        mat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime;`);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vec4 wPos = instanceMatrix * vec4(position, 1.0);
            // Beautiful organic wind sway tied to flower height
            transformed.x += sin(wPos.x * 4.0 + uTime * 1.5) * 0.15 * position.y;
            transformed.z += cos(wPos.z * 4.0 + uTime * 1.5) * 0.15 * position.y;
        `);
    };

    state.flowerMesh = new THREE.InstancedMesh(flowerGeo, mat, count);
    const dummy = new THREE.Object3D();
    const colors = [];
    // White Daisy, Blue Forget-me-not, Violet, Goldenrod
    const palette = [new THREE.Color(0xffffff), new THREE.Color(0x4488ff), new THREE.Color(0xa255ff), new THREE.Color(0xffcc22)];
    
    let valid = 0;
    for (let i = 0; i < count * 3 && valid < count; i++) {
        const r = Math.sqrt(Math.random()) * FLOWER_RADIUS;
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z);
        
        if (y < 1.8) continue; 
        
        const biome = noise(x * 0.02, z * 0.02);
        if (biome > 0.5) { // Cluster flower fields
            dummy.position.set(x, y - 0.1, z); // Sink into grass slightly
            dummy.rotation.set(0, Math.random()*Math.PI, 0); // Random spin
            const s = 0.4 + Math.random() * 0.6;
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            state.flowerMesh.setMatrixAt(valid, dummy.matrix);
            
            // Group colors by micro-biomes
            const c = palette[Math.floor((biome - 0.5) * 2 * palette.length) % palette.length] || palette[0];
            colors.push(c.r, c.g, c.b);
            valid++;
        }
    }
    state.flowerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
    state.flowerMesh.count = valid;
    state.scene.add(state.flowerMesh);
}

