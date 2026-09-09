// Real audio system — was fully missing before (masterVolume/ambienceVolume/
// sfxVolume sliders persisted to core/settings.js but nothing downstream
// ever read them; core/input.js's comment called this out explicitly as
// "STUBBED"). This file builds the actual plumbing: an AudioContext with
// three gain buses (master -> destination, ambience/sfx -> master) so the
// three sliders have something real to control, plus load/play helpers for
// whenever actual sound files exist.
//
// What this does NOT do: play any sound. There are still no audio assets
// anywhere in this project (no .mp3/.ogg/.wav files, nothing referenced by
// path) — building the manager doesn't fabricate content that isn't there.
// Once asset files exist, playSfx()/playAmbience() below are the two calls
// that actually trigger them; until then this is inert but no longer a
// dead stub — moving a slider immediately changes state.audio's live gain
// values, verifiable in isolation even with silence to multiply against.

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
