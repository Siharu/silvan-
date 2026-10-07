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
    const found = state.discovered.size;
    const total = pois.length;
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
        for (const poi of pois) {
            const li = document.createElement('li');
            const seen = state.discovered.has(poi.id);
            li.textContent = seen ? poi.name : 'somewhere unexplored';
            if (seen) li.classList.add('joined');
            listEl.appendChild(li);
        }
    }
}
