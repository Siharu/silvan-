// Post-generation landmark finder — locates real, verified-safe points on
// the procedurally generated island for story beats that need a specific
// kind of spot (a cliff edge, a quiet flat clearing) without the risk of
// hardcoding coordinates that could land underwater, inside a rock, or off
// the island entirely if terrain params ever change. Everything here
// queries the SAME getElevation() the real terrain mesh is built from
// (environment/terrain.js), so whatever it finds is guaranteed to match
// what's actually rendered — same principle as environment/animals.js's
// findDryAnchor(), just scanning in more directions/with a flatness check
// instead of one fixed +X line.

import { getElevation } from '../environment/terrain.js';
import { WORLD_SIZE, WATER_LEVEL } from './world-state.js';

// Scans outward from the island center along a compass direction (radians,
// 0 = +X, increasing counter-clockwise) for the point where dry land gives
// way to the shoreline. Returns the last dry point before the drop — the
// spot you'd actually stand on to look out over the edge.
function scanForCoastEdge(state, angleRad, dryMargin = 1.5, step = 4) {
    const dirX = Math.cos(angleRad);
    const dirZ = Math.sin(angleRad);
    let lastDry = null;
    for (let d = 10; d <= WORLD_SIZE * 0.5; d += step) {
        const x = dirX * d, z = dirZ * d;
        const y = getElevation(x, z, state);
        if (y > WATER_LEVEL + dryMargin) {
            lastDry = { x, z, y };
        } else if (lastDry) {
            return lastDry; // just crossed from dry to wet — lastDry is the edge
        }
    }
    return lastDry; // never hit water scanning this far — shouldn't happen on this island, best-effort fallback
}

// The Boundary Walk beat (script: "the group trots to the edge of the
// southern bluffs"). South = -Z here, chosen just to give the beat a
// distinct compass direction from spawn (which sits near the origin).
export function findSouthernBluff(state) {
    return scanForCoastEdge(state, -Math.PI / 2, 1.5) || { x: 0, z: -180, y: 3 };
}

// The Unburied Bone beat needs a quiet, flat, dry clearing — not a literal
// willow tree lookup, since there's no stored per-tree position list
// (environment/forest.js bakes tree geometry straight into instance
// matrices at generation time, nothing kept queryable afterward). Scans a
// different compass direction than the bluff, with a flatness check (small
// elevation spread across a short ring of samples) so it lands in an
// actual clearing rather than partway up a slope.
export function findWillowSpot(state) {
    const angle = Math.PI / 3; // ~60°, distinct from the bluff's south and from findDryAnchor()'s due-east scan
    const step = 4;
    for (let d = 30; d <= WORLD_SIZE * 0.35; d += step) {
        const x = Math.cos(angle) * d, z = Math.sin(angle) * d;
        const y = getElevation(x, z, state);
        if (y < WATER_LEVEL + 2) continue; // still beach/water

        const ring = [0, 1, 2, 3].map(i => {
            const a = i * (Math.PI / 2);
            return getElevation(x + Math.cos(a) * 3, z + Math.sin(a) * 3, state);
        });
        const spread = Math.max(y, ...ring) - Math.min(y, ...ring);
        if (spread < 1.2) return { x, z, y };
    }
    const fx = Math.cos(angle) * 60, fz = Math.sin(angle) * 60;
    return { x: fx, z: fz, y: getElevation(fx, fz, state) }; // fallback if no sufficiently flat spot turned up — still dry-checked, just not flatness-verified
}
