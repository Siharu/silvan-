import * as THREE from 'three';
import { state, WORLD_SIZE } from './state.js';

export function hash(x, y) {
    let dot = x * 12.9898 + y * 78.233;
    return (Math.sin(dot) * 43758.5453) % 1;
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
export function getElevation(x, z) {
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

    // Central volcanic massif - The Serpent's Coil
    if (dist < 0.38) {
        const peakFactor = Math.pow(1.0 - dist / 0.38, 1.9);
        elevation += peakFactor * 90;

        // Crater pit near the summit, offset from dead-center like the reference
        const abyssDist = Math.sqrt(x * x + (z + 12) * (z + 12));
        const craterRadius = WORLD_SIZE * 0.056; // ~45u
        if (abyssDist < craterRadius) {
            const pit = Math.cos((abyssDist / craterRadius) * Math.PI * 0.5);
            elevation -= pit * 40;
        }
    }

    // Shoreline dune texture
    if (elevation > 0 && elevation < 4.0) {
        elevation += n2(nx * 35, nz * 35) * 0.4;
    }

    return Math.max(-5, elevation);
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

