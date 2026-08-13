// Shared canvas-generated textures (leaf, moon, flower sprite) used by
// sky.js, forest.js, and flowers.js. Created once in main.js and stored on
// state.globalTextures.

import * as THREE from 'three';

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

    // Sun sprite: a bright core disc + soft falling-off glow halo, radial
    // gradient rather than a hard-edged circle like the moon — this is what
    // gives the water's specular glint (environment/lake.js) something
    // actually visible in the sky to be reflecting, instead of a bright
    // highlight with no light source behind it.
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = 256; sunCanvas.height = 256;
    const sCtx = sunCanvas.getContext('2d');
    const sunGrad = sCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
    sunGrad.addColorStop(0.0, 'rgba(255,255,255,1)');
    sunGrad.addColorStop(0.18, 'rgba(255,250,235,0.95)');
    sunGrad.addColorStop(0.4, 'rgba(255,225,160,0.4)');
    sunGrad.addColorStop(0.7, 'rgba(255,210,140,0.1)');
    sunGrad.addColorStop(1.0, 'rgba(255,200,120,0)');
    sCtx.fillStyle = sunGrad;
    sCtx.fillRect(0, 0, 256, 256);
    const sunTex = new THREE.CanvasTexture(sunCanvas);
    sunTex.colorSpace = THREE.SRGBColorSpace;

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

    return { leaf: leafTex, moon: moonTex, sun: sunTex, flower: flowerTex };
}

