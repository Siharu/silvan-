// Clouds — there was genuinely no cloud system anywhere in this project
// (grepped every file, zero references) — not something that broke, it
// just was never built. Per your report ("no clouds in the sky"), added
// a simple one: painterly soft-blob sprites (same canvas-radial-gradient
// baking technique as forest.js's tree-card/leaf textures), always
// camera-facing via THREE.Sprite (so no custom billboard shader needed),
// drifting slowly, tinted each frame from the same sun/hemi state
// everything else in this session got wired to — so clouds actually
// brighten/warm at midday and dim/cool at night instead of sitting at a
// fixed color regardless of time of day.

import * as THREE from 'three';

const CLOUD_COUNT = 28;
const CLOUD_ALTITUDE = 420;
const CLOUD_ALTITUDE_VARIANCE = 90;
const CLOUD_RADIUS = 1400; // scatter radius around the map center
const CLOUD_MIN_SCALE = 220;
const CLOUD_MAX_SCALE = 520;
const WIND_SPEED = 1.6; // units/sec drift

function createCloudTexture() {
    // Several overlapping soft radial blobs on one canvas, same technique
    // as forest.js's createTreeCardTexture() — reads as a puffy cloud
    // silhouette rather than a single perfect circle.
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const blobs = [
        [0.5, 0.55, 0.42], [0.28, 0.6, 0.28], [0.72, 0.6, 0.28],
        [0.38, 0.4, 0.26], [0.62, 0.4, 0.26], [0.5, 0.38, 0.3]
    ];
    for (const [bx, by, br] of blobs) {
        const grad = ctx.createRadialGradient(size * bx, size * by, 0, size * bx, size * by, size * br);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(size * bx, size * by, size * br, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

export function createClouds(state) {
    const cloudTexture = createCloudTexture();
    const clouds = [];

    for (let i = 0; i < CLOUD_COUNT; i++) {
        const mat = new THREE.SpriteMaterial({
            map: cloudTexture,
            transparent: true,
            depthWrite: false,
            fog: false, // sits far above the map's FogExp2 falloff — matching the reference's "stars/moon stay unaffected by ground fog" pattern
        });
        const sprite = new THREE.Sprite(mat);

        const r = Math.random() * CLOUD_RADIUS;
        const th = Math.random() * Math.PI * 2;
        const scale = CLOUD_MIN_SCALE + Math.random() * (CLOUD_MAX_SCALE - CLOUD_MIN_SCALE);
        sprite.position.set(
            Math.cos(th) * r,
            CLOUD_ALTITUDE + (Math.random() - 0.5) * CLOUD_ALTITUDE_VARIANCE,
            Math.sin(th) * r
        );
        sprite.scale.set(scale, scale * 0.55, 1);

        state.scene.add(sprite);
        clouds.push({
            sprite,
            driftDir: Math.random() * Math.PI * 2,
            driftSpeed: WIND_SPEED * (0.5 + Math.random()),
            opacityMult: 0.55 + Math.random() * 0.45, // per-cloud variance so they don't all fade/brighten in lockstep
        });
    }

    state.clouds = clouds;
}

const _tintColor = new THREE.Color();
const _fallbackHemi = new THREE.Color(0x333344); // was `new THREE.Color(0x333344)` allocated fresh every frame as a fallback arg — cached once since it's only ever used when state.hemiLight is somehow missing
const _sunHighlight = new THREE.Color(0xfff6e8); // same fix — was allocated fresh every frame inside the .lerp() call below

export function updateClouds(state, delta) {
    if (!state.clouds) return;

    // Tint from the same sun/hemi values day-night-cycle.js already
    // computes this frame — day: warm-white lit by sunLight's own
    // intensity; night: dim cool blue from hemiLight, same family as the
    // moon-ambient boost. No independent "cloud lighting" model, just
    // riding the values everything else already rides.
    const dayBlend = Math.max(0, state.sunHeightNormalized || 0);
    _tintColor.copy(state.hemiLight ? state.hemiLight.color : _fallbackHemi);
    _tintColor.lerp(_sunHighlight, dayBlend * 0.7); // warm sunlit highlight on the underside/lit face as the sun climbs
    const baseOpacity = 0.25 + dayBlend * 0.5; // faint at night, more visible by day — clouds shouldn't be a bright unlit blob against a dark night sky

    for (const c of state.clouds) {
        c.sprite.position.x += Math.cos(c.driftDir) * c.driftSpeed * delta;
        c.sprite.position.z += Math.sin(c.driftDir) * c.driftSpeed * delta;

        // Wrap back around instead of drifting off to infinity.
        const r = Math.hypot(c.sprite.position.x, c.sprite.position.z);
        if (r > CLOUD_RADIUS * 1.15) {
            const th = Math.random() * Math.PI * 2;
            c.sprite.position.x = Math.cos(th) * CLOUD_RADIUS * 0.3;
            c.sprite.position.z = Math.sin(th) * CLOUD_RADIUS * 0.3;
        }

        c.sprite.material.color.copy(_tintColor);
        c.sprite.material.opacity = baseOpacity * c.opacityMult;
    }
}
