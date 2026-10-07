// Thunder/lightning for heavy and torrential rain. Two parts, both driven
// from updateAtmosphere() every frame (atmosphere/day-night-cycle.js) so
// they share its single weather-intensity read instead of each polling
// state separately:
//   1. index.html's #lightning-flash full-viewport overlay — a quick white
//      flash (real lightning usually reads as 2 close pulses, not one),
//      independent of time of day so it reads the same at noon or at night.
//   2. A brief bump to the cloud shader's own brightness (uFlash uniform,
//      see sky.js) + the sun/hemi lights, so the clouds themselves look lit
//      from within rather than only the screen going white — closer to
//      what the audit asked for ("thunderflash in the clouds") than a
//      screen-overlay-only effect.
// Unverified (no WebGL/display here) — reasoning only: timings below are a
// first guess at "reads as lightning", not tuned against anything running.
import { state } from '../core/state.js';

const HEAVY_THRESHOLD = 0.7;     // matches day-night-cycle.js's weatherKey 'heavy' cutoff
let flashEl = null;
let nextStrikeAt = 0;   // performance.now() timestamp of the next scheduled strike
let pulses = [];        // [{start, dur, peak}] — 1 or 2 queued per strike

function scheduleStrike(now, intensity) {
    // Closer to a real storm's clustering than a flat random rate: strikes
    // get both more frequent AND brighter/more likely to double-pulse as
    // intensity climbs from "just crossed heavy" to full torrential.
    const gap = THREE_lerp(14000, 2500, intensity); // ms between strikes at low vs. max intensity
    nextStrikeAt = now + gap * (0.6 + Math.random() * 0.8);
    const doublePulse = Math.random() < 0.4 + intensity * 0.4;
    const peak = 0.55 + Math.random() * 0.35 + intensity * 0.25;
    pulses.push({ start: now, dur: 90 + Math.random() * 60, peak: Math.min(1, peak) });
    if (doublePulse) {
        pulses.push({ start: now + 110 + Math.random() * 90, dur: 70 + Math.random() * 50, peak: Math.min(1, peak * 0.7) });
    }
    if (state.thunderAudio) {
        // Real thunder lags the flash by sound's travel time — closer
        // strikes (more intense storm) lag less. Silent/no-op until an
        // actual thunder.mp3 exists (B-16's warn-not-throw path), so this
        // is free to leave wired now rather than bolted on later.
        const delayMs = THREE_lerp(1800, 250, intensity);
        setTimeout(() => { if (state.thunderAudio) state.thunderAudio.play(); }, delayMs);
    }
}

function THREE_lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }

// Call AFTER day-night-cycle.js has already set hemiLight.intensity for
// this frame (its own day/night dayBlend lerp) — this only ADDS a flash
// boost on top of whatever that lerp just computed, every frame, rather
// than caching an intensity "baseline" once (which would go stale the
// moment time-of-day moved on and make the flash too dim or too bright
// depending on when the storm happened to roll in).
export function updateLightning(now, rainIntensity, hemiLight, sunLight) {
    // Self-initializing (grabbed once, lazily) rather than requiring a
    // separate setup call wired into main.js's init() order — this module
    // has exactly one entry point to keep straight.
    if (!flashEl) flashEl = document.getElementById('lightning-flash');
    if (!flashEl) return;

    if (rainIntensity < HEAVY_THRESHOLD) {
        // Dropped below heavy (weather cleared mid-storm) — stop scheduling
        // new strikes but let any already-queued pulse finish naturally
        // rather than snapping the sky back instantly mid-flash.
        if (nextStrikeAt !== 0 && now > nextStrikeAt) nextStrikeAt = 0;
    } else {
        if (nextStrikeAt === 0) nextStrikeAt = now + 1500; // just crossed into heavy — first strike soon, not instant
        if (now >= nextStrikeAt) scheduleStrike(now, (rainIntensity - HEAVY_THRESHOLD) / (1 - HEAVY_THRESHOLD));
    }

    // Sum whatever pulses are currently active (two overlapping pulses from
    // a double-strike should read brighter than either alone, not clip to
    // the louder one).
    let flash = 0;
    pulses = pulses.filter((p) => now < p.start + p.dur + 220);
    for (const p of pulses) {
        if (now < p.start) continue;
        const t = (now - p.start) / p.dur;
        // Fast rise, slower decay — a real flash's brightness curve, not a
        // symmetric triangle.
        const curve = t < 0.15 ? t / 0.15 : Math.exp(-(t - 0.15) * 3.2);
        flash += p.peak * Math.max(0, curve);
    }
    flash = Math.min(1, flash);

    flashEl.style.opacity = (flash * 0.85).toFixed(3);
    if (state.cloudMat) state.cloudMat.uniforms.uFlash.value = flash;
    if (hemiLight) hemiLight.intensity += flash * 1.4;
    if (sunLight) sunLight.intensity += flash * 1.1;
}
