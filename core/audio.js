import { state, SOUNDS } from './state.js';

// Howler audio instances — split out of the original monolithic init() so
// audio setup can be reasoned about (and swapped) independently of the
// Three.js scene bootstrap in main.js.
export function initAudio() {
    state.dayAmbientAudio = new Howl({ src: [SOUNDS.dayAmbient], loop: true, volume: 0 });
    state.nightAmbientAudio = new Howl({ src: [SOUNDS.nightAmbient], loop: true, volume: 0 });
    state.windAudio = new Howl({ src: [SOUNDS.wind], loop: true, volume: 0 });
    state.waterAudio = new Howl({ src: [SOUNDS.water], loop: true, volume: 0 });
    state.rainAudio = new Howl({ src: [SOUNDS.rain], loop: true, volume: 0 });
    state.stepAudio = new Howl({ src: [SOUNDS.footstep], volume: 0.25, rate: 1.1, pool: 5 });
}
