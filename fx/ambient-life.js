// Ambient life + distant landmarks (Version 0.0.05, "the world feels empty").
//
// Research notes (Zelda BotW / Horizon / Genshin-style open worlds): the world
// feels full when (1) something readable is visible in most directions, from a
// distance (BotW: shrines glow, camps send up smoke, "wherever you look there
// should be something interesting"), and (2) the space BETWEEN landmarks is
// never static: birds overhead, insects in the grass, drifting motes.
//
// This file adds both, all stateless/GPU-driven so they cost almost nothing:
//   - SMOKE COLUMNS above inhabited POIs (cabin, the Warm Paw campfire): tall,
//     thin, visible over the treeline from the spawn beach => a breadcrumb.
//   - BIRD FLOCKS circling high above fixed world spots (daytime, hidden in rain).
//   - BUTTERFLIES that follow the player over the grass (daytime, dry weather).
// (Fireflies also used to be pinned near the world origin, i.e. nowhere near the
// player after the 4x scale-up; they now follow the player: see fireflies.js.)
import * as THREE from 'three';
import { state } from '../core/state.js';
import { heightAt } from '../core/heightmap.js';
import { POIS } from '../environment/pois.js';
import { getSpawn } from '../core/spawn.js';
import { rngFor } from '../core/rng.js';
const rand = rngFor('ambient-life');

const U = {
    uTime: { value: 0 },
    uHalfH: { value: 400 },          // half the drawing-buffer height: converts a world-size to a point size in px
    uDay: { value: 1 },              // 0 night .. 1 day
    uDry: { value: 1 },              // 1 clear .. 0 raining
    uGroundY: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uFogColor: { value: new THREE.Color(0x9fb0c4) },
    uFogDensity: { value: 0.0045 },
};

const smokes = [];

// ---------------------------------------------------------------- smoke
function makeSmoke(x, z, { height = 70, size = 5, count = 40, tint = 0x8a8478, base } = {}) {
    const y0 = base ?? heightAt(x, z) + 3;
    const seed = new Float32Array(count);
    const pos = new Float32Array(count * 3);        // all at the column base; the shader lifts them
    for (let i = 0; i < count; i++) seed[i] = i / count + rand() * 0.02;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y0 + height / 2, z), height + 40); // columns are shader-lifted; give culling a real sphere
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            ...U,
            uBase: { value: new THREE.Vector3(x, y0, z) },
            uHeight: { value: height }, uSize: { value: size },
            uTint: { value: new THREE.Color(tint) },
        },
        transparent: true, depthWrite: false,
        vertexShader: /* glsl */`
            uniform float uTime, uHalfH, uHeight, uSize, uFogDensity;
            uniform vec3 uBase, uCam;
            attribute float aSeed;
            varying float vAlpha, vFog;
            void main() {
                float age = fract(aSeed + uTime * 0.045);                  // 0 (hot, at the source) .. 1 (dissipated)
                vec3 p = uBase;
                p.y += age * uHeight;
                float wind = age * age * (uHeight * 0.35);                 // leans downwind as it rises
                p.x += wind + sin(uTime * 0.6 + aSeed * 40.0) * age * 3.0;
                p.z += wind * 0.35 + cos(uTime * 0.5 + aSeed * 31.0) * age * 3.0;
                vec4 mv = viewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                float worldSize = uSize * (0.6 + age * 2.2);               // puffs billow as they rise
                gl_PointSize = clamp(worldSize * projectionMatrix[1][1] * uHalfH / max(1.0, -mv.z), 1.0, 160.0);
                vAlpha = smoothstep(0.0, 0.06, age) * (1.0 - age * age) * 0.85;
                float d = length(p - uCam);
                vFog = 0.45 * (1.0 - exp(-pow(uFogDensity * d, 2.0)));   // landmarks punch through the fog on purpose
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 uTint, uFogColor;
            uniform float uDay;
            varying float vAlpha, vFog;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                if (d > 0.5) discard;
                float soft = smoothstep(0.5, 0.0, d);
                vec3 col = mix(uTint * (0.35 + 0.65 * uDay), uFogColor, vFog);
                gl_FragColor = vec4(col, soft * vAlpha * (1.0 - vFog * 0.6));
            }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = true;
    state.scene.add(pts);
    smokes.push(pts);
    return pts;
}

// ---------------------------------------------------------------- birds
let birdMesh = null;
function makeBirds() {
    const FLOCKS = 14, PER = 7, count = FLOCKS * PER;
    // body + two wings, ~1.1u across: reads as a "v" silhouette at distance
    const g = new THREE.BufferGeometry();
    const v = [0, 0, 0.5, -1.1, 0.1, -0.3, -0.1, 0, -0.2,   0, 0, 0.5, 1.1, 0.1, -0.3, 0.1, 0, -0.2];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    const ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute('position', g.attributes.position);
    const center = new Float32Array(count * 3), orbit = new Float32Array(count * 4);
    const sp = getSpawn();
    for (let f = 0; f < FLOCKS; f++) {
        // flock home: random land inside the island, plus a couple deliberately near the spawn/cabin side so the first minutes have life overhead
        let cx, cz;
        if (f < 3) { cx = sp.x + (rand() - 0.5) * 300; cz = sp.z + (rand() - 0.5) * 300; }
        else { const r = Math.sqrt(rand()) * 1250, th = rand() * Math.PI * 2; cx = Math.cos(th) * r; cz = Math.sin(th) * r; }
        const cy = heightAt(cx, cz) + 30 + rand() * 35, R = 25 + rand() * 45, spd = (0.12 + rand() * 0.1) * (rand() < 0.5 ? -1 : 1);
        for (let b = 0; b < PER; b++) {
            const i = f * PER + b;
            center.set([cx + (rand() - 0.5) * 14, cy + (rand() - 0.5) * 8, cz + (rand() - 0.5) * 14], i * 3);
            orbit.set([R + (rand() - 0.5) * 10, spd, rand() * Math.PI * 2, rand() * 6.28], i * 4);
        }
    }
    ig.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3));
    ig.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
    ig.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
        uniforms: { ...U }, side: THREE.DoubleSide, transparent: true, depthWrite: false,
        vertexShader: /* glsl */`
            uniform float uTime, uFogDensity;
            uniform vec3 uCam;
            attribute vec3 aCenter; attribute vec4 aOrbit;   // radius, angular speed, phase, flap phase
            varying float vFog;
            void main() {
                float a = uTime * aOrbit.y + aOrbit.z;
                vec3 c = aCenter + vec3(cos(a) * aOrbit.x, sin(uTime * 0.4 + aOrbit.w) * 2.0, sin(a) * aOrbit.x);
                vec3 f = normalize(vec3(-sin(a), 0.0, cos(a)) * sign(aOrbit.y));
                vec3 r = vec3(f.z, 0.0, -f.x);
                vec3 l = position * 3.2;
                l.y += abs(l.x) * sin(uTime * 9.0 + aOrbit.w * 3.0) * 0.5;    // wing flap
                vec3 p = c + r * l.x + vec3(0.0, 1.0, 0.0) * l.y + f * l.z;
                vec4 mv = viewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                vFog = 1.0 - exp(-pow(uFogDensity * length(p - uCam), 2.0));
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 uFogColor; uniform float uDay, uDry;
            varying float vFog;
            void main() { gl_FragColor = vec4(mix(vec3(0.05, 0.05, 0.06), uFogColor, vFog), uDay * uDry * (1.0 - vFog)); }`,
    });
    birdMesh = new THREE.Mesh(ig, mat);
    birdMesh.frustumCulled = false;
    state.scene.add(birdMesh);
}

// ---------------------------------------------------------------- butterflies
let butterflyMesh = null;
function makeButterflies() {
    const count = 70;
    const v = [0, 0, 0,  -0.28, 0.06, 0.2,  -0.26, 0.0, -0.18,    0, 0, 0,  0.28, 0.06, 0.2,  0.26, 0.0, -0.18];
    const ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    const seed = new Float32Array(count * 4), col = new Float32Array(count * 3);
    const palette = [[1.0, 0.75, 0.2], [0.95, 0.95, 0.9], [0.45, 0.65, 1.0], [1.0, 0.45, 0.25]];
    for (let i = 0; i < count; i++) {
        seed.set([rand() * 60 - 30, rand() * 60 - 30, rand() * 6.28, 0.6 + rand() * 0.9], i * 4);
        col.set(palette[i % palette.length], i * 3);
    }
    ig.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    ig.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    ig.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
        uniforms: { ...U }, side: THREE.DoubleSide, transparent: true, depthWrite: false,
        vertexShader: /* glsl */`
            uniform float uTime, uGroundY;
            uniform vec3 uCam;
            attribute vec4 aSeed; attribute vec3 aColor;       // x,z offset, phase, speed
            varying vec3 vCol; varying float vNear;
            void main() {
                float t = uTime * aSeed.w;
                const float SPREAD = 60.0;
                vec2 base = uCam.xz + mod(aSeed.xy - uCam.xz + SPREAD * 0.5, SPREAD) - SPREAD * 0.5;   // wraps around the player
                vec2 w = vec2(sin(t * 0.8 + aSeed.z) * 3.5 + sin(t * 2.1 + aSeed.z * 2.0), cos(t * 0.6 + aSeed.z * 1.3) * 3.5 + cos(t * 1.7 + aSeed.z));
                float yaw = t * 0.8 + aSeed.z;
                float ca = cos(yaw), sa = sin(yaw);
                vec3 l = position;
                l.y += abs(l.x) * sin(uTime * 16.0 + aSeed.z * 5.0) * 1.1;       // flap
                vec3 p = vec3(base.x + w.x, uGroundY + 1.1 + sin(t * 1.3 + aSeed.z) * 0.6, base.y + w.y)
                       + vec3(l.x * ca - l.z * sa, l.y, l.x * sa + l.z * ca);
                gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
                vCol = aColor;
                vNear = smoothstep(26.0, 14.0, length(p - uCam));                    // fade out at range
            }`,
        fragmentShader: /* glsl */`
            uniform float uDay, uDry;
            varying vec3 vCol; varying float vNear;
            void main() { gl_FragColor = vec4(vCol, vNear * uDay * uDry); }`,
    });
    butterflyMesh = new THREE.Mesh(ig, mat);
    butterflyMesh.frustumCulled = false;
    state.scene.add(butterflyMesh);
}

export function createAmbientLife() {
    // Smoke over places where someone lives: the cabin's chimney (the Act I destination, visible from the spawn beach) and the Warm Paw campfire.
    const cabin = POIS.find((p) => p.id === 'ruined_cabin');
    if (cabin) makeSmoke(cabin.x + 1.5, cabin.z + 1.5, { height: 90, size: 9, count: 56, tint: 0x6f685d });
    const paw = POIS.find((p) => p.id === 'warm_paw');
    if (paw) makeSmoke(paw.x, paw.z, { height: 75, size: 7, count: 46, tint: 0x6a645a });
    makeBirds();
    makeButterflies();
}

const _fog = new THREE.Color();
export function updateAmbientLife(deltaSec) {
    U.uTime.value += deltaSec;
    const cam = state.camera;
    if (!cam) return;
    U.uCam.value.copy(cam.position);
    U.uGroundY.value = heightAt(cam.position.x, cam.position.z);
    if (state.renderer) { const s = state.renderer.getDrawingBufferSize(_fogSize); U.uHalfH.value = s.y * 0.5; }
    if (state.scene && state.scene.fog) { U.uFogColor.value.copy(state.scene.fog.color); U.uFogDensity.value = state.scene.fog.density; }
    const sy = Math.sin(state.gameTime * Math.PI * 2 - Math.PI / 2);
    U.uDay.value = Math.max(0, Math.min(1, sy * 2.5 + 0.5));
    U.uDry.value = Math.max(0, 1 - state.currentRainIntensity * 2.5);
    const on = U.uDay.value * U.uDry.value > 0.02;
    if (birdMesh) birdMesh.visible = on;
    if (butterflyMesh) butterflyMesh.visible = on && U.uGroundY.value > 3.2;   // not over the sea / wet sand
}
const _fogSize = new THREE.Vector2();
