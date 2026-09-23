import * as THREE from 'three';
import { state, WATER_LEVEL } from '../core/state.js';
import { getElevation } from '../core/utils.js';

export function createRainSystem() {
    // Ported from the rain-demo reference (RainSystem.js / rain.vert.glsl /
    // rain.frag.glsl): a THREE.Points cloud with GPU point-size billboarding,
    // rather than the previous hand-rolled InstancedMesh streak-plane
    // approach with manual per-vertex camera-wrap math. The reference keeps
    // this simple by parenting its rain group directly to the player object
    // (translation-follow only, no rotation) so particles don't need to
    // track the camera themselves at all beyond an endless vertical fall.
    // Silvan has no player Object3D (state.player is plain position data,
    // state.camera is the real scene camera) — state.rainAnchor stands in
    // for that: a plain Object3D whose position is copied from the camera
    // (position only, never rotation) once per frame in updateAtmosphere(),
    // so rain always falls straight down in world space no matter which
    // way the camera is looking, exactly like the reference.
    const count = 45000;
    const radius = 90;   // horizontal spread of the cluster around the player
    const height = 80;   // vertical span the fall wraps within
    const fallSpeed = 140;

    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        positions[i * 3 + 0] = Math.cos(angle) * r;
        positions[i * 3 + 1] = Math.random() * height;
        positions[i * 3 + 2] = Math.sin(angle) * r;
        speeds[i] = 0.5 + Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const texture = new THREE.TextureLoader().load('./assets/rain-drop.png');
    texture.colorSpace = THREE.SRGBColorSpace;

    state.rainMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uTexture: { value: texture },
            uSize: { value: 5 },
            uOpacity: { value: 1 },
            uOverallSpeed: { value: fallSpeed },
            uColor: { value: new THREE.Color(0xe6f0fa) },
            uUvSquash: { value: 1 },
            uHeight: { value: height },
            uAnchorY: { value: 0 },
            uWaterLevel: { value: WATER_LEVEL },
        },
        vertexShader: `
            attribute float aSpeed;
            uniform float uTime;
            uniform float uSize;
            uniform float uOverallSpeed;
            uniform float uHeight;
            uniform float uAnchorY;
            varying float vWorldY;

            void main() {
                float wrappedY = mod(position.y - uTime * uOverallSpeed * aSpeed, uHeight);
                vec3 localPos = vec3(position.x, wrappedY - uHeight * 0.5, position.z);
                vWorldY = uAnchorY + localPos.y;

                vec4 mvPosition = modelViewMatrix * vec4(localPos, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = uSize * 38.0 / max(1.0, -mvPosition.z);
            }
        `,
        fragmentShader: `
            uniform sampler2D uTexture;
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uUvSquash;
            uniform float uWaterLevel;
            varying float vWorldY;

            void main() {
                // Cut the streak off at the water surface, with a short
                // fade just above it so it reads as "hitting" rather than
                // clipping — same rationale as the previous implementation.
                if (vWorldY < uWaterLevel) discard;
                float surfaceFade = smoothstep(uWaterLevel, uWaterLevel + 1.2, vWorldY);

                // Vertically squash the sprite UV around center to avoid a
                // long line/dot look when the camera pitches up or down.
                vec2 uv = gl_PointCoord;
                uv.x = 0.5 + (uv.x - 0.5) * uUvSquash;

                vec4 tex = texture2D(uTexture, uv);
                gl_FragColor = vec4(uColor, tex.a * uOpacity * surfaceFade);
            }
        `,
        depthWrite: false,
        transparent: true,
        blending: THREE.NormalBlending,
    });

    state.rainMesh = new THREE.Points(geo, state.rainMaterial);
    state.rainMesh.frustumCulled = false;

    state.rainAnchor = new THREE.Object3D();
    state.rainAnchor.add(state.rainMesh);
    state.scene.add(state.rainAnchor);
}

export function createRainSplashes() {
    const count = 400;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    state.rainSplashMat = new THREE.MeshBasicMaterial({
        color: 0xdcf2ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    state.rainSplashMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        state.rainSplashMat.userData.shader = shader;

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

    state.rainSplashMesh = new THREE.InstancedMesh(geo, state.rainSplashMat, count);
    state.rainSplashMesh.frustumCulled = false;
    state.rainSplashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

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
        if (getElevation(x, z) > 1.5) continue; // skip anything not actually under the lake

        dummy.position.set(x, WATER_LEVEL + 0.02, z);
        dummy.updateMatrix();
        state.rainSplashMesh.setMatrixAt(placed, dummy.matrix);
        phases[placed] = Math.random();
        speeds[placed] = 0.5 + Math.random() * 0.7;
        placed++;
    }
    state.rainSplashMesh.count = placed;
    state.rainSplashMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    state.rainSplashMesh.geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
    state.scene.add(state.rainSplashMesh);
}

