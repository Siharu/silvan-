// Floating dust motes — ported from silvan_part2_with_original_grass.html's
// createDustParticles(). Points wrapped around the camera (sliding-window
// tiling, same core idea as grass.js's blade patch) so a small fixed count
// gives endless coverage without regenerating per frame. Fades with rain
// and is more visible in daylight (sunbeam-dust look) via
// state.sunHeightNormalized.

import * as THREE from 'three';

const DUST_COUNT = 3500;
const SPREAD = 80;

export function createDustParticles(state) {
    const dustCount = (state.quality && state.quality.dustCount) || DUST_COUNT;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(dustCount * 3);
    const phases = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
        pos[i * 3] = (Math.random() - 0.5) * SPREAD;
        pos[i * 3 + 1] = Math.random() * 20;
        pos[i * 3 + 2] = (Math.random() - 0.5) * SPREAD;
        phases[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const dustMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uCameraPos: { value: new THREE.Vector3() }, uVisibility: { value: 1.0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            uniform float uTime;
            uniform vec3 uCameraPos;
            attribute float aPhase;
            varying float vAlpha;
            void main() {
                vec3 p = position;
                float spread = ${SPREAD.toFixed(1)};
                float hS = spread / 2.0;
                p.x = uCameraPos.x + mod(p.x - uCameraPos.x + hS, spread) - hS;
                p.z = uCameraPos.z + mod(p.z - uCameraPos.z + hS, spread) - hS;

                p.x += sin(uTime * 0.2 + aPhase) * 1.5;
                p.y += cos(uTime * 0.15 + aPhase) * 1.0;
                p.z += sin(uTime * 0.25 - aPhase) * 1.5;
                p.y = mod(p.y, 20.0);

                vec4 mvPosition = viewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = min((4.0 + sin(aPhase) * 2.0) * (20.0 / -mvPosition.z), 14.0);

                float dist = length(p - uCameraPos);
                float distAlpha = smoothstep(40.0, 5.0, dist) * smoothstep(1.0, 4.0, dist);
                vAlpha = (0.3 + 0.7 * sin(uTime * 1.5 + aPhase)) * distAlpha;
            }
        `,
        fragmentShader: `
            uniform float uVisibility;
            varying float vAlpha;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                gl_FragColor = vec4(0.9, 0.8, 0.6, (0.5 - dist) * 2.0 * vAlpha * uVisibility * 0.5);
            }
        `,
    });

    const dustMesh = new THREE.Points(geo, dustMat);
    state.scene.add(dustMesh);
    state.dustMat = dustMat;
}

export function updateDustParticles(state, ts) {
    if (!state.dustMat || !state.camera) return;
    state.dustMat.uniforms.uTime.value = ts;
    state.dustMat.uniforms.uCameraPos.value.copy(state.camera.position);
    const rainIntensity = state.currentRainIntensity || 0;
    const dustWeatherVisibility = Math.max(0, 1.0 - rainIntensity * 1.5);
    const lightVisibility = Math.max(0.3, state.sunHeightNormalized || 0);
    state.dustMat.uniforms.uVisibility.value = dustWeatherVisibility * lightVisibility;
}
