// Dialogue system for Ilmis Meadow — a port of the Hearth's core/dialogue.js
// (same API, same behaviour) to a classic script, since this map runs on the
// global-scope three r128 planet engine instead of Vite modules.
//
//   Dialogue.show(lines, onComplete?, opts?)
//     lines: [{ speaker?, text, choices?: [{ label, onSelect?(), next?: lines }] }]
//     opts:  { owner, autoClose (seconds after the last line), freeze, seed }
//
// Input: E / Enter / tap the box (or any click while pointer-locked) finishes
// the typing, then advances. Choices: tap, number keys 1-9, or Up/Down (W/S)
// + E/Enter. A choice is never picked by an accidental advance press.
// Conversations with choices freeze movement. Typing speed + reduce-motion
// come from Game.settings.
const Dialogue = (() => {
    const CPS = { slow: 22, normal: 42, fast: 90, instant: Infinity };
    let els = null;
    let D = null; // active session, null when no dialogue is up
    let ePrev = false;
    let wired = false;

    function getEls() {
        if (els) return els;
        const box = document.getElementById('dlg');
        if (!box) return null;
        const text = document.getElementById('dlg-text');
        // Two spans: revealed part + not-yet-revealed part (invisible but laid
        // out) so the box keeps its final size while typing.
        const shown = document.createElement('span');
        const rest = document.createElement('span');
        rest.className = 'rest';
        text.replaceChildren(shown, rest);
        text.setAttribute('aria-live', 'polite');
        box.setAttribute('role', 'dialog');
        els = { box, text, shown, rest, speaker: document.getElementById('dlg-speaker'),
            choices: document.getElementById('dlg-choices'), hint: document.getElementById('dlg-hint') };
        return els;
    }

    const cps = () => (Game.settings.reduceMotion ? Infinity : (CPS[Game.settings.textSpeed] || CPS.normal));
    const isActive = () => !!D;
    const owner = () => (D ? D.owner : null);
    const frozen = () => !!(D && D.freeze);

    function show(lines, onComplete, opts = {}) {
        const e = getEls();
        const q = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map((l) => (typeof l === 'string' ? { text: l } : l));
        if (!e || !q.length) return;
        const hasChoices = q.some((l) => l.choices && l.choices.length);
        D = { q, onDone: onComplete || null, owner: opts.owner ?? null, autoClose: opts.autoClose || 0,
            freeze: opts.freeze ?? hasChoices, seed: opts.seed || 0, line: null, full: '', shown: 0, t: 0,
            typing: false, hold: 0, sel: -1, choicesOn: false };
        Game.dialogueActive = true;
        e.box.classList.add('visible');
        nextLine();
    }

    function render() {
        const e = getEls();
        e.shown.textContent = D.full.slice(0, D.shown);
        e.rest.textContent = D.full.slice(D.shown);
        e.text.classList.toggle('typing', D.typing);
    }

    function nextLine() {
        const e = getEls();
        const line = D.q.shift();
        if (!line) return close();
        Object.assign(D, { line, full: String(line.text || ''), shown: 0, t: 0, hold: 0, sel: -1, choicesOn: false });
        e.speaker.textContent = line.speaker || '';
        e.speaker.hidden = !line.speaker;
        e.choices.replaceChildren();
        e.choices.hidden = true;
        D.typing = cps() !== Infinity && D.full.length > 0;
        if (D.typing) render(); else finishTyping();
        setHint();
    }

    function finishTyping() {
        D.typing = false;
        D.shown = D.full.length;
        render();
        const choices = D.line.choices;
        if (choices && choices.length) {
            const e = getEls();
            choices.forEach((c, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'choice-btn';
                const key = document.createElement('span');
                key.className = 'keycap';
                key.textContent = String(i + 1);
                const label = document.createElement('span');
                label.textContent = c.label;
                b.append(key, label);
                b.addEventListener('click', () => pick(i));
                b.addEventListener('pointerenter', () => highlight(i));
                e.choices.appendChild(b);
            });
            e.choices.hidden = false;
            D.choicesOn = true;
            D.pickAfter = performance.now() + 380; // a finger that just advanced the line must not also 'click' a choice that appears under it
        } else if (D.autoClose) {
            D.hold = D.autoClose;
        }
        setHint();
    }

    function highlight(i) {
        D.sel = i;
        getEls().choices.childNodes.forEach((b, j) => b.classList.toggle('is-sel', j === i));
    }

    function pick(i) {
        if (!D || !D.choicesOn) return;
        if (performance.now() < D.pickAfter) return;
        const session = D;
        const choice = D.line.choices[i];
        if (!choice) return;
        D.choicesOn = false;
        if (choice.onSelect) choice.onSelect();
        if (D !== session) return; // onSelect started a new dialogue (or closed this one)
        if (choice.next) D.q.unshift(...[].concat(choice.next));
        nextLine();
    }

    function setHint() {
        const h = getEls().hint;
        h.hidden = !D || D.typing || D.choicesOn || !!(D.line && D.line.choices && D.line.choices.length);
        if (h.hidden) return;
        const touch = matchMedia('(pointer: coarse)').matches;
        h.replaceChildren();
        if (!touch) { const k = document.createElement('span'); k.className = 'keycap'; k.textContent = 'E'; h.appendChild(k); }
        h.append((touch ? 'tap ' : '') + (D.q.length ? 'next' : 'close'));
    }

    function advance() {
        if (!D) return;
        if (D.typing) return finishTyping();
        if (D.choicesOn) { if (D.sel >= 0) pick(D.sel); return; }
        nextLine();
    }

    function close() {
        if (!D) return;
        const done = D.onDone;
        D = null;
        const e = getEls();
        if (e) e.box.classList.remove('visible');
        Game.dialogueActive = false;
        if (done) done();
    }

    // Call every frame BEFORE the interact check so one E press never both
    // advances a box and re-opens the thing you're standing at.
    function update(dt) {
        Game.dialogueConsumedE = false;
        const eNow = !!Game.keyE;
        const edge = eNow && !ePrev;
        ePrev = eNow;
        if (!D || !Game.playing || Game.paused) return;
        if (edge) { Game.dialogueConsumedE = true; advance(); if (!D) return; }
        if (D.typing) {
            const rate = cps();
            D.t += dt * rate;
            const n = Math.min(D.full.length, Math.floor(D.t));
            if (n !== D.shown) {
                if (rate <= 60 && n % 2 === 0 && D.full[n - 1] !== ' ') Game.audio.blip(D.seed);
                D.shown = n;
                render();
            }
            if (n >= D.full.length) finishTyping();
        } else if (D.hold > 0) {
            D.hold -= dt;
            if (D.hold <= 0) close();
        }
    }

    function setup() {
        if (wired) return;
        wired = true;
        getEls();
        window.addEventListener('keydown', (ev) => {
            if (!D || !Game.playing || Game.paused) return;
            const swallow = () => { ev.preventDefault(); ev.stopPropagation(); };
            if (D.choicesOn) {
                const n = D.line.choices.length;
                const m = /^(?:Digit|Numpad)([1-9])$/.exec(ev.code);
                if (m) { if (+m[1] <= n) { swallow(); pick(+m[1] - 1); } return; }
                const dir = (ev.code === 'ArrowDown' || ev.code === 'KeyS') ? 1 : (ev.code === 'ArrowUp' || ev.code === 'KeyW') ? -1 : 0;
                if (dir) { swallow(); highlight(D.sel < 0 ? (dir > 0 ? 0 : n - 1) : (D.sel + dir + n) % n); return; }
            }
            if (ev.code === 'Enter' || ev.code === 'NumpadEnter') { swallow(); if (!ev.repeat) advance(); }
            else if (ev.code === 'Space' && D.freeze) swallow(); // no jumping/flying mid-conversation
        }, true);
        // Mouse while pointer-locked has no cursor, so any click advances; on
        // touch (or an unlocked mouse) only a tap on the box itself does, so
        // look-dragging never skips a line.
        window.addEventListener('pointerdown', (ev) => {
            if (!D || !Game.playing || Game.paused || D.choicesOn) return;
            const t = ev.target;
            if (t.closest && t.closest('.choice-btn')) return;
            const onBox = !!(t.closest && t.closest('#dlg'));
            if (onBox || (ev.pointerType === 'mouse' && document.pointerLockElement)) advance();
        }, true);
    }

    return { show, close, advance, update, setup, isActive, owner, frozen };
})();
