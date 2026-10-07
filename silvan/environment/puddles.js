import * as THREE from 'three';
import { state } from '../core/state.js';
import { heightAt as getElevation } from '../core/heightmap.js';

import { rngFor } from '../core/rng.js';
const rand = rngFor('puddles');
export function createPuddles() {
    const puddleCount = 120;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);

    state.puddleMaterial = new THREE.MeshStandardMaterial({
        color: 0x112233,
        roughness: 0.05,
        metalness: 0.9,
        transparent: true,
        opacity: 0.0,
        depthWrite: false
    });

    state.puddleMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uRainIntensity = { value: 0 };
        state.puddleMaterial.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            varying vec2 vPuddleUv;`
        );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vPuddleUv = uv;
            // Slight ripple vertex displacement based on rain/time
            transformed.y += sin(uTime * 4.0 + position.x * 10.0) * 0.02 * cos(uTime * 3.0 + position.z * 10.0);`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            uniform float uRainIntensity;
            varying vec2 vPuddleUv;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `vec4 diffuseColor = vec4(diffuse, opacity);`
        );
    };

    state.puddleMesh = new THREE.InstancedMesh(geo, state.puddleMaterial, puddleCount);
    
    const dummy = new THREE.Object3D();
    let validPuddles = 0;
    for (let i = 0; i < puddleCount; i++) {
        const x = (rand() - 0.5) * 300;
        const z = (rand() - 0.5) * 300;
        const y = getElevation(x, z);

        if (y > 1.8 && y < 15.0) { // Keep them in low areas but out of the lake
            dummy.position.set(x, y + 0.02, z);
            const s = 1.0 + rand() * 4.0;
            dummy.scale.set(s, 1, s);
            dummy.rotation.set(0, rand() * Math.PI, 0);
            dummy.updateMatrix();
            state.puddleMesh.setMatrixAt(validPuddles++, dummy.matrix);
        }
    }
    state.puddleMesh.count = validPuddles;
    state.scene.add(state.puddleMesh);
}

