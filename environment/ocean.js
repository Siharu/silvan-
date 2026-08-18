// A vast ocean filling the gap between the coastline cliffs and the painted
// mountain backdrop. This is the "sea/sun visual treatment... island —
// everything here is the universe you'll explore" item flagged as
// discussed-but-not-built in SILVAN_PLAN.md. It's also the actual
// Vanishing-of-Ethan-Carter trick: the mountains alone read as a wall you
// can't get past, but a hazy sea stretching out beyond them — visible,
// never reachable — is what sells "this small island is everything" far
// harder than the walkable land ever could on its own.
//
// Shows through because environment/terrain.js's getElevation() drops the
// seafloor below OCEAN_LEVEL past the coastline — same "flat plane,
// occluded by higher terrain" trick environment/lake.js already uses for
// the inland lake, just at the opposite scale. Reuses lake.js's general
// fresnel/glint shader language but as its own simpler material: no
// per-vertex depth grading or rain rings needed at this distance, just a
// slow distant swell, a horizon haze gradient, sun/moon glint, and —
// critically — fx/dynamic-fog.js so the horizon itself melts into the sky
// instead of hard-cutting to a flat fog color.

import * as THREE from 'three';
import { WORLD_SIZE, OCEAN_LEVEL } from '../core/world-state.js';
import { addDynamicFog } from '../fx/dynamic-fog.js';

export function createOcean(state) {
    // RingGeometry, not CircleGeometry — CircleGeometry has no radial
    // subdivision (just one fan of triangles from center to rim), so the
    // vertex-shader swell below had almost nothing to actually displace on
    // a mesh this size. innerRadius stays small (well inside the tightest
    // cove's coastline, see environment/terrain.js's islandRadiusAt) so
    // it's never visible — it exists purely to avoid wasting the radial
    // segment budget on the island's own interior, which the ocean is
    // never seen under.
    const innerRadius = 120;
    const outerRadius = WORLD_SIZE * 0.72; // comfortably past the mountain-boundary far ring
    const geo = new THREE.RingGeometry(innerRadius, outerRadius, 128, 48);
    geo.rotateX(-Math.PI / 2);

    state.oceanMaterial = new THREE.MeshStandardMaterial({
        color: 0x0a2230,
        roughness: 0.15,
        metalness: 0.05,
    });

    state.oceanMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
        shader.uniforms.uMoonDir = { value: new THREE.Vector3(0, 1, 0) };
        shader.uniforms.uSunColor = { value: new THREE.Color(0xfff4d6) };
        shader.uniforms.uMoonColor = { value: new THREE.Color(0xaac4ff) };
        shader.uniforms.uSunStrength = { value: 0 };
        shader.uniforms.uMoonStrength = { value: 0 };
        shader.uniforms.uDeepColor = { value: new THREE.Color(0x061a24) };
        shader.uniforms.uHorizonColor = { value: new THREE.Color(0x4d7a8c) };
        shader.uniforms.uStormIntensity = { value: 0 };
        state.oceanMaterial.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
            #include <common>
            uniform float uTime;
            varying vec3 vWorldPos;
            varying vec3 vViewDirW;
            varying vec3 vWaveNormal;
            varying float vChop;
        `);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
            vViewDirW = cameraPosition - vWorldPos;

            // Slow, big rolling swell — this is meant to be seen from a
            // clifftop at a distance, never walked on, so it's tuned much
            // slower and broader than the lake's chop (environment/lake.js).
            // Storms still visibly stir it — same weather signal the lake
            // reacts to, so a rough sea in the distance matches a rough
            // lake up close instead of the two looking like different days.
            float stormAmp = 1.0 + uStormIntensity * 2.0;
            float a1 = 0.012, a2 = 0.009, sp1 = 0.35 * (1.0 + uStormIntensity * 0.8), sp2 = 0.27 * (1.0 + uStormIntensity * 0.8);
            float amp1 = 0.9 * stormAmp, amp2 = 0.6 * stormAmp;

            float cx = 0.055, cz = 0.048, cSp = 0.9 * (1.0 + uStormIntensity);
            float chopAmp = uStormIntensity * 0.5;
            float chopPhase = position.x * cx + position.z * cz * 0.7 + uTime * cSp;
            float chop = sin(chopPhase) * chopAmp;
            vChop = abs(sin(chopPhase * 1.6 + uTime * 0.3)) * uStormIntensity;

            transformed.y += sin(position.x * a1 + uTime * sp1) * amp1
                            + cos(position.z * a2 - uTime * sp2) * amp2
                            + chop;
            float dHdx = amp1 * a1 * cos(position.x * a1 + uTime * sp1)
                       + chopAmp * cx * cos(chopPhase);
            float dHdz = -amp2 * a2 * sin(position.z * a2 - uTime * sp2)
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
            uniform vec3 uDeepColor;
            uniform vec3 uHorizonColor;
            uniform float uStormIntensity;
            varying vec3 vWorldPos;
            varying vec3 vViewDirW;
            varying vec3 vWaveNormal;
            varying float vChop;
        `);
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            vec3 viewDirN = normalize(vViewDirW);
            vec3 waterNormal = normalize(vWaveNormal);

            // Distance haze toward a lighter horizon color — real open water
            // visibly lightens/desaturates with distance under atmosphere,
            // well before fx/dynamic-fog.js's own sky-blend takes over even
            // further out. Without this the sea reads as one flat dark color
            // right up to where the fog starts, which looks like a floor with
            // an edge rather than something that recedes into distance.
            // uHorizonColor itself now tracks the sky's actual horizon color
            // per frame (see atmosphere/day-night-cycle.js) instead of a
            // fixed dusk tint, so this gradient and the dynamic-fog blend
            // beyond it converge on the same color instead of seaming.
            float dist = length(vViewDirW);
            float haze = smoothstep(60.0, 700.0, dist);
            vec3 baseCol = mix(uDeepColor, uHorizonColor, haze);
            // Storm-stirred water reads murkier/darker, same as the lake.
            baseCol *= mix(1.0, 0.72, uStormIntensity);

            float fresnel = pow(1.0 - clamp(dot(waterNormal, viewDirN), 0.0, 1.0), 3.0);
            baseCol = mix(baseCol, uHorizonColor, fresnel * 0.6);

            // Whitecaps: the chop layer (vChop, see vertex shader) crests
            // into scattered foam once storm intensity climbs — absent on a
            // calm sea, matching the lake's whitecap behavior so the two
            // read as the same weather event rather than independent water.
            float whitecap = smoothstep(0.45, 0.85, vChop) * uStormIntensity;
            baseCol = mix(baseCol, vec3(0.82, 0.87, 0.9), whitecap * 0.5);

            vec3 reflected = reflect(-viewDirN, waterNormal);
            float glintSharpness = mix(90.0, 30.0, uStormIntensity);
            float sunGlint = min(pow(max(dot(reflected, uSunDir), 0.0), glintSharpness), 1.0) * uSunStrength;
            float moonGlint = min(pow(max(dot(reflected, uMoonDir), 0.0), glintSharpness * 1.2), 1.0) * uMoonStrength;
            baseCol += uSunColor * sunGlint * mix(1.8, 0.9, uStormIntensity);
            baseCol += uMoonColor * moonGlint * mix(1.3, 0.6, uStormIntensity);

            vec4 diffuseColor = vec4(baseCol, opacity);
            `
        );
    };

    // Melts into the actual sky/mountain color at the horizon instead of
    // hard-cutting to flat fog — see fx/dynamic-fog.js. Chain-safe: wraps
    // the swell/glint hook above rather than replacing it. This is the
    // single biggest thing that sells "endless sea" over "big blue floor
    // with an edge".
    addDynamicFog(state.oceanMaterial, state.backgroundRenderTarget.texture);

    state.oceanMesh = new THREE.Mesh(geo, state.oceanMaterial);
    state.oceanMesh.position.y = OCEAN_LEVEL;
    state.scene.add(state.oceanMesh);
}