// Seeded PRNG (B-23). World generation must NEVER call Math.random — the
// same seed has to produce the same island every load (bug repro, saves,
// chunk streaming). Each system draws from its own named stream so adding
// or reordering one system never reshuffles another.
//   ?seed=123 in the URL overrides the default world seed.

export function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

const urlSeed = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('seed') : null;
export const WORLD_SEED = urlSeed !== null && urlSeed !== '' ? (parseInt(urlSeed, 10) >>> 0) : 1337;

// Independent deterministic stream per system name (and optional chunk key).
export function rngFor(name, cx = 0, cz = 0) {
    return mulberry32((WORLD_SEED ^ hashString(name) ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0);
}
