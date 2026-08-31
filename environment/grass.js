// Player-relative "sliding window" grass — ported from "Making Grass with
// Triangles in GLSL using Three.js" (Peter Adams, Antaeus AR). Replaces the
// old approach (an InstancedMesh with up to 1.1M static blade instances
// scattered once across the entire GRASS_RADIUS disc, rasterized every
// frame regardless of camera distance) with a much smaller patch of blades
// that continuously wraps around wherever the player currently is. Total
// blade count (core/quality.js's grassCount) no longer needs to scale with
// world size at all — visual density right around the player is the same
// or better, at a fraction of the vertex count, because grass far from the
// player was never contributing to what's actually on screen anyway.
//
// Each blade is 3 vertices (a single triangle, not instanced geometry) all
// initialized to the SAME position — width/height/bend are added entirely
// in the vertex shader based on a per-vertex color marker (bottom-left/
// bottom-right/top-center), same trick the article uses. There is no
// InstancedMesh here at all; it's one big non-indexed BufferGeometry drawn
// as a single triangle-soup draw call.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { getElevation } from './terrain.js';

// map()/mix() helper matching the article's GLSL — used in comments only,
// kept here as a reminder of the shader-side equivalent since there's no
// direct JS analog needed at build time.

export async function createGrass(state, onProgress) {
    const count = state.quality.grassCount;
    const patchSize = state.quality.grassPatchSize;
    const halfWorld = WORLD_SIZE / 2;

    // --- Bake a heightmap texture from getElevation() -------------------
    // The article samples a heightmap texture pre-rendered in Blender; we
    // don't have that, but getElevation() (environment/terrain.js) is a
    // pure function of world X/Z, so the same texture can be baked at
    // runtime by sampling it over a grid. Covers the FULL world extent
    // (not just one patch) since the player-relative window can end up
    // anywhere on the map as they walk.
    const HEIGHTMAP_RES = 384;
    const heightData = new Float32Array(HEIGHTMAP_RES * HEIGHTMAP_RES);
    const ROWS_PER_YIELD = 24; // chunk the bake so it doesn't freeze the loading screen
    for (let row = 0; row < HEIGHTMAP_RES; row++) {
        const z = -halfWorld + (row / (HEIGHTMAP_RES - 1)) * WORLD_SIZE;
        for (let col = 0; col < HEIGHTMAP_RES; col++) {
            const x = -halfWorld + (col / (HEIGHTMAP_RES - 1)) * WORLD_SIZE;
            heightData[row * HEIGHTMAP_RES + col] = getElevation(x, z);
        }
        if (row > 0 && row % ROWS_PER_YIELD === 0) {
            if (onProgress) onProgress((row / HEIGHTMAP_RES) * 0.5); // bake is ~half of this step's work
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    }
    const heightMap = new THREE.DataTexture(heightData, HEIGHTMAP_RES, HEIGHTMAP_RES, THREE.RedFormat, THREE.FloatType);
    heightMap.minFilter = THREE.LinearFilter;
    heightMap.magFilter = THREE.LinearFilter;
    heightMap.needsUpdate = true;
    state.grassHeightMap = heightMap; // kept for disposal on quality-change reload paths, if ever added

    // --- Build the blade triangle-soup geometry --------------------------
    const positions = new Float32Array(count * 3 * 3);
    const colors = new Float32Array(count * 3 * 3);
    const origins = new Float32Array(count * 3 * 3);
    const yaws = new Float32Array(count * 3 * 3);

    const halfPatch = patchSize * 0.5;
    for (let i = 0; i < count; i++) {
        const ox = (Math.random() - 0.5) * patchSize;
        const oz = (Math.random() - 0.5) * patchSize;
        const yaw = Math.random() * Math.PI * 2;
        const yawX = Math.sin(yaw), yawZ = -Math.cos(yaw);

        const base = i * 9; // 3 verts * 3 floats
        // All three vertices start at the same origin — width/height are
        // added purely by the vertex shader below, keyed off vertex color.
        for (let v = 0; v < 3; v++) {
            positions[base + v * 3] = ox;
            positions[base + v * 3 + 1] = 0;
            positions[base + v * 3 + 2] = oz;
            origins[base + v * 3] = ox;
            origins[base + v * 3 + 1] = 0;
            origins[base + v * 3 + 2] = oz;
            yaws[base + v * 3] = yawX;
            yaws[base + v * 3 + 1] = 0;
            yaws[base + v * 3 + 2] = yawZ;
        }
        // bottom-left, bottom-right, top-center color markers (article's
        // convention: R=0.1 -> shift one way, B=0.1 -> shift the other,
        // G=1.0 -> this is the top vertex that height/wind apply to).
        colors[base + 0] = 0.1; colors[base + 1] = 0; colors[base + 2] = 0;
        colors[base + 3] = 0; colors[base + 4] = 0; colors[base + 5] = 0.1;
        colors[base + 6] = 1; colors[base + 7] = 1; colors[base + 8] = 1;

        if (i > 0 && i % 40000 === 0) {
            if (onProgress) onProgress(0.5 + (i / count) * 0.5);
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 3));
    geo.setAttribute('aYaw', new THREE.BufferAttribute(yaws, 3));
    // The player-relative wrap means vertex positions in local space bear
    // no relationship to where blades actually render in the world, so
    // three's frustum-culling bounding sphere (computed from raw position
    // data) would be meaningless here — always draw.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    state.grassMat = new THREE.ShaderMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        uniforms: {
            uTime: { value: 0 },
            uPlayerPosition: { value: new THREE.Vector3() },
            uHeightMap: { value: heightMap },
            uNoiseTexture: { value: state.globalTextures.grassNoise },
            uDiffuseMap: { value: state.globalTextures.grassDiffuse },
            uPatchSize: { value: patchSize },
            uBladeWidth: { value: 0.05 },
            uMaxBladeHeight: { value: 1.7 },
            uWindDirection: { value: Math.PI * 0.25 },
            uWindSpeed: { value: 0.35 },
            uWindNoiseScale: { value: 0.9 },
            uMaxBendAngle: { value: 18.0 },
            uBaldPatchModifier: { value: 1.4 },
            uWorldMin: { value: -halfWorld },
            uWorldMax: { value: halfWorld },
            // Day/night response — grass has no scene-light lookup of its
            // own (a raw ShaderMaterial, not MeshStandardMaterial), so
            // atmosphere/day-night-cycle.js feeds a simple ambient
            // multiplier + tint each frame instead of full PBR lighting,
            // which would cost far more than this patch-based approach
            // saves in the first place.
            uLightColor: { value: new THREE.Color(0xffffff) },
            uAmbient: { value: 1.0 }
        },
        vertexShader: `
            attribute vec3 aOrigin;
            attribute vec3 aYaw;
            uniform float uTime;
            uniform vec3 uPlayerPosition;
            uniform sampler2D uHeightMap;
            uniform sampler2D uNoiseTexture;
            uniform sampler2D uDiffuseMap;
            uniform float uPatchSize;
            uniform float uBladeWidth;
            uniform float uMaxBladeHeight;
            uniform float uWindDirection;
            uniform float uWindSpeed;
            uniform float uWindNoiseScale;
            uniform float uMaxBendAngle;
            uniform float uBaldPatchModifier;
            uniform float uWorldMin;
            uniform float uWorldMax;
            varying vec3 vColor;
            varying float vShade;

            float randSeed(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
            }

            mat3 rotateAxisAngle(vec3 axis, float angle) {
                axis = normalize(axis);
                float s = sin(angle);
                float c = cos(angle);
                float oc = 1.0 - c;
                return mat3(
                    oc*axis.x*axis.x+c,          oc*axis.x*axis.y-axis.z*s,   oc*axis.z*axis.x+axis.y*s,
                    oc*axis.x*axis.y+axis.z*s,   oc*axis.y*axis.y+c,          oc*axis.y*axis.z-axis.x*s,
                    oc*axis.z*axis.x-axis.y*s,   oc*axis.y*axis.z+axis.x*s,   oc*axis.z*axis.z+c
                );
            }

            void main() {
                vec3 transformed = position;
                vec3 origin = aOrigin;

                // Sliding-window wrap: reposition each blade's XZ so it
                // "sticks" to the world as the player moves, tiling
                // seamlessly once they leave the current patch bounds
                // instead of the whole patch dragging along under them.
                float halfPatch = uPatchSize * 0.5;
                origin.x = mod(origin.x - uPlayerPosition.x + halfPatch, uPatchSize) - halfPatch;
                origin.z = mod(origin.z - uPlayerPosition.z + halfPatch, uPatchSize) - halfPatch;
                vec3 worldPos = uPlayerPosition + origin;

                transformed.x = origin.x;
                transformed.z = origin.z;

                // Heightmap UV covers the whole world extent (see JS bake
                // above), not just this patch.
                vec2 hUv = vec2(
                    (worldPos.x - uWorldMin) / (uWorldMax - uWorldMin),
                    (worldPos.z - uWorldMin) / (uWorldMax - uWorldMin)
                );
                float terrainHeight = texture2D(uHeightMap, hUv).r;
                transformed.y += terrainHeight - uPlayerPosition.y;

                // Per-blade height variation from the noise texture +
                // outright randomness so the patch doesn't look uniform.
                vec3 heightNoise = texture2D(uNoiseTexture, hUv * 40.0).rgb;
                float heightModifier = uMaxBladeHeight * (0.35 + heightNoise.g * 0.5 + randSeed(hUv) * 0.25);

                // Fade blades short near the player so grass doesn't
                // constantly block the view directly in front of the
                // camera while walking through it.
                float distFromCenter = length(origin.xz) / halfPatch;
                float innerFactor = clamp(smoothstep(0.0, 0.45, distFromCenter), 0.0, 1.0);
                heightModifier *= mix(0.3, 1.0, innerFactor);

                // Edge falloff so the patch boundary itself doesn't read
                // as a hard square — blades shrink out near the edges
                // instead of popping in/out as they cross the wrap line.
                float edgeX = abs(origin.x) / halfPatch;
                float edgeZ = abs(origin.z) / halfPatch;
                float edgeFactor = 1.0 - smoothstep(0.75, 1.0, max(edgeX, edgeZ));
                heightModifier *= edgeFactor;

                // Bald patches — the article's real technique: the noise
                // texture's R channel carves random clearings out of the
                // grass (scaled up toward the patch edges) so it reads as
                // clumps of wild growth rather than a uniform tuft field.
                // Previously this R channel got folded into the general
                // height-variation formula above instead, which is why the
                // patch looked flat/uniform rather than patchy.
                float baldPatchOffset = heightNoise.r * (uBaldPatchModifier * (1.0 - edgeFactor));
                heightModifier = max(0.0, heightModifier - baldPatchOffset);

                float widthFactor = (color.r > 0.05) ? 1.0 : (color.b > 0.05) ? -1.0 : 0.0;
                float width = uBladeWidth * mix(0.6, 1.0, heightNoise.g);
                transformed += aYaw * (width * 0.5) * widthFactor;

                // Wind: scroll the same noise texture and use it to bend
                // the top vertex only (color.g == 1.0), rotating from the
                // blade's base rather than its current tip position so it
                // arcs naturally instead of sheering sideways.
                float windScale = uWindNoiseScale * 0.15;
                vec2 windUv = origin.xz * windScale;
                mat2 windRot = mat2(cos(uWindDirection), -sin(uWindDirection), sin(uWindDirection), cos(uWindDirection));
                vec2 rotatedWindUv = windRot * windUv + uTime * vec2(uWindSpeed);
                vec3 windNoise = texture2D(uNoiseTexture, rotatedWindUv).rgb;

                vec3 bendAxis = vec3(windNoise.g - 0.5, 0.0, windNoise.b - 0.5);
                float bendAngle = radians(mix(-uMaxBendAngle, uMaxBendAngle, windNoise.g)) * color.g;
                mat3 bendMatrix = rotateAxisAngle(bendAxis, bendAngle);

                vec3 basePos = vec3(transformed.x, transformed.y, transformed.z);
                vec3 tipOffset = vec3(0.0, heightModifier * color.g, 0.0);
                tipOffset = bendMatrix * tipOffset;
                transformed = basePos + tipOffset;

                vColor = texture2D(uDiffuseMap, hUv * 12.0).rgb * mix(0.55, 1.0, color.g);
                vec3 colorNoise = texture2D(uNoiseTexture, hUv * 6.0 + uTime * 0.02).rgb;
                vColor *= mix(vec3(1.0), colorNoise, 0.35);
                vShade = mix(0.35, 1.0, color.g);

                vec4 modelPosition = modelMatrix * vec4(transformed, 1.0);
                vec4 viewPosition = viewMatrix * modelPosition;
                gl_Position = projectionMatrix * viewPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uLightColor;
            uniform float uAmbient;
            varying vec3 vColor;
            varying float vShade;
            void main() {
                vec3 finalColor = vColor * vShade * uLightColor * uAmbient;
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `
    });

    state.grassMesh = new THREE.Mesh(geo, state.grassMat);
    state.grassMesh.frustumCulled = false;
    state.scene.add(state.grassMesh);
}

// Called every frame from main.js's animate() loop (alongside
// updateFireflies) so the patch actually follows the player and the wind
// keeps scrolling. Lighting uniforms (uLightColor/uAmbient) are instead
// driven from atmosphere/day-night-cycle.js, same place every other
// day/night-responsive material gets updated from.
export function updateGrass(state, ts) {
    if (!state.grassMat) return;
    state.grassMat.uniforms.uTime.value = ts;
    state.grassMat.uniforms.uPlayerPosition.value.copy(state.camera.position);
}
