// Device/viewport classifier for responsive layout.
//
// Why this exists: the title screen and in-game HUD only had two fixed
// width breakpoints (640px / 420px, see index.html). That covers "is this
// a narrow phone in portrait" and nothing else — a tablet in portrait gets
// treated as desktop (menu text/panels sized for a mouse+1920px, too small
// to tap comfortably), and ANY device in landscape with a short viewport
// (a phone turned sideways, which is how most people actually play a
// touch game) got no adjustment at all: the title-content flex column,
// the pause panel, and the pre-game tutorial cards all assume there's
// enough vertical room to stack kicker + logo + rule + desc + menu, which
// a ~360-430px-tall landscape phone screen does not have. That's the
// "stuff doesn't adjust on mobile" the audit flagged.
//
// Fix: classify by CAPABILITY + SHAPE, not just width, and write the
// result onto <html> as data-attributes so CSS can target it with plain
// selectors. Re-run on resize/orientationchange (and visualViewport's
// resize, which fires for on-screen-keyboard/URL-bar changes that
// 'resize' alone sometimes misses on mobile Safari) so rotating the
// device or the browser chrome showing/hiding re-classifies live instead
// of freezing whatever layout happened to be true on load.
//
//   data-device      "phone" | "tablet" | "desktop"   (coarse pointer + size)
//   data-orientation "portrait" | "landscape"
//   data-compact-h    present when the viewport is too SHORT to fit the
//                     normal vertical stack regardless of device class
//                     (covers landscape phones AND small browser windows)
//
// Call setupViewport() once from main.js's init(), before the title
// screen is shown.

function classify() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const coarsePointer = matchMedia('(pointer: coarse)').matches;
    const orientation = w >= h ? 'landscape' : 'portrait';

    // Phone vs tablet vs desktop: a touch device under ~820px in its
    // SHORT axis reads as a phone regardless of which way it's held
    // (820 covers iPhone Pro Max/most Android phablets at 1x even in
    // landscape, where innerWidth alone would wrongly say "tablet").
    // A coarse-pointer device above that is a tablet. Anything with a
    // fine pointer (mouse/trackpad) is desktop even if the window is
    // narrow — resizing a desktop browser window shouldn't switch the
    // layout into touch-sized tap targets that nothing will ever tap.
    const shortAxis = Math.min(w, h);
    let device;
    if (!coarsePointer) device = 'desktop';
    else if (shortAxis < 820) device = 'phone';
    else device = 'tablet';

    const root = document.documentElement;
    root.setAttribute('data-device', device);
    root.setAttribute('data-orientation', orientation);
    // Compact-height: not enough vertical room for the title screen's
    // full stack (logo + desc + 5-item menu) or the pause panel's
    // tab content at comfortable spacing. ~520px is where those start
    // clipping/overlapping in the existing markup — true for most
    // landscape phones, some split-screen desktop windows, and foldables
    // in their folded state.
    if (h < 520) root.setAttribute('data-compact-h', '');
    else root.removeAttribute('data-compact-h');

    // iOS Safari/Chrome address-bar show/hide changes innerHeight without
    // firing a layout recalc of % / 100vh-based heights consistently —
    // --app-vh is a measured 1% of the REAL current viewport, so
    // `height: calc(var(--app-vh) * 100)` tracks it instead of guessing.
    root.style.setProperty('--app-vh', (h * 0.01) + 'px');
}

let scheduled = false;
function scheduleClassify() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; classify(); });
}

export function setupViewport() {
    classify();
    window.addEventListener('resize', scheduleClassify);
    window.addEventListener('orientationchange', scheduleClassify);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleClassify);
    }
}
