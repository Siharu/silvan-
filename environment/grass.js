// Grass — ported from silvan-main's environment/grass.js, which itself
// ported Peter Adams' "GhibliGrass" technique
// (https://github.com/fromtheghost/ghibli-grass /
// medium.com/antaeus-ar/making-grass-with-triangles-in-glsl-using-three-js).
// Replaces this project's earlier scattered-InstancedMesh billboard grass
// entirely.
//
// Core idea, ported faithfully from the reference vertex shader: every
// blade's world XZ is computed as `mod(origin - playerPos, patchSize)`,
// i.e. a fixed pool of blade "slots" that wrap/tile around wherever the
// player currently is — a sliding window, not a patch that moves with
// the player. That's what gives infinite coverage from a small, constant
// blade count (no scatter radius, no pop-in, no per-frame regeneration).
//
// One real adaptation from the reference: GhibliGrass parents the grass
// mesh to a player rig Object3D and lets modelMatrix add the player's
// world position automatically. This project has no such rig (main.js
// moves state.camera/state.player directly), so the mesh is added to the
// scene at identity and the shader adds uPlayerPosition into the
// transformed position itself (see "world-space adaptation" comments
// below) instead of relying on a parent transform.
//
// Height sampling: the reference renders a heightmap from Blender.
// core/procedural-textures.js bakes one directly from utils.js's
// getElevation() instead — guaranteed pixel-exact against the real
// terrain, no separate asset/export step to keep in sync. Since this
// project's terrain is now The Hearth's island+volcano shape, the baked
// heightmap and its bounds automatically follow that shape too — nothing
// in this file assumes a particular terrain profile.

import * as THREE from 'three';
import { bakeHeightMapTexture, makeSmoothNoiseTexture, makeGrassDiffuseTexture } from '../core/procedural-textures.js';
import { state, WATER_LEVEL } from '../core/state.js';

const PATCH_SIZE = 30;  // world units per side of the sliding-window patch. The reference GhibliGrass project runs patchSize:20 with count:200000 (~500 blades/sq-unit); 30 keeps a visible-coverage radius (~15 units) while landing close to reference density at the bladeCount below.
const BLADE_COUNT = 130000; // fallback if state.quality is missing — matches medium tier
const BLADE_WIDTH = 0.08;

const vertexShader = `
in vec3 aYaw;
in vec3 aBladeOrigin;

out vec3 vColor;

uniform float uTime;
uniform vec3 uPlayerPosition;
uniform sampler2D uHeightMap;
uniform sampler2D uDiffuseMap;
uniform sampler2D uNoiseTexture;
uniform vec3 uBoundingBoxMin;
uniform vec3 uBoundingBoxMax;
uniform float uWaterLevel;
uniform float uPatchSize;
uniform float uBladeWidth;
uniform float uWindDirection;
uniform float uWindSpeed;
uniform float uWindNoiseScale;
uniform float uBaldPatchModifier;
uniform float uFalloffSharpness;
uniform float uHeightNoiseFrequency;
uniform float uHeightNoiseAmplitude;
uniform float uMaxBendAngle;
uniform float uMaxBladeHeight;
uniform float uRandomHeightAmount;

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

mat3 rotate3d(in vec3 axis, const in float angle) {
    axis = normalize(axis);
    float s = sin(angle);
    float c = cos(angle);
    float oc = 1.0 - c;
    return mat3(
        oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s,
        oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s,
        oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c
    );
}

float map(float value, float inMin, float inMax, float outMin, float outMax) {
    return mix(outMin, outMax, (value - inMin) / (inMax - inMin));
}

void main() {
    vec3 transformed = position;
    vec3 origin = aBladeOrigin;

    float halfPatchSize = uPatchSize * 0.5;
    origin.x = mod(origin.x - uPlayerPosition.x + halfPatchSize, uPatchSize) - halfPatchSize;
    origin.z = mod(origin.z - uPlayerPosition.z + halfPatchSize, uPatchSize) - halfPatchSize;

    vec3 worldPos = uPlayerPosition + origin;

    transformed.x = worldPos.x;
    transformed.z = worldPos.z;

    vec2 uv = vec2(
        map(worldPos.x, uBoundingBoxMin.x, uBoundingBoxMax.x, 0.0, 1.0),
        map(worldPos.z, uBoundingBoxMin.z, uBoundingBoxMax.z, 0.0, 1.0)
    );

    vec2 texSize = vec2(textureSize(uHeightMap, 0));
    vec2 uvTexel = uv * texSize - 0.5;
    vec2 uvFloor = floor(uvTexel) / texSize;
    vec2 uvCeil = ceil(uvTexel) / texSize;
    vec2 uvFrac = fract(uvTexel);

    float h00 = texture(uHeightMap, uvFloor).r;
    float h10 = texture(uHeightMap, vec2(uvCeil.x, uvFloor.y)).r;
    float h01 = texture(uHeightMap, vec2(uvFloor.x, uvCeil.y)).r;
    float h11 = texture(uHeightMap, uvCeil).r;

    float terrainHeight = mix(mix(h00, h10, uvFrac.x), mix(h01, h11, uvFrac.x), uvFrac.y);
    float displacement = map(terrainHeight, 0.0, 1.0, uBoundingBoxMin.y, uBoundingBoxMax.y);
    transformed.y += displacement;

    vec3 heightNoise = texture(uNoiseTexture, uv.yx * vec2(uHeightNoiseFrequency)).rgb;
    float heightModifier = ((heightNoise.r + heightNoise.g + heightNoise.b) * uMaxBladeHeight) * uHeightNoiseAmplitude;
    heightModifier += random(uv) * (uRandomHeightAmount * 0.1);

    float edgeDistanceX = abs(origin.x) / halfPatchSize;
    float edgeDistanceZ = abs(origin.z) / halfPatchSize;
    float edgeFactor = 1.0 - max(edgeDistanceX, edgeDistanceZ);
    edgeFactor = pow(max(edgeFactor, 0.0), uFalloffSharpness);

    float baldPatchOffset = heightNoise.r * (uBaldPatchModifier * (1.0 - edgeFactor));
    heightModifier -= baldPatchOffset;

    // Keep grass off the beach/underwater. displacement above is already
    // real-world elevation, so this compares directly against the actual
    // WATER_LEVEL constant rather than the heightmap's incidental per-map
    // minimum (which would drift every time the terrain shape changes,
    // e.g. The Hearth's island vs. the old lake basin).
    float shoreFade = smoothstep(uWaterLevel + 0.5, uWaterLevel + 3.5, displacement);
    heightModifier *= shoreFade;

    float edgeFade =
        smoothstep(uBoundingBoxMin.x, uBoundingBoxMin.x + 2.0, worldPos.x) *
        smoothstep(uBoundingBoxMax.x, uBoundingBoxMax.x - 2.0, worldPos.x) *
        smoothstep(uBoundingBoxMin.z, uBoundingBoxMin.z + 2.0, worldPos.z) *
        smoothstep(uBoundingBoxMax.z, uBoundingBoxMax.z - 2.0, worldPos.z);
    heightModifier *= edgeFade;

    float factor = (color.r == 0.1) ? 1.0 : (color.b == 0.1) ? -1.0 : 0.0;
    float width = smoothstep(0.5, 1.0, heightModifier * 2.0) * uBladeWidth;
    transformed += aYaw * (width / 2.0) * factor;

    vColor = texture(uDiffuseMap, uv * 10.0).rgb * color;
    vec3 colorNoise = texture(uNoiseTexture, uv.yx * vec2(uHeightNoiseFrequency) + (uTime * 0.1)).rgb;
    vColor *= (colorNoise.r + colorNoise.g + colorNoise.b) / 3.0;

    float distanceFromCenter = length(origin.xz) / halfPatchSize;
    float innerCircleFactor = clamp(smoothstep(0.0, 0.5, distanceFromCenter), 0.0, 1.0);
    heightModifier *= mix(0.25, 1.0, innerCircleFactor);

    float noiseScale = uWindNoiseScale * 0.1;
    vec2 noiseUV = vec2(origin.x * noiseScale, origin.z * noiseScale);
    mat2 rotation = mat2(
        cos(uWindDirection), -sin(uWindDirection),
        sin(uWindDirection), cos(uWindDirection)
    );
    vec2 rotatedNoiseUV = rotation * noiseUV + uTime * vec2(uWindSpeed);
    vec3 windNoise = texture(uNoiseTexture, rotatedNoiseUV).rgb;

    vec3 axis = vec3(windNoise.g, 0.0, windNoise.b);
    float angle = radians(map(windNoise.g + windNoise.b, 0.0, 2.0, -uMaxBendAngle, uMaxBendAngle)) * color.g;
    mat3 rotationMatrix = rotate3d(axis, angle);

    vec3 basePosition = vec3(transformed.x, transformed.y - heightModifier, transformed.z);
    vec3 relativePosition = transformed - basePosition;
    relativePosition = rotationMatrix * relativePosition;
    transformed = basePosition + relativePosition;

    transformed.y += heightModifier * color.g;

    vec4 modelPosition = modelMatrix * vec4(transformed, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * viewPosition;
}
`;

const fragmentShader = `
in vec3 vColor;
uniform vec3 uAmbientColor;
uniform float uSunFactor;
out vec4 fragColor;
void main() {
    vec3 lit = vColor * (uAmbientColor + vec3(uSunFactor * 0.6));
    fragColor = vec4(lit, 1.0);
}
`;

export function createGrass() {
    const heightMap = bakeHeightMapTexture(256);
    const noiseTexture = makeSmoothNoiseTexture(256, 20);
    const diffuseTexture = makeGrassDiffuseTexture(128);

    const positions = [];
    const colors = [];
    const uvs = [];
    const yaws = [];
    const bladeOrigins = [];

    const half = PATCH_SIZE * 0.5;
    const bladeCount = (state.quality && state.quality.bladeCount) || BLADE_COUNT;
    for (let i = 0; i < bladeCount; i++) {
        const ox = THREE.MathUtils.randFloat(-half, half);
        const oz = THREE.MathUtils.randFloat(-half, half);

        const yaw = Math.random() * Math.PI * 2;
        const yawX = Math.sin(yaw);
        const yawZ = -Math.cos(yaw);

        const verts = [
            { pos: [ox, 0, oz], color: [0.1, 0, 0] },
            { pos: [ox, 0, oz], color: [0, 0, 0.1] },
            { pos: [ox, 0, oz], color: [1, 1, 1] },
        ];
        for (const v of verts) {
            positions.push(...v.pos);
            colors.push(...v.color);
            uvs.push(0, 0); // unused by this shader — kept only so vertexColors/geometry stay a valid BufferGeometry
            yaws.push(yawX, 0, yawZ);
            bladeOrigins.push(ox, 0, oz);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setAttribute('aYaw', new THREE.BufferAttribute(new Float32Array(yaws), 3));
    geometry.setAttribute('aBladeOrigin', new THREE.BufferAttribute(new Float32Array(bladeOrigins), 3));

    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        vertexColors: true,
        side: THREE.DoubleSide,
        // Required for the vertex shader's textureSize() call below — that's
        // a GLSL ES 3.00 built-in, but THREE.ShaderMaterial compiles as
        // GLSL ES 1.00 by default. Without this, the shader fails to
        // *compile* (a console warning, not a thrown JS error) and the mesh
        // just never draws — which is exactly why everything else in the
        // scene renders fine and only grass is missing.
        glslVersion: THREE.GLSL3,
        uniforms: {
            uTime: { value: 0 },
            uPlayerPosition: { value: new THREE.Vector3() },
            uAmbientColor: { value: new THREE.Color(0x333333) },
            uSunFactor: { value: 0 },
            uHeightMap: { value: heightMap.texture },
            uDiffuseMap: { value: diffuseTexture },
            uNoiseTexture: { value: noiseTexture },
            uBoundingBoxMin: { value: heightMap.boundsMin },
            uBoundingBoxMax: { value: heightMap.boundsMax },
            uWaterLevel: { value: WATER_LEVEL },
            uPatchSize: { value: PATCH_SIZE },
            uBladeWidth: { value: BLADE_WIDTH },
            uWindDirection: { value: Math.PI * 0.25 },
            uWindSpeed: { value: 0.3 },
            uWindNoiseScale: { value: 0.9 },
            uBaldPatchModifier: { value: 2.5 },
            uFalloffSharpness: { value: 0.35 },
            uHeightNoiseFrequency: { value: 12 },
            uHeightNoiseAmplitude: { value: 3 },
            uMaxBendAngle: { value: 22 },
            uMaxBladeHeight: { value: 0.35 },
            uRandomHeightAmount: { value: 0.25 },
        },
    });

    const mesh = new THREE.Mesh(geometry, material);
    // Always visible by construction — the patch is a small, fixed-size
    // window centered on the player, not a whole-map mesh, so there's
    // nothing for the frustum test to usefully cull.
    mesh.frustumCulled = false;

    state.grassMesh = mesh;
    state.grassMat = material;
    state.scene.add(mesh);
}

export function updateGrass(elapsedSeconds) {
    if (!state.grassMat) return;
    state.grassMat.uniforms.uTime.value = elapsedSeconds;
    if (state.player) {
        state.grassMat.uniforms.uPlayerPosition.value.set(
            state.player.position.x,
            state.player.position.y,
            state.player.position.z
        );
    }
    // Feeds the same lighting values everything else in the scene already
    // responds to (main.js's hemiLight/sunLight) so grass tracks day/night
    // without duplicating that math here.
    if (state.hemiLight) {
        state.grassMat.uniforms.uAmbientColor.value.copy(state.hemiLight.color).multiplyScalar(state.hemiLight.intensity);
    }
    if (state.sunLight) {
        state.grassMat.uniforms.uSunFactor.value = state.sunLight.intensity / 2.0; // sunLight.intensity maxes at ~2.0 at midday, see day-night-cycle.js
    }
}
