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

// Direct port of generateRock() — builds one displaced-icosahedron mesh
// per call, given the same param shape rockParams had in the reference.
function buildRockMesh(params) {
    const geometry = new THREE.IcosahedronGeometry(1, params.detail);
    const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(params.baseColor),
        roughness: 0.8,
        metalness: 0.1,
        flatShading: params.flatShading,
    });

    const customUniforms = {
        u_seed: { value: params.seed },
        u_displacementStrength: { value: params.displacementStrength },
        u_noiseScale: { value: params.noiseScale },
        u_roughness: { value: params.roughness },
        u_lacunarity: { value: params.lacunarity },
        u_octaves: { value: params.octaves },
        u_baseColor: { value: new THREE.Color(params.baseColor) },
        u_accentColor: { value: new THREE.Color(params.accentColor) },
    };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.u_seed = customUniforms.u_seed;
        shader.uniforms.u_displacementStrength = customUniforms.u_displacementStrength;
        shader.uniforms.u_noiseScale = customUniforms.u_noiseScale;
        shader.uniforms.u_roughness = customUniforms.u_roughness;
        shader.uniforms.u_lacunarity = customUniforms.u_lacunarity;
        shader.uniforms.u_octaves = customUniforms.u_octaves;
        shader.uniforms.u_baseColor = customUniforms.u_baseColor;
        shader.uniforms.u_accentColor = customUniforms.u_accentColor;

        shader.vertexShader = `
            uniform float u_seed;
            uniform float u_displacementStrength;
            uniform float u_noiseScale;
            uniform float u_roughness;
            uniform float u_lacunarity;
            uniform int u_octaves;

            varying float vNoiseValue;

            ${noise3DGLSL}
            ${fbmGLSL}

            vec3 getDisplacedPosition(vec3 pos) {
                vec3 noisePos = pos + vec3(u_seed);
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
            vNoiseValue = fbm(position + vec3(u_seed), u_noiseScale, u_roughness, u_lacunarity, u_octaves);
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

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

// A handful of distinct rock "recipes" (detail/color/displacement combos),
// each instantiated multiple times at different world placements/scales
// below — not GUI-tunable like the reference, just fixed variety.
const ROCK_TYPES = [
    { detail: 5, seed: 1.0, displacementStrength: 0.35, noiseScale: 1.2, roughness: 0.55, lacunarity: 2.1, octaves: 5, baseColor: '#5C6061', accentColor: '#424546', flatShading: true },
    { detail: 4, seed: 4.2, displacementStrength: 0.5, noiseScale: 0.9, roughness: 0.6, lacunarity: 2.3, octaves: 4, baseColor: '#6b6255', accentColor: '#4a4238', flatShading: true },
    { detail: 5, seed: 7.7, displacementStrength: 0.28, noiseScale: 1.6, roughness: 0.5, lacunarity: 2.0, octaves: 5, baseColor: '#565b52', accentColor: '#3a3e37', flatShading: false },
];

export function createRocks(state) {
    const ROCK_RADIUS = 260;
    const placements = 90;
    state.rockGroup = new THREE.Group();

    let placed = 0;
    for (let i = 0; i < placements * 3 && placed < placements; i++) {
        const r = Math.sqrt(Math.random()) * ROCK_RADIUS;
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z, state);
        if (y < 1.5) continue; // keep out of the lake
        if (Math.hypot(x - 0, z - 20) < 12) continue; // keep clear of player spawn (0, _, 20)

        const params = { ...ROCK_TYPES[Math.floor(Math.random() * ROCK_TYPES.length)], seed: Math.random() * 100 };
        const rockMesh = buildRockMesh(params);

        const scale = 0.8 + Math.random() * 2.5;
        rockMesh.scale.set(scale * (0.8 + Math.random() * 0.4), scale * (0.7 + Math.random() * 0.4), scale * (0.8 + Math.random() * 0.4));
        rockMesh.position.set(x, y + scale * 0.3, z); // partially bury base in terrain
        rockMesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI);

        state.rockGroup.add(rockMesh);

        // Same {x, z, r} circle-collider shape forest.js/pine-trees.js
        // already push — main.js's player controller reads this array
        // generically, so rocks just needed to start contributing to it.
        // Base geometry is roughly unit-radius before scaling; average the
        // asymmetric x/z scale factors for a reasonable circle approximation
        // (rocks aren't circular, but a slightly-off collision radius on a
        // static rock is a much smaller problem than no collision at all).
        state.colliders.push({ x, z, r: scale * 0.75 });

        // Moss on ~40% of placed rocks, larger ones only — small pebbles
        // shouldn't visually compete with a mossy boulder.
        if (scale > 1.6 && Math.random() < 0.4) {
            rockMesh.geometry.computeVertexNormals();
            const moss = applyMoss(state, rockMesh.geometry, 1);
            if (moss) {
                moss.scale.copy(rockMesh.scale);
                moss.position.copy(rockMesh.position);
                moss.rotation.copy(rockMesh.rotation);
                state.rockGroup.add(moss);
            }
        }

        placed++;
    }
    state.scene.add(state.rockGroup);
}
