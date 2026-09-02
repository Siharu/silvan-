// Rain — streak rendering ported from Peter Adams' rain-demo
// (rain-demo.vercel.app / github rain-demo-main), per the reference the
// user linked. This replaces only createRainSystem()/the streak visuals;
// createRainSplashes() (lake-surface rings) and the WATER_LEVEL cutoff
// are kept from the previous implementation — the reference has no water
// to hit, so there was nothing to port for that part.
//
// Technique, ported directly from RainSystem.js/rain.vert.glsl: GPU point
// sprites (gl.POINTS, not quads/instancing) whose Y wraps in the vertex
// shader via mod(), so a small fixed pool of drops loops endlessly
// through a vertical band instead of needing respawn logic. Point size
// attenuates with distance (gl_PointSize / -mvPosition.z) and the drop
// texture's UV squashes horizontally as the camera tilts up/down, so
// looking straight down doesn't turn every drop into a long streak.
//
// Adaptation: the reference parents rain.group to a player rig Object3D
// so the whole cluster rides along for free. This project has no such
// rig, so updateRain() copies state.camera.position onto the rain mesh
// itself each frame instead — same effect, no parent needed. The water
// cutoff reads modelMatrix[3].y (the mesh's own world Y, cheap — no
// extra uniform) plus the wrapped local Y to get each drop's true world
// height for the discard/fade test.

import * as THREE from 'three';
import { getElevation } from './terrain.js';

const WATER_LEVEL = -2; // matches core/world-state.js terrainParams.waterLevel

const RAIN_COUNT = 45000;
const RAIN_RADIUS = 45;
const RAIN_HEIGHT = 60;
const RAIN_OVERALL_SPEED = 40;
const BASE_SIZE = 6;

const rainVertexShader = `
attribute float aSpeed;

uniform float uTime;
uniform float uSize;
uniform float uOverallSpeed;
uniform float uHeight;
uniform float uWaterLevel;

varying float vWorldY;

void main() {
    vec3 local = position;
    float wrappedY = mod(local.y - uTime * uOverallSpeed * aSpeed, uHeight);
    vec3 offsetPos = vec3(local.x, wrappedY - uHeight * 0.5, local.z);

    // Cheap true-world-Y read: for a mesh with no rotation/scale,
    // modelMatrix's translation column IS its world position, so this
    // avoids needing a separate uCameraPos/uOriginY uniform kept in sync
    // from JS every frame.
    vWorldY = modelMatrix[3].y + offsetPos.y;

    vec4 mvPosition = modelViewMatrix * vec4(offsetPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * 38.0 / max(1.0, -mvPosition.z);
}
`;

const rainFragmentShader = `
uniform sampler2D uTexture;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uUvSquash;
uniform float uWaterLevel;

varying float vWorldY;

void main() {
    if (vWorldY < uWaterLevel) discard;
    float surfaceFade = smoothstep(uWaterLevel, uWaterLevel + 1.2, vWorldY);

    vec2 uv = gl_PointCoord;
    uv.x = 0.5 + (uv.x - 0.5) * uUvSquash;
    vec4 tex = texture2D(uTexture, uv);

    gl_FragColor = vec4(uColor, tex.a * uOpacity * surfaceFade);
}
`;

export function createRainSystem(state) {
    const positions = new Float32Array(RAIN_COUNT * 3);
    const speeds = new Float32Array(RAIN_COUNT);

    for (let i = 0; i < RAIN_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * RAIN_RADIUS;
        positions[i * 3 + 0] = Math.cos(angle) * r;
        positions[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
        positions[i * 3 + 2] = Math.sin(angle) * r;
        speeds[i] = 0.5 + Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const texture = new THREE.TextureLoader().load('environment/textures/rainDrop.png');
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.ShaderMaterial({
        vertexShader: rainVertexShader,
        fragmentShader: rainFragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uTexture: { value: texture },
            uSize: { value: BASE_SIZE },
            uOpacity: { value: 0 }, // driven by state.currentRainIntensity in updateRain
            uOverallSpeed: { value: RAIN_OVERALL_SPEED },
            uColor: { value: new THREE.Color(0xe6f0fa) },
            uUvSquash: { value: 1 },
            uHeight: { value: RAIN_HEIGHT },
            uWaterLevel: { value: WATER_LEVEL },
        },
        depthWrite: false,
        transparent: true,
        blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false; // cluster always rides with the camera — see module header

    state.rainMesh = points;
    state.rainMaterial = material;
    // Kept for anything that expects state.rainSystem.count etc. from the
    // old whole-object shape — not used internally here.
    state.rainSystem = { count: RAIN_COUNT, baseSize: BASE_SIZE, minAngleSizeScale: 0.7, minAngleUvSquash: 0.05 };
    state.scene.add(points);
}

export function createRainSplashes(state) {
    const count = 400;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const rainSplashMat = new THREE.MeshBasicMaterial({
        color: 0xdcf2ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    rainSplashMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        rainSplashMat.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            attribute float aPhase;
            attribute float aSpeed;
            varying vec2 vSplashUv;
            varying float vProgress;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vSplashUv = uv;
            // Each instance loops through its own 0..1 splash cycle
            float cycle = fract(uTime * aSpeed + aPhase);
            vProgress = cycle;
            float ringScale = mix(0.15, 1.6, cycle);
            transformed.x *= ringScale;
            transformed.z *= ringScale;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec2 vSplashUv;
            varying float vProgress;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            // Thin expanding ring, fading out as it grows
            float distFromCenter = length(vSplashUv - 0.5) * 2.0;
            float ringWidth = 0.10;
            float ring = 1.0 - smoothstep(0.0, ringWidth, abs(distFromCenter - 1.0));
            float fade = 1.0 - smoothstep(0.0, 1.0, vProgress);
            vec4 diffuseColor = vec4(diffuse, opacity * ring * fade);
            `
        );
    };

    const rainSplashMesh = new THREE.InstancedMesh(geo, rainSplashMat, count);
    rainSplashMesh.frustumCulled = false;
    rainSplashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const dummy = new THREE.Object3D();
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    let placed = 0;
    for (let i = 0; i < count * 3 && placed < count; i++) {
        // Scatter within the lake basin only (matches getElevation's lake carve radius)
        const r = Math.sqrt(Math.random()) * 150;
        const th = Math.random() * Math.PI * 2;
        const x = Math.cos(th) * r;
        const z = Math.sin(th) * r;
        if (getElevation(x, z, state) > 1.5) continue; // skip anything not actually under the lake

        dummy.position.set(x, WATER_LEVEL + 0.02, z);
        dummy.updateMatrix();
        rainSplashMesh.setMatrixAt(placed, dummy.matrix);
        phases[placed] = Math.random();
        speeds[placed] = 0.5 + Math.random() * 0.7;
        placed++;
    }
    rainSplashMesh.count = placed;
    rainSplashMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    rainSplashMesh.geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
    state.rainSplashMesh = rainSplashMesh;
    state.rainSplashMat = rainSplashMat;
    state.scene.add(rainSplashMesh);
}

// Called every frame from main.js's animate() loop.
export function updateRain(state, ts) {
    const intensity = state.currentRainIntensity || 0;

    if (state.rainMaterial && state.rainMesh) {
        state.rainMaterial.uniforms.uTime.value = ts;

        // Ride along with the camera instead of the reference's
        // parent-rig approach — see module header.
        state.rainMesh.position.copy(state.camera.position);

        // View-angle squash: looking straight down/up shouldn't show long
        // streaks, so flatten the sprite's UV and shrink it toward the
        // reference's minAngleSizeScale/minAngleUvSquash as verticality
        // increases.
        const camDir = state._rainCamDir || (state._rainCamDir = new THREE.Vector3());
        state.camera.getWorldDirection(camDir);
        const verticalFacing = Math.abs(camDir.y);
        const sizeScale = THREE.MathUtils.lerp(1, state.rainSystem.minAngleSizeScale, verticalFacing);
        const uvSquash = THREE.MathUtils.lerp(1, state.rainSystem.minAngleUvSquash, verticalFacing);
        state.rainMaterial.uniforms.uUvSquash.value = uvSquash;
        state.rainMaterial.uniforms.uSize.value = state.rainSystem.baseSize * sizeScale * (0.5 + 0.5 * uvSquash);

        state.rainMaterial.uniforms.uOpacity.value = Math.min(1.0, intensity * 2.0);
        state.rainMesh.visible = intensity > 0.01;
    }

    if (state.rainSplashMat && state.rainSplashMat.userData.shader) {
        state.rainSplashMat.userData.shader.uniforms.uTime.value = ts;
        state.rainSplashMat.opacity = 0.5 * Math.min(1.0, intensity * 1.8);
        state.rainSplashMesh.visible = intensity > 0.15; // match the CLEAR/LIGHT RAIN threshold
    }
}
