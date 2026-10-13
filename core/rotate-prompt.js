// "Turn your phone" overlay (markup #rotate-prompt, styles in the silvan-rotate-prompt
// block of index.html).
//
// Visibility is pure CSS: phone + portrait + not dismissed (see core/viewport.js, which
// owns data-device / data-orientation). So rotating the phone, by hand or by the lock
// below, hides it with no JS involved.
//
// Tapping it asks the browser to rotate FOR the player: fullscreen, then
// screen.orientation.lock('landscape'). Honest limits:
//   - Android Chrome (and most Chromium browsers): works, but only once fullscreen
//     succeeds, and only from a real tap (a user gesture) - which is why it is a click handler.
//   - iPhone Safari/Chrome: no orientation lock and no fullscreen for pages, so there is
//     nothing to call. The overlay then asks the player to turn the phone themselves.
//   - Desktop / tablets never see it.
// "continue in portrait" dismisses it for the rest of this browser session.
const KEY = 'silvan-rotate-dismissed';

export function setupRotatePrompt() {
    const el = document.getElementById('rotate-prompt');
    if (!el) return;
    const root = document.documentElement;
    const sub = document.getElementById('rp-sub');
    const skip = document.getElementById('rp-skip');
    const subDefault = sub ? sub.textContent : '';

    try { if (sessionStorage.getItem(KEY) === '1') root.setAttribute('data-rotate-dismissed', ''); } catch (e) { /* storage blocked: it just shows again next load */ }

    const dismiss = () => {
        root.setAttribute('data-rotate-dismissed', '');
        try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
    };
    if (skip) skip.addEventListener('click', (ev) => { ev.stopPropagation(); dismiss(); });

    let busy = false;
    const rotate = async () => {
        if (busy) return;
        busy = true;
        el.removeAttribute('data-failed');
        try {
            if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
        } catch (e) { /* refused: still try the lock, some browsers allow it without fullscreen */ }
        let locked = false;
        try {
            if (screen.orientation && screen.orientation.lock) { await screen.orientation.lock('landscape'); locked = true; }
        } catch (e) { /* unsupported / not allowed here */ }
        busy = false;
        if (!locked) {
            el.setAttribute('data-failed', '');
            if (sub) sub.textContent = "This browser can't rotate for you. Turn your phone sideways.";
        } else if (sub) {
            sub.textContent = subDefault;
        }
    };
    el.addEventListener('click', rotate);
    el.addEventListener('keydown', (ev) => {
        if (ev.target !== el) return; // let the "continue in portrait" button handle its own Enter/Space
        if (ev.code === 'Enter' || ev.code === 'Space') { ev.preventDefault(); rotate(); }
    });
}
