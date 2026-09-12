// Rain puddles — ported from silvan_part2_with_original_grass.html's
// createPuddles(). Flat instanced planes, invisible in dry weather
// (opacity 0), fading in as state.currentRainIntensity rises — same
// intensity value environment/rain.js already reads.

import * as THREE from 'three';
import { WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from './terrain.js';

const PUDDLE_COUNT = 120;
const SCATTER_HALF = 150; // matches reference's (Math.random()-0.5)*300

export function createPuddles(state) {
    const puddleCount = (state.quality && state.quality.puddleCount) || PUDDLE_COUNT;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);

    // metalness/roughness were 0.9/0.05 — near-mirror, but this project
    // never sets scene.environment (no env map anywhere), and a
    // physically-based metal surface gets its reflection from exactly
    // that (IBL) — with none, it renders almost pure black except for a
    // tiny hard specular dot from the sun/moon directional light. That's
    // the actual cause of puddles reading as flat dark holes regardless
    // of time of day ("reflection doesn't match the light"), not a
    // color/lighting-hookup bug like the ones below. Dropped metalness so
    // more of the ordinary diffuse lighting shows, and added a uSkyColor
    // tint (same day-night feed pattern as grass.js's uAmbientColor) so
    // the puddle surface still visibly brightens/dims and shifts hue with
    // the actual sky/ambient color instead of needing a real env map.
    const puddleMaterial = new THREE.MeshStandardMaterial({
        color: 0x112233,
        roughness: 0.12,
        metalness: 0.5,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
    });

    puddleMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uSkyColor = { value: new THREE.Color(0x333333) }; // fed each frame from state.hemiLight — see updatePuddles()
        puddleMaterial.userData.shader = shader; // fed each frame by updatePuddles() — see that function
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>\nuniform float uTime;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            transformed.y += sin(uTime * 4.0 + position.x * 10.0) * 0.02 * cos(uTime * 3.0 + position.z * 10.0);`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>\nuniform vec3 uSkyColor;`
        );
        // Blend in the current ambient/sky tone after lighting is
        // computed, right before the final dithering pass — a stand-in
        // for a real reflected-sky env map, cheap enough to just tint the
        // lit result rather than a proper reflection vector sample.
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `gl_FragColor.rgb = mix(gl_FragColor.rgb, uSkyColor, 0.4);\n#include <dithering_fragment>`
        );
    };

    const puddleMesh = new THREE.InstancedMesh(geo, puddleMaterial, puddleCount);
    const dummy = new THREE.Object3D();
    let valid = 0;
    for (let i = 0; i < puddleCount; i++) {
        const x = (Math.random() - 0.5) * SCATTER_HALF * 2;
        const z = (Math.random() - 0.5) * SCATTER_HALF * 2;
        const y = getElevation(x, z, state);

        // Low ground only, out of the lake — same relative band the
        // reference used (WATER_LEVEL+0.2 to WATER_LEVEL+13.4), just
        // re-anchored to this project's own WATER_LEVEL (-2 vs the
        // reference's 1.6).
        if (y > WATER_LEVEL + 3.8 && y < WATER_LEVEL + 17.0) {
            dummy.position.set(x, y + 0.02, z);
            const s = 1.0 + Math.random() * 4.0;
            dummy.scale.set(s, 1, s);
            dummy.rotation.set(0, Math.random() * Math.PI, 0);
            dummy.updateMatrix();
            puddleMesh.setMatrixAt(valid++, dummy.matrix);
        }
    }
    puddleMesh.count = valid;
    state.scene.add(puddleMesh);
    state.puddleMaterial = puddleMaterial;
}

export function updatePuddles(state, ts) {
    if (!state.puddleMaterial) return;
    const intensity = state.currentRainIntensity || 0;
    if (state.puddleMaterial.userData.shader) {
        state.puddleMaterial.userData.shader.uniforms.uTime.value = ts;
        if (state.hemiLight) {
            state.puddleMaterial.userData.shader.uniforms.uSkyColor.value
                .copy(state.hemiLight.color)
                .multiplyScalar(state.hemiLight.intensity);
        }
    }
    state.puddleMaterial.opacity = Math.min(0.85, intensity * 1.2);
}
