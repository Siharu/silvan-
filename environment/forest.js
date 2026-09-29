import * as THREE from 'three';
import { state, WORLD_SIZE, TREE_COUNT } from '../core/state.js';
import { noise } from '../core/utils.js';
import { heightAt as getElevation, slopeAt } from '../core/heightmap.js';
import { POIS } from './pois.js';
import { pathAt, rockAt } from '../core/splat.js';

import { rngFor } from '../core/rng.js';
const rand = rngFor('forest');
export function generateFractalForest() {
    const baseTrunkColor = new THREE.Color(0x28201a);
    const pineLeafMatrices = [];
    const pineLeafColors = [];
    const trunkM = [], trunkC = [];   // depth-0 trunks + pine trunks -> high-res mesh; thin branches -> low-res mesh

    function growBranch(matrix, depth, maxDepth, length, radius, leafBaseColor) {
        const branchMat = matrix.clone();
        const translate = new THREE.Matrix4().makeTranslation(0, length / 2, 0);
        const scale = new THREE.Matrix4().makeScale(radius, length, radius);
        branchMat.multiply(translate).multiply(scale);
        (depth === 0 ? trunkM : state.branchMatrices).push(branchMat);
        
        const bColor = baseTrunkColor.clone().offsetHSL(0, 0, depth * 0.04);
        (depth === 0 ? trunkC : state.branchColors).push(bColor.r, bColor.g, bColor.b);

        const endMat = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, length, 0));

        if (depth >= maxDepth) {
            for (let i = 0; i < 4; i++) {
                const leafRot = new THREE.Matrix4().makeRotationFromEuler(
                    new THREE.Euler(rand()*Math.PI, rand()*Math.PI, rand()*Math.PI)
                );
                const leafScale = new THREE.Matrix4().makeScale(length*3.2, length*3.2, length*3.2);
                state.leafMatrices.push(endMat.clone().multiply(leafRot).multiply(leafScale));
                const lColor = leafBaseColor.clone().offsetHSL(rand()*0.1-0.05, rand()*0.2, rand()*0.1-0.05);
                state.leafColors.push(lColor.r, lColor.g, lColor.b);
            }
            return;
        }

        const numSplits = depth === 0 ? 3 + Math.floor(rand()*2) : (depth === 1 ? 3 : 2); 
        for (let i = 0; i < numSplits; i++) {
            const angleY = (Math.PI * 2 / numSplits) * i + (rand() * 0.8 - 0.4);
            const angleX = 0.35 + (depth * 0.12) + (rand() * 0.2);
            const rotMat = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(angleX, angleY, 0, 'YXZ'));
            growBranch(endMat.clone().multiply(rotMat), depth + 1, maxDepth, length * (0.68 + rand()*0.12), radius * 0.65, leafBaseColor);
        }
    }

    for (let i = 0; i < TREE_COUNT; i++) {
        const r = 25 + rand() * (WORLD_SIZE/2 - 50);
        const theta = rand() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z);
        
        if (y < 4.0) continue;
        if (slopeAt(x, z) > 35) continue;                 // no trees on cliffs
        if (Math.hypot(x, z + 12) < 55) continue;         // none in the crater bowl
        if (POIS.some((p) => Math.hypot(x - p.x, z - p.z) < (p.radius || 10) + 10)) continue; // keep POIs clear
        if (pathAt(x, z) > 0.15) continue;                // keep trails open (splat mask, audit 6.3)
        if (rockAt(x, z) > 0.6) continue;                 // no trees on bare rock
        // // Keep trees off the wet sand/beach — matches terrain.js's own wet-sand-to-lowland line (y < 4.0), not the old lake-basin's waterline this threshold was originally tuned against

        const baseMatrix = new THREE.Matrix4().makeTranslation(x, y - 0.3, z);
        baseMatrix.multiply(new THREE.Matrix4().makeRotationY(rand() * Math.PI * 2));
        const s = 0.85 + rand() * 1.3;
        
        const biomeVal = noise(x * 0.008, z * 0.008);
        
        if (biomeVal < 0.35 && y > 3.5) {
            // PINE TREE: trunk ends INSIDE the crown (no bare stub), tiers overlap, top apex = total height
            const H = 16 * s, trunkH = H * 0.8;
            trunkM.push(baseMatrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, trunkH / 2, 0)).multiply(new THREE.Matrix4().makeScale(0.5 * s, trunkH, 0.5 * s)));
            trunkC.push(0.18, 0.14, 0.11);
            const n = 6 + Math.floor(rand() * 3);
            const pcBase = new THREE.Color(0x22452a).offsetHSL(rand() * 0.03 - 0.015, 0.05, rand() * 0.05 - 0.025);
            for (let j = 0; j < n; j++) {
                const t = j / (n - 1);
                const hk = H * (0.30 - 0.13 * t);
                const yk = H * 0.16 + t * (H * 0.84 - H * 0.17);
                const R = H * (0.27 - 0.21 * Math.pow(t, 0.9)) * (0.92 + rand() * 0.16);
                pineLeafMatrices.push(baseMatrix.clone()
                    .multiply(new THREE.Matrix4().makeTranslation(0, yk, 0))
                    .multiply(new THREE.Matrix4().makeRotationY(rand() * Math.PI))
                    .multiply(new THREE.Matrix4().makeScale(R, hk, R)));
                const pc = pcBase.clone().offsetHSL(0, 0, t * 0.03);
                pineLeafColors.push(pc.r, pc.g, pc.b);
            }
            state.colliders.push({ x: x, z: z, r: (0.7 * s) + 0.6 });
            
        } else {
            // DECIDUOUS OR MAPLE TREE
            let leafBase = new THREE.Color(0x244a1f); // Default Green
            if (biomeVal > 0.65) {
                // Maple Tree (Autumn colors based on biome)
                const autumn = [0x992211, 0xaa4411, 0xbb8811, 0xcc3311];
                leafBase.setHex(autumn[Math.floor(rand()*autumn.length)]);
            }
            growBranch(baseMatrix, 0, rand() > 0.8 ? 5 : 4, 7.5 * s, 0.75 * s, leafBase);
            state.colliders.push({ x: x, z: z, r: (0.7 * s) + 0.6 });
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

    const lowGeo = new THREE.CylinderGeometry(0.85, 1.25, 1, 6, 2); // thin branches: ~36 tris instead of 288
    const mkTrunks = (geo, mats, cols) => {
        const m = new THREE.InstancedMesh(geo, trunkMat, mats.length);
        m.castShadow = true; m.receiveShadow = true;
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3);
        for (let i = 0; i < mats.length; i++) m.setMatrixAt(i, mats[i]);
        state.scene.add(m);
    };
    mkTrunks(trunkGeo, trunkM, trunkC);
    mkTrunks(lowGeo, state.branchMatrices, state.branchColors);

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
    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, state.leafMatrices.length);
    // Optimized: Disabled leaf shadows. Overlapping transparent shadows on millions of instances causes severe overdraw
    leafMesh.castShadow = false; 
    leafMesh.receiveShadow = false;
    leafMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.leafColors), 3);
    for(let i=0; i < state.leafMatrices.length; i++) leafMesh.setMatrixAt(i, state.leafMatrices[i]);
    state.scene.add(leafMesh);
    
    // PROCEDURAL JAGGED PINE LEAVES
    const pineGeo = new THREE.ConeGeometry(1, 1, 10, 1, false); // closed: underside visible from below
    pineGeo.translate(0, 0.5, 0);
    const pPos = pineGeo.attributes.position;
    for (let i = 0; i < pPos.count; i++) {
        const y = pPos.getY(i);
        if (y < 0.5) {   // rim + underside: star outline, slight droop
            const x = pPos.getX(i), z = pPos.getZ(i), ang = Math.atan2(z, x);
            const rv = 1.0 + 0.18 * Math.sin(ang * 5.0);
            pPos.setX(i, x * rv); pPos.setZ(i, z * rv); pPos.setY(i, y - 0.06);
        }
    }
    pineGeo.computeVertexNormals();
    
    const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    pineMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        pineMat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime;`);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vec4 pWorldPos = instanceMatrix * vec4(position, 1.0);
            // Slower, heavier wind sway for pines
            transformed.x += sin(pWorldPos.x * 2.0 + uTime * 0.8) * 0.05 * position.y; 
        `);
    };
    const pineMesh = new THREE.InstancedMesh(pineGeo, pineMat, pineLeafMatrices.length);
    pineMesh.castShadow = true; pineMesh.receiveShadow = true;
    pineMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pineLeafColors), 3);
    for(let i=0; i < pineLeafMatrices.length; i++) pineMesh.setMatrixAt(i, pineLeafMatrices[i]);
    state.scene.add(pineMesh);
}

