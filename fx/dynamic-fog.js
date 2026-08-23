// Dynamic, per-fragment fog that blends into whatever's actually rendered
// behind an object (the sky gradient, mountain backdrop, clouds) instead of
// a single flat fogColor.
//
// Why this matters here: environment/sky.js's sky dome is a top/bottom
// gradient, not a flat color, and the mountain-boundary rings sit inside
// it. Three.js's default fog just mixes toward one flat scene.fog.color —
// fine near the horizon, but a treetop silhouetted against the zenith and
// its trunk against the horizon both fog toward that *same* flat color, so
// distant silhouettes read as a hard gray band cutting across the gradient
// instead of melting into the sky behind them. That mismatch is exactly
// what makes a boundary/edge readable as an edge. Technique adapted from
// https://medium.com/@anumberfromtheghost/fog-with-dynamic-multicolored-backgrounds-in-three-js-b76907629cb1
//
// Mechanism: everything marked BACKGROUND_LAYER (sky dome, clouds, stars,
// sun/moon sprites, the mountain rings — see where .layers.enable() is
// called in sky.js/mountain-boundary.js) gets rendered to a small offscreen
// target once per frame, before the main scene renders (see main.js's
// animate loop). Fog-eligible materials (terrain, forest, pines, rocks,
// grass — wherever addDynamicFog() is called) sample that texture at their
// own screen position and fog toward *that* color instead of a flat
// uniform, so they melt into whatever sky/mountain color is actually behind
// them on screen.

import * as THREE from 'three';

export const BACKGROUND_LAYER = 1;

// Downscaled on purpose — the backdrop has no fine detail worth resolving,
// it's purely a soft color source to fog toward, and a small target keeps
// the extra per-frame render cheap on the low-end "potato mode" quality
// preset too (see core/quality.js).
const RESOLUTION_SCALE = 0.15;

export function createBackgroundRenderTarget() {
    const w = Math.max(1, Math.floor(window.innerWidth * RESOLUTION_SCALE));
    const h = Math.max(1, Math.floor(window.innerHeight * RESOLUTION_SCALE));
    return new THREE.WebGLRenderTarget(w, h);
}

export function resizeBackgroundRenderTarget(target) {
    target.setSize(
        Math.max(1, Math.floor(window.innerWidth * RESOLUTION_SCALE)),
        Math.max(1, Math.floor(window.innerHeight * RESOLUTION_SCALE))
    );
}

// Renders the BACKGROUND_LAYER-only pass to `target`, then restores the
// camera to see every layer again so the main scene render right after
// this (main.js's composer.render()) draws normally.
export function renderBackgroundPass(state, target) {
    state.camera.layers.set(BACKGROUND_LAYER);
    state.renderer.setRenderTarget(target);
    state.renderer.clear();
    state.renderer.render(state.scene, state.camera);
    state.renderer.setRenderTarget(null);
    state.camera.layers.enableAll();
}

// Patches a material so its built-in fog blends toward the captured
// background texture instead of a flat color.
//
// Chain-safe: wraps any onBeforeCompile the material already has (forest
// trunk/leaf, grass wind-sway, mountain brightness, etc. all use it)
// instead of clobbering it. This only works because every existing hook in
// this codebase keeps `#include <common>` as the first line of whatever it
// replaces that chunk with — a standard three.js patching convention — so
// the marker is still present in the shader source for this hook to find
// afterward, regardless of call order.
export function addDynamicFog(material, backgroundTexture) {
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        if (previous) previous(shader, renderer);

        shader.uniforms.uBackgroundTexture = { value: backgroundTexture };

        // Anchoring on '#include <common>' assumes the shader came from
        // three's chunked template. That's true for every MeshStandardMaterial
        // caller here, but environment/ocean.js is a raw THREE.ShaderMaterial
        // with hand-written GLSL — it has '#include <fog_vertex>' (so the
        // assignment below still lands) but no '#include <common>' anywhere
        // to anchor the declaration on, so the replace was silently a no-op
        // and vClipPosition was never declared: "undeclared identifier" at
        // the assignment, with GLSL's fallout from that read as bogus
        // l-value/dimension errors on the same line. Fall back to
        // prepending the declaration directly when the anchor isn't there.
        const vClipDecl = 'varying vec4 vClipPosition;';
        if (shader.vertexShader.includes('#include <common>')) {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
            ${vClipDecl}`
            );
        } else {
            shader.vertexShader = `${vClipDecl}\n${shader.vertexShader}`;
        }
        shader.vertexShader = shader.vertexShader.replace(
            '#include <fog_vertex>',
            `#include <fog_vertex>
            vClipPosition = gl_Position;`
        );

        const fragDecl = `uniform sampler2D uBackgroundTexture;
            ${vClipDecl}`;
        if (shader.fragmentShader.includes('#include <clipping_planes_pars_fragment>')) {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <clipping_planes_pars_fragment>',
                `#include <clipping_planes_pars_fragment>
            ${fragDecl}`
            );
        } else {
            shader.fragmentShader = `${fragDecl}\n${shader.fragmentShader}`;
        }
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <fog_fragment>',
            `
            #ifdef USE_FOG
                #ifdef FOG_EXP2
                    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
                #else
                    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
                #endif
                vec2 vCoords = vClipPosition.xy / vClipPosition.w;
                vCoords = vCoords * 0.5 + 0.5;
                vec3 bgColor = texture2D( uBackgroundTexture, vCoords ).rgb;
                gl_FragColor.rgb = mix( gl_FragColor.rgb, bgColor, fogFactor );
            #endif
            `
        );
    };
    // Materials that already compiled once (shouldn't be the case for any
    // caller here, since this always runs at creation time, but cheap
    // insurance against a stale cached program if that ever changes).
    material.needsUpdate = true;
}