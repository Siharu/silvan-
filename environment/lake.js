// Water plane (fresnel + fake sun/moon glint shader + rain-ripple rings)
// and lily pads. Depends on environment/terrain.js for getElevation() and
// pushes nothing into state.colliders (the lake itself isn't collided
// with). Sun/moon glint strength and rain ripple intensity are both driven
// per-frame from atmosphere/day-night-cycle.js via state.currentRainIntensity
// — glint fades under cloud cover, ripples fade in with it.

import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from './terrain.js';

export function createLake(state) {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 48, 48);
    geo.rotateX(-Math.PI / 2);

    // Per-vertex depth, sampled once from real terrain data (not a periodic
    // function) — drives shallow/deep color grading and shoreline foam so both
    // actually follow the basin shape instead of tiling.
    const posAttr = geo.attributes.position;
    const depths = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) {
        const wx = posAttr.getX(i);
        const wz = posAttr.getZ(i);
        const depth = Math.max(0, WATER_LEVEL - getElevation(wx, wz));
        depths[i] = Math.min(depth / 20.0, 1.0);
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));

    state.waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x0d2f3d,
        roughness: 0.08,
        metalness: 0.05,
        transparent: true,
        opacity: 0.92
    });
    state.waterMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
        shader.uniforms.uMoonDir = { value: new THREE.Vector3(0, 1, 0) };
        shader.uniforms.uSunColor = { value: new THREE.Color(0xfff4d6) };
        shader.uniforms.uMoonColor = { value: new THREE.Color(0xaac4ff) };
        shader.uniforms.uSunStrength = { value: 0 };
        shader.uniforms.uMoonStrength = { value: 0 };
        shader.uniforms.uSkyColor = { value: new THREE.Color(0x8a9aa8) };
        shader.uniforms.uDeepColor = { value: new THREE.Color(0x061c26) };
        shader.uniforms.uShallowColor = { value: new THREE.Color(0x2f7a6e) };
        shader.uniforms.uRainIntensity = { value: 0 };
        state.waterMaterial.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
            #include <common>
            uniform float uTime;
            attribute float aDepth;
            varying vec3 vWorldPos;
            varying vec3 vViewDirW;
            varying vec3 vWaveNormal;
            varying float vDepth;
        `);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
            vViewDirW = cameraPosition - vWorldPos;
            vDepth = aDepth;

            // height(x,z) and its analytic slope, so the surface actually has a
            // normal that responds to the swell instead of staying flat.
            float ax = 0.05, az = 0.04, aSp = 0.6, bSp = 0.45;
            float ampA = 0.12, ampB = 0.10;
            transformed.y += sin(position.x * ax + uTime * aSp) * ampA
                            + cos(position.z * az - uTime * bSp) * ampB;
            float dHdx = ampA * ax * cos(position.x * ax + uTime * aSp);
            float dHdz = -ampB * az * sin(position.z * az - uTime * bSp);
            vWaveNormal = normalize(vec3(-dHdx, 1.0, -dHdz));
        `);

        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
            #include <common>
            uniform float uTime;
            uniform vec3 uSunDir;
            uniform vec3 uMoonDir;
            uniform vec3 uSunColor;
            uniform vec3 uMoonColor;
            uniform float uSunStrength;
            uniform float uMoonStrength;
            uniform vec3 uSkyColor;
            uniform vec3 uDeepColor;
            uniform vec3 uShallowColor;
            uniform float uRainIntensity;
            varying vec3 vWorldPos;
            varying vec3 vViewDirW;
            varying vec3 vWaveNormal;
            varying float vDepth;

            // Concentric expanding raindrop rings, tiled across world-space so
            // they read consistently across the whole lake regardless of view
            // angle. Several overlapping tile scales + a random per-cell start
            // time/existence gives an irregular scatter of drops rather than a
            // uniform grid of rings appearing in lockstep.
            float raindropRings(vec2 uv, float t) {
                float rings = 0.0;
                for (int i = 0; i < 3; i++) {
                    float scale = 6.0 + float(i) * 5.0;
                    vec2 cellUv = uv * scale;
                    vec2 cellId = floor(cellUv);
                    vec2 cellF = fract(cellUv) - 0.5;
                    float rnd = fract(sin(dot(cellId, vec2(127.1, 311.7)) + float(i) * 41.3) * 43758.5453);
                    // Only ~35% of cells ever get a drop, staggered by rnd so
                    // they don't all pulse together.
                    if (rnd > 0.35) continue;
                    float dropTime = fract(t * (0.25 + rnd * 0.15) + rnd * 7.0);
                    float dist = length(cellF);
                    float ringR = dropTime * 0.55;
                    float ring = smoothstep(ringR - 0.04, ringR, dist) - smoothstep(ringR, ringR + 0.04, dist);
                    ring *= (1.0 - dropTime); // fades out as the ring expands
                    rings += ring;
                }
                return clamp(rings, 0.0, 1.0);
            }
        `);
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            vec3 viewDirN = normalize(vViewDirW);
            vec3 waterNormal = normalize(vWaveNormal);

            // Rain ripples: perturb the normal slightly toward the ring edges
            // so they actually catch specular/fresnel light like real
            // wavefronts, not just a flat brightness overlay. Faded in with
            // rain intensity, silent/absent on a clear lake.
            float rings = raindropRings(vWorldPos.xz * 0.4, uTime) * uRainIntensity;
            vec2 ringGrad = vec2(
                raindropRings(vWorldPos.xz * 0.4 + vec2(0.08, 0.0), uTime) - rings,
                raindropRings(vWorldPos.xz * 0.4 + vec2(0.0, 0.08), uTime) - rings
            );
            waterNormal = normalize(waterNormal + vec3(ringGrad.x, 0.0, ringGrad.y) * 2.5 * uRainIntensity);

            // Depth-graded color: bright shallows near shore, dark water in the
            // basin — driven by real terrain depth, so it follows the actual shore.
            vec3 baseCol = mix(uShallowColor, uDeepColor, smoothstep(0.0, 0.35, vDepth));

            // Fresnel: near-grazing views (far shore, horizon) read as reflective sky,
            // straight-down views read as deep tinted water. This fakes a mirror
            // without an actual reflection pass.
            float fresnel = pow(1.0 - clamp(dot(waterNormal, viewDirN), 0.0, 1.0), 4.0);
            baseCol = mix(baseCol, uSkyColor, fresnel * 0.8);

            // Thin foam line right at the shore, where depth is near zero.
            float foam = 1.0 - smoothstep(0.0, 0.025, vDepth);
            baseCol = mix(baseCol, vec3(0.82, 0.9, 0.86), foam * 0.5);

            // Bright thin highlight right on the ring edge itself — this is
            // what actually reads as "raindrop hitting water" rather than
            // just a normal wobble.
            baseCol += vec3(0.55, 0.6, 0.62) * rings * 0.5;

            // Sun/moon glint: tight specular highlight along the reflected view,
            // now catching the wave's actual slope instead of a flat plane.
            vec3 reflected = reflect(-viewDirN, waterNormal);
            float sunGlint = pow(max(dot(reflected, uSunDir), 0.0), 200.0) * uSunStrength;
            float moonGlint = pow(max(dot(reflected, uMoonDir), 0.0), 240.0) * uMoonStrength;
            baseCol += uSunColor * sunGlint * 3.0;
            baseCol += uMoonColor * moonGlint * 2.0;

            vec4 diffuseColor = vec4(baseCol, opacity);
            `
        );
    };
    state.waterMesh = new THREE.Mesh(geo, state.waterMaterial);
    state.waterMesh.position.y = 1.6; // Water surface level
    state.waterMesh.receiveShadow = true;
    state.scene.add(state.waterMesh);
    
    // Add stylized Lily Pads to the lake
    const lilyCount = 350;
    // Cylinder with a slice removed to look like a pac-man lily pad
    const lilyGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.05, 14, 1, false, 0, Math.PI * 1.8);
    const lilyMat = new THREE.MeshStandardMaterial({ color: 0x3d7a31, roughness: 0.9 });
    const lilyMesh = new THREE.InstancedMesh(lilyGeo, lilyMat, lilyCount);
    lilyMesh.receiveShadow = true;
    
    const lilyDummy = new THREE.Object3D();
    let lIdx = 0;
    for(let i=0; i < lilyCount * 3 && lIdx < lilyCount; i++) {
        const r = Math.random() * 150; 
        const th = Math.random() * Math.PI * 2;
        const x = Math.cos(th)*r; const z = Math.sin(th)*r;
        const y = getElevation(x,z);
        if(y < 1.4) { // Only place in the water basin
            lilyDummy.position.set(x, 1.62, z); // Sits on water
            lilyDummy.rotation.set(0, Math.random()*Math.PI*2, 0);
            const s = 0.4 + Math.random()*0.7;
            lilyDummy.scale.set(s, 1, s);
            lilyDummy.updateMatrix();
            lilyMesh.setMatrixAt(lIdx++, lilyDummy.matrix);
        }
    }
    lilyMesh.count = lIdx;
    state.scene.add(lilyMesh);
}

