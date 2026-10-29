// Ilmis Meadow — world content: cottage-valley landmarks, NPCs, Stillstones
// (fast travel to the other lands), dialogue text. Loaded after planet.js, so
// it can use the engine's globals directly (scG, gy, loc3, SC, P, height, …).
(() => {
    const SEC_V = 'COTTAGE VALLEY', SEC_S = 'STILLSTONES';
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const M = { wood: mat(0x6b4a34), woodD: mat(0x4a3224), stone: mat(0x8d867c), stoneD: mat(0x6c665f), rope: mat(0xb59a6a), straw: mat(0xd2b25c), cloth: mat(0x8a6a4a), roof: mat(0x59607a) };
    const glows = []; // { m: MeshBasicMaterial, day, night } — recoloured each frame
    const glowMat = (day, night) => { const m = new THREE.MeshBasicMaterial({ color: day }); glows.push({ m, day: new THREE.Color(day), night: new THREE.Color(night) }); return m; };
    const halos = []; const haloMat = (c) => { const m = new THREE.SpriteMaterial({ map: tMist, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }); halos.push(m); return m; };
    const clearOfLake = (x, n) => lakeE(x, n) > 1.12;
    const gnd = (x, n) => gy(x, n);
    const put = (o, x, n, dy = 0, ry = 0) => { o.position.set(x, gnd(x, n) + dy, -n); o.rotation.y = ry; scG.add(o); return o; };
    const bx = (w, h, d, m, x, y, z, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); (parent || scG).add(o); return o; };
    const cy = (rt, rb, h, m, x, y, z, seg = 6, parent) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y, z); (parent || scG).add(o); return o; };
    const rot = (o, x = 0, y = 0, z = 0) => { o.rotation.set(x, y, z); return o; };
    const poi = (p) => G.addPOI(p);
    const G = Game;
    const say = (speaker, text, extra) => ({ speaker, text, ...(extra || {}) });
    const talk = (owner, lines, opts) => Dialogue.show(lines, null, { owner, seed: 3, ...(opts || {}) });
    const nightNow = () => (G.day ?? 1) < 0.25;

    // --------------------------------------------------------------- resting
    // Hearth's rest system, simplified: sit somewhere good and the light moves on.
    async function rest(frac, why) {
        await G.fade(true);
        T += G.dayLen * frac; G.flags.rests = (G.flags.rests || 0) + 1;
        await new Promise((r) => setTimeout(r, G.settings.reduceMotion ? 50 : 900));
        await G.fade(false);
        G.toast(why || 'You rest a while.', 'the light has moved on'); G.write();
    }
    const restChoices = (label = 'Rest') => [
        { label: `${label} a little`, onSelect: () => { Dialogue.close(); rest(0.08); } },
        { label: `${label} until the light changes`, onSelect: () => { Dialogue.close(); rest(0.22); } },
        { label: 'Not now' },
    ];

    // ------------------------------------------------------------ cottage area
    // Door / porch
    poi({ id: 'cottage', name: 'The Cottage', x: 0, n: 12.5, r: 5, landmark: true, section: SEC_V, clue: 'A white house at the end of the path.',
        desc: 'A long white house with a slate roof. Every window is dark. The kettle-warmth in the air says someone left a moment ago.',
        journal: 'White clapboard, slate roof, stone chimney. Nobody home. The door is not locked. The door does not seem to want opening.',
        interact(p) {
            G.discover(p);
            talk('poi:cottage', [say('The Cottage', 'The door is painted the green of new leaves. The brass is warm, as if a hand had just left it.', {
                choices: [
                    { label: 'Knock', next: [say('', 'Three knocks.'), say('', 'Three knocks come back from inside. A little late. A little too evenly spaced.'), say('', 'You decide the porch is lovely this time of day.')] },
                    { label: 'Try the handle', next: [say('', 'It turns. The door opens a hand-width, and the dark behind it is deeper than the room should hold.'), say('', 'You let it close. It closes very gently, as if grateful.')] },
                    { label: 'Leave it be' },
                ] })]);
        } });

    // Porch radio (88.7 FM — the series' continuity frequency)
    const RADIO = { x: -5.6, n: 10.5 };
    { const g = new THREE.Group(); const st = cy(.5, .6, .55, M.woodD, 0, .27, 0, 7, g);
      bx(.62, .34, .26, mat(0x7a4a2a), 0, .72, 0, g); const dial = bx(.18, .1, .02, glowMat(0x6a5a3a, 0xffc878), -.14, .74, .14, g);
      bx(.22, .16, .02, mat(0x2b2118), .12, .72, .14, g); const an = cy(.012, .012, .8, mat(0x999999), .22, 1.2, 0, 4, g); an.rotation.z = -.35;
      put(g, RADIO.x, RADIO.n, 0, .5); }
    G.radioLevel = () => { if (!SC || G.paused) return 0; const L = G.local(), d = Math.hypot(L.x - RADIO.x, L.n - RADIO.n); return d < 26 ? Math.pow(1 - d / 26, 2) * (G.flags.radioTuned ? 0.4 : 0.9) : 0; };
    poi({ id: 'radio', name: 'The Porch Radio', x: RADIO.x, n: RADIO.n, r: 3, landmark: true, section: SEC_V, clue: 'Something hisses near the cottage.',
        desc: '', journal: 'A wooden radio on a stump. Dial stuck at 88.7. It plays even though nothing is plugged into it.',
        interact(p) {
            G.discover(p);
            const hub = () => say('88.7', G.flags.radioTuned ? 'The static thins. A voice, flat and kind, like someone reading to a sleeping house.' : 'Static, soft as rain on a tin roof. Under it, a voice — or a shape the static makes when it wants to be a voice.', {
                choices: [
                    { label: 'Listen', onSelect: () => { G.flags.radioTuned = 1; G.addNote('radio1', 'Continuity', 'Broadcast, 88.7 FM: "...this is a continuity announcement. The meadow is holding. If you can hear this, stay on the path. Do not follow the lights past the water. This announcement will repeat."'); talk('poi:radio', [say('88.7', '"...this is a continuity announcement. The meadow is holding."'), say('88.7', '"If you can hear this, stay on the path. Do not follow the lights past the water."'), say('88.7', '"This announcement will repeat."'), say('', 'It does. Word for word. Even the breath before "meadow."')]); } },
                    { label: 'Turn the dial', onSelect: () => talk('poi:radio', [say('', 'The dial does not move. It was never connected to anything. You can feel that, somehow, the way you can feel a stair that is not there.')]) },
                    { label: 'Leave it' },
                ] });
            talk('poi:radio', [hub()]);
        } });

    // Mailbox
    { const mx = pathX(-4) + 2.4, mn = -4; const g = new THREE.Group(); cy(.05, .05, 1.1, M.woodD, 0, .55, 0, 5, g); bx(.34, .3, .6, mat(0x3f5f7a), 0, 1.2, 0, g); bx(.05, .24, .05, mat(0xd94a3a), .2, 1.4, .1, g); put(g, mx, mn, 0, -.4);
      poi({ id: 'mailbox', name: 'The Mailbox', x: mx, n: mn, r: 3, landmark: true, section: SEC_V, clue: 'Somebody still expects letters.',
        desc: '', journal: 'A blue mailbox at the foot of the path. One letter, addressed to whoever is first.',
        interact(p) { G.discover(p); talk('poi:mailbox', [say('A letter', '"To whoever finds the kettle warm —'), say('A letter', 'the grass is longer than it was. Please do not count the windows from outside. There are always one fewer than there should be, and it is rude to remark on it.'), say('A letter', 'Help yourself to the cherry tree. Say hello to Tuuli. — M."')]); G.flags.letter = 1; } }); }

    // Lantern posts along the path (light themselves at night; no real lights = cheap)
    { const lampM = glowMat(0x3a3328, 0xffd48a), pm = haloMat(0xffc070);
      for (let n = -126; n <= 6; n += 22) { for (const s of [1, -1]) { if (n > -10 && s < 0) continue; const x = pathX(n) + s * 2.7; const g = new THREE.Group(); cy(.06, .08, 2.3, M.woodD, 0, 1.15, 0, 5, g); bx(.34, .42, .34, lampM, 0, 2.5, 0, g); bx(.46, .08, .46, M.woodD, 0, 2.78, 0, g); const sp = new THREE.Sprite(pm); sp.position.set(0, 2.5, 0); sp.scale.set(7, 7, 1); g.add(sp); put(g, x, n); } } }

    // Wishing well
    { const g = new THREE.Group(); const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, .95, 9, 1, true), new THREE.MeshLambertMaterial({ color: 0x8d867c, side: THREE.DoubleSide })); ring.position.y = .47; g.add(ring);
      const wtr = new THREE.Mesh(new THREE.CircleGeometry(1.15, 9), new THREE.MeshBasicMaterial({ color: 0x0c1c26 })); wtr.rotation.x = -Math.PI / 2; wtr.position.y = .3; g.add(wtr);
      for (const s of [-1, 1]) cy(.08, .08, 2.6, M.wood, s * 1.15, 1.3, 0, 5, g); bx(2.7, .12, .14, M.wood, 0, 2.6, 0, g);
      const rf = new THREE.Mesh(new THREE.ConeGeometry(1.7, .9, 4), M.roof); rf.position.y = 3.15; rf.rotation.y = Math.PI / 4; g.add(rf); put(g, 70, -40, 0, .3); }
    const WISH = ['The coin falls a long way. You never hear it land.', 'The coin falls. Somewhere below, a very small something says "thank you."', 'The coin falls. The well exhales, warm, smelling of cut grass.', 'The coin falls. It is a long time before the sound comes, and when it does it is the sound of a door.'];
    poi({ id: 'well', name: 'The Wishing Well', x: 70, n: -40, r: 4, landmark: true, section: SEC_V, clue: 'People used to wish at a well, east of the path.',
        desc: '', journal: 'A stone well with a little roof. The water is further down than any well should be.',
        interact(p) {
            G.discover(p);
            const wishes = G.flags.wishes || 0;
            talk('poi:well', [say('The Wishing Well', wishes ? 'The well waits. It has the manner of something that has all the time there is.' : 'A rope, a bucket, and a smell of cold stone. Something glints at the bottom — a great many coins, and no one has been here in a long time.', {
                choices: [{ label: 'Drop in a coin', onSelect: () => { G.flags.wishes = wishes + 1; const lines = [say('', WISH[wishes % WISH.length])]; if (wishes + 1 === 3) { lines.push(say('The Well', '"Three. Most stop at three. You can tell the kind of person by who does not."')); G.addNote('well', 'The Well', 'Three coins down the well. It said most people stop at three. It said it like someone who is not sure they approve.'); } talk('poi:well', lines); } },
                    { label: 'Lean over and listen', next: [say('', 'Below the water-sound there is a second sound, regular, patient. It could be a clock. It could be a step.')] },
                    { label: 'Step back' }] })]);
        } });

    // Old cherry tree — rest spot
    poi({ id: 'cherry', name: 'The Old Cherry', x: 23, n: 18.5, r: 6, landmark: true, section: SEC_V, clue: 'The oldest blossoming tree in the valley, east of the cottage.',
        desc: '', journal: 'A cherry tree in permanent bloom. Petals fall up when you are not looking.',
        interact(p) {
            G.discover(p);
            talk('poi:cherry', [say('The Old Cherry', 'Petals drift down through the light. The grass under the tree is the only place in the valley that is entirely quiet.', { choices: [{ label: 'Sit beneath it', next: [say('', 'The bark is warm. The wind in the blossom sounds like someone saying your name, kindly, in a language you almost have.')].concat([{ text: 'Rest here?', choices: restChoices('Rest') }]) }, { label: 'Walk on' }] })]);
        } });

    // ---------------------------------------------------------------- Tuuli (fox)
    const fox = (() => {
        const g = new THREE.Group(), body = mat(0xd9772f), cream = mat(0xf3e4c8), dk = mat(0x2a1a14);
        bx(.5, .42, 1.05, body, 0, .6, 0, g); const head = new THREE.Group(); head.position.set(0, .88, .62); g.add(head);
        bx(.4, .34, .42, body, 0, 0, 0, head); bx(.2, .16, .3, cream, 0, -.07, .3, head); bx(.07, .07, .06, dk, 0, -.02, .46, head);
        for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(.1, .26, 4), body); e.position.set(s * .13, .26, -.04); head.add(e); bx(.05, .05, .03, dk, s * .1, .06, .21, head); }
        const tail = new THREE.Group(); tail.position.set(0, .62, -.52); g.add(tail); const tb = new THREE.Mesh(new THREE.ConeGeometry(.2, .85, 5), body); tb.rotation.x = -Math.PI / 2 - .5; tb.position.set(0, .12, -.36); tail.add(tb);
        const tt = new THREE.Mesh(new THREE.ConeGeometry(.12, .3, 5), cream); tt.rotation.x = -Math.PI / 2 - .5; tt.position.set(0, .35, -.72); tail.add(tt);
        for (const [x, z] of [[-.16, .38], [.16, .38], [-.16, -.38], [.16, -.38]]) bx(.1, .4, .1, dk, x, .2, z, g);
        const x = 19.5, n = 14; put(g, x, n, 0, 2.2); return { g, head, tail, x, n }; })();
    function foxTalk(first) {
        const S = 'Tuuli';
        const ask = (label, answer) => ({ label, onSelect: () => talk('npc:fox', [say(S, answer), hub()]) });
        const hub = () => say(S, first && !G.flags.metFox ? 'Oh. You came the long way. Everyone does, the first time.' : 'Mm? Ask, then. I have nowhere better to be. Nowhere at all, really.', {
            choices: [
                ask('Where am I?', 'Ilmis. A whole planet, if you are counting. It is mostly grass. We stopped counting a long time ago, and the grass did not mind.'),
                ask('Who lives in the cottage?', 'Someone very good at leaving a kettle warm. I have never seen them. I have heard the three knocks, though. You knock back, do you? Most do.'),
                ask('What are the stones?', 'Stillstones. Put a hand on one and it remembers all the others. The world is a thousand kilometres wide and your legs are not. Use the one by the cottage path.'),
                ask('The radio?', 'It is only on when it wants to be heard. 88.7. Do not try the dial. It has never been about the dial.'),
                ask('Who are you?', 'Tuuli. It means wind. I was a fox once, I think. Now I am the thing that sits under the cherry tree so the cherry tree has something to be tall at.'),
                { label: 'Goodbye', onSelect: () => talk('npc:fox', [say(S, 'Mind the lights past the water. And if the scarecrow has moved, it has not.')]) },
            ] });
        G.flags.metFox = 1; return hub();
    }
    poi({ id: 'fox', name: 'Tuuli', prompt: 'Talk to Tuuli', x: fox.x, n: fox.n, r: 3, interact(p) { talk('npc:fox', [foxTalk(true)]); G.addNote('tuuli', 'Tuuli', 'A fox who says she is the wind. Sits under the old cherry. Knows about the Stillstones and the radio, and is careful about the cottage.'); } });

    // ------------------------------------------------------------ Quiet Ring
    const RING = { x: -150, n: -60 }; const runes = glowMat(0x2a2832, 0x9ad8ff), rpm = haloMat(0x8ad0ff);
    { const g = new THREE.Group(); const slab = cy(2.6, 2.8, .25, M.stoneD, 0, .1, 0, 9, g);
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, r = 9 + (H(i, 1, 1) - .5) * 1.4, h = 3.2 + H(i, 2, 2) * 2.2; const s = new THREE.Mesh(new THREE.CylinderGeometry(.5, .85, h, 5), M.stone); s.position.set(Math.cos(a) * r, h / 2 - .2, Math.sin(a) * r); s.rotation.set((H(i, 3, 3) - .5) * .12, H(i, 4, 4) * 3, (H(i, 5, 5) - .5) * .12); g.add(s);
          const rn = new THREE.Mesh(new THREE.BoxGeometry(.18, h * .55, .05), runes); rn.position.set(Math.cos(a) * (r - .62), h / 2 + .1, Math.sin(a) * (r - .62)); rn.lookAt(0, h / 2 + .1, 0); g.add(rn); }
      const sp = new THREE.Sprite(rpm); sp.position.set(0, 2, 0); sp.scale.set(26, 14, 1); g.add(sp); put(g, RING.x, RING.n, 0, 0); }
    poi({ id: 'ring', name: 'The Quiet Ring', x: RING.x, n: RING.n, r: 9, landmark: true, section: SEC_V, clue: 'Stones stand in a circle, far west across the meadow.',
        desc: '', journal: 'Seven standing stones around a flat slab. They hum a half-step under the wind. Cold on the inside, warm on the outside.',
        interact(p) {
            G.discover(p);
            const night = nightNow();
            talk('poi:ring', [say('The Quiet Ring', night ? 'The runes are lit — pale blue, slow as breath. Seven stones, and the seventh is always standing just behind you.' : 'Seven stones around a flat slab. In daylight the carvings are only scratches. They look tired.', {
                choices: [{ label: 'Stand in the centre', next: [say('', 'The wind stops at the edge of the ring, politely, as at a threshold.'), say('', night ? 'You hear your own pulse, and then, a beat behind it, someone else\'s.' : 'It is very quiet. It is the sort of quiet that is listening back.')] }, { label: 'Touch a stone', onSelect: () => { G.addNote('ring', 'The Ring', 'The Quiet Ring hums a half-step flat of the wind. It is cold inside the stones and warm outside, as if they were facing the wrong way round.'); talk('poi:ring', [say('', 'Warm on the outside. Cold in the middle. The stone is wrong way out, somehow, and perfectly content about it.')]); } }, { label: 'Leave' }] })]);
        } });

    // -------------------------------------------------------------- Scarecrow
    const SCR = { x: -41, n: -82 }; const scare = new THREE.Group();
    { cy(.07, .09, 2.6, M.woodD, 0, 1.3, 0, 5, scare); bx(1.9, .1, .1, M.woodD, 0, 1.9, 0, scare);
      const hd = new THREE.Mesh(new THREE.SphereGeometry(.28, 6, 5), mat(0xc9b283)); hd.position.set(0, 2.55, 0); scare.add(hd); const hat = new THREE.Mesh(new THREE.ConeGeometry(.35, .5, 6), M.cloth); hat.position.set(0, 2.95, 0); scare.add(hat); bx(.8, .06, .8, M.cloth, 0, 2.7, 0, scare);
      bx(.14, .14, .06, mat(0x111111), -.1, 2.57, .25, scare); bx(.14, .14, .06, mat(0x111111), .1, 2.57, .25, scare);
      bx(.7, 1.1, .3, M.cloth, 0, 1.45, 0, scare); for (const s of [-1, 1]) { bx(.08, .5, .06, M.straw, s * .9, 1.7, 0, scare); bx(.08, .5, .06, M.straw, s * .5, 1.0, .05, scare); }
      put(scare, SCR.x, SCR.n, 0, 0); }
    poi({ id: 'scarecrow', name: 'The Patient Scarecrow', x: SCR.x, n: SCR.n, r: 3.5, landmark: true, section: SEC_V, clue: 'Something stands in the field south of the cottage, off the path.',
        desc: '', journal: 'A scarecrow that has been standing a long while. It is always a little closer than you remember. Never when you are looking.',
        interact(p) {
            G.discover(p); G.flags.scareTalks = (G.flags.scareTalks || 0) + 1;
            const k = G.flags.scareTalks;
            talk('poi:scarecrow', [say('The Patient Scarecrow', k === 1 ? 'Burlap, straw, two button eyes. A field ought to have a scarecrow. Yet there is no crop here — nothing to scare off, and no field, only the grass.' : 'It is exactly where you left it. You have a distinct memory of it being further away.', {
                choices: [{ label: 'Look it in the eye', next: [say('', 'Button eyes. Dull. Unremarkable.'), say('', 'You look away to check the path. When you look back, the buttons have not moved. But you are quite sure the head has.')] }, { label: 'Ask it something', next: [say('', 'It does not answer. It was never going to.'), say('', 'But the wind, which had been steady, stops for exactly as long as it takes to say a question.')] }, { label: 'Walk away, and do not turn around' }] })]);
        } });

    // -------------------------------------------------------- Pier + heron (Marren)
    { const pm = M.wood; for (let k = 0; k < 48; k++) { const n = 76 + k * .62; bx(3.1, .14, .52, pm, 0, Math.max(WL + .55, gy(0, n) + .12), -n); }
      for (let n = 88; n <= 104; n += 4) for (const s of [-1, 1]) cy(.15, .15, 5.2, M.woodD, s * 1.7, WL - 1.9, -n, 5);
      const boat = new THREE.Group(); const hull = bx(1.5, .4, 3.4, mat(0x5a4a3a), 0, 0, 0, boat); bx(1.2, .08, 3, mat(0x7a6650), 0, .2, 0, boat); boat.position.set(4.6, WL + .12, -98); boat.rotation.y = .3; scG.add(boat); }
    const heron = (() => {
        const g = new THREE.Group(), grey = mat(0x7d8fa3), pale = mat(0xe6ebef), ye = mat(0xd9b04a);
        for (const s of [-1, 1]) cy(.025, .025, 1.2, ye, s * .1, .6, 0, 4, g); const body = new THREE.Mesh(new THREE.SphereGeometry(.34, 6, 5), grey); body.scale.set(.8, .8, 1.5); body.position.set(0, 1.28, 0); g.add(body);
        const neck = new THREE.Group(); neck.position.set(0, 1.35, .35); g.add(neck); const nk = cy(.05, .06, .85, pale, 0, .4, 0, 5, neck); nk.rotation.x = -.15; const hd = new THREE.Mesh(new THREE.SphereGeometry(.09, 5, 4), pale); hd.position.set(0, .85, .06); neck.add(hd);
        const bk = new THREE.Mesh(new THREE.ConeGeometry(.04, .38, 4), ye); bk.rotation.x = Math.PI / 2; bk.position.set(0, .83, .27); neck.add(bk);
        const tl = new THREE.Mesh(new THREE.ConeGeometry(.12, .6, 4), grey); tl.rotation.x = Math.PI / 2 + .3; tl.position.set(0, 1.2, -.62); g.add(tl);
        const x = 1.5, n = 82; put(g, x, n, 0, Math.PI); return { g, neck, x, n }; })();
    function heronTalk() {
        const S = 'Marren';
        const first = !G.flags.metHeron; G.flags.metHeron = 1;
        const q = () => say(S, first ? 'Hm. A new reflection. Sit a while, or stand; the water does not mind either. May I ask you one thing?' : 'Ah. You came back. The water remembers you. It would like to know if you have changed your mind.', {
            choices: [
                { label: 'Ask away', onSelect: () => talk('npc:heron', [say(S, 'Do you remember what you were? Before the grass.', { choices: [
                    { label: 'A fox', onSelect: () => ans('fox', 'A fox. Tuuli is a fox, you know. She has been asking everyone, in her way, whether she was good at it.') },
                    { label: 'A bird', onSelect: () => ans('bird', 'A bird. Yes. I thought so. You stand like someone who is tired of being asked to hold still.') },
                    { label: 'Something small', onSelect: () => ans('small', 'Something small. The best of us were. Small things are what grass is for.') },
                    { label: 'I do not remember', onSelect: () => ans('none', 'Nor do I. That is the arrangement. If you hear anyone claiming otherwise, they are selling a lantern.') }] })]) },
                { label: 'What are the lights past the water?', onSelect: () => talk('npc:heron', [say(S, 'The far shore is not a shore. It is a wall painted to look like one. And the lights are the windows in the wall, and I do not ask whose.'), q()]) },
                { label: 'Leave him to the water' }] });
        function ans(k, line) { G.flags.heronAnswer = k; G.addNote('heron', 'Marren\'s Question', 'The heron by the pier asked what I was before the grass. I answered: ' + ({ fox: 'a fox', bird: 'a bird', small: 'something small', none: 'nothing I remember' })[k] + '.'); talk('npc:heron', [say(S, line), say(S, 'The pier is yours to stand at. Mind the boat; it has been trying to leave for a very long time.')]); }
        return q();
    }
    poi({ id: 'heron', name: 'Marren', prompt: 'Talk to Marren', x: heron.x, n: heron.n, r: 4, landmark: true, section: SEC_V, clue: 'A grey figure waits on the old pier at the lake\'s edge.',
        journal: 'A heron on the pier, patient as stone. Asks one question and keeps your answer.',
        interact(p) { G.discover(p); talk('npc:heron', [heronTalk()]); } });

    // ----------------------------------------------------- Falls, Crown, Spyglass
    { const fx = 20, fn = cliffZ(20) - 28; const g = new THREE.Group(); cy(.07, .09, 1.7, M.wood, 0, .85, 0, 5, g); bx(1.3, .45, .08, mat(0x8a6a44), 0, 1.5, 0, g); put(g, fx, fn - 3, 0, .5);
      poi({ id: 'falls', name: 'The Five Falls', x: fx, n: fn, r: 14, landmark: true, section: SEC_V, clue: 'Water thunders, far north beyond the lake.',
        desc: '', journal: 'Three rivers fall down five terraces of rose-and-ochre sandstone. The mist makes small rainbows that last exactly as long as you stand still.',
        interact(p) { G.discover(p); talk('poi:falls', [say('The Five Falls', 'Five stepped terraces of warm stone and three white ribbons of water falling down them. The mist is cold, bright, and smells of coins.'), say('The Five Falls', 'Nobody carved the steps. Nobody could have. And yet they are all exactly the same height.', { choices: [{ label: 'Climb to the top', next: [say('', 'It is a long way. The risers are steep but kind, as if the cliff had decided, on reflection, to be a staircase.')] }, { label: 'Stay a while' }] })]); } }); }
    { const cx = 20, cn = cliffZ(20) + 4 * LED + 34; const g = new THREE.Group(); for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5 - i * .22, 0), M.stone); s.scale.y = .55; s.position.set((H(i, 1, 9) - .5) * .3, .5 + i * .72, 0); s.rotation.y = i * 1.1; g.add(s); } put(g, cx, cn, 0, 0);
      poi({ id: 'crown', name: 'The Crown', x: cx, n: cn, r: 10, landmark: true, section: SEC_V, clue: 'Where does the water come from? Up.',
        desc: '', journal: 'A cairn at the very top of the falls. The whole valley is laid out like a map someone has been using.',
        interact(p) { G.discover(p); talk('poi:crown', [say('The Crown', 'A cairn of five stones, each smaller than the last. From here the cottage is a white crumb and the path a pencil line.'), say('The Crown', 'You can see where the valley ends. You can see where the world curves. Out there, in other colours, the other lands wait — and each one has a Stillstone standing in it.', { choices: [{ label: 'Rest here', next: [{ text: 'The wind up here has a plan.', choices: restChoices('Rest') }] }, { label: 'Look out over the valley' }] })]); } }); }
    { const sx = 120, sn = 30; const g = new THREE.Group(); bx(3.2, .35, 3.2, M.stoneD, 0, .15, 0, g); for (let i = 0; i < 3; i++) { const a = i * 2.09, l = cy(.03, .03, 1.5, M.woodD, Math.cos(a) * .42, .8, Math.sin(a) * .42, 4, g); l.rotation.set(Math.sin(a) * .3, 0, -Math.cos(a) * .3); } const tube = cy(.09, .07, 1.3, mat(0x8b6f3f), 0, 1.6, 0, 8, g); tube.rotation.z = Math.PI / 2 - .85; bx(2, .12, .6, M.wood, 2.2, .55, 0, g); bx(.1, .5, .5, M.woodD, 1.4, .3, 0, g); bx(.1, .5, .5, M.woodD, 3, .3, 0, g); put(g, sx, sn, .2, -.6);
      poi({ id: 'spyglass', name: 'The Stargazer\'s Spyglass', x: sx, n: sn, r: 4, landmark: true, section: SEC_V, clue: 'Someone left a telescope pointed at the sky.',
        desc: '', journal: 'A brass spyglass on a tripod, aimed at one particular patch of sky. At night: the other worlds.',
        interact(p) { G.discover(p); const night = nightNow();
            talk('poi:spyglass', night ? [say('The Spyglass', 'The eyepiece is cold. At first there are only stars. Then you notice that some of them are lit windows, in rows, very far away.'), say('The Spyglass', 'One of them, you are quite sure, has just closed its curtain.', { choices: [{ label: 'Look longer', next: [say('', 'The stars rearrange themselves, politely, into the shape of the cottage window. Then the shape of a face in it.')] }, { label: 'Step back' }] })]
                : [say('The Spyglass', 'The sun fills the eyepiece with white. Whoever left this aimed it at a place where the sky is only blue — a patch you could mistake for a mistake.'), say('The Spyglass', 'Come back after dark.', { choices: restChoices('Wait') })]); } }); }

    // --------------------------------------------------------- Stillstones
    // The hub stone sits by the cottage path; the other seven stand in the far
    // biomes. Fast travel is a dialogue choice list (Hearth's dialogue system).
    const BIOMES = [
        { k: 'lu', thr: .95, name: 'Flower Meadow', tone: 0xf0a9c4, desc: 'Colour without a source. Every petal is a different shade and none of them agree where the light is coming from.' },
        { k: 'ic', thr: .95, name: 'Winter Lands', tone: 0xb7dfff, desc: 'Snow that never melts and never quite falls the same way twice. The cold here has manners.' },
        { k: 'mu', thr: .9, name: 'Spore Forest', tone: 0xc08ae6, desc: 'The mushrooms breathe on a schedule. You are, for now, between breaths.' },
        { k: 'de', thr: .95, name: 'Summer Desert', tone: 0xf2cf7a, desc: 'Sand remembers footprints longer than people do. Yours are already filling in. Others are not.' },
        { k: 'sw', thr: .9, name: 'Rain Swamp', tone: 0x8ac8a0, desc: 'It has been raining here since before there were words for it. The frogs have their own word.' },
        { k: 'be', thr: .93, name: 'Tidal Flats', tone: 0x9ad8e0, desc: 'The sea left in a hurry and forgot to take the sky. The sky is still down on the sand, in puddles, looking up.' },
        { k: 'ci', thr: .5, name: 'Overgrown City', tone: 0xe8c89a, desc: 'Somebody built this for a crowd. The grass has been very polite about it. Nobody has come back to say thank you.' },
    ];
    const stones = []; // far Stillstones
    const dirLocal = (x, n) => SC.O.clone().addScaledVector(SC.E, x).addScaledVector(SC.N, n).normalize();
    function arriveAt(dir, off) {
        const v = dir.clone().normalize(); const t = new V().crossVectors(v, Math.abs(v.y) > .9 ? new V(1, 0, 0) : Y).normalize();
        const q = v.clone().addScaledVector(t, off / R).normalize(); P.copy(q).multiplyScalar(R + height(q, .5) + 1.7);
    }
    async function travel(dest) {
        Dialogue.close(); G.fading = true; await G.fade(true);
        arriveAt(dest.dir, dest.off || 6);
        await new Promise((r) => setTimeout(r, G.settings.reduceMotion ? 300 : 3200)); // let terrain chunks stream in
        zone(dest.name.toUpperCase()); await G.fade(false); G.fading = false; G.write();
    }
    const HUB = { name: 'Cottage Stillstone', hubX: -11, hubN: -12 };
    HUB.dir = null;
    function hubTalk() {
        const dests = [{ name: 'Cottage Valley (stay)', skip: true }].concat(stones.map((s) => ({ s })));
        const choices = stones.map((s) => ({ label: `${G.discovered['stone_' + s.k] ? '' : '? '}${s.name}`, onSelect: () => travel(s) }));
        choices.push({ label: 'Not yet' });
        talk('poi:hub', [say('The Cottage Stillstone', 'The stone is the grey of rain, and warm as a held hand. Under your palm you can feel other stones, far away, each answering in its own weather.'), say('The Cottage Stillstone', 'Where do you want to be?', { choices })]);
    }
    { const g = new THREE.Group(); cy(1.4, 1.6, .35, M.stoneD, 0, .1, 0, 8, g); const ob = new THREE.Mesh(new THREE.CylinderGeometry(.35, .7, 3.4, 4), M.stone); ob.position.y = 1.9; ob.rotation.y = .4; g.add(ob);
      const top = new THREE.Mesh(new THREE.OctahedronGeometry(.32, 0), glowMat(0xb9a3d9, 0xe0d0ff)); top.position.y = 3.9; g.add(top); const sp = new THREE.Sprite(haloMat(0xb9a3d9)); sp.position.y = 3.9; sp.scale.set(8, 8, 1); g.add(sp); put(g, HUB.hubX, HUB.hubN, 0, .2); G.frameHooks.push((dt) => { top.rotation.y += dt; top.position.y = 3.9 + Math.sin(T * 1.7) * .1; }); }
    poi({ id: 'hub', name: 'The Cottage Stillstone', prompt: 'Touch the Stillstone', x: HUB.hubX, n: HUB.hubN, r: 3.5, landmark: true, section: SEC_S, clue: 'A grey standing stone near the start of the path. Warm.',
        journal: 'The home Stillstone. Remembers every other. Carries you there if you ask politely.',
        interact(p) { G.discover(p); G.flags.stoneTouched = 1; hubTalk(); } });

    // Find a spot for each far stone (deterministic, hash-driven like the spawn search).
    for (const bm of BIOMES) {
        let best = null;
        for (let i = 0; i < 30000 && !best; i++) {
            const d = new V(H(i, 11, 1) * 2 - 1, H(i, 12, 2) * 2 - 1, H(i, 13, 3) * 2 - 1); const l2 = d.lengthSq(); if (l2 > 1 || l2 < .1) continue; d.normalize();
            const b = biome(d); if (b[bm.k] < bm.thr) continue; const hh = height(d, 60); if (hh < -2 || hh > 350) continue; best = d;
        }
        if (!best) { console.warn('[ilmis] no site found for', bm.name); continue; }
        const st = { ...bm, dir: best, off: 6, mesh: new THREE.Group() };
        const col = new THREE.Color(bm.tone), g = st.mesh; cy(1.3, 1.5, .3, M.stoneD, 0, 0, 0, 8, g);
        const ob = new THREE.Mesh(new THREE.CylinderGeometry(.32, .62, 3, 4), M.stone); ob.position.y = 1.5; ob.rotation.y = H(1, 1, bm.k.charCodeAt(0)) * 3; g.add(ob);
        const gm = new THREE.MeshBasicMaterial({ color: col }); const top = new THREE.Mesh(new THREE.OctahedronGeometry(.3, 0), gm); top.position.y = 3.4; g.add(top);
        const hm = new THREE.SpriteMaterial({ map: tMist, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .55 }); const sp = new THREE.Sprite(hm); sp.position.y = 3.4; sp.scale.set(9, 9, 1); g.add(sp);
        st.top = top; st.surf = best.clone().multiplyScalar(R + height(best, .5)); st.q = new Q().setFromUnitVectors(Y, best); g.quaternion.copy(st.q); g.visible = false; scene.add(g);
        stones.push(st);
        poi({ id: 'stone_' + bm.k, name: bm.name + ' Stillstone', prompt: 'Touch the Stillstone', world: true, worldPos: st.surf, r: 3.5, landmark: true, section: SEC_S, clue: 'A Stillstone somewhere in the ' + bm.name + '. Reach it from the cottage stone.',
            journal: bm.desc,
            interact(p) {
                const first = G.discover(p);
                talk('poi:stone_' + bm.k, [say(bm.name, bm.desc), say('Stillstone', 'It hums once, a note you did not know you were waiting for.', { choices: [
                    { label: 'Rest here', next: [{ text: 'You sit with your back to the stone.', choices: restChoices('Rest') }] },
                    { label: 'Return to the cottage', onSelect: () => travel({ name: 'Cottage Valley', dir: dirLocal(HUB.hubX + 2.2, HUB.hubN + 2.2), off: 0 }) },
                    { label: 'Stay and look around' }] })]);
                if (first) G.addNote('stone_' + bm.k, bm.name, bm.desc);
            } });
    }
    // Far stones: show + float-origin positioned only when close; glow pulses.
    G.frameHooks.push((dt) => {
        for (const s of stones) {
            const d = P.distanceTo(s.surf), near = d < 4500; s.mesh.visible = near; if (!near) continue;
            s.mesh.position.copy(s.surf).sub(P).addScaledVector(s.dir, -.15); s.top.rotation.y += dt * 1.2; s.top.position.y = 3.4 + Math.sin(T * 1.6 + s.k.charCodeAt(0)) * .1;
        }
    });

    // ----------------------------------------------------------- Ambient frame
    G.frameHooks.push((dt) => {
        if (!SC) return;
        const day = G.day ?? 1, night = 1 - Math.min(1, Math.max(0, (day - .05) / .45));
        for (const g of glows) g.m.color.copy(g.day).lerp(g.night, night);
        for (const h of halos) h.opacity = .75 * night;
        const l = P.clone().sub(SC.O).applyQuaternion(SC.qi), px = l.x, pz = l.z;
        // Tuuli looks at you and swishes her tail
        const fdx = px - fox.x, fdz = pz + fox.n, fd = Math.hypot(fdx, fdz);
        if (fd < 40) { const want = Math.atan2(fdx, fdz); let df = want - fox.g.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df)); fox.g.rotation.y += df * Math.min(1, dt * 2.5); }
        fox.tail.rotation.y = Math.sin(T * 2.2) * .35; fox.head.rotation.x = Math.sin(T * .8) * .05;
        // Marren: slow neck, turns to the water
        heron.neck.rotation.x = Math.sin(T * .4) * .08 + (Math.sin(T * .13) > .96 ? .5 : 0);
        // The scarecrow only moves when you are not looking at it
        const f = new V(0, 0, -1).applyQuaternion(G.cq || new Q()).applyQuaternion(SC.qi);
        const sdx = SCR.x - px, sdz = -SCR.n - pz, sd = Math.hypot(sdx, sdz) || 1, facing = (f.x * sdx + f.z * sdz) / sd, inView = facing > .35;
                const want = Math.atan2(px - SCR.x, pz + SCR.n);
        if (!inView && sd < 140 && sd > 6) { const spd = (nightNow() ? .5 : .15) * dt; const dx = px - scare.position.x, dz = pz - scare.position.z; scare.position.x += dx / sd * spd * Math.min(1, (140 - sd) / 140) * 1.5; scare.position.z += dz / sd * spd * Math.min(1, (140 - sd) / 140) * 1.5; let df = want - scare.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df)); scare.rotation.y += df * Math.min(1, dt * 1.5); SCR.x = scare.position.x; SCR.n = -scare.position.z; scare.position.y = gy(SCR.x, SCR.n); }
    });
    // Scarecrow POI follows the scarecrow
    G.pois.find((p) => p.id === 'scarecrow').getPos = () => SCR;

    // New game: short opening
    G.onNewGame = () => {
        Dialogue.show([
            say('', 'You remember the grass before you remember your name.'),
            say('', 'A white house, a path, a lot of sky. Somewhere a kettle has just been taken off the boil.'),
            say('', 'It is a whole planet, and you are standing on the one place that has been tidied for you.'),
        ], () => G.hint('The valley has things worth looking at — a <b>radio</b>, a <b>stone</b>, a <b>fox</b>. Walk up to anything and press <span class="keycap">E</span>. <b>Esc</b> opens your journal.', 11000), { owner: 'intro', autoClose: 3, seed: 5 });
    };
})();
