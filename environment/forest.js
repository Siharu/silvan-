import * as THREE from 'three';
import { state } from '../core/state.js';
import { getElevation } from '../core/utils.js';

export function generateFractalForest() {
    const baseTrunkColor = new THREE.Color(0x28201a);
    const pineLeafMatrices = [];
    const pineLeafColors = [];

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

    for (let i = 0; i < TREE_COUNT; i++) {
        const r = 25 + Math.random() * (WORLD_SIZE/2 - 50);
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z);
        
        if (y < 1.4) continue; // Keep trees out of the deep lake

        const baseMatrix = new THREE.Matrix4().makeTranslation(x, y - 0.3, z);
        baseMatrix.multiply(new THREE.Matrix4().makeRotationY(Math.random() * Math.PI * 2));
        const s = 0.85 + Math.random() * 1.3;
        
        const biomeVal = noise(x * 0.008, z * 0.008);
        
        if (biomeVal < 0.35 && y > 3.5) {
            // PINE TREE (Prefers higher ground and specific biome noise)
            const trunkHeight = 16 * s;
            const trunkMat = baseMatrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, trunkHeight/2, 0)).multiply(new THREE.Matrix4().makeScale(0.7*s, trunkHeight, 0.7*s));
            state.branchMatrices.push(trunkMat);
            state.branchColors.push(0.18, 0.14, 0.11); // Darker, slightly different trunk
            
            // Generate dense, drooping, jagged layers for the pine tree
            const numLayers = 6 + Math.floor(Math.random()*4);
            for(let j=0; j<numLayers; j++) {
                const h = trunkHeight * (0.15 + (j / numLayers) * 0.85); // Leaves start lower
                const lScale = (trunkHeight * 0.35) * (1.0 - Math.pow(j/numLayers, 1.2)); // Curve taper
                const layerMat = baseMatrix.clone()
                    .multiply(new THREE.Matrix4().makeTranslation(0, h, 0))
                    .multiply(new THREE.Matrix4().makeScale(lScale, lScale * 0.9, lScale))
                    .multiply(new THREE.Matrix4().makeRotationY(Math.random()*Math.PI));
                pineLeafMatrices.push(layerMat);
                const pc = new THREE.Color(0x1a3320).offsetHSL(Math.random()*0.03-0.015, 0.1, Math.random()*0.05-0.025);
                pineLeafColors.push(pc.r, pc.g, pc.b);
            }
            state.colliders.push({ x: x, z: z, r: (0.7 * s) + 0.6 });
            
        } else {
            // DECIDUOUS OR MAPLE TREE
            let leafBase = new THREE.Color(0x244a1f); // Default Green
            if (biomeVal > 0.65) {
                // Maple Tree (Autumn colors based on biome)
                const autumn = [0x992211, 0xaa4411, 0xbb8811, 0xcc3311];
                leafBase.setHex(autumn[Math.floor(Math.random()*autumn.length)]);
            }
            growBranch(baseMatrix, 0, Math.random() > 0.8 ? 5 : 4, 7.5 * s, 0.75 * s, leafBase);
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
    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, state.leafMatrices.length);
    // Optimized: Disabled leaf shadows. Overlapping transparent shadows on millions of instances causes severe overdraw
    leafMesh.castShadow = false; 
    leafMesh.receiveShadow = false;
    leafMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.leafColors), 3);
    for(let i=0; i < state.leafMatrices.length; i++) leafMesh.setMatrixAt(i, state.leafMatrices[i]);
    state.scene.add(leafMesh);
    
    // PROCEDURAL JAGGED PINE LEAVES
    const pineGeo = new THREE.ConeGeometry(1, 1, 9, 3, true); 
    pineGeo.translate(0, 0.5, 0); // Anchor to bottom
    const pPos = pineGeo.attributes.position;
    // Distort vertices to create an organic, drooping pine needle silhouette
    for(let i=0; i < pPos.count; i++) {
        let y = pPos.getY(i);
        let x = pPos.getX(i);
        let z = pPos.getZ(i);
        if (y < 0.9) { 
            let angle = Math.atan2(z, x);
            // Jagged star pattern
            let radiusVar = 1.0 + 0.25 * Math.sin(angle * 7.0); 
            pPos.setX(i, x * radiusVar);
            pPos.setZ(i, z * radiusVar);
            // Droop the edges heavily to look like heavy pine branches
            pPos.setY(i, y - 0.25 - Math.random() * 0.15);
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

