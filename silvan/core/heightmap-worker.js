// Runs the heightmap bake off the main thread (terrain v2, 4.2 — was a
// main-thread loop in heightmap.js that yielded every 64 rows via
// `await new Promise(r => setTimeout(r, 0))` to keep the loading bar
// painting; still main-thread work competing with everything else during
// load). Imports elevation-core.js directly — the SAME function every live
// getElevation() call (POI placement, rocks, forest, puddles, etc.) uses —
// so the bake and those calls can never drift apart.
//
// No THREE, no DOM: this file only touches elevation-core.js and the
// WORLD_SIZE number from state.js, both safe to evaluate in a worker.
import { getElevation } from './elevation-core.js';
import { WORLD_SIZE } from './state.js';

self.onmessage = (e) => {
    const res = e.data.res;
    const half = WORLD_SIZE / 2;
    const step = WORLD_SIZE / (res - 1);
    const bake = new Float32Array(res * res);

    for (let j = 0; j < res; j++) {
        const z = -half + j * step;
        const row = j * res;
        for (let i = 0; i < res; i++) bake[row + i] = getElevation(-half + i * step, z);
        // Progress only — the worker's own loop never blocks the main
        // thread, so unlike the old version this doesn't need to yield for
        // the UI's sake, just report often enough for a smooth loading bar.
        if (j % 32 === 31) self.postMessage({ type: 'progress', value: j / res });
    }

    // Transfer the buffer instead of copying it (bake.buffer is 2049^2 * 4
    // bytes = ~16.8 MB at the default resolution) — ownership moves to the
    // main thread, zero-copy.
    self.postMessage({ type: 'done', buffer: bake.buffer }, [bake.buffer]);
};
