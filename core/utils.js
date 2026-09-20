import * as THREE from 'three';
import { state } from './state.js';

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

export function getElevation(x, z) {
    let y = noise(x * 0.015, z * 0.015) * 22;
    y += noise(x * 0.05, z * 0.05) * 4;
    // Create a massive central basin for the lake
    const centerDist = Math.sqrt(x*x + z*z);
    if(centerDist < 160) y -= (160 - centerDist) * 0.18;
    return y;
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

