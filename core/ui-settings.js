// Interface scaling + accessibility settings + pause-menu keyboard polish.
//
// Scaling works like a canvas scaler / OS display scale: the whole UI is
// sized in rem, so one number on <html> scales every menu, HUD element and
// the dialogue box together.
//   scale = auto-fit (screen size) x the player's "Interface size" choice
// Phones keep auto = 1 (their layout is hand-tuned in index.html, see
// core/viewport.js); tablets/desktop windows grow gently once the screen is
// bigger than 1080p. The player's choice (Small..Huge) multiplies on top, but
// growth stops once the title screen would no longer fit the window height.
// Written as a % of the browser's own default font size, so the browser/OS
// text-size setting still counts.
//
// B-44: scale 1 MUST equal the stylesheet's own base, `html, body { font-size: 20px }` in
// index.html, which is 125% of the 16px browser default. The first version wrote
// scale*100%, i.e. 16px at scale 1, which silently shrank every rem-sized element in
// the game by 20% on phones and 720p windows (and moved the dialogue box onto the
// REST/JUMP touch buttons). BASE_PCT is that 125%; if the stylesheet's base ever changes,
// change it here too.
const BASE_PCT = 125;
const TITLE_STACK_PX = 780; // measured: the title screen's stack is ~780px tall at scale 1 (20px root), ~641px at 16px
//
// Controls live in the "Interface" tab of the title + pause settings
// (data-seg attributes in index.html); both panels stay in sync.
import { state } from './state.js';

const KEY = (k) => 'silvan-ui-' + k;
const SPEEDS = ['slow', 'normal', 'fast', 'instant'];
const prefs = { uiSize: 1, dlgText: 1, textSpeed: 'normal', reduceMotion: false };
const root = document.documentElement;

function load() {
    const get = (k) => localStorage.getItem(KEY(k));
    const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0.7 && n <= 1.6 ? n : d; };
    prefs.uiSize = num(get('uiSize'), 1);
    prefs.dlgText = num(get('dlgText'), 1);
    prefs.textSpeed = SPEEDS.includes(get('textSpeed')) ? get('textSpeed') : 'normal';
    const rm = get('reduceMotion'); // unset = follow the OS "reduce motion" preference
    prefs.reduceMotion = rm === null ? matchMedia('(prefers-reduced-motion: reduce)').matches : rm === '1';
}

function apply() {
    const short = Math.min(window.innerWidth, window.innerHeight);
    const phone = matchMedia('(pointer: coarse)').matches && short < 820;
    // Auto-fit curve (short side 720 -> 1.0 ... 4K -> 1.4, in the original 16px-based units), re-expressed
    // against the 20px base: 1.0 up to 1080p (so 720p/1080p keep the original size), ~1.17 at 1440p, max 1.12.
    const auto = phone ? 1 : Math.min(1.12, Math.max(1, (short / 720) ** 0.55 / 1.25));
    // Growing is capped at what fits: the title stack is TITLE_STACK_PX tall at scale 1 and can't scroll.
    // Shrinking (Small) is never capped. Dialogue text size is separate and not capped.
    const fit = Math.max(1, window.innerHeight / TITLE_STACK_PX);
    const wanted = auto * prefs.uiSize;
    const scale = wanted <= 1 ? wanted : Math.min(wanted, fit);
    root.style.fontSize = (scale * BASE_PCT).toFixed(1) + '%';
    root.style.setProperty('--ui-scale', scale.toFixed(3));
    root.style.setProperty('--dlg-scale', String(prefs.dlgText));
    root.toggleAttribute('data-reduce-motion', prefs.reduceMotion);
    state.textSpeed = prefs.textSpeed;
    state.reduceMotion = prefs.reduceMotion;
    document.querySelectorAll('[data-seg]').forEach((el) => {
        const v = prefs[el.dataset.seg];
        if (el.type === 'checkbox') el.checked = !!v;
        else { const on = String(v) === el.dataset.value; el.classList.toggle('active', on); el.setAttribute('aria-pressed', String(on)); }
    });
}

function set(k, v) {
    prefs[k] = v;
    localStorage.setItem(KEY(k), typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    apply();
}

function reset() {
    ['uiSize', 'dlgText', 'textSpeed', 'reduceMotion'].forEach((k) => localStorage.removeItem(KEY(k)));
    load();
    apply();
}

// Live value next to each slider's label (the sliders themselves are wired in settings.js).
function wireReadouts() {
    const fmt = { fov: (v) => v + '\u00b0', sensitivity: (v) => (+v).toFixed(2) + '\u00d7', volume: (v) => Math.round(v * 100) + '%' };
    const updaters = [];
    document.querySelectorAll('.tab-panel input[type="range"]').forEach((r) => {
        const kind = Object.keys(fmt).find((k) => r.id.includes(k));
        const label = kind && document.querySelector(`label[for="${r.id}"]`);
        if (!label) return;
        const out = document.createElement('span');
        out.className = 'range-readout';
        label.appendChild(out);
        const upd = () => { out.textContent = fmt[kind](r.value); };
        r.addEventListener('input', upd);
        updaters.push(upd);
        upd();
    });
    // the twin slider (title <-> pause) is set from code without an input event
    document.addEventListener('click', () => requestAnimationFrame(() => updaters.forEach((f) => f())), true);
}

// Pause menu: Up/Down moves between buttons, Esc folds the open section,
// focus lands on Resume when it opens (so Enter just works).
function wireMenuKeys() {
    const layer = document.getElementById('pause-layer');
    if (!layer) return;
    new MutationObserver(() => {
        if (!layer.classList.contains('visible')) return;
        const resume = document.getElementById('pause-resume-btn');
        if (resume) resume.focus({ preventScroll: true });
    }).observe(layer, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('keydown', (ev) => {
        if (!layer.classList.contains('visible')) return;
        if (ev.code === 'Escape') {
            const open = layer.querySelector('.pause-settings.open');
            if (open) open.classList.remove('open');
            return;
        }
        const dir = ev.code === 'ArrowDown' ? 1 : ev.code === 'ArrowUp' ? -1 : 0;
        const a = document.activeElement;
        if (!dir || (a && a !== document.body && !a.classList.contains('pause-btn'))) return;
        const items = [...layer.querySelectorAll('.pause-btn')].filter((b) => b.offsetParent);
        if (!items.length) return;
        const i = items.indexOf(a);
        items[(i + dir + items.length) % items.length].focus();
        ev.preventDefault();
    });
}

let wired = false;
export function setupUiSettings() {
    if (wired) return;
    wired = true;
    document.querySelectorAll('[data-seg]').forEach((el) => {
        const k = el.dataset.seg;
        if (el.type === 'checkbox') el.addEventListener('change', () => set(k, el.checked));
        else el.addEventListener('click', () => {
            const v = el.dataset.value;
            set(k, k === 'textSpeed' ? v : parseFloat(v));
        });
    });
    document.querySelectorAll('[data-ui-reset]').forEach((b) => b.addEventListener('click', reset));
    let queued = false;
    const onResize = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; apply(); }); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    apply();
    wireReadouts();
    wireMenuKeys();
}

load();
apply(); // at import time: module scripts run after parsing, so the saved scale is on before the title screen paints
