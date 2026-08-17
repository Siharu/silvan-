// SOUNDS config + Howl instance setup, and the play/pause/resume wiring
// that used to live inline in setupInput()'s start-button handler and the
// pointerlockchange listener. Per-frame volume crossfades (day/night/wind/
// rain/water proximity) stay in atmosphere/day-night-cycle.js since they're
// driven by the same time-of-day/weather math as the visuals.
//
// TODO (open item): replace the placeholder `wind`, `water`, and
// `nightAmbient` URLs below with verified dedicated tracks — they currently
// all point at the same freesound fallback loop.

export const SOUNDS = {
    dayAmbient: 'https://assets.mixkit.co/sfx/download/mixkit-forest-birds-ambience-1210.mp3', // Daytime birds/forest layer
    nightAmbient: 'https://freesound.org/data/previews/174/174763_2437358-lq.mp3', // Fallback night/base layer - swap for a crickets/owl loop if you have one
    wind: 'https://freesound.org/data/previews/174/174763_2437358-lq.mp3', // TODO: swap for a dedicated wind-through-trees loop
    water: 'https://freesound.org/data/previews/174/174763_2437358-lq.mp3', // TODO: swap for a dedicated lake/water lapping loop
    rain: 'https://freesound.org/data/previews/258/258113_3263906-lq.mp3',
    footstep: 'https://freesound.org/data/previews/336/336598_5121236-lq.mp3'
};

// mixkit/freesound don't reliably allow hotlinking (403/CORS depending on
// referrer + token expiry) — wrap creation so a dead track just stays
// silent instead of spamming console errors / throwing mid-play(). Host
// these yourself when you can; until then this is a soft-fail shim.
function safeHowl(src, opts) {
    const howl = new Howl({ src: [src], ...opts, onloaderror: (id, err) => {
        console.warn(`[ambience] failed to load ${src}:`, err);
    }, onplayerror: (id, err) => {
        console.warn(`[ambience] failed to play ${src}:`, err);
    } });
    return howl;
}

export function createAmbientAudio(state) {
    state.dayAmbientAudio = safeHowl(SOUNDS.dayAmbient, { loop: true, volume: 0 });
    state.nightAmbientAudio = safeHowl(SOUNDS.nightAmbient, { loop: true, volume: 0 });
    state.windAudio = safeHowl(SOUNDS.wind, { loop: true, volume: 0 });
    state.waterAudio = safeHowl(SOUNDS.water, { loop: true, volume: 0 });
    state.rainAudio = safeHowl(SOUNDS.rain, { loop: true, volume: 0 });
    state.stepAudio = safeHowl(SOUNDS.footstep, { volume: 0.25, rate: 1.1, pool: 5 });
}

function safePlay(howl) {
    try { if (!howl.playing()) howl.play(); } catch (e) { /* dead track, already logged on load */ }
}

export function resumeAmbientAudio(state) {
    if (Howler.ctx && Howler.ctx.state === 'suspended') Howler.ctx.resume();
    safePlay(state.dayAmbientAudio);
    safePlay(state.nightAmbientAudio);
    safePlay(state.windAudio);
    safePlay(state.waterAudio);
    safePlay(state.rainAudio);
}

export function pauseAmbientAudio(state) {
    state.dayAmbientAudio.pause();
    state.nightAmbientAudio.pause();
    state.windAudio.pause();
    state.waterAudio.pause();
    state.rainAudio.pause();
}

// Every per-frame ambient volume() call (atmosphere/day-night-cycle.js,
// core/player-controller.js's swim water-audio swell) sets its own channel
// volume independently — rather than threading a multiplier through every
// individual call site (fragile: easy to add a new sound later and forget
// it, and stepAudio's volume is only ever set once at creation in
// createAmbientAudio() above, never touched per-frame, so a per-call
// multiplier would silently miss it entirely), the pause menu's volume
// slider uses Howler's own global gain node instead. One call reaches
// every channel — present and future — automatically.
export function setMasterVolume(state, value) {
    state.masterVolume = value;
    Howler.volume(value);
}
