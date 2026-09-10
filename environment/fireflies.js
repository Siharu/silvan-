// Fireflies — ported from silvan_part2_with_original_grass.html's
// createFireflies(). Additive-blended glowing quads that drift on
// per-instance sine/cosine orbits computed entirely in the vertex shader
// (no per-frame CPU matrix updates needed), visible mainly at night and
// dimmed in rain — same currentRainIntensity value rain.js/puddles.js use,
// and state.sunHeightNormalized (day-night-cycle.js) for day/night blend.

import * as THREE from 'three';
import { WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from './terrain.js';
import { buildChunkedInstancedField } from '../core/chunks.js';
import { getSettings } from '../core/settings.js';

const FIREFLY_COUNT = 1200;
const SCATTER_MIN_R = 10;
const SCATTER_MAX_R = 220;

export function createFireflies(state) {
    const fireflyCount = (state.quality && state.quality.fireflyCount) || FIREFLY_COUNT;
    const geo = new THREE.PlaneGeometry(0.18, 0.18);
    const fireflyMat = new THREE.MeshBasicMaterial({
        color: 0xccff00,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    fireflyMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        fireflyMat.userData.shader = shader; // fed each frame by updateFireflies() — see that function
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>\nuniform float uTime;`
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
                m[3][1] = max(m[3][1], ${(WATER_LEVEL + 0.35).toFixed(2)}); // never bob below the water surface
                mvPosition = modelViewMatrix * vec4(m[3][0], m[3][1], m[3][2], 1.0);
                mvPosition.xy += transformed.xy;
            #else
                mvPosition = modelViewMatrix * mvPosition;
            #endif
            gl_Position = projectionMatrix * mvPosition;
            `
        );
    };

    // Was one InstancedMesh spanning the full 220-unit scatter radius —
    // same culling gap flowers.js had, fixed the same way. Drift in the
    // vertex shader (m[3][xyz] offsets) is small (~1.6 units), so it never
    // meaningfully moves a firefly between chunk cells.
    const placements = [];
    for (let i = 0; i < fireflyCount; i++) {
        const r = SCATTER_MIN_R + Math.random() * (SCATTER_MAX_R - SCATTER_MIN_R);
        const th = Math.random() * Math.PI * 2;
        const x = Math.cos(th) * r;
        const z = Math.sin(th) * r;
        const y = getElevation(x, z, state) + 0.6 + Math.random() * 3;
        placements.push({ x, y, z });
    }

    const field = buildChunkedInstancedField({
        scene: state.scene,
        geometry: geo,
        material: fireflyMat,
        worldExtent: SCATTER_MAX_R * 2 + 40,
        cellSize: 40,
        drawDistance: getSettings().drawDistance || 150,
        placements,
    });

    state.fireflyMat = fireflyMat;
    state.fireflyField = field; // update(camPos) called each frame by updateFireflies()
}

export function updateFireflies(state, ts) {
    if (!state.fireflyMat) return;
    if (state.fireflyMat.userData.shader) {
        state.fireflyMat.userData.shader.uniforms.uTime.value = ts;
    }
    if (state.fireflyField && state.camera) {
        state.fireflyField.update(state.camera.position);
    }
    const dayBlend = Math.max(0, state.sunHeightNormalized || 0); // 0 at night/horizon, up to 1 at midday
    const rainIntensity = state.currentRainIntensity || 0;
    // Was `1.0 - dayBlend * 2.2`, which only reaches 0 once dayBlend climbs
    // past ~0.45 — the sun has to be nearly half of the way to its peak
    // height before fireflies fully vanish, leaving them visibly present
    // (even if dim) through most of the morning/evening. On additive
    // blending, a low-but-nonzero opacity still reads as a clearly visible
    // square against any dark background (e.g. tree-shadow areas) — this
    // was almost certainly the "yellow/tan square artifacts" seen in a
    // daytime screenshot during the last live test. Steepened so they're
    // fully gone shortly after actual sunrise instead of lingering deep
    // into daylight hours.
    const nightFactor = Math.max(0, 1.0 - dayBlend / 0.08);
    state.fireflyMat.opacity = nightFactor * (1.0 - rainIntensity * 0.8);
}
