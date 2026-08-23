// ============================================================
// GOD-RAYS — ROBUST HYBRID VERSION
// ============================================================
//
// Designed as a safer replacement for the original pass.
//
// Features:
//   • Real scene-geometry occlusion
//   • Alpha-aware foliage occlusion
//   • Camera depth awareness
//   • Soft, visible atmospheric shafts
//   • Reduced "giant triangle" radial-blur look
//   • Subtle dithering to reduce banding
//   • Warm sun scattering
//   • Sun-edge fading
//   • No custom shadow camera
//   • No WebGL2-only shader code
//   • Keeps the original public API
//
// Existing usage:
//
//   const godRays = createGodRaysPass(
//       renderer,
//       scene,
//       camera
//   );
//
//   godRays.sunWorldPosition.copy(sunPosition);
//   godRays.intensity = sunIntensity;
//
// ============================================================

import * as THREE from 'three';
import {
    Pass,
    FullScreenQuad
} from 'three/addons/postprocessing/Pass.js';


// ============================================================
// FULLSCREEN VERTEX SHADER
//
// Important:
// Use the normal Three.js transform chain.
// Do NOT manually force clip-space coordinates here.
// ============================================================

const GOD_RAYS_VERTEX = /* glsl */ `

    varying vec2 vUv;

    void main() {

        vUv = uv;

        gl_Position =
            projectionMatrix *
            modelViewMatrix *
            vec4(position, 1.0);
    }

`;


// ============================================================
// GOD-RAY FRAGMENT SHADER
// ============================================================

const GOD_RAYS_FRAGMENT = /* glsl */ `

    uniform sampler2D tDiffuse;
    uniform sampler2D tOcclusion;
    uniform sampler2D tDepth;

    uniform vec2 lightPos;

    uniform float exposure;
    uniform float decay;
    uniform float density;
    uniform float weight;

    uniform float sunVisible;

    uniform float cameraNear;
    uniform float cameraFar;

    uniform float time;

    uniform float edgeFade;

    uniform vec3 rayColor;

    varying vec2 vUv;


    // ---------------------------------------------------------
    // Small deterministic noise.
    //
    // Used only to slightly jitter the ray samples so that
    // the effect doesn't look like perfectly parallel digital
    // streaks.
    // ---------------------------------------------------------

    float hash12(vec2 p) {

        vec3 p3 =
            fract(
                vec3(p.xyx) *
                0.1031
            );

        p3 +=
            dot(
                p3,
                p3.yzx + 33.33
            );

        return fract(
            (p3.x + p3.y) *
            p3.z
        );
    }


    // ---------------------------------------------------------
    // Linearize depth.
    // ---------------------------------------------------------

    float linearizeDepth(
        float depth
    ) {

        float z =
            depth * 2.0 - 1.0;

        return
            (
                2.0 *
                cameraNear *
                cameraFar
            )
            /
            (
                cameraFar +
                cameraNear -
                z *
                (
                    cameraFar -
                    cameraNear
                )
            );
    }


    // ---------------------------------------------------------
    // Main.
    // ---------------------------------------------------------

    void main() {

        vec3 base =
            texture2D(
                tDiffuse,
                vUv
            ).rgb;


        // -----------------------------------------------------
        // Vector from this pixel toward the sun.
        // -----------------------------------------------------

        vec2 toLight =
            lightPos -
            vUv;


        float distanceToLight =
            length(
                toLight
            );


        // If the sun isn't relevant, simply output the scene.
        if (
            sunVisible <= 0.0001 ||
            distanceToLight <= 0.0001
        ) {

            gl_FragColor =
                vec4(
                    base,
                    1.0
                );

            return;
        }


        vec2 direction =
            normalize(
                toLight
            );


        // -----------------------------------------------------
        // Only travel through a controlled fraction of the
        // screen-space path.
        //
        // This is important:
        //
        // Old version:
        //   almost entire screen
        //
        // New version:
        //   concentrated shafts
        // -----------------------------------------------------

        float travel =
            distanceToLight *
            density;


        vec2 delta =
            direction *
            (
                travel /
                64.0
            );


        // -----------------------------------------------------
        // Dither the starting position.
        // -----------------------------------------------------

        float noise =
            hash12(
                gl_FragCoord.xy +
                time * 11.73
            );


        vec2 sampleUv =
            vUv +
            delta *
            (
                noise -
                0.5
            );


        // -----------------------------------------------------
        // Accumulation.
        // -----------------------------------------------------

        float illuminationDecay =
            1.0;


        float accumulated =
            0.0;


        float silhouetteAccum =
            0.0;


        float previousOcclusion =
            texture2D(
                tOcclusion,
                clamp(
                    sampleUv,
                    vec2(0.001),
                    vec2(0.999)
                )
            ).r;


        // -----------------------------------------------------
        // Radial samples.
        // -----------------------------------------------------

        for (
            int i = 0;
            i < 64;
            i++
        ) {

            sampleUv +=
                delta;


            vec2 suv =
                clamp(
                    sampleUv,
                    vec2(0.001),
                    vec2(0.999)
                );


            float occlusion =
                texture2D(
                    tOcclusion,
                    suv
                ).r;


            // ---------------------------------------------
            // Sample position along the ray.
            // ---------------------------------------------

            float t =
                float(i) /
                63.0;


            // Stronger close to the pixel and softer
            // toward the light source.
            float longitudinalFade =
                pow(
                    1.0 - t,
                    0.85
                );


            // ---------------------------------------------
            // Actual occlusion contribution.
            // ---------------------------------------------

            accumulated +=
                occlusion *
                illuminationDecay *
                longitudinalFade;


            // ---------------------------------------------
            // Silhouette contribution.
            //
            // Tree edges become slightly brighter, helping
            // the rays look like light passing through gaps
            // between foliage instead of a uniform blur.
            // ---------------------------------------------

            float silhouette =
                abs(
                    occlusion -
                    previousOcclusion
                );


            silhouetteAccum +=
                silhouette *
                illuminationDecay *
                (
                    1.0 -
                    t
                );


            previousOcclusion =
                occlusion;


            // ---------------------------------------------
            // Radial decay.
            // ---------------------------------------------

            illuminationDecay *=
                decay;
        }


        accumulated /=
            64.0;


        silhouetteAccum /=
            64.0;


        // -----------------------------------------------------
        // Camera depth.
        //
        // Prevents the effect from becoming a huge opaque fog
        // sheet directly in front of the camera.
        // -----------------------------------------------------

        float sceneDepth =
            texture2D(
                tDepth,
                vUv
            ).r;


        float linearDepth =
            linearizeDepth(
                sceneDepth
            );


        float atmosphericDepthFade =
            smoothstep(
                2.0,
                40.0,
                linearDepth
            );


        // -----------------------------------------------------
        // More natural shaft structure.
        // -----------------------------------------------------

        float shaftEnergy =
            accumulated *
            0.76;


        float gapEnergy =
            silhouetteAccum *
            0.85;


        float totalEnergy =
            shaftEnergy +
            gapEnergy;


        // -----------------------------------------------------
        // Very soft haze around the shaft.
        //
        // Keeps the scene atmospheric without filling the
        // entire sky with white light.
        // -----------------------------------------------------

        float haze =
            exp(
                -distanceToLight *
                distanceToLight *
                9.0
            )
            *
            0.14;


        totalEnergy +=
            haze;


        // -----------------------------------------------------
        // Depth weighting.
        // -----------------------------------------------------

        totalEnergy *=
            mix(
                0.30,
                1.0,
                atmosphericDepthFade
            );


        // -----------------------------------------------------
        // Screen-edge fade.
        //
        // Stops the sun near the edge of the screen from
        // creating a huge triangular smear.
        // -----------------------------------------------------

        float edge =
            max(
                abs(
                    lightPos.x -
                    0.5
                ) * 2.0,

                abs(
                    lightPos.y -
                    0.5
                ) * 2.0
            );


        float localEdgeFade =
            1.0 -
            smoothstep(
                0.72,
                1.08,
                edge
            );


        totalEnergy *=
            localEdgeFade *
            edgeFade;


        // -----------------------------------------------------
        // Reduce brightness outside the main sun direction.
        // This gives the shafts a more focused look.
        // -----------------------------------------------------

        float angularFade =
            smoothstep(
                1.0,
                0.05,
                distanceToLight
            );


        totalEnergy *=
            mix(
                0.55,
                1.0,
                angularFade
            );


        // -----------------------------------------------------
        // Final intensity.
        // -----------------------------------------------------

        float energy =
            totalEnergy *
            exposure *
            weight *
            sunVisible;


        // -----------------------------------------------------
        // Warm-neutral sunlight.
        //
        // Keep the effect warm even if the sky itself is blue.
        // -----------------------------------------------------

        vec3 scatteringColor =
            rayColor;


        vec3 rayLight =
            scatteringColor *
            energy;


        // -----------------------------------------------------
        // Very subtle highlight around the solar position.
        //
        // Not a giant disc.
        // -----------------------------------------------------

        float sunGlow =
            exp(
                -distanceToLight *
                distanceToLight *
                70.0
            );


        rayLight +=
            rayColor *
            sunGlow *
            0.035 *
            sunVisible;


        // -----------------------------------------------------
        // Output.
        // -----------------------------------------------------

        gl_FragColor =
            vec4(
                base +
                rayLight,

                1.0
            );
    }

`;


// ============================================================
// MATERIAL CREATION
// ============================================================
//
// The biggest improvement over your original pass:
//
// DO NOT use:
//
//     scene.overrideMaterial = blackMaterial;
//
//
//
// That destroys foliage alpha.
//
// Instead, temporarily replace each material while preserving:
//   • map
//   • alphaMap
//   • alphaTest
//   • side
//
// This means leaf cards can actually create holes in the
// occlusion buffer.
// ============================================================

function createOcclusionMaterial(
    source
) {

    if (
        !source ||
        !source.isMaterial
    ) {

        return null;
    }


    const hasMap =
        !!source.map;


    const hasAlphaMap =
        !!source.alphaMap;


    const sourceAlphaTest =
        Number.isFinite(
            source.alphaTest
        )
            ? source.alphaTest
            : 0;


    const usesAlpha =
        hasMap ||
        hasAlphaMap ||
        sourceAlphaTest > 0;


    // Completely transparent materials such as certain
    // water/glass materials should not become solid blockers.
    if (
        source.transparent &&
        !usesAlpha
    ) {

        return null;
    }


    const material =
        new THREE.MeshBasicMaterial({

            color:
                0x000000,

            map:
                hasMap
                    ? source.map
                    : null,

            alphaMap:
                hasAlphaMap
                    ? source.alphaMap
                    : null,

            transparent:
                usesAlpha,

            alphaTest:
                usesAlpha
                    ? Math.max(
                        0.10,
                        sourceAlphaTest
                    )
                    : 0,

            side:
                source.side ??
                THREE.FrontSide,

            depthTest:
                true,

            depthWrite:
                true,

            fog:
                false,

            toneMapped:
                false
        });


    return material;
}


// ============================================================
// GOD RAYS PASS
// ============================================================

export class GodRaysPass
    extends Pass {

    constructor(
        renderer,
        scene,
        camera,
        {
            occlusionScale = 0.5,

            // Initial values intentionally restrained.
            exposure = 0.30,
            decay = 0.94,
            density = 0.72,
            weight = 0.42,

            // Warm sunlight.
            rayColor = 0xffe8c4

        } = {}
    ) {

        super();


        this.renderer =
            renderer;


        this.scene =
            scene;


        this.camera =
            camera;


        this.occlusionScale =
            occlusionScale;


        // ----------------------------------------------------
        // Public API from original version.
        // ----------------------------------------------------

        this.sunWorldPosition =
            new THREE.Vector3();


        this.intensity =
            0;


        // ----------------------------------------------------
        // Internal state.
        // ----------------------------------------------------

        this.time =
            0;


        this._ndc =
            new THREE.Vector3();


        this._camForward =
            new THREE.Vector3();


        this._toSun =
            new THREE.Vector3();


        this._tmpColor =
            new THREE.Color();


        this._materialRestore =
            [];


        this._materialCache =
            new WeakMap();


        // ----------------------------------------------------
        // Occlusion target.
        // ----------------------------------------------------

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

                    depthBuffer:
                        true,

                    stencilBuffer:
                        false,

                    format:
                        THREE.RGBAFormat
                }
            );


        // ----------------------------------------------------
        // Separate camera depth target.
        // ----------------------------------------------------

        this.depthTarget =
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
                        THREE.NearestFilter,

                    magFilter:
                        THREE.NearestFilter,

                    depthBuffer:
                        true,

                    stencilBuffer:
                        false
                }
            );


        this.depthTarget.depthTexture =
            new THREE.DepthTexture();


        this.depthTarget.depthTexture.format =
            THREE.DepthFormat;


        this.depthTarget.depthTexture.type =
            THREE.UnsignedIntType;


        // ----------------------------------------------------
        // Tiny sun proxy.
        //
        // IMPORTANT:
        // This is deliberately tiny.
        //
        // The original version used:
        //
        //   CircleGeometry(38)
        //
        // which created an enormous source in the occlusion
        // buffer.
        // ----------------------------------------------------

        this.sunProxyMaterial =
            new THREE.SpriteMaterial({

                color:
                    0xffffff,

                transparent:
                    false,

                depthTest:
                    true,

                depthWrite:
                    false,

                sizeAttenuation:
                    false,

                fog:
                    false,

                toneMapped:
                    false
            });


        this.sunProxy =
            new THREE.Sprite(
                this.sunProxyMaterial
            );


        // 6 pixels on the occlusion target.
        this.sunProxy.scale.set(
            6,
            6,
            1
        );


        this.sunProxyScene =
            new THREE.Scene();


        this.sunProxyScene.add(
            this.sunProxy
        );


        // ----------------------------------------------------
        // Shader uniforms.
        // ----------------------------------------------------

        this.uniforms = {

            tDiffuse: {
                value:
                    null
            },


            tOcclusion: {
                value:
                    this.occlusionTarget.texture
            },


            tDepth: {
                value:
                    this.depthTarget.depthTexture
            },


            lightPos: {
                value:
                    new THREE.Vector2(
                        0.5,
                        0.5
                    )
            },


            exposure: {
                value:
                    exposure
            },


            decay: {
                value:
                    decay
            },


            density: {
                value:
                    density
            },


            weight: {
                value:
                    weight
            },


            sunVisible: {
                value:
                    0
            },


            cameraNear: {
                value:
                    camera.near
            },


            cameraFar: {
                value:
                    camera.far
            },


            time: {
                value:
                    0
            },


            edgeFade: {
                value:
                    1
            },


            rayColor: {
                value:
                    new THREE.Color(
                        rayColor
                    )
            }
        };


        // ----------------------------------------------------
        // Shader material.
        // ----------------------------------------------------

        this.material =
            new THREE.ShaderMaterial({

                uniforms:
                    this.uniforms,

                vertexShader:
                    GOD_RAYS_VERTEX,

                fragmentShader:
                    GOD_RAYS_FRAGMENT,

                depthTest:
                    false,

                depthWrite:
                    false,

                toneMapped:
                    false
            });


        this.fsQuad =
            new FullScreenQuad(
                this.material
            );
    }


    // ========================================================
    // Cache occlusion materials.
    // ========================================================

    _getOcclusionMaterial(
        source
    ) {

        if (
            this._materialCache.has(
                source
            )
        ) {

            return this._materialCache.get(
                source
            );
        }


        const replacement =
            createOcclusionMaterial(
                source
            );


        this._materialCache.set(
            source,
            replacement
        );


        return replacement;
    }


    // ========================================================
    // Replace scene materials.
    // ========================================================

    _beginOcclusionPass() {

        this._materialRestore.length =
            0;


        this.scene.traverse(
            (object) => {

                if (
                    !object.isMesh ||
                    !object.material
                ) {

                    return;
                }


                const original =
                    object.material;


                this._materialRestore.push({

                    object:
                        object,

                    material:
                        original,

                    visible:
                        object.visible
                });


                if (
                    Array.isArray(
                        original
                    )
                ) {

                    object.material =
                        original.map(
                            (material) => {

                                if (
                                    !material
                                ) {

                                    return null;
                                }


                                return this
                                    ._getOcclusionMaterial(
                                        material
                                    );
                            }
                        );


                } else {

                    const replacement =
                        this
                            ._getOcclusionMaterial(
                                original
                            );


                    if (
                        replacement
                        === null
                    ) {

                        object.visible =
                            false;

                    } else {

                        object.material =
                            replacement;
                    }
                }
            }
        );
    }


    // ========================================================
    // Restore materials.
    // ========================================================

    _endOcclusionPass() {

        for (
            let i =
                this._materialRestore.length - 1;

            i >= 0;

            i--
        ) {

            const entry =
                this._materialRestore[i];


            entry.object.material =
                entry.material;


            entry.object.visible =
                entry.visible;
        }


        this._materialRestore.length =
            0;
    }


    // ========================================================
    // Render scene into black occlusion buffer.
    // ========================================================

    _renderOcclusion(
        renderer
    ) {

        const previousTarget =
            renderer.getRenderTarget();


        const previousAutoClear =
            renderer.autoClear;


        const previousClearColor =
            renderer
                .getClearColor(
                    this._tmpColor
                )
                .clone();


        const previousClearAlpha =
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


            this._beginOcclusionPass();


            renderer.render(
                this.scene,
                this.camera
            );


            this._endOcclusionPass();


            // ----------------------------------------------
            // Draw the tiny sun on top of the occluders.
            //
            // Depth testing means trees / terrain that are
            // physically between camera and sun can hide it.
            // ----------------------------------------------

            renderer.autoClear =
                false;


            renderer.render(
                this.sunProxyScene,
                this.camera
            );


        } finally {

            this._endOcclusionPass();


            renderer.autoClear =
                previousAutoClear;


            renderer.setRenderTarget(
                previousTarget
            );


            renderer.setClearColor(
                previousClearColor,
                previousClearAlpha
            );
        }
    }


    // ========================================================
    // Render camera depth.
    //
    // We use the scene's normal materials here. Three.js writes
    // the actual camera depth into the DepthTexture.
    // ========================================================

    _renderDepth(
        renderer
    ) {

        const previousTarget =
            renderer.getRenderTarget();


        const previousAutoClear =
            renderer.autoClear;


        const previousClearColor =
            renderer
                .getClearColor(
                    this._tmpColor
                )
                .clone();


        const previousClearAlpha =
            renderer.getClearAlpha();


        try {

            renderer.setRenderTarget(
                this.depthTarget
            );


            renderer.setClearColor(
                0xffffff,
                1
            );


            renderer.autoClear =
                true;


            this._beginOcclusionPass();


            renderer.render(
                this.scene,
                this.camera
            );


            this._endOcclusionPass();


        } finally {

            this._endOcclusionPass();


            renderer.autoClear =
                previousAutoClear;


            renderer.setRenderTarget(
                previousTarget
            );


            renderer.setClearColor(
                previousClearColor,
                previousClearAlpha
            );
        }
    }


    // ========================================================
    // Main render.
    // ========================================================

    render(
        renderer,
        writeBuffer,
        readBuffer,
        deltaTime
    ) {

        this.time +=
            Number.isFinite(
                deltaTime
            )
                ? deltaTime
                : 0.016;


        this.uniforms.time.value =
            this.time;


        // ----------------------------------------------------
        // Sun facing direction.
        // ----------------------------------------------------

        this._camForward.set(
            0,
            0,
            -1
        );


        this._camForward.applyQuaternion(
            this.camera.quaternion
        );


        this._toSun
            .copy(
                this.sunWorldPosition
            )
            .sub(
                this.camera.position
            );


        const sunDistance =
            this._toSun.length();


        if (
            sunDistance <
            0.0001
        ) {

            this.uniforms.sunVisible.value =
                0;

        } else {

            this._toSun.normalize();


            const facing =
                this._camForward.dot(
                    this._toSun
                );


            // Smooth fade when sun approaches the back of
            // the camera.
            const facingFade =
                THREE.MathUtils.smoothstep(
                    facing,
                    -0.10,
                    0.20
                );


            this.uniforms.sunVisible.value =
                THREE.MathUtils.clamp(
                    this.intensity,
                    0,
                    1
                ) *
                facingFade;
        }


        // ----------------------------------------------------
        // Sun screen position.
        // ----------------------------------------------------

        this._ndc.copy(
            this.sunWorldPosition
        );


        this._ndc.project(
            this.camera
        );


        const screenX =
            (
                this._ndc.x +
                1
            ) *
            0.5;


        const screenY =
            (
                this._ndc.y +
                1
            ) *
            0.5;


        this.uniforms
            .lightPos
            .value
            .set(
                screenX,
                screenY
            );


        // ----------------------------------------------------
        // Avoid expensive passes when the sun is irrelevant.
        // ----------------------------------------------------

        const sunUseful =
            this.uniforms
                .sunVisible
                .value > 0.001;


        if (
            sunUseful
        ) {

            this._renderOcclusion(
                renderer
            );


            this._renderDepth(
                renderer
            );
        }


        // ----------------------------------------------------
        // Update camera uniforms.
        // ----------------------------------------------------

        this.uniforms
            .cameraNear
            .value =
                this.camera.near;


        this.uniforms
            .cameraFar
            .value =
                this.camera.far;


        this.uniforms
            .tDiffuse
            .value =
                readBuffer.texture;


        // ----------------------------------------------------
        // Render fullscreen shader.
        // ----------------------------------------------------

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


    // ========================================================
    // Resize.
    // ========================================================

    setSize(
        width,
        height
    ) {

        const w =
            Math.max(
                1,
                Math.floor(
                    width *
                    this.occlusionScale
                )
            );


        const h =
            Math.max(
                1,
                Math.floor(
                    height *
                    this.occlusionScale
                )
            );


        this.occlusionTarget.setSize(
            w,
            h
        );


        this.depthTarget.setSize(
            w,
            h
        );
    }


    // ========================================================
    // Cleanup.
    // ========================================================

    dispose() {

        this.occlusionTarget.dispose();

        this.depthTarget.dispose();

        this.sunProxyMaterial.dispose();

        this.material.dispose();

        this.fsQuad.dispose();
    }
}


// ============================================================
// FACTORY
// ============================================================

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


// ============================================================
// OPTIONAL REAL SUN LIGHT
//
// This is separate from the god-ray pass.
//
// God rays = light scattering through air.
//
// DirectionalLight = actual sunlight hitting your geometry.
//
// If your game already has a sun DirectionalLight, DON'T create
// another one. Just use your existing light.
// ============================================================

export function createSunLight(
    scene,
    {
        color = 0xfff1d2,

        intensity = 2.5,

        shadowMapSize = 2048,

        shadowRange = 100,

        shadowNear = 1,

        shadowFar = 250

    } = {}
) {

    const sun =
        new THREE.DirectionalLight(
            color,
            intensity
        );


    sun.castShadow =
        true;


    sun.shadow.mapSize.set(
        shadowMapSize,
        shadowMapSize
    );


    sun.shadow.camera.left =
        -shadowRange;


    sun.shadow.camera.right =
        shadowRange;


    sun.shadow.camera.top =
        shadowRange;


    sun.shadow.camera.bottom =
        -shadowRange;


    sun.shadow.camera.near =
        shadowNear;


    sun.shadow.camera.far =
        shadowFar;


    sun.shadow.bias =
        -0.00015;


    sun.shadow.normalBias =
        0.025;


    scene.add(
        sun
    );


    scene.add(
        sun.target
    );


    return sun;
}


// ============================================================
// UPDATE REAL SUN
// ============================================================

export function updateSunLight(
    sun,
    sunWorldPosition,
    targetPosition
) {

    if (!sun) {
        return;
    }


    sun.position.copy(
        sunWorldPosition
    );


    if (
        sun.target &&
        targetPosition
    ) {

        sun.target.position.copy(
            targetPosition
        );


        sun.target.updateMatrixWorld();
    }
}