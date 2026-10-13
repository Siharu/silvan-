// Device + runtime detection: "what is this thing the game is running on?"
//
// ONE place that answers it, for the browser today and for a wrapped exe/apk later.
//   const { platform } = await import('./platform.js')
//   platform.os          'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'chromeos' | 'unknown'
//   platform.browser     'chrome' | 'safari' | 'firefox' | 'edge' | 'samsung' | 'opera' | 'other'
//   platform.engine      'blink' | 'webkit' | 'gecko' | 'other'   (every iOS browser is webkit)
//   platform.runtime     'browser'  plain tab
//                        'pwa'      "Add to Home Screen" / installed web app (display-mode standalone)
//                        'twa'      Android app that wraps the site (opened from android-app://)
//                        'webview'  someone else's in-app browser (Instagram, Facebook...)
//                        'capacitor' | 'cordova'   our own Android/iOS app shell (apk / ipa)
//                        'electron' | 'tauri'      our own desktop shell (exe / dmg)
//   platform.native      true for capacitor/cordova/electron/tauri (an app WE ship)
//   platform.installed   native || twa || pwa
//   platform.touch / mouse / primaryInput    input hardware ('touch' | 'mouse')
//   platform.canAutoRotate   we can really ask this device to go landscape (see requestLandscape)
//   platform.cores / memoryGB / dpr          rough hardware hints (memoryGB is Chromium-only, 0 = unknown)
//
// LAYOUT class (phone / tablet / desktop, portrait / landscape) is NOT here: core/viewport.js owns
// html[data-device] / data-orientation and keeps doing so. This module owns the facts about the
// hardware + app shell, and writes them to <html> as data-os / data-browser / data-engine /
// data-runtime / data-input / data-auto-rotate so CSS can use them too.
//
// detect(env) is a PURE function of a plain object (no window access), so it can be tested with
// fake devices in Node. collectEnv() is the only code that touches window/navigator.
//
// Honest limits: user-agent strings are best-effort and browsers keep freezing/lying in them.
// Everything here is cross-checked with feature tests where one exists, and nothing in the game
// should hard-depend on a single field being right. The native-shell branches (capacitor, cordova,
// electron, tauri) follow those frameworks' documented globals but have NOT been run in a real
// apk/exe yet.

export function detect(env = {}) {
    const ua = env.ua || '';
    const uaData = env.uaData || null;
    const navPlatform = env.navPlatform || '';
    const touchPoints = env.maxTouchPoints || 0;
    const mq = typeof env.mq === 'function' ? env.mq : () => false;
    const g = env.globals || {};
    const pick = (re) => { const m = re.exec(ua); return m ? m[1] : ''; };

    // ---- OS (UA-CH platform first where Chromium gives it, then the UA string) ----
    let os = 'unknown', osVersion = '';
    const uaPlat = (uaData && uaData.platform ? String(uaData.platform) : '').toLowerCase();
    if (uaPlat === 'android' || /android/i.test(ua)) { os = 'android'; osVersion = pick(/Android[ /]?([\d.]+)/i); }
    else if (/iphone|ipod|ipad/i.test(ua) || (navPlatform === 'MacIntel' && touchPoints > 1)) {
        // iPadOS 13+ sends a desktop-Mac UA; a "Mac" with a touch screen is an iPad.
        os = 'ios';
        const m = /OS (\d+)[_.](\d+)/.exec(ua);
        osVersion = m ? m[1] + '.' + m[2] : '';
    }
    else if (uaPlat === 'chrome os' || /CrOS/.test(ua)) os = 'chromeos';
    else if (uaPlat === 'windows' || /windows/i.test(ua) || /^win/i.test(navPlatform)) os = 'windows';
    else if (uaPlat === 'macos' || /Macintosh|Mac OS X/.test(ua) || /^mac/i.test(navPlatform)) os = 'macos';
    else if (uaPlat === 'linux' || /linux|x11/i.test(ua)) os = 'linux';

    // ---- browser + engine (order matters: Edge/Opera/Samsung/Firefox all also say "Chrome" or "Safari") ----
    let browser = 'other', browserVersion = '';
    if (/EdgA?\/|EdgiOS\//.test(ua)) { browser = 'edge'; browserVersion = pick(/Edg(?:A|iOS)?\/(\d+)/); }
    else if (/OPR\/|OPiOS\//.test(ua)) { browser = 'opera'; browserVersion = pick(/OP(?:R|iOS)\/(\d+)/); }
    else if (/SamsungBrowser\//.test(ua)) { browser = 'samsung'; browserVersion = pick(/SamsungBrowser\/(\d+)/); }
    else if (/Firefox\/|FxiOS\//.test(ua)) { browser = 'firefox'; browserVersion = pick(/(?:Firefox|FxiOS)\/(\d+)/); }
    else if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) { browser = 'chrome'; browserVersion = pick(/(?:Chrome|CriOS|Chromium)\/(\d+)/); }
    else if (/Safari\//.test(ua) && /Version\//.test(ua)) { browser = 'safari'; browserVersion = pick(/Version\/(\d+)/); }
    let engine = 'other';
    if (os === 'ios') engine = 'webkit'; // Apple requires WebKit under every iOS browser
    else if (browser === 'firefox') engine = 'gecko';
    else if (browser === 'safari') engine = 'webkit';
    else if (browser !== 'other') engine = 'blink';

    // ---- runtime: are we a plain tab, an installed web app, or inside an app shell? ----
    let runtime = 'browser';
    if (g.electron || /Electron\//.test(ua)) runtime = 'electron';
    else if (g.tauri) runtime = 'tauri';
    else if (g.capacitorNative) runtime = 'capacitor';
    else if (g.cordova) runtime = 'cordova';
    else if ((env.referrer || '').startsWith('android-app://')) runtime = 'twa';
    else if (os === 'android' && /; wv\)/.test(ua)) runtime = 'webview';
    else if (os === 'ios' && !/Safari\//.test(ua)) runtime = 'webview'; // in-app WKWebView has no "Safari/" token
    else if (mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || mq('(display-mode: minimal-ui)') || g.navStandalone === true) runtime = 'pwa';
    const native = runtime === 'electron' || runtime === 'tauri' || runtime === 'capacitor' || runtime === 'cordova';
    const installed = native || runtime === 'twa' || runtime === 'pwa';

    // ---- input ----
    const touch = touchPoints > 0 || mq('(any-pointer: coarse)');
    const mouse = mq('(any-pointer: fine)');
    const primaryInput = mq('(pointer: coarse)') ? 'touch' : (mq('(pointer: fine)') ? 'mouse' : (touch && !mouse ? 'touch' : 'mouse'));

    // ---- can we really rotate this device for the player? ----
    // Web: needs screen.orientation.lock() (Chromium on Android; iOS has none) and, in a plain tab,
    // fullscreen first. An installed/native shell does not need the fullscreen step.
    // Capacitor: only if the ScreenOrientation plugin is registered in the app.
    const fullscreen = !!env.fullscreenEnabled;
    const orientationLock = !!env.orientationLock;
    const webRotate = os !== 'ios' && orientationLock && (fullscreen || runtime !== 'browser');
    const canAutoRotate = !!(g.capacitorScreenOrientation) || webRotate;

    return Object.freeze({
        os, osVersion, browser, browserVersion, engine,
        runtime, native, installed, inAppBrowser: runtime === 'webview',
        touch, mouse, primaryInput,
        fullscreen, orientationLock, canAutoRotate,
        cores: env.cores || 0, memoryGB: env.memory || 0, dpr: env.dpr || 1,
        screen: Object.freeze({ w: env.screenW || 0, h: env.screenH || 0 }),
        ua,
    });
}

// The only function that reads window / navigator / document.
export function collectEnv() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return {};
    const nav = navigator, w = window, C = w.Capacitor;
    const mq = (q) => { try { return !!matchMedia(q).matches; } catch (e) { return false; } };
    let capNative = false, capPlugin = false;
    try {
        capNative = !!(C && (C.isNativePlatform ? C.isNativePlatform() : (C.getPlatform && C.getPlatform() !== 'web')));
        capPlugin = !!(capNative && ((C.isPluginAvailable && C.isPluginAvailable('ScreenOrientation')) || (C.Plugins && C.Plugins.ScreenOrientation)));
    } catch (e) { /* a broken Capacitor global just means "not native" */ }
    return {
        ua: nav.userAgent || '',
        uaData: nav.userAgentData ? { platform: nav.userAgentData.platform, mobile: nav.userAgentData.mobile } : null,
        navPlatform: nav.platform || '',
        maxTouchPoints: nav.maxTouchPoints || 0,
        mq,
        screenW: screen.width, screenH: screen.height,
        dpr: w.devicePixelRatio || 1,
        cores: nav.hardwareConcurrency || 0,
        memory: nav.deviceMemory || 0,
        fullscreenEnabled: !!(document.fullscreenEnabled || document.webkitFullscreenEnabled),
        orientationLock: !!(screen.orientation && typeof screen.orientation.lock === 'function'),
        referrer: document.referrer || '',
        globals: {
            capacitorNative: capNative, capacitorScreenOrientation: capPlugin,
            cordova: !!w.cordova,
            electron: !!((w.process && w.process.versions && w.process.versions.electron) || w.electronAPI),
            tauri: !!(w.__TAURI__ || w.__TAURI_INTERNALS__),
            navStandalone: nav.standalone === true,
        },
    };
}

export const platform = detect(collectEnv());

export function applyAttributes(p = platform, root = (typeof document !== 'undefined' ? document.documentElement : null)) {
    if (!root) return;
    root.setAttribute('data-os', p.os);
    root.setAttribute('data-browser', p.browser);
    root.setAttribute('data-engine', p.engine);
    root.setAttribute('data-runtime', p.runtime);
    root.setAttribute('data-input', p.primaryInput);
    root.setAttribute('data-auto-rotate', p.canAutoRotate ? 'yes' : 'no');
}
applyAttributes(); // at import, so CSS has them before first paint

// ---- GPU hint (lazy: creating a throwaway WebGL context costs a few ms, so only when asked) ----
let _gpu = null;
export function gpuInfo() {
    if (_gpu) return _gpu;
    _gpu = { webgl2: false, webgl: false, renderer: '', vendor: '', software: false };
    if (typeof document === 'undefined') return _gpu;
    try {
        const c = document.createElement('canvas');
        let gl = c.getContext('webgl2');
        _gpu.webgl2 = !!gl;
        if (!gl) gl = c.getContext('webgl') || c.getContext('experimental-webgl');
        _gpu.webgl = !!gl;
        if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext) { _gpu.renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || ''); _gpu.vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || ''); }
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        }
    } catch (e) { /* no WebGL at all: the game would not run anyway */ }
    _gpu.software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(_gpu.renderer);
    return _gpu;
}

// Which quality tier to START on when the player has not chosen one. Deliberately conservative: it
// only ever steps DOWN from the old default ('medium') on strong "this will struggle" signals, and
// never auto-picks 'high', because a wrong guess that looks worse is a bigger sin than a wrong guess
// that is a little slower. The player's saved choice always wins (see settings.js loadQuality).
// Heuristic, not measured on real devices.
export function suggestQuality(p = platform, gpu = gpuInfo()) {
    if (gpu.software) return { key: 'low', reason: 'software renderer (no GPU)' };
    if (p.memoryGB && p.memoryGB <= 2) return { key: 'low', reason: 'device memory <= 2 GB' };
    if (p.touch && p.os === 'android' && p.cores && p.cores <= 4) return { key: 'low', reason: 'Android with <= 4 cores' };
    return { key: 'medium', reason: 'default' };
}

// Ask the device to go landscape. Returns { ok, how }. Must be called from a real tap/click.
// Android Chrome: fullscreen first, then screen.orientation.lock('landscape').
// Capacitor shell: its ScreenOrientation plugin, if the app registered it (untested; for an apk it is
// simpler and more reliable to set screenOrientation=sensorLandscape in AndroidManifest.xml, after
// which this overlay never needs to show).
export async function requestLandscape(p = platform) {
    if (p.runtime === 'capacitor') {
        try {
            const so = globalThis.Capacitor && globalThis.Capacitor.Plugins && globalThis.Capacitor.Plugins.ScreenOrientation;
            if (so && so.lock) { await so.lock({ orientation: 'landscape' }); return { ok: true, how: 'capacitor' }; }
        } catch (e) { /* fall through to the web route */ }
    }
    const root = document.documentElement;
    try {
        if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) { /* refused: some browsers still allow the lock without it */ }
    try {
        if (screen.orientation && screen.orientation.lock) { await screen.orientation.lock('landscape'); return { ok: true, how: 'web' }; }
    } catch (e) { /* not allowed / unsupported here */ }
    return { ok: false, how: 'none' };
}

// ---- human-readable line (bug reports, the Interface tab) ----
const OS_NAME = { android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', linux: 'Linux', chromeos: 'ChromeOS', unknown: 'Unknown OS' };
const BROWSER_NAME = { chrome: 'Chrome', safari: 'Safari', firefox: 'Firefox', edge: 'Edge', samsung: 'Samsung Internet', opera: 'Opera', other: 'Unknown browser' };
const RUNTIME_NAME = { browser: 'in browser', pwa: 'installed web app', twa: 'Android app (web)', webview: 'in-app browser', capacitor: 'native app', cordova: 'native app', electron: 'desktop app', tauri: 'desktop app' };
export function describe(p = platform) {
    // an app shell's webview often has no recognisable browser name; "Unknown browser" there is just noise
    const showBrowser = p.browser !== 'other' || (!p.native && p.runtime !== 'webview');
    return [
        OS_NAME[p.os] + (p.osVersion ? ' ' + p.osVersion : ''),
        showBrowser ? BROWSER_NAME[p.browser] + (p.browserVersion ? ' ' + p.browserVersion : '') : null,
        RUNTIME_NAME[p.runtime],
        p.primaryInput,
    ].filter(Boolean).join(' · ');
}

export function wireDeviceInfo() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-device-info]').forEach((el) => { el.textContent = 'Device: ' + describe(); });
}
