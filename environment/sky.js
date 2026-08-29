// Sky dome, sun/moon sprite + star field, cloud shell.
// Reads state.globalTextures.moonTex (set up in fx/textures.js) and writes
// state.skyMat / state.moonSprite / state.cloudMesh / state.cloudMat /
// state.starMesh / state.starMat for atmosphere/day-night-cycle.js to drive
// per-frame.

import * as THREE from 'three';
import { BACKGROUND_LAYER } from '../fx/dynamic-fog.js';

export function createSky(state) {
    const skyGeo = new THREE.SphereGeometry(1200, 32, 32);
    state.skyMat = new THREE.ShaderMaterial({
        uniforms: {
            topColor: { value: new THREE.Color(0x0077ff) },
            bottomColor: { value: new THREE.Color(0xffffff) },
            offset: { value: 33 },
            exponent: { value: 0.6 }
        },
        vertexShader: `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
            }
        `,
        fragmentShader: `
            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform float offset;
            uniform float exponent;
            varying vec3 vWorldPosition;
            void main() {
                float h = normalize( vWorldPosition + offset ).y;
                gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h , 0.0), exponent ), 0.0 ) ), 1.0 );
            }
        `,
        side: THREE.BackSide,
        depthWrite: false
    });
    const skyMesh = new THREE.Mesh(skyGeo, state.skyMat);
    skyMesh.layers.enable(BACKGROUND_LAYER); // part of the backdrop other materials fog toward, see fx/dynamic-fog.js
    state.scene.add(skyMesh);

    const cloudSegs = state.quality?.cloudSegments ?? 64;
    const cloudOctaves = state.quality?.cloudOctaves ?? 4;
    const cloudGeo = new THREE.SphereGeometry(1100, cloudSegs, Math.max(16, Math.round(cloudSegs / 2)));
    state.cloudMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            cloudColor: { value: new THREE.Color(0xffffff) },
            opacity: { value: 1.0 },
            // Drives actual coverage (gaps of open sky vs. solid overcast), not
            // just a flat transparency dim — see fragmentShader below. Set
            // per-frame from state.currentCloudiness in day-night-cycle.js.
            uCoverage: { value: 0.5 }
        },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        vertexShader: `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 cloudColor;
            uniform float opacity;
            uniform float uCoverage;
            varying vec3 vWorldPosition;

            float hash(vec3 p) {
                p = fract(p * vec3(443.897, 441.423, 437.195));
                p += dot(p, p.yxz + 19.19);
                return fract((p.x + p.y) * p.z);
            }
            float noise(vec3 x) {
                vec3 i = floor(x);
                vec3 f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                               mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                           mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                               mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
            }
            float fbm(vec3 p) {
                float f = 0.0;
                float amp = 0.5;
                // Octave count now comes from state.quality.cloudOctaves
                // (core/quality.js already defined this per-tier — High 4,
                // Medium 3, Low 2 — but this shader ignored it and always
                // ran the full 4-octave loop regardless of quality preset,
                // on every fragment across the whole visible cloud dome).
                // Baked in as a compile-time constant here (not a uniform
                // loop bound) since some mobile GLSL ES compilers require
                // for-loop trip counts to be constant expressions.
                for(int i=0; i<${cloudOctaves}; i++) {
                    f += amp * noise(p);
                    p *= 2.0;
                    amp *= 0.5;
                }
                return f;
            }

            void main() {
                vec3 dir = normalize(vWorldPosition);
                // Was -0.1 (clouds reaching almost to the horizon) with the
                // density ramp fully opening back up by dir.y 0.2 — barely
                // ~11 degrees of sky. fx/dynamic-fog.js samples this same
                // BACKGROUND_LAYER texture at each ground fragment's own
                // screen position, so cloud pixels sitting that low ended up
                // literally painted into the terrain/forest fog blend near
                // the horizon — reading as clouds bleeding into the ground
                // instead of sky. Lifted clear of the horizon band so
                // there's a clean gap of open sky for the fog to sample
                // there instead.
                if (dir.y < 0.12) discard;
                float n = fbm(dir * 5.0 + vec3(uTime * 0.01, 0.0, uTime * 0.008));
                // uCoverage shifts the threshold band itself, not just a final
                // opacity multiply — at low coverage only the highest noise
                // peaks pass, reading as scattered wisps with real gaps of open
                // sky between them; at high coverage almost the whole band
                // passes, reading as solid overcast.
                // Raised the clear-sky end of this range (was 0.55/0.88) —
                // fbm's noise centers around ~0.5, so a 0.55 threshold at
                // uCoverage=0 still let a big chunk of the dome pass as
                // cloud even on a nominally "clear" day. 0.78 leaves only
                // the actual noise peaks visible as scattered wisps.
                float lo = mix(0.78, 0.05, uCoverage);
                float hi = mix(0.96, 0.55, uCoverage);
                float density = smoothstep(lo, hi, n);
                density *= smoothstep(0.12, 0.4, dir.y);
                gl_FragColor = vec4(cloudColor, density * opacity * 0.9);
            }
        `
    });
    state.cloudMesh = new THREE.Mesh(cloudGeo, state.cloudMat);
    state.cloudMesh.layers.enable(BACKGROUND_LAYER);
    state.scene.add(state.cloudMesh);

    const moonMat = new THREE.SpriteMaterial({
        map: state.globalTextures.moon,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    state.moonSprite = new THREE.Sprite(moonMat);
    state.moonSprite.scale.set(160, 160, 1);
    state.moonSprite.layers.enable(BACKGROUND_LAYER);
    state.scene.add(state.moonSprite);

    // Moon glow halo — a separate, larger, softer sprite behind the moon
    // disc (see fx/textures.js's moonGlow texture for why this needs to be
    // its own sprite rather than baked into the moon texture itself: the
    // moon disc stays crisp-edged, only the glow around it blooms outward).
    // Position/opacity driven per-frame in atmosphere/day-night-cycle.js,
    // same as the moon sprite it tracks.
    const moonGlowMat = new THREE.SpriteMaterial({
        map: state.globalTextures.moonGlow,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    state.moonGlowSprite = new THREE.Sprite(moonGlowMat);
    state.moonGlowSprite.scale.set(520, 520, 1);
    state.moonGlowSprite.layers.enable(BACKGROUND_LAYER);
    state.scene.add(state.moonGlowSprite);

    // Sun sprite — same treatment as the moon (billboard following the
    // directional light), but its opacity is driven per-frame by cloud
    // cover in atmosphere/day-night-cycle.js so it visibly vanishes behind
    // overcast/storm skies rather than the sky just always reading as hazy
    // with no actual sun in it.
    const sunMat = new THREE.SpriteMaterial({
        map: state.globalTextures.sun,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    state.sunSprite = new THREE.Sprite(sunMat);
    state.sunSprite.scale.set(260, 260, 1);
    state.sunSprite.layers.enable(BACKGROUND_LAYER);
    state.scene.add(state.sunSprite);

    // Old sprite-based "sun-ray burst" billboard used to live here — see
    // fx/god-rays.js for why it was replaced with an actual screen-space
    // volumetric pass instead of continuing to patch a flat texture. The
    // sun disc above is unrelated and stays as-is.

    // Procedural Milky Way band — ported from cinematic_day_night_cycle.html's
    // galaxyFragmentShader (simplex-noise fbm dust band + dim core), just
    // gated behind BACKGROUND_LAYER like the rest of the sky dome so it
    // shows up in fx/dynamic-fog.js's captured backdrop too. Sits just
    // inside the sky dome (900 vs. 1200) and behind the star field.
    const galaxyGeo = new THREE.SphereGeometry(900, 32, 32);
    state.galaxyMat = new THREE.ShaderMaterial({
        uniforms: {
            uNightBlend: { value: 0.0 },
            uTime: { value: 0.0 }
        },
        vertexShader: `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uNightBlend;
            uniform float uTime;
            varying vec3 vWorldPosition;

            // Simplex 3D noise (Ashima Arts) — same as the reference draft.
            vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
            vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
            float snoise(vec3 v){
                const vec2  C = vec2(1.0/6.0, 1.0/3.0);
                const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
                vec3 i  = floor(v + dot(v, C.yyy));
                vec3 x0 = v - i + dot(i, C.xxx);
                vec3 g = step(x0.yzx, x0.xyz);
                vec3 l = 1.0 - g;
                vec3 i1 = min(g.xyz, l.zxy);
                vec3 i2 = max(g.xyz, l.zxy);
                vec3 x1 = x0 - i1 + 1.0 * C.xxx;
                vec3 x2 = x0 - i2 + 2.0 * C.xxx;
                vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
                i = mod(i, 289.0);
                vec4 p = permute(permute(permute(
                            i.z + vec4(0.0, i1.z, i2.z, 1.0))
                          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
                float n_ = 1.0/7.0;
                vec3  ns = n_ * D.wyz - D.xzx;
                vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                vec4 x_ = floor(j * ns.z);
                vec4 y_ = floor(j - 7.0 * x_);
                vec4 x = x_ * ns.x + ns.yyyy;
                vec4 y = y_ * ns.x + ns.yyyy;
                vec4 h = 1.0 - abs(x) - abs(y);
                vec4 b0 = vec4(x.xy, y.xy);
                vec4 b1 = vec4(x.zw, y.zw);
                vec4 s0 = floor(b0) * 2.0 + 1.0;
                vec4 s1 = floor(b1) * 2.0 + 1.0;
                vec4 sh = -step(h, vec4(0.0));
                vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
                vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
                vec3 p0 = vec3(a0.xy, h.x);
                vec3 p1 = vec3(a0.zw, h.y);
                vec3 p2 = vec3(a1.xy, h.z);
                vec3 p3 = vec3(a1.zw, h.w);
                vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
                p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                m = m * m;
                return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
            }
            float fbm(vec3 x) {
                float v = 0.0; float a = 0.5; vec3 shift = vec3(100.0);
                for (int i = 0; i < 5; ++i) { v += a * snoise(x); x = x * 2.0 + shift; a *= 0.5; }
                return v;
            }

            void main() {
                vec3 dir = normalize(vWorldPosition);
                float bandPos = abs(dir.y * 0.8 + dir.x * 0.5);
                float bandMask = smoothstep(0.5, 0.0, bandPos);
                float corePos = length(vec2(dir.y * 0.8 + dir.x * 0.5, dir.z - 0.3));
                float coreMask = smoothstep(0.8, 0.0, corePos);

                float structure = fbm(dir * 3.0) * 0.5 + 0.5;
                float details = fbm(dir * 12.0) * 0.5 + 0.5;
                float darkLanes = fbm(dir * 4.0 + vec3(12.3, 4.5, 6.7)) * 0.5 + 0.5;

                float starLayer = snoise(dir * 200.0);
                starLayer = smoothstep(0.85, 1.0, starLayer);
                float blinkPhase = snoise(dir * 10.0) * 10.0;
                float blink = sin(uTime * 2.0 + blinkPhase) * 0.5 + 0.5;

                float dust = bandMask * structure;
                dust = dust * smoothstep(0.3, 0.8, darkLanes);
                dust += bandMask * details * 0.15;
                dust += bandMask * starLayer * blink * 0.6;
                dust += coreMask * structure * 0.4;
                dust = pow(dust, 2.8);

                vec3 colorDark = vec3(0.015, 0.015, 0.03);
                vec3 colorEdge = vec3(0.04, 0.04, 0.08);
                vec3 colorMid  = vec3(0.06, 0.08, 0.12);
                vec3 colorCore = vec3(0.1, 0.12, 0.15);

                vec3 finalColor = mix(colorDark, colorEdge, smoothstep(0.0, 0.1, dust));
                finalColor = mix(finalColor, colorMid, smoothstep(0.1, 0.4, dust));
                finalColor = mix(finalColor, colorCore, smoothstep(0.4, 1.0, dust));

                float alpha = smoothstep(0.02, 0.8, dust) * uNightBlend * 0.25;
                gl_FragColor = vec4(finalColor, alpha);
            }
        `,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    state.galaxyMesh = new THREE.Mesh(galaxyGeo, state.galaxyMat);
    state.galaxyMesh.rotation.z = Math.PI / 6;
    state.galaxyMesh.rotation.x = Math.PI / 8;
    state.galaxyMesh.layers.enable(BACKGROUND_LAYER);
    state.scene.add(state.galaxyMesh);

    // Create Stars — reworked per cinematic_day_night_cycle.html: a steep
    // power-curve size distribution (mostly tiny points, a few large "hero"
    // stars) plus a softer/slower twinkle than before, tilted to match the
    // galaxy band above instead of scattered independently.
    const starGeo = new THREE.BufferGeometry();
    const starCount = 3000;
    const starPos = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    const starPhases = new Float32Array(starCount);
    for(let i=0; i<starCount; i++) {
        const r = 800;
        const theta = 2 * Math.PI * Math.random();
        const phi = Math.acos(2 * Math.random() - 1);
        let finalPhi = phi;
        if (Math.random() > 0.6) {
            const variance = (Math.random() - 0.5) * 2.0;
            finalPhi = (Math.PI / 2) + variance;
        }
        starPos[i*3] = r * Math.sin(finalPhi) * Math.cos(theta);
        starPos[i*3+1] = r * Math.sin(finalPhi) * Math.sin(theta);
        starPos[i*3+2] = r * Math.cos(finalPhi);
        const sizeBase = Math.pow(Math.random(), 6.0);
        starSizes[i] = sizeBase * 6.0 + 0.8;
        starPhases[i] = Math.random() * Math.PI * 2;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));

    state.starMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.0 } },
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        vertexShader: `
            attribute float aSize;
            attribute float aPhase;
            varying float vPhase;
            varying float vSize;
            void main() {
                vPhase = aPhase;
                vSize = aSize;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = min(aSize * (400.0 / -mvPosition.z), 5.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            varying float vPhase;
            varying float vSize;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;

                // Slower, gentler twinkle than the old per-star sin — reads
                // as atmospheric shimmer rather than flicker.
                float twinkle = sin(uTime * 1.0 + vPhase) * 0.2 + 0.8;

                // Color/alpha deliberately capped below ~0.8 luminance for
                // most stars — pure white at high alpha was crossing
                // UnrealBloomPass's 0.88 threshold (main.js) and blurring
                // into big soft blobs instead of crisp pinpoints. Larger
                // "hero" stars get a real brightness boost so a handful
                // still read as distinctly brighter, same as the reference.
                float brightnessMod = mix(0.75, 1.6, smoothstep(1.0, 6.0, vSize));
                float b = smoothstep(0.5, 0.1, dist) * twinkle * uOpacity;
                gl_FragColor = vec4(vec3(0.82, 0.85, 0.92) * brightnessMod, b * 0.75);
            }
        `
    });
    state.starMesh = new THREE.Points(starGeo, state.starMat);
    state.starMesh.rotation.z = Math.PI / 6;
    state.starMesh.rotation.x = Math.PI / 8;
    state.starMesh.layers.enable(BACKGROUND_LAYER);
    state.scene.add(state.starMesh);
}