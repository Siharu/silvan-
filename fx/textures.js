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

    // Sun-ray burst: a handful of long, soft, unevenly-spaced light shafts —
    // a cheap sprite-based stand-in for volumetric god rays. sky.js renders
    // this as a large camera-facing sprite pinned to the sun's position,
    // additively blended and faded by how directly the camera's looking
    // toward it (see atmosphere/day-night-cycle.js) — not true occlusion-
    // aware volumetric shafts through the canopy, but reads convincingly for
    // a fraction of the engineering/perf cost, and needs no changes to the
    // render pipeline.
    const rayCanvas = document.createElement('canvas');
    rayCanvas.width = 512; rayCanvas.height = 512;
    const rCtx = rayCanvas.getContext('2d');
    rCtx.translate(256, 256);
    // A previous version fixed beam width/reach/gap randomness but still
    // wrapped a full 2π circle of wedges around the center — which is
    // exactly the "generic sunburst clipart" silhouette (a rosette of spokes
    // ringing a point), no matter how uneven the individual spokes are.
    // Real crepuscular rays don't radiate outward all the way around their
    // source; they're near-parallel beams fanning in ONE general direction
    // — down and toward the viewer — that only look like they diverge from
    // a point because of perspective foreshortening, the same way parallel
    // train tracks look like they meet at a vanishing point. Restricting
    // the beams to a narrow downward-biased arc instead of the full circle
    // is what actually kills the pinwheel-icon look, not the per-beam
    // randomness alone.
    const fanCenter = Math.PI / 2; // straight "down" in canvas space (+Y), i.e. toward the viewer/ground
    const fanSpread = 0.95; // ~109° total arc — a fan, not a ring
    let cursor = fanCenter - fanSpread;
    const fanEnd = fanCenter + fanSpread;
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647); };
    while (cursor < fanEnd) {
        const angle = cursor;
        const width = 0.03 + rand() * 0.04; // thin, streak-like rather than wedge-like
        const reach = 190 + rand() * 260; // longer than before — real shafts read as long streaks, not a short halo
        const coreAlpha = 0.28 + rand() * 0.28; // uneven brightness beam-to-beam
        const grad = rCtx.createRadialGradient(0, 0, 0, 0, 0, reach);
        // Softer, more gradual falloff (more stops) than the old 3-stop
        // gradient — a hard-edged wedge cut off by a circular arc is part of
        // what read as "icon" rather than "light"; this tapers gradually
        // enough that the far edge of each beam fades to nothing well
        // before its geometric cutoff, so the cutoff itself is never seen.
        grad.addColorStop(0.0, `rgba(255,244,214,${coreAlpha})`);
        grad.addColorStop(0.25, `rgba(255,238,200,${coreAlpha * 0.55})`);
        grad.addColorStop(0.55, `rgba(255,230,180,${coreAlpha * 0.22})`);
        grad.addColorStop(1.0, 'rgba(255,220,160,0)');
        rCtx.fillStyle = grad;
        rCtx.beginPath();
        rCtx.moveTo(0, 0);
        rCtx.arc(0, 0, reach, angle - width, angle + width);
        rCtx.closePath();
        rCtx.fill();
        // Uneven gap before the next beam — sometimes tight, sometimes a
        // wide stretch of nothing, so the spacing itself looks broken up
        // rather than evenly combed.
        cursor += width * 2 + 0.1 + rand() * 0.5;
    }
    // The wedges above still read as distinct spokes/streaks rather than a
    // soft blend (each one has its own hard-ish gradient falloff, and gaps
    // between beams stay visible) — compositing through a blurred context
    // onto a second canvas merges them into one continuous glow, the same
    // way a real light shaft photographs soft-edged rather than as separate
    // comb teeth. Blur has to happen on the composite (a second drawImage
    // pass), not while drawing the wedges themselves, or each wedge would
    // just blur into a slightly-softer wedge instead of merging with its
    // neighbors.
    const rayBlurCanvas = document.createElement('canvas');
    rayBlurCanvas.width = 512; rayBlurCanvas.height = 512;
    const rbCtx = rayBlurCanvas.getContext('2d');
    rbCtx.filter = 'blur(16px)';
    rbCtx.drawImage(rayCanvas, 0, 0);
    const sunRayTex = new THREE.CanvasTexture(rayBlurCanvas);
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

    // Raindrop streak — a soft-edged vertical blurred line, used as the
    // alpha mask for the new Points-based rain system (fx/rain.js, ported
    // from "Cheap, Beautiful Rain in Three.js"). The article's own asset is
    // explicitly square ("a 512x512, mostly empty PNG of a blurred line")
    // — that matters because THREE.Points always samples this via
    // gl_PointCoord, which is always a square 0..1x0..1 UV space
    // regardless of the source texture's own aspect ratio. A non-square
    // source (this used to be 64x256) gets stretched to fit that square
    // footprint, visibly warping the drop shape. Square canvas + generous
    // empty padding around the line, matching the article's real asset,
    // fixes that. Canvas's own shadowBlur does the blurring so there's no
    // need for a real multi-pass GPU blur — same "bake it into a PNG"
    // trick the article uses, just generated at runtime instead of
    // shipped as an asset.
    const rainCanvas = document.createElement('canvas');
    rainCanvas.width = 128; rainCanvas.height = 128;
    const rainCtx = rainCanvas.getContext('2d');
    rainCtx.strokeStyle = 'rgba(255,255,255,1.0)';
    rainCtx.lineWidth = 4;
    rainCtx.lineCap = 'round';
    rainCtx.shadowColor = 'rgba(255,255,255,1.0)';
    rainCtx.shadowBlur = 10;
    rainCtx.beginPath();
    rainCtx.moveTo(64, 28);
    rainCtx.lineTo(64, 100);
    rainCtx.stroke();
    // Second, brighter/thinner pass down the core so the streak has a
    // hot center instead of reading as a uniform blurred bar.
    rainCtx.lineWidth = 1.5;
    rainCtx.shadowBlur = 4;
    rainCtx.stroke();
    const rainTex = new THREE.CanvasTexture(rainCanvas);
    rainTex.colorSpace = THREE.SRGBColorSpace;

    // Tileable-ish RGB noise for the new grass system (environment/grass.js
    // — "Making Grass with Triangles in GLSL using Three.js", Peter Adams,
    // Antaeus AR). Used twice per the article: R channel for bald-patch
    // variation, G+B channels for per-blade wind bend direction/angle.
    // A static baked texture sampled+scrolled in the shader instead of
    // running an actual noise function per-vertex every frame.
    const noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = 128; noiseCanvas.height = 128;
    const nCtx = noiseCanvas.getContext('2d');
    const nImg = nCtx.createImageData(128, 128);
    for (let i = 0; i < nImg.data.length; i += 4) {
        nImg.data[i] = Math.random() * 255;
        nImg.data[i + 1] = Math.random() * 255;
        nImg.data[i + 2] = Math.random() * 255;
        nImg.data[i + 3] = 255;
    }
    nCtx.putImageData(nImg, 0, 0);
    const grassNoiseTex = new THREE.CanvasTexture(noiseCanvas);
    grassNoiseTex.wrapS = THREE.RepeatWrapping;
    grassNoiseTex.wrapT = THREE.RepeatWrapping;

    // Grass diffuse map — the article samples a photographed grass texture
    // to color/define individual blades instead of a flat shader gradient;
    // painted procedurally here (streaky vertical blade strokes over a
    // mottled green base) to match the rest of this file's hand-drawn
    // texture approach rather than shipping a photo asset.
    const grassDiffCanvas = document.createElement('canvas');
    grassDiffCanvas.width = 128; grassDiffCanvas.height = 128;
    const gdCtx = grassDiffCanvas.getContext('2d');
    gdCtx.fillStyle = '#2c4a18';
    gdCtx.fillRect(0, 0, 128, 128);
    // Mottled base blotches
    for (let i = 0; i < 90; i++) {
        const x = Math.random() * 128, y = Math.random() * 128;
        const r = 6 + Math.random() * 14;
        const shade = 0.7 + Math.random() * 0.6;
        gdCtx.fillStyle = `rgba(${Math.round(40 * shade)},${Math.round(90 * shade)},${Math.round(28 * shade)},0.35)`;
        gdCtx.beginPath(); gdCtx.arc(x, y, r, 0, Math.PI * 2); gdCtx.fill();
    }
    // Individual blade streaks — short near-vertical strokes so the tiled
    // result reads as fibrous grass rather than a smooth color field.
    for (let i = 0; i < 500; i++) {
        const x = Math.random() * 128, y = Math.random() * 128;
        const h = 4 + Math.random() * 10;
        const lean = (Math.random() - 0.5) * 3;
        const g = 70 + Math.random() * 110;
        gdCtx.strokeStyle = `rgba(${Math.round(g * 0.35)},${Math.round(g)},${Math.round(g * 0.28)},${0.35 + Math.random() * 0.4})`;
        gdCtx.lineWidth = 0.8 + Math.random() * 1.1;
        gdCtx.beginPath();
        gdCtx.moveTo(x, y);
        gdCtx.lineTo(x + lean, y - h);
        gdCtx.stroke();
    }
    const grassDiffuseTex = new THREE.CanvasTexture(grassDiffCanvas);
    grassDiffuseTex.wrapS = THREE.RepeatWrapping;
    grassDiffuseTex.wrapT = THREE.RepeatWrapping;
    grassDiffuseTex.colorSpace = THREE.SRGBColorSpace;

    return { leaf: leafTex, moon: moonTex, moonGlow: moonGlowTex, sun: sunTex, sunRays: sunRayTex, flower: flowerTex, rainDrop: rainTex, grassNoise: grassNoiseTex, grassDiffuse: grassDiffuseTex };
}

