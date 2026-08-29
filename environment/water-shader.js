// Shared Gerstner-wave water shader — ported near-verbatim from the
// ocean-water.html reference demo's "Dynamic Water System" (4 stacked
// Gerstner waves, height-based depth/foam color mixing, Blinn-Phong +
// fresnel lighting). Used by both environment/lake.js (Calm Lake preset)
// and environment/ocean.js (Ocean Breeze preset, recolored), so wave/color
// tuning lives in one place instead of two copies drifting apart.
//
// Two changes from the original demo, both needed to fit into a scene with
// a real day/night cycle instead of a fixed camera-lit product shot:
//   - u_lightDir is fed live from the sun/moon direction each frame
//     (atmosphere/day-night-cycle.js) instead of a fixed vec3(1,1,1).
//   - the hardcoded vec3(0.7,0.8,0.9) fresnel "sky color" is now a
//     u_skyColor uniform, also fed from the actual sky gradient each frame,
//     so the water's horizon reflection actually matches the sky above it.

import * as THREE from 'three';

const gerstnerWaveGLSL = `
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

export const waterVertexShader = `
    #define NUM_WAVES 4

    uniform float u_time;
    uniform float u_speed;
    uniform vec4 u_waves[NUM_WAVES];
    uniform float u_elevationScale;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vElevation;

    ${gerstnerWaveGLSL}

    // fog_pars_vertex/fog_vertex declare+fill vFogDepth — needed both for
    // three's own built-in exp2 fog and, on the ocean specifically, for
    // fx/dynamic-fog.js's addDynamicFog() which patches in right after
    // #include <fog_vertex> below (see environment/ocean.js).
    #include <fog_pars_vertex>

    void main() {
        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 0.0, 1.0);
        vec3 p = position;

        vec3 displacement = vec3(0.0);
        for (int i = 0; i < NUM_WAVES; i++) {
            displacement += gerstnerWave(u_waves[i], position, u_time * u_speed, tangent, binormal);
        }
        p += displacement;

        vec3 normal = normalize(cross(binormal, tangent));

        vec4 worldPosition = modelMatrix * vec4(p, 1.0);
        vWorldPosition = worldPosition.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vElevation = p.y * u_elevationScale;

        gl_Position = projectionMatrix * viewMatrix * worldPosition;

        // fog_vertex (three's built-in chunk) reads mvPosition — normally
        // supplied by #include <project_vertex>, which this hand-written
        // shader doesn't use, so it has to be declared here or mvPosition
        // is an undeclared identifier and the whole shader fails to compile.
        vec4 mvPosition = viewMatrix * worldPosition;
        #include <fog_vertex>
    }
`;

export const waterFragmentShader = `
    uniform vec3 u_surfaceColor;
    uniform vec3 u_depthColor;
    uniform vec3 u_foamColor;
    uniform float u_colorOffset;
    uniform float u_colorMultiplier;
    uniform float u_foamThreshold;
    uniform float u_opacity;

    uniform vec3 u_lightDir;
    uniform vec3 u_skyColor;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vElevation;

    #include <clipping_planes_pars_fragment>
    #include <fog_pars_fragment>

    void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);

        float mixStrength = (vElevation + u_colorOffset) * u_colorMultiplier;
        mixStrength = smoothstep(0.0, 1.0, mixStrength);
        vec3 albedo = mix(u_depthColor, u_surfaceColor, mixStrength);

        float foamMix = smoothstep(u_foamThreshold, u_foamThreshold + 0.5, vElevation);
        albedo = mix(albedo, u_foamColor, foamMix);

        vec3 lightDir = normalize(u_lightDir);
        float diff = max(dot(normal, lightDir), 0.0);
        diff = diff * 0.5 + 0.5;

        vec3 halfwayDir = normalize(lightDir + viewDir);
        float spec = pow(max(dot(normal, halfwayDir), 0.0), 60.0);

        float NdotV = max(dot(normal, viewDir), 0.0);
        // Was pow(1.0-NdotV, 5.0) with no floor — that goes to exactly 0 at
        // head-on viewing angles, so nearly all normal play (looking down
        // at water in front of you, not along the shoreline at a grazing
        // angle) got essentially zero sky reflection mixed in. Real water
        // always has *some* reflectivity even straight-on — that baseline
        // is what actually reads as "water" instead of tinted glass. This
        // is the Schlick fresnel approximation with F0=0.06 (typical for
        // water) as a floor, ramping up to full reflectivity at grazing
        // angles same as before.
        float F0 = 0.06;
        float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);
        albedo = mix(albedo, u_skyColor, fresnel);

        vec3 finalColor = albedo * (diff * 0.8 + 0.2) + vec3(1.0) * spec * 0.9;

        float alpha = mix(u_opacity, 1.0, fresnel);
        alpha = max(alpha, foamMix);

        gl_FragColor = vec4(finalColor, alpha);
        #include <fog_fragment>
    }
`;

function waveVec4(dirDeg, steepness, wavelength) {
    const rad = THREE.MathUtils.degToRad(dirDeg);
    return new THREE.Vector4(Math.cos(rad), Math.sin(rad), steepness, wavelength);
}

// params: { speed, elevationScale, depthColor, surfaceColor, foamColor,
//           colorOffset, colorMultiplier, foamThreshold, opacity,
//           waves: [{dir,steep,len} x4] }
export function createWaterMaterial(params) {
    const material = new THREE.ShaderMaterial({
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        fog: true,
        // Matches main.js's THREE.FogExp2, not the linear THREE.Fog variant.
        // A raw ShaderMaterial doesn't get fogColor/fogDensity merged in
        // automatically — day-night-cycle.js's refreshFogUniforms() (and,
        // for the ocean, addDynamicFog()) both write straight into whatever
        // is already in material.uniforms, so these have to exist up front.
        defines: { FOG_EXP2: '' },
        uniforms: {
            fogColor: { value: new THREE.Color(0x111625) },
            fogDensity: { value: 0.007 },
            u_time: { value: 0 },
            u_speed: { value: params.speed },
            u_elevationScale: { value: params.elevationScale },
            u_depthColor: { value: new THREE.Color(params.depthColor) },
            u_surfaceColor: { value: new THREE.Color(params.surfaceColor) },
            u_foamColor: { value: new THREE.Color(params.foamColor) },
            u_colorOffset: { value: params.colorOffset },
            u_colorMultiplier: { value: params.colorMultiplier },
            u_foamThreshold: { value: params.foamThreshold },
            u_opacity: { value: params.opacity },
            u_lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
            u_skyColor: { value: new THREE.Color(0x8a9aa8) },
            u_waves: { value: params.waves.map(w => waveVec4(w.dir, w.steep, w.len)) }
        }
    });
    // Self-reference so atmosphere/day-night-cycle.js's per-frame feed can
    // use the same `material.userData.shader.uniforms` path the old
    // onBeforeCompile-based materials used.
    material.userData.shader = material;
    // Base (unmultiplied) speed/steepness values, so the live wave-height/
    // speed sliders (core/input.js) and storm reactivity (below) can scale
    // relative to each preset's own character instead of overwriting lake
    // and ocean to the same absolute number and erasing the difference
    // between "Calm Lake" and "Ocean Breeze".
    material.userData.baseSpeed = params.speed;
    material.userData.baseSteepness = params.waves.map(w => w.steep);
    return material;
}
