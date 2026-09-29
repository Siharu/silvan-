import * as THREE from 'three';
import { state, WORLD_SIZE } from './state.js';

export function hash(x, y) {
    let dot = x * 12.9898 + y * 78.233;
    const val = Math.sin(dot) * 43758.5453;
    // GLSL's fract() always returns a non-negative [0,1) value; JS's `%` is
    // remainder, not modulo, and keeps the sign of a negative `val` — this
    // was returning ~half its outputs as negative, scrambling noise()'s
    // bilinear blend instead of producing smooth terrain.
    return val - Math.floor(val);
}

export function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);
    const v1 = hash(ix, iy);
    const v2 = hash(ix + 1, iy);
    const v3 = hash(ix, iy + 1);
    const v4 = hash(ix + 1, iy + 1);
    const i1 = v1 * (1 - ux) + v2 * ux;
    const i2 = v3 * (1 - ux) + v4 * ux;
    return i1 * (1 - uy) + i2 * uy;
}

// Remaps this project's value-noise() (~[0,1]) to ~[-1,1], matching the
// range the reference island generator's Simplex noise produced — lets the
// same coefficients below behave the same way without adding a new
// noise dependency.
function n2(x, z) {
    return noise(x, z) * 2 - 1;
}

// The Hearth (Map 1) — an island with a central volcanic peak and crater,
// ported from the_hearth_isometric_map's sampleElevation(). That reference
// used a 320-unit map; horizontal distances/frequencies below are expressed
// as fractions of WORLD_SIZE so they carry over to this project's 800-unit
// map unchanged, while absolute heights (peak/crater depth) are tuned
// directly for this world's scale rather than linearly scaled by 2.5x.
// POI ground pads (terrain v2 B-25 fix): flattens the terrain under each
// prop so it sits level instead of floating/sinking on a slope. Coordinates
// mirror environment/pois.js's POIS table (mockup units, same SCALE) —
// duplicated here rather than imported to avoid a circular import
// (pois.js -> heightmap.js -> utils.js). Keep the two lists in sync.
// serpents_coil is deliberately excluded: that crater IS the terrain.
const _PAD_SCALE = WORLD_SIZE / 320;
const _PAD_DEFS = [
    { x: 45, z: -60, r: 30 }, { x: -70, z: -25, r: 12 }, { x: 85, z: 65, r: 8 },
    { x: -35, z: 45, r: 10 }, { x: -95, z: 80, r: 12 }, { x: 90, z: -75, r: 8 },
    { x: -100, z: -15, r: 8 }, { x: 30, z: 120, r: 8 },
].map((p) => ({ x: p.x * _PAD_SCALE, z: p.z * _PAD_SCALE, r: p.r }));
let _pads = null; // {x,z,r,baseY}[], baseY filled in lazily from rawElevation

function rawElevation(x, z) {
    const nx = x / WORLD_SIZE;
    const nz = z / WORLD_SIZE;
    const dist = Math.sqrt(x * x + z * z) / (WORLD_SIZE * 0.45);

    const noiseVal = n2(nx * 2.5, nz * 2.5) * 1.0
                    + n2(nx * 6.0, nz * 6.0) * 0.4
                    + n2(nx * 14.0, nz * 14.0) * 0.2
                    + n2(nx * 30.0, nz * 30.0) * 0.05;

    let elevation = 0;
    if (dist < 1.0) {
        const islandShape = Math.pow(1.0 - dist, 1.35);
        elevation = (noiseVal + 1.2) * 24 * islandShape;
    }

    // Central volcanic massif - The Serpent's Coil. Phase 4 #31: previously
    // a hard `dist < 0.38` switch stacked directly on the island's own
    // separate falloff (pow 1.35) — peakFactor itself tapers to 0 at that
    // boundary, but its *slope* doesn't match the island curve's, so the
    // combined surface kinks right at the mountain's base. Fade the whole
    // peak contribution out across a transition band instead of snapping
    // it off at one exact radius, so the two curves hand off smoothly.
    const peakRadius = 0.38;
    const peakBlendWidth = 0.10;
    if (dist < peakRadius + peakBlendWidth) {
        const peakFactor = Math.pow(Math.max(0, 1.0 - dist / peakRadius), 1.9);
        const peakBlend = 1.0 - THREE.MathUtils.smoothstep(dist, peakRadius - peakBlendWidth, peakRadius + peakBlendWidth);
        elevation += peakFactor * 90 * peakBlend;

        // Crater pit near the summit, offset from dead-center like the
        // reference — scaled by the same blend so it can't punch a pit
        // into terrain the peak itself has already faded out of.
        const abyssDist = Math.sqrt(x * x + (z + 12) * (z + 12));
        const craterRadius = WORLD_SIZE * 0.056; // ~45u
        if (abyssDist < craterRadius) {
            const pit = Math.cos((abyssDist / craterRadius) * Math.PI * 0.5);
            elevation -= pit * 40 * peakBlend;
        }
    }

    // Shoreline dune texture
    if (elevation > 0 && elevation < 4.0) {
        elevation += n2(nx * 35, nz * 35) * 0.4;
    }

    return Math.max(-5, elevation);
}

export function getElevation(x, z) {
    if (!_pads) _pads = _PAD_DEFS.map((p) => ({ ...p, baseY: rawElevation(p.x, p.z) }));
    let e = rawElevation(x, z);
    for (const p of _pads) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r + 8) {
            const t = 1 - THREE.MathUtils.smoothstep(d, p.r, p.r + 8);
            e = e * (1 - t) + p.baseY * t;
        }
    }
    return e;
}

// Phase 6 #36: shared touch-capability check, used by both input.js and
// touch-controls.js — lives here (not either of those two) to avoid a
// circular import between them, since utils.js already sits underneath
// both in the dependency graph.
export function shouldShowTouchControls() {
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

export function createProceduralTextures() {
    const leafCanvas = document.createElement('canvas');
    leafCanvas.width = 64; leafCanvas.height = 64;
    const lCtx = leafCanvas.getContext('2d');
    lCtx.fillStyle = '#ffffff';
    lCtx.beginPath();
    lCtx.moveTo(32, 5);
    lCtx.quadraticCurveTo(60, 32, 32, 60);
    lCtx.quadraticCurveTo(5, 32, 32, 5);
    lCtx.fill();
    const leafTex = new THREE.CanvasTexture(leafCanvas);
    leafTex.colorSpace = THREE.SRGBColorSpace;

    const moonCanvas = document.createElement('canvas');
    moonCanvas.width = 256; moonCanvas.height = 256;
    const mCtx = moonCanvas.getContext('2d');
    mCtx.fillStyle = '#fdfdfd';
    mCtx.beginPath();
    mCtx.arc(128, 128, 110, 0, Math.PI * 2);
    mCtx.fill();
    const moonTex = new THREE.CanvasTexture(moonCanvas);
    moonTex.colorSpace = THREE.SRGBColorSpace;

    const fCanvas = document.createElement('canvas');
    fCanvas.width = 128; fCanvas.height = 128;
    const fCtx = fCanvas.getContext('2d');
    // Stylized Flower Petals (Daisy-like)
    fCtx.fillStyle = '#ffffff';
    for(let i=0; i<7; i++) {
        fCtx.save();
        fCtx.translate(64, 64);
        fCtx.rotate((Math.PI * 2 / 7) * i);
        fCtx.beginPath();
        fCtx.ellipse(0, 26, 12, 34, 0, 0, Math.PI * 2);
        fCtx.fill();
        fCtx.restore();
    }
    // Flower Center
    fCtx.fillStyle = '#ffcc00';
    fCtx.beginPath();
    fCtx.arc(64, 64, 14, 0, Math.PI * 2);
    fCtx.fill();
    const flowerTex = new THREE.CanvasTexture(fCanvas);
    flowerTex.colorSpace = THREE.SRGBColorSpace;

    return { leaf: leafTex, moon: moonTex, flower: flowerTex };
}