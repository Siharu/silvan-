// Real audio system — was fully missing before (masterVolume/ambienceVolume/
// sfxVolume sliders persisted to core/settings.js but nothing downstream
// ever read them; core/input.js's comment called this out explicitly as
// "STUBBED"). This file builds the actual plumbing: an AudioContext with
// three gain buses (master -> destination, ambience/sfx -> master) so the
// three sliders have something real to control, plus load/play helpers for
// whenever actual sound FILE assets exist (playSfx/playAmbience, for a
// future .mp3/.ogg/.wav pipeline — still none in the project).
//
// In the meantime, playUiClick()/playFootstep()/startAmbience() below are
// genuinely audible right now — synthesized directly with Web Audio nodes
// rather than left silent, since there's no way to source external audio
// files in this environment. Lo-fi synthesized SFX also isn't a downgrade
// here — it fits the PS2-retro visual language already established
// elsewhere in the project.

let ctx = null;
let masterGain = null;
let ambienceGain = null;
let sfxGain = null;
const bufferCache = new Map(); // url -> decoded AudioBuffer, so a repeated sfx (footsteps, etc.) doesn't refetch/redecode every play
const activeAmbience = new Map(); // name -> { source, gainNode } for loop/stop control

// Browsers refuse to start an AudioContext before a user gesture, so this
// is called from main.js's existing pointer-lock click handler (the first
// real gesture the game already requires) rather than from init() directly.
export function ensureAudioContext(state) {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null; // very old/unsupported browser — audio just stays silent, nothing else in the game depends on it
    ctx = new AC();
    masterGain = ctx.createGain();
    ambienceGain = ctx.createGain();
    sfxGain = ctx.createGain();
    ambienceGain.connect(masterGain);
    sfxGain.connect(masterGain);
    masterGain.connect(ctx.destination);
    state.audio = { ctx, masterGain, ambienceGain, sfxGain };
    syncVolumesFromSettings(state);
    return ctx;
}

// Call whenever a volume slider changes (core/input.js's wireLiveControl
// onLive callbacks) and once after ensureAudioContext — this is the actual
// live effect the sliders were missing.
export function syncVolumesFromSettings(state) {
    if (!ctx || !state.settings) return;
    masterGain.gain.value = state.settings.masterVolume ?? 1.0;
    ambienceGain.gain.value = state.settings.ambienceVolume ?? 1.0;
    sfxGain.gain.value = state.settings.sfxVolume ?? 1.0;
}

async function loadBuffer(url) {
    if (bufferCache.has(url)) return bufferCache.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`audio fetch failed: ${url} (${res.status})`);
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    bufferCache.set(url, buf);
    return buf;
}

// One-shot sound effect (footsteps, interactions, UI). Silently no-ops if
// the file doesn't exist yet or the context isn't ready — a missing sfx
// file shouldn't throw and interrupt gameplay.
export async function playSfx(url, { volume = 1.0 } = {}) {
    if (!ctx) return;
    try {
        const buf = await loadBuffer(url);
        const source = ctx.createBufferSource();
        source.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.connect(gain).connect(sfxGain);
        source.start();
    } catch (e) {
        console.warn('[audio] playSfx failed:', e.message);
    }
}

// --- PROCEDURAL SFX — there are no audio asset files anywhere in this
// project (see the file-level comment above), and no way to source
// external ones here. These are synthesized directly with the Web Audio
// nodes already wired above rather than left silent — genuinely audible,
// not a stub, and the lo-fi synthesized character actually fits the
// PS2-retro visual language the rest of the project leans into.

// Short UI blip for menu buttons — two quick sine partials with a fast
// exponential decay, closer to an old console menu "beep" than a modern
// soft click.
export function playUiClick(state) {
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(720, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.06);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);
}

// Single footstep — filtered noise burst (a real footstep is closer to
// noise than a tone), pitch/tone varies slightly per call so a run of
// them doesn't sound like one sample looping.
export function playFootstep(state, { onGrass = false } = {}) {
    if (!ctx) return;
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.12;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = (onGrass ? 900 : 500) + (Math.random() - 0.5) * 200; // grass reads brighter/rustlier than bare dirt
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12 + Math.random() * 0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    noise.connect(filter).connect(gain).connect(sfxGain);
    noise.start(now);
}

// Continuous ambient forest drone — filtered noise with a slow LFO on the
// filter cutoff, so it breathes instead of holding a flat static hiss.
// Started once (main.js, right after the first pointer-lock click that
// unlocks the AudioContext) and left running at ambienceGain's volume for
// the whole session.
export function startAmbience(state) {
    if (!ctx || activeAmbience.has('forest')) return;
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.7;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07; // very slow — a gentle wind-swell breathing cycle, not an audible wobble
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    const gain = ctx.createGain();
    gain.gain.value = 0.05; // deliberately faint — this is a bed, not a foreground sound
    noise.connect(filter).connect(gain).connect(ambienceGain);
    noise.start();
    activeAmbience.set('forest', { source: noise, gainNode: gain, lfo });
}

// Looping ambient bed (wind, water, rain, day/night tone). `name` is a
// caller-chosen key so a second call with the same name can restart/replace
// it via stopAmbience(name) first, rather than layering duplicates.
export async function playAmbience(name, url, { volume = 1.0, loop = true } = {}) {
    if (!ctx) return;
    try {
        const buf = await loadBuffer(url);
        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.loop = loop;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.connect(gain).connect(ambienceGain);
        source.start();
        activeAmbience.set(name, { source, gainNode: gain });
    } catch (e) {
        console.warn('[audio] playAmbience failed:', e.message);
    }
}

export function stopAmbience(name) {
    const entry = activeAmbience.get(name);
    if (!entry) return;
    entry.source.stop();
    activeAmbience.delete(name);
}
