// Grass v2 mid-ring (audit 5.2): "crossed-card tufts (2 quads, ~8 verts) at
// 1/10 the density but 3-4x larger, same colours, shader fades them in as
// blades fade out" to pick up where grass.js's near-ring blades shrink
// toward the edge of their own sliding-window patch (~30-45u out), instead
// of the ground just going flat-colour right where blade coverage was still
// visually reading as "there, just sparse."
//
// Deliberately a SEPARATE mesh/shader from grass.js rather than a branch
// inside it: the near blade's shader is already a carefully-tuned,
// heavily-commented pipeline (wind-bend rotation matrix, bald-patch offset,
// near-player width widening) and every one of those comments documents a
// bug that reappeared when something upstream of it moved. Adding a second,
// structurally different vertex shape (crossed quads vs. a single tapered
// triangle) as a branch inside that function risked disturbing any of that
// without adding real benefit — a second small ShaderMaterial sharing the
// same uniforms data (height bake, splat, noise) costs one more draw call,
// which is nothing next to what grass.js already issues.
//
// Shape technique: same trick as the near blade (every vertex of a tuft
// starts at the SAME world origin; the actual corner offset, wind sway and
// fades are all computed in the vertex shader from per-vertex attributes),
// just with a literal local corner offset (aCorner) instead of grass.js's
// color-channel role encoding — two crossed vertical quads don't fit the
// "3 roles via color" trick as cleanly as a single triangle does, and this
// mesh has no legacy vertex-color usage to stay compatible with.

import * as THREE from 'three';
import { makeSmoothNoiseTexture } from '../core/procedural-textures.js';
import { state, WATER_LEVEL, WORLD_SIZE } from '../core/state.js';
import { getBakeHeights, HM_RES } from '../core/heightmap.js';
import { getSplatTexture } from '../core/splat.js';
import { rngFor } from '../core/rng.js';
const rand = rngFor('grass-midring');

const PATCH_SIZE = 180;        // sliding-window patch side (90u half-extent)
const FADE_IN_START = 28;      // near-ring blades are already thin/gone by here
const FADE_IN_END = 45;        // tufts fully opaque by here
const TUFT_WIDTH = 0.5;        // ~6x grass.js's BLADE_WIDTH (0.08) — "3-4x larger" read generously, since a card this size at 1/10 the density needs to visually close the gaps between tufts
const TUFT_HEIGHT = 1.7;       // ~3x a near blade's typical effective height (~0.6u, see grass.js's uHeightNoiseAmplitude comment)
const TOP_TAPER = 0.14;        // top corners pulled inward this fraction of width — reads as a loose clump, not a rigid card
const TUFT_COUNT_FALLBACK = 9000; // matches medium tier's derived count below

const vertexShader = `
in vec3 aOrigin;
in vec2 aCorner;   // local (x: -0.5..0.5 width, y: 0..1 height) before yaw/scale
in float aQuad;    // 0 or 1 — which of the two crossed planes
in float aYawRand;
in float aSizeRand;

out vec3 vColor;

uniform float uTime;
uniform vec3 uPlayerPosition;
uniform sampler2D uHeightMap;
uniform sampler2D uNoiseTexture;
uniform sampler2D uSplat;
uniform float uWorld;
uniform vec3 uBoundingBoxMin;
uniform vec3 uBoundingBoxMax;
uniform float uWaterLevel;
uniform float uPatchSize;
uniform float uTuftWidth;
uniform float uTuftHeight;
uniform float uTopTaper;
uniform float uFadeInStart;
uniform float uFadeInEnd;
uniform float uWindDirection;
uniform float uWindSpeed;
uniform vec3 uBaseColor;
uniform vec3 uTipColor;

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}
float map(float value, float inMin, float inMax, float outMin, float outMax) {
    return mix(outMin, outMax, (value - inMin) / (inMax - inMin));
}

void main() {
    float halfPatchSize = uPatchSize * 0.5;
    vec3 origin = aOrigin;
    origin.x = mod(origin.x - uPlayerPosition.x + halfPatchSize, uPatchSize) - halfPatchSize;
    origin.z = mod(origin.z - uPlayerPosition.z + halfPatchSize, uPatchSize) - halfPatchSize;
    vec3 worldPos = uPlayerPosition + origin;

    vec2 uv = vec2(
        map(worldPos.x, uBoundingBoxMin.x, uBoundingBoxMax.x, 0.0, 1.0),
        map(worldPos.z, uBoundingBoxMin.z, uBoundingBoxMax.z, 0.0, 1.0)
    );

    // Same manual bilinear as grass.js's near blades — same bake, so tufts
    // sit on exactly the ground the blades (and the player) do.
    ivec2 texSize = textureSize(uHeightMap, 0);
    vec2 t = clamp(uv, 0.0, 1.0) * vec2(texSize - ivec2(1));
    ivec2 i0 = min(ivec2(floor(t)), texSize - ivec2(2));
    vec2 uvFrac = t - vec2(i0);
    float h00 = texelFetch(uHeightMap, i0, 0).r;
    float h10 = texelFetch(uHeightMap, i0 + ivec2(1, 0), 0).r;
    float h01 = texelFetch(uHeightMap, i0 + ivec2(0, 1), 0).r;
    float h11 = texelFetch(uHeightMap, i0 + ivec2(1, 1), 0).r;
    float groundY = mix(mix(h00, h10, uvFrac.x), mix(h01, h11, uvFrac.x), uvFrac.y);

    // Same presence gates as grass.js's near blades (shore/altitude/crater/
    // trail) so a tuft never stands where no blade ever could — a visible
    // mismatch between the two rings would read worse than either alone.
    float shoreFade = smoothstep(uWaterLevel + 0.5, uWaterLevel + 3.5, groundY);
    float highFade = 1.0 - smoothstep(24.0, 36.0, groundY);
    float craterFade = smoothstep(40.0, 62.0, length(worldPos.xz - vec2(0.0, -12.0)));
    vec2 splatUV = (worldPos.xz + 0.5 * uWorld) / uWorld;
    float pathMask = texture(uSplat, splatUV).a;
    float trailFade = 1.0 - smoothstep(0.08, 0.3, pathMask);

    // Box falloff toward the patch's own wrap edge (same technique as
    // grass.js's edgeFade/edgeFactor) so the sliding window never pops.
    float edgeDistanceX = abs(origin.x) / halfPatchSize;
    float edgeDistanceZ = abs(origin.z) / halfPatchSize;
    float patchEdgeFade = 1.0 - smoothstep(0.75, 1.0, max(edgeDistanceX, edgeDistanceZ));

    // The actual "mid ring": invisible until the near blades have mostly
    // thinned out, opaque by uFadeInEnd, then held by patchEdgeFade above
    // as the patch's own wrap boundary approaches.
    float dist = length(origin.xz);
    float ringFade = smoothstep(uFadeInStart, uFadeInEnd, dist);

    float presence = shoreFade * highFade * craterFade * trailFade * patchEdgeFade * ringFade;

    // Local corner -> world, with a slight per-tuft size variance and the
    // crossed second plane rotated 90 degrees from the first.
    float yaw = aYawRand * 6.28318 + aQuad * 1.5707963;
    float sizeVar = 0.75 + aSizeRand * 0.5;
    float topPull = mix(aCorner.x, aCorner.x * uTopTaper / 0.5, aCorner.y); // pulls top corners inward, leaves base corners alone
    vec2 local = vec2(topPull * uTuftWidth, aCorner.y * uTuftHeight) * presence * sizeVar;

    // Wind: only the top corners sway (aCorner.y==1), base stays planted —
    // same idea as grass.js's bend, simplified since a flat card doesn't
    // need the full rotate-about-base matrix a curved blade does.
    float sway = sin(uTime * uWindSpeed + worldPos.x * 0.3 + worldPos.z * 0.2) * 0.12 * aCorner.y * presence;
    float swayDir = uWindDirection;

    vec3 offset = vec3(cos(yaw) * local.x, local.y, sin(yaw) * local.x);
    offset.x += cos(swayDir) * sway;
    offset.z += sin(swayDir) * sway;

    vec3 transformed = vec3(worldPos.x + offset.x, groundY + offset.y, worldPos.z + offset.z);

    vColor = mix(uBaseColor, uTipColor, aCorner.y);
    vec3 colorNoise = texture(uNoiseTexture, uv.yx * 12.0 + uTime * 0.1).rgb;
    vColor *= mix(0.65, 1.15, colorNoise.g);

    vec4 modelPosition = modelMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * viewMatrix * modelPosition;
}
`;

const fragmentShader = `
in vec3 vColor;
uniform vec3 uAmbientColor;
uniform float uSunFactor;
out vec4 fragColor;
void main() {
    fragColor = vec4(vColor * (uAmbientColor + vec3(uSunFactor * 0.6)), 1.0);
}
`;

function tuftCountFor(bladeCount) {
    // 5.2 wants "8-15k tufts"; derive from the near ring's own tier so a
    // settings change rebuilds both rings in proportion instead of needing
    // a second hand-tuned table to keep in sync.
    return Math.round(Math.min(15000, Math.max(4000, bladeCount / 40)));
}

export function createGrassMidRing() {
    const half0 = WORLD_SIZE / 2;
    const N = HM_RES;
    // Same bake data grass.js's near ring uses — a fresh DataTexture view
    // rather than importing state.grassMat's texture object, so this module
    // doesn't need to know grass.js's creation order.
    const htex = new THREE.DataTexture(getBakeHeights(), N, N, THREE.RedFormat, THREE.FloatType);
    htex.minFilter = htex.magFilter = THREE.NearestFilter;
    htex.wrapS = htex.wrapT = THREE.ClampToEdgeWrapping;
    htex.generateMipmaps = false;
    htex.needsUpdate = true;
    const noiseTexture = makeSmoothNoiseTexture(256, 20);

    const tuftCount = (state.quality && state.quality.bladeCount)
        ? tuftCountFor(state.quality.bladeCount)
        : TUFT_COUNT_FALLBACK;

    const half = PATCH_SIZE * 0.5;
    const origins = [], corners = [], quads = [], yawRands = [], sizeRands = [];

    // Local-space unit quad: two triangles, base at y=0 (planted) to y=1 (tip).
    const QUAD = [
        [-0.5, 0], [0.5, 0], [0.5, 1],
        [-0.5, 0], [0.5, 1], [-0.5, 1],
    ];

    for (let i = 0; i < tuftCount; i++) {
        const ox = (rand() * 2 - 1) * half;
        const oz = (rand() * 2 - 1) * half;
        const yawR = rand();
        const sizeR = rand();
        for (let q = 0; q < 2; q++) {
            for (const [cx, cy] of QUAD) {
                origins.push(ox, 0, oz);
                corners.push(cx, cy);
                quads.push(q);
                yawRands.push(yawR);
                sizeRands.push(sizeR);
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('aOrigin', new THREE.BufferAttribute(new Float32Array(origins), 3));
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array(corners), 2));
    geometry.setAttribute('aQuad', new THREE.BufferAttribute(new Float32Array(quads), 1));
    geometry.setAttribute('aYawRand', new THREE.BufferAttribute(new Float32Array(yawRands), 1));
    geometry.setAttribute('aSizeRand', new THREE.BufferAttribute(new Float32Array(sizeRands), 1));

    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
        glslVersion: THREE.GLSL3, // same reason as grass.js: textureSize()/texelFetch need GLSL ES 3.00
        uniforms: {
            uTime: { value: 0 },
            uPlayerPosition: { value: new THREE.Vector3() },
            uAmbientColor: { value: new THREE.Color(0x333333) },
            uSunFactor: { value: 0 },
            uHeightMap: { value: htex },
            uNoiseTexture: { value: noiseTexture },
            uSplat: { value: getSplatTexture() },
            uWorld: { value: WORLD_SIZE },
            uBoundingBoxMin: { value: new THREE.Vector3(-half0, 0, -half0) },
            uBoundingBoxMax: { value: new THREE.Vector3(half0, 0, half0) },
            uWaterLevel: { value: WATER_LEVEL },
            uPatchSize: { value: PATCH_SIZE },
            uTuftWidth: { value: TUFT_WIDTH },
            uTuftHeight: { value: TUFT_HEIGHT },
            uTopTaper: { value: TOP_TAPER },
            uFadeInStart: { value: FADE_IN_START },
            uFadeInEnd: { value: FADE_IN_END },
            uWindDirection: { value: Math.PI * 0.25 },
            uWindSpeed: { value: 0.3 },
            uBaseColor: { value: new THREE.Color(0x16301a) },
            uTipColor: { value: new THREE.Color(0x4f7a34) },
        },
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // same reasoning as grass.js: fixed small window centred on the player, nothing useful to cull

    state.grassMidMesh = mesh;
    state.grassMidMat = material;
    state.scene.add(mesh);
}

export function updateGrassMidRing(elapsedSeconds) {
    if (!state.grassMidMat) return;
    state.grassMidMat.uniforms.uTime.value = elapsedSeconds;
    if (state.player) {
        state.grassMidMat.uniforms.uPlayerPosition.value.set(
            state.player.position.x,
            state.player.position.y,
            state.player.position.z
        );
    }
    if (state.hemiLight) {
        state.grassMidMat.uniforms.uAmbientColor.value.copy(state.hemiLight.color).multiplyScalar(state.hemiLight.intensity);
    }
    if (state.sunLight) {
        state.grassMidMat.uniforms.uSunFactor.value = state.sunLight.intensity / 1.5;
    }
}
