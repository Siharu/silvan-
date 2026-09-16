// Ground-hugging volumetric mist — ported from fog.html, the standalone
// Three.js reference you sent. Swirling GPU-animated puffs of gas that
// rotate per-particle in the fragment shader and fade out with height
// (dense at ankle-level, gone above tree-canopy height), following the
// player around in a wrapping box so it always reads as "the ground is
// misty here" no matter where you walk.
//
// This is the visual half of the reference file's "Silent Hill fog"
// concept — the other half (camera.far = fog distance, hard GPU culling
// of anything past the fog) is deliberately NOT ported here. That trick
// only works in a scene with nothing deliberately placed far away; Silvan
// has a moon sphere at radius 1500, clouds out to radius 1400, and a sky
// dome, all meant to stay visible as "the horizon" regardless of ground
// fog. Clipping camera.far to a short fog distance would silently delete
// all of that. See the chat for the fuller explanation — the actual
// "hide what's culled" job in Silvan is already done by
// core/quality.js's vegetationRadius (caps where trees actually spawn,
// not a camera-wide cutoff), which doesn't have that problem.
//
// Particle count is quality-scaled and this is skipped entirely on Low —
// matching the reference file's own UI toggle, which existed specifically
// because this is one of the more GPU-expensive atmospheric effects
// (per-particle rotation + height-fade math in the fragment shader, alpha
// blending, depthWrite off).

import * as THREE from 'three';

const MIST_COUNTS = { high: 800, medium: 400, low: 0 }; // 0 = feature skipped entirely, matches the reference's own "too expensive for potato mode" framing
const MIST_AREA = 200; // world units per side of the wrapping box centered on the player
const MIST_MAX_HEIGHT = 20; // spawn height range — particles above this never get placed, keeps the fade (25 units in the shader) headroom sensible

function createMistTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const drawPuff = (x, y, r, opacity) => {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);
    };
    // Several overlapping offset puffs instead of one centered circle —
    // breaks up the "obviously a sphere" look into something more
    // asymmetrical/gaseous, same as the reference.
    drawPuff(128, 128, 100, 1.0);
    drawPuff(90, 140, 80, 0.6);
    drawPuff(170, 110, 70, 0.7);
    drawPuff(140, 170, 60, 0.5);
    return new THREE.CanvasTexture(canvas);
}

export function createGroundMist(state) {
    const count = (state.quality && MIST_COUNTS[getQualityKey(state)]) ?? MIST_COUNTS.medium;
    if (!count) { state.groundMist = null; return; } // Low quality — feature off entirely

    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * MIST_AREA;
        positions[i * 3 + 1] = Math.random() * MIST_MAX_HEIGHT;
        positions[i * 3 + 2] = (Math.random() - 0.5) * MIST_AREA;
        phases[i] = Math.random() * Math.PI * 2;
        sizes[i] = Math.random() * 80 + 80;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const uniforms = {
        time: { value: 0 },
        fogMap: { value: createMistTexture() },
        // Reference points directly at state.scene.fog.color's own Color
        // object rather than copying it — atmosphere/day-night-cycle.js
        // mutates that Color in place as time/weather change, so this
        // stays in sync automatically with no extra wiring needed.
        fogColor: { value: state.scene.fog.color },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
            attribute float phase;
            attribute float size;
            varying float vPhase;
            varying float vHeight;
            uniform float time;
            void main() {
                vPhase = phase;
                vec3 pos = position;
                pos.x += sin(time * 0.2 + phase) * 3.0;
                pos.y += cos(time * 0.15 + phase) * 1.5;
                pos.z += sin(time * 0.25 + phase) * 3.0;
                vHeight = pos.y;
                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = size * (400.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform sampler2D fogMap;
            uniform vec3 fogColor;
            uniform float time;
            varying float vPhase;
            varying float vHeight;
            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                float angle = time * 0.1 + vPhase;
                float s = sin(angle);
                float c = cos(angle);
                mat2 rot = mat2(c, -s, s, c);
                coord = rot * coord;
                coord += vec2(0.5);
                if (length(coord - vec2(0.5)) > 0.5) discard;
                vec4 texColor = texture2D(fogMap, coord);
                float heightFade = smoothstep(25.0, 0.0, vHeight);
                vec3 finalColor = mix(fogColor * 0.6, fogColor * 1.2, heightFade);
                float finalOpacity = texColor.a * heightFade * 0.15;
                gl_FragColor = vec4(finalColor, finalOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geo, material);
    state.scene.add(points);
    state.groundMist = { points, geo, material, count };
}

function getQualityKey(state) {
    // core/quality.js's getQualityCounts() returns the numeric preset
    // object, not the level string — read the level separately so this
    // module can pick its own (much smaller) mist-specific count per tier
    // instead of trying to reuse an unrelated field like treeCount.
    return (state.settings && state.settings.quality) || 'medium';
}

export function updateGroundMist(state, ts, delta) {
    const gm = state.groundMist;
    if (!gm || !state.player) return;

    gm.material.uniforms.time.value = ts;
    gm.points.position.set(state.player.position.x, 0, state.player.position.z);

    const positions = gm.geo.attributes.position.array;
    const half = MIST_AREA / 2;
    const windX = 2 * delta, windZ = 1 * delta; // gentle constant drift, matches the reference's "wind pushing the fog"
    for (let i = 0; i < gm.count; i++) {
        const idx = i * 3;
        positions[idx] += windX;
        positions[idx + 2] += windZ;
        if (positions[idx] > half) positions[idx] -= MIST_AREA;
        else if (positions[idx] < -half) positions[idx] += MIST_AREA;
        if (positions[idx + 2] > half) positions[idx + 2] -= MIST_AREA;
        else if (positions[idx + 2] < -half) positions[idx + 2] += MIST_AREA;
    }
    gm.geo.attributes.position.needsUpdate = true;
}
