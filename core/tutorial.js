// Guided tutorial: teaches each control by asking the player to actually do
// it, detects the action from real game state, then moves on. Steps adapt to
// keyboard vs touch (different wording + the matching on-screen touch button
// is highlighted). Progress persists; the pause menu can replay it.
import { state } from './state.js';
import { shouldShowTouchControls } from './utils.js';
import { POIS } from '../environment/pois.js';
import { initJournal } from './journal.js';

const DONE_KEY = 'silvan-tutorial-done';
const START_DELAY = 1.5;   // seconds after gameplay begins before the first card
const DONE_FLASH = 0.9;    // seconds the "done" flash shows between steps

const K = (t) => `<span class="keycap">${t}</span>`;

// detect(ctx, dt) returns true when the step is complete. init(ctx) runs when
// the step starts so each step measures from its own baseline.
const STEPS = [
    {
        id: 'hud',
        kb: `Welcome to the Hearth. The plaque shows the day, the time and the weather. The hints under it are your keys. Press ${K('E')} to continue.`,
        touch: 'Welcome to the Hearth. The plaque shows the day, the time and the weather. Tap this card to continue.',
        highlight: ['.hud-plaque', '.hud-hints'],
        detect: (c) => c.advance,
    },
    {
        id: 'look',
        kb: 'Move the mouse to look around.',
        touch: 'Drag your finger on the right side of the screen to look around.',
        init: (c) => { c.lookAccum = 0; c.lastYaw = state.player.rotation.y; c.lastPitch = state.player.rotation.x; },
        detect: (c) => {
            c.lookAccum += Math.abs(state.player.rotation.y - c.lastYaw) + Math.abs(state.player.rotation.x - c.lastPitch);
            c.lastYaw = state.player.rotation.y; c.lastPitch = state.player.rotation.x;
            return c.lookAccum > 1.6;
        },
    },
    {
        id: 'move',
        kb: `Hold ${K('W')} ${K('A')} ${K('S')} ${K('D')} to walk. You walk where the camera faces.`,
        touch: 'Push the joystick on the left to walk. You walk where the camera faces.',
        highlight: ['#touch-joystick-base'],
        init: (c) => { c.walked = 0; c.lx = state.player.position.x; c.lz = state.player.position.z; },
        detect: (c) => {
            c.walked += Math.hypot(state.player.position.x - c.lx, state.player.position.z - c.lz);
            c.lx = state.player.position.x; c.lz = state.player.position.z;
            return c.walked > 8;
        },
    },
    {
        id: 'sprint',
        kb: `Hold ${K('Shift')} while walking to sprint. The view widens and your steps quicken.`,
        touch: 'Hold the Sprint button while pushing the joystick. The view widens and your steps quicken.',
        highlight: ['#touch-sprint-btn'],
        init: (c) => { c.sprintT = 0; },
        detect: (c, dt) => {
            if (state.keys.shift && state.player.velocity.lengthSq() > 0) c.sprintT += dt;
            return c.sprintT > 1.0;
        },
    },
    {
        id: 'jump',
        kb: `Press ${K('Space')} to jump.`,
        touch: 'Tap the Jump button.',
        highlight: ['#touch-jump-btn'],
        detect: () => !state.player.isGrounded,
    },
    {
        id: 'examine',
        kb: `Find a place on the island and walk up close. When its name appears, press ${K('E')} to examine it.`,
        touch: 'Find a place on the island and walk up close. When its name appears, tap Interact to examine it.',
        highlight: ['#touch-interact-btn'],
        guide: true,
        init: (c) => { c.baseExamine = state.examineCount || 0; },
        detect: (c) => (state.examineCount || 0) > c.baseExamine,
    },
    {
        id: 'rest',
        kb: `Hold ${K('G')} to rest. Time speeds up, so long nights pass quickly.`,
        touch: 'Hold the Rest button. Time speeds up, so long nights pass quickly.',
        highlight: ['#touch-rest-btn'],
        init: (c) => { c.restT = 0; },
        detect: (c, dt) => { if (state.keys.g) c.restT += dt; return c.restT > 1.5; },
    },
    {
        id: 'end',
        kb: `That's the basics. ${K('Esc')} pauses the game. Your journal of found places and the full controls list live in the pause menu.`,
        touch: "That's the basics. The menu button at the top right pauses the game. Your journal of found places and the full controls list live there.",
        highlight: ['#touch-pause-btn'],
        timed: 8,
        detect: (c, dt) => { c.endT = (c.endT || 0) + dt; return c.endT > 8 || c.advance; },
    },
];

const T = { active: false, idx: -1, timer: 0, flash: 0, pending: false, ctx: {}, el: null };
let lastE = false, lastK = false;

function els() {
    if (T.el) return T.el;
    T.el = {
        card: document.getElementById('tutorial-card'),
        step: document.getElementById('tut-step'),
        text: document.getElementById('tut-text'),
        guide: document.getElementById('tut-guide'),
        arrow: document.getElementById('tut-arrow'),
        guideText: document.getElementById('tut-guide-text'),
        pips: document.getElementById('tut-pips'),
        skip: document.getElementById('tut-skip'),
    };
    if (T.el.card) {
        T.el.card.addEventListener('click', () => { T.ctx.advance = true; });
        T.el.skip.addEventListener('click', (e) => { e.stopPropagation(); skipTutorial(); });
    }
    return T.el;
}

function clearHighlights() {
    document.querySelectorAll('.tut-pulse').forEach((n) => n.classList.remove('tut-pulse'));
}

function beginStep(i) {
    const e = els();
    T.idx = i; T.flash = 0; T.ctx = { advance: false };
    const s = STEPS[i];
    const touch = shouldShowTouchControls();
    e.text.innerHTML = touch ? s.touch : s.kb;
    e.step.textContent = i === STEPS.length - 1 ? 'all set' : `step ${i + 1} of ${STEPS.length - 1}`;
    e.guide.style.display = s.guide ? 'flex' : 'none';
    e.pips.innerHTML = STEPS.slice(0, -1).map((_, n) => `<i class="${n < i ? 'on' : n === i ? 'now' : ''}"></i>`).join('');
    e.skip.innerHTML = touch ? 'skip' : `${K('K')}skip`;
    e.card.classList.remove('done');
    e.card.classList.add('visible');
    clearHighlights();
    (s.highlight || []).forEach((sel) => document.querySelectorAll(sel).forEach((n) => n.classList.add('tut-pulse')));
    if (s.init) s.init(T.ctx);
}

function finish(markDone) {
    T.active = false; T.pending = false;
    clearHighlights();
    const e = els();
    if (e.card) e.card.classList.remove('visible');
    if (markDone) { try { localStorage.setItem(DONE_KEY, '1'); } catch (err) { /* ignore */ } }
}

export function skipTutorial() { if (T.active) finish(true); }

// force=true replays from the pause menu even if already completed.
export function startTutorial(force = false) {
    let done = false;
    try { done = localStorage.getItem(DONE_KEY) === '1'; } catch (err) { /* ignore */ }
    if (done && !force) return;
    T.active = true; T.pending = true; T.timer = 0; T.idx = -1;
}

function updateGuide() {
    const e = els();
    let best = null, bestD = Infinity;
    initJournal();
    const found = state.discovered;
    for (const poi of POIS) {
        if (found.has(poi.id)) continue;
        const d = Math.hypot(poi.x - state.player.position.x, poi.z - state.player.position.z);
        if (d < bestD) { bestD = d; best = poi; }
    }
    if (!best) { e.guideText.textContent = 'every place found'; return; }
    const y = state.player.rotation.y;
    const fx = -Math.sin(y), fz = -Math.cos(y);
    const rx = Math.cos(y), rz = -Math.sin(y);
    const dx = best.x - state.player.position.x, dz = best.z - state.player.position.z;
    const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    e.arrow.style.transform = `rotate(${ang}rad)`;
    e.guideText.textContent = `${best.name}, ${Math.round(bestD)} m away`;
}

// Called every frame while playing, dt in seconds.
export function updateTutorial(dt) {
    if (!T.active) return;
    const e = els();
    if (!e.card) return;

    const kNow = !!state.keys.k, eNow = !!state.keys.e;
    const kEdge = kNow && !lastK, eEdge = eNow && !lastE;
    lastK = kNow; lastE = eNow;
    if (kEdge) { skipTutorial(); return; }

    if (T.pending) {
        T.timer += dt;
        if (T.timer >= START_DELAY) { T.pending = false; beginStep(0); }
        return;
    }
    if (eEdge && STEPS[T.idx] && STEPS[T.idx].id !== 'examine') T.ctx.advance = true;

    if (T.flash > 0) {
        T.flash -= dt;
        if (T.flash <= 0) {
            if (T.idx >= STEPS.length - 1) finish(true); else beginStep(T.idx + 1);
        }
        return;
    }
    const s = STEPS[T.idx];
    if (s.guide) updateGuide();
    if (s.detect(T.ctx, dt)) {
        if (T.idx >= STEPS.length - 1) { finish(true); return; }
        e.card.classList.add('done');
        clearHighlights();
        T.flash = DONE_FLASH;
    }
}
