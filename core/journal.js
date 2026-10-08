// Discovery journal: which places the player has examined. Persists in
// localStorage so found places survive a reload. Kept free of imports from
// environment/ (callers pass the POI list in) to avoid circular imports.
import { state } from './state.js';

const KEY = 'silvan-discovered';

function load() {
    try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); }
    catch (e) { return new Set(); }
}
function save() {
    try { localStorage.setItem(KEY, JSON.stringify([...state.discovered])); } catch (e) { /* private mode etc — progress just won't persist */ }
}

export function initJournal() {
    if (!state.discovered) state.discovered = load();
}

// Returns true only the first time a place is found.
export function markDiscovered(poi) {
    initJournal();
    if (state.discovered.has(poi.id)) return false;
    state.discovered.add(poi.id);
    save();
    return true;
}

// Story-beat variant of the same toast box — a single line ("You found a
// familiar cloth.") instead of the "X of Y places found" framing, for
// narrative props (environment/scene-shore.js) that aren't one of the 9
// real landmark POIs. Separate DOM element/timer so it can't collide with
// a landmark toast firing in the same stretch of gameplay.
let narrativeToastTimer = null;
export function showNarrativeToast(text) {
    const el = document.getElementById('narrative-toast');
    const textEl = document.getElementById('narrative-toast-text');
    if (!el || !textEl) return;
    textEl.textContent = text;
    el.classList.add('visible');
    clearTimeout(narrativeToastTimer);
    narrativeToastTimer = setTimeout(() => el.classList.remove('visible'), 4200);
}

let toastTimer = null;
export function showDiscoveryToast(poi, total) {
    const el = document.getElementById('discovery-toast');
    if (!el) return;
    document.getElementById('toast-name').textContent = poi.name;
    document.getElementById('toast-count').textContent = `${state.discovered.size} of ${total} found`;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 4200);
}

export function renderObjectives(pois) {
    initJournal();
    // Narrative props (environment/scene-shore.js's cloth/stick — flagged
    // `narrative: true` in pois.js) aren't landmarks; counting them here
    // would turn "9 of 9 places found" into a number that depends on
    // whether you've examined a stick, which isn't what that line means.
    const landmarks = pois.filter((p) => !p.narrative);
    const found = landmarks.filter((p) => state.discovered.has(p.id)).length;
    const total = landmarks.length;
    const textEl = document.getElementById('objective-current-text');
    const listEl = document.getElementById('objective-party-list');
    if (textEl) {
        textEl.textContent = found === 0
            ? 'Wake slowly. Walk the island and look closely at anything that glows, leans, or smokes.'
            : found < total
                ? `${found} of ${total} places found. Keep wandering; something is still out there.`
                : 'Every place on the island found. Find a fire and rest.';
    }
    if (listEl) {
        listEl.innerHTML = '';
        for (const poi of landmarks) {
            const li = document.createElement('li');
            const seen = state.discovered.has(poi.id);
            li.textContent = seen ? poi.name : 'somewhere unexplored';
            if (seen) li.classList.add('joined');
            listEl.appendChild(li);
        }
    }
}
