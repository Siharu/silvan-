import * as THREE from 'three';
import { state, WORLD_SIZE } from '../core/state.js';
import { getElevation } from '../core/utils.js';

// Elevation-banded vertex colors, ported from the_hearth_isometric_map's
// buildIslandTerrain() — ocean bed -> wet sand -> lush lowland -> slate
// highland -> peak, plus a magma blend near the crater regardless of band.
const oceanBedColor = new THREE.Color(0x0c131d);
const wetSandColor = new THREE.Color(0x2d2b27);
const lushLowlandColor = new THREE.Color(0x1a2c1e);
const slateHighlandColor = new THREE.Color(0x2f353d);
const mountainPeakColor = new THREE.Color(0x111317);
const abyssMagmaColor = new THREE.Color(0xdc2626);

export function createTerrain() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 300, 300);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = [];

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = getElevation(x, z);
        pos.setY(i, y);

        const c = new THREE.Color();
        if (y < 0.5) c.copy(oceanBedColor);
        else if (y < 4.0) c.copy(wetSandColor);
        else if (y < 30.0) c.copy(lushLowlandColor);
        else if (y < 65.0) c.copy(slateHighlandColor);
        else c.copy(mountainPeakColor);

        // Crater is offset from dead-center to match getElevation()'s pit
        const distFromCrater = Math.sqrt(x * x + (z + 12) * (z + 12));
        if (distFromCrater < 40 && y < 55) {
            const magmaBlend = Math.min(1.0, (40 - distFromCrater) / 30);
            c.lerp(abyssMagmaColor, magmaBlend);
        }

        const grain = (Math.random() - 0.5) * 0.06;
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

