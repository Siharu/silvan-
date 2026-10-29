// Ilmis Meadow — game shell. Loads FIRST (before planet.js) because the planet
// engine reads Game.* hooks. Owns: settings, save, procedural audio, title /
// loading / pause menu, interaction (POIs + NPCs), journal, tutorial hints.
// World content (props, NPCs, dialogue text, Stillstones) lives in content.js.
const Game = (() => {
    const $ = (id) => document.getElementById(id);
    const SETTINGS_KEY = 'silvan.ilmis.settings.v1';
    const SAVE_KEY = 'silvan.ilmis.save.v1';
    const DEFAULTS = { fov: 70, sens: 1, pixel: 0, grass: 1, volume: 0.8, textSpeed: 'normal', dlgSize: 1, reduceMotion: false, debug: false, dayMinutes: 25 };

    const G = {
        settings: { ...DEFAULTS }, playing: false, paused: false, lock: true, ready: false, debug: false,
        dayLen: 25 * 60, dialogueActive: false, dialogueConsumedE: false, keyE: false, zoneName: '', biomeB: null,
        pois: [], frameHooks: [], flags: {}, discovered: {}, notes: [], fading: false,
    };
    const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };

    // ---------------------------------------------------------------- settings
    G.loadSettings = () => {
        const s = safe(() => JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'), {});
        G.settings = { ...DEFAULTS, ...s };
        if (matchMedia('(prefers-reduced-motion: reduce)').matches && s.reduceMotion === undefined) G.settings.reduceMotion = true;
    };
    G.saveSettings = () => safe(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)));
    G.applySettings = () => {
        const s = G.settings;
        G.debug = s.debug; G.dayLen = Math.max(5, s.dayMinutes) * 60;
        document.documentElement.style.setProperty('--dlg-scale', s.dlgSize);
        const h = $('h'); if (h) h.style.display = s.debug ? '' : 'none';
        if (G.audio.master) G.audio.master.gain.value = s.volume * (G.paused ? 0.3 : 1);
        if (typeof cam !== 'undefined') {
            cam.fov = s.fov; cam.updateProjectionMatrix();
            PX = s.pixel > 0 ? s.pixel : Math.max(2, Math.round(innerHeight / 320)); rs();
        }
    };
    G.loadSettings();

    // -------------------------------------------------------------------- save
    G.hasSave = () => !!safe(() => localStorage.getItem(SAVE_KEY));
    G.readSave = () => safe(() => JSON.parse(localStorage.getItem(SAVE_KEY)), null);
    G.write = () => {
        if (!G.ready || typeof P === 'undefined') return false;
        const d = P.clone().normalize();
        const ok = safe(() => { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, dir: [d.x, d.y, d.z], T, flags: G.flags, discovered: G.discovered, notes: G.notes, wk, at: Date.now() })); return true; }, false);
        return ok;
    };
    G.clearSave = () => safe(() => localStorage.removeItem(SAVE_KEY));

    // ------------------------------------------------------------------- audio
    // Everything is synthesised (no asset files): wind, water, rain, crickets,
    // birds, a slow pad, 88.7 FM static, dialogue blip, discovery chime.
    G.audio = (() => {
        const A = { ctx: null, master: null, ready: false };
        let nodes = {}, birdT = 4, padT = 0, chord = 0;
        const CHORDS = [[220, 261.6, 329.6, 392], [196, 246.9, 293.7, 392], [174.6, 220, 261.6, 329.6], [196, 261.6, 293.7, 349.2]];
        A.init = () => {
            if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
            const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
            const c = A.ctx = new AC(); A.master = c.createGain(); A.master.gain.value = G.settings.volume; A.master.connect(c.destination);
            const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
            let b0 = 0; for (let i = 0; i < d.length; i++) { b0 = 0.97 * b0 + (Math.random() * 2 - 1) * 0.3; d[i] = b0; } // soft-ish noise
            const noise = (type, freq, q) => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(A.master); s.start(); return { g, f }; };
            nodes.wind = noise('bandpass', 420, 0.5); nodes.water = noise('lowpass', 700); nodes.rain = noise('highpass', 1800); nodes.stat = noise('bandpass', 2600, 1.2);
            // crickets: 4.4 kHz sine, amplitude gated by a fast LFO
            const co = c.createOscillator(); co.frequency.value = 4400; const cg = c.createGain(); cg.gain.value = 0; const lfo = c.createOscillator(); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 0.5; const off = c.createConstantSource ? c.createConstantSource() : null;
            const gate = c.createGain(); gate.gain.value = 0.5; lfo.connect(lg); lg.connect(gate.gain); co.connect(gate); gate.connect(cg); cg.connect(A.master); co.start(); lfo.start(); nodes.cric = cg; if (off) { off.offset.value = 0; }
            // pad
            const pf = c.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 700; const pg = c.createGain(); pg.gain.value = 0; pf.connect(pg); pg.connect(A.master); nodes.pad = pg;
            nodes.padOsc = CHORDS[0].map((f, i) => { const o = c.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f / 2; o.detune.value = (i - 1.5) * 4; const g = c.createGain(); g.gain.value = 0.25; o.connect(g); g.connect(pf); o.start(); return o; });
            A.ready = true;
        };
        A.blip = (seed = 0) => {
            if (!A.ctx || A.ctx.state !== 'running') return;
            const c = A.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = 260 + (seed % 7) * 22 + Math.random() * 30;
            const t = c.currentTime; g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07); o.connect(g); g.connect(A.master); o.start(t); o.stop(t + 0.08);
        };
        A.chime = (notes = [659.3, 987.8, 1318.5]) => {
            if (!A.ctx || A.ctx.state !== 'running') return;
            const c = A.ctx; notes.forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; const t = c.currentTime + i * 0.13; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); o.connect(g); g.connect(A.master); o.start(t); o.stop(t + 1.7); });
        };
        const chirp = () => {
            const c = A.ctx, n = 2 + ((Math.random() * 4) | 0), base = 2000 + Math.random() * 1800; let t = c.currentTime + 0.02;
            for (let i = 0; i < n; i++) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.5), t + 0.07); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.025, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); o.connect(g); g.connect(A.master); o.start(t); o.stop(t + 0.1); t += 0.11 + Math.random() * 0.08; }
        };
        // env: { day 0..1, rain 0..1, wind 0..1, water 0..1, stat 0..1, calm 0..1 }
        A.update = (dt, e) => {
            if (!A.ready) return; const c = A.ctx, t = c.currentTime, k = (n, v, tc = 0.8) => n.gain.setTargetAtTime(v, t, tc);
            if (c.state === 'suspended' && G.playing) c.resume();
            k(nodes.wind.g, 0.012 + 0.05 * e.wind); nodes.wind.f.frequency.setTargetAtTime(300 + 500 * e.wind, t, 1);
            k(nodes.water.g, 0.07 * e.water); k(nodes.rain.g, 0.07 * e.rain); k(nodes.stat.g, 0.06 * e.stat, 0.15);
            k(nodes.cric, 0.012 * (1 - e.day) * (1 - e.rain) * e.calm, 2); k(nodes.pad, 0.05 * e.calm, 3);
            birdT -= dt; if (birdT <= 0) { birdT = 2 + Math.random() * 7; if (e.day > 0.5 && e.rain < 0.4 && e.calm > 0.3 && !G.paused) chirp(); }
            padT -= dt; if (padT <= 0) { padT = 14 + Math.random() * 6; chord = (chord + 1) % CHORDS.length; nodes.padOsc.forEach((o, i) => o.frequency.setTargetAtTime(CHORDS[chord][i] / 2, t, 4)); }
        };
        return A;
    })();

    // ---------------------------------------------------------------------- UI
    let toastT = 0, hintT = 0;
    G.toast = (title, sub) => { const e = $('toast'); e.innerHTML = ''; e.append(title); if (sub) { const s = document.createElement('small'); s.textContent = sub; e.append(s); } e.classList.add('visible'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('visible'), 4200); };
    G.hint = (html, ms = 6000) => { const e = $('hint'); e.innerHTML = html; e.classList.add('visible'); clearTimeout(hintT); hintT = setTimeout(() => e.classList.remove('visible'), ms); };
    G.fade = (on) => new Promise((r) => { $('fade').classList.toggle('on', on); G.fading = on; setTimeout(r, G.settings.reduceMotion ? 30 : 650); });

    // --------------------------------------------------------------- journal
    G.discover = (p) => {
        if (G.discovered[p.id]) return false;
        G.discovered[p.id] = Date.now();
        const lm = G.pois.filter((q) => q.landmark), n = lm.filter((q) => G.discovered[q.id]).length;
        if (p.landmark) { G.toast('Discovered: ' + p.name, `${n} of ${lm.length} places found`); G.audio.chime(); }
        G.write(); return true;
    };
    G.addNote = (id, title, text) => { if (G.notes.some((n) => n.id === id)) return; G.notes.push({ id, title, text }); G.toast('Whisper kept: ' + title, 'see Journal'); G.audio.chime([523.3, 784]); G.write(); };

    function renderJournal(body) {
        const lm = G.pois.filter((p) => p.landmark).sort((a, b) => (a.section === b.section ? 0 : a.section === 'STILLSTONES' ? 1 : -1)), found = lm.filter((p) => G.discovered[p.id]);
        let h = `<div class="count">Places found: ${found.length} of ${lm.length}</div>`;
        let sec = null;
        for (const p of lm) {
            if (p.section !== sec) { sec = p.section; h += `<div class="count" style="margin-top:12px;letter-spacing:.15em">${sec || ''}</div>`; }
            const ok = !!G.discovered[p.id];
            h += `<div class="lm ${ok ? '' : 'lock'}"><b>${ok ? p.name : '???'}</b><p>${ok ? (p.journal || p.desc || '') : (p.clue || 'Not yet found.')}</p></div>`;
        }
        if (G.notes.length) { h += '<div class="count" style="margin-top:14px">Whispers</div>'; for (const n of G.notes) h += `<div class="lm"><b>${n.title}</b><p>${n.text}</p></div>`; }
        body.innerHTML = h;
    }
    function renderSettings(body) {
        const s = G.settings, rows = [];
        const range = (k, label, min, max, step, fmt) => `<div class="row"><label for="s-${k}">${label} <span id="v-${k}" style="color:var(--dim)">${fmt ? fmt(s[k]) : s[k]}</span></label><input id="s-${k}" data-k="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${s[k]}"></div>`;
        const sel = (k, label, opts) => `<div class="row"><label for="s-${k}">${label}</label><select id="s-${k}" data-k="${k}">${opts.map(([v, t]) => `<option value="${v}" ${String(s[k]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
        const chk = (k, label) => `<div class="row"><label for="s-${k}">${label}</label><input id="s-${k}" data-k="${k}" type="checkbox" ${s[k] ? 'checked' : ''}></div>`;
        rows.push(range('volume', 'Master volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'));
        rows.push(range('fov', 'Field of view', 50, 100, 1));
        rows.push(range('sens', 'Look sensitivity', 0.3, 2.5, 0.1, (v) => v.toFixed(1) + '×'));
        rows.push(sel('pixel', 'Pixel size (lower = sharper, slower)', [[0, 'Auto'], [1, '1 — sharp'], [2, '2'], [3, '3'], [4, '4 — chunky']]));
        rows.push(sel('grass', 'Grass density (applies on restart)', [[1, 'High'], [0.6, 'Medium'], [0.3, 'Low']]));
        rows.push(sel('textSpeed', 'Dialogue speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']]));
        rows.push(range('dlgSize', 'Dialogue text size', 0.8, 1.6, 0.1, (v) => v.toFixed(1) + '×'));
        rows.push(range('dayMinutes', 'Day length (minutes)', 5, 60, 5));
        rows.push(chk('reduceMotion', 'Reduce motion (instant text, no fades)'));
        rows.push(chk('debug', 'Debug HUD'));
        body.innerHTML = rows.join('');
        body.querySelectorAll('[data-k]').forEach((el) => {
            const on = () => {
                const k = el.dataset.k; let v = el.type === 'checkbox' ? el.checked : el.value;
                if (el.type === 'range' || ['pixel', 'grass'].includes(k)) v = parseFloat(v);
                G.settings[k] = v; const lab = $('v-' + k); if (lab) lab.textContent = k === 'volume' ? Math.round(v * 100) + '%' : (k === 'sens' || k === 'dlgSize') ? v.toFixed(1) + '×' : v;
                G.saveSettings(); G.applySettings();
            };
            el.addEventListener(el.type === 'range' ? 'input' : 'change', on);
        });
    }
    function renderControls(body) {
        body.innerHTML = `<div class="keys"><b style="color:var(--ink)">Keyboard + mouse</b><br>W A S D — walk &nbsp; Shift — run &nbsp; Mouse — look<br>E / Enter — interact, advance dialogue &nbsp; 1–9 — pick a choice<br>F — fly &nbsp; B — boost &nbsp; Space / C — up / down (fly) &nbsp; X — change weather<br>Esc — this menu<br><br><b style="color:var(--ink)">Touch</b><br>Left thumb — move &nbsp; Right thumb — look<br>E button — interact &nbsp; tap the text box to advance<br><br><b style="color:var(--ink)">Traveller tools</b><div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 12px"><button data-tool="bf">Fly</button><button data-tool="bb">Boost</button><button data-tool="bw">Change weather</button></div><b style="color:var(--ink)">Travel</b><br>The planet is 1,188 km in radius. The cottage valley is the only place you can cross on foot in an afternoon. The Stillstones scattered in the other lands will carry you between them — start with the one by the cottage.</div>`;
    }
    function wireTools(body) { body.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { const id = b.dataset.tool; id === 'bw' ? cycW() : tg(id); b.classList.toggle('on', id === 'bf' ? fly : id === 'bb' ? boost : false); })); }
    let tab = 'journal';
    function renderMenu() {
        const body = $('menu-body'); document.querySelectorAll('#menu .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
        ({ journal: renderJournal, settings: renderSettings, controls: renderControls })[tab](body); if (tab === 'controls') wireTools(body);
        $('menu-time').textContent = G.timeLabel || '';
    }

    // ---------------------------------------------------------- pause / resume
    const isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    G.pause = () => {
        if (!G.playing || G.paused) return;
        G.paused = true; $('menu').hidden = false; renderMenu(); G.write(); G.applySettings();
        if (document.pointerLockElement) document.exitPointerLock();
    };
    G.resume = () => {
        if (!G.paused) return;
        G.paused = false; $('menu').hidden = true; G.applySettings();
        if (!isTouch()) safe(() => document.body.requestPointerLock());
    };

    // ------------------------------------------------------------- interaction
    G.addPOI = (p) => { G.pois.push(p); return p; };
    G.local = () => { const l = P.clone().sub(SC.O).applyQuaternion(SC.qi); return { x: l.x, y: l.y, n: -l.z }; };
    let nearest = null, lastName = null, ePrev = false, saveT = 0;
    function interactUpdate(dt) {
        const prompt = $('interact-prompt'); if (!SC) return;
        const L = G.local(); nearest = null; let nd = 1e9;
        for (const p of G.pois) {
            if (p.enabled && !p.enabled()) continue;
            const px = p.getPos ? p.getPos() : p, d = p.world ? P.distanceTo(p.worldPos) : Math.hypot(L.x - px.x, L.n - px.n), range = (p.r || 6) + 4;
            if (d < range && d < nd) { nearest = p; nd = d; }
        }
        const pressed = G.keyE && !ePrev && !G.dialogueConsumedE; ePrev = G.keyE;
        if (nearest && !G.fading) {
            const label = nearest.prompt || nearest.name;
            if (lastName !== label) { prompt.innerHTML = (isTouch() ? '' : '<span class="keycap">E</span>') + label; lastName = label; }
            prompt.classList.add('visible');
            if (pressed && !Dialogue.isActive()) { G.flags.examined = (G.flags.examined || 0) + 1; nearest.interact ? nearest.interact(nearest) : G.examine(nearest); }
        } else { lastName = null; prompt.classList.remove('visible'); const o = Dialogue.owner(); if (typeof o === 'string' && o.startsWith('poi:') && !G.dialogueSticky) Dialogue.close(); }
    }
    G.examine = (p) => {
        Dialogue.show([{ speaker: p.name, text: p.desc }], null, { owner: 'poi:' + p.id, autoClose: 5, seed: p.name.length });
        G.discover(p);
    };

    // -------------------------------------------------------------- time label
    function timeLabel(day, rising) {
        if (day > 0.85) return 'Midday'; if (day > 0.5) return rising ? 'Morning' : 'Afternoon';
        if (day > 0.12) return rising ? 'Dawn' : 'Dusk'; return 'Night';
    }

    // ---------------------------------------------------------------- per frame
    G.update = (dt, cq) => {
        if (!G.ready) return; G.cq = cq;
        if (G.eHold > 0) G.eHold--; G.keyE = !!G.kbE || G.eHold > 0; // touch E is a short pulse so slow frames can't miss the press edge
        Dialogue.update(dt);
        G.lock = !G.playing || G.paused || G.fading || Dialogue.frozen();
        if (G.playing && !G.paused) {
            interactUpdate(dt);
            for (const f of G.frameHooks) f(dt);
            saveT += dt; if (saveT > 45) { saveT = 0; G.write(); }
        }
        // sky / clock
        const up = P.clone().normalize(), t = t0 + T * TAU / G.dayLen, t2 = t + 0.02;
        const e1 = Math.cos(t) * up.x + Math.sin(t) * Math.cos(.4) * up.y + Math.sin(t) * Math.sin(.4) * up.z;
        const e2 = Math.cos(t2) * up.x + Math.sin(t2) * Math.cos(.4) * up.y + Math.sin(t2) * Math.sin(.4) * up.z;
        const day = skyU.uDay.value; G.timeLabel = timeLabel(day, e2 > e1); G.day = day;
        if (G.playing && frame % 15 === 0) $('clock').textContent = G.timeLabel + ' · ' + (tint.ic > 0.5 && wk >= 2 ? 'Snowfall' : WN[wk]);
        // audio environment
        const L = SC ? G.local() : { x: 9999, n: 9999 }, inValley = Math.hypot(L.x, L.n) < 1500;
        const lakeD = inValley ? Math.max(0, lakeE(L.x, L.n) - 1) : 9, ground = Math.max(0, alt) < 600;
        const wf = inValley ? Math.min(1, Math.max(0, 1 - Math.abs(L.n - cliffZ(L.x)) / 260)) : 0;
        G.audio.update(dt, {
            day, rain: (wk >= 2 ? w : 0) * (tint.ic > 0.5 ? 0.4 : 1), wind: Math.min(1, 0.25 + w * 0.5 + Math.min(1, alt / 4000) + (tint.de > 0.5 ? 0.3 : 0) + (wk === 3 ? 0.4 : 0)),
            water: Math.max(wf, inValley && lakeD < 0.3 ? 1 - lakeD / 0.3 : 0) * (ground ? 1 : 0), stat: G.radioLevel ? G.radioLevel() : 0, calm: ground ? 1 : Math.max(0, 1 - alt / 20000),
        });
    };

    // ------------------------------------------------------------ game start
    G.teleportDir = (d) => {
        const v = new THREE.Vector3(d[0], d[1], d[2]).normalize(); P.copy(v).multiplyScalar(R + height(v, .5) + 1.7);
    };
    function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed to load ' + src)); document.body.appendChild(s); }); }
    const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const bar = (p, m) => { $('load-bar').style.width = p + '%'; $('load-msg').textContent = m; };

    let started = false;
    G.start = async (cont) => {
        if (started) return; started = true;
        const save = cont ? G.readSave() : null; if (!cont) G.clearSave();
        G.audio.init();
        if (!isTouch()) safe(() => document.body.requestPointerLock()); // must happen inside the click gesture
        document.documentElement.dataset.touch = isTouch() ? '1' : '0';
        $('title').classList.add('gone'); const ld = $('loading'); ld.hidden = false; await frames(1); ld.classList.remove('gone');
        try {
            bar(8, 'waking the meadow'); await frames(2);
            await loadScript('planet.js'); bar(62, 'planting the valley'); await frames(2);
            await loadScript('content.js'); bar(86, 'listening'); await frames(2);
            if (save) {
                if (save.T != null) T = save.T;
                G.flags = save.flags || {}; G.discovered = save.discovered || {}; G.notes = save.notes || [];
                if (save.wk != null) wk = save.wk;
                if (save.dir) G.teleportDir(save.dir);
            }
            G.applySettings(); Dialogue.setup(); G.ready = true;
            bar(96, 'almost'); await frames(3);
            try { renderer.compile(scene, cam); } catch (e) { /* first render compiles anyway */ }
            bar(100, ''); await frames(2);
        } catch (err) { console.error(err); $('load-msg').textContent = 'Something went wrong: ' + err.message; return; }
        $('tools').hidden = false; $('clock').hidden = false; if (isTouch()) $('touch').hidden = false;
        ld.classList.add('gone'); setTimeout(() => { ld.hidden = true; }, 1300);
        G.playing = true;
        const first = !save; zone(first ? 'ILMIS MEADOW' : 'WELCOME BACK');
        if (first && G.onNewGame) G.onNewGame();
        setTimeout(() => { if (!G.flags.hintMove) { G.flags.hintMove = 1; G.hint(isTouch() ? 'Left thumb to walk, right thumb to look.<br>Tap <b>E</b> beside things that glow.' : '<span class="keycap">W</span><span class="keycap">A</span><span class="keycap">S</span><span class="keycap">D</span> to walk, mouse to look, <span class="keycap">E</span> to look closer at things.', 9000); } }, 2500);
    };

    // ------------------------------------------------------------ DOM wiring
    function wire() {
        G.applySettings();
        $('t-start').onclick = () => G.start(false);
        $('t-continue').onclick = () => G.start(true);
        if (G.hasSave()) { $('t-continue').hidden = false; $('t-start').textContent = 'New Journey'; $('t-start').onclick = () => { if (confirm('Start over? Your saved journey will be erased.')) G.start(false); }; }
        $('m-resume').onclick = G.resume;
        $('m-save').onclick = () => { $('m-save').textContent = G.write() ? 'Saved ✓' : 'Save failed'; setTimeout(() => ($('m-save').textContent = 'Save'), 1400); };
        $('m-title').onclick = () => { G.write(); location.reload(); };
        document.querySelectorAll('#menu .tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderMenu(); }));
        $('bm').onclick = () => (G.paused ? G.resume() : G.pause());
        $('bf').onclick = () => tg('bf'); $('br').onclick = () => tg('br'); $('bb').onclick = () => tg('bb'); $('bw').onclick = () => cycW();
        const act = $('tb-act');
        act.addEventListener('touchstart', (e) => { e.preventDefault(); G.eHold = 4; }, { passive: false });
        $('tb-run').addEventListener('touchstart', (e) => { e.preventDefault(); tg('br'); }, { passive: false });
        addEventListener('keydown', (e) => { if (e.code === 'KeyE') G.kbE = true; if (e.code === 'Escape' && G.playing) { e.preventDefault(); G.paused ? G.resume() : G.pause(); } });
        addEventListener('keyup', (e) => { if (e.code === 'KeyE') G.kbE = false; });
        addEventListener('blur', () => { G.kbE = false; });
        // Esc releases pointer lock without always delivering a keydown, so treat any unsolicited unlock as pause.
        document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && G.playing && !G.paused && !isTouch()) G.pause(); });
        document.addEventListener('visibilitychange', () => { if (document.hidden) { G.pause(); G.write(); } });
        addEventListener('pagehide', () => G.write());
        $('menu').addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    document.addEventListener('DOMContentLoaded', wire);
    return G;
})();
