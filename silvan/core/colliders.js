// Uniform-grid broadphase for state.colliders (B-21). The flat list was looped
// twice per axis every frame (~1,300 circles now, thousands once the map
// grows). Colliders are circles {x, z, r}; each is registered in every 16 u
// cell its bounding box touches, so a lookup is just "the list for the cell
// the point is in" — no neighbour scan needed.
//
// The grid is rebuilt lazily whenever state.colliders changes length (POIs,
// rocks, trees and palms all push into it during init). A collider's radius
// may change later (burrowing palms set r = 0 at night), so cells are filled
// using max(r, MIN_REG) and the caller always tests the CURRENT r.
import { state, WORLD_SIZE } from './state.js';

const CELL = 16;
const MIN_REG = 2.5;                       // >= largest radius a collider can regain after r was set to 0
const HALF = WORLD_SIZE / 2 + 64;
const N = Math.ceil((HALF * 2) / CELL);
const EMPTY = Object.freeze([]);

let cells = new Array(N * N);
let builtFor = -1;

function idx(x, z) {
    const ix = Math.floor((x + HALF) / CELL), iz = Math.floor((z + HALF) / CELL);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return -1;
    return iz * N + ix;
}

function rebuild() {
    cells = new Array(N * N);
    for (const col of state.colliders) {
        const r = Math.max(col.r, MIN_REG);
        const x0 = Math.floor((col.x - r + HALF) / CELL), x1 = Math.floor((col.x + r + HALF) / CELL);
        const z0 = Math.floor((col.z - r + HALF) / CELL), z1 = Math.floor((col.z + r + HALF) / CELL);
        for (let iz = Math.max(0, z0); iz <= Math.min(N - 1, z1); iz++)
            for (let ix = Math.max(0, x0); ix <= Math.min(N - 1, x1); ix++) {
                const k = iz * N + ix;
                (cells[k] || (cells[k] = [])).push(col);
            }
    }
    builtFor = state.colliders.length;
}

// Colliders that could touch a circle centred on (x, z). Returned array is shared — do not mutate.
export function collidersNear(x, z) {
    if (builtFor !== state.colliders.length) rebuild();
    const k = idx(x, z);
    return k < 0 ? EMPTY : (cells[k] || EMPTY);
}
