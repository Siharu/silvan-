// Screen Wake Lock: nothing was stopping a phone from auto-locking its screen
// mid-session, which on a slow-paced exploration/atmosphere game like this
// happens constantly (reading a POI caption, standing still to look at the
// sky) — the lock is released by the OS the instant the screen blanks, there
// is no "resume play" from that, so this matters more here than in a twitchy
// action game.
//
// Support (mobile layout guide, section 9): Chrome for Android has had it a
// long time; iPhone Safari only from 16.4. Needs a secure context (https or
// localhost) — silently unavailable on plain-http hosting. Feature-detected
// and optional everywhere: nothing else in the game depends on this working.
//
// The OS releases the lock whenever the tab is hidden (visibilitychange),
// so it has to be re-requested every time play resumes, not just once.
let wakeLock = null;

async function request() {
    if (!('wakeLock' in navigator)) return; // unsupported browser/engine, or insecure context
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) {
        // Most commonly: page not visible yet, battery saver, or permissions policy —
        // none of these are worth surfacing to the player.
        wakeLock = null;
    }
}

// Call from the same gesture that starts/resumes play (enterGame(), the pause
// menu's Resume, pointerlockchange re-lock) — the request has no hard
// same-gesture requirement like pointer lock/fullscreen do, but tying it to
// those moments means it's re-acquired exactly when "the screen should stay
// on" becomes true again, including after the OS auto-released it on hide.
export function requestWakeLock() {
    request();
}

// Re-request when the tab becomes visible again while still mid-game, since
// the lock was auto-released on the way out. Call setupWakeLockLifecycle()
// once; it decides whether to re-acquire using the isPlaying() check passed in.
export function setupWakeLockLifecycle(isPlaying) {
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isPlaying()) request();
    });
}
