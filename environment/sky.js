import * as THREE from 'three';
import { state } from '../core/state.js';

import { rngFor } from '../core/rng.js';
const rand = rngFor('sky');
export function createSky() {
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
    state.scene.add(new THREE.Mesh(skyGeo, state.skyMat));

    const cloudGeo = new THREE.SphereGeometry(1100, 64, 32);
    state.cloudMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            cloudColor: { value: new THREE.Color(0xffffff) },
            opacity: { value: 1.0 },
            // B-30 fix: cloud COLOR was tracking weather (tints grey as
            // currentRainIntensity rises, see day-night-cycle.js) but
            // cloud COVERAGE never did — the fbm density threshold below
            // was a fixed smoothstep(0.2, 0.8, n) regardless of weather,
            // so "clear skies" rendered the exact same full sky-covering
            // cloud layer as "heavy rain", just recolored lighter. That's
            // why it always read as overcast/rainy even when the HUD said
            // clear. uCoverage (0 = clear, 1 = storm) is now driven by
            // state.currentRainIntensity every frame and widens/narrows
            // the noise band that counts as "cloud" — clear skies keep
            // only the noise peaks (sparse, gappy puffs), storms keep
            // almost the whole band (solid overcast).
            uCoverage: { value: 0.0 },
            // Lightning flash brightness, 0..1, driven per-frame by
            // fx/lightning.js — lets the clouds themselves flash white
            // from within rather than only a screen overlay doing it.
            uFlash: { value: 0.0 }
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
            uniform float uFlash;
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
                if (dir.y < -0.1) discard; 
                float n = fbm(dir * 5.0 + vec3(uTime * 0.01, 0.0, uTime * 0.008));
                // Clear (uCoverage=0): only the top ~20% of the noise range
                // counts as cloud — a few sparse, gappy puffs, mostly open
                // sky. Storm (uCoverage=1): almost the whole range counts —
                // solid overcast with barely any gaps.
                float edge0 = mix(0.68, 0.05, uCoverage);
                float edge1 = mix(0.92, 0.55, uCoverage);
                float density = smoothstep(edge0, edge1, n);
                density *= smoothstep(-0.1, 0.2, dir.y);
                // Clear-sky puffs also read thinner/wispier, not just
                // sparser — a solid-alpha sparse cloud still looks like a
                // storm cloud that's merely small. Storms stay near-opaque.
                float alphaMul = mix(0.5, 0.92, uCoverage);
                // Lightning: the cloud mass itself lights up white from
                // within, and briefly becomes more opaque/solid-reading —
                // a dark storm cloud lit by a strike doesn't just get
                // brighter, it briefly reads as a bright silhouette.
                vec3 litColor = mix(cloudColor, vec3(1.0), uFlash * 0.9);
                float litAlpha = mix(density * opacity * alphaMul, max(density, 0.6), uFlash);
                gl_FragColor = vec4(litColor, litAlpha);
            }
        `
    });
    state.cloudMesh = new THREE.Mesh(cloudGeo, state.cloudMat);
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
    state.scene.add(state.moonSprite);

    // Create Stars
    const starGeo = new THREE.BufferGeometry();
    const starCount = 4000;
    const starPos = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    for(let i=0; i<starCount; i++) {
        const r = 1000 + rand() * 200;
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos((rand() * 2) - 1);
        starPos[i*3] = r * Math.sin(phi) * Math.cos(theta);
        starPos[i*3+1] = Math.abs(r * Math.cos(phi)); // Keep stars mostly in upper hemisphere
        starPos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
        starSizes[i] = rand();
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
                gl_PointSize = min((1.0 + aSize * 2.0) * (300.0 / -mvPosition.z), 6.0);
                vAlpha = 0.5 + 0.5 * sin(uTime * (1.0 + aSize * 2.0) + position.x * 0.1);
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            varying float vAlpha;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                gl_FragColor = vec4(1.0, 1.0, 1.0, (0.5 - dist) * 2.0 * vAlpha * uOpacity);
            }
        `
    });
    state.starMesh = new THREE.Points(starGeo, state.starMat);
    state.scene.add(state.starMesh);
}

