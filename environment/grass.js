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
import { makeSmoothNoiseTexture, makeGrassDiffuseTexture } from '../core/procedural-textures.js';
import { state, WATER_LEVEL, WORLD_SIZE } from '../core/state.js';
import { getBakeHeights, HM_RES } from '../core/heightmap.js';
import { getSplatTexture } from '../core/splat.js';
import { rngFor } from '../core/rng.js';
const rand = rngFor('grass');

const PATCH_SIZE = 70;  // world units per side of the sliding-window patch (~35u visible radius). Was 45 (~22.5u) — still reading as short range. Bumped bladeCount in render-quality.js's QUALITY_PRESETS alongside this; also see uFarBladeScale/uFalloffSharpness below, which matter as much as raw radius for how far grass reads as "there."
const BLADE_COUNT = 360000; // fallback if state.quality is missing — matches medium tier
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
uniform sampler2D uSplat;
uniform float uWorld;
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
uniform float uNearFullRadius;
uniform float uFarBladeScale;
uniform float uNearBladeScale;
uniform vec3 uBaseColor;
uniform vec3 uTipColor;

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

    // B-05: uHeightMap is a FLOAT texture of the terrain mesh's own vertex
    // heights (same array core/heightmap.js heightAt() reads). Nearest
    // texelFetch + manual bilinear at exact node coordinates: no 8-bit
    // quantisation, no half-texel shift, no double filtering.
    ivec2 texSize = textureSize(uHeightMap, 0);
    vec2 t = clamp(uv, 0.0, 1.0) * vec2(texSize - ivec2(1));
    ivec2 i0 = min(ivec2(floor(t)), texSize - ivec2(2));
    vec2 uvFrac = t - vec2(i0);
    float h00 = texelFetch(uHeightMap, i0, 0).r;
    float h10 = texelFetch(uHeightMap, i0 + ivec2(1, 0), 0).r;
    float h01 = texelFetch(uHeightMap, i0 + ivec2(0, 1), 0).r;
    float h11 = texelFetch(uHeightMap, i0 + ivec2(1, 1), 0).r;
    float displacement = mix(mix(h00, h10, uvFrac.x), mix(h01, h11, uvFrac.x), uvFrac.y);
    transformed.y += displacement;

    vec3 heightNoise = texture(uNoiseTexture, uv.yx * vec2(uHeightNoiseFrequency)).rgb;
    float heightModifier = ((heightNoise.r + heightNoise.g + heightNoise.b) * uMaxBladeHeight) * uHeightNoiseAmplitude;
    heightModifier += random(uv) * (uRandomHeightAmount * 0.1);

    float edgeDistanceX = abs(origin.x) / halfPatchSize;
    float edgeDistanceZ = abs(origin.z) / halfPatchSize;
    float edgeFactor = 1.0 - max(edgeDistanceX, edgeDistanceZ);
    edgeFactor = pow(max(edgeFactor, 0.0), uFalloffSharpness);

    float baldPatchOffset = heightNoise.r * (uBaldPatchModifier * (1.0 - edgeFactor));
    heightModifier = max(heightModifier - baldPatchOffset, 0.15); // never negative: blades no longer sink into the ground

    // Keep grass off the beach/underwater. displacement above is already
    // real-world elevation, so this compares directly against the actual
    // WATER_LEVEL constant rather than the heightmap's incidental per-map
    // minimum (which would drift every time the terrain shape changes,
    // e.g. The Hearth's island vs. the old lake basin).
    float shoreFade = smoothstep(uWaterLevel + 0.5, uWaterLevel + 3.5, displacement);
    float highFade = 1.0 - smoothstep(24.0, 36.0, displacement);
    float craterFade = smoothstep(40.0, 62.0, length(worldPos.xz - vec2(0.0, -12.0)));

    // Trails (audit: visible dirt path on the ground, but grass still
    // spawned right over it when walking by). core/splat.js already bakes
    // an alpha "path" channel that forest.js/rocks.js/flowers.js read via
    // CPU-side pathAt() to keep trees/rocks/flowers off the trails — grass
    // never checked it, because its blades are GPU-placed by this shader's
    // sliding-window trick with no per-blade CPU culling pass to hook into.
    // Same texture, sampled here instead: same UV mapping terrain.js uses
    // to shade the path colour, same channel. Smoothstep (not a hard cutoff)
    // because this runs per-blade every frame at sub-texel resolution, so a
    // sharp threshold would visibly crawl/shimmer as the player moves.
    vec2 splatUV = (worldPos.xz + 0.5 * uWorld) / uWorld;
    float pathMask = texture(uSplat, splatUV).a;
    float trailFade = 1.0 - smoothstep(0.08, 0.3, pathMask);

    heightModifier *= shoreFade * highFade * craterFade * trailFade;

    // NOTE: this previously called smoothstep(max, max - 2.0, x) on the
    // "far" side — edge0 > edge1, which is undefined behavior per the GLSL
    // spec (smoothstep requires edge0 < edge1) and driver-dependent: on
    // some GPUs that returns ~0 almost everywhere instead of the intended
    // near-1-except-at-the-edge ramp, multiplying straight into
    // heightModifier/presence and killing every blade on the map. Fixed by
    // keeping edges ascending and inverting the result where the fade
    // needs to run the opposite direction.
    float edgeFade =
        smoothstep(uBoundingBoxMin.x, uBoundingBoxMin.x + 2.0, worldPos.x) *
        (1.0 - smoothstep(uBoundingBoxMax.x - 2.0, uBoundingBoxMax.x, worldPos.x)) *
        smoothstep(uBoundingBoxMin.z, uBoundingBoxMin.z + 2.0, worldPos.z) *
        (1.0 - smoothstep(uBoundingBoxMax.z - 2.0, uBoundingBoxMax.z, worldPos.z));
    heightModifier *= edgeFade;

    // Distance-based shrink for performance: blades stay full size within
    // uNearFullRadius of the player, then scale down toward uFarBladeScale
    // by the patch edge. Applied to width and to the final height offset
    // below (scaledHeightModifier) — deliberately NOT to the heightModifier
    // that feeds the width smoothstep threshold just below, since shrinking
    // that value is what previously made near-threshold blades disappear
    // entirely (zero width) instead of just getting smaller.
    float distFromPlayer = length(origin.xz) / halfPatchSize;
    // Near you: blades are WIDENED (not just left at 1x) — at close range
    // each thin blade only covers a little screen space and the dark
    // ground between blades is clearly visible, which is what was reading
    // as "no grass around me." Widening near blades closes those gaps.
    // Far away, blades already visually overlap from the grazing viewing
    // angle, so shrinking them there (uFarBladeScale) saves fill-rate
    // without an visible loss of coverage.
    float sizeFactor = mix(uNearBladeScale, uFarBladeScale, smoothstep(uNearFullRadius, 1.0, distFromPlayer));

    float factor = (color.r == 0.1) ? 1.0 : (color.b == 0.1) ? -1.0 : 0.0;
    // Width now comes straight from uBladeWidth, gated by the actual
    // presence factors (shoreFade/edgeFade already computed above), not
    // reverse-engineered from heightModifier's absolute magnitude via a
    // smoothstep threshold. That threshold was tuned for one specific
    // height range and silently zeroed out blade width (making them
    // invisible) every time the height scale changed elsewhere — it's
    // what caused both the original "grass missing near player" bug and
    // this one. Presence-based gating survives future height retuning.
    float presence = shoreFade * edgeFade * highFade * craterFade * trailFade;
    float width = uBladeWidth * sizeFactor * presence;
    transformed += aYaw * (width / 2.0) * factor;
    float scaledHeightModifier = heightModifier * sizeFactor;

    vColor = mix(uBaseColor, uTipColor, color.g); // color.r/.b are corner flags (0.1): never use them as colour
    vec3 colorNoise = texture(uNoiseTexture, uv.yx * vec2(uHeightNoiseFrequency) + (uTime * 0.1)).rgb;
    vColor *= mix(0.65, 1.15, colorNoise.g); // B-04: brightness only, hue stays from diffuse

    // NOTE: previously squashed heightModifier near the player (via an
    // innerCircleFactor mix) to stop blades poking through the camera at
    // the feet. Removed: blade WIDTH is derived from heightModifier through
    // smoothstep(0.5, 1.0, heightModifier * 2.0), so even a mild reduction
    // pushed a large share of near-player blades below that threshold and
    // made them render at zero width — i.e. invisible. That's what produced
    // "grass vanishes right around me, comes back normal a bit further
    // out." If poke-through becomes a problem again, fix it on the camera
    // near-clip or with a dedicated near-player width floor, not by
    // shrinking heightModifier (which this width formula is too sensitive
    // to).

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

    vec3 basePosition = vec3(transformed.x, transformed.y - scaledHeightModifier, transformed.z);
    vec3 relativePosition = transformed - basePosition;
    relativePosition = rotationMatrix * relativePosition;
    transformed = basePosition + relativePosition;

    transformed.y += scaledHeightModifier * color.g;

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
    const half0 = WORLD_SIZE / 2;
    // B-05 rebuild: this used to be a separate 257x257 (4u-cell) resample of
    // the bake, built once in heightmap.js and never touched again — a
    // second, coarser ground truth than the chunked terrain mesh (which
    // samples the bake directly at up to 1u resolution near the player).
    // Now it's the same HM_RES bake every other consumer (heightAt(), used
    // by the player, colliders, and tree/rock/flower/POI placement) reads,
    // so grass roots, feet, and the drawn ground all agree. The vertex
    // shader's manual bilinear (textureSize() + texelFetch) already works
    // at any resolution — only this array/size changes.
    const N = HM_RES;
    const htex = new THREE.DataTexture(getBakeHeights(), N, N, THREE.RedFormat, THREE.FloatType);
    htex.minFilter = htex.magFilter = THREE.NearestFilter;
    htex.wrapS = htex.wrapT = THREE.ClampToEdgeWrapping;
    htex.generateMipmaps = false;
    htex.needsUpdate = true;
    const heightMap = { texture: htex, boundsMin: new THREE.Vector3(-half0, 0, -half0), boundsMax: new THREE.Vector3(half0, 0, half0) };
    const noiseTexture = makeSmoothNoiseTexture(256, 20);
    const diffuseTexture = makeGrassDiffuseTexture(128);
    diffuseTexture.colorSpace = THREE.SRGBColorSpace;

    const positions = [];
    const colors = [];
    const uvs = [];
    const yaws = [];
    const bladeOrigins = [];

    const half = PATCH_SIZE * 0.5;
    const bladeCount = (state.quality && state.quality.bladeCount) || BLADE_COUNT;
    for (let i = 0; i < bladeCount; i++) {
        const ox = (rand() * 2 - 1) * half;
        const oz = (rand() * 2 - 1) * half;

        const yaw = rand() * Math.PI * 2;
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
            uSplat: { value: getSplatTexture() }, // bakeSplat() runs before createGrass() in main.js, so this is already the real texture, not a placeholder
            uWorld: { value: WORLD_SIZE },
            uBoundingBoxMin: { value: heightMap.boundsMin },
            uBoundingBoxMax: { value: heightMap.boundsMax },
            uWaterLevel: { value: WATER_LEVEL },
            uPatchSize: { value: PATCH_SIZE },
            uBladeWidth: { value: BLADE_WIDTH },
            uWindDirection: { value: Math.PI * 0.25 },
            uWindSpeed: { value: 0.3 },
            uWindNoiseScale: { value: 0.9 },
            uBaldPatchModifier: { value: 2.5 },
            uFalloffSharpness: { value: 0.25 },
            uHeightNoiseFrequency: { value: 12 },
            uHeightNoiseAmplitude: { value: 1.1 }, // was 3 — combined with uMaxBladeHeight below this made blades up to ~3 world units tall (taller than the player), which the old buggy near-player suppression happened to hide right where the camera would notice; fixing that suppression exposed the true oversized base scale. Typical height now (heightNoise sum ~1.5 avg) ~1.5 * 0.35 * 1.1 ≈ 0.6 units — ankle/knee-height, not building-height.
            uMaxBendAngle: { value: 22 },
            uMaxBladeHeight: { value: 0.35 },
            uRandomHeightAmount: { value: 0.25 },
            uNearFullRadius: { value: 0.35 }, // fraction of halfPatchSize (~5.25 of 15 units) that stays at uNearBladeScale
            uFarBladeScale: { value: 0.55 },  // size at the patch edge, relative to base blade size — was 0.35, which combined with the bigger patch made distant grass shrink to near-nothing right where it needed to read as coverage
            uBaseColor: { value: new THREE.Color(0x16301a) },
            uTipColor: { value: new THREE.Color(0x4f7a34) },
            uNearBladeScale: { value: 1.0 },  // no near-player boost — once base blade scale is correctly sized (see uHeightNoiseAmplitude above), the old gap-closing rationale for boosting this doesn't apply; leaving it at 1.0 (neutral) avoids stacking another multiplier on top of an already-tuned base size. uFarBladeScale below still shrinks distant blades for performance.
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
        state.grassMat.uniforms.uSunFactor.value = state.sunLight.intensity / 1.5; // Phase 4 #27: day-night-cycle.js actually caps intensity at 1.5, not 2.0 — was topping out at uSunFactor 0.75
    }
}