// Rocks — noise-displaced icosahedrons with baseColor/accentColor blend,
// ported from rock.html's generateRock() (the GLSL displacement shader,
// snoise/fbm functions, and normal-recompute trick are copied verbatim).
// That reference generated ONE rock per GUI tweak as a standalone mesh
// with its own material/uniform set each time. Adapted here to build a
// small set of distinct rock "types" (still individual meshes, each with
// its own displaced geometry+material, since the displacement happens in
// the vertex shader per-instance parameters aren't trivial to share) and
// scatter multiple placed copies of each type across the terrain.
//
// Moss is applied via environment/foliage.js's applyMoss(), extracted
// from foliage.html specifically so rocks.js could call it here.

import * as THREE from 'three';
import { getElevation } from './terrain.js';
import { applyMoss } from './foliage.js';
import { getSettings } from '../core/settings.js';
import { buildChunkedInstancedField } from '../core/chunks.js';

const noise3DGLSL = `
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+10.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
        const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

        vec3 i  = floor(v + dot(v, C.yyy) );
        vec3 x0 = v - i + dot(i, C.xxx) ;

        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );

        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;

        i = mod289(i);
        vec4 p = permute( permute( permute(
                    i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;

        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );

        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );

        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);

        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;

        vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                    dot(p2,x2), dot(p3,x3) ) );
    }
`;

const fbmGLSL = `
    float fbm(vec3 p, float scale, float roughness, float lacunarity, int octaves) {
        float value = 0.0;
        float amplitude = 1.0;
        float frequency = scale;
        float maxAmp = 0.0;

        for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            value += amplitude * snoise(p * frequency);
            maxAmp += amplitude;
            frequency *= lacunarity;
            amplitude *= roughness;
        }

        return value / maxAmp;
    }
`;

// Direct port of generateRock() — builds the shared geometry+material for
// ONE rock "type" (detail/color/displacement recipe). Used to be built
// per-rock (one Mesh, one material, one u_seed uniform, each instance
// fully independent) — converted to real instancing: all rocks sharing a
// type now share this ONE geometry+material, with per-instance variation
// coming from an `aSeed` instanced attribute (set per-instance in
// createRocks() via core/chunks.js's extraAttribute) instead of a
// per-material uniform. See core/chunks.js's own header comment for why a
// custom instanced attribute needs its own geometry per chunk rather than
// sharing this one directly — that's handled there, not here.
function buildRockMaterial(params, settings) {
    const detailDelta = { low: -2, med: 0, high: 1 }[settings.rockDetail] ?? 0;
    const detail = Math.max(1, params.detail + detailDelta);
    const geometry = new THREE.IcosahedronGeometry(1, detail);
    const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(params.baseColor),
        roughness: Math.min(1, 0.8 * (settings.rockRoughnessMult ?? 1.0)),
        metalness: 0.1,
        flatShading: params.flatShading,
    });

    const customUniforms = {
        u_displacementStrength: { value: params.displacementStrength },
        u_noiseScale: { value: params.noiseScale },
        u_roughness: { value: params.roughness },
        u_lacunarity: { value: params.lacunarity },
        u_octaves: { value: params.octaves },
        u_baseColor: { value: new THREE.Color(params.baseColor) },
        u_accentColor: { value: new THREE.Color(params.accentColor) },
    };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.u_displacementStrength = customUniforms.u_displacementStrength;
        shader.uniforms.u_noiseScale = customUniforms.u_noiseScale;
        shader.uniforms.u_roughness = customUniforms.u_roughness;
        shader.uniforms.u_lacunarity = customUniforms.u_lacunarity;
        shader.uniforms.u_octaves = customUniforms.u_octaves;
        shader.uniforms.u_baseColor = customUniforms.u_baseColor;
        shader.uniforms.u_accentColor = customUniforms.u_accentColor;

        shader.vertexShader = `
            attribute float aSeed;
            uniform float u_displacementStrength;
            uniform float u_noiseScale;
            uniform float u_roughness;
            uniform float u_lacunarity;
            uniform int u_octaves;

            varying float vNoiseValue;

            ${noise3DGLSL}
            ${fbmGLSL}

            vec3 getDisplacedPosition(vec3 pos) {
                vec3 noisePos = pos + vec3(aSeed);
                float noise = fbm(noisePos, u_noiseScale, u_roughness, u_lacunarity, u_octaves);
                return pos + normalize(pos) * (noise * u_displacementStrength);
            }
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <beginnormal_vertex>',
            `
            float offset = 0.01;
            vec3 tangent_vec = normalize(cross(position, vec3(0.0, 1.0, 0.0)));
            if (length(tangent_vec) < 0.1) tangent_vec = normalize(cross(position, vec3(1.0, 0.0, 0.0)));
            vec3 binormal_vec = cross(normalize(position), tangent_vec);

            vec3 displacedCenter = getDisplacedPosition(position);
            vec3 posA = getDisplacedPosition(position + tangent_vec * offset);
            vec3 posB = getDisplacedPosition(position + binormal_vec * offset);

            vec3 objectNormal = normalize(cross(posA - displacedCenter, posB - displacedCenter));

            if (dot(objectNormal, normalize(displacedCenter)) < 0.0) {
                objectNormal = -objectNormal;
            }

            #ifdef USE_TANGENT
                vec3 objectTangent = vec3( tangent.xyz );
            #endif
            `
        );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            vec3 transformed = getDisplacedPosition(position);
            vNoiseValue = fbm(position + vec3(aSeed), u_noiseScale, u_roughness, u_lacunarity, u_octaves);
            `
        );

        shader.fragmentShader = `
            uniform vec3 u_baseColor;
            uniform vec3 u_accentColor;
            varying float vNoiseValue;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            float blend = (vNoiseValue + 1.0) * 0.5;
            blend = smoothstep(0.3, 0.7, blend);
            vec3 mixedColor = mix(u_accentColor, u_baseColor, blend);
            vec4 diffuseColor = vec4( mixedColor, opacity );
            `
        );
    };

    return { geometry, material };
}

// A handful of distinct rock "recipes" (detail/color/displacement combos),
// each instantiated multiple times at different world placements/scales
// below — not GUI-tunable like the reference, just fixed variety.
const ROCK_TYPES = [
    { detail: 5, seed: 1.0, displacementStrength: 0.35, noiseScale: 1.2, roughness: 0.55, lacunarity: 2.1, octaves: 5, baseColor: '#5C6061', accentColor: '#424546', flatShading: true },
    { detail: 4, seed: 4.2, displacementStrength: 0.5, noiseScale: 0.9, roughness: 0.6, lacunarity: 2.3, octaves: 4, baseColor: '#6b6255', accentColor: '#4a4238', flatShading: true },
    { detail: 5, seed: 7.7, displacementStrength: 0.28, noiseScale: 1.6, roughness: 0.5, lacunarity: 2.0, octaves: 5, baseColor: '#565b52', accentColor: '#3a3e37', flatShading: false },
];
const MAX_DISPLACEMENT = Math.max(...ROCK_TYPES.map(t => t.displacementStrength)); // 0.5 — used below for chunk bounding-sphere padding

export function createRocks(state) {
    const ROCK_RADIUS = 260;
    const placements = (state.quality && state.quality.rockCount) || 90;
    const settings = getSettings();
    state.rockGroup = new THREE.Group(); // moss meshes only now — the rock instances themselves are added straight to state.scene by buildChunkedInstancedField
    state.rockFields = [];

    const byType = ROCK_TYPES.map(() => []);
    const mossQueue = [];
    let placed = 0;

    for (let i = 0; i < placements * 3 && placed < placements; i++) {
        const r = Math.sqrt(Math.random()) * ROCK_RADIUS;
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z, state);
        if (y < 1.5) continue; // keep out of the lake
        if (Math.hypot(x - 0, z - 20) < 12) continue; // keep clear of player spawn (0, _, 20)

        const typeIndex = Math.floor(Math.random() * ROCK_TYPES.length);
        const seed = Math.random() * 100;
        const scale = 0.8 + Math.random() * 2.5;
        const scaleX = scale * (0.8 + Math.random() * 0.4);
        const scaleY = scale * (0.7 + Math.random() * 0.4);
        const scaleZ = scale * (0.8 + Math.random() * 0.4);
        const rotX = Math.random() * Math.PI, rotY = Math.random() * Math.PI * 2, rotZ = Math.random() * Math.PI;
        const py = y + scale * 0.3; // partially bury base in terrain

        byType[typeIndex].push({ x, y: py, z, scaleX, scaleY, scaleZ, rotX, rotY, rotZ, seed });

        // Same {x, z, r} circle-collider shape forest.js/pine-trees.js
        // already push — main.js's player controller reads this array
        // generically. Base geometry is roughly unit-radius before
        // scaling; average the asymmetric x/z scale factors for a
        // reasonable circle approximation (rocks aren't circular, but a
        // slightly-off collision radius on a static rock is a much
        // smaller problem than no collision at all).
        state.colliders.push({ x, z, r: scale * 0.75 });

        // Moss on ~40% of placed rocks, larger ones only — small pebbles
        // shouldn't visually compete with a mossy boulder.
        if (scale > 1.6 && Math.random() < 0.4) {
            mossQueue.push({ typeIndex, x, y: py, z, scaleX, scaleY, scaleZ, rotX, rotY, rotZ });
        }

        placed++;
    }

    const typeGeometries = [];
    for (let t = 0; t < ROCK_TYPES.length; t++) {
        const typePlacements = byType[t];
        typeGeometries.push(null);
        if (!typePlacements.length) continue;

        const { geometry, material } = buildRockMaterial(ROCK_TYPES[t], settings);
        geometry.computeVertexNormals(); // needed for applyMoss()'s upward-facing-vertex check below, same as the pre-instancing version did per-rock — now done once per shared type geometry instead
        typeGeometries[t] = geometry;

        const field = buildChunkedInstancedField({
            scene: state.scene,
            geometry, material,
            worldExtent: ROCK_RADIUS * 2 + 40,
            cellSize: 60,
            drawDistance: (settings.drawDistance || 150) * 1.3, // matches the old per-mesh updateRocks()'s 1.3x margin — rocks are chunky/solid enough that popping out early reads worse than for grass/flowers
            placements: typePlacements,
            extraAttribute: { name: 'aSeed', getValue: (item) => item.seed },
            boundsPadding: MAX_DISPLACEMENT * 3.5, // covers max displacement (0.5) times roughly the largest scale factor rocks get (up to ~3.3), so chunks don't cull out while still partially on-screen
        });
        for (const chunk of field.chunks) { chunk.castShadow = true; chunk.receiveShadow = true; }
        state.rockFields.push(field);
    }

    // Moss — same applyMoss() call pattern as before the instancing
    // conversion, just sourcing transform from each queued placement's
    // plain data instead of an individual rock Mesh object (rocks no
    // longer exist as individual Mesh instances now that they're
    // instanced/chunked above). applyMoss() samples the shared TYPE
    // geometry's un-displaced vertex positions either way — that was
    // already true before this conversion too (vertex displacement is
    // GPU-shader-only, never written back to CPU-side geometry data), so
    // moss placement accuracy is unchanged, not a regression.
    for (const m of mossQueue) {
        const baseGeometry = typeGeometries[m.typeIndex];
        if (!baseGeometry) continue;
        const moss = applyMoss(state, baseGeometry, 1);
        if (moss) {
            moss.scale.set(m.scaleX, m.scaleY, m.scaleZ);
            moss.position.set(m.x, m.y, m.z);
            moss.rotation.set(m.rotX, m.rotY, m.rotZ);
            state.rockGroup.add(moss);
        }
    }

    state.scene.add(state.rockGroup);
}

// Chunk-level distance culling, same idea as chunks.js's other fields —
// replaces the old per-Mesh distance-visibility loop, since rocks are no
// longer individual Mesh objects in state.rockGroup.children.
export function updateRocks(state) {
    if (!state.rockFields || !state.camera) return;
    for (const field of state.rockFields) field.update(state.camera.position);
}
