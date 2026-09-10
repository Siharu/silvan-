// Act I: The Hearth — Silvan's Map 1 story, locked script (see
// hearth-story-brief.md / project memory for the full source dialogue
// this was built from). Drives the existing animal rigs in
// environment/animals.js through their scripted first meetings instead
// of the generic 30%/15% coin-flip recruit, then escalates the day/night
// cycle into three nights of a growing light across the water, ending in
// a forced choice at the shoreline that fades out into Map 2 (Kalyazin).
//
// Deliberately NOT implemented here: the Boundary Walk (Day 1, southern
// bluffs) and Unburied Bone (Day 2, willow tree) beats from the script.
// Both are proximity-triggered at specific island locations, but this
// project's terrain is procedurally generated per-seed — there's no
// fixed "southern bluff" or "willow tree" coordinate to hardcode without
// either guessing blindly (risking spawning the trigger underwater or
// inside a rock, same class of bug findDryAnchor() in animals.js was
// written to avoid) or building real landmark-placement logic first.
// Flagging rather than faking a placement.

import { showDialogue, isDialogueActive, advanceDialogue as advanceDialogueUI } from './dialogue.js';
import { ensureAudioContext } from './audio.js';

const RECRUIT_RANGE = 3.2; // mirrors environment/animals.js's own constant — kept separate rather than exported/shared since it's a proximity threshold specific to that file's animal list, not a shared game constant

export function initStory(state) {
    state.story = {
        stage: 'wake',       // wake -> bimo_pending -> grouped -> escalating -> shoreline_ready -> transitioning -> done
        introShown: false,
        nightsSeen: 0,
        wasNight: true,      // gameTime starts at 0.5 (afternoon-ish) per day-night-cycle.js's default — set true so the very first day doesn't immediately register as a "new night"
    };
}

function rigByName(state, name) {
    return state.demoAnimals && state.demoAnimals.find(r => r.name === name);
}

function nearestDistTo(state, rig) {
    if (!rig) return Infinity;
    return Math.hypot(state.player.position.x - rig.root.position.x, state.player.position.z - rig.root.position.z);
}

// Called every frame from main.js, after updateDemoAnimals().
export function updateStory(state, dt) {
    const s = state.story;
    if (!s) return;

    if (!s.introShown && !isDialogueActive(state)) {
        s.introShown = true;
        showDialogue(state, [
            { text: "The world doesn't start with sight; it starts with warmth and dust motes." },
            { speaker: 'Kat', text: '...Where...?' },
        ]);
        s.stage = 'bimo_pending';
    }

    if (s.stage === 'bimo_pending') {
        const bimo = rigByName(state, 'Bimo');
        if (bimo && !isDialogueActive(state) && nearestDistTo(state, bimo) < RECRUIT_RANGE) {
            playBimoBrambles(state, bimo);
        }
    }

    // Night escalation — fires automatically once Bimo/Primo/Shu are all
    // grouped, rather than needing another interact prompt (matches the
    // script: "Kat wakes up first," it's ambient, not player-triggered).
    const isNight = (state.sunHeightNormalized || 0) <= 0;
    if ((s.stage === 'grouped' || s.stage === 'escalating') && isNight && !s.wasNight && !isDialogueActive(state)) {
        s.nightsSeen++;
        playNightBeat(state, s.nightsSeen);
    }
    s.wasNight = isNight;
}

function playBimoBrambles(state, bimo) {
    showDialogue(state, [
        { text: 'A creature is tangled in a thicket of wild blackberry brambles, thrashing quietly.' },
        {
            speaker: 'Bimo', text: '...',
            choices: [
                {
                    label: 'Gently bite at the vines to free him.',
                    onSelect: (st) => {
                        showDialogue(st, [
                            { text: 'Bimo freezes, feeling the pressure release. He scrambles out, shakes his coat until his ears snap, and pants heavily.' },
                            { speaker: 'Bimo', text: "...I was falling. Or running? No. It was cold, and then it wasn't. Who are you? Where's the back porch?" },
                        ], () => onBimoFreed(st));
                    },
                },
                {
                    label: 'Sit back and let out a sharp bark/meow to guide him.',
                    onSelect: (st) => {
                        showDialogue(st, [
                            { text: 'Bimo snaps his head toward your voice, using the sound to pull himself backward out of the thorn bush, leaving a few tufts of golden fur behind.' },
                            { speaker: 'Bimo', text: "Right. Voice. Good. I couldn't see straight for a second. The air smells like sweetgrass, but the ground feels wrong. Where's the fence?" },
                        ], () => onBimoFreed(st));
                    },
                },
            ],
        },
    ]);
}

function onBimoFreed(state) {
    const bimo = rigByName(state, 'Bimo');
    if (bimo) bimo.following = true; // scripted join — bypasses attemptRecruitInteraction's coin flip entirely, this isn't a maybe
    state.story.stage = 'primo_pending';

    const shu = rigByName(state, 'Shuu');
    showDialogue(state, [
        { text: 'A soft, dry crunch of leaves draws attention to the sunlit roots of an ancient oak tree. Sitting perfectly tucked into a "bread loaf" pose — tail hidden, front paws folded entirely under her chest — is Shu. She is small, black-and-white, and utterly unbothered.' },
        { speaker: 'Bimo', text: "Cat. It's a cat. I don't — my eye hurts just looking at you. But... wait. You smell like the yellow blanket. The one by the radiator. How do you smell like the blanket?" },
        { speaker: 'Shu', text: "The grass is warm. The wind doesn't blow hard here. Sit down. You're making the air noisy." },
        { speaker: 'Bimo', text: "She's right. The air is quiet. Too quiet. Hey, kid — Kat, was it? We should look around. Dogs don't just sit in clover. It's against the rules." },
    ], () => { if (shu) shu.following = true; });
}

function playPrimoStream(state) {
    const primo = rigByName(state, 'Primo');
    showDialogue(state, [
        { text: 'By the stream, Primo is splashing frantically, obsessively trying to catch a river-stone he thinks is swimming.' },
        { speaker: 'Primo', text: "Bimo! Bimo, look! The water here doesn't run out! In the old place, the water went down the metal hole, but here it just goes around and around!" },
        { speaker: 'Bimo', text: 'Slow down, kid. You\'re soaking the bread-cat.' },
        { speaker: 'Shu', text: 'I am water-resistant. But I prefer not to test it.' },
    ], () => {
        if (primo) primo.following = true;
        state.story.stage = 'grouped';
        state.timeSpeed = (state.timeSpeed || 0.02) * 3; // "the day/night cycles begin to accelerate strangely" — several short cycles instead of one long one, from here to the shoreline
    });
}

function playNightBeat(state, n) {
    if (n === 1) {
        showDialogue(state, [
            { text: 'Out across the black, silent ocean, miles away, a tiny, pinpoint speck of golden light glimmers on the horizon. It looks like a warm lantern floating on water.' },
            { speaker: 'Bimo', text: 'Just a star dropping low. Go back to sleep, Kat.' },
        ]);
    } else if (n === 2) {
        showDialogue(state, [
            { text: "The light returns. It is noticeably larger now — the size of a campfire, casting a long, shimmering amber needle across the dark water toward the island's shore." },
            { speaker: 'Primo', text: "It's not a star, Bimo. Stars don't hum. Can you hear it? It sounds like someone tapping a spoon against a ceramic bowl." },
            { speaker: 'Shu', text: 'It smells like cold air. Not bad cold. Open air.' },
        ]);
    } else {
        state.story.stage = 'shoreline_ready';
        showDialogue(state, [
            { text: 'The light dominates the night sky now. A towering column of radiance hovers just off the eastern beach. The water beneath it hums, and the pebbles on the beach dance.' },
            { speaker: 'Bimo', text: "There's nowhere left to walk here, Kat. We walked the whole circle three times today. I think whatever made that light wants us to see what's on the other side." },
            { speaker: 'Primo', text: "I'm not scared if you aren't, Bimo!" },
            {
                speaker: 'Bimo', text: "I'm always scared for you, dummy. Kat? What do we do?",
                choices: [
                    { label: 'Step boldly into the illuminated water.', onSelect: (st) => beginMapTransition(st, 'wade') },
                    { label: "Sit down and rest your head on Bimo's paws.", onSelect: (st) => beginMapTransition(st, 'curl') },
                ],
            },
        ]);
    }
}

function beginMapTransition(state, choice) {
    state.story.stage = 'transitioning';
    const closingLine = choice === 'wade'
        ? "Kat wades into the shallow, glowing foam. The water isn't cold; it feels like sunlight."
        : "Kat curls up right at the water's edge. Bimo wraps his golden body around the group. Shu: \"We don't have to run. The light is coming to us.\"";

    showDialogue(state, [
        { text: closingLine },
        { text: 'The amber glare swells, filling the screen with warm, blinding gold. The hum of the water slowly morphs into a harsh, metallic whistle.' },
    ], () => {
        const overlay = document.getElementById('rest-fade-overlay'); // reusing the sleep-transition fade from core/rest.js rather than building a second fade overlay
        if (overlay) overlay.classList.add('active');
        ensureAudioContext(state); // in case this is the very first user gesture (choice buttons count as a real click, but cheap to guard)
        setTimeout(() => {
            // Two separate HTML files/engines, not one game with a map
            // switch — Kalyazin is kalyazin_rt64_outpost4_full_game.html,
            // a completely different build (see BUG_REPORT.md). A real
            // in-engine map transition isn't possible here; a page
            // navigation is the actual mechanism. Assumes both files are
            // deployed side by side (same relative folder) — update this
            // path if that's not how they end up hosted.
            window.location.href = 'kalyazin_rt64_outpost4_full_game.html';
        }, 1800);
    });
}

// Called from main.js's interact-key handler, BEFORE
// attemptRecruitInteraction — returns true if it handled the keypress
// (either advancing an open dialogue, or firing Primo's scripted meeting),
// false to let the normal generic recruit flow run instead (e.g. once
// Act I is done, or for any animal not currently story-critical).
export function tryStoryInteract(state) {
    if (isDialogueActive(state)) { advanceDialogueUI(state); return true; }

    const s = state.story;
    if (!s) return false;
    if (s.stage === 'primo_pending' && state.currentInteractableAnimal === 'Primo') {
        playPrimoStream(state);
        return true;
    }

    // While Act I is running, Bimo/Primo/Shuu are story-controlled (join
    // only at their scripted moment) — swallow the generic coin-flip
    // recruit for them specifically so pressing E early can't skip ahead
    // of the script (e.g. recruiting Shu before Bimo's freed, or Primo
    // before his stream scene fires). Any other animal falls through to
    // the normal system untouched. #interact-prompt's hint still shows
    // near them, so it reads as "not yet" rather than silently broken.
    const storyControlled = ['Bimo', 'Primo', 'Shuu'];
    if (s.stage !== 'done' && storyControlled.includes(state.currentInteractableAnimal)) {
        return true;
    }

    return false;
}
