// Procedural terrain — height function ported EXACTLY from
// dynamic_procedural_terrain_engine.html's hash2/noise2D/cpuFbm/
// getCPUTerrainHeight (that reference kept a CPU-side copy of its GLSL
// noise in sync for player/vegetation placement, since sampling the GPU
// shader isn't possible from JS — same reason this needs to exist here).
//
// NOTE: this only ports the CPU height function + a plain
// MeshStandardMaterial terrain mesh for now, not the reference's full
// GLSL shader (fBm/ridged/domain-warp blend + sand/grass/rock/snow height
// banding + terracing). That shader is a much bigger port — flagging it
// as the next piece to bring over rather than silently giving you a
// flat-shaded placeholder forever.

import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL } from '../core/world-state.js';

function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function hash2(x, y) {
    const px = x * 127.1 + y * 311.7;
    const py = x * 269.5 + y * 183.3;
    const sinx = Math.sin(px) * 43758.5453123;
    const siny = Math.sin(py) * 43758.5453123;
    return [(sinx - Math.floor(sinx)) * 2 - 1, (siny - Math.floor(siny)) * 2 - 1];
}

function noise2D(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);

    const g00 = hash2(ix, iy), g10 = hash2(ix + 1, iy);
    const g01 = hash2(ix, iy + 1), g11 = hash2(ix + 1, iy + 1);

    const d00 = g00[0] * fx + g00[1] * fy;
    const d10 = g10[0] * (fx - 1) + g10[1] * fy;
    const d01 = g01[0] * fx + g01[1] * (fy - 1);
    const d11 = g11[0] * (fx - 1) + g11[1] * (fy - 1);

    const nx0 = d00 + ux * (d10 - d00);
    const nx1 = d01 + ux * (d11 - d01);
    return nx0 + uy * (nx1 - nx0);
}

// General-purpose noise export — other modules (flowers.js's biome
// clustering, grass bald-patch scatter, etc.) want raw noise, not the
// terrain-specific fbm/height curve below.
export function noise(x, y) {
    return noise2D(x, y);
}

function cpuFbm(x, y, octaves, persistence, lacunarity) {
    let total = 0, amp = 1.0, freq = 1.0, maxV = 0;
    for (let i = 0; i < octaves; i++) {
        total += noise2D(x * freq, y * freq) * amp;
        maxV += amp;
        amp *= persistence;
        freq *= lacunarity;
    }
    return total / maxV;
}

export function getElevation(x, z, state) {
    const p = state.terrainParams;
    const sampleX = (x + p.offsetX + p.seed) * p.scale;
    const sampleZ = (z + p.offsetY + p.seed) * p.scale;
    let h = cpuFbm(sampleX, sampleZ, p.octaves, p.persistence, p.lacunarity);
    h = Math.pow(Math.max(0, h + 0.5), 1.6);
    h *= p.elevation;

    // Island falloff — without this the fbm heightfield runs edge to edge
    // (land everywhere, ocean plane just floating around/under it), which
    // is why it never actually read as an island. Blend the real
    // heightfield toward a seabed depth as distance from center grows, so
    // land genuinely ends and a shoreline forms against WATER_LEVEL.
    const dist = Math.sqrt(x * x + z * z);
    const islandRadius = WORLD_SIZE * 0.5;
    const coastStart = islandRadius * 0.55; // land holds full height inside this
    const coastEnd = islandRadius * 0.92;   // fully seabed by here
    const mask = 1.0 - smoothstep(coastStart, coastEnd, dist);
    const seabedDepth = WATER_LEVEL - 16;
    h = h * mask + seabedDepth * (1 - mask);

    return h;
}

export function createTerrain(state) {
    const res = 256; // halved from the reference's 512 (262k verts) — that
    // was tuned for a GPU-shader-driven demo with no other scene content;
    // this project layers grass/forest/rocks/water on top, so starting
    // leaner here and raising it later if it looks too low-poly.
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res, res);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        posAttr.setY(i, getElevation(x, z, state));
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 1.0 });
    // Cheap fragment-shader detail — no extra geometry (so no extra lag),
    // just fixing the "flat green plastic hill" look from a single solid
    // color + coarse-mesh soft normals. Adds: (1) height/slope-based
    // color blend across dirt/grass/rock bands, (2) a fine noise-based
    // fake bump so the surface reads as textured instead of billiard-
    // ball smooth even where the actual mesh is flat.
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uWaterLevel = { value: WATER_LEVEL };
        mat.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPosTerrain;
            varying vec3 vObjectNormalTerrain;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vWorldPosTerrain = (modelMatrix * vec4(position, 1.0)).xyz;
            vObjectNormalTerrain = normal;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPosTerrain;
            varying vec3 vObjectNormalTerrain;
            uniform float uWaterLevel;

            float hashTerrain(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }
            float noiseTerrain(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                float a = hashTerrain(i), b = hashTerrain(i + vec2(1.0, 0.0));
                float c = hashTerrain(i + vec2(0.0, 1.0)), d = hashTerrain(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            vec3 dirtColor = vec3(0.15, 0.11, 0.07);
            vec3 grassColor = vec3(0.13, 0.17, 0.10);
            vec3 rockColor = vec3(0.38, 0.37, 0.34);
            vec3 sandColor = vec3(0.30, 0.26, 0.18);
            vec3 wetSandColor = vec3(0.20, 0.17, 0.12);

            float slope = 1.0 - vObjectNormalTerrain.y; // 0 flat, ~1 vertical
            float heightBand = smoothstep(18.0, 30.0, vWorldPosTerrain.y);

            vec3 albedo = mix(dirtColor, grassColor, smoothstep(0.15, 0.4, 1.0 - slope));
            albedo = mix(albedo, rockColor, smoothstep(0.35, 0.7, slope));
            albedo = mix(albedo, rockColor, heightBand * 0.7);

            // Beach band: sand right at the shoreline, darker "wet sand"
            // just above the waterline, fading back to grass/dirt inland.
            // Slope-gated so cliffs dropping straight into water don't
            // get sand-washed — only gentle shoreline reads as beach.
            float sandHeight = smoothstep(uWaterLevel - 0.3, uWaterLevel + 3.2, vWorldPosTerrain.y);
            float wetBand = 1.0 - smoothstep(uWaterLevel + 0.1, uWaterLevel + 1.0, vWorldPosTerrain.y);
            float beachMask = (1.0 - sandHeight) * smoothstep(0.55, 0.15, slope);
            vec3 beachColor = mix(sandColor, wetSandColor, wetBand);
            albedo = mix(albedo, beachColor, beachMask);

            // Fine noise-based color speckle so the surface doesn't read as
            // one flat airbrushed color even within a single band.
            float fine = noiseTerrain(vWorldPosTerrain.xz * 2.2) * 0.5 + noiseTerrain(vWorldPosTerrain.xz * 7.0) * 0.5;
            albedo *= 0.85 + fine * 0.3;

            vec4 diffuseColor = vec4(albedo, opacity);
            `
        );

        // Fake fine bump — perturbs the shading normal with noise instead
        // of adding real geometry displacement, so it's nearly free.
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
            {
                float nx = noiseTerrain(vWorldPosTerrain.xz * 5.0 + vec2(13.1, 7.7));
                float nz = noiseTerrain(vWorldPosTerrain.xz * 5.0 + vec2(91.3, 2.2));
                normal = normalize(normal + vec3((nx - 0.5) * 0.35, 0.0, (nz - 0.5) * 0.35));
            }`
        );
    };
    state.terrainMesh = new THREE.Mesh(geo, mat);
    state.terrainMesh.receiveShadow = true;
    state.scene.add(state.terrainMesh);
}