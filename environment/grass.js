// Billboard triangle-blade grass — the "clever trick": a single
// hand-authored triangle geometry instanced ~850k times with per-instance
// random placement/scale, sampled against getElevation() for ground height.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { getElevation } from './terrain.js';

export function createGrass(state) {
    // Was hardcoded to a fixed 850k/radius-300 patch regardless of WORLD_SIZE,
    // so it never actually covered the full map even before WORLD_SIZE grew —
    // both now scale off WORLD_SIZE so grass reaches all the way to where the
    // forest/rock scatter already does.
    const GRASS_RADIUS = WORLD_SIZE * 0.375;
    const grassCount = state.quality.grassCount;
    const grassGeo = new THREE.BufferGeometry();
    
    const grassVertices = new Float32Array([
        -0.03, 0, 0, 
         0.03, 0, 0,
         0,   2.2, 0 
    ]);
    grassGeo.setAttribute('position', new THREE.BufferAttribute(grassVertices, 3));
    grassGeo.computeVertexNormals();

    state.grassMat = new THREE.MeshStandardMaterial({
        color: 0x3d661d, 
        roughness: 0.9,
        side: THREE.DoubleSide
    });

    state.grassMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        state.grassMat.userData.shader = shader;
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            varying float vHeight;
            varying vec3 vWorldPos;
            varying float vCamDist;`
        );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vHeight = position.y;
            vec4 worldPos = instanceMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            vCamDist = distance(cameraPosition, worldPos.xyz);
            
            vec3 look = normalize(cameraPosition - worldPos.xyz);
            float angle = atan(look.x, look.z);
            float s = sin(angle);
            float c = cos(angle);
            float nx = transformed.x * c + transformed.z * s;
            float nz = transformed.z * c - transformed.x * s;
            transformed.x = nx;
            transformed.z = nz;

            float wind = sin(worldPos.x * 0.2 + uTime * 1.5) * cos(worldPos.z * 0.2 + uTime * 1.2);
            wind += sin(worldPos.x * 1.2 - uTime * 2.5) * 0.15;
            transformed.x += wind * 0.45 * pow(vHeight/2.2, 2.0);
            transformed.z += wind * 0.45 * pow(vHeight/2.2, 2.0);`
        );
        
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying float vHeight;
            varying vec3 vWorldPos;
            varying float vCamDist;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `vec3 rootColor = vec3(0.03, 0.07, 0.02);
            float grad = clamp(vHeight / 2.2, 0.0, 1.0);
            // Floor of 0.25 instead of letting shadow hit 0 at the blade base —
            // pure pow(grad, 0.6) drives all the way to black at grad=0, and
            // under overcast/low ambient light there's almost no diffuse term
            // to lift it back up, so blade bases (and anything close enough
            // to the camera to be mostly base) read as solid black instead of
            // dark green.
            float shadow = mix(0.28, 1.0, pow(grad, 0.6));
            // Was fully faded in by vCamDist 1.8 — a blade at 0.8-1.6 units
            // (i.e. constantly, since the player walks through waist-high
            // grass) still rendered near-full-opacity, billboarding up into a
            // huge close flat shape that reads as a black bar rather than an
            // out-of-focus blade brushing the lens. Widened and pushed out so
            // blades the camera is walking through fade away well before they
            // dominate the frame.
            if (vCamDist < 0.9) discard;
            float nearFade = smoothstep(0.9, 3.2, vCamDist);
            vec4 diffuseColor = vec4(mix(rootColor, diffuse, shadow), opacity * nearFade);`
        );
    };

    state.grassMesh = new THREE.InstancedMesh(grassGeo, state.grassMat, grassCount);
    // Optimized: Grass receiving shadows from branches is extremely heavy on 850k instances
    state.grassMesh.receiveShadow = false; 

    const dummy = new THREE.Object3D();
    let validGrass = 0;
    for (let i = 0; i < grassCount; i++) {
        const r = Math.sqrt(Math.random()) * GRASS_RADIUS;
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z);

        if (y < 1.7) continue; // Keep grass out of the lake

        dummy.position.set(x, y, z);
        
        const scaleW = 0.5 + Math.random() * 0.7;
        const scaleH = 0.4 + Math.random() * 1.2;
        dummy.scale.set(scaleW, scaleH, scaleW);
        
        dummy.updateMatrix();
        state.grassMesh.setMatrixAt(validGrass++, dummy.matrix);
    }
    state.grassMesh.count = validGrass;
    state.scene.add(state.grassMesh);
}

