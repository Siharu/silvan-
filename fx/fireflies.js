// Ambient firefly particles. Opacity is driven per-frame from
// atmosphere/day-night-cycle.js (dims in daylight and in heavy rain).
//
// Rewritten as a plain THREE.Points cloud (matches the drift/twinkle
// approach in cinematic_day_night_cycle.html) instead of the previous
// InstancedMesh + onBeforeCompile vertex-shader billboard hack. That
// approach spliced custom GLSL into `#include <project_vertex>` at
// compile time — fragile by nature (one chunk-name mismatch or
// re-compile timing issue and the whole swarm silently stops rendering,
// which is almost certainly what "fireflies vanished" was), and much
// harder to reason about than just moving points in JS each frame.

import * as THREE from 'three';
import { WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from '../environment/terrain.js';

export function createFireflies(state) {
    const count = state.quality.fireflyCount;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const r = 10 + Math.random() * 220;
        const th = Math.random() * Math.PI * 2;
        const x = Math.cos(th) * r;
        const z = Math.sin(th) * r;
        const y = Math.max(getElevation(x, z) + 0.6 + Math.random() * 3, WATER_LEVEL + 0.35);
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        phases[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    state.fireflyMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0 },
            uColor: { value: new THREE.Color(0xaaff00) }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            attribute float aPhase;
            varying float vPhase;
            void main() {
                vPhase = aPhase;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = (40.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            uniform vec3 uColor;
            varying float vPhase;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;

                // Individual pulse per firefly, layered on top of the
                // day/rain-driven uOpacity from day-night-cycle.js.
                float pulse = sin(uTime * 3.0 + vPhase) * 0.5 + 0.5;
                float alpha = smoothstep(0.5, 0.0, dist) * pulse * uOpacity;

                // Bright near-white core fading to uColor at the edge —
                // reads as a glowing point rather than a flat colored dot.
                vec3 finalColor = mix(uColor, vec3(1.0), smoothstep(0.2, 0.0, dist));
                gl_FragColor = vec4(finalColor, alpha);
            }
        `
    });

    state.fireflyMesh = new THREE.Points(geo, state.fireflyMat);
    state.scene.add(state.fireflyMesh);
}

// Called every frame from main.js's animate() loop. Drifts each firefly in
// a wandering loop — speeds ported straight from
// cinematic_day_night_cycle.html's updateAtmosphere() firefly block, which
// is noticeably faster/more erratic than the original pass here (0.05/
// 0.02/0.05 vs. the old 0.015/0.008/0.015) and reads as actual insects
// darting around rather than slow-drifting motes.
export function updateFireflies(state, ts) {
    if (!state.fireflyMesh) return;
    state.fireflyMat.uniforms.uTime.value = ts;

    const positions = state.fireflyMesh.geometry.attributes.position.array;
    const floor = WATER_LEVEL + 0.5;
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] += Math.sin(ts * 1.0 + i) * 0.05;
        positions[i + 1] += Math.cos(ts * 1.5 + i) * 0.02;
        positions[i + 2] += Math.sin(ts * 1.2 + i) * 0.05;
        if (positions[i + 1] < floor) positions[i + 1] = floor;
    }
    state.fireflyMesh.geometry.attributes.position.needsUpdate = true;
}
