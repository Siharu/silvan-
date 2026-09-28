import * as THREE from 'three';
import { state, SOUNDS } from './state.js';
import { getElevation } from './utils.js';
import { POIS } from '../environment/pois.js';

const _dirVec = new THREE.Vector3();

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

    // Phase 5 #35: positional fire audio at Warm Paw via Howler's 3D
    // panner, mirroring FIRE_RANGE=15 from poi-warm-paw.js so the audio
    // falls off over roughly the same distance the firelight does.
    // initAudio() runs after createPOIs() (see main.js's init()), so
    // Warm Paw's collider — and therefore its elevation — already exists.
    state.fireAudio = new Howl({ src: [SOUNDS.fire], loop: true, volume: 0.8 });
    const warmPaw = POIS.find((poi) => poi.id === 'warm_paw');
    if (warmPaw) {
        const fireY = getElevation(warmPaw.x, warmPaw.z) + 0.5;
        state.fireAudio.pos(warmPaw.x, fireY, warmPaw.z);
        state.fireAudio.pannerAttr({ refDistance: 4, maxDistance: 40, rolloffFactor: 2, distanceModel: 'inverse' });
        // Started/paused with the other loops (enterGame/pauseGame in input.js),
        // not here — playing at init would run it under the title screen.
    }
}

// Keeps Howler's global listener locked to the camera every frame so the
// fire (and any future positional sound) pans/attenuates correctly as the
// player moves and looks around. Call once per frame from animate().
export function updateAudioListener(camera) {
    if (!camera) return;
    const p = camera.position;
    Howler.pos(p.x, p.y, p.z);
    const dir = camera.getWorldDirection(_dirVec);
    const up = camera.up;
    Howler.orientation(dir.x, dir.y, dir.z, up.x, up.y, up.z);
}

