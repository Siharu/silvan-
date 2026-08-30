// Rain particle streaks + ground splash decals. Intensity/visibility are
// driven per-frame from atmosphere/day-night-cycle.js via
// state.currentRainIntensity.
//
// TODO (open item): rain currently passes straight through the lake
// surface — rain-vs-water collision fix belongs here.

import * as THREE from 'three';
import { WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from '../environment/terrain.js';

export function createRainSystem(state) {
    const count = state.quality.rainCount;

    // Points-based rain, ported from "Cheap, Beautiful Rain in Three.js"
    // (Peter Adams, Antaeus AR) — replaces the old InstancedMesh of
    // per-streak plane geometry (2 triangles + a full billboard-orientation
    // matrix multiply per instance, per vertex, per frame) with a single
    // THREE.Points draw call. Each drop is one GPU point sprite; the
    // streak shape/motion-blur look comes entirely from the rainDrop
    // texture's alpha (fx/textures.js) sampled in the fragment shader,
    // not from actual elongated geometry. Falling is done by wrapping
    // gl_Position-space... actually here it's done the article's way: each
    // point's world Y wraps every frame in the vertex shader based on
    // uTime, so drops "fall forever" with zero CPU-side position writes —
    // the only per-frame JS cost is updating uTime/uCameraPos uniforms.
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count); // per-drop fall-speed/x-offset variation
    const spread = 90.0;
    const dropHeight = 80.0;
    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * spread;
        positions[i * 3 + 1] = (Math.random() - 0.5) * dropHeight;
        positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
        seeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    state.rainMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uCameraPos: { value: new THREE.Vector3() },
            uColor: { value: new THREE.Color(0xe6f0fa) },
            uOpacity: { value: 0.15 },
            uSpread: { value: spread },
            uDropHeight: { value: dropHeight },
            uTex: { value: null }, // set below once state.globalTextures exists
            // How compressed the streak's UVs get at the extreme — 1.0 is
            // no squash, lower values flatten it toward a round dot. Tuned
            // so straight-up/down looks like fast droplets, not smeared
            // lines, matching the article's minAngleUvSquash/sizeScale.
            uUvSquash: { value: 1.0 },
            uSizeScale: { value: 1.0 }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            uniform float uTime;
            uniform vec3 uCameraPos;
            uniform float uSpread;
            uniform float uDropHeight;
            uniform float uSizeScale;
            attribute float aSeed;
            varying float vY;
            void main() {
                // Wrap XZ around the camera so the rain volume always
                // surrounds the player without ever needing to reposition
                // 45,000 individual drops from JS.
                float hS = uSpread * 0.5;
                float x = uCameraPos.x + mod(position.x - uCameraPos.x + hS, uSpread) - hS;
                float z = uCameraPos.z + mod(position.z - uCameraPos.z + hS, uSpread) - hS;

                // Fall speed varies per-drop via aSeed so the rain doesn't
                // read as a uniform sheet. Wraps vertically the same way,
                // centered on the camera, so drops "fall forever" — no
                // respawn logic needed on the CPU side.
                float speed = 55.0 + aSeed * 35.0;
                float hD = uDropHeight * 0.5;
                float y = uCameraPos.y + mod(position.y - uTime * speed - uCameraPos.y + hD, uDropHeight) - hD;
                vY = y;

                vec4 mvPosition = modelViewMatrix * vec4(x, y, z, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = (400.0 * uSizeScale) / -mvPosition.z;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform sampler2D uTex;
            uniform float uUvSquash;
            varying float vY;
            void main() {
                vec2 uv = gl_PointCoord;
                // Vertically squash UVs around center to avoid the long
                // line look when looking straight up/down — points have
                // no real geometry to foreshorten against the camera the
                // way actual billboarded quads would.
                uv.x = 0.5 + (uv.x - 0.5) * uUvSquash;
                float mask = texture2D(uTex, uv).r;

                // Cut the streak off at the water surface instead of
                // letting it pass through (same behavior as the old
                // geometry-based rain).
                if (vY < ${WATER_LEVEL.toFixed(2)}) discard;
                float surfaceFade = smoothstep(${WATER_LEVEL.toFixed(2)}, ${(WATER_LEVEL + 1.2).toFixed(2)}, vY);

                gl_FragColor = vec4(uColor, mask * uOpacity * surfaceFade);
            }
        `
    });

    state.rainMesh = new THREE.Points(geo, state.rainMaterial);
    state.rainMesh.frustumCulled = false;
    state.rainMaterial.uniforms.uTex.value = state.globalTextures.rainDrop;
    state.scene.add(state.rainMesh);
}


export function createRainSplashes(state) {
    const count = state.quality.rainSplashCount;
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

