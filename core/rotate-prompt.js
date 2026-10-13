// "Turn your phone" overlay (markup #rotate-prompt, styles in the silvan-rotate-prompt
// block of index.html).
//
// Visibility is pure CSS: phone + portrait + not dismissed (see core/viewport.js, which
// owns data-device / data-orientation). So rotating the phone, by hand or by the lock
// below, hides it with no JS involved.
//
// Tapping it asks the device to rotate FOR the player via platform.requestLandscape()
// (core/platform.js: fullscreen + screen.orientation.lock('landscape'), or the Capacitor
// ScreenOrientation plugin inside an app shell). Whether that can work is known up front
// from platform.canAutoRotate, so on a device where it cannot (every iPhone browser) the
// overlay goes straight to "turn it yourself" with no dead "tap to rotate" button.
// Needs a real tap (a user gesture), which is why it is a click handler.
// "continue in portrait" dismisses it for the rest of this browser session.
import { platform, requestLandscape } from './platform.js';

const KEY = 'silvan-rotate-dismissed';
const MSG_MANUAL = "This browser can't rotate for you. Turn your phone sideways.";

export function setupRotatePrompt() {
    const el = document.getElementById('rotate-prompt');
    if (!el) return;
    const root = document.documentElement;
    const sub = document.getElementById('rp-sub');
    const skip = document.getElementById('rp-skip');
    const subDefault = sub ? sub.textContent : '';

    const manual = () => { el.setAttribute('data-failed', ''); if (sub) sub.textContent = MSG_MANUAL; };
    if (!platform.canAutoRotate) manual();

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
        if (sub) sub.textContent = subDefault;
        const r = await requestLandscape();
        busy = false;
        if (!r.ok) manual();
    };
    el.addEventListener('click', rotate);
    el.addEventListener('keydown', (ev) => {
        if (ev.target !== el) return; // let the "continue in portrait" button handle its own Enter/Space
        if (ev.code === 'Enter' || ev.code === 'Space') { ev.preventDefault(); rotate(); }
    });
}
