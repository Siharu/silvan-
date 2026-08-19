// Water plane: a genuine THREE.ShaderMaterial (not MeshStandardMaterial +
// onBeforeCompile) so it fully controls its own lighting output the same
// way ocean-water.html's demo does, instead of running through three's PBR
// pipeline and getting muted by scene ambient/tone-mapping on top of it.
// Ported from that demo almost verbatim: real Gerstner-wave displacement
// with analytic tangent/binormal normals, Blinn-Phong specular, and a
// fresnel-to-sky mix — plus everything the demo didn't have: real terrain-
// sampled shoreline depth/foam, day/night sun+moon feed, storm-driven chop/
// whitecaps, rain ripple rings, and scene fog.
//
// Depends on environment/terrain.js for getElevation() and pushes nothing
// into state.colliders (the lake itself isn't collided with). Sun/moon/
// storm/rain uniforms are all fed per-frame from atmosphere/day-night-
// cycle.js via state.waterMaterial.userData.shader.uniforms (kept as a
// self-reference below so that existing feed code didn't need to change).

import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from './terrain.js';

const gerstnerWaveGLSL = `
    // Displaces a vertex along an elliptical path (not just up/down like a
    // sine wave) and accumulates its analytic slope into the running
    // tangent/binormal, so the final surface normal — built from
    // cross(binormal, tangent) once all waves are summed — is exact rather
    // than a finite-difference guess. Ported directly from ocean-water.html.
    vec3 gerstnerWave(vec4 wave, vec3 p, float time, inout vec3 tangent, inout vec3 binormal) {
        float steepness = wave.z;
        float wavelength = wave.w;
        float k = 2.0 * 3.14159265 / wavelength;
        float c = sqrt(9.8 / k);
        vec2 d = normalize(wave.xy);
        float f = k * (dot(d, p.xz) - c * time);
        float a = steepness / k;
        float sinf = sin(f);
        float cosf = cos(f);
        float wa = k * a;
        tangent.x -= d.x * d.x * wa * sinf;
        tangent.y += d.x * wa * cosf;
        tangent.z -= d.x * d.y * wa * sinf;
        binormal.x -= d.x * d.y * wa * sinf;
        binormal.y += d.y * wa * cosf;
        binormal.z -= d.y * d.y * wa * sinf;
        return vec3(d.x * a * cosf, a * sinf, d.y * a * cosf);
    }
`;

const waterVertexShader = `
    uniform float uTime;
    uniform float uStormIntensity;
    uniform vec4 uWaves[3];
    attribute float aDepth;

    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying float vDepth;
    varying float vChop;
    varying float vElevation;

    ${gerstnerWaveGLSL}

    #include <fog_pars_vertex>

    void main() {
        vec3 p = position;

        // Steepness (and therefore amplitude, since a = steepness/k) scales
        // up with uStormIntensity — driven from state.currentRainIntensity,
        // the same value that swells the wind audio and rain, so storms and
        // rough water are the same weather event, not independent knobs.
        // Wave speed (c, from real gravity-wave dispersion in gerstnerWave)
        // also picks up under storm so the swell gets faster, not just taller.
        float stormSteep = 1.0 + uStormIntensity * 1.8;
        float stormSpeed = 1.0 + uStormIntensity * 1.6;

        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 0.0, 1.0);
        vec3 displacement = vec3(0.0);
        for (int i = 0; i < 3; i++) {
            vec4 w = uWaves[i];
            w.z *= stormSteep;
            displacement += gerstnerWave(w, position, uTime * stormSpeed, tangent, binormal);
        }
        p += displacement;

        // Short, chaotic chop on top of the long swell — near-invisible on
        // calm/clear water, breaks the surface up into messy wind-slop once
        // uStormIntensity climbs. Folded into the same tangent/binormal as
        // the Gerstner waves so it contributes to one coherent final normal,
        // rather than being mixed in separately after the fact.
        float cx = 0.22, cz = 0.19, cSp = 1.3 * stormSpeed;
        float chopAmp = uStormIntensity * 0.16;
        float chopPhase = position.x * cx + position.z * cz * 0.7 + uTime * cSp;
        float chop = sin(chopPhase) * chopAmp;
        p.y += chop;
        tangent.y += chopAmp * cx * cos(chopPhase);
        binormal.y += chopAmp * cz * 0.7 * cos(chopPhase);

        vec3 normal = normalize(cross(binormal, tangent));

        vec4 worldPosition = modelMatrix * vec4(p, 1.0);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);

        vWorldPos = worldPosition.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vDepth = aDepth;
        vChop = abs(sin(chopPhase * 1.7 + uTime * 0.4)) * uStormIntensity;
        // Peak height above rest, used for crest foam in the fragment shader —
        // same role as the demo's vElevation, just fed by real Gerstner+chop
        // displacement instead of a single sine.
        vElevation = displacement.y + chop;

        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;

const waterFragmentShader = `
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
    uniform float uOpacity;

    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying float vDepth;
    varying float vChop;
    varying float vElevation;

    #include <fog_pars_fragment>

    // Concentric expanding raindrop rings, tiled across world-space so they
    // read consistently across the whole lake regardless of view angle.
    // Several overlapping tile scales + a random per-cell start time/
    // existence gives an irregular scatter of drops rather than a uniform
    // grid of rings appearing in lockstep.
    float raindropRings(vec2 uv, float t) {
        float rings = 0.0;
        for (int i = 0; i < 3; i++) {
            float scale = 6.0 + float(i) * 5.0;
            vec2 cellUv = uv * scale;
            vec2 cellId = floor(cellUv);
            vec2 cellF = fract(cellUv) - 0.5;
            float rnd = fract(sin(dot(cellId, vec2(127.1, 311.7)) + float(i) * 41.3) * 43758.5453);
            if (rnd > 0.35) continue;
            float dropTime = fract(t * (0.25 + rnd * 0.15) + rnd * 7.0);
            float dist = length(cellF);
            float ringR = dropTime * 0.55;
            float ring = smoothstep(ringR - 0.04, ringR, dist) - smoothstep(ringR, ringR + 0.04, dist);
            ring *= (1.0 - dropTime);
            rings += ring;
        }
        return clamp(rings, 0.0, 1.0);
    }

    void main() {
        vec3 normal = normalize(vNormalW);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);

        // Rain ripples: perturb the normal toward ring edges so they catch
        // specular/fresnel light like real wavefronts. Faded in with rain
        // intensity, silent/absent on a clear lake.
        float rings = raindropRings(vWorldPos.xz * 0.4, uTime) * uRainIntensity;
        vec2 ringGrad = vec2(
            raindropRings(vWorldPos.xz * 0.4 + vec2(0.08, 0.0), uTime) - rings,
            raindropRings(vWorldPos.xz * 0.4 + vec2(0.0, 0.08), uTime) - rings
        );
        normal = normalize(normal + vec3(ringGrad.x, 0.0, ringGrad.y) * 2.5 * uRainIntensity);

        // Depth-graded albedo: bright shallows near shore, dark water in the
        // basin — driven by real terrain depth (aDepth), not a fake elevation
        // gradient, so it actually follows the basin shape.
        float depthMix = smoothstep(0.0, 0.35, vDepth);
        vec3 albedo = mix(uShallowColor, uDeepColor, depthMix);
        albedo *= mix(1.0, 0.7, uStormIntensity); // storm-stirred water reads murkier

        // Crest foam: ocean-water.html's peak-elevation foam, so wave tops
        // catch a bit of white even on calm water — not just at the shore.
        float crestFoam = smoothstep(0.16, 0.34, vElevation) * mix(0.35, 1.0, uStormIntensity);
        albedo = mix(albedo, vec3(0.92, 0.96, 0.95), crestFoam * 0.6);

        // Thin foam line right at the shore, where depth is near zero.
        float shoreFoam = 1.0 - smoothstep(0.0, 0.025, vDepth);
        albedo = mix(albedo, vec3(0.82, 0.9, 0.86), shoreFoam * 0.5);

        // Whitecaps: the short chop layer crests into breaking foam once
        // wind/storm intensity is high enough.
        float whitecap = smoothstep(0.45, 0.85, vChop) * uStormIntensity;
        albedo = mix(albedo, vec3(0.85, 0.9, 0.92), whitecap * 0.55);

        // Bright thin highlight right on the raindrop ring edge itself.
        albedo += vec3(0.55, 0.6, 0.62) * rings * 0.5;

        // Real Blinn-Phong diffuse + specular against sun and moon, ported
        // straight from ocean-water.html — this is what the old PBR-layered
        // version was missing: a crisp, self-contained highlight instead of
        // one dampened by scene ambient/tone-mapping on top of it.
        vec3 lit = albedo * 0.25; // small ambient floor so night water isn't pure black

        // Sun contribution
        {
            float diff = max(dot(normal, uSunDir), 0.0) * 0.5 + 0.5;
            vec3 halfDir = normalize(uSunDir + viewDir);
            float glintSharpness = mix(180.0, 40.0, uStormIntensity);
            float spec = pow(max(dot(normal, halfDir), 0.0), glintSharpness);
            lit += albedo * diff * uSunStrength * 0.9;
            lit += uSunColor * spec * uSunStrength * mix(1.6, 0.6, uStormIntensity);
        }
        // Moon contribution — dimmer, tighter, cooler
        {
            float diff = max(dot(normal, uMoonDir), 0.0) * 0.5 + 0.5;
            vec3 halfDir = normalize(uMoonDir + viewDir);
            float glintSharpness = mix(210.0, 46.0, uStormIntensity);
            float spec = pow(max(dot(normal, halfDir), 0.0), glintSharpness);
            lit += albedo * diff * uMoonStrength * 0.5;
            lit += uMoonColor * spec * uMoonStrength * mix(1.1, 0.45, uStormIntensity);
        }

        // Fresnel: near-grazing views (far shore, horizon) read as reflective
        // sky, straight-down views read as deep tinted water. Fakes a mirror
        // without an actual reflection pass.
        float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 4.0);
        lit = mix(lit, uSkyColor, fresnel * 0.8);

        float alpha = mix(uOpacity, 1.0, fresnel * 0.5);
        alpha = max(alpha, max(shoreFoam, crestFoam) * 0.9);

        gl_FragColor = vec4(lit, alpha);
        #include <fog_fragment>
    }
`;

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

    // Three stacked Gerstner waves (dirX, dirY, steepness, wavelength).
    // Wavelengths picked to stay well above our vertex spacing — WORLD_SIZE
    // /56 segments ≈ 20.5 units apart, so anything under ~41 units aliases
    // into jagged noise instead of a smooth swell. Rescaled up from
    // ocean-water.html's 20/10/5/2 (tuned for its 200-unit/256-segment demo
    // plane, ~0.78-unit spacing) — that demo's 4th high-frequency wave is
    // dropped since even rescaled it'd alias here; the chop layer already
    // covers that frequency band.
    const uWaves = [
        new THREE.Vector4(Math.cos(THREE.MathUtils.degToRad(45)), Math.sin(THREE.MathUtils.degToRad(45)), 0.02, 120.0),
        new THREE.Vector4(Math.cos(THREE.MathUtils.degToRad(130)), Math.sin(THREE.MathUtils.degToRad(130)), 0.016, 70.0),
        new THREE.Vector4(Math.cos(THREE.MathUtils.degToRad(210)), Math.sin(THREE.MathUtils.degToRad(210)), 0.01, 44.0)
    ];

    state.waterMaterial = new THREE.ShaderMaterial({
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        fog: true,
        uniforms: {
            uTime: { value: 0 },
            uStormIntensity: { value: 0 },
            uWaves: { value: uWaves },
            uSunDir: { value: new THREE.Vector3(0, 1, 0) },
            uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
            uSunColor: { value: new THREE.Color(0xfff4d6) },
            uMoonColor: { value: new THREE.Color(0xaac4ff) },
            uSunStrength: { value: 0 },
            uMoonStrength: { value: 0 },
            uSkyColor: { value: new THREE.Color(0x8a9aa8) },
            // Punchier than the old PBR-muted version, closer to
            // ocean-water.html's own defaults (#0a1d3a deep / #1ca3ec
            // surface), tempered slightly darker to still read as a horror-
            // forest lake rather than a tropical pool.
            uDeepColor: { value: new THREE.Color(0x082238) },
            uShallowColor: { value: new THREE.Color(0x1f7fa8) },
            uRainIntensity: { value: 0 },
            uOpacity: { value: 0.88 },
            // A raw ShaderMaterial (unlike MeshStandardMaterial) doesn't get
            // fogColor/fogDensity merged into its uniforms automatically —
            // refreshFogUniforms() writes straight into whatever's already
            // in material.uniforms, so these have to exist here up front or
            // it throws reading .value off undefined. THREE.FogExp2 in
            // main.js means fogDensity, not fogNear/fogFar.
            fogColor: { value: new THREE.Color(0x111625) },
            fogDensity: { value: 0.007 }
        },
        // FOG_EXP2 selects the exp2 branch in the #include <fog_*> chunks
        // below — must match main.js's THREE.FogExp2, not the linear THREE.Fog.
        defines: { FOG_EXP2: '' }
    });
    // day-night-cycle.js reads state.waterMaterial.userData.shader.uniforms —
    // that path was written for the old onBeforeCompile version where the
    // real shader/uniforms only existed inside userData after first compile.
    // Self-reference here so that feed code keeps working unmodified.
    state.waterMaterial.userData.shader = state.waterMaterial;

    state.waterMesh = new THREE.Mesh(geo, state.waterMaterial);
    state.waterMesh.position.y = 1.6; // Water surface level
    // NOTE: a raw ShaderMaterial doesn't receive shadows without manually
    // wiring in three's shadowmap GLSL chunks (#include <shadowmap_pars_
    // fragment> etc.), which the old MeshStandardMaterial got for free. Left
    // out for now — water receiving shadow dapple wasn't doing much visible
    // work under the fresnel/specular this shader already produces. Flag if
    // you want it back; it's a bigger lift than the rest of this pass.
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