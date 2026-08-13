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

export function createAmbientAudio(state) {
    state.dayAmbientAudio = new Howl({ src: [SOUNDS.dayAmbient], loop: true, volume: 0 });
    state.nightAmbientAudio = new Howl({ src: [SOUNDS.nightAmbient], loop: true, volume: 0 });
    state.windAudio = new Howl({ src: [SOUNDS.wind], loop: true, volume: 0 });
    state.waterAudio = new Howl({ src: [SOUNDS.water], loop: true, volume: 0 });
    state.rainAudio = new Howl({ src: [SOUNDS.rain], loop: true, volume: 0 });
    state.stepAudio = new Howl({ src: [SOUNDS.footstep], volume: 0.25, rate: 1.1, pool: 5 });
}

export function resumeAmbientAudio(state) {
    if (Howler.ctx && Howler.ctx.state === 'suspended') Howler.ctx.resume();
    if (!state.dayAmbientAudio.playing()) state.dayAmbientAudio.play();
    if (!state.nightAmbientAudio.playing()) state.nightAmbientAudio.play();
    if (!state.windAudio.playing()) state.windAudio.play();
    if (!state.waterAudio.playing()) state.waterAudio.play();
    if (!state.rainAudio.playing()) state.rainAudio.play();
}

export function pauseAmbientAudio(state) {
    state.dayAmbientAudio.pause();
    state.nightAmbientAudio.pause();
    state.windAudio.pause();
    state.waterAudio.pause();
    state.rainAudio.pause();
}
