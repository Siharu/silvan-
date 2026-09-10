// Generic dialogue box UI — line-by-line narration/speaker text with
// optional branching choices. Built on #cutscene-caption, which existed
// in index.html with real CSS but was never wired to anything
// (state.cutsceneActive was referenced as a guard in
// environment/animals.js's updateInteractPrompt() but nothing ever set
// it — see BUG_REPORT.md's "still open" list from the earlier session).
// This is the first thing that actually drives it.
//
// Usage: showDialogue(state, [{speaker, text}, ...], onComplete?) queues
// a sequence of lines, advanced one at a time via advanceDialogue()
// (wired to the interact key in main.js). A line can instead carry
// `choices: [{label, onSelect}]` — when the queue reaches that line, it
// renders buttons instead of a continue hint, and onSelect is called
// with (state) when the player picks one; onSelect can itself call
// showDialogue() again to chain further lines (that's how story.js
// branches after Kat's brambles choice, the shoreline choice, etc).

let els = null;
function getEls() {
    if (els) return els;
    const caption = document.getElementById('cutscene-caption');
    if (!caption) return null;
    els = {
        caption,
        speaker: document.getElementById('cutscene-speaker'),
        text: document.getElementById('cutscene-text'),
        choices: document.getElementById('cutscene-choices'),
        continueHint: document.getElementById('cutscene-continue-hint'),
    };
    return els;
}

export function isDialogueActive(state) {
    return !!state.dialogueActive;
}

export function showDialogue(state, lines, onComplete) {
    const e = getEls();
    if (!e || !lines || !lines.length) return;

    state.dialogueActive = true;
    state.cutsceneActive = true; // reuses the existing guard other systems (updateInteractPrompt) already check
    state._dialogueQueue = lines.slice();
    state._dialogueOnComplete = onComplete || null;

    // Dialogue needs a real mouse cursor for choice buttons, and reading
    // mid-mouselook is disorienting anyway — release pointer lock while
    // it's up, same reasoning as the pause menu's existing click-guard.
    if (document.pointerLockElement) document.exitPointerLock();

    e.caption.classList.add('visible');
    renderCurrentLine(state);
}

function renderCurrentLine(state) {
    const e = getEls();
    if (!e) return;
    const line = state._dialogueQueue[0];
    if (!line) { closeDialogue(state); return; }

    e.speaker.textContent = line.speaker ? line.speaker.toUpperCase() : '';
    e.speaker.style.display = line.speaker ? 'block' : 'none';
    e.text.textContent = line.text || '';

    e.choices.innerHTML = '';
    if (line.choices && line.choices.length) {
        e.continueHint.style.display = 'none';
        const ownerQueue = state._dialogueQueue; // captured so the click handler can tell whether onSelect started a *new* dialogue (showDialogue() again) vs. just continuing this one
        for (const choice of line.choices) {
            const btn = document.createElement('button');
            btn.className = 'cutscene-choice-btn';
            btn.type = 'button';
            btn.textContent = choice.label;
            btn.addEventListener('click', () => {
                ownerQueue.shift();
                if (choice.onSelect) choice.onSelect(state);
                if (state._dialogueQueue === ownerQueue) advanceDialogue(state);
            });
            e.choices.appendChild(btn);
        }
    } else {
        e.continueHint.style.display = 'block';
    }
}

// Called from main.js on the interact key's edge-trigger while dialogue
// is active, instead of the normal recruit-interaction path (see
// story.js's tryStoryInteract, which checks isDialogueActive() first).
export function advanceDialogue(state) {
    if (!state.dialogueActive) return;
    const e = getEls();
    if (!e) return;
    const current = state._dialogueQueue[0];
    if (current && current.choices && current.choices.length) return; // choices are click-only, E does nothing until one's picked
    state._dialogueQueue.shift();
    if (state._dialogueQueue.length) {
        renderCurrentLine(state);
    } else {
        closeDialogue(state);
    }
}

function closeDialogue(state) {
    const e = getEls();
    if (e) e.caption.classList.remove('visible');
    state.dialogueActive = false;
    state.cutsceneActive = false;
    const onComplete = state._dialogueOnComplete;
    state._dialogueQueue = null;
    state._dialogueOnComplete = null;
    if (onComplete) onComplete(state);
}
