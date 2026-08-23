// Screen-space volumetric god rays (the classic GPU Gems 3 "radial blur of
// an occlusion buffer" technique) — replaces the old sprite-based ray
// texture from fx/textures.js's sunRays canvas.
//
// Why the sprite approach couldn't be fixed by blurring it further: it was
// a flat billboard texture pinned to the sun's screen position, completely
// unaware of the actual scene geometry around it. Real godrays exist
// because something (trees, hills, clouds) blocks light everywhere except
// through the gaps — the ray *shape* is a byproduct of the occluders, not
// a property of the sun itself. A static texture can be blurred into a
// softer static texture, but it can never pick up an actual tree silhouette
// or react to the camera swinging past a hillside, so it always reads as
// "decal on the sky" rather than "light in the world."
//
// How this version actually gets that: each frame, before the normal scene
// renders, we render a second cheap low-res pass where every real object in
// the scene is forced solid black (scene.overrideMaterial) and a small
// bright proxy disc is drawn at the sun's world position on top of that —
// respecting the depth buffer already laid down by the black geometry, so
// hills/trees/clouds genuinely occlude it. That buffer is then radially
// blurred toward the sun's screen-space position with per-sample decay and
// additively composited over the final frame. The rays that come out are
// shaped by whatever's actually silhouetted against the sun, fade
// continuously with no fixed beam count, and vanish naturally when the sun
// itself is occluded — because it actually is, in that buffer.
//
// Scope note: transient FX (fireflies/dust/rain) aren't excluded from the
// occlusion buffer, so they technically act as tiny black occluders too.
// At their actual on-screen size (a handful of pixels, at quarter-res) this
// is not visually distinguishable from noise in the existing radial blur,
// so it's left as-is rather than adding a dedicated exclude-layer plumbing
// pass through fx/rain.js, fx/fireflies.js, and fx/dust.js for a change
// that wouldn't be visible.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const RADIAL_BLUR_FRAGMENT = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tOcclusion;
    uniform vec2 lightPos;
    uniform float exposure;
    uniform float decay;
    uniform float density;
    uniform float weight;
    uniform float sunVisible;
    varying vec2 vUv;

    const int NUM_SAMPLES = 48;

    void main() {
        vec2 deltaTextCoord = (vUv - lightPos) * (density / float(NUM_SAMPLES));
        vec2 sampleUv = vUv;
        float illuminationDecay = 1.0;
        vec3 accum = vec3(0.0);

        for (int i = 0; i < NUM_SAMPLES; i++) {
            sampleUv -= deltaTextCoord;
            vec3 samp = texture2D(tOcclusion, sampleUv).rgb;
            accum += samp * illuminationDecay * weight;
            illuminationDecay *= decay;
        }

        vec3 base = texture2D(tDiffuse, vUv).rgb;
        gl_FragColor = vec4(base + accum * exposure * sunVisible, 1.0);
    }
`;

const RADIAL_BLUR_VERTEX = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export class GodRaysPass extends Pass {
    constructor(renderer, scene, camera, { occlusionScale = 0.5 } = {}) {
        super();
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.occlusionScale = occlusionScale;

        // Sun's world-space position and its overall visibility/strength
        // (0-1, folding in both "is it day" and "is it cloudy") — set every
        // frame from main.js's animate() loop, driven by
        // atmosphere/day-night-cycle.js's own sun math rather than this
        // module duplicating that logic.
        this.sunWorldPosition = new THREE.Vector3();
        this.intensity = 0;

        const size = renderer.getSize(new THREE.Vector2());
        // occlusionScale bumped 0.25 -> 0.5, plus linear filtering and 4x
        // MSAA on this target: at quarter-res, thin single-pixel-wide
        // occluders (grass blades, reeds, the tower antenna) either fell
        // entirely between sample points (flickering in and out) or landed
        // as a single stray bright/dark texel — and the 48-tap radial blur
        // below stretches any one of those into a long visible streak
        // across the whole frame. Filtering + more resolution smooths
        // those thin occluders out before they ever reach the blur.
        this.occlusionTarget = new THREE.WebGLRenderTarget(
            Math.max(1, Math.floor(size.x * occlusionScale)),
            Math.max(1, Math.floor(size.y * occlusionScale)),
            { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, samples: 4 }
        );

        this.blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

        // Bright proxy disc standing in for the sun during the occlusion
        // render — kept in its own tiny scene so it never appears (and
        // never gets forced black by scene.overrideMaterial) in the real
        // frame. Depth-tests against the black geometry rendered just
        // before it, so it's correctly hidden behind hills/trees/clouds.
        const proxyGeo = new THREE.CircleGeometry(38, 24);
        const proxyMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
        this.sunProxy = new THREE.Mesh(proxyGeo, proxyMat);
        this.sunProxyScene = new THREE.Scene();
        this.sunProxyScene.add(this.sunProxy);

        this.uniforms = {
            tDiffuse: { value: null },
            tOcclusion: { value: this.occlusionTarget.texture },
            lightPos: { value: new THREE.Vector2(0.5, 0.5) },
            // exposure/weight trimmed slightly (0.45->0.38, 0.55->0.45) on
            // top of the occlusion-buffer fix above — any streak artifact
            // that still slips through reads much fainter at this exposure
            // instead of as a hard bright/dark line.
            exposure: { value: 0.38 },
            decay: { value: 0.96 },
            density: { value: 0.85 },
            weight: { value: 0.45 },
            sunVisible: { value: 0 }
        };
        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: RADIAL_BLUR_VERTEX,
            fragmentShader: RADIAL_BLUR_FRAGMENT,
            depthTest: false,
            depthWrite: false
        });
        this.fsQuad = new FullScreenQuad(this.material);

        this._ndc = new THREE.Vector3();
        this._camForward = new THREE.Vector3();
        this._toSun = new THREE.Vector3();
    }

    setSize(width, height) {
        this.occlusionTarget.setSize(
            Math.max(1, Math.floor(width * this.occlusionScale)),
            Math.max(1, Math.floor(height * this.occlusionScale))
        );
        this.occlusionTarget.samples = 4;
    }

    render(renderer, writeBuffer, readBuffer) {
        // Sun proxy always faces the camera and sits at the real sun's
        // world position — billboarding a flat circle this way is fine
        // since it only ever needs to occlude-test as a small disc, not
        // look like anything on its own (the visible sun disc is still
        // environment/sky.js's sunSprite in the main scene).
        this.sunProxy.position.copy(this.sunWorldPosition);
        this.sunProxy.quaternion.copy(this.camera.quaternion);

        // Behind-camera / off-screen fade: projecting a point behind the
        // camera flips its NDC x/y, which would otherwise make the rays
        // suddenly point the wrong way right as the sun leaves view instead
        // of just fading out.
        this._camForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this._toSun.copy(this.sunWorldPosition).sub(this.camera.position).normalize();
        const facing = this._camForward.dot(this._toSun);
        const sunVisible = this.intensity * THREE.MathUtils.smoothstep(facing, -0.1, 0.15);

        this.uniforms.sunVisible.value = sunVisible;

        if (sunVisible > 0.001) {
            this._ndc.copy(this.sunWorldPosition).project(this.camera);
            this.uniforms.lightPos.value.set((this._ndc.x + 1) / 2, (this._ndc.y + 1) / 2);

            // 1. Occlusion buffer: everything in the real scene forced
            // black (populates depth), then the bright sun proxy drawn on
            // top respecting that depth buffer.
            const prevTarget = renderer.getRenderTarget();
            const prevOverride = this.scene.overrideMaterial;
            const prevAutoClear = renderer.autoClear;
            const prevClearColor = renderer.getClearColor(new THREE.Color());
            const prevClearAlpha = renderer.getClearAlpha();

            renderer.setRenderTarget(this.occlusionTarget);
            renderer.setClearColor(0x000000, 1);
            renderer.autoClear = true;
            this.scene.overrideMaterial = this.blackMaterial;
            renderer.render(this.scene, this.camera);
            this.scene.overrideMaterial = prevOverride;

            renderer.autoClear = false;
            renderer.render(this.sunProxyScene, this.camera);
            renderer.autoClear = prevAutoClear;

            renderer.setRenderTarget(prevTarget);
            renderer.setClearColor(prevClearColor, prevClearAlpha);
        }

        // 2. Composite: radial-blur the occlusion buffer toward the sun's
        // screen position and add it over the actual rendered frame.
        this.uniforms.tDiffuse.value = readBuffer.texture;
        if (this.renderToScreen) {
            renderer.setRenderTarget(null);
        } else {
            renderer.setRenderTarget(writeBuffer);
        }
        this.fsQuad.render(renderer);
    }
}

export function createGodRaysPass(renderer, scene, camera) {
    return new GodRaysPass(renderer, scene, camera);
}