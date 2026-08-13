// Wind-blown leaves — a camera-relative particle sweep that only appears
// during heavy rain (state.currentRainIntensity), to sell the idea of gusty
// storm wind rather than just rain falling straight down. Reuses the same
// leaf-shaped sprite (state.globalTextures.leafTex) the trees use, so the
// blown leaves visually match the forest canopy they'd be coming from.
//
// Wind direction is a fixed horizontal vector (uWindDir) rather than
// something that spins around — real storm gusts have a prevailing
// direction, and a constantly-rotating wind would read as chaotic rather
// than "windy".

import * as THREE from 'three';

const WIND_DIR = new THREE.Vector2(0.8, 0.35).normalize();
const SPREAD = 60.0;
// Rain intensity below this reads as "clear/light rain" elsewhere in the
// codebase (see atmosphere/day-night-cycle.js's weatherText thresholds) —
// gusts only kick in once it's past the "heavy rain" line.
const HEAVY_RAIN_THRESHOLD = 0.6;

export function createWindLeaves(state) {
    const count = 220;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const spins = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * SPREAD;
        pos[i * 3 + 1] = Math.random() * 14 + 0.5;
        pos[i * 3 + 2] = (Math.random() - 0.5) * SPREAD;
        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.6 + Math.random() * 0.8;
        spins[i] = (Math.random() - 0.5) * 4.0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aSpin', new THREE.BufferAttribute(spins, 1));

    state.windLeavesMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uCameraPos: { value: new THREE.Vector3() },
            uWindDir: { value: WIND_DIR },
            uIntensity: { value: 0.0 }, // 0 = calm/no gusts, 1 = full storm sweep
            uLeafTex: { value: state.globalTextures.leafTex },
        },
        transparent: true,
        depthWrite: false,
        vertexShader: `
            uniform float uTime;
            uniform vec3 uCameraPos;
            uniform vec2 uWindDir;
            uniform float uIntensity;
            attribute float aPhase;
            attribute float aSpeed;
            attribute float aSpin;
            varying float vAlpha;
            varying float vSpin;
            void main() {
                vec3 p = position;

                // Wind carries leaves steadily along uWindDir; speed scales
                // with storm intensity so calmer rain barely nudges them.
                float travel = uTime * aSpeed * (0.6 + uIntensity * 2.4);
                p.x += uWindDir.x * travel;
                p.z += uWindDir.y * travel;

                // Turbulent bob/flutter on top of the straight-line travel.
                p.y += sin(uTime * 1.6 + aPhase) * 0.4 * (0.3 + uIntensity);
                p.x += sin(uTime * 2.2 + aPhase) * 0.6 * uIntensity;

                // Recycle around the camera in all three axes.
                float hS = ${SPREAD.toFixed(1)} / 2.0;
                p.x = uCameraPos.x + mod(p.x - uCameraPos.x + hS, ${SPREAD.toFixed(1)}) - hS;
                p.z = uCameraPos.z + mod(p.z - uCameraPos.z + hS, ${SPREAD.toFixed(1)}) - hS;
                p.y = mod(p.y, 14.0) + 0.5;

                vec4 mvPosition = viewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = min((10.0 + sin(aPhase) * 3.0) * (18.0 / -mvPosition.z), 22.0);

                float dist = length(p - uCameraPos);
                float distAlpha = smoothstep(50.0, 8.0, dist) * smoothstep(1.0, 3.0, dist);
                vAlpha = distAlpha * uIntensity;
                vSpin = uTime * aSpin;
            }
        `,
        fragmentShader: `
            uniform sampler2D uLeafTex;
            varying float vAlpha;
            varying float vSpin;
            void main() {
                if (vAlpha < 0.01) discard;
                // Tumble the leaf sprite around its own center as it blows.
                vec2 centered = gl_PointCoord - vec2(0.5);
                float c = cos(vSpin); float s = sin(vSpin);
                vec2 rotated = vec2(c * centered.x - s * centered.y, s * centered.x + c * centered.y) + 0.5;
                if (rotated.x < 0.0 || rotated.x > 1.0 || rotated.y < 0.0 || rotated.y > 1.0) discard;
                vec4 tex = texture2D(uLeafTex, rotated);
                if (tex.a < 0.1) discard;
                vec3 leafColor = mix(vec3(0.55, 0.42, 0.16), vec3(0.3, 0.42, 0.18), rotated.y);
                gl_FragColor = vec4(leafColor, tex.a * vAlpha);
            }
        `
    });

    state.windLeavesMesh = new THREE.Points(geo, state.windLeavesMat);
    state.windLeavesMesh.frustumCulled = false;
    state.scene.add(state.windLeavesMesh);
}

// Called every frame from atmosphere/day-night-cycle.js. Gusts fade in once
// currentRainIntensity crosses the heavy-rain line and fade back out below
// it, rather than snapping on/off.
export function updateWindLeaves(state, ts) {
    if (!state.windLeavesMat) return;
    state.windLeavesMat.uniforms.uTime.value = ts;
    state.windLeavesMat.uniforms.uCameraPos.value.copy(state.camera.position);
    const target = state.currentRainIntensity > HEAVY_RAIN_THRESHOLD
        ? Math.min(1.0, (state.currentRainIntensity - HEAVY_RAIN_THRESHOLD) / (1.0 - HEAVY_RAIN_THRESHOLD))
        : 0.0;
    const current = state.windLeavesMat.uniforms.uIntensity.value;
    state.windLeavesMat.uniforms.uIntensity.value = current + (target - current) * 0.02;
}
