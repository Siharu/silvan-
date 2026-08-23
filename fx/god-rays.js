// Improved atmospheric god rays for Three.js
//
// Goals:
//  - Preserve alpha-tested foliage in the occlusion pass instead of turning
//    transparent leaf cards into solid rectangles.
//  - Use a tiny screen-sized sun proxy rather than a 38-world-unit disc.
//  - Produce short, soft shafts instead of a giant triangular screen smear.
//  - Add distance falloff, edge falloff and subtle dithering to reduce the
//    obvious "radial blur" look.
//  - Keep the public interface compatible with the original GodRaysPass:
//      pass.sunWorldPosition.copy(...)
//      pass.intensity = 0..1
//
// This is still a screen-space technique, so it is intentionally cheaper than
// true ray-marched volumetric lighting. It should, however, read much more
// like light scattering through a forest.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const GODRAYS_FRAGMENT = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tOcclusion;
    uniform vec2 lightPos;
    uniform float exposure;
    uniform float decay;
    uniform float density;
    uniform float weight;
    uniform float sunVisible;
    uniform float screenFade;
    uniform float haze;
    uniform float time;

    varying vec2 vUv;

    const int NUM_SAMPLES = 64;

    float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
    }

    void main() {
        vec3 base = texture2D(tDiffuse, vUv).rgb;

        float sunDist = distance(vUv, lightPos);

        // Tiny spatial dither breaks the perfectly uniform radial-blur pattern.
        float dither = (hash21(gl_FragCoord.xy) - 0.5) * 0.035;

        vec2 dir = lightPos - vUv;
        float rayLength = length(dir);

        vec2 rayDir =
            rayLength > 0.0001
            ? dir / rayLength
            : vec2(0.0, 1.0);

        // Prevent rays from becoming enormous when the sun approaches
        // the edge of the screen.
        float maxDistance = min(rayLength, 0.95);

        vec2 deltaUv =
            rayDir *
            (maxDistance * density / float(NUM_SAMPLES));

        vec2 sampleUv = vUv + dither * deltaUv;

        float illuminationDecay = 1.0;

        float shortAccum = 0.0;
        float longAccum = 0.0;

        for (int i = 0; i < NUM_SAMPLES; i++) {
            sampleUv += deltaUv;

            vec2 suv = clamp(
                sampleUv,
                vec2(0.001),
                vec2(0.999)
            );

            float occ = texture2D(
                tOcclusion,
                suv
            ).r;

            float t =
                float(i) /
                float(NUM_SAMPLES - 1);

            // Stronger close to the viewer.
            float localFade =
                smoothstep(1.0, 0.0, t);

            // Much weaker atmospheric contribution farther away.
            float shortWeight =
                pow(localFade, 1.65);

            float longWeight =
                pow(1.0 - localFade, 1.2);

            shortAccum +=
                occ *
                illuminationDecay *
                shortWeight;

            longAccum +=
                occ *
                illuminationDecay *
                longWeight;

            illuminationDecay *= decay;
        }

        shortAccum /= float(NUM_SAMPLES);
        longAccum /= float(NUM_SAMPLES);

        // Soft glow surrounding the actual sun.
        float sunGlow =
            exp(-sunDist * sunDist * 18.0) *
            0.55;

        // Prevent the radial blur from creating the classic giant
        // triangular wedge when the sun is near/outside the screen.
        float edge =
            max(
                abs(lightPos.x - 0.5) * 2.0,
                abs(lightPos.y - 0.5) * 2.0
            );

        float edgeFade =
            1.0 -
            smoothstep(
                0.82,
                1.18,
                edge
            );

        float shaftEnergy =
            shortAccum * 0.95 +
            longAccum * 0.28 +
            sunGlow * haze;

        float finalEnergy =
            shaftEnergy *
            exposure *
            sunVisible *
            screenFade *
            edgeFade;

        // Warm-neutral atmospheric scattering instead of a neon cyan overlay.
        vec3 scatterTint =
            vec3(
                1.0,
                0.96,
                0.88
            );

        vec3 godRayColor =
            scatterTint *
            finalEnergy;

        gl_FragColor =
            vec4(
                base + godRayColor,
                1.0
            );
    }
`;

const GODRAYS_VERTEX = /* glsl */ `
    varying vec2 vUv;

    void main() {
        vUv = uv;

        gl_Position =
            projectionMatrix *
            modelViewMatrix *
            vec4(position, 1.0);
    }
`;

function isRenderableMesh(object) {
    return object &&
           object.isMesh &&
           object.material;
}

function makeOccluderMaterial(source) {

    const transparent =
        !!source.transparent;

    const hasAlphaMap =
        !!source.alphaMap;

    const hasMap =
        !!source.map;

    const alphaTest =
        Number.isFinite(source.alphaTest)
        ? source.alphaTest
        : 0;

    // Transparent surfaces such as glass and water should not become
    // completely opaque blockers.
    if (
        transparent &&
        !hasAlphaMap &&
        !hasMap &&
        alphaTest <= 0.0
    ) {
        return null;
    }

    const shouldAlphaTest =
        hasAlphaMap ||
        hasMap ||
        alphaTest > 0.0 ||
        source.alphaHash;

    const mat =
        new THREE.MeshBasicMaterial({
            color: 0x000000,

            side:
                source.side ??
                THREE.FrontSide,

            transparent: false,

            depthWrite: true,
            depthTest: true,

            fog: false,

            toneMapped: false,

            alphaTest:
                shouldAlphaTest
                ? Math.max(alphaTest, 0.12)
                : 0.0
        });

    // Preserve the original leaf texture.
    if (hasMap) {
        mat.map = source.map;
    }

    if (hasAlphaMap) {
        mat.alphaMap = source.alphaMap;
    }

    mat.needsUpdate = true;

    return mat;
}

export class GodRaysPass extends Pass {

    constructor(
        renderer,
        scene,
        camera,
        {
            occlusionScale = 0.5,
            samples = 64,

            // Tiny screen-space sun source.
            sunProxySize = 3.0,

            // Much more restrained than the original.
            exposure = 0.16,
            decay = 0.925,
            density = 0.34,
            weight = 0.20,
            haze = 0.22

        } = {}
    ) {

        super();

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        this.occlusionScale =
            occlusionScale;

        this.samples =
            Math.max(
                16,
                Math.min(96, samples)
            );

        this.sunWorldPosition =
            new THREE.Vector3();

        this.intensity = 0;

        this.sunProxySize =
            sunProxySize;

        this._time = 0;

        const size =
            renderer.getSize(
                new THREE.Vector2()
            );

        this.occlusionTarget =
            new THREE.WebGLRenderTarget(
                Math.max(
                    1,
                    Math.floor(
                        size.x *
                        occlusionScale
                    )
                ),

                Math.max(
                    1,
                    Math.floor(
                        size.y *
                        occlusionScale
                    )
                ),

                {
                    minFilter:
                        THREE.LinearFilter,

                    magFilter:
                        THREE.LinearFilter,

                    format:
                        THREE.RGBAFormat,

                    depthBuffer: true,

                    stencilBuffer: false,

                    samples: 4
                }
            );

        // One-pixel-ish screen-space source.
        //
        // This replaces the old:
        //
        // CircleGeometry(38, 24)
        //
        // which was much too large for an occlusion source.
        this.sunProxyGeometry =
            new THREE.BufferGeometry();

        this.sunProxyGeometry.setAttribute(
            'position',

            new THREE.Float32BufferAttribute(
                [0, 0, 0],
                3
            )
        );

        this.sunProxyMaterial =
            new THREE.PointsMaterial({

                color: 0xffffff,

                size:
                    this.sunProxySize,

                sizeAttenuation: false,

                transparent: false,

                depthTest: true,

                depthWrite: false,

                fog: false,

                toneMapped: false
            });

        this.sunProxy =
            new THREE.Points(
                this.sunProxyGeometry,
                this.sunProxyMaterial
            );

        this.sunProxyScene =
            new THREE.Scene();

        this.sunProxyScene.add(
            this.sunProxy
        );

        this.uniforms = {

            tDiffuse: {
                value: null
            },

            tOcclusion: {
                value:
                    this.occlusionTarget.texture
            },

            lightPos: {
                value:
                    new THREE.Vector2(
                        0.5,
                        0.5
                    )
            },

            exposure: {
                value: exposure
            },

            decay: {
                value: decay
            },

            density: {
                value: density
            },

            weight: {
                value: weight
            },

            sunVisible: {
                value: 0
            },

            screenFade: {
                value: 1
            },

            haze: {
                value: haze
            },

            time: {
                value: 0
            }
        };

        this.material =
            new THREE.ShaderMaterial({

                uniforms:
                    this.uniforms,

                vertexShader:
                    GODRAYS_VERTEX,

                fragmentShader:
                    GODRAYS_FRAGMENT,

                depthTest: false,

                depthWrite: false,

                transparent: false,

                toneMapped: false
            });

        this.fsQuad =
            new FullScreenQuad(
                this.material
            );

        this._ndc =
            new THREE.Vector3();

        this._camForward =
            new THREE.Vector3();

        this._toSun =
            new THREE.Vector3();

        this._occluderCache =
            new WeakMap();

        this._restoreMaterials =
            [];

        this._tmpColor =
            new THREE.Color();
    }

    setSize(width, height) {

        this.occlusionTarget.setSize(

            Math.max(
                1,
                Math.floor(
                    width *
                    this.occlusionScale
                )
            ),

            Math.max(
                1,
                Math.floor(
                    height *
                    this.occlusionScale
                )
            )
        );

        this.occlusionTarget.samples = 4;
    }

    setQuality({
        occlusionScale,
        samples
    } = {}) {

        if (
            Number.isFinite(
                occlusionScale
            ) &&
            occlusionScale > 0
        ) {

            this.occlusionScale =
                THREE.MathUtils.clamp(
                    occlusionScale,
                    0.25,
                    1.0
                );

            const size =
                this.renderer.getSize(
                    new THREE.Vector2()
                );

            this.setSize(
                size.x,
                size.y
            );
        }

        if (
            Number.isFinite(samples)
        ) {

            this.samples =
                Math.max(
                    16,
                    Math.min(
                        96,
                        Math.floor(samples)
                    )
                );
        }
    }

    _getOccluderMaterial(source) {

        if (
            !source ||
            !source.isMaterial
        ) {
            return null;
        }

        let cached =
            this._occluderCache.get(
                source
            );

        if (!cached) {

            cached =
                Array.isArray(source)
                ? source.map(
                    makeOccluderMaterial
                )
                : makeOccluderMaterial(
                    source
                );

            this._occluderCache.set(
                source,
                cached
            );
        }

        return cached;
    }

    _swapSceneToOccluderMaterials() {

        this._restoreMaterials.length = 0;

        this.scene.traverse(
            object => {

                if (
                    !isRenderableMesh(
                        object
                    )
                ) {
                    return;
                }

                const replacement =
                    this._getOccluderMaterial(
                        object.material
                    );

                if (
                    replacement === undefined
                ) {
                    return;
                }

                this._restoreMaterials.push([
                    object,
                    object.material
                ]);

                if (
                    Array.isArray(
                        replacement
                    )
                ) {

                    object.material =
                        replacement.map(
                            (m, i) =>
                                m ||
                                object.material[i]
                        );

                } else if (
                    replacement
                ) {

                    object.material =
                        replacement;

                } else {

                    // Hide things such as water/glass during the
                    // occlusion pass.
                    object.visible = false;

                    this._restoreMaterials[
                        this._restoreMaterials.length - 1
                    ].push(true);
                }
            }
        );
    }

    _restoreSceneMaterials() {

        for (
            let i =
                this._restoreMaterials.length - 1;

            i >= 0;

            i--
        ) {

            const entry =
                this._restoreMaterials[i];

            const object =
                entry[0];

            object.material =
                entry[1];

            if (entry[2]) {
                object.visible = true;
            }
        }

        this._restoreMaterials.length = 0;
    }

    render(
        renderer,
        writeBuffer,
        readBuffer,
        deltaTime = 0.016
    ) {

        this._time +=
            Number.isFinite(deltaTime)
            ? deltaTime
            : 0.016;

        this.uniforms.time.value =
            this._time;

        this.sunProxy.position.copy(
            this.sunWorldPosition
        );

        this._camForward.set(
            0,
            0,
            -1
        ).applyQuaternion(
            this.camera.quaternion
        );

        this._toSun
            .copy(this.sunWorldPosition)
            .sub(this.camera.position);

        const sunDistance =
            this._toSun.length();

        const facing =
            sunDistance > 0.0001
            ? this._camForward.dot(
                this._toSun.multiplyScalar(
                    1 / sunDistance
                )
            )
            : 0;

        const facingFade =
            THREE.MathUtils.smoothstep(
                facing,
                -0.04,
                0.16
            );

        const sunVisible =
            THREE.MathUtils.clamp(
                this.intensity,
                0,
                1
            ) *
            facingFade;

        this.uniforms.sunVisible.value =
            sunVisible;

        if (
            sunVisible > 0.0005
        ) {

            this._ndc
                .copy(
                    this.sunWorldPosition
                )
                .project(
                    this.camera
                );

            const lightX =
                (this._ndc.x + 1) * 0.5;

            const lightY =
                (this._ndc.y + 1) * 0.5;

            this.uniforms.lightPos.value.set(
                lightX,
                lightY
            );

            // Smoothly fade the effect as the sun leaves the screen.
            const edgeDistance =
                Math.max(
                    Math.abs(this._ndc.x),
                    Math.abs(this._ndc.y)
                );

            const screenFade =
                1.0 -
                THREE.MathUtils.smoothstep(
                    edgeDistance,
                    0.78,
                    1.12
                );

            this.uniforms.screenFade.value =
                screenFade;

            const prevTarget =
                renderer.getRenderTarget();

            const prevOverride =
                this.scene.overrideMaterial;

            const prevAutoClear =
                renderer.autoClear;

            const prevClearColor =
                renderer
                    .getClearColor(
                        this._tmpColor
                    )
                    .clone();

            const prevClearAlpha =
                renderer.getClearAlpha();

            try {

                renderer.setRenderTarget(
                    this.occlusionTarget
                );

                renderer.setClearColor(
                    0x000000,
                    1
                );

                renderer.autoClear =
                    true;

                // IMPORTANT:
                //
                // Do NOT use scene.overrideMaterial.
                //
                // Alpha-tested foliage needs its texture alpha to survive
                // the occlusion pass.
                this._swapSceneToOccluderMaterials();

                renderer.render(
                    this.scene,
                    this.camera
                );

                this._restoreSceneMaterials();

                // Draw the tiny sun point after the scene.
                // The existing depth buffer determines whether it is visible.
                renderer.autoClear =
                    false;

                renderer.render(
                    this.sunProxyScene,
                    this.camera
                );

            } finally {

                this._restoreSceneMaterials();

                this.scene.overrideMaterial =
                    prevOverride;

                renderer.autoClear =
                    prevAutoClear;

                renderer.setRenderTarget(
                    prevTarget
                );

                renderer.setClearColor(
                    prevClearColor,
                    prevClearAlpha
                );
            }

        } else {

            this.uniforms.screenFade.value =
                0;
        }

        // Composite scattering over the normal scene.
        this.uniforms.tDiffuse.value =
            readBuffer.texture;

        if (
            this.renderToScreen
        ) {

            renderer.setRenderTarget(
                null
            );

        } else {

            renderer.setRenderTarget(
                writeBuffer
            );
        }

        this.fsQuad.render(
            renderer
        );
    }

    dispose() {

        this.occlusionTarget.dispose();

        this.sunProxyGeometry.dispose();

        this.sunProxyMaterial.dispose();

        this.material.dispose();

        this.fsQuad.dispose();
    }
}

export function createGodRaysPass(
    renderer,
    scene,
    camera,
    options = {}
) {

    return new GodRaysPass(
        renderer,
        scene,
        camera,
        options
    );
}