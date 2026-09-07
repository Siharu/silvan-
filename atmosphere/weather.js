// Weather cycle — the missing piece behind state.currentRainIntensity.
// environment/rain.js (streaks + splashes), environment/puddles.js,
// environment/fireflies.js, and environment/dust.js all already read this
// value and react correctly, but main.js only ever set it once to 0 at
// init with a "weather system TBD" comment — nothing ever raised it, so
// it never actually rained. This is that system: a simple two-phase
// (dry/raining) state machine with randomized durations, easing
// state.currentRainIntensity smoothly toward a target rather than
// snapping, so transitions read as weather rolling in/out rather than a
// light switch.

import { getSettings } from '../core/settings.js';

export function createWeather(state) {
    state.weather = {
        phase: 'dry',
        targetIntensity: 0,
        timer: 30 + Math.random() * 60, // seconds until the first dry->raining roll
    };
}

const EASE_RATE = 0.15; // higher = faster transition into/out of rain; ~1/rate seconds to close 63% of the gap

export function updateWeather(state, delta) {
    const w = state.weather;
    if (!w) return;

    if (getSettings().disableWeather) {
        // Force the target back to dry and hold the phase there — don't
        // just zero currentRainIntensity directly, or the state machine
        // would immediately start easing back toward whatever
        // w.targetIntensity/timer was mid-storm the instant this gets
        // unchecked again.
        w.phase = 'dry';
        w.targetIntensity = 0;
        const current = state.currentRainIntensity || 0;
        state.currentRainIntensity = current + (0 - current) * Math.min(1, delta * EASE_RATE);
        return;
    }

    w.timer -= delta;
    if (w.timer <= 0) {
        if (w.phase === 'dry') {
            if (Math.random() < 0.35) { // 35% chance each roll to start raining
                w.phase = 'raining';
                w.targetIntensity = 0.4 + Math.random() * 0.6; // storms vary in strength
                w.timer = 45 + Math.random() * 90; // how long this rain lasts
            } else {
                w.timer = 30 + Math.random() * 60; // stay dry, check again later
            }
        } else {
            w.phase = 'dry';
            w.targetIntensity = 0;
            w.timer = 60 + Math.random() * 120; // dry spell before the next roll
        }
    }

    const current = state.currentRainIntensity || 0;
    state.currentRainIntensity = current + (w.targetIntensity - current) * Math.min(1, delta * EASE_RATE);
}
