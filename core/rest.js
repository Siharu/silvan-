// Rest mechanic — time-skip/sleep, per your call: no stamina system, resting
// jumps state.gameTime straight to next dawn. Was fully unimplemented before
// (touch-rest-btn and the "HOLD 'R' TO REST" HUD hint existed with nothing
// behind either) — blocked on exactly the two things this file resolves:
// a free key (R was already claimed by fast-forward, so this binds to a new
// `rest` keybind — see core/keybinds.js) and a definition of what resting
// actually does (time-skip, decided over stamina/sleep-meter).

const HOLD_DURATION = 1.2; // seconds — matches the HUD's existing "HOLD" language rather than a single tap, so it can't be triggered by an accidental key brush
const DAWN_GAME_TIME = 0.27; // gameTime is 0..1 -> *24 = timeOfDay hours; 0.27*24 ≈ 6:29am, just past the night->day threshold in day-night-cycle.js's sunHeightNormalized math
const FADE_MS = 1400; // matches the CSS transition duration on .rest-fade-overlay/.rest-fade-text in index.html

let holdStart = null;

// Called every frame with whether the rest key/button is currently held.
// Returns nothing — triggers the actual sleep transition internally once
// HOLD_DURATION is reached.
export function updateRestHold(state, held) {
    if (state.isPaused || state.isResting || state.isNapping || state.dialogueActive) { holdStart = null; return; }

    if (!held) { holdStart = null; return; }
    if (holdStart === null) holdStart = state.clock.elapsedTime;

    if (state.clock.elapsedTime - holdStart >= HOLD_DURATION) {
        holdStart = null;
        startRest(state);
    }
}

export function startRest(state) {
    if (state.isResting || state.isNapping) return;
    state.isResting = true; // read by main.js's _updatePlayer to freeze movement, same pattern as state.isPaused

    const overlay = document.getElementById('rest-fade-overlay');
    const text = document.getElementById('rest-fade-text');
    if (text) text.textContent = 'Resting...';
    if (overlay) overlay.classList.add('active');
    if (text) text.classList.add('active');

    setTimeout(() => {
        // Jump to next dawn. gameTime isn't day-counted anywhere else in
        // this project (day-night-cycle.js derives everything from
        // gameTime*24 mod nothing — it's a single repeating 0..1 cycle),
        // so simply setting it to DAWN_GAME_TIME is "advance to the next
        // morning" whether the player rested at noon or at 3am.
        state.gameTime = DAWN_GAME_TIME;

        setTimeout(() => {
            if (overlay) overlay.classList.remove('active');
            if (text) text.classList.remove('active');
            state.isResting = false;
        }, 400); // brief hold on full black before fading back in, so the time-jump isn't visible mid-transition
    }, FADE_MS);
}

// --- Kat nap (replaces the old continuous fast-forward toggle) --------
//
// Your idea: instead of a ">>" speed-up-time toggle, a one-shot nap —
// Kat's eyes close, gameTime jumps forward a random 5-6 hours, and
// whatever time that lands on is whatever time it is when she wakes
// (unlike startRest() above, which always snaps to dawn specifically).
// Land late enough in the day and the nap crosses into night — that's
// the intended "sometimes wakes up at night" outcome, it just falls out
// of the math rather than being a separate rolled chance.
//
// Reuses the same #rest-fade-overlay/#rest-fade-text elements as
// startRest() (screen-to-black already reads as "eyes closing" from a
// first-person view) rather than adding a second overlay pair. NOTE: I
// don't have core/player-controller.js in what you gave me, so I can't
// see whether Kat's own rig/eye mesh (the blink-scale system in
// environment/animals.js) is even visible in your camera mode. If it
// is (third-person or a mirror/reflection), driving rig.lEye/rEye scale
// to ~0.05 for the nap's duration would need a hook added there — happy
// to wire that once I can see that file.
const NAP_MIN_HOURS = 5;
const NAP_RANGE_HOURS = 1; // 5 + [0..1) -> 5-6 hours total

export function triggerKatNap(state) {
    if (state.isPaused || state.isResting || state.isNapping || state.dialogueActive) return;
    state.isNapping = true;
    state.isResting = true; // reuse the same movement-freeze flag main.js's _updatePlayer already checks

    const overlay = document.getElementById('rest-fade-overlay');
    const text = document.getElementById('rest-fade-text');
    const clock = document.getElementById('nap-clock');
    if (text) text.textContent = "Kat's eyes grow heavy...";
    if (overlay) overlay.classList.add('active');
    if (text) text.classList.add('active');
    if (clock) clock.classList.add('active');

    setTimeout(() => {
        const hoursForward = NAP_MIN_HOURS + Math.random() * NAP_RANGE_HOURS;
        state.gameTime = (state.gameTime + hoursForward / 24) % 1;

        setTimeout(() => {
            if (overlay) overlay.classList.remove('active');
            if (text) text.classList.remove('active');
            if (clock) clock.classList.remove('active');
            state.isResting = false;
            state.isNapping = false;
        }, 400);
    }, FADE_MS);
}
