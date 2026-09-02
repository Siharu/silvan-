// Rain (falling streaks) + rain splashes (lake surface rings), ported
// directly from silvan_part2_with_original_grass.html's createRainSystem()
// / createRainSplashes() and their animate()-loop update block. Only
// changes from the reference: getElevation(x, z) -> (x, z, state), and
// intensity/opacity/count driven from state.currentRainIntensity instead
// of module-scope vars, matching this project's state-object pattern.

import * as THREE from 'three';
import { getElevation } from './terrain.js';

const WATER_LEVEL = -2; // matches core/world-state.js terrainParams.waterLevel

export function createRainSystem(state) {
    const count = 45000;
    // Extremely narrow and long geometry for realistic fast-moving streaks
    const geo = new THREE.PlaneGeometry(0.015, 3.5);
    const rainMaterial = new THREE.MeshBasicMaterial({
        color: 0xe6f0fa, // Soft bright bluish-white
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });

    rainMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uCameraPos = { value: new THREE.Vector3() };
        rainMaterial.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `\n#include <common>\nuniform float uTime;\nuniform vec3 uCameraPos;\nvarying vec2 vRainUv;\nvarying float vRainWorldY;\n`
        );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            vRainUv = uv;
            vRainWorldY = 999.0;

            #ifdef USE_INSTANCING
                mat4 m = instanceMatrix;
                vec3 iPos = vec3(m[3][0], m[3][1], m[3][2]);

                // Keep rain clustered tightly around camera for density
                float spread = 90.0; float hS = spread / 2.0;
                float nX = uCameraPos.x + mod(iPos.x - uCameraPos.x + hS, spread) - hS;
                float nZ = uCameraPos.z + mod(iPos.z - uCameraPos.z + hS, spread) - hS;
                float dH = 80.0; float spd = 180.0; // Very fast fall speed

                // Introduce varied falling speeds for depth
                float speedVar = spd * (0.8 + fract(iPos.x * 13.37)*0.6);
                float cY = iPos.y - (uTime * speedVar);
                float nY = uCameraPos.y + mod(cY - uCameraPos.y + dH*0.5, dH) - dH*0.5;

                vec3 centerWorld = vec3(nX, nY, nZ);

                // Realistic slight wind slant
                vec3 rainDir = normalize(vec3(-0.1, -1.0, 0.05));

                vec3 toCamera = normalize(uCameraPos - centerWorld);

                // Cylindrical billboarding ensures lines always face camera
                vec3 right = cross(rainDir, toCamera);
                if(length(right) < 0.001) right = vec3(1.0, 0.0, 0.0);
                right = normalize(right);

                vec3 finalWorld = centerWorld + right * transformed.x + rainDir * transformed.y;
                vRainWorldY = finalWorld.y;

                vec4 mvPosition = viewMatrix * vec4(finalWorld, 1.0);
            #else
                vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
            #endif
            gl_Position = projectionMatrix * mvPosition;
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `\n#include <common>\nvarying vec2 vRainUv;\nvarying float vRainWorldY;\n`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            // Cut the streak off at the water surface instead of letting it pass through
            if (vRainWorldY < ${WATER_LEVEL.toFixed(2)}) discard;
            // Fade the last stretch just above the surface so it reads as "hitting" rather than clipping
            float surfaceFade = smoothstep(${WATER_LEVEL.toFixed(2)}, ${(WATER_LEVEL + 1.2).toFixed(2)}, vRainWorldY);

            // Pure straight streaks, mimicking camera motion blur of a fast droplet
            float dist = abs(vRainUv.x - 0.5) * 2.0; // 0 at center, 1 at edges
            float xFade = 1.0 - smoothstep(0.0, 1.0, dist);

            // Fade out the tail (top of the quad). vRainUv.y goes 0(bottom) to 1(top)
            float tailDrop = 1.0 - vRainUv.y;

            // Linear fade + a bit of exponential trail (no more teardrop shapes)
            float alphaMask = xFade * pow(tailDrop, 1.2) * surfaceFade;

            vec4 diffuseColor = vec4(diffuse, opacity * alphaMask);
            `
        );
    };

    const rainMesh = new THREE.InstancedMesh(geo, rainMaterial, count);
    rainMesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        // Initialize positions within the local cluster
        dummy.position.set((Math.random() - 0.5) * 90, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 90);
        dummy.updateMatrix();
        rainMesh.setMatrixAt(i, dummy.matrix);
    }
    state.rainMesh = rainMesh;
    state.rainMaterial = rainMaterial;
    state.scene.add(rainMesh);
}

export function createRainSplashes(state) {
    const count = 400;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const rainSplashMat = new THREE.MeshBasicMaterial({
        color: 0xdcf2ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    rainSplashMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        rainSplashMat.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            attribute float aPhase;
            attribute float aSpeed;
            varying vec2 vSplashUv;
            varying float vProgress;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vSplashUv = uv;
            // Each instance loops through its own 0..1 splash cycle
            float cycle = fract(uTime * aSpeed + aPhase);
            vProgress = cycle;
            float ringScale = mix(0.15, 1.6, cycle);
            transformed.x *= ringScale;
            transformed.z *= ringScale;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec2 vSplashUv;
            varying float vProgress;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            // Thin expanding ring, fading out as it grows
            float distFromCenter = length(vSplashUv - 0.5) * 2.0;
            float ringWidth = 0.10;
            float ring = 1.0 - smoothstep(0.0, ringWidth, abs(distFromCenter - 1.0));
            float fade = 1.0 - smoothstep(0.0, 1.0, vProgress);
            vec4 diffuseColor = vec4(diffuse, opacity * ring * fade);
            `
        );
    };

    const rainSplashMesh = new THREE.InstancedMesh(geo, rainSplashMat, count);
    rainSplashMesh.frustumCulled = false;
    rainSplashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const dummy = new THREE.Object3D();
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    let placed = 0;
    for (let i = 0; i < count * 3 && placed < count; i++) {
        // Scatter within the lake basin only (matches getElevation's lake carve radius)
        const r = Math.sqrt(Math.random()) * 150;
        const th = Math.random() * Math.PI * 2;
        const x = Math.cos(th) * r;
        const z = Math.sin(th) * r;
        if (getElevation(x, z, state) > 1.5) continue; // skip anything not actually under the lake

        dummy.position.set(x, WATER_LEVEL + 0.02, z);
        dummy.updateMatrix();
        rainSplashMesh.setMatrixAt(placed, dummy.matrix);
        phases[placed] = Math.random();
        speeds[placed] = 0.5 + Math.random() * 0.7;
        placed++;
    }
    rainSplashMesh.count = placed;
    rainSplashMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    rainSplashMesh.geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
    state.rainSplashMesh = rainSplashMesh;
    state.rainSplashMat = rainSplashMat;
    state.scene.add(rainSplashMesh);
}

// Called every frame from main.js's animate() loop. Reads
// state.currentRainIntensity (owned/eased by atmosphere/day-night-cycle.js
// or wherever weather state ends up living — same 0.0005*delta ease rate
// as the prototype's currentRainIntensity/targetRainIntensity pair, ported
// there rather than duplicated here).
export function updateRain(state, ts) {
    const intensity = state.currentRainIntensity || 0;

    if (state.rainMaterial && state.rainMaterial.userData.shader) {
        state.rainMaterial.userData.shader.uniforms.uTime.value = ts;
        state.rainMaterial.userData.shader.uniforms.uCameraPos.value.copy(state.camera.position);
        state.rainMaterial.opacity = 0.15 * Math.min(1.0, intensity * 2.0);
        state.rainMesh.count = Math.max(0, Math.floor(45000 * intensity));
        state.rainMesh.visible = intensity > 0.01;
    }

    if (state.rainSplashMat && state.rainSplashMat.userData.shader) {
        state.rainSplashMat.userData.shader.uniforms.uTime.value = ts;
        state.rainSplashMat.opacity = 0.5 * Math.min(1.0, intensity * 1.8);
        state.rainSplashMesh.visible = intensity > 0.15; // match the CLEAR/LIGHT RAIN threshold
    }
}
