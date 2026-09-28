import { state } from './state.js';

// Tiny synthesized dialogue blip (no asset file needed) for the typewriter
// text. Silent if the Web Audio context isn't up yet.
export function playBlip(seed = 0) {
    const ctx = window.Howler && Howler.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 260 + (seed % 7) * 22 + Math.random() * 30;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.03 * (state.masterVolume ?? 1), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.08);
}
