// Terrain v2 splat mask (audit 4.2 / 4.4). ONE RGBA8 texture over the whole
// world that the terrain shader, and later grass / trees / flowers, read:
//   R = grass    G = rock    B = sand / ash    A = path (trails + POI pads)
// Baked once after the heightmap, from height, slope, crater distance, biome
// noise and a trail network that links the POIs. CPU-side lookups
// (pathAt / grassAt) read the same bytes, so placement and shading agree.
import * as THREE from 'three';
import { WORLD_SIZE } from './state.js';
import { noise } from './utils.js';
import { heightAt, slopeAt } from './heightmap.js';

export const SPLAT_RES = 1024;                 // 1 texel = 1 world unit at WORLD_SIZE 1024
const HALF = WORLD_SIZE / 2;
const STEP = WORLD_SIZE / SPLAT_RES;
export const CRATER = { x: 0, z: -12 };        // matches getElevation()'s pit centre

let data = null;                               // Uint8Array SPLAT_RES^2 * 4
let texture = null;
export function getSplatTexture() { return texture; }
export function isSplatReady() { return data !== null; }

const sstep = THREE.MathUtils.smoothstep;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Trail graph, by POI id. 'spawn' is the player start (200, 0).
const SPAWN = { id: 'spawn', x: 200, z: 0 };
const TRAIL_EDGES = [
    ['spawn', 'chrysalis'], ['spawn', 'radio_tower'], ['spawn', 'ruined_cabin'],
    ['radio_tower', 'chrysalis'],
    ['ruined_cabin', 'greenite_mouth'], ['greenite_mouth', 'howling_maw'],
    ['howling_maw', 'broken_shell'], ['howling_maw', 'warm_paw'],
    ['warm_paw', 'obsidian_wing'], ['warm_paw', 'radio_tower'],
];
const TRAIL_HALF_WIDTH = 1.6;                  // ~3.2 u wide dirt track
const TRAIL_FEATHER = 1.4;

// Wobbly polyline between two points (deterministic, uses the project's noise()).
function trailPoints(a, b) {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.round(len / 18));
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;   // unit normal
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const edgeFade = Math.sin(t * Math.PI);               // endpoints stay on the POI
        const off = (noise(a.x * 0.13 + t * 9.1, a.z * 0.13 + 4.7) - 0.5) * 2 * 7 * edgeFade;
        pts.push({ x: a.x + (b.x - a.x) * t + nx * off, z: a.z + (b.z - a.z) * t + nz * off });
    }
    return pts;
}

// Stamp a soft capsule segment into the path buffer (max-blend), touching only its bbox.
function stampSegment(path, p, q, halfW, feather) {
    const r = halfW + feather;
    const minX = Math.max(0, Math.floor((Math.min(p.x, q.x) - r + HALF) / STEP));
    const maxX = Math.min(SPLAT_RES - 1, Math.ceil((Math.max(p.x, q.x) + r + HALF) / STEP));
    const minZ = Math.max(0, Math.floor((Math.min(p.z, q.z) - r + HALF) / STEP));
    const maxZ = Math.min(SPLAT_RES - 1, Math.ceil((Math.max(p.z, q.z) + r + HALF) / STEP));
    const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1;
    for (let j = minZ; j <= maxZ; j++) {
        const z = -HALF + j * STEP;
        for (let i = minX; i <= maxX; i++) {
            const x = -HALF + i * STEP;
            const t = clamp01(((x - p.x) * dx + (z - p.z) * dz) / l2);
            const d = Math.hypot(x - (p.x + dx * t), z - (p.z + dz * t));
            const v = 1 - sstep(d, halfW, halfW + feather);
            const k = j * SPLAT_RES + i;
            if (v > path[k]) path[k] = v;
        }
    }
}

export async function bakeSplat(pois, onProgress) {
    const byId = { spawn: SPAWN };
    for (const p of pois) byId[p.id] = p;

    // 1. Path layer: trails + a dirt pad under each built POI.
    const path = new Float32Array(SPLAT_RES * SPLAT_RES);
    for (const [ia, ib] of TRAIL_EDGES) {
        const a = byId[ia], b = byId[ib];
        if (!a || !b) continue;
        const pts = trailPoints(a, b);
        for (let i = 0; i < pts.length - 1; i++) stampSegment(path, pts[i], pts[i + 1], TRAIL_HALF_WIDTH, TRAIL_FEATHER);
    }
    for (const p of pois) {
        if (!p.build) continue;                    // serpents_coil is terrain, no pad
        const r = Math.min(p.radius, 10) + 1;
        stampSegment(path, p, p, r, 4);            // degenerate segment = soft disc
    }

    // 2. Per-texel layers.
    data = new Uint8Array(SPLAT_RES * SPLAT_RES * 4);
    const rowsPerYield = 64;
    for (let j = 0; j < SPLAT_RES; j++) {
        const z = -HALF + j * STEP;
        for (let i = 0; i < SPLAT_RES; i++) {
            const x = -HALF + i * STEP;
            const y = heightAt(x, z);
            const slope = slopeAt(x, z);
            const cd = Math.hypot(x - CRATER.x, z - CRATER.z);
            const k = j * SPLAT_RES + i;
            const nA = noise(x * 0.02, z * 0.02);               // biome-scale
            const nB = noise(x * 0.11 + 31.0, z * 0.11 - 17.0); // patch-scale

            // rock: steep faces + bare highland (edge broken up by noise)
            let rock = sstep(slope, 21, 36);
            rock = Math.max(rock, sstep(y + (nB - 0.5) * 8, 34, 46));
            // sand (beach) / ash (crater apron) share the B channel
            const sand = 1 - sstep(y + (nB - 0.5) * 1.5, 2.6, 4.4);
            const ash = 1 - sstep(cd, 48, 80);
            let sa = Math.max(sand, ash);
            // grass: whatever is left on lowland/midland, thinned by patchy noise
            let grass = (1 - rock) * (1 - sa) * sstep(y, 3.6, 5.4) * (1 - sstep(y, 30, 42));
            grass *= 0.55 + 0.45 * sstep(nA, 0.2, 0.55);
            grass *= 1 - 0.35 * sstep(nB, 0.62, 0.85);            // dry bald patches

            let pth = path[k];
            // no track underwater, on cliffs, or inside the crater bowl
            pth *= sstep(y, -0.2, 0.4);   // POIs like Broken Shell sit on ~1 u pads at the waterline; only truly submerged ground loses its track
            pth *= 1 - sstep(slope, 32, 42);
            pth *= sstep(cd, 34, 46);
            // a path replaces the other layers under it
            const keep = 1 - pth;
            grass *= keep; rock *= keep; sa *= keep;

            const o = k * 4;
            data[o] = Math.round(clamp01(grass) * 255);
            data[o + 1] = Math.round(clamp01(rock) * 255);
            data[o + 2] = Math.round(clamp01(sa) * 255);
            data[o + 3] = Math.round(clamp01(pth) * 255);
        }
        if (j % rowsPerYield === rowsPerYield - 1) {
            if (onProgress) onProgress(j / SPLAT_RES);
            await new Promise((r) => setTimeout(r, 0));
        }
    }

    texture = new THREE.DataTexture(data, SPLAT_RES, SPLAT_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.NoColorSpace;    // data, not colour
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
}

// Nearest-texel lookups, 0..1. Safe to call before the bake (returns 0).
function chan(x, z, c) {
    if (!data) return 0;
    const i = Math.min(SPLAT_RES - 1, Math.max(0, Math.round((x + HALF) / STEP)));
    const j = Math.min(SPLAT_RES - 1, Math.max(0, Math.round((z + HALF) / STEP)));
    return data[(j * SPLAT_RES + i) * 4 + c] / 255;
}
export const grassAt = (x, z) => chan(x, z, 0);
export const rockAt = (x, z) => chan(x, z, 1);
export const sandAshAt = (x, z) => chan(x, z, 2);
export const pathAt = (x, z) => chan(x, z, 3);
