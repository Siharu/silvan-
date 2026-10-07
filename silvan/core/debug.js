// Debug tools — only active with ?debug=1 in the URL (never reachable by
// normal players).
//   F3  overlay (fps, frame ms avg/p95, draw calls, triangles, geometries,
//       textures, position, slope, seed, quality, res scale)
//   F4  run the perf tour (fixed waypoints, logs + downloads JSON)
//   F5  toggle adaptive resolution
//   1-9 teleport to POI N      T  +3h time      R  cycle rain 0/.5/1
//   V   noclip free-cam (W/S move along view, Shift = fast)
import * as THREE from 'three';
import { state } from './state.js';
import { heightAt, slopeAt } from './heightmap.js';
import { POIS } from '../environment/pois.js';
import { WORLD_SEED } from './rng.js';
import { setAdaptiveRes, getResScale } from './render-quality.js';

export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

let overlay = null, overlayOn = false;
const FT = new Float32Array(240); let ftI = 0, ftN = 0;
let updTimer = 0;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export function debugFrame(deltaMs) {
    if (!DEBUG) return;
    FT[ftI] = deltaMs; ftI = (ftI + 1) % FT.length; ftN = Math.min(FT.length, ftN + 1);
    if (tour) tourFrame(deltaMs);
    updTimer += deltaMs;
    if (overlayOn && updTimer > 250) { updTimer = 0; overlay.textContent = statsText(); }
}

export function frameStats() {
    const a = Array.from(FT.slice(0, ftN)).sort((x, y) => x - y);
    if (!a.length) return { fps: 0, avg: 0, p95: 0, min: 0, max: 0 };
    const avg = a.reduce((s, v) => s + v, 0) / a.length;
    return { fps: 1000 / avg, avg, p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))], min: a[0], max: a[a.length - 1] };
}

function statsText() {
    const s = frameStats(), i = state.renderer.info, p = state.player.position;
    return [
        `fps ${s.fps.toFixed(0)}  avg ${s.avg.toFixed(1)}ms  p95 ${s.p95.toFixed(1)}ms`,
        `calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k  lines/pts ${i.render.points}`,
        `geoms ${i.memory.geometries}  tex ${i.memory.textures}  programs ${i.programs ? i.programs.length : '?'}`,
        `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  ground ${heightAt(p.x, p.z).toFixed(1)}  slope ${slopeAt(p.x, p.z).toFixed(0)}deg`,
        `seed ${WORLD_SEED}  tier ${state.qualityKey}  res x${getResScale().toFixed(2)}${state.adaptiveRes ? ' (adaptive)' : ''}`,
        `t ${(state.gameTime * 24).toFixed(1)}h  rain ${state.currentRainIntensity.toFixed(2)}${state.debugNoclip ? '  NOCLIP' : ''}${tour ? '  TOUR ' + tour.i + '/' + WAYPOINTS.length : ''}`,
    ].join('\n');
}

// ---- perf tour -----------------------------------------------------------
const WAYPOINTS = [
    { name: 'spawn noon',        x: 200,  z: 0,    yaw: 1.5, hour: 12, rain: 0 },
    { name: 'spawn dusk',        x: 200,  z: 0,    yaw: 1.5, hour: 18.5, rain: 0 },
    { name: 'lowland looking in', x: 170, z: 60,   yaw: 0.6, hour: 11, rain: 0 },
    { name: 'crater rim',        x: 0,    z: 45,   yaw: 3.14, hour: 14, rain: 0 },
    { name: 'radio tower',       poi: 'radio_tower', hour: 15, rain: 0 },
    { name: 'radio tower rain',  poi: 'radio_tower', hour: 15, rain: 1 },
    { name: 'warm paw night',    poi: 'warm_paw', hour: 23, rain: 0 },
    { name: 'ruined cabin shore', poi: 'ruined_cabin', hour: 9, rain: 0 },
    { name: 'howling maw',       poi: 'howling_maw', hour: 13, rain: 0 },
    { name: 'broken shell',      poi: 'broken_shell', hour: 8, rain: 0.5 },
    { name: 'greenite mouth',    poi: 'greenite_mouth', hour: 20, rain: 0 },
    { name: 'forest west',       x: -140, z: 40,   yaw: 2.0, hour: 12, rain: 0 },
];
let tour = null;

function startTour() {
    if (tour || !state.isPlaying) { console.warn('[tour] must be playing (pointer locked) to start'); return; }
    tour = { i: 0, t: 0, phase: 'settle', results: [], savedTime: state.gameTime, savedRain: state.currentRainIntensity, savedTarget: state.targetRainIntensity, savedPos: state.player.position.clone(), savedRot: state.player.rotation.clone() };
    state.debugTour = true; state.timeMultiplier = 0;
    gotoWaypoint(0);
}
function gotoWaypoint(i) {
    const w = WAYPOINTS[i]; tour.i = i; tour.t = 0; tour.phase = 'settle'; ftN = 0; ftI = 0;
    let x = w.x, z = w.z, yaw = w.yaw ?? 0;
    if (w.poi) { const p = POIS.find((q) => q.id === w.poi); x = p.x + 14; z = p.z + 14; yaw = Math.atan2(-(p.x - x), -(p.z - z)); }
    state.player.position.set(x, heightAt(x, z) + state.player.height, z);
    state.player.rotation.set(0, yaw, 0, 'YXZ'); state.camera.quaternion.setFromEuler(state.player.rotation);
    state.camera.position.copy(state.player.position);
    state.gameTime = w.hour / 24; state.currentRainIntensity = state.targetRainIntensity = w.rain;
    state.renderer.info.reset();
}
function tourFrame(dt) {
    tour.t += dt;
    if (tour.phase === 'settle' && tour.t > 2500) { tour.phase = 'measure'; tour.t = 0; ftN = 0; ftI = 0; return; }   // let shaders/chunks/streaming settle
    if (tour.phase === 'measure' && tour.t > 4000) {
        const s = frameStats(), i = state.renderer.info, w = WAYPOINTS[tour.i];
        tour.results.push({ waypoint: w.name, fps: +s.fps.toFixed(1), avgMs: +s.avg.toFixed(2), p95Ms: +s.p95.toFixed(2), maxMs: +s.max.toFixed(2),
            calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures });
        if (tour.i + 1 < WAYPOINTS.length) gotoWaypoint(tour.i + 1); else endTour();
    }
}
function endTour() {
    const out = { when: new Date().toISOString(), seed: WORLD_SEED, tier: state.qualityKey, pixelRatio: state.renderer.getPixelRatio(), viewport: [innerWidth, innerHeight], gpu: gpuName(), results: tour.results };
    console.table(tour.results); console.log('[tour] JSON:', JSON.stringify(out));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    a.download = `silvan-perf-${state.qualityKey}-${Date.now()}.json`; a.click();
    state.gameTime = tour.savedTime; state.currentRainIntensity = tour.savedRain; state.targetRainIntensity = tour.savedTarget; state.timeMultiplier = 1;
    state.player.position.copy(tour.savedPos); state.player.rotation.copy(tour.savedRot); state.camera.quaternion.setFromEuler(state.player.rotation);
    state.debugTour = false; tour = null;
}
function gpuName() {
    try { const gl = state.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; } catch { return 'unknown'; }
}

// ---- input ---------------------------------------------------------------
export function initDebug() {
    if (!DEBUG) return;
    overlay = document.createElement('pre');
    overlay.style.cssText = 'position:fixed;top:6px;left:6px;z-index:99999;margin:0;padding:6px 8px;background:rgba(0,0,0,.65);color:#9f9;font:11px/1.35 monospace;pointer-events:none;display:none;white-space:pre';
    document.body.appendChild(overlay);
    window.silvanDebug = { state, frameStats, startTour };
    console.info('[debug] ?debug=1 active: F3 overlay | F4 perf tour | F5 adaptive res | 1-9 POI | T time | R rain | V noclip');
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'F3') { e.preventDefault(); overlayOn = !overlayOn; overlay.style.display = overlayOn ? 'block' : 'none'; }
        else if (e.code === 'F4') { e.preventDefault(); startTour(); }
        else if (e.code === 'F5') { e.preventDefault(); setAdaptiveRes(!state.adaptiveRes); }
        if (!state.hasStarted || !state.isPlaying || tour) return;
        if (/^Digit[1-9]$/.test(e.code)) {
            const list = POIS; const p = list[parseInt(e.code.slice(5), 10) - 1]; if (!p) return;
            const x = p.x + 12, z = p.z + 12; state.player.position.set(x, heightAt(x, z) + state.player.height, z);
        }
        else if (e.code === 'KeyT') state.gameTime = (state.gameTime + 3 / 24) % 1;
        else if (e.code === 'KeyR') { const n = state.targetRainIntensity < 0.25 ? 0.5 : state.targetRainIntensity < 0.75 ? 1 : 0; state.targetRainIntensity = n; state.currentRainIntensity = n; }
        else if (e.code === 'KeyV') { state.debugNoclip = !state.debugNoclip; state.player.verticalVelocity = 0; }
    });
}
