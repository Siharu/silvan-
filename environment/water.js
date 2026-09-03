// Water — two-tier system.
//
// PRIMARY: THREE.Water (real sun/moon reflection), ported from
// day_night_cycle.html's initWater(). Needs to fetch a water-normals
// texture from a CDN — if that fetch fails (offline, per your note),
// THREE.Water still technically works but with distortionScale forced to
// 0 (per the reference's own fallback logic) and no normal-map bump, i.e.
// visually flat. That's not good enough as a real fallback, so:
//
// FALLBACK: the exact Gerstner-wave shader + "Calm Lake"/"Ocean Breeze"
// presets from ocean-water.html, verbatim (colors, wave1-4 dir/steepness/
// wavelength values unchanged) — used for the LAKE if the texture load
// fails, and used for the OUTER OCEAN unconditionally (that reference's
// "Ocean Breeze" preset is built for large open water, which is exactly
// what surrounds this project's island — no reason to route the ocean
// through THREE.Water's reflection cost at all, given the perf situation).
//
// state.water (the reflection lake, when the primary path succeeds) is
// read by atmosphere/day-night-cycle.js's updateDayNightCycle() for
// sunDirection/sunColor — see that module's comments. The Gerstner
// fallback/ocean have no such hookup; they light themselves via their own
// u_lightDir uniform, updated each frame in updateWater() below from
// state.sunPosition if available.

import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { WORLD_SIZE } from '../core/world-state.js';

const gerstnerWaveGLSL = `
    vec3 gerstnerWave(
        vec4 wave, vec3 p, inout vec3 tangent, inout vec3 binormal
    ) {
        float steepness = wave.z;
        float wavelength = wave.w;
        float k = 2.0 * 3.14159 / wavelength;
        float c = sqrt(9.8 / k);
        vec2 d = normalize(wave.xy);
        float f = k * (dot(d, p.xz) - c * u_time * u_speed);
        float a = steepness / k;
        float sinf = sin(f);
        float cosf = cos(f);
        float wa = k * a;
        tangent.x -= d.x * d.x * wa * sinf;
        tangent.y += d.x * wa * cosf;
        tangent.z -= d.x * d.y * wa * sinf;
        binormal.x -= d.x * d.y * wa * sinf;
        binormal.y += d.y * wa * cosf;
        binormal.z -= d.y * d.y * wa * sinf;
        return vec3(
            d.x * a * cosf,
            a * sinf,
            d.y * a * cosf
        );
    }
`;

const waterVertexShader = `
    #define NUM_WAVES 4
    uniform float u_time;
    uniform float u_speed;
    uniform vec4 u_waves[NUM_WAVES];
    uniform float u_elevationScale;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vElevation;
    ${gerstnerWaveGLSL}
    void main() {
        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 0.0, 1.0);
        vec3 p = position;
        vec3 displacement = vec3(0.0);
        for(int i = 0; i < NUM_WAVES; i++) {
            displacement += gerstnerWave(u_waves[i], position, tangent, binormal);
        }
        p += displacement;
        vec3 normal = normalize(cross(binormal, tangent));
        vec4 worldPosition = modelMatrix * vec4(p, 1.0);
        vWorldPosition = worldPosition.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vElevation = p.y * u_elevationScale;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

const waterFragmentShader = `
    uniform vec3 u_surfaceColor;
    uniform vec3 u_depthColor;
    uniform vec3 u_foamColor;
    uniform float u_colorOffset;
    uniform float u_colorMultiplier;
    uniform float u_foamThreshold;
    uniform float u_opacity;
    uniform vec3 u_lightDir;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vElevation;
    void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float mixStrength = (vElevation + u_colorOffset) * u_colorMultiplier;
        mixStrength = smoothstep(0.0, 1.0, mixStrength);
        vec3 albedo = mix(u_depthColor, u_surfaceColor, mixStrength);
        float foamMix = smoothstep(u_foamThreshold, u_foamThreshold + 0.5, vElevation);
        albedo = mix(albedo, u_foamColor, foamMix);
        vec3 lightDir = normalize(u_lightDir);
        float diff = max(dot(normal, lightDir), 0.0);
        diff = diff * 0.5 + 0.5;
        vec3 halfwayDir = normalize(lightDir + viewDir);
        float spec = pow(max(dot(normal, halfwayDir), 0.0), 128.0);
        // Fresnel clamped to 0.55 max instead of reaching 1.0 — the
        // uncapped version was tuned for ocean-water.html's orbiting demo
        // camera, which never held a true grazing angle for long. A
        // ground-level FPS camera looking toward the horizon across this
        // huge plane sits at grazing angle almost constantly, so the old
        // curve pushed alpha/color to near-fully-opaque pale blue-white
        // across the whole distant view — washing out anything behind it
        // (reported as a "translucent ghost tower"). Capping the fresnel
        // contribution keeps the rim-brightening effect close-up without
        // letting it fully whitewash distant geometry.
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
        fresnel = min(fresnel, 0.55);
        vec3 skyColor = vec3(0.7, 0.8, 0.9);
        albedo = mix(albedo, skyColor, fresnel * 0.8);
        vec3 finalColor = albedo * (diff * 0.8 + 0.2) + vec3(1.0) * spec * 0.6;
        float alpha = mix(u_opacity, 1.0, fresnel);
        alpha = max(alpha, foamMix);
        gl_FragColor = vec4(finalColor, alpha);
    }
`;

// Exact presets from ocean-water.html, unchanged.
const PRESETS = {
    calm: {
        speed: 0.5, elevationScale: 1.0,
        depthColor: '#07182e', surfaceColor: '#1f6580', foamColor: '#ffffff',
        colorOffset: 0.5, colorMultiplier: 1.5, foamThreshold: 2.0, opacity: 0.45,
        w1_dir: 45, w1_steep: 0.05, w1_len: 15,
        w2_dir: 120, w2_steep: 0.03, w2_len: 8,
        w3_dir: 200, w3_steep: 0.01, w3_len: 3,
        w4_dir: 0, w4_steep: 0.0, w4_len: 1
    },
    ocean: {
        speed: 1.0, elevationScale: 1.0,
        depthColor: '#0a1d3a', surfaceColor: '#1ca3ec', foamColor: '#ffffff',
        colorOffset: 0.25, colorMultiplier: 2.0, foamThreshold: 1.2, opacity: 0.7,
        w1_dir: 45, w1_steep: 0.15, w1_len: 20,
        w2_dir: 120, w2_steep: 0.15, w2_len: 10,
        // w3/w4 were 5 and 2 — far shorter than the ocean mesh's ~12.5
        // unit/quad tessellation (2000-unit plane, 160 segments). A wave
        // shorter than a quad can't be represented by that quad's vertices
        // at all, so per-vertex normals flip wildly frame to frame — the
        // moire/banding pattern seen in-game. Lengthened both to sit
        // closer to (still under, for some chop) the mesh's actual
        // resolution instead of far below it. Re-tessellating the mesh to
        // properly resolve a real 2-unit wave across 2000 units would cost
        // ~2000 segments — not viable alongside the other lag fixes.
        w3_len: 12, w4_len: 9,
        w3_dir: 200, w3_steep: 0.08,
        w4_dir: 0, w4_steep: 0.04
    },
    storm: {
        speed: 1.8, elevationScale: 1.5,
        depthColor: '#050c14', surfaceColor: '#1a334d', foamColor: '#e2e8f0',
        colorOffset: 0.1, colorMultiplier: 1.0, foamThreshold: 0.8, opacity: 0.95,
        w1_dir: 45, w1_steep: 0.35, w1_len: 35,
        w2_dir: 120, w2_steep: 0.25, w2_len: 18,
        w3_dir: 200, w3_steep: 0.2, w3_len: 8,
        w4_dir: 0, w4_steep: 0.15, w4_len: 3
    }
};

function buildGerstnerMaterial(presetName) {
    const p = PRESETS[presetName];
    const uniforms = {
        u_time: { value: 0 },
        u_speed: { value: p.speed },
        u_elevationScale: { value: p.elevationScale },
        u_depthColor: { value: new THREE.Color(p.depthColor) },
        u_surfaceColor: { value: new THREE.Color(p.surfaceColor) },
        u_foamColor: { value: new THREE.Color(p.foamColor) },
        u_colorOffset: { value: p.colorOffset },
        u_colorMultiplier: { value: p.colorMultiplier },
        u_foamThreshold: { value: p.foamThreshold },
        u_opacity: { value: p.opacity },
        u_lightDir: { value: new THREE.Vector3(1.0, 1.0, 1.0).normalize() },
        u_waves: {
            value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()]
        }
    };

    const setWave = (i, dir, steep, len) => {
        const rad = dir * (Math.PI / 180);
        uniforms.u_waves.value[i].set(Math.cos(rad), Math.sin(rad), steep, len);
    };
    setWave(0, p.w1_dir, p.w1_steep, p.w1_len);
    setWave(1, p.w2_dir, p.w2_steep, p.w2_len);
    setWave(2, p.w3_dir, p.w3_steep, p.w3_len);
    setWave(3, p.w4_dir, p.w4_steep, p.w4_len);

    return new THREE.ShaderMaterial({
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        uniforms,
        transparent: true,
        side: THREE.DoubleSide
    });
}

function buildGerstnerMesh(size, segments, presetName) {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const mat = buildGerstnerMaterial(presetName);
    return new THREE.Mesh(geo, mat);
}

export function createWater(state) {
    // --- Lake: try THREE.Water reflection first ---
    const lakeGeo = new THREE.PlaneGeometry(160, 160);
    const textureLoader = new THREE.TextureLoader();

    textureLoader.load(
        'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/waternormals.jpg',
        (texture) => {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            initReflectionLake(state, lakeGeo, texture);
        },
        undefined,
        (err) => {
            console.warn('Water normals texture failed to load — falling back to Gerstner lake (Calm Lake preset).', err);
            initGerstnerLakeFallback(state);
        }
    );

    // --- Outer ocean: Gerstner "Ocean Breeze" preset, unconditional (see
    // module comment for why this doesn't attempt THREE.Water at all) ---
    // Size dropped from WORLD_SIZE*6 (4800) to WORLD_SIZE*2.5 (2000) — at
    // 4800 units with only 128 segments, quads were ~37 units across
    // while the Gerstner waves have 3-20 unit wavelengths: catastrophically
    // under-tessellated relative to the wave math, producing chaotic
    // per-vertex normals and the dark radiating moire/banding artifact
    // seen in-game. 2000/160 segments = 12.5 units/quad, still coarse but
    // no longer badly aliased against the shortest (3-unit) wavelength.
    // Fog (state.scene.fog, FogExp2) hides the now-closer edge instead of
    // needing the plane to physically reach the horizon.
    const oceanMesh = buildGerstnerMesh(WORLD_SIZE * 2.5, 160, 'ocean');
    oceanMesh.position.y = -3;
    state.oceanMesh = oceanMesh;
    state.scene.add(oceanMesh);
}

function initReflectionLake(state, lakeGeo, texture) {
    const water = new Water(lakeGeo, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: texture,
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x001e0f,
        distortionScale: 3.7,
        fog: state.scene.fog !== undefined
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    state.water = water; // read by atmosphere/day-night-cycle.js
    state.scene.add(water);
}

function initGerstnerLakeFallback(state) {
    const lakeMesh = buildGerstnerMesh(160, 128, 'calm');
    lakeMesh.position.y = 0;
    state.lakeFallbackMesh = lakeMesh;
    state.scene.add(lakeMesh);
    // state.water intentionally left unset — day-night-cycle.js checks for
    // it before touching sunDirection/sunColor, so no hookup needed here.
}

// Called every frame from main.js's animate() loop.
export function updateWater(state, ts) {
    if (state.water) {
        state.water.material.uniforms['time'].value += 1 / 60; // THREE.Water expects a delta-like increment, not absolute ts
    }
    if (state.lakeFallbackMesh) {
        const u = state.lakeFallbackMesh.material.uniforms;
        u.u_time.value = ts;
        if (state.sunPosition) u.u_lightDir.value.copy(state.sunPosition).normalize();
    }
    if (state.oceanMesh) {
        const u = state.oceanMesh.material.uniforms;
        u.u_time.value = ts;
        if (state.sunPosition) u.u_lightDir.value.copy(state.sunPosition).normalize();
    }
}