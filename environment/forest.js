// Forest placement. B-38 rewrite for the 3200u world:
//   - Trees are baked into SEEDED VARIANTS (pine-tree.js, deciduous-tree.js): one
//     instance per real tree, not thousands of per-branch instances.
//   - Both systems LOD around the player (updatePineLOD / updateDeciduousLOD in
//     main.js's loop): full meshes within ~65u, a ~50-triangle impostor out to
//     ~520u (past that the fog has swallowed them), nothing beyond. That is what
//     makes a DENSE forest affordable: cost follows what the camera can see,
//     not the size of the island.
//   - Placement: dense woodland nearly everywhere above the beach, with meadow
//     clearings from a low-frequency noise field, kept clear of POIs, trails,
//     rock, the crater, the landmark trees and the spawn beach.
//   - Coast (sand/just above it) deliberately gets NO trees here; the leaning
//     palms (landmark-trees.js) own the shoreline.
import * as THREE from 'three';
import { state, WORLD_SIZE } from '../core/state.js';
import { getSpawn } from '../core/spawn.js';
import { noise } from '../core/utils.js';
import { heightAt as getElevation, slopeAt } from '../core/heightmap.js';
import { POIS } from './pois.js';
import { pathAt, rockAt } from '../core/splat.js';
import { GRAND_BLUE_SPOTS, GRAND_BLUE_CLEAR_R } from './landmark-trees.js';
import { rngFor, WORLD_SEED } from '../core/rng.js';
import { beginPines, pickPineVariant, addPine, finishPines, PINE_TRUNK_RADIUS } from './pine-tree.js';
import { beginDeciduous, pickDeciduousVariant, addDeciduous, finishDeciduous } from './deciduous-tree.js';
const rand = rngFor('forest');

export const FOREST_TARGET_TREES = 14000;   // upper bound; placement stops when the land is full
const MIN_DIST = 7.5;                        // metres between trunks (dense, but you can still walk between)

export function generateFractalForest() {
    beginPines(WORLD_SEED ^ 0x51ee);
    beginDeciduous(WORLD_SEED ^ 0x7a21);

    const SP = getSpawn();
    const CELL = 8, grid = new Map();
    const tooClose = (x, z) => {
        const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            const list = grid.get((cx + dx) + ',' + (cz + dz));
            if (list && list.some((t) => Math.hypot(t.x - x, t.z - z) < MIN_DIST)) return true;
        }
        return false;
    };

    let placed = 0, pines = 0, decid = 0;
    const R0 = 25, R1 = WORLD_SIZE / 2 - 50;
    const maxAttempts = FOREST_TARGET_TREES * 30;
    const _base = new THREE.Matrix4(), _rot = new THREE.Matrix4(), _leaf = new THREE.Color();
    for (let i = 0; i < maxAttempts && placed < FOREST_TARGET_TREES; i++) {
        const r = Math.sqrt(R0 * R0 + rand() * (R1 * R1 - R0 * R0));
        const theta = rand() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z);

        if (y < 5.0) continue;                              // beach + shallows: palms only
        if (slopeAt(x, z) > 35) continue;                   // no trees on cliffs
        if (Math.hypot(x, z + 12) < 55) continue;           // none in the crater bowl
        if (Math.hypot(x - SP.x, z - SP.z) < 22) continue;  // clear spawn
        if (POIS.some((p) => Math.hypot(x - p.x, z - p.z) < (p.radius || 10) + 10)) continue; // keep POIs clear
        if (pathAt(x, z) > 0.15) continue;                  // keep trails open (splat mask)
        if (rockAt(x, z) > 0.6) continue;                   // no trees on bare rock
        if (GRAND_BLUE_SPOTS.some((g) => Math.hypot(x - g.x, z - g.z) < GRAND_BLUE_CLEAR_R * g.scale)) continue;
        // meadows: a minority of the land stays open (low-frequency noise); the rest is woodland
        const dens = noise(x * 0.006 + 13.7, z * 0.006 - 5.3);
        if (dens < 0.30 && rand() > 0.12) continue;
        // thin out toward the treeline (high ground) so the mountain reads as bare, not carpeted
        if (y > 28 && rand() < THREE.MathUtils.smoothstep(y, 28, 42)) continue;
        if (tooClose(x, z)) continue;
        const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push({ x, z });
        placed++;

        _base.makeTranslation(x, y - 0.3, z);
        _base.multiply(_rot.makeRotationY(rand() * Math.PI * 2));
        const s = 0.85 + rand() * 1.3;
        const biomeVal = noise(x * 0.008, z * 0.008);

        if (biomeVal < 0.4 && y > 5.5) {
            // PINE (4 seeded variants)
            const k = addPine(pickPineVariant(rand), _base, 16 * s, rand);
            state.colliders.push({ x, z, r: PINE_TRUNK_RADIUS * k + 0.45 });
            pines++;
        } else {
            // DECIDUOUS / MAPLE (6 seeded variants); autumn tint in the maple biome
            _leaf.setHex(0x244a1f);
            if (biomeVal > 0.68) {
                const autumn = [0x992211, 0xaa4411, 0xbb8811, 0xcc3311];
                _leaf.setHex(autumn[Math.floor(rand() * autumn.length)]);
            }
            _leaf.offsetHSL(rand() * 0.04 - 0.02, rand() * 0.1 - 0.05, rand() * 0.06 - 0.03);
            addDeciduous(pickDeciduousVariant(rand), _base, s, _leaf);
            state.colliders.push({ x, z, r: 0.7 * s + 0.6 });
            decid++;
        }
    }

    finishDeciduous(state.globalTextures.leaf);
    finishPines();
    state.forestStats = { trees: placed, pines, deciduous: decid };
    console.info(`[forest] ${placed} trees (${pines} pines, ${decid} deciduous)`);
}
