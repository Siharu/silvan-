import { state } from './state.js';
import { writeLocalSave } from './save-system.js';

// B-17: "Hold to rest" was just `timeMultiplier = keys.g ? 50 : 1` anywhere,
// with no feedback — fast-forwarding also fast-forwarded weather/rain with
// nothing on screen telling you it happened. index.html already had the
// fade overlay, "Resting..." text, and a fully-built nap-clock SVG sitting
// unused, with comments pointing at a core/rest.js that wasn't in this zip
// (startRest() / triggerKatNap()) — this file is that module, built to
// match what those comments describe.
//
// NOTE on triggerKatNap(): the comments reference "Kat's nap" as a named
// beat, but nothing else in this codebase (POIs, journal, tutorial copy)
// establishes who/what Kat is or when a nap specifically (vs. an ordinary
// rest) should fire. Rather than invent that, hold-G below always calls
// the plain startRest(). triggerKatNap() is built to spec and exported so
// a specific POI/story trigger can call it once that's actually decided —
// flagging the gap instead of guessing at it.

const FADE_MS = 1400;
const HOLD_SEC = 1.2;      // how long G must be held before rest fires
const DAWN_TIME = 0.27;    // just past day-night-cycle.js's isNight cutoff (0.25)
const WAKE_MS = 1300;      // matches the .waking / rest-wake-blink animation duration

let overlay, textEl, clockEl, hourHand, minuteHand;
let holdT = 0;
let active = false; // whole sequence in flight (fade out -> skip -> fade/wake back in)

function els() {
    if (!overlay) overlay = document.getElementById('rest-fade-overlay');
    if (!textEl) textEl = document.getElementById('rest-fade-text');
    if (!clockEl) clockEl = document.getElementById('nap-clock');
    if (!hourHand) hourHand = document.getElementById('nap-clock-hour-hand');
    if (!minuteHand) minuteHand = document.getElementById('nap-clock-minute-hand');
}

// Jumps gameTime to the next dawn (today's if it hasn't happened yet,
// tomorrow's otherwise) and returns hours slept, for the clock math.
function advanceToNextDawn() {
    const before = state.gameTime;
    let target = DAWN_TIME;
    if (target <= before) target += 1.0;
    const hoursSlept = (target - before) * 24;
    state.gameTime = target % 1.0;
    if (target >= 1.0) state.daysPassed = (state.daysPassed || 0) + 1;
    return hoursSlept;
}

// Plain dawn-skip: flat fade to black + "Resting..." text, jump time,
// flat fade back in. This is what hold-G actually triggers.
export function startRest() {
    if (active || !state.isPlaying) return;
    els();
    if (!overlay || !textEl) return; // markup missing — fail quiet, don't freeze the player
    active = true;
    state.isResting = true;
    overlay.classList.add('active');
    textEl.classList.add('active');
    setTimeout(() => {
        advanceToNextDawn();
        writeLocalSave(); // B-18: autosave while the screen is still black, not after fade-in
        overlay.classList.remove('active');
        textEl.classList.remove('active');
        setTimeout(() => { active = false; state.isResting = false; }, FADE_MS);
    }, FADE_MS);
}

// Fancier variant per the CSS comments: nap-clock appears, hands sweep
// real hour/minute math (30deg/hr, 360deg/hr) for however long gameTime
// actually jumps, and the wake-up uses the eyes-fluttering .waking
// animation instead of a flat fade. Not called anywhere yet — see the
// file header note.
export function triggerKatNap() {
    if (active || !state.isPlaying) return;
    els();
    if (!overlay || !textEl || !clockEl || !hourHand || !minuteHand) return;
    active = true;
    state.isResting = true;
    overlay.classList.add('active');
    textEl.classList.add('active');
    clockEl.classList.add('active');
    setTimeout(() => {
        const hoursSlept = advanceToNextDawn();
        writeLocalSave(); // B-18: same autosave point as startRest(), screen still black
        hourHand.style.transform = `rotate(${hoursSlept * 30}deg)`;
        minuteHand.style.transform = `rotate(${hoursSlept * 360}deg)`;
        setTimeout(() => {
            overlay.classList.remove('active'); overlay.classList.add('waking');
            textEl.classList.remove('active');
            clockEl.classList.remove('active'); clockEl.classList.add('waking');
            setTimeout(() => {
                overlay.classList.remove('waking');
                clockEl.classList.remove('waking');
                hourHand.style.transform = 'rotate(0deg)';
                minuteHand.style.transform = 'rotate(0deg)';
                active = false;
                state.isResting = false;
            }, WAKE_MS);
        }, FADE_MS);
    }, FADE_MS);
}

// Call every frame (main.js animate loop, inside the isPlaying gate).
// Replaces the old free `timeMultiplier = keys.g ? 50 : 1` — holding G
// now charges toward one real rest event instead of silently speeding up
// time for as long as it's held, anywhere, with nothing shown for it.
export function updateRest(delta) {
    if (active) { holdT = 0; return; }
    if (state.keys.g) {
        holdT += delta;
        if (holdT >= HOLD_SEC) { holdT = 0; startRest(); }
    } else {
        holdT = 0;
    }
}
