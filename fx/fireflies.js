// Ambient firefly particles. Opacity is driven per-frame from
// atmosphere/day-night-cycle.js (dims in daylight and in heavy rain).

import * as THREE from 'three';
import { WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from '../environment/terrain.js';

export function createFireflies(state) {
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
                m[3][1] = max(m[3][1], ${(WATER_LEVEL + 0.35).toFixed(2)}); // Never bob below the water surface
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
        const r = 10 + Math.random() * 220; const th = Math.random() * Math.PI * 2;
        const x = Math.cos(th)*r; const z = Math.sin(th)*r;
        dummy.position.set(x, getElevation(x,z) + 0.6 + Math.random()*3, z);
        dummy.updateMatrix(); state.fireflyMesh.setMatrixAt(i, dummy.matrix);
    }
    state.scene.add(state.fireflyMesh);
}

