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

    const cloudGeo = new THREE.SphereGeometry(1100, 64, 32);
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
                for(int i=0; i<4; i++) {
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
                float lo = mix(0.55, 0.05, uCoverage);
                float hi = mix(0.88, 0.55, uCoverage);
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

    // Create Stars
    const starGeo = new THREE.BufferGeometry();
    const starCount = 4000;
    const starPos = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    for(let i=0; i<starCount; i++) {
        const r = 1000 + Math.random() * 200;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        starPos[i*3] = r * Math.sin(phi) * Math.cos(theta);
        starPos[i*3+1] = Math.abs(r * Math.cos(phi)); // Keep stars mostly in upper hemisphere
        starPos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
        starSizes[i] = Math.random();
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
    
    state.starMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.0 } },
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        vertexShader: `
            uniform float uTime;
            attribute float aSize;
            varying float vAlpha;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = min((1.0 + aSize * 2.0) * (300.0 / -mvPosition.z), 3.0);
                vAlpha = 0.5 + 0.5 * sin(uTime * (1.0 + aSize * 2.0) + position.x * 0.1);
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            varying float vAlpha;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                // Color/alpha deliberately capped below ~0.8 luminance —
                // pure white (1,1,1) at high alpha was crossing
                // UnrealBloomPass's 0.88 threshold (main.js), and at
                // half-resolution bloom a 1-3px bright point blurs out
                // into the big soft round blobs this was causing across
                // the night sky instead of reading as crisp pinpoint
                // stars. Slightly warm-white (not pure 1,1,1) so dimmed
                // stars still read as starlight, not gray.
                float b = (0.5 - dist) * 2.0 * vAlpha * uOpacity;
                gl_FragColor = vec4(0.82, 0.85, 0.92, b * 0.75);
            }
        `
    });
    state.starMesh = new THREE.Points(starGeo, state.starMat);
    state.starMesh.layers.enable(BACKGROUND_LAYER);
    state.scene.add(state.starMesh);
}

