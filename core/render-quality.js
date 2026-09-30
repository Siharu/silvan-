// Live quality tiers (section 8.3) + player-following shadows (B-06/B-07)
// + optional adaptive resolution (8.4). Everything here can be re-applied
// at runtime — no reload needed except where noted.
import * as THREE from 'three';
import { state } from './state.js';
import { createGrass } from '../environment/grass.js';

export const QUALITY_PRESETS = {
    high:   { bladeCount: 580000, pixelRatio: 1.25, shadowMap: 2048, shadowRadius: 120, msaa: 4, bloom: true,  rainCount: 45000, fireflyCount: 1200, dustCount: 3500 },
    medium: { bladeCount: 360000, pixelRatio: 1.0,  shadowMap: 1024, shadowRadius: 100, msaa: 2, bloom: true,  rainCount: 20000, fireflyCount: 600,  dustCount: 2000 },
    low:    { bladeCount: 130000, pixelRatio: 0.85, shadowMap: 0,    shadowRadius: 60,  msaa: 0, bloom: false, rainCount: 8000,  fireflyCount: 300,  dustCount: 1000 },
};

let resScale = 1.0;             // adaptive multiplier on top of tier pixelRatio
let lastGrassCount = -1;

function effectivePixelRatio() {
    const q = state.quality;
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, q.pixelRatio) * resScale);
}

function applyPixelRatio() {
    const pr = effectivePixelRatio();
    state.renderer.setPixelRatio(pr);
    state.composer.setPixelRatio(pr);
    state.composer.setSize(window.innerWidth, window.innerHeight);
}

export function applyQuality(key) {
    const q = QUALITY_PRESETS[key] || QUALITY_PRESETS.medium;
    state.quality = q; state.qualityKey = key;
    if (!state.renderer) return; // before init(): settings.js just records the choice

    applyPixelRatio();

    // Shadows: 0 = off. Changing the map size needs the old map disposed.
    const sun = state.sunLight;
    if (q.shadowMap === 0) {
        sun.castShadow = false;
    } else {
        sun.castShadow = true;
        if (sun.shadow.mapSize.x !== q.shadowMap) {
            sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
            if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
        }
        const d = q.shadowRadius;
        Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 10, far: 1000 });
        sun.shadow.camera.updateProjectionMatrix();
    }

    if (state.bloomPass) state.bloomPass.enabled = q.bloom;

    // MSAA (B-14): changing sample count on a live render target needs a dispose so it is re-created.
    for (const rt of [state.composer.renderTarget1, state.composer.renderTarget2]) {
        if (rt.samples !== q.msaa) { rt.samples = q.msaa; rt.dispose(); }
    }

    // Particle budgets: draw ranges / instance counts, so it's instant.
    if (state.rainMesh) state.rainMesh.geometry.setDrawRange(0, Math.min(q.rainCount, state.rainMesh.geometry.attributes.position.count));
    if (state.dustMesh) state.dustMesh.geometry.setDrawRange(0, Math.min(q.dustCount, state.dustMesh.geometry.attributes.position.count));
    if (state.fireflyMesh) state.fireflyMesh.count = Math.min(q.fireflyCount, state.fireflyMesh.instanceMatrix.count);

    // Grass pool size is baked into the geometry: rebuild in place.
    if (state.grassMesh && lastGrassCount !== q.bladeCount) {
        state.scene.remove(state.grassMesh);
        state.grassMesh.geometry.dispose();
        state.grassMat.uniforms.uHeightMap.value.dispose();
        state.grassMat.dispose();
        state.grassMesh = state.grassMat = null;
        createGrass();
    }
    lastGrassCount = q.bladeCount;
}

// Called once after createGrass() in init() so we know the built count.
export function noteGrassBuilt() { lastGrassCount = state.quality.bladeCount; }

// --- Shadow camera follows the player, snapped to shadow texels (no shimmer).
const _dir = new THREE.Vector3();
export function updateShadowFollow() {
    const sun = state.sunLight;
    if (!sun || !sun.castShadow || !state.player) return;
    const q = state.quality;
    const angle = state.gameTime * Math.PI * 2 - Math.PI / 2;      // same formula as day-night-cycle.js
    _dir.set(Math.cos(angle) * 600, Math.sin(angle) * 600, -200).normalize();
    const texel = (2 * q.shadowRadius) / q.shadowMap;
    const tx = Math.round(state.player.position.x / texel) * texel;
    const tz = Math.round(state.player.position.z / texel) * texel;
    sun.target.position.set(tx, 0, tz);
    sun.target.updateMatrixWorld();
    // Light position stays where the atmosphere put it for lighting direction,
    // but shadows are cast from a rig centred on the player. Overwrite AFTER
    // updateAtmosphere() each frame; atmosphere re-sets the absolute value.
    sun.position.copy(sun.target.position).addScaledVector(_dir, 500);
}

// --- Adaptive resolution: rolling frame-time average, one step at a time.
const frameTimes = new Float32Array(60); let ftIdx = 0, ftFilled = 0;
let slowTimer = 0, fastTimer = 0;
state.adaptiveRes = false;
export function setAdaptiveRes(on) { state.adaptiveRes = on; if (!on && resScale !== 1) { resScale = 1; applyPixelRatio(); } }
export function getResScale() { return resScale; }
export function updateAdaptiveRes(deltaMs) {
    frameTimes[ftIdx] = deltaMs; ftIdx = (ftIdx + 1) % 60; ftFilled = Math.min(60, ftFilled + 1);
    if (!state.adaptiveRes || ftFilled < 60 || !state.isPlaying) return;
    let sum = 0; for (let i = 0; i < 60; i++) sum += frameTimes[i];
    const avg = sum / 60;
    slowTimer = avg > 20 ? slowTimer + deltaMs : 0;
    fastTimer = avg < 12 ? fastTimer + deltaMs : 0;
    if (slowTimer > 2000 && resScale > 0.6) { resScale = Math.max(0.6, +(resScale - 0.1).toFixed(2)); slowTimer = 0; applyPixelRatio(); }
    else if (fastTimer > 5000 && resScale < 1) { resScale = Math.min(1, +(resScale + 0.1).toFixed(2)); fastTimer = 0; applyPixelRatio(); }
}