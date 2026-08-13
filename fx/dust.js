// Ambient dust motes, camera-relative billboard particles.

import * as THREE from 'three';

export function createDustParticles(state) {
    const count = 3500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for(let i=0; i<count; i++) {
        pos[i*3] = (Math.random() - 0.5) * 80;
        pos[i*3+1] = Math.random() * 20;
        pos[i*3+2] = (Math.random() - 0.5) * 80;
        phases[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    
    state.dustMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uCameraPos: { value: new THREE.Vector3() }, uVisibility: { value: 1.0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `
            uniform float uTime;
            uniform vec3 uCameraPos;
            attribute float aPhase;
            varying float vAlpha;
            void main() {
                vec3 p = position;
                // Wrap around state.camera
                float spread = 80.0; float hS = spread / 2.0;
                p.x = uCameraPos.x + mod(p.x - uCameraPos.x + hS, spread) - hS;
                p.z = uCameraPos.z + mod(p.z - uCameraPos.z + hS, spread) - hS;
                
                // Drift
                p.x += sin(uTime * 0.2 + aPhase) * 1.5;
                p.y += cos(uTime * 0.15 + aPhase) * 1.0;
                p.z += sin(uTime * 0.25 - aPhase) * 1.5;
                p.y = mod(p.y, 20.0);
                
                vec4 mvPosition = viewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = min((4.0 + sin(aPhase)*2.0) * (20.0 / -mvPosition.z), 14.0);
                
                float dist = length(p - uCameraPos);
                // Fade out both far away AND right up against the state.camera — without the
                // near fade, a mote a couple units from the lens balloons into a huge
                // soft blob that reads as sitting "on" whatever's behind it (e.g. water).
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
        `
    });
    state.dustMesh = new THREE.Points(geo, state.dustMat);
    state.scene.add(state.dustMesh);
}

