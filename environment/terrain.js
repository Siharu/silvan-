import * as THREE from 'three';
import { state, WORLD_SIZE } from '../core/state.js';
import { getElevation, noise } from '../core/utils.js';

// Elevation-banded vertex colors, ported from the_hearth_isometric_map's
// buildIslandTerrain() — ocean bed -> wet sand -> lush lowland -> slate
// highland -> peak, plus a magma blend near the crater regardless of band.
const oceanBedColor = new THREE.Color(0x0c131d);
const wetSandColor = new THREE.Color(0x2d2b27);
const lushLowlandColor = new THREE.Color(0x1a2c1e);
const slateHighlandColor = new THREE.Color(0x2f353d);
const mountainPeakColor = new THREE.Color(0x111317);
const abyssMagmaColor = new THREE.Color(0xdc2626);

// Phase 4 #29: was hard if/else cutoffs at y = 0.5/4.0/30.0/65.0 — read as
// visibly stepped/terraced bands rather than a natural gradient. Blends
// each pair of adjacent bands across a transition half-width around their
// boundary instead of switching instantly.
const _bandA = new THREE.Color();
function bandedTerrainColor(y) {
    const b1 = 0.5, w1 = 1.0;
    const b2 = 4.0, w2 = 3.0;
    const b3 = 30.0, w3 = 8.0;
    const b4 = 65.0, w4 = 10.0;

    if (y < b1 - w1) return _bandA.copy(oceanBedColor);
    if (y < b1 + w1) return _bandA.copy(oceanBedColor).lerp(wetSandColor, THREE.MathUtils.smoothstep(y, b1 - w1, b1 + w1));
    if (y < b2 - w2) return _bandA.copy(wetSandColor);
    if (y < b2 + w2) return _bandA.copy(wetSandColor).lerp(lushLowlandColor, THREE.MathUtils.smoothstep(y, b2 - w2, b2 + w2));
    if (y < b3 - w3) return _bandA.copy(lushLowlandColor);
    if (y < b3 + w3) return _bandA.copy(lushLowlandColor).lerp(slateHighlandColor, THREE.MathUtils.smoothstep(y, b3 - w3, b3 + w3));
    if (y < b4 - w4) return _bandA.copy(slateHighlandColor);
    if (y < b4 + w4) return _bandA.copy(slateHighlandColor).lerp(mountainPeakColor, THREE.MathUtils.smoothstep(y, b4 - w4, b4 + w4));
    return _bandA.copy(mountainPeakColor);
}

export function createTerrain() {
    // Phase 3 #21: was 300x300 (~90k verts) for an 800-unit map — far more
    // geometry than the visible per-vertex detail needs, and the single
    // biggest draw-call/vertex cost in the whole scene. Full chunked LOD is
    // a bigger job than this pass covers; cutting segment count 4x (as the
    // roadmap itself suggested) gets most of the win with no visual
    // difference at this resolution's normal viewing distance.
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 150, 150);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = [];

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = getElevation(x, z);
        pos.setY(i, y);

        const c = new THREE.Color().copy(bandedTerrainColor(y));

        // Crater is offset from dead-center to match getElevation()'s pit
        const distFromCrater = Math.sqrt(x * x + (z + 12) * (z + 12));
        if (distFromCrater < 40 && y < 55) {
            const magmaBlend = Math.min(1.0, (40 - distFromCrater) / 30);
            c.lerp(abyssMagmaColor, magmaBlend);
        }

        // Phase 4 #30: raw Math.random() grain was uncorrelated per vertex
        // (static/speckle look); sample utils.js's spatial noise() instead
        // so nearby vertices vary together, like real terrain mottling.
        // Frequency chosen for fine-grained but blotchy (not pixel-static)
        // variation relative to the terrain's overall scale.
        const grain = (noise(x * 0.15, z * 0.15) - 0.5) * 0.06;
        c.r = THREE.MathUtils.clamp(c.r + grain, 0, 1);
        c.g = THREE.MathUtils.clamp(c.g + grain, 0, 1);
        c.b = THREE.MathUtils.clamp(c.b + grain, 0, 1);
        colors.push(c.r, c.g, c.b);
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.1,
        flatShading: true
    });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    state.scene.add(terrain);

    // Crater glow light - The Serpent's Coil
    const abyssLight = new THREE.PointLight(0xef4444, 5, 90);
    abyssLight.position.set(0, 40, -12);
    state.scene.add(abyssLight);
}