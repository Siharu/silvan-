// Ambient dust motes, camera-relative billboard particles that rise up out
// of the ground in a slow loop (spawn low, drift upward, fade out, repeat)
// rather than floating in a fixed 0-20 unit box — the old version had no
// vertical story at all, so at night with nothing else to give them scale
// they read as a static field of orbs pinned around the camera instead of
// dust actually lifting off the forest floor.

import * as THREE from 'three';

const RISE_HEIGHT = 5.5; // how far a mote climbs before it fades and resets

export function createDustParticles(state) {
    const count = state.quality.dustCount;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const riseSeeds = new Float32Array(count);
    for(let i=0; i<count; i++) {
        pos[i*3] = (Math.random() - 0.5) * 90;
        pos[i*3+1] = Math.random() * RISE_HEIGHT; // staggered start height so the whole field doesn't rise in lockstep
        pos[i*3+2] = (Math.random() - 0.5) * 90;
        phases[i] = Math.random() * Math.PI * 2;
        riseSeeds[i] = 0.55 + Math.random() * 0.7; // per-mote rise-speed variance
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aRiseSeed', new THREE.BufferAttribute(riseSeeds, 1));

    state.dustMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uCameraPos: { value: new THREE.Vector3() }, uVisibility: { value: 1.0 }, uDayBlend: { value: 1.0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `
            uniform float uTime;
            uniform vec3 uCameraPos;
            attribute float aPhase;
            attribute float aRiseSeed;
            varying float vAlpha;
            void main() {
                vec3 p = position;
                // Wrap around state.camera in the horizontal plane only —
                // vertical position is driven entirely by the rise cycle below.
                float spread = 90.0; float hS = spread / 2.0;
                p.x = uCameraPos.x + mod(p.x - uCameraPos.x + hS, spread) - hS;
                p.z = uCameraPos.z + mod(p.z - uCameraPos.z + hS, spread) - hS;

                // Gentle horizontal sway while rising, like drifting dust
                // rather than something on rails.
                p.x += sin(uTime * 0.2 + aPhase) * 1.2;
                p.z += sin(uTime * 0.25 - aPhase) * 1.2;

                // Rise cycle: climbs from ground level up to RISE_HEIGHT, then
                // wraps back to the ground and starts again. aRiseSeed staggers
                // speed per-mote so the field doesn't pulse as one visible sheet.
                float riseSpeed = 0.12 * aRiseSeed;
                float cycle = mod(p.y + uTime * riseSpeed, ${RISE_HEIGHT.toFixed(1)});
                float t = cycle / ${RISE_HEIGHT.toFixed(1)}; // 0 = just spawned at ground, 1 = about to fade/reset
                p.y = cycle;

                // Small lazy wobble on top of the climb, not enough to read
                // as floating in place.
                p.y += sin(uTime * 0.4 + aPhase) * 0.15;

                vec4 mvPosition = viewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = min((3.0 + sin(aPhase)*1.6) * (20.0 / -mvPosition.z), 12.0);

                float dist = length(p - uCameraPos);
                // Fade out both far away AND right up against the state.camera — without the
                // near fade, a mote a couple units from the lens balloons into a huge
                // soft blob that reads as sitting "on" whatever's behind it (e.g. water).
                float distAlpha = smoothstep(40.0, 5.0, dist) * smoothstep(1.0, 4.0, dist);

                // Ground-emergence envelope: fades in over the first ~15% of
                // the climb (emerging out of the grass/undergrowth) and fades
                // out over the top ~30% (dispersing rather than hitting an
                // invisible ceiling), instead of just popping in/out of a box.
                float riseEnvelope = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.7, 1.0, t));

                vAlpha = (0.5 + 0.5 * sin(uTime * 1.5 + aPhase)) * distAlpha * riseEnvelope;
            }
        `,
        fragmentShader: `
            uniform float uVisibility;
            uniform float uDayBlend; // 1 = full day, 0 = full night — see atmosphere/day-night-cycle.js
            varying float vAlpha;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                // Warm sunlit-dust gold in daylight, dimmed and shifted toward a
                // faint cool blue glow at night — motes catching ambient
                // moonlight/night-sky rather than direct warm sun, and dim
                // enough to read as atmosphere rather than a second set of
                // fireflies.
                vec3 dayColor = vec3(0.9, 0.8, 0.6);
                vec3 nightColor = vec3(0.35, 0.55, 0.95);
                vec3 col = mix(nightColor, dayColor, uDayBlend);
                float nightDim = mix(0.3, 1.0, uDayBlend); // much dimmer at night — this is a sunlit/dusk effect, not a night one
                gl_FragColor = vec4(col, (0.5 - dist) * 2.0 * vAlpha * uVisibility * 0.5 * nightDim);
            }
        `
    });
    state.dustMesh = new THREE.Points(geo, state.dustMat);
    state.scene.add(state.dustMesh);
}
