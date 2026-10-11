import * as THREE from 'three';
import { state, WATER_LEVEL } from '../core/state.js';
import { heightAt as getElevation } from '../core/heightmap.js';

import { rngFor } from '../core/rng.js';
const rand = rngFor('fireflies');
export function createFireflies() {
    const count = 1200;
    const geo = new THREE.PlaneGeometry(0.18, 0.18);
    state.fireflyMat = new THREE.MeshBasicMaterial({ color: 0xccff00, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    state.fireflyMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        state.fireflyMat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform float uTime;
            `
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            vec4 mvPosition = vec4( transformed, 1.0 );
            #ifdef USE_INSTANCING
                mat4 m = instanceMatrix;
                vec3 iPos = vec3(m[3][0], m[3][1], m[3][2]);
                float t = uTime + iPos.x * 15.0 + iPos.z * 6.0;
                m[3][0] += sin(t * 1.4) * 1.6;
                m[3][1] += cos(t * 1.1) * 1.2;
                m[3][2] += sin(t * 1.7) * 1.6;
                m[3][1] = max(m[3][1], 0.3); // mesh sits on the ground under the player (updateFireflies), so this is a local floor
                mvPosition = modelViewMatrix * vec4(m[3][0], m[3][1], m[3][2], 1.0);
                mvPosition.xy += transformed.xy;
            #else
                mvPosition = modelViewMatrix * mvPosition;
            #endif
            gl_Position = projectionMatrix * mvPosition;
            `
        );
    };
    state.fireflyMesh = new THREE.InstancedMesh(geo, state.fireflyMat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        // B-39: offsets are RELATIVE to the player (the mesh follows them, see updateFireflies). They used to be
        // world positions around the origin, which after the 4x scale-up is ~1200u from where you spawn: no fireflies at all.
        const r = 4 + rand() * 70; const th = rand() * Math.PI * 2;
        dummy.position.set(Math.cos(th)*r, 0.6 + rand()*3, Math.sin(th)*r);
        dummy.updateMatrix(); state.fireflyMesh.setMatrixAt(i, dummy.matrix);
    }
    state.scene.add(state.fireflyMesh);
}


// Keep the swarm around the player, standing on the ground there (B-39).
export function updateFireflies() {
    if (!state.fireflyMesh || !state.camera) return;
    const p = state.camera.position;
    state.fireflyMesh.position.set(p.x, getElevation(p.x, p.z), p.z);
    state.fireflyMesh.frustumCulled = false;
}
