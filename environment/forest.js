// Recursive fractal branch generator (trunk -> branches -> leaves) for
// deciduous/maple trees. Uses state.branchMatrices/leafMatrices/
// branchColors/leafColors as instancing scratch buffers and pushes trunk
// colliders onto state.colliders. Reads state.globalTextures.leafTex.
//
// Pines are no longer generated here — the old low-poly layered-cone pine
// variant was replaced by the sparse detailed pine trees in
// environment/pine-trees.js (see PINE_TREE_COUNT there).

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { getElevation, noise } from './terrain.js';
import { addDynamicFog } from '../fx/dynamic-fog.js';

export async function generateFractalForest(state, onProgress) {
    const baseTrunkColor = new THREE.Color(0x28201a);

    function growBranch(matrix, depth, maxDepth, length, radius, leafBaseColor) {
        const branchMat = matrix.clone();
        const translate = new THREE.Matrix4().makeTranslation(0, length / 2, 0);
        const scale = new THREE.Matrix4().makeScale(radius, length, radius);
        branchMat.multiply(translate).multiply(scale);
        state.branchMatrices.push(branchMat);
        
        const bColor = baseTrunkColor.clone().offsetHSL(0, 0, depth * 0.04);
        state.branchColors.push(bColor.r, bColor.g, bColor.b);

        const endMat = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, length, 0));

        if (depth >= maxDepth) {
            for (let i = 0; i < 4; i++) {
                const leafRot = new THREE.Matrix4().makeRotationFromEuler(
                    new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI)
                );
                const leafScale = new THREE.Matrix4().makeScale(length*3.2, length*3.2, length*3.2);
                state.leafMatrices.push(endMat.clone().multiply(leafRot).multiply(leafScale));
                const lColor = leafBaseColor.clone().offsetHSL(Math.random()*0.1-0.05, Math.random()*0.2, Math.random()*0.1-0.05);
                state.leafColors.push(lColor.r, lColor.g, lColor.b);
            }
            return;
        }

        const numSplits = depth === 0 ? 3 + Math.floor(Math.random()*2) : (depth === 1 ? 3 : 2); 
        for (let i = 0; i < numSplits; i++) {
            const angleY = (Math.PI * 2 / numSplits) * i + (Math.random() * 0.8 - 0.4);
            const angleX = 0.35 + (depth * 0.12) + (Math.random() * 0.2);
            const rotMat = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(angleX, angleY, 0, 'YXZ'));
            growBranch(endMat.clone().multiply(rotMat), depth + 1, maxDepth, length * (0.68 + Math.random()*0.12), radius * 0.65, leafBaseColor);
        }
    }

    // Each tree is a recursive fractal branch walk (depth up to 5, 2-4 way
    // splits per node) — cheap individually but 780 of them (High quality)
    // back-to-back was the same kind of multi-second unbroken block as
    // grass's 1.1M instances. Yielding every 40 trees keeps it smooth
    // without the yields themselves costing anything meaningful.
    const YIELD_EVERY = 40;
    for (let i = 0; i < state.quality.treeCount; i++) {
        // Grove/clearing clustering: rejection-sample against a low-frequency
        // density mask instead of placing every tree at a uniformly random
        // spot. Pure uniform scatter is exactly why the forest read as
        // featureless haze in every direction — clustering trees into dense
        // groves with open clearings between them creates sightline walls
        // and navigable "rooms", the actual small-island-feels-big trick.
        let x, z, y, attempts = 0, density = 0;
        do {
            const r = 25 + Math.random() * (WORLD_SIZE/2 - 50);
            const theta = Math.random() * Math.PI * 2;
            x = Math.cos(theta) * r;
            z = Math.sin(theta) * r;
            y = getElevation(x, z);
            density = noise(x * 0.006 + 300, z * 0.006 - 300);
            attempts++;
        } while (Math.random() > density * 1.5 && attempts < 12);

        if (y < 1.4) continue; // Keep trees out of the deep lake

        const baseMatrix = new THREE.Matrix4().makeTranslation(x, y - 0.3, z);
        baseMatrix.multiply(new THREE.Matrix4().makeRotationY(Math.random() * Math.PI * 2));
        const s = 0.85 + Math.random() * 1.3;
        
        const biomeVal = noise(x * 0.008, z * 0.008);

        // Every procedurally-generated forest tree is now deciduous/maple —
        // pines are placed separately as sparse landmark trees, see
        // environment/pine-trees.js.
        let leafBase = new THREE.Color(0x244a1f); // Default Green
        if (biomeVal > 0.65) {
            // Maple Tree (Autumn colors based on biome)
            const autumn = [0x992211, 0xaa4411, 0xbb8811, 0xcc3311];
            leafBase.setHex(autumn[Math.floor(Math.random()*autumn.length)]);
        }
        growBranch(baseMatrix, 0, Math.random() > 0.8 ? 5 : 4, 7.5 * s, 0.75 * s, leafBase);
        state.colliders.push({ x: x, z: z, r: (0.7 * s) + 0.6 });

        if (i > 0 && i % YIELD_EVERY === 0) {
            if (onProgress) onProgress(i / state.quality.treeCount);
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    }

    // Create a more organic, bumpy trunk geometry instead of a perfect cylinder
    const trunkGeo = new THREE.CylinderGeometry(0.85, 1.25, 1, 16, 8); // Higher poly count (16 radial, 8 height) and tapered
    const trunkPos = trunkGeo.attributes.position;
    for (let j = 0; j < trunkPos.count; j++) {
        const x = trunkPos.getX(j);
        const y = trunkPos.getY(j);
        const z = trunkPos.getZ(j);
        const rad = Math.sqrt(x*x + z*z);
        if (rad > 0.1) {
            const angle = Math.atan2(z, x);
            // More intense, multi-frequency organic vertex displacement
            const bump = 1.0 
                + 0.22 * Math.sin(angle * 4.0 + y * 8.0) 
                + 0.15 * Math.cos(angle * 7.0 - y * 12.0)
                + 0.08 * Math.sin(angle * 13.0 + y * 20.0);
            
            // Add a slight twisting effect to the trunk
            const twist = y * 0.8;
            const nx = x * Math.cos(twist) - z * Math.sin(twist);
            const nz = x * Math.sin(twist) + z * Math.cos(twist);
            
            trunkPos.setX(j, nx * bump);
            trunkPos.setZ(j, nz * bump);
        }
    }
    trunkGeo.computeVertexNormals();

    const trunkMat = new THREE.MeshStandardMaterial({ roughness: 0.95, color: 0xffffff });
    
    // Add custom shader to procedurally blend bark grooves and dynamic moss
    trunkMat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vLocalPos;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPos;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vLocalPos = position;
            vWorldPos = (instanceMatrix * vec4(position, 1.0)).xyz;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <defaultnormal_vertex>',
            `#include <defaultnormal_vertex>
            // Transform normal to world space for realistic directional moss
            vWorldNormal = normalize(mat3(instanceMatrix) * objectNormal);`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vLocalPos;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPos;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            vec4 diffuseColor = vec4( diffuse, opacity );
            
            // Procedural bark grooves based on local position
            float barkNoise = sin(vLocalPos.x * 12.0 + vLocalPos.y * 4.0) * cos(vLocalPos.z * 12.0 + vLocalPos.y * 4.0);
            barkNoise = smoothstep(-1.0, 1.0, barkNoise);
            vec3 barkDark = diffuse * 0.35;
            diffuseColor.rgb = mix(barkDark, diffuse, barkNoise * 0.5 + 0.5);

            // Procedural moss clustered on upward-facing normals and closer to the ground
            float upFactor = clamp(vWorldNormal.y + 0.1, 0.0, 1.0);
            float heightFactor = clamp(1.0 - (vWorldPos.y / 25.0), 0.0, 1.0); 
            
            // Break up the moss with world-space noise
            float n = sin(vWorldPos.x * 6.0) * cos(vWorldPos.y * 8.0) * sin(vWorldPos.z * 6.0);
            float mossAmount = clamp((upFactor * heightFactor * 0.95) + (n * 0.25), 0.0, 1.0);
            
            vec3 mossColor = vec3(0.12, 0.28, 0.08); // Deep forest moss green
            diffuseColor.rgb = mix(diffuseColor.rgb, mossColor, mossAmount);
            `
        );
    };

    // Trees near the boundary are the main thing whose silhouettes read as
    // a hard edge against the sky — melt them into the actual sky/mountain
    // color behind them instead of a flat fog tint (fx/dynamic-fog.js).
    // Called after the bark/moss onBeforeCompile above so it wraps rather
    // than replaces it.
    addDynamicFog(trunkMat, state.backgroundRenderTarget.texture);

    const branchMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, state.branchMatrices.length);
    branchMesh.castShadow = true; branchMesh.receiveShadow = true;
    branchMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.branchColors), 3);
    for(let i=0; i < state.branchMatrices.length; i++) branchMesh.setMatrixAt(i, state.branchMatrices[i]);
    state.scene.add(branchMesh);

    const leafGeo = new THREE.PlaneGeometry(1.4, 1.4);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide, map: state.globalTextures.leaf, alphaTest: 0.4, transparent: true });
    leafMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        leafMat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vec4 leafWorldPos = instanceMatrix * vec4(position, 1.0);
            float flutter = sin(leafWorldPos.x * 4.0 + uTime * 2.5) * cos(leafWorldPos.z * 4.0 + uTime * 1.8) * 0.08;
            transformed.xyz += flutter;`
        );
    };
    addDynamicFog(leafMat, state.backgroundRenderTarget.texture);

    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, state.leafMatrices.length);
    // Optimized: Disabled leaf shadows. Overlapping transparent shadows on millions of instances causes severe overdraw
    leafMesh.castShadow = false; 
    leafMesh.receiveShadow = false;
    leafMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.leafColors), 3);
    for(let i=0; i < state.leafMatrices.length; i++) leafMesh.setMatrixAt(i, state.leafMatrices[i]);
    state.scene.add(leafMesh);
}