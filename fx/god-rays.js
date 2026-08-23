// Cinematic atmospheric sun + volumetric god rays for Three.js
//
// Drop-in replacement for the original GodRaysPass.
// Public compatibility kept:
//   const pass = createGodRaysPass(renderer, scene, camera, options);
//   pass.sunWorldPosition.copy(sunPosition);
//   pass.intensity = 0..1;
//
// This version is intentionally hybrid rather than a simple radial blur:
//   1. Low-resolution camera depth for correct world-space ray marching.
//   2. A dedicated sun-facing depth map for real occlusion by trees/buildings.
//   3. Height/distance atmospheric density.
//   4. Henyey-Greenstein-like forward scattering for a sun-facing atmosphere.
//   5. Temporal/spatial jitter to hide banding without making visible streaks.
//   6. A restrained HDR sun glow/disc that disappears when the sun is blocked.
//
// It does NOT replace your scene's materials, lights, or render loop.
// The optional setupSunLighting() helper can be used to make the scene's
// actual object lighting more physically convincing.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const MAX_VOLUME_SAMPLES = 48;

const VERTEX = /* glsl */ `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const FRAGMENT = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tSceneDepth;
    uniform sampler2D tSunDepth;

    uniform vec2 lightPos;
    uniform float sunViewDepth;
    uniform float sunVisible;

    uniform mat4 cameraInvProjection;
    uniform mat4 cameraMatrixWorld;
    uniform mat4 sunMatrix;

    uniform vec3 cameraPositionWorld;
    uniform vec3 sunDirection;
    uniform vec3 sunColor;

    uniform float cameraNear;
    uniform float cameraFar;

    uniform float maxDistance;
    uniform float atmosphereDensity;
    uniform float atmosphereHeight;
    uniform float atmosphereBase;

    uniform float scattering;
    uniform float anisotropy;
    uniform float extinction;

    uniform float shadowBias;
    uniform vec2 shadowTexelSize;

    uniform float time;

    uniform float exposure;
    uniform float sunDiscStrength;
    uniform float sunHaloStrength;

    varying vec2 vUv;


    // ------------------------------------------------------------
    // Small deterministic hash for dithering.
    // ------------------------------------------------------------

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


    // ------------------------------------------------------------
    // Unpack RGBADepthPacking.
    // ------------------------------------------------------------

    float unpackDepth(vec4 rgbaDepth) {

        const vec4 bitShift =
            vec4(
                1.0,
                1.0 / 255.0,
                1.0 / 65025.0,
                1.0 / 16581375.0
            );

        return dot(
            rgbaDepth,
            bitShift
        );
    }


    // ------------------------------------------------------------
    // Hardware depth -> positive view-space distance.
    // ------------------------------------------------------------

    float linearizeDepth(float depth) {

        float z =
            depth * 2.0 - 1.0;

        return
            (2.0 * cameraNear * cameraFar) /
            (
                cameraFar +
                cameraNear -
                z *
                (cameraFar - cameraNear)
            );
    }


    // ------------------------------------------------------------
    // Reconstruct a view-space ray from screen UV.
    // ------------------------------------------------------------

    vec3 viewRay(vec2 uv) {

        vec4 clip =
            vec4(
                uv * 2.0 - 1.0,
                1.0,
                1.0
            );

        vec4 view =
            cameraInvProjection *
            clip;

        return normalize(
            view.xyz /
            max(view.w, 0.00001)
        );
    }


    // ------------------------------------------------------------
    // View -> world.
    // ------------------------------------------------------------

    vec3 worldFromView(
        vec3 viewPosition
    ) {

        return (
            cameraMatrixWorld *
            vec4(
                viewPosition,
                1.0
            )
        ).xyz;
    }


    // ------------------------------------------------------------
    // Henyey-Greenstein phase approximation.
    //
    // Positive g = forward scattering.
    // Sunlight naturally has stronger forward scattering in mist.
    // ------------------------------------------------------------

    float hgPhase(
        float cosTheta,
        float g
    ) {

        float gg =
            g * g;

        float denom =
            pow(
                max(
                    1.0 +
                    gg -
                    2.0 *
                    g *
                    cosTheta,
                    0.0001
                ),
                1.5
            );

        return
            (1.0 - gg) /
            (
                4.0 *
                3.14159265 *
                denom
            );
    }


    // ------------------------------------------------------------
    // Sample the dedicated sun-space shadow/depth map.
    //
    // This is a soft 3x3 PCF lookup rather than a single hard sample.
    // ------------------------------------------------------------

    float shadowVisibility(
        vec3 worldPos
    ) {

        vec4 shadowPos =
            sunMatrix *
            vec4(
                worldPos,
                1.0
            );

        if (shadowPos.w <= 0.0) {
            return 1.0;
        }

        vec3 suv =
            shadowPos.xyz /
            shadowPos.w;

        suv =
            suv * 0.5 +
            0.5;

        if (
            suv.x <= 0.001 ||
            suv.x >= 0.999 ||
            suv.y <= 0.001 ||
            suv.y >= 0.999 ||
            suv.z <= 0.001 ||
            suv.z >= 0.999
        ) {
            return 1.0;
        }

        float visible = 0.0;

        vec2 texel =
            shadowTexelSize;

        for (
            int y = -1;
            y <= 1;
            y++
        ) {

            for (
                int x = -1;
                x <= 1;
                x++
            ) {

                vec2 offset =
                    vec2(
                        float(x),
                        float(y)
                    ) *
                    texel;

                float mapDepth =
                    unpackDepth(
                        texture2D(
                            tSunDepth,
                            suv.xy + offset
                        )
                    );

                visible +=
                    (
                        suv.z <=
                        mapDepth +
                        shadowBias
                    )
                    ? 1.0
                    : 0.0;
            }
        }

        return
            visible / 9.0;
    }


    // ------------------------------------------------------------
    // Exponential atmospheric density by height.
    //
    // Dense near ground -> gradually thinner upward.
    // ------------------------------------------------------------

    float altitudeDensity(
        vec3 worldPos
    ) {

        float h =
            max(
                worldPos.y -
                atmosphereBase,
                0.0
            );

        float normalized =
            h /
            max(
                atmosphereHeight,
                0.001
            );

        float vertical =
            exp(
                -normalized * 3.2
            );

        return
            clamp(
                vertical,
                0.05,
                1.0
            );
    }


    // ------------------------------------------------------------
    // Main volumetric shader.
    // ------------------------------------------------------------

    void main() {

        vec3 sceneColor =
            texture2D(
                tDiffuse,
                vUv
            ).rgb;


        // --------------------------------------------------------
        // Determine where the camera ray should terminate.
        // --------------------------------------------------------

        float depth =
            texture2D(
                tSceneDepth,
                vUv
            ).r;

        float rayEnd =
            maxDistance;

        if (
            depth <
            0.999999
        ) {

            rayEnd =
                min(
                    rayEnd,
                    linearizeDepth(
                        depth
                    )
                );
        }


        // --------------------------------------------------------
        // Build the camera ray.
        // --------------------------------------------------------

        vec3 rayDirView =
            viewRay(
                vUv
            );

        float marchLength =
            max(
                rayEnd -
                cameraNear,
                0.01
            );

        float stepLength =
            marchLength /
            float(
                MAX_VOLUME_SAMPLES
            );


        // --------------------------------------------------------
        // Temporal/spatial jitter.
        //
        // Without this, low sample-count volume marching produces
        // obvious horizontal/vertical banding.
        // --------------------------------------------------------

        float jitter =
            hash12(
                gl_FragCoord.xy +
                time * 17.0
            );

        float firstOffset =
            (jitter - 0.5) *
            stepLength;


        // --------------------------------------------------------
        // Accumulator + extinction.
        // --------------------------------------------------------

        vec3 accumulated =
            vec3(0.0);

        float transmittance =
            1.0;


        // --------------------------------------------------------
        // Calculate view direction in world space.
        // --------------------------------------------------------

        vec3 viewDirWorld =
            normalize(
                worldFromView(
                    rayDirView *
                    max(
                        rayEnd,
                        cameraNear
                    )
                ) -
                cameraPositionWorld
            );


        // --------------------------------------------------------
        // Atmospheric phase term.
        // --------------------------------------------------------

        float phase =
            hgPhase(
                dot(
                    viewDirWorld,
                    -sunDirection
                ),
                anisotropy
            );


        // Art-direct the physical phase function into a useful
        // game range.
        phase *=
            (
                0.35 +
                3.5 *
                scattering
            );


        // --------------------------------------------------------
        // Ray march.
        // --------------------------------------------------------

        for (
            int i = 0;
            i < MAX_VOLUME_SAMPLES;
            i++
        ) {

            float fi =
                float(i);

            float sampleDistance =
                cameraNear +
                max(
                    firstOffset,
                    0.0
                ) +
                fi *
                stepLength;

            if (
                sampleDistance >=
                rayEnd
            ) {
                break;
            }


            // ----------------------------------------------
            // Position.
            // ----------------------------------------------

            vec3 viewPos =
                rayDirView *
                sampleDistance;

            vec3 worldPos =
                worldFromView(
                    viewPos
                );


            // ----------------------------------------------
            // Atmospheric density.
            // ----------------------------------------------

            float density =
                atmosphereDensity *
                altitudeDensity(
                    worldPos
                );


            // ----------------------------------------------
            // Suppress the first few meters.
            //
            // This prevents a giant flat white veil immediately
            // in front of the camera.
            // ----------------------------------------------

            float cameraFade =
                smoothstep(
                    1.5,
                    8.0,
                    sampleDistance
                );


            // ----------------------------------------------
            // Directionality.
            // ----------------------------------------------

            vec3 toSun =
                normalize(
                    -sunDirection
                );

            float sunAngle =
                max(
                    dot(
                        normalize(
                            -rayDirView
                        ),
                        toSun
                    ),
                    0.0
                );

            float directional =
                0.65 +
                0.35 *
                sunAngle;


            // ----------------------------------------------
            // Actual sunlight visibility.
            //
            // This is what makes tree masses and buildings
            // carve out the volumetric light.
            // ----------------------------------------------

            float visibility =
                shadowVisibility(
                    worldPos
                );


            // ----------------------------------------------
            // Beer-Lambert style extinction.
            // ----------------------------------------------

            float extinctionStep =
                density *
                extinction *
                stepLength *
                0.0025;

            transmittance *=
                exp(
                    -extinctionStep
                );


            // ----------------------------------------------
            // Scattering contribution.
            // ----------------------------------------------

            float scatterStep =
                density *
                stepLength *
                phase *
                directional *
                cameraFade *
                visibility;


            accumulated +=
                sunColor *
                scatterStep *
                transmittance;
        }


        // --------------------------------------------------------
        // Sun disc + subtle halo.
        //
        // The sun itself is small and intense. The atmosphere around
        // it is much softer.
        // --------------------------------------------------------

        float sunDistance =
            distance(
                vUv,
                lightPos
            );


        // Determine whether geometry occupies the sun's screen pixel.
        float sunDepthSample =
            texture2D(
                tSceneDepth,
                lightPos
            ).r;

        float sunSurfaceDepth =
            (
                sunDepthSample <
                0.999999
            )
            ?
            linearizeDepth(
                sunDepthSample
            )
            :
            1000000.0;


        float sunBlocked =
            1.0 -
            smoothstep(
                0.0,
                6.0,
                sunViewDepth -
                sunSurfaceDepth
            );


        // Tiny high-energy sun disc.
        float sunDisk =
            smoothstep(
                0.010,
                0.0,
                sunDistance
            ) *
            sunDiscStrength *
            sunVisible *
            (
                1.0 -
                sunBlocked
            );


        // Soft atmospheric glow.
        float sunHalo =
            exp(
                -sunDistance *
                sunDistance *
                80.0
            ) *
            sunHaloStrength *
            sunVisible *
            (
                1.0 -
                0.65 *
                sunBlocked
            );


        accumulated +=
            sunColor *
            (
                sunDisk +
                sunHalo
            );


        // --------------------------------------------------------
        // Final exposure.
        // --------------------------------------------------------

        accumulated *=
            exposure;


        gl_FragColor =
            vec4(
                sceneColor +
                accumulated,
                1.0
            );
    }
`;


// ============================================================
// MATERIAL HELPERS
// ============================================================

function copyAlphaState(
    source,
    target
) {

    if (
        !source ||
        !target
    ) {
        return;
    }

    if (source.map) {
        target.map =
            source.map;
    }

    if (source.alphaMap) {
        target.alphaMap =
            source.alphaMap;
    }

    target.alphaTest =
        Math.max(
            Number.isFinite(
                source.alphaTest
            )
                ? source.alphaTest
                : 0,

            source.alphaMap ||
            source.map
                ? 0.1
                : 0
        );


    if ('side' in source) {
        target.side =
            source.side;
    }


    if ('skinning' in source) {
        target.skinning =
            source.skinning;
    }


    if ('morphTargets' in source) {
        target.morphTargets =
            source.morphTargets;
    }


    if ('morphNormals' in source) {
        target.morphNormals =
            source.morphNormals;
    }


    target.needsUpdate =
        true;
}


function makePackedDepthMaterial(
    source
) {

    const material =
        new THREE.MeshDepthMaterial({

            depthPacking:
                THREE.RGBADepthPacking,

            side:
                source.side ??
                THREE.FrontSide,

            alphaTest:
                0
        });


    copyAlphaState(
        source,
        material
    );


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

            shadowMapSize = 1024,

            shadowWorldSize = 160,

            maxDistance = 120,

            atmosphereDensity = 0.09,

            atmosphereHeight = 60,

            atmosphereBase = 0,

            scattering = 0.42,

            anisotropy = 0.72,

            extinction = 0.7,

            shadowBias = 0.0012,

            exposure = 0.75,

            sunDiscStrength = 7.0,

            sunHaloStrength = 1.3,

            sunColor = 0xfff2d5,

            autoCreateShadowCamera = true

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

        this.shadowMapSize =
            shadowMapSize;

        this.shadowWorldSize =
            shadowWorldSize;


        // Public compatibility.
        this.sunWorldPosition =
            new THREE.Vector3();

        this.intensity =
            0;


        this._frame =
            0;

        this._time =
            0;

        this._autoCreateShadowCamera =
            autoCreateShadowCamera;


        this.sunColor =
            new THREE.Color(
                sunColor
            );


        // ----------------------------------------------------
        // Resolution.
        // ----------------------------------------------------

        const size =
            renderer.getSize(
                new THREE.Vector2()
            );


        const w =
            Math.max(
                1,
                Math.floor(
                    size.x *
                    occlusionScale
                )
            );


        const h =
            Math.max(
                1,
                Math.floor(
                    size.y *
                    occlusionScale
                )
            );


        // ----------------------------------------------------
        // Camera depth target.
        // ----------------------------------------------------

        this.depthTarget =
            new THREE.WebGLRenderTarget(
                w,
                h,
                {

                    minFilter:
                        THREE.NearestFilter,

                    magFilter:
                        THREE.NearestFilter,

                    format:
                        THREE.RGBAFormat,

                    depthBuffer:
                        true,

                    stencilBuffer:
                        false
                }
            );


        this.depthTarget.depthTexture =
            new THREE.DepthTexture(
                w,
                h
            );


        this.depthTarget.depthTexture.type =
            THREE.UnsignedIntType;


        this.depthTarget.depthTexture.format =
            THREE.DepthFormat;


        // ----------------------------------------------------
        // Sun-space packed depth.
        // ----------------------------------------------------

        this.sunDepthTarget =
            new THREE.WebGLRenderTarget(

                shadowMapSize,
                shadowMapSize,

                {

                    minFilter:
                        THREE.LinearFilter,

                    magFilter:
                        THREE.LinearFilter,

                    format:
                        THREE.RGBAFormat,

                    depthBuffer:
                        true,

                    stencilBuffer:
                        false
                }
            );


        this.depthMaterialCache =
            new WeakMap();


        this.depthRestore =
            [];


        // ----------------------------------------------------
        // Dedicated orthographic sun camera.
        // ----------------------------------------------------

        this.sunShadowCamera =
            new THREE.OrthographicCamera(

                -shadowWorldSize * 0.5,

                shadowWorldSize * 0.5,

                shadowWorldSize * 0.5,

                -shadowWorldSize * 0.5,

                0.5,

                maxDistance * 2.5
            );


        this.sunMatrix =
            new THREE.Matrix4();


        this.sunViewDepth =
            100000;


        this._sunDir =
            new THREE.Vector3(
                0,
                1,
                0
            );


        this._sunTarget =
            new THREE.Vector3();


        this._tmp =
            new THREE.Vector3();


        this._tmp2 =
            new THREE.Vector3();


        this._tmpColor =
            new THREE.Color();


        // ----------------------------------------------------
        // Empty scene retained for extension compatibility.
        // ----------------------------------------------------

        this.sunProxyScene =
            new THREE.Scene();


        // ----------------------------------------------------
        // Shader uniforms.
        // ----------------------------------------------------

        this.uniforms = {

            tDiffuse: {
                value:
                    null
            },


            tSceneDepth: {
                value:
                    this.depthTarget.depthTexture
            },


            tSunDepth: {
                value:
                    this.sunDepthTarget.texture
            },


            lightPos: {
                value:
                    new THREE.Vector2(
                        0.5,
                        0.5
                    )
            },


            sunViewDepth: {
                value:
                    this.sunViewDepth
            },


            sunVisible: {
                value:
                    0
            },


            cameraInvProjection: {
                value:
                    camera
                        .projectionMatrixInverse
                        .clone()
            },


            cameraMatrixWorld: {
                value:
                    camera
                        .matrixWorld
                        .clone()
            },


            sunMatrix: {
                value:
                    this.sunMatrix
            },


            cameraPositionWorld: {
                value:
                    camera
                        .position
                        .clone()
            },


            sunDirection: {
                value:
                    this._sunDir
                        .clone()
            },


            sunColor: {
                value:
                    this.sunColor
                        .clone()
            },


            cameraNear: {
                value:
                    camera.near
            },


            cameraFar: {
                value:
                    camera.far
            },


            maxDistance: {
                value:
                    maxDistance
            },


            atmosphereDensity: {
                value:
                    atmosphereDensity
            },


            atmosphereHeight: {
                value:
                    atmosphereHeight
            },


            atmosphereBase: {
                value:
                    atmosphereBase
            },


            scattering: {
                value:
                    scattering
            },


            anisotropy: {
                value:
                    anisotropy
            },


            extinction: {
                value:
                    extinction
            },


            shadowBias: {
                value:
                    shadowBias
            },


            shadowTexelSize: {
                value:
                    new THREE.Vector2(
                        1 /
                        shadowMapSize,

                        1 /
                        shadowMapSize
                    )
            },


            time: {
                value:
                    0
            },


            exposure: {
                value:
                    exposure
            },


            sunDiscStrength: {
                value:
                    sunDiscStrength
            },


            sunHaloStrength: {
                value:
                    sunHaloStrength
            }
        };


        // ----------------------------------------------------
        // Fullscreen shader material.
        // ----------------------------------------------------

        this.material =
            new THREE.ShaderMaterial({

                uniforms:
                    this.uniforms,

                vertexShader:
                    VERTEX,

                fragmentShader:
                    FRAGMENT,

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
    // Runtime atmosphere control.
    // ========================================================

    setAtmosphere(
        options = {}
    ) {

        const map = [

            [
                'atmosphereDensity',
                'atmosphereDensity'
            ],

            [
                'atmosphereHeight',
                'atmosphereHeight'
            ],

            [
                'atmosphereBase',
                'atmosphereBase'
            ],

            [
                'scattering',
                'scattering'
            ],

            [
                'anisotropy',
                'anisotropy'
            ],

            [
                'extinction',
                'extinction'
            ],

            [
                'maxDistance',
                'maxDistance'
            ],

            [
                'exposure',
                'exposure'
            ],

            [
                'sunDiscStrength',
                'sunDiscStrength'
            ],

            [
                'sunHaloStrength',
                'sunHaloStrength'
            ]
        ];


        for (
            const [
                key,
                uniform
            ]
            of map
        ) {

            if (
                Number.isFinite(
                    options[key]
                )
            ) {

                this.uniforms[
                    uniform
                ].value =
                    options[key];
            }
        }


        if (
            options.sunColor !==
            undefined
        ) {

            this.sunColor.set(
                options.sunColor
            );


            this.uniforms
                .sunColor
                .value
                .copy(
                    this.sunColor
                );
        }
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


        this.depthTarget.setSize(
            w,
            h
        );


        this.depthTarget
            .depthTexture
            .image.width =
                w;


        this.depthTarget
            .depthTexture
            .image.height =
                h;
    }


    // ========================================================
    // Material cache.
    // ========================================================

    _getDepthMaterial(
        source
    ) {

        let material =
            this.depthMaterialCache.get(
                source
            );


        if (!material) {

            material =
                makePackedDepthMaterial(
                    source
                );


            this.depthMaterialCache.set(
                source,
                material
            );
        }


        return material;
    }


    // ========================================================
    // Temporarily replace scene materials with depth materials.
    // ========================================================

    _swapToDepthMaterials() {

        this.depthRestore.length =
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


                this.depthRestore.push(
                    [
                        object,
                        original,
                        object.visible
                    ]
                );


                if (
                    Array.isArray(
                        original
                    )
                ) {

                    object.material =
                        original.map(
                            (m) => {

                                if (!m) {
                                    return null;
                                }


                                if (
                                    m.transparent &&
                                    !m.alphaMap &&
                                    !m.map &&
                                    m.alphaTest <= 0
                                ) {

                                    return null;
                                }


                                return this
                                    ._getDepthMaterial(
                                        m
                                    );
                            }
                        );

                } else {

                    if (
                        original.transparent &&
                        !original.alphaMap &&
                        !original.map &&
                        original.alphaTest <= 0
                    ) {

                        object.visible =
                            false;

                    } else {

                        object.material =
                            this._getDepthMaterial(
                                original
                            );
                    }
                }
            }
        );
    }


    // ========================================================
    // Restore original materials.
    // ========================================================

    _restoreDepthMaterials() {

        for (
            let i =
                this.depthRestore.length - 1;

            i >= 0;

            i--
        ) {

            const [
                object,
                material,
                visible
            ] =
                this.depthRestore[i];


            object.material =
                material;


            object.visible =
                visible;
        }


        this.depthRestore.length =
            0;
    }


    // ========================================================
    // Calculate sun direction + sun camera.
    // ========================================================

    _updateSunFrame() {

        this._tmp
            .copy(
                this.sunWorldPosition
            )
            .sub(
                this.camera.position
            );


        const sunDistance =
            this._tmp.length();


        if (
            sunDistance <
            0.0001
        ) {

            this._sunDir.set(
                0,
                1,
                0
            );

        } else {

            this._sunDir
                .copy(
                    this._tmp
                )
                .multiplyScalar(
                    -1 /
                    sunDistance
                );
        }


        // Direction sunlight travels.
        this._sunDir
            .copy(
                this.sunWorldPosition
            )
            .sub(
                this.camera.position
            )
            .normalize();


        this.uniforms
            .sunDirection
            .value
            .copy(
                this._sunDir
            );


        // ----------------------------------------------------
        // Position the sun camera behind the camera view.
        // ----------------------------------------------------

        this.sunShadowCamera.position
            .copy(
                this.camera.position
            )
            .addScaledVector(
                this._sunDir,
                this.shadowWorldSize *
                0.9
            );


        this._sunTarget
            .copy(
                this.camera.position
            );


        this.sunShadowCamera.lookAt(
            this._sunTarget
        );


        this.sunShadowCamera
            .updateMatrixWorld(
                true
            );


        this.sunShadowCamera
            .updateProjectionMatrix();


        // ----------------------------------------------------
        // World -> sun clip transform.
        // ----------------------------------------------------

        this.sunMatrix
            .copy(
                this.sunShadowCamera
                    .projectionMatrix
            )
            .multiply(
                this.sunShadowCamera
                    .matrixWorldInverse
            );


        this.uniforms
            .sunMatrix
            .value
            .copy(
                this.sunMatrix
            );


        // ----------------------------------------------------
        // Sun depth in main camera.
        // ----------------------------------------------------

        const sunView =
            this.sunWorldPosition
                .clone()
                .applyMatrix4(
                    this.camera
                        .matrixWorldInverse
                );


        this.sunViewDepth =
            Math.max(
                -sunView.z,
                this.camera.near
            );


        this.uniforms
            .sunViewDepth
            .value =
                this.sunViewDepth;


        // ----------------------------------------------------
        // Project sun into main screen.
        // ----------------------------------------------------

        const ndc =
            this._tmp2
                .copy(
                    this.sunWorldPosition
                )
                .project(
                    this.camera
                );


        const visible =
            this.intensity >
                0.0001 &&

            ndc.z > -1.0 &&
            ndc.z < 1.0 &&

            ndc.x > -1.25 &&
            ndc.x < 1.25 &&

            ndc.y > -1.25 &&
            ndc.y < 1.25;


        if (!visible) {

            this.uniforms
                .sunVisible
                .value =
                    0;

            return false;
        }


        this.uniforms
            .lightPos
            .value
            .set(
                (ndc.x + 1) * 0.5,
                (ndc.y + 1) * 0.5
            );


        this.uniforms
            .sunVisible
            .value =
                THREE.MathUtils.clamp(
                    this.intensity,
                    0,
                    1
                );


        return true;
    }


    // ========================================================
    // Camera depth pass.
    // ========================================================

    _renderDepth(
        renderer
    ) {

        const previousTarget =
            renderer.getRenderTarget();


        const previousClearColor =
            renderer
                .getClearColor(
                    this._tmpColor
                )
                .clone();


        const previousClearAlpha =
            renderer.getClearAlpha();


        const previousAutoClear =
            renderer.autoClear;


        const previousOverride =
            this.scene.overrideMaterial;


        try {

            renderer.setRenderTarget(
                this.depthTarget
            );


            renderer.setClearColor(
                0x000000,
                1
            );


            renderer.autoClear =
                true;


            this._swapToDepthMaterials();


            renderer.render(
                this.scene,
                this.camera
            );

        } finally {

            this._restoreDepthMaterials();


            this.scene.overrideMaterial =
                previousOverride;


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
    // Sun depth pass.
    // ========================================================

    _renderSunDepth(
        renderer
    ) {

        const previousTarget =
            renderer.getRenderTarget();


        const previousClearColor =
            renderer
                .getClearColor(
                    this._tmpColor
                )
                .clone();


        const previousClearAlpha =
            renderer.getClearAlpha();


        const previousAutoClear =
            renderer.autoClear;


        const previousOverride =
            this.scene.overrideMaterial;


        try {

            renderer.setRenderTarget(
                this.sunDepthTarget
            );


            renderer.setClearColor(
                0xffffff,
                1
            );


            renderer.autoClear =
                true;


            this._swapToDepthMaterials();


            renderer.render(
                this.scene,
                this.sunShadowCamera
            );

        } finally {

            this._restoreDepthMaterials();


            this.scene.overrideMaterial =
                previousOverride;


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
    // Main pass render.
    // ========================================================

    render(
        renderer,
        writeBuffer,
        readBuffer,
        deltaTime = 0.016
    ) {

        this._frame++;


        this._time +=
            Number.isFinite(
                deltaTime
            )
                ? deltaTime
                : 0.016;


        this.uniforms
            .time
            .value =
                this._time;


        const sunInView =
            this._updateSunFrame();


        this.uniforms
            .tDiffuse
            .value =
                readBuffer.texture;


        this.uniforms
            .cameraInvProjection
            .value
            .copy(
                this.camera
                    .projectionMatrixInverse
            );


        this.uniforms
            .cameraMatrixWorld
            .value
            .copy(
                this.camera
                    .matrixWorld
            );


        this.uniforms
            .cameraNear
            .value =
                this.camera.near;


        this.uniforms
            .cameraFar
            .value =
                this.camera.far;


        this.uniforms
            .cameraPositionWorld
            .value
            .copy(
                this.camera
                    .position
            );


        // ----------------------------------------------------
        // Only generate expensive depth passes while the sun
        // is actually useful to the current view.
        // ----------------------------------------------------

        if (
            sunInView &&
            this.intensity >
                0.001
        ) {

            this._renderDepth(
                renderer
            );


            this._renderSunDepth(
                renderer
            );

        } else {

            this.uniforms
                .sunVisible
                .value =
                    0;
        }


        const previousTarget =
            renderer.getRenderTarget();


        try {

            renderer.setRenderTarget(
                this.renderToScreen
                    ? null
                    : writeBuffer
            );


            this.fsQuad.render(
                renderer
            );

        } finally {

            renderer.setRenderTarget(
                previousTarget
            );
        }
    }


    // ========================================================
    // Cleanup.
    // ========================================================

    dispose() {

        this.depthTarget.dispose();

        this.sunDepthTarget.dispose();

        this.material.dispose();

        this.fsQuad.dispose();

        // WeakMaps do not expose their stored values, so the cached
        // materials are intentionally left to garbage collection along
        // with the source material references.
        this.depthMaterialCache =
            new WeakMap();
    }
}


// ============================================================
// Factory.
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
// OPTIONAL REAL SUN LIGHTING
//
// God rays affect the atmosphere.
// This helper handles the other half:
//
//       SUNLIGHT -> ACTUAL OBJECTS
//
// DirectionalLight + shadow map gives the forest genuine sun-facing
// illumination and tree shadows.
// ============================================================

export function setupSunLighting(
    scene,
    {
        color = 0xfff0d0,

        intensity = 3.0,

        distance = 250,

        shadowMapSize = 2048,

        shadowRange = 90,

        shadowNear = 1,

        shadowFar = 260,

        bias = -0.00015,

        normalBias = 0.02

    } = {}
) {

    const sun =
        new THREE.DirectionalLight(
            color,
            intensity
        );


    sun.castShadow =
        true;


    // --------------------------------------------------------
    // Shadow resolution.
    // --------------------------------------------------------

    sun.shadow.mapSize.set(
        shadowMapSize,
        shadowMapSize
    );


    // --------------------------------------------------------
    // Shadow camera coverage.
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // Reduce shadow acne.
    // --------------------------------------------------------

    sun.shadow.bias =
        bias;


    sun.shadow.normalBias =
        normalBias;


    scene.add(
        sun
    );


    scene.add(
        sun.target
    );


    // DirectionalLight doesn't use distance for attenuation.
    void distance;


    return sun;
}


// ============================================================
// Update real sunlight each frame.
// ============================================================

export function updateSunLighting(
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