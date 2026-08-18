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

    // Moon glow halo: a separate, much larger and softer radial gradient
    // (cool blue-white) rendered behind/around the moon sprite in sky.js.
    // The moon disc texture above is deliberately hard-edged (a real moon
    // has a crisp limb), so this exists purely to give it the same kind of
    // soft atmospheric bloom the sun's own texture already bakes in —
    // without it the moon reads as a flat cutout pasted on the sky with
    // nothing lighting the air around it.
    const moonGlowCanvas = document.createElement('canvas');
    moonGlowCanvas.width = 256; moonGlowCanvas.height = 256;
    const mgCtx = moonGlowCanvas.getContext('2d');
    const moonGlowGrad = mgCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
    moonGlowGrad.addColorStop(0.0, 'rgba(215,225,255,0.9)');
    moonGlowGrad.addColorStop(0.15, 'rgba(190,205,255,0.55)');
    moonGlowGrad.addColorStop(0.45, 'rgba(170,190,255,0.18)');
    moonGlowGrad.addColorStop(1.0, 'rgba(160,180,255,0)');
    mgCtx.fillStyle = moonGlowGrad;
    mgCtx.fillRect(0, 0, 256, 256);
    const moonGlowTex = new THREE.CanvasTexture(moonGlowCanvas);
    moonGlowTex.colorSpace = THREE.SRGBColorSpace;

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

    // Sun-ray burst: alternating warm/transparent wedges radiating from
    // center, gaussian-ish falloff toward the rim — a cheap, sprite-based
    // stand-in for volumetric god rays. sky.js renders this as a large
    // camera-facing sprite pinned to the sun's position, additively
    // blended and faded by how directly the camera's looking toward it
    // (see atmosphere/day-night-cycle.js) — not true occlusion-aware
    // volumetric shafts through the canopy, but reads convincingly for a
    // fraction of the engineering/perf cost, and needs no changes to the
    // render pipeline.
    const rayCanvas = document.createElement('canvas');
    rayCanvas.width = 512; rayCanvas.height = 512;
    const rCtx = rayCanvas.getContext('2d');
    rCtx.translate(256, 256);
    // Old version placed evenly-spaced wedges at i/rayCount around the full
    // circle — varying width/reach didn't stop it reading as a mechanical
    // pinwheel, because the *positions* were still a perfect rosette every
    // single frame from every angle. Real light shafts don't wrap all the
    // way around evenly; they're a handful of uneven beams clustered
    // roughly toward one side with real gaps, like light breaking through
    // scattered canopy rather than a stamped sunburst decal.
    let cursor = 0;
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647); };
    while (cursor < Math.PI * 2) {
        const angle = cursor;
        const width = 0.045 + rand() * 0.05; // narrower average beam than before
        const reach = 130 + rand() * 190;
        const coreAlpha = 0.3 + rand() * 0.3; // uneven brightness beam-to-beam
        const grad = rCtx.createRadialGradient(0, 0, 0, 0, 0, reach);
        grad.addColorStop(0.0, `rgba(255,244,214,${coreAlpha})`);
        grad.addColorStop(0.4, `rgba(255,230,180,${coreAlpha * 0.35})`);
        grad.addColorStop(1.0, 'rgba(255,220,160,0)');
        rCtx.fillStyle = grad;
        rCtx.beginPath();
        rCtx.moveTo(0, 0);
        rCtx.arc(0, 0, reach, angle - width, angle + width);
        rCtx.closePath();
        rCtx.fill();
        // Uneven gap before the next beam — sometimes tight, sometimes a
        // wide stretch of nothing, so the spacing itself looks broken up.
        cursor += width * 2 + 0.12 + rand() * 0.55;
    }
    const sunRayTex = new THREE.CanvasTexture(rayCanvas);
    sunRayTex.colorSpace = THREE.SRGBColorSpace;

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

    return { leaf: leafTex, moon: moonTex, moonGlow: moonGlowTex, sun: sunTex, sunRays: sunRayTex, flower: flowerTex };
}

