import * as THREE from 'three';
import { state, WORLD_SIZE, TREE_COUNT } from '../core/state.js';
import { noise } from '../core/utils.js';
import { heightAt as getElevation, slopeAt } from '../core/heightmap.js';
import { POIS } from './pois.js';
import { pathAt, rockAt } from '../core/splat.js';
import { GRAND_BLUE_SPOTS, GRAND_BLUE_CLEAR_R } from './landmark-trees.js';

import { rngFor, WORLD_SEED } from '../core/rng.js';
import { beginPines, pickPineVariant, addPine, finishPines, PINE_TRUNK_RADIUS, PINE_BASE_HEIGHT } from './pine-tree.js';
import { beginDeciduous, pickDeciduousVariant, addDeciduous, finishDeciduous } from './deciduous-tree.js';
const rand = rngFor('forest');
export function generateFractalForest() {
    beginPines(WORLD_SEED ^ 0x51ee); // nyctinastic pine variants (environment/pine-tree.js)
    beginDeciduous(WORLD_SEED ^ 0x7a21); // merged-mesh deciduous/maple variants, same LOD treatment as pines (B-24)

    // Placement: area-uniform sampling (the old uniform-radius draw crowded the mountain and thinned
    // the coast), a low-frequency density field for groves and clearings, and a minimum spacing via
    // a hash grid so trees never stack on each other (audit 6.3). Stops at the old surviving count.
    const TARGET_TREES = Math.round(TREE_COUNT * 0.55);
    const CELL = 7, MIN_DIST = 6.5, grid = new Map();
    const tooClose = (x, z) => {
        const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            const list = grid.get((cx + dx) + ',' + (cz + dz));
            if (list && list.some((t) => Math.hypot(t.x - x, t.z - z) < MIN_DIST)) return true;
        }
        return false;
    };
    let placedTrees = 0;
    const R0 = 25, R1 = WORLD_SIZE / 2 - 50;
    for (let i = 0; i < TREE_COUNT * 8 && placedTrees < TARGET_TREES; i++) {
        const r = Math.sqrt(R0 * R0 + rand() * (R1 * R1 - R0 * R0));
        const theta = rand() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z);
        
        if (y < 4.0) continue;
        if (slopeAt(x, z) > 35) continue;                 // no trees on cliffs
        if (Math.hypot(x, z + 12) < 55) continue;         // none in the crater bowl
        if (POIS.some((p) => Math.hypot(x - p.x, z - p.z) < (p.radius || 10) + 10)) continue; // keep POIs clear
        if (pathAt(x, z) > 0.15) continue;                // keep trails open (splat mask, audit 6.3)
        if (rockAt(x, z) > 0.6) continue;                 // no trees on bare rock
        if (GRAND_BLUE_SPOTS.some((g) => Math.hypot(x - g.x, z - g.z) < GRAND_BLUE_CLEAR_R * g.scale)) continue; // roots + shade of the landmark trees
        // groves and clearings: ~half the land is thin or open, the rest is forest
        const dens = noise(x * 0.011 + 13.7, z * 0.011 - 5.3);
        if (rand() > THREE.MathUtils.smoothstep(dens, 0.32, 0.62) * 0.92 + 0.04) continue;
        if (tooClose(x, z)) continue;
        const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push({ x, z });
        placedTrees++;

        const baseMatrix = new THREE.Matrix4().makeTranslation(x, y - 0.3, z);
        baseMatrix.multiply(new THREE.Matrix4().makeRotationY(rand() * Math.PI * 2));
        const s = 0.85 + rand() * 1.3;
        
        const biomeVal = noise(x * 0.008, z * 0.008);
        
        if (biomeVal < 0.35 && y > 3.5) {
            // PINE TREE (nyctinastic pine, environment/pine-tree.js): one of 4 seeded merged variants, one instance per tree
            const H = 16 * s;
            const k = addPine(pickPineVariant(rand), baseMatrix, H, rand);
            state.colliders.push({ x: x, z: z, r: PINE_TRUNK_RADIUS * k + 0.45 }); // real trunk radius, not a guess
            
        } else {
            // DECIDUOUS OR MAPLE TREE — merged-mesh variant + instancing (environment/deciduous-tree.js)
            let leafBase = new THREE.Color(0x244a1f); // Default Green
            if (biomeVal > 0.65) {
                // Maple Tree (Autumn colors based on biome)
                const autumn = [0x992211, 0xaa4411, 0xbb8811, 0xcc3311];
                leafBase.setHex(autumn[Math.floor(rand()*autumn.length)]);
            }
            leafBase.offsetHSL(rand()*0.1-0.05, rand()*0.2, rand()*0.1-0.05); // per-tree canopy tint jitter (was baked per-leaf before; now one tint per tree via instanceColor)
            addDeciduous(pickDeciduousVariant(rand), baseMatrix, s, leafBase);
            state.colliders.push({ x: x, z: z, r: (0.7 * s) + 0.6 });
        }
    }

    finishPines();
    finishDeciduous(state.globalTextures.leaf); // merges variant buffers into instanced meshes + builds the LOD impostor (environment/deciduous-tree.js)
}
