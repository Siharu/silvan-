// A vast ocean filling the gap between the coastline cliffs and the painted
// mountain backdrop. This is the "sea/sun visual treatment... island —
// everything here is the universe you'll explore" item flagged as
// discussed-but-not-built in SILVAN_PLAN.md, and it's the actual
// Vanishing-of-Ethan-Carter trick: the mountains alone read as a wall you
// can't get past, but a hazy sea stretching out beyond them — visible,
// never reachable — is what sells "this small island is everything" far
// harder than the walkable land ever could on its own.
//
// Was previously MeshStandardMaterial + onBeforeCompile — same problem
// environment/lake.js had before its rewrite: running through three's full
// PBR pipeline muted the color grading and glint under scene ambient/tone-
// mapping, which read as flat, murky "underwater" water rather than an open
// vista. Converted to a real THREE.ShaderMaterial with its own self-
// contained Blinn-Phong lighting, matching the lake's fix. Everything else
// stays: environment/terrain.js drops the seafloor below OCEAN_LEVEL past
// the coastline so this shows through naturally, and — critically —
// fx/dynamic-fog.js's per-pixel background-texture fog is still wired in via
// addDynamicFog() below, so the horizon still melts into the actual sky/
// mountain color on screen instead of hard-cutting to a flat fog color.
// That dynamic horizon blend is the single biggest thing that sells "endless
// sea" over "big blue floor with an edge" and is preserved exactly as it was.

import * as THREE from 'three';
import { WORLD_SIZE, OCEAN_LEVEL } from '../core/world-state.js';
import { addDynamicFog } from '../fx/dynamic-fog.js';

const oceanVertexShader = `
    uniform float uTime;
    uniform float uStormIntensity;
    uniform float uWaveHeightMult;
    uniform float uWaveSpeedMult;
    uniform float uStormReactivityMult;

    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying float vChop;

    #include <fog_pars_vertex>

    void main() {
        vec3 p = position;

        // Slow, big rolling swell — meant to be seen from a clifftop at a
        // distance, never walked on, so tuned much slower/broader than the
        // lake's chop (environment/lake.js). Storms still visibly stir it —
        // same weather signal the lake reacts to, so a rough sea in the
        // distance matches a rough lake up close instead of looking like two
        // different days. uWaveHeightMult/uWaveSpeedMult/uStormReactivityMult
        // are Settings-panel sliders (core/modifiers.js), same three knobs
        // and same meaning as the lake's — reactivity only scales the
        // "* uStormIntensity * X" storm terms, height/speed scale the whole
        // swell regardless of weather.
        float stormAmp = (1.0 + uStormIntensity * 2.0 * uStormReactivityMult) * uWaveHeightMult;
        float speedMult = (1.0 + uStormIntensity * 0.8 * uStormReactivityMult) * uWaveSpeedMult;
        float a1 = 0.012, a2 = 0.009, sp1 = 0.35 * speedMult, sp2 = 0.27 * speedMult;
        float amp1 = 0.9 * stormAmp, amp2 = 0.6 * stormAmp;

        float cx = 0.055, cz = 0.048, cSp = 0.9 * (1.0 + uStormIntensity * uStormReactivityMult) * uWaveSpeedMult;
        float chopAmp = uStormIntensity * 0.5 * uStormReactivityMult * uWaveHeightMult;
        float chopPhase = position.x * cx + position.z * cz * 0.7 + uTime * cSp;
        float chop = sin(chopPhase) * chopAmp;
        vChop = abs(sin(chopPhase * 1.6 + uTime * 0.3)) * uStormIntensity;

        p.y += sin(position.x * a1 + uTime * sp1) * amp1
             + cos(position.z * a2 - uTime * sp2) * amp2
             + chop;

        float dHdx = amp1 * a1 * cos(position.x * a1 + uTime * sp1)
                   + chopAmp * cx * cos(chopPhase);
        float dHdz = -amp2 * a2 * sin(position.z * a2 - uTime * sp2)
                   + chopAmp * cz * 0.7 * cos(chopPhase);
        vec3 normal = normalize(vec3(-dHdx, 1.0, -dHdz));

        vec4 worldPosition = modelMatrix * vec4(p, 1.0);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);

        vWorldPos = worldPosition.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);

        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;

const oceanFragmentShader = `
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uMoonDir;
    uniform vec3 uSunColor;
    uniform vec3 uMoonColor;
    uniform float uSunStrength;
    uniform float uMoonStrength;
    uniform vec3 uDeepColor;
    uniform vec3 uHorizonColor;
    uniform float uStormIntensity;

    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    varying float vChop;

    #include <clipping_planes_pars_fragment>
    #include <fog_pars_fragment>

    void main() {
        vec3 normal = normalize(vNormalW);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);

        // Distance haze toward a lighter horizon color — real open water
        // visibly lightens/desaturates with distance under atmosphere, well
        // before fx/dynamic-fog.js's own sky-blend takes over even further
        // out. Without this the sea reads as one flat dark color right up to
        // where the fog starts — a floor with an edge rather than something
        // that recedes into distance. uHorizonColor tracks the sky's actual
        // horizon color per frame (atmosphere/day-night-cycle.js) so this
        // gradient and the dynamic-fog blend beyond it converge on the same
        // color instead of visibly seaming.
        float dist = length(cameraPosition - vWorldPos);
        float haze = smoothstep(60.0, 700.0, dist);
        vec3 albedo = mix(uDeepColor, uHorizonColor, haze);
        albedo *= mix(1.0, 0.72, uStormIntensity); // storm-stirred water reads murkier

        // Whitecaps: the chop layer crests into scattered foam once storm
        // intensity climbs — absent on a calm sea, same curve as the lake's
        // whitecaps so both read as the same weather event.
        float whitecap = smoothstep(0.45, 0.85, vChop) * uStormIntensity;
        albedo = mix(albedo, vec3(0.82, 0.87, 0.9), whitecap * 0.5);

        // Real Blinn-Phong diffuse + specular against sun and moon, same
        // self-contained lighting model as the lake — this is what the old
        // MeshStandardMaterial version was missing: a crisp, open-air
        // highlight instead of one dampened by scene ambient/tone-mapping.
        vec3 lit = albedo * 0.35; // ambient floor so night/overcast sea isn't pure black

        {
            float diff = max(dot(normal, uSunDir), 0.0) * 0.5 + 0.5;
            vec3 halfDir = normalize(uSunDir + viewDir);
            float glintSharpness = mix(90.0, 30.0, uStormIntensity);
            float spec = pow(max(dot(normal, halfDir), 0.0), glintSharpness);
            lit += albedo * diff * uSunStrength * 0.85;
            lit += uSunColor * spec * uSunStrength * mix(2.0, 0.9, uStormIntensity);
        }
        {
            float diff = max(dot(normal, uMoonDir), 0.0) * 0.5 + 0.5;
            vec3 halfDir = normalize(uMoonDir + viewDir);
            float glintSharpness = mix(110.0, 34.0, uStormIntensity);
            float spec = pow(max(dot(normal, halfDir), 0.0), glintSharpness);
            lit += albedo * diff * uMoonStrength * 0.45;
            lit += uMoonColor * spec * uMoonStrength * mix(1.4, 0.6, uStormIntensity);
        }

        // Fresnel toward the horizon color — at this scale the "sky
        // reflection" and "atmospheric horizon" are visually the same thing,
        // so it reuses uHorizonColor rather than a separate sky uniform.
        float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.0);
        lit = mix(lit, uHorizonColor, fresnel * 0.6);

        gl_FragColor = vec4(lit, 1.0);
        #include <fog_fragment>
    }
`;

export function createOcean(state) {
    // RingGeometry, not CircleGeometry — CircleGeometry has no radial
    // subdivision (just one fan of triangles from center to rim), so the
    // vertex-shader swell above would have almost nothing to actually
    // displace on a mesh this size. innerRadius stays small (well inside the
    // tightest cove's coastline, see environment/terrain.js's
    // islandRadiusAt) so it's never visible — it exists purely to avoid
    // wasting the radial segment budget on the island's own interior, which
    // the ocean is never seen under.
    const innerRadius = 120;
    const outerRadius = WORLD_SIZE * 0.72; // comfortably past the mountain-boundary far ring
    const geo = new THREE.RingGeometry(innerRadius, outerRadius, 128, 48);
    geo.rotateX(-Math.PI / 2);

    state.oceanMaterial = new THREE.ShaderMaterial({
        vertexShader: oceanVertexShader,
        fragmentShader: oceanFragmentShader,
        fog: true,
        uniforms: {
            uTime: { value: 0 },
            uStormIntensity: { value: 0 },
            // Settings-panel water sliders (core/modifiers.js) — same three
            // knobs and same live-update path as the lake's (see
            // environment/lake.js), so tuning one visibly matches the other.
            uWaveHeightMult: { value: state.modifiers.waterWaveHeight },
            uWaveSpeedMult: { value: state.modifiers.waterWaveSpeed },
            uStormReactivityMult: { value: state.modifiers.waterStormReactivity },
            uSunDir: { value: new THREE.Vector3(0, 1, 0) },
            uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
            uSunColor: { value: new THREE.Color(0xfff4d6) },
            uMoonColor: { value: new THREE.Color(0xaac4ff) },
            uSunStrength: { value: 0 },
            uMoonStrength: { value: 0 },
            // Punchier/less murky than the old PBR-muted defaults — a real
            // deep-sea blue rather than a near-black teal, closer to how an
            // actual "vast vista" ocean reads under open sky.
            uDeepColor: { value: new THREE.Color(0x0d2e42) },
            uHorizonColor: { value: new THREE.Color(0x6f97a8) },
            // Raw ShaderMaterial doesn't get fogColor/fogDensity merged in
            // automatically (see environment/lake.js's fix for the same
            // issue) — refreshFogUniforms() writes into whatever's already
            // in material.uniforms, so these have to exist up front.
            fogColor: { value: new THREE.Color(0x111625) },
            fogDensity: { value: 0.007 }
        },
        defines: { FOG_EXP2: '' } // matches main.js's THREE.FogExp2, not the linear THREE.Fog variant
    });
    // day-night-cycle.js reads state.oceanMaterial.userData.shader.uniforms —
    // written for the old onBeforeCompile version where the real shader/
    // uniforms only existed inside userData after first compile.
    // Self-reference here so that feed code keeps working unmodified.
    state.oceanMaterial.userData.shader = state.oceanMaterial;

    // Melts into the actual sky/mountain color at the horizon instead of
    // hard-cutting to flat fog — see fx/dynamic-fog.js. This still works on
    // a raw ShaderMaterial the same way it did on MeshStandardMaterial: it
    // string-patches whatever's already in shader.vertexShader/fragmentShader
    // via the #include markers above, so it doesn't care which base material
    // produced that shader text. Chain-safe by construction even though
    // nothing else patches this material.
    addDynamicFog(state.oceanMaterial, state.backgroundRenderTarget.texture);

    state.oceanMesh = new THREE.Mesh(geo, state.oceanMaterial);
    state.oceanMesh.position.y = OCEAN_LEVEL;
    state.scene.add(state.oceanMesh);
}
