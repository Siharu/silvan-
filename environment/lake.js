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
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 56, 56);
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
        shader.uniforms.uStormIntensity = { value: 0 };
        state.waterMaterial.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
            #include <common>
            uniform float uTime;
            uniform float uStormIntensity;
            attribute float aDepth;
            varying vec3 vWorldPos;
            varying vec3 vViewDirW;
            varying vec3 vWaveNormal;
            varying float vDepth;
            varying float vChop;
        `);
        // Feed the actual wave slope into the geometry normal (not just the
        // vWaveNormal varying below, which only ever fed the custom fresnel/
        // glint math) — without this, MeshStandardMaterial's own PBR lighting
        // treats the surface as a perfectly flat plane no matter how much the
        // vertices displace, so ambient/hemisphere light (present at night
        // even with sun/moon glint near zero) never shades the swell at all.
        shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
            #include <beginnormal_vertex>
            {
                float nStormAmp = 1.0 + uStormIntensity * 2.5;
                float nStormSpeed = 1.0 + uStormIntensity * 1.6;
                float nAx = 0.05, nAz = 0.04, nASp = 0.6 * nStormSpeed, nBSp = 0.45 * nStormSpeed;
                float nAmpA = 0.12 * nStormAmp, nAmpB = 0.10 * nStormAmp;
                float nCx = 0.22, nCz = 0.19, nCSp = 1.3 * nStormSpeed;
                float nChopAmp = uStormIntensity * 0.16;
                float nChopPhase = position.x * nCx + position.z * nCz * 0.7 + uTime * nCSp;
                float nDHdx = nAmpA * nAx * cos(position.x * nAx + uTime * nASp)
                            + nChopAmp * nCx * cos(nChopPhase);
                float nDHdz = -nAmpB * nAz * sin(position.z * nAz - uTime * nBSp)
                            + nChopAmp * nCz * 0.7 * cos(nChopPhase);
                objectNormal = normalize(vec3(-nDHdx, 1.0, -nDHdz));
            }
        `);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
            vViewDirW = cameraPosition - vWorldPos;
            vDepth = aDepth;

            // height(x,z) and its analytic slope, so the surface actually has a
            // normal that responds to the swell instead of staying flat.
            // Both the long swell and the short chop layer below scale up with
            // uStormIntensity (driven from state.currentRainIntensity, the same
            // value that swells the wind audio and rain — storms and choppy
            // water are the same weather event, not independent knobs).
            float stormAmp = 1.0 + uStormIntensity * 2.5;
            float stormSpeed = 1.0 + uStormIntensity * 1.6;
            float ax = 0.05, az = 0.04, aSp = 0.6 * stormSpeed, bSp = 0.45 * stormSpeed;
            float ampA = 0.12 * stormAmp, ampB = 0.10 * stormAmp;

            // Short, chaotic chop on top of the long swell — near-invisible on
            // calm/clear water, breaks the surface up into messy wind-slop once
            // uStormIntensity climbs. This is what actually reads as "wind
            // hitting the water" rather than just a bigger version of the same
            // gentle roll.
            float cx = 0.22, cz = 0.19, cSp = 1.3 * stormSpeed;
            float chopAmp = uStormIntensity * 0.16;
            float chopPhase = position.x * cx + position.z * cz * 0.7 + uTime * cSp;
            float chop = sin(chopPhase) * chopAmp;
            vChop = abs(sin(chopPhase * 1.7 + uTime * 0.4)) * uStormIntensity;

            transformed.y += sin(position.x * ax + uTime * aSp) * ampA
                            + cos(position.z * az - uTime * bSp) * ampB
                            + chop;
            float dHdx = ampA * ax * cos(position.x * ax + uTime * aSp)
                       + chopAmp * cx * cos(chopPhase);
            float dHdz = -ampB * az * sin(position.z * az - uTime * bSp)
                       + chopAmp * cz * 0.7 * cos(chopPhase);
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
            uniform float uStormIntensity;
            varying vec3 vWorldPos;
            varying vec3 vViewDirW;
            varying vec3 vWaveNormal;
            varying float vDepth;
            varying float vChop;

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
            // Storm-stirred water reads murkier/darker than a calm lake.
            baseCol *= mix(1.0, 0.7, uStormIntensity);

            // Cheap ambient self-shading from the wave slope itself — slopes
            // facing up/toward the sky read a touch brighter, slopes tipped
            // away read a touch darker. Deliberately independent of
            // uSunStrength/uMoonStrength so the swell still has visible
            // relief on an overcast night when neither glint term
            // contributes anything, instead of the water going flat black
            // and only ever showing motion through the moon's speckled
            // specular term.
            float waveShade = 0.5 + 0.5 * waterNormal.y;
            baseCol *= mix(0.8, 1.12, waveShade);

            // Fresnel: near-grazing views (far shore, horizon) read as reflective sky,
            // straight-down views read as deep tinted water. This fakes a mirror
            // without an actual reflection pass.
            float fresnel = pow(1.0 - clamp(dot(waterNormal, viewDirN), 0.0, 1.0), 4.0);
            baseCol = mix(baseCol, uSkyColor, fresnel * 0.8);

            // Thin foam line right at the shore, where depth is near zero.
            float foam = 1.0 - smoothstep(0.0, 0.025, vDepth);
            baseCol = mix(baseCol, vec3(0.82, 0.9, 0.86), foam * 0.5);

            // Whitecaps: the short chop layer (vChop, see vertex shader) crests
            // into breaking foam once wind/storm intensity is high enough —
            // absent on calm water, scattered across the surface in a storm.
            float whitecap = smoothstep(0.45, 0.85, vChop) * uStormIntensity;
            baseCol = mix(baseCol, vec3(0.85, 0.9, 0.92), whitecap * 0.55);

            // Bright thin highlight right on the ring edge itself — this is
            // what actually reads as "raindrop hitting water" rather than
            // just a normal wobble.
            baseCol += vec3(0.55, 0.6, 0.62) * rings * 0.5;

            // Sun/moon glint: tight specular highlight along the reflected view,
            // now catching the wave's actual slope instead of a flat plane.
            // Sharpness/strength both fall off with storm intensity — a choppy,
            // wind-torn surface scatters the reflection into a duller, broader
            // sheen instead of a single tight point, and the glint is hard-
            // clamped so it can never blow out into an oversized halo under
            // bloom regardless of viewing angle.
            vec3 reflected = reflect(-viewDirN, waterNormal);
            float glintSharpness = mix(220.0, 45.0, uStormIntensity);
            float sunGlint = min(pow(max(dot(reflected, uSunDir), 0.0), glintSharpness), 1.0) * uSunStrength;
            float moonGlint = min(pow(max(dot(reflected, uMoonDir), 0.0), glintSharpness * 1.15), 1.0) * uMoonStrength;
            baseCol += uSunColor * sunGlint * mix(2.6, 1.0, uStormIntensity);
            baseCol += uMoonColor * moonGlint * mix(1.8, 0.7, uStormIntensity);

            vec4 diffuseColor = vec4(baseCol, opacity);
            `
        );
    };
    state.waterMesh = new THREE.Mesh(geo, state.waterMaterial);
    state.waterMesh.position.y = 1.6; // Water surface level
    state.waterMesh.receiveShadow = true;
    state.scene.add(state.waterMesh);
    
    // Add stylized Lily Pads to the lake
    const lilyCount = 500;
    const LILY_RADIUS = WORLD_SIZE * 0.19; // stays within the lake basin, which doesn't grow 1:1 with WORLD_SIZE
    // Cylinder with a slice removed to look like a pac-man lily pad
    const lilyGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.05, 14, 1, false, 0, Math.PI * 1.8);
    const lilyMat = new THREE.MeshStandardMaterial({ color: 0x3d7a31, roughness: 0.9 });
    const lilyMesh = new THREE.InstancedMesh(lilyGeo, lilyMat, lilyCount);
    lilyMesh.receiveShadow = true;
    
    const lilyDummy = new THREE.Object3D();
    let lIdx = 0;
    for(let i=0; i < lilyCount * 3 && lIdx < lilyCount; i++) {
        const r = Math.random() * LILY_RADIUS; 
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

