// Minimap system — two parts:
//
// 1. Small always-on corner icon: cheap flat 2D canvas circle + player
//    arrow, redrawn every frame from main.js's animate() loop. Unchanged
//    in spirit from the original version — running a full 3D scene at
//    96px, all the time, would cost real frame budget for a detail nobody
//    can see at that size.
//
// 2. Expanded panel (press M): a genuinely separate THREE.js scene, own
//    camera, own WebGLRenderer — but the terrain surface now samples the
//    SAME getElevation() heightfield the live world actually uses
//    (environment/terrain.js), at real WORLD_SIZE scale, with the real
//    state.terrainParams seed already sitting on this exact `state`
//    object. This replaced an earlier version that generated its own
//    disconnected fictional island — same visual techniques (vertex-color
//    depth tinting, instanced tree/rock scatter, animated ocean, drag/zoom
//    isometric camera, red tactical-ops HUD chrome softened with Silvan's
//    misty glow) but now shaped like the actual game world instead of a
//    stylized standalone piece.
//
// POIs are real-world landmarks now too — Hearth (world origin, matches
// the actual lake) and Radio Tower (120,-140, matches createRadioTower's
// real placement in main.js) are fixed; Southern Bluff/Willow pull their
// coordinates from state.story.bluffPos/willowPos, which
// core/landmarks.js computes dynamically against the real generated
// terrain once the story reaches that stage — before that, they're
// omitted from the map rather than shown at a made-up spot. The Ruined
// Cabin/Cave from the earlier version are cut entirely: neither exists
// anywhere in the real live world yet (no built geometry, no real
// coordinate), so pinning them here would show a landmark you can never
// actually walk up to. They come back once whatever they build in the
// cave-entrance session gets a real coordinate in the live world.
//
// Names/descriptions are GATED behind discovery — see
// state.discoveredPois and updatePoiDiscovery() near the bottom of this
// file, called every frame from main.js's main loop (not just while the
// map is open) so exploring the real world is what unlocks a pin's name,
// not clicking around the map itself. An undiscovered POI still shows its
// pin (so there's something to be curious about) but the card reads
// "???" until the player has actually been near that real location.
//
// The panel's THREE engine is built lazily on first expand, not at
// createMinimap() time — no reason to pay for a second WebGLRenderer,
// second scene graph, terrain mesh, or instanced scatter for a player who
// never opens the map.

import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL } from './world-state.js';
import { getElevation } from '../environment/terrain.js';

const ICON_SIZE = 96; // small corner icon, px
const DISCOVERY_RADIUS = 28; // real world units — how close the player has to actually get to a POI's real coordinate before its name unlocks

// ---------------------------------------------------------------------
// Fixed real-world POIs. Bluff/Willow are added dynamically in
// getPoiData() below once their real coordinates exist.
const FIXED_POI_DATA = [
    {
        id: 'hearth', name: 'The Hearth', x: 0, z: 0, // real world origin — matches the actual lake's position (see the earlier chat: the lake sits untethered at (0,0), which is also where Kat wakes up)
        desc: "Where Kat first opened its eyes. The warmth here never fully fades, and none of the pets know why.",
        feeling: 'WARM', whisper: 'A low hum, always present, never louder.',
        glowColor: 0xf2843a,
    },
    {
        id: 'radio_tower', name: 'The Radio Tower', x: 120, z: -140, // matches createRadioTower(state, new THREE.Vector3(120, 0, -140)) in main.js — the real placement, not a guess
        desc: "A rusted transmission spire on the eastern ridge. It listens for something that hasn't spoken yet.",
        feeling: 'UNEASY', whisper: 'Static, then silence, then static again.',
        glowColor: 0xef4444,
    },
];

// Builds the live POI list each time it's needed (engine build, and
// discovery checks every frame) rather than a static array, since
// Bluff/Willow's real coordinates don't exist until core/story.js has
// actually computed them against this session's generated terrain.
function getPoiData(state) {
    const list = [...FIXED_POI_DATA];
    if (state.story && state.story.bluffPos) {
        list.push({
            id: 'bluff', name: 'The Southern Bluff', x: state.story.bluffPos.x, z: state.story.bluffPos.z,
            desc: 'Where the island ends and the ocean begins. Some nights you can see the horizon glow from here.',
            feeling: 'CALM', whisper: 'Wind off the water, and nothing else.',
            glowColor: 0x60a5fa,
        });
    }
    if (state.story && state.story.willowPos) {
        list.push({
            id: 'willow', name: 'The Willow', x: state.story.willowPos.x, z: state.story.willowPos.z,
            desc: 'A lone willow leaning over dark water. Something is buried beneath its roots, and it has never been dug up.',
            feeling: 'COLD', whisper: 'A creak with no wind to explain it.',
            glowColor: 0x4ade80,
        });
    }
    return list;
}

// ===========================================================================
// SMALL CORNER ICON — cheap flat 2D canvas, unchanged approach from before
// ===========================================================================

// One-time real-coastline bake for the small icon — cheap (64x64 grid,
// baked once ever, not per-frame) now that we have real getElevation()
// sampling in this file anyway for the expanded panel. Replaces the old
// fake circle, which is what was making the icon "useless" — it bore no
// actual relationship to the island's real shape or the player's real
// position on it, just an approximate blob.
const ICON_BAKE_RES = 64;
function bakeIconCoastline(state) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_BAKE_RES; canvas.height = ICON_BAKE_RES;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(ICON_BAKE_RES, ICON_BAKE_RES);
    const scale = (ICON_BAKE_RES * 0.42) / (WORLD_SIZE / 2);
    for (let py = 0; py < ICON_BAKE_RES; py++) {
        for (let px = 0; px < ICON_BAKE_RES; px++) {
            const wx = (px - ICON_BAKE_RES / 2) / scale;
            const wz = (py - ICON_BAKE_RES / 2) / scale;
            const h = getElevation(wx, wz, state);
            const i = (py * ICON_BAKE_RES + px) * 4;
            if (h <= WATER_LEVEL) { img.data[i] = 0x0a; img.data[i + 1] = 0x16; img.data[i + 2] = 0x22; }
            else { img.data[i] = 0x2a; img.data[i + 1] = 0x38; img.data[i + 2] = 0x22; }
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    state.minimap.iconCoastline = canvas;
}

function drawIcon(ctx, state) {
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    const cx = ICON_SIZE / 2, cy = ICON_SIZE / 2;
    const scale = (ICON_SIZE * 0.42) / (WORLD_SIZE / 2);

    if (state.minimap.iconCoastline) {
        ctx.drawImage(state.minimap.iconCoastline, 0, 0, ICON_SIZE, ICON_SIZE);
        ctx.beginPath();
        ctx.arc(cx, cy, ICON_SIZE * 0.42, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(224, 90, 58, 0.35)'; // matches the panel's --mm-red
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    const pulse = 0.75 + Math.sin(performance.now() * 0.004) * 0.25;

    if (state.demoAnimals) {
        for (const rig of state.demoAnimals) {
            if (!rig.root || !rig.following) continue;
            const x = cx + rig.root.position.x * scale;
            const y = cy + rig.root.position.z * scale;
            drawGlowDot(ctx, x, y, 2.2 * pulse, '#8fd18f');
        }
    }

    if (state.player) {
        const x = cx + state.player.position.x * scale;
        const y = cy + state.player.position.z * scale;
        const yaw = state.playerYaw || 0;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // matches main.js's own forward-vector convention
        const size = 7 * (0.9 + pulse * 0.15);
        const tipX = x + fx * size, tipY = y + fz * size;
        const backX = x - fx * size * 0.6, backY = y - fz * size * 0.6;
        const leftX = backX + fz * size * 0.55, leftY = backY - fx * size * 0.55;
        const rightX = backX - fz * size * 0.55, rightY = backY + fx * size * 0.55;
        ctx.save();
        ctx.shadowColor = 'rgba(255, 233, 179, 0.85)';
        ctx.shadowBlur = 5;
        ctx.fillStyle = '#ffe9b3';
        ctx.beginPath();
        ctx.moveTo(tipX, tipY); ctx.lineTo(leftX, leftY); ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

// Small glow-halo dot — same trick the expanded map's POI pins use,
// scaled down for the tiny icon.
function drawGlowDot(ctx, x, y, r, color) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
    grad.addColorStop(0, color + 'aa');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r * 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

// ===========================================================================
// DOM + CSS
// ===========================================================================

function buildDOM() {
    const wrap = document.createElement('div');
    wrap.id = 'minimap-wrap';
    wrap.innerHTML = `
        <div id="minimap-icon" class="minimap-icon" title="Press M to open the map">
            <canvas id="minimap-icon-canvas" width="${ICON_SIZE}" height="${ICON_SIZE}"></canvas>
        </div>
        <div id="minimap-panel-layer" class="minimap-panel-layer">
            <div class="mm-scanlines"></div>
            <div class="mm-vignette"></div>
            <div id="minimap-canvas-container" class="mm-canvas-container"></div>
            <div id="minimap-poi-layer" class="mm-poi-layer"></div>

            <div class="mm-ui-layer">
                <div class="mm-top-row">
                    <div class="mm-panel mm-title-panel">
                        <div class="mm-title-row">
                            <span class="mm-live-dot"></span>
                            <h1>The Hearth</h1>
                        </div>
                        <p class="mm-subtitle">ISOMETRIC SURVEY — <span id="mm-coord">X:00 Y:00</span></p>
                    </div>
                    <div class="mm-panel mm-cam-panel">
                        <button class="mm-btn mm-btn-active" data-cam="iso">ISO</button>
                        <button class="mm-btn" data-cam="hearth">HEARTH</button>
                        <button class="mm-btn" data-cam="top">OVERHEAD</button>
                    </div>
                </div>

                <div id="mm-poi-card" class="mm-panel mm-poi-card hidden">
                    <div class="mm-card-head">
                        <div>
                            <span id="mm-card-tag" class="mm-card-tag">LANDMARK</span>
                            <h2 id="mm-card-title">Point of Interest</h2>
                        </div>
                        <button id="mm-card-close" class="mm-card-close">&times;</button>
                    </div>
                    <p id="mm-card-desc" class="mm-card-desc">—</p>
                    <div class="mm-card-stats">
                        <div><span>FEELING</span><strong id="mm-card-feeling">—</strong></div>
                        <div class="mm-card-whisper"><span>WHISPER</span><em id="mm-card-whisper">—</em></div>
                    </div>
                </div>

                <div class="mm-bottom-row">
                    <div class="mm-panel mm-info-panel">
                        <div class="mm-info-line"><span>CLOCK</span><strong id="mm-clock">—</strong></div>
                        <div class="mm-info-line"><span>WEATHER</span><strong id="mm-weather">—</strong></div>
                        <div class="mm-info-line"><span>PARTY</span><strong id="mm-party">—</strong></div>
                    </div>
                </div>
                <div class="mm-hint">PRESS M TO CLOSE</div>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);
    return wrap;
}

function injectStyles() {
    if (document.getElementById('minimap-styles')) return;
    const style = document.createElement('style');
    style.id = 'minimap-styles';
    style.textContent = `
        .minimap-icon {
            position: fixed;
            top: 1.6rem;
            /* Top-right HUD row (index.html): touch-pause-btn at right:1.6rem,
               time-ff-btn at right:4.6rem, fullscreen-btn at right:7.6rem —
               each 2.6rem wide, 3rem apart. The minimap icon was ALSO at
               right:7.6rem, landing directly on top of fullscreen-btn
               (real, confirmed overlap, not just a close call). Moved one
               more slot left, clear of that whole row's actual span
               (7.6rem to 10.2rem). */
            right: 11rem;
            width: ${ICON_SIZE}px;
            height: ${ICON_SIZE}px;
            border-radius: 50%;
            z-index: 15;
            background: radial-gradient(ellipse at 30% 20%, rgba(200, 220, 255, 0.10) 0%, transparent 60%), rgba(16, 20, 28, 0.55);
            border: 1px solid rgba(224, 90, 58, 0.3);
            box-shadow: 0 0 20px rgba(140, 180, 255, 0.08), 0 0 16px rgba(224, 90, 58, 0.12), inset 0 0 20px rgba(180, 200, 255, 0.05);
            overflow: hidden;
            animation: minimap-float 7s ease-in-out infinite, minimap-icon-glow 4s ease-in-out infinite;
            pointer-events: none;
        }
        .minimap-icon canvas { width: 100%; height: 100%; display: block; }
        @keyframes minimap-float {
            0%, 100% { transform: translateY(0) rotate(-0.2deg); }
            50% { transform: translateY(-4px) rotate(0.2deg); }
        }
        @keyframes minimap-icon-glow {
            0%, 100% { box-shadow: 0 0 20px rgba(140, 180, 255, 0.08), 0 0 14px rgba(224, 90, 58, 0.10), inset 0 0 20px rgba(180, 200, 255, 0.05); }
            50% { box-shadow: 0 0 20px rgba(140, 180, 255, 0.08), 0 0 22px rgba(224, 90, 58, 0.22), inset 0 0 20px rgba(180, 200, 255, 0.05); }
        }

        /* ---- Expanded panel: red tactical-ops chrome, softened with
           Silvan's misty floaty language rather than left as a raw swap. ---- */
        .minimap-panel-layer {
            --mm-red: #e05a3a;      /* warmed from the reference's pure #ef4444 toward an ember tone, thematically "Hearth fire" rather than "danger klaxon" */
            --mm-red-glow: rgba(224, 90, 58, 0.4);
            position: fixed;
            inset: 0;
            z-index: 21;
            display: none;
            background: radial-gradient(ellipse at center, rgba(10, 14, 20, 0.55) 0%, rgba(4, 6, 10, 0.85) 100%);
            font-family: 'JetBrains Mono', 'Cinzel', monospace;
            color: #d1d5db;
            overflow: hidden;
            animation: minimap-float 9s ease-in-out infinite;
        }
        .minimap-panel-layer.visible { display: block; }
        .mm-canvas-container { position: absolute; inset: 0; z-index: 1; cursor: grab; }
        .mm-canvas-container:active { cursor: grabbing; }
        .mm-canvas-container canvas { display: block; }

        .mm-scanlines {
            position: absolute; inset: 0; z-index: 5; pointer-events: none; opacity: 0.5;
            background: linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,0.3) 50%), linear-gradient(90deg, rgba(255,0,0,0.02), rgba(0,255,0,0.008), rgba(0,0,255,0.02));
            background-size: 100% 3px, 6px 100%;
        }
        .mm-vignette {
            position: absolute; inset: 0; z-index: 6; pointer-events: none;
            box-shadow: inset 0 0 160px rgba(0,0,0,0.85), inset 0 0 60px rgba(140,190,255,0.05); /* the added faint blue inner glow is the Silvan-misty blend on top of the reference's pure-black vignette */
        }

        .mm-poi-layer { position: absolute; inset: 0; z-index: 10; pointer-events: none; overflow: hidden; }
        .mm-poi-marker {
            position: absolute; transform: translate(-50%, -100%); cursor: pointer; pointer-events: auto;
            transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .mm-poi-marker:hover { transform: translate(-50%, -112%) scale(1.15); }
        .mm-poi-pin {
            width: 26px; height: 26px; border-radius: 50%;
            background: rgba(10,10,12,0.85);
            border: 2px solid var(--mm-red);
            box-shadow: 0 0 14px var(--mm-red-glow);
        }
        /* Undiscovered — still visible (so there's something to be
           curious about), just dimmed and colorless compared to a
           discovered pin, and no pulse ring (that's reserved for "you
           know what this is"). */
        .mm-poi-marker-undiscovered .mm-poi-pin {
            border-color: rgba(180, 180, 190, 0.35);
            box-shadow: none;
            background: rgba(10,10,12,0.6);
        }
        .mm-poi-marker-undiscovered .mm-poi-pulse { display: none; }
        .mm-poi-pulse {
            position: absolute; inset: 0; border-radius: 50%; border: 1px solid var(--mm-red);
            animation: mm-pulse-ring 2s infinite ease-out;
        }
        @keyframes mm-pulse-ring { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2.2); opacity: 0; } }

        .mm-ui-layer { position: absolute; inset: 0; z-index: 30; pointer-events: none; padding: 1.4rem; display: flex; flex-direction: column; justify-content: space-between; }
        .mm-panel {
            background:
                radial-gradient(ellipse at 30% 20%, rgba(200, 220, 255, 0.07) 0%, transparent 55%),
                rgba(12, 16, 24, 0.82);
            border: 1px solid rgba(224, 90, 58, 0.25);
            box-shadow: 0 10px 30px rgba(0,0,0,0.6), 0 0 24px rgba(140, 190, 255, 0.05);
            border-radius: 3px;
            pointer-events: auto;
        }
        .mm-top-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.8rem; flex-wrap: wrap; }
        .mm-title-panel { padding: 0.9rem 1.2rem; max-width: 300px; }
        .mm-title-row { display: flex; align-items: center; gap: 0.6rem; }
        .mm-live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mm-red); box-shadow: 0 0 8px var(--mm-red); animation: mm-blink 1.4s infinite; }
        @keyframes mm-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .mm-title-panel h1 { margin: 0; font-family: 'Cinzel', serif; font-size: 1.2rem; letter-spacing: 0.15em; color: var(--mm-red); text-transform: uppercase; text-shadow: 0 0 14px var(--mm-red-glow); }
        .mm-subtitle { margin: 0.3rem 0 0; font-size: 0.65rem; letter-spacing: 0.08em; color: #9ca3af; }

        .mm-cam-panel { padding: 0.5rem; display: flex; gap: 0.4rem; }
        .mm-btn {
            background: rgba(20,25,35,0.8); border: 1px solid rgba(255,255,255,0.15); color: #9ca3af;
            font-family: inherit; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.05em;
            padding: 0.5rem 0.7rem; border-radius: 2px; cursor: pointer; transition: all 0.15s ease;
        }
        .mm-btn:hover, .mm-btn-active { background: rgba(224,90,58,0.22); border-color: var(--mm-red); color: #fff; box-shadow: 0 0 10px var(--mm-red-glow); }

        .mm-poi-card { position: absolute; top: 6.5rem; right: 1.4rem; width: min(320px, 86vw); padding: 1.1rem; transition: all 0.25s ease; }
        .mm-poi-card.hidden { opacity: 0; transform: translateX(12px); pointer-events: none; }
        .mm-card-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.6rem; margin-bottom: 0.6rem; }
        .mm-card-tag { display: block; font-size: 0.6rem; letter-spacing: 0.15em; color: var(--mm-red); font-weight: 700; }
        .mm-card-head h2 { margin: 0.15rem 0 0; font-family: 'Cinzel', serif; font-size: 1rem; color: #f3f4f6; }
        .mm-card-close { background: none; border: none; color: #6b7280; font-size: 1.2rem; cursor: pointer; line-height: 1; }
        .mm-card-close:hover { color: var(--mm-red); }
        .mm-card-desc { font-size: 0.72rem; line-height: 1.5; color: #9ca3af; margin: 0 0 0.7rem; }
        .mm-card-stats { display: grid; gap: 0.5rem; font-size: 0.65rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.06); border-radius: 2px; padding: 0.6rem; }
        .mm-card-stats span { display: block; color: #6b7280; letter-spacing: 0.08em; font-size: 0.58rem; }
        .mm-card-stats strong { color: var(--mm-red); }
        .mm-card-stats em { color: #d1d5db; font-style: normal; }

        .mm-bottom-row { display: flex; justify-content: flex-end; align-items: flex-end; gap: 0.8rem; flex-wrap: wrap; }
        .mm-info-panel { padding: 0.7rem 1rem; min-width: 180px; }
        .mm-info-line { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.62rem; padding: 0.15rem 0; }
        .mm-info-line span { color: #6b7280; letter-spacing: 0.08em; }
        .mm-info-line strong { color: #e5e7eb; font-weight: 600; }

        .mm-hint { text-align: center; margin-top: 0.6rem; font-size: 0.6rem; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7280; }
    `;
    document.head.appendChild(style);
}

// ===========================================================================
// PANEL 3D ENGINE — built lazily on first expand
// ===========================================================================

function buildEngine(state) {
    const container = document.getElementById('minimap-canvas-container');
    // Real world scale now (was a separate fictional MAP_SIZE=240) — this
    // terrain IS the live world's actual shape, so it uses the live
    // world's actual scale. MAP_SEGMENTS trimmed from the earlier
    // fictional version's 128 since 800 units is a lot more ground to
    // cover at the same vertex budget; still plenty for a HUD-scale map.
    const MAP_SIZE = WORLD_SIZE, MAP_SEGMENTS = 110;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090e);
    scene.fog = new THREE.FogExp2(0x07090e, 0.0035);

    const rect = container.getBoundingClientRect();
    const aspect = rect.width / rect.height || 1;
    const d = 433; // was 130 for the old 240-unit fictional map — scaled proportionally for the real 800-unit world (130 * 800/240)
    const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 4000);
    camera.position.set(600, 600, 600);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(rect.width, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // --- Lighting — colors/intensity driven every frame from the REAL
    // game's state.gameTime/state.currentRainIntensity (see
    // updateLightingFromRealState below) rather than the reference
    // file's own separate day/night toggle, so this map's mood tracks
    // whatever's actually happening in Silvan right now.
    const ambientLight = new THREE.AmbientLight(0x2a3245, 0.7);
    scene.add(ambientLight);
    const hemisphereLight = new THREE.HemisphereLight(0x4b5563, 0x0f172a, 0.5);
    scene.add(hemisphereLight);
    const directionalLight = new THREE.DirectionalLight(0xfff5ea, 1.4);
    directionalLight.position.set(120, 200, 100);
    scene.add(directionalLight);

    // Real heightfield — same getElevation() the live world's own terrain
    // mesh samples (environment/terrain.js), against this exact session's
    // state.terrainParams (seed/scale/octaves), so this genuinely is the
    // actual island shape, not an approximation of it.
    function sampleElevation(x, z) {
        return getElevation(x, z, state);
    }

    // --- Terrain: real heightfield, vertex-colored by real elevation
    // bands (same land/water-threshold technique as the earlier real
    // top-down-snapshot attempt from a previous session, just via direct
    // numeric sampling instead of rendering-and-reading-back-pixels).
    // The Hearth still gets a warm ember tint layered on top near its
    // real position (world origin) — that's a pure lighting/color accent
    // now (see emberLight below), not a fake pit carved into the mesh;
    // the real lake is what's actually there.
    const terrainGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, MAP_SEGMENTS, MAP_SEGMENTS);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position;
    const colors = [];
    const oceanBedColor = new THREE.Color(0x0c131d);
    const wetSandColor = new THREE.Color(0x2d2b27);
    const darkLowlandColor = new THREE.Color(0x1a241e);
    const slateHighlandColor = new THREE.Color(0x2f353d);
    const mountainPeakColor = new THREE.Color(0x111317);
    const emberColor = new THREE.Color(0xdc5a26); // the Hearth's warm accent tint, applied near world origin only — see comment above
    for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i), vz = posAttr.getZ(i);
        const vy = sampleElevation(vx, vz);
        posAttr.setY(i, vy);
        const distFromOrigin = Math.sqrt(vx * vx + vz * vz);
        let c = new THREE.Color();
        if (vy <= WATER_LEVEL) c.copy(oceanBedColor);
        else if (vy < WATER_LEVEL + 3.5) c.copy(wetSandColor);
        else if (vy < 18.0) c.copy(darkLowlandColor);
        else if (vy < 40.0) c.copy(slateHighlandColor);
        else c.copy(mountainPeakColor);
        if (distFromOrigin < 40 && vy > WATER_LEVEL) c.lerp(emberColor, Math.min(1.0, (40 - distFromOrigin) / 30) * 0.35);
        const grain = (Math.random() - 0.5) * 0.04;
        c.r = THREE.MathUtils.clamp(c.r + grain, 0, 1);
        c.g = THREE.MathUtils.clamp(c.g + grain, 0, 1);
        c.b = THREE.MathUtils.clamp(c.b + grain, 0, 1);
        colors.push(c.r, c.g, c.b);
    }
    terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();
    const terrainMesh = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1, flatShading: true }));
    scene.add(terrainMesh);
    const emberLight = new THREE.PointLight(0xe0703a, 4, 90);
    emberLight.position.set(0, 15, 0); // the Hearth's real position — world origin
    scene.add(emberLight);

    // --- Instanced trees/dead-trees/rocks scatter. Count bumped from the
    // old fictional version's 4000 (over a 240-unit map) to 9000, since
    // this now covers the real 800-unit world — proportionally similar
    // density, not exhaustive coverage (this is a stylized decorative
    // scatter for the map view, not meant to match forest.js's actual
    // live tree count/positions 1:1).
    const treeGeo = new THREE.ConeGeometry(0.7, 3.5, 5); treeGeo.translate(0, 1.75, 0);
    const deadTreeGeo = new THREE.CylinderGeometry(0.15, 0.4, 2.8, 5); deadTreeGeo.translate(0, 1.4, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1.0, 0); rockGeo.translate(0, 0.5, 0);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x16261c, roughness: 0.9, flatShading: true }); // warmed slightly greener than the reference's near-black 0x111c15 so it doesn't read as scorched
    const deadTreeMat = new THREE.MeshStandardMaterial({ color: 0x3d3935, roughness: 1.0, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.8, flatShading: true });
    const treeM = [], deadTreeM = [], rockM = [];
    const dummy = new THREE.Object3D();
    const LAKE_CLEARANCE = 85; // real lake plane is 160x160 (see environment/water.js), centered at origin, and isn't tied to terrain elevation — so getElevation() near origin can return land-height even where the actual lake mesh sits. Keep trees clear of it manually.
    for (let i = 0; i < 9000; i++) {
        const x = (Math.random() - 0.5) * MAP_SIZE * 0.95;
        const z = (Math.random() - 0.5) * MAP_SIZE * 0.95;
        const y = sampleElevation(x, z);
        const distFromOrigin = Math.sqrt(x * x + z * z);
        if (y > WATER_LEVEL + 1.2 && y < 45 && distFromOrigin > LAKE_CLEARANCE) {
            dummy.position.set(x, y, z);
            dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
            if (y < 16 && Math.random() > 0.35) {
                const scale = 0.6 + Math.random() * 0.9;
                dummy.scale.set(scale, scale * (0.8 + Math.random() * 0.5), scale);
                dummy.rotation.x = (Math.random() - 0.5) * 0.15;
                dummy.rotation.z = (Math.random() - 0.5) * 0.15;
                dummy.updateMatrix(); treeM.push(dummy.matrix.clone());
            } else if (y >= 16 && y < 28 && Math.random() > 0.65) {
                const scale = 0.5 + Math.random() * 1.2;
                dummy.scale.set(scale, scale, scale);
                dummy.rotation.x = (Math.random() - 0.5) * 0.6;
                dummy.rotation.z = (Math.random() - 0.5) * 0.6;
                dummy.updateMatrix(); deadTreeM.push(dummy.matrix.clone());
            } else if (y > 2.5 && Math.random() > 0.5) {
                const scale = 0.4 + Math.random() * 2.2;
                dummy.scale.set(scale, scale * (0.5 + Math.random() * 0.6), scale);
                dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
                dummy.updateMatrix(); rockM.push(dummy.matrix.clone());
            }
        }
    }
    if (treeM.length) { const m = new THREE.InstancedMesh(treeGeo, treeMat, treeM.length); treeM.forEach((mat, i) => m.setMatrixAt(i, mat)); scene.add(m); }
    if (deadTreeM.length) { const m = new THREE.InstancedMesh(deadTreeGeo, deadTreeMat, deadTreeM.length); deadTreeM.forEach((mat, i) => m.setMatrixAt(i, mat)); scene.add(m); }
    if (rockM.length) { const m = new THREE.InstancedMesh(rockGeo, rockMat, rockM.length); rockM.forEach((mat, i) => m.setMatrixAt(i, mat)); scene.add(m); }

    // --- Mountain fog ring around the Hearth's real high ground (real
    // terrain's peak height is much more modest than the old fictional
    // version's invented 55-unit boost — scaled down to match, and
    // recentered on the real origin instead of the old fictional (0,-5)
    // pit offset).
    const fogCanvas = document.createElement('canvas'); fogCanvas.width = fogCanvas.height = 128;
    const fctx = fogCanvas.getContext('2d');
    const fgrad = fctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    fgrad.addColorStop(0, 'rgba(215,225,235,0.55)'); fgrad.addColorStop(0.4, 'rgba(170,185,200,0.25)');
    fgrad.addColorStop(0.8, 'rgba(100,115,130,0.08)'); fgrad.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = fgrad; fctx.fillRect(0, 0, 128, 128);
    const cloudTexture = new THREE.CanvasTexture(fogCanvas);
    const mountainFogGroup = new THREE.Group();
    for (let i = 0; i < 48; i++) {
        const mat = new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, opacity: 0.45, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        const angle = (i / 48) * Math.PI * 2 + Math.random() * 0.5;
        const radius = 90 + Math.random() * 60, height = 20 + Math.random() * 14;
        sprite.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
        const scale = 22 + Math.random() * 28;
        sprite.scale.set(scale, scale * (0.6 + Math.random() * 0.4), 1);
        sprite.userData = { angle, radius, speed: 0.025 + Math.random() * 0.035, baseY: height, bobSpeed: 0.4 + Math.random() * 0.6, phase: Math.random() * Math.PI * 2 };
        mountainFogGroup.add(sprite);
    }
    scene.add(mountainFogGroup);

    // --- Ocean
    const oceanGeo = new THREE.PlaneGeometry(MAP_SIZE * 2.5, MAP_SIZE * 2.5, 64, 64);
    oceanGeo.rotateX(-Math.PI / 2);
    const oceanMesh = new THREE.Mesh(oceanGeo, new THREE.MeshStandardMaterial({ color: 0x09101a, roughness: 0.2, metalness: 0.9, transparent: true, opacity: 0.85, flatShading: true }));
    oceanMesh.position.y = 0.2;
    scene.add(oceanMesh);
            brick.position.set((Math.random() - 0.5) * 0.15, ccy * 0.4 + 0.2, (Math.random() - 0.5) * 0.15);
            chimney.add(brick);
    // --- Ember particles — rising motes near the Hearth's real position
    // (world origin), not spread across the whole map anymore (the old
    // fictional version scattered them over the full MAP_SIZE since the
    // fictional pit WAS the map's center; the real Hearth is one specific
    // real location now, so this is a localized accent around it, same
    // spirit as the real emberLight above).
    const emberCount = 350;
    const emberGeo = new THREE.BufferGeometry();
    const emberPos = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount * 3; i += 3) {
        emberPos[i] = (Math.random() - 0.5) * 90;
        emberPos[i + 1] = Math.random() * 40 + 2;
        emberPos[i + 2] = (Math.random() - 0.5) * 90;
    }
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
    const emberParticles = new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xe0703a, size: 1.2, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
    scene.add(emberParticles);

    // --- POI markers — built from getPoiData(state) (real coordinates,
    // Bluff/Willow only included once core/story.js has actually computed
    // them) rather than a static list.
    const poisGroup = new THREE.Group();
    getPoiData(state).forEach((poi) => {
        const surfaceY = sampleElevation(poi.x, poi.z);
        const group = new THREE.Group();
        group.position.set(poi.x, surfaceY, poi.z);
        // Sizes scaled 3x from the old fictional version, same reasoning
        // as the player marker above — matches the wider real-world camera framing.
        const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 5.4, 6, 6), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 }));
        baseMesh.position.y = 3;
        group.add(baseMesh);
        const orbMesh = new THREE.Mesh(new THREE.OctahedronGeometry(4.5, 0), new THREE.MeshBasicMaterial({ color: poi.glowColor, wireframe: true }));
        orbMesh.position.y = 12; orbMesh.name = 'beaconOrb';
        group.add(orbMesh);
        const pLight = new THREE.PointLight(poi.glowColor, 2, 75);
        pLight.position.y = 12;
        group.add(pLight);
        group.userData = poi;
        poisGroup.add(group);
    });
    scene.add(poisGroup);

    // --- Player marker — now at the REAL world position 1:1, no mapping
    // needed (the old fictional version proportionally mapped
    // realX/WORLD_SIZE*MAP_SIZE onto its own disconnected space; now
    // MAP_SIZE just IS WORLD_SIZE). Scaled up 3x from the old fictional
    // version's marker size since the camera's view volume (d=433 vs the
    // old d=130) is proportionally wider — same screen-relative size as
    // before, just correct at the new real-world scale.
    const playerMarker = new THREE.Group();
    const playerCone = new THREE.Mesh(new THREE.ConeGeometry(5, 12, 4), new THREE.MeshBasicMaterial({ color: 0xffe9b3 }));
    playerCone.rotation.x = Math.PI; // point tip toward facing direction, base up
    playerMarker.add(playerCone);
    const playerLight = new THREE.PointLight(0xffe9b3, 2, 60);
    playerMarker.add(playerLight);
    scene.add(playerMarker);

    return {
        scene, camera, renderer, container,
        sampleElevation, mountainFogGroup, oceanMesh, emberParticles, poisGroup, playerMarker,
        ambientLight, hemisphereLight, directionalLight,
        targetCameraPos: new THREE.Vector3(600, 600, 600),
        targetLookAt: new THREE.Vector3(0, 0, 0),
        currentLookAt: new THREE.Vector3(0, 0, 0),
        clock: new THREE.Clock(),
        running: false,
        activePoi: null,
        MAP_SIZE,
    };
}

function wireInteraction(state, eng) {
    const container = eng.container;
    let isDragging = false, prevPos = { x: 0, y: 0 };
    const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();

    container.addEventListener('mousedown', (e) => { if (e.button === 0) { isDragging = true; prevPos = { x: e.clientX, y: e.clientY }; } });
    window.addEventListener('mouseup', () => { isDragging = false; });
    container.addEventListener('mousemove', (e) => {
        const rect = eng.renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, eng.camera);
        document.getElementById('mm-coord').textContent = `X:00 Y:00`;
        if (isDragging) {
            const dx = e.clientX - prevPos.x, dy = e.clientY - prevPos.y;
            const panSpeed = 0.45;
            eng.targetLookAt.x -= (dx - dy) * panSpeed * 0.5;
            eng.targetLookAt.z -= (-dx - dy) * panSpeed * 0.5;
            eng.targetCameraPos.x -= (dx - dy) * panSpeed * 0.5;
            eng.targetCameraPos.z -= (-dx - dy) * panSpeed * 0.5;
            prevPos = { x: e.clientX, y: e.clientY };
        }
    });
    container.addEventListener('wheel', (e) => {
        const factor = e.deltaY > 0 ? 1.08 : 0.92;
        eng.camera.zoom = THREE.MathUtils.clamp(eng.camera.zoom / factor, 0.5, 3.5);
        eng.camera.updateProjectionMatrix();
    }, { passive: true });

    document.querySelectorAll('#minimap-panel-layer [data-cam]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#minimap-panel-layer [data-cam]').forEach(b => b.classList.remove('mm-btn-active'));
            btn.classList.add('mm-btn-active');
            const type = btn.dataset.cam;
            if (type === 'iso') { eng.targetLookAt.set(0, 0, 0); eng.targetCameraPos.set(600, 600, 600); }
            else if (type === 'hearth') { eng.targetLookAt.set(0, 15, 0); eng.targetCameraPos.set(300, 260, 300); }
            else if (type === 'top') { eng.targetLookAt.set(0, 0, 0); eng.targetCameraPos.set(0, 800, 0.1); }
        });
    });

    document.getElementById('mm-card-close').addEventListener('click', () => closePOICard());

    // No quick-select button list — per your call, POI names shouldn't be
    // browsable from a list at all (defeats the point of gating them
    // behind discovery). The only way to open a POI's card is clicking
    // its pin directly, and undiscovered ones show "???" there instead of
    // the real name — see selectPOI below.
    function selectPOI(st, poi) {
        const eng2 = st.minimap.engine;
        eng2.activePoi = poi;
        const discovered = st.discoveredPois && st.discoveredPois.has(poi.id);
        document.getElementById('mm-card-tag').textContent = discovered ? `LANDMARK // ${poi.id.toUpperCase()}` : 'UNDISCOVERED';
        document.getElementById('mm-card-title').textContent = discovered ? poi.name : '???';
        document.getElementById('mm-card-desc').textContent = discovered ? poi.desc : "Kat hasn't been here yet.";
        document.getElementById('mm-card-feeling').textContent = discovered ? poi.feeling : '—';
        document.getElementById('mm-card-whisper').textContent = discovered ? poi.whisper : '—';
        document.getElementById('mm-poi-card').classList.remove('hidden');
        const surfaceY = eng2.sampleElevation(poi.x, poi.z);
        eng2.targetLookAt.set(poi.x, surfaceY, poi.z);
        eng2.targetCameraPos.set(poi.x + 260, surfaceY + 260, poi.z + 260);
    }

    function closePOICard() {
        document.getElementById('mm-poi-card').classList.add('hidden');
        eng.activePoi = null;
    }

    // 2D-projected POI pin markers (HTML overlay, same technique as the
    // reference's update2DPOIMarkers). The pin itself is always visible
    // once a POI's real coordinate exists (so there's something to be
    // curious about) — only the NAME is gated by discovery, via
    // selectPOI's discovered check above, not the pin's presence.
    const poiLayer = document.getElementById('minimap-poi-layer');
    eng.updatePOIMarkers = () => {
        eng.poisGroup.children.forEach((group) => {
            const poi = group.userData;
            let el = document.getElementById(`mm-marker-${poi.id}`);
            if (!el) {
                el = document.createElement('div');
                el.id = `mm-marker-${poi.id}`;
                el.className = 'mm-poi-marker';
                el.innerHTML = `<div class="mm-poi-pulse"></div><div class="mm-poi-pin"></div>`;
                el.addEventListener('click', (e) => { e.stopPropagation(); selectPOI(state, poi); });
                poiLayer.appendChild(el);
            }
            const discovered = state.discoveredPois && state.discoveredPois.has(poi.id);
            el.classList.toggle('mm-poi-marker-undiscovered', !discovered); // dimmer pin (see CSS) until Kat's actually been there
            const worldPos = new THREE.Vector3(poi.x, eng.sampleElevation(poi.x, poi.z) + 18, poi.z);
            const screenPos = worldPos.clone().project(eng.camera);
            const rect = container.getBoundingClientRect();
            const x = (screenPos.x * 0.5 + 0.5) * rect.width;
            const y = (-(screenPos.y * 0.5) + 0.5) * rect.height;
            if (screenPos.z > 1.0 || x < 0 || x > rect.width || y < 0 || y > rect.height) {
                el.style.display = 'none';
            } else {
                el.style.display = 'block';
                el.style.left = `${x}px`;
                el.style.top = `${y}px`;
            }
        });
    };

    eng.resizeObserver = new ResizeObserver(() => {
        const rect = container.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        eng.camera.left = -130 * (rect.width / rect.height);
        eng.camera.right = 130 * (rect.width / rect.height);
        eng.camera.top = 130; eng.camera.bottom = -130;
        eng.camera.updateProjectionMatrix();
        eng.renderer.setSize(rect.width, rect.height);
    });
    eng.resizeObserver.observe(container);
}

function weatherLabel(state) {
    const intensity = state.currentRainIntensity || 0;
    if (intensity <= 0.02) return 'Clear';
    if (intensity < 0.5) return 'Cloudy';
    return state.weather && state.weather.phase === 'raining' ? 'Stormy' : 'Cloudy';
}
function partyLabel(state) {
    if (!state.demoAnimals || state.demoAnimals.length === 0) return 'None';
    const names = state.demoAnimals.filter(r => r.following).map(r => r.name);
    if (names.length === 0) return 'None';
    return names.map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(', ');
}

// Lighting driven from the REAL game clock/weather instead of the
// reference file's own separate day-night auto-cycle toggle.
function updateLightingFromRealState(state, eng) {
    const hours = (state.gameTime !== undefined ? state.gameTime : 0.5) * 24;
    const rad = ((hours - 6) / 24) * Math.PI * 2;
    eng.directionalLight.position.set(Math.cos(rad) * 200, Math.max(10, Math.sin(rad) * 200), Math.sin(rad * 0.5) * 100);
    const isNight = hours > 18.5 || hours < 5.5;
    const rain = state.currentRainIntensity || 0;
    let targetBg, targetAmbient, targetSunIntensity;
    if (isNight) {
        targetBg = new THREE.Color(0x030508); targetAmbient = new THREE.Color(0x0c1424); targetSunIntensity = 0.1;
        eng.directionalLight.color.setHex(0x38bdf8);
    } else {
        targetBg = new THREE.Color(0x0b0f19); targetAmbient = new THREE.Color(0x2d3748); targetSunIntensity = 1.4 * (1 - rain * 0.5);
        eng.directionalLight.color.setHex(0xfff5ea);
    }
    eng.scene.background.lerp(targetBg, 0.05);
    eng.scene.fog.color.lerp(targetBg, 0.05);
    eng.scene.fog.density = 0.0035 + rain * 0.004; // thickens with real weather, same idea as water.js's rain-linked reactivity
    eng.ambientLight.color.lerp(targetAmbient, 0.05);
    eng.directionalLight.intensity = THREE.MathUtils.lerp(eng.directionalLight.intensity, targetSunIntensity, 0.05);

    document.getElementById('mm-clock').textContent = `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')} ${isNight ? '[NIGHT]' : '[DAY]'}`;
    document.getElementById('mm-weather').textContent = weatherLabel(state);
    document.getElementById('mm-party').textContent = partyLabel(state);
}

function panelAnimate(state) {
    const eng = state.minimap.engine;
    if (!eng || !state.minimap.expanded) return; // self-stopping: no more frames scheduled once collapsed

    const delta = eng.clock.getDelta();
    const elapsed = eng.clock.getElapsedTime();

    eng.mountainFogGroup.children.forEach(sprite => {
        const d = sprite.userData;
        d.angle += d.speed * delta;
        sprite.position.x = Math.cos(d.angle) * d.radius;
        sprite.position.z = Math.sin(d.angle) * d.radius - 5;
        sprite.position.y = d.baseY + Math.sin(elapsed * d.bobSpeed + d.phase) * 1.8;
    });

    eng.poisGroup.children.forEach(group => {
        const orb = group.getObjectByName('beaconOrb');
        if (orb) { orb.rotation.y += delta * 1.5; orb.rotation.x += delta * 0.8; }
    });

    const emberPos = eng.emberParticles.geometry.attributes.position.array;
    for (let i = 1; i < emberPos.length; i += 3) {
        emberPos[i] += delta * 6; // rise, not fall — embers, not ash
        if (emberPos[i] > 85) emberPos[i] = 5;
    }
    eng.emberParticles.geometry.attributes.position.needsUpdate = true;

    const oceanPos = eng.oceanMesh.geometry.attributes.position;
    for (let i = 0; i < oceanPos.count; i++) {
        const x = oceanPos.getX(i), z = oceanPos.getZ(i);
        const swell = Math.sin(x * 0.05 + elapsed * 0.8) * Math.cos(z * 0.05 + elapsed * 0.8) * 0.8;
        const chop = Math.sin(x * 0.15 - elapsed * 1.5) * 0.25;
        oceanPos.setY(i, swell + chop + 0.2);
    }
    oceanPos.needsUpdate = true;

    // Real player position, proportionally mapped (see playerMarker comment above)
    if (state.player) {
        const mapX = (state.player.position.x / WORLD_SIZE) * eng.MAP_SIZE;
        const mapZ = (state.player.position.z / WORLD_SIZE) * eng.MAP_SIZE;
        const mapY = eng.sampleElevation(mapX, mapZ);
        eng.playerMarker.position.set(mapX, mapY + 2, mapZ);
        eng.playerMarker.rotation.y = state.playerYaw || 0;
    }

    updateLightingFromRealState(state, eng);

    eng.currentLookAt.lerp(eng.targetLookAt, 0.08);
    eng.camera.position.lerp(eng.targetCameraPos, 0.08);
    eng.camera.lookAt(eng.currentLookAt);

    eng.updatePOIMarkers();
    eng.renderer.render(eng.scene, eng.camera);

    requestAnimationFrame(() => panelAnimate(state));
}

// ===========================================================================
// PUBLIC API — unchanged names/signatures, main.js needs no changes
// ===========================================================================

export function createMinimap(state) {
    injectStyles();
    const dom = buildDOM();
    state.minimap = {
        expanded: false,
        iconCanvas: dom.querySelector('#minimap-icon-canvas'),
        panelLayer: dom.querySelector('#minimap-panel-layer'),
        engine: null, // built lazily — see buildEngine(), called from toggleMinimap() on first expand
        iconCoastline: null,
    };
    bakeIconCoastline(state);
    state.discoveredPois = state.discoveredPois || new Set();
}

export function toggleMinimap(state) {
    if (!state.minimap) return;
    state.minimap.expanded = !state.minimap.expanded;
    state.minimap.panelLayer.classList.toggle('visible', state.minimap.expanded);
    if (state.minimap.expanded) {
        if (!state.minimap.engine) {
            state.minimap.engine = buildEngine(state);
            wireInteraction(state, state.minimap.engine);
        }
        state.minimap.engine.clock.getDelta(); // discard the "time since panel was last open" delta so the ocean/fog don't jump
        requestAnimationFrame(() => panelAnimate(state));
    }
}

// Called every frame from main.js's MAIN loop (not gated on the map being
// open) — exploring the real world is what unlocks a POI's name, whether
// or not the player has ever even opened the map yet.
export function updatePoiDiscovery(state) {
    if (!state.player || !state.discoveredPois) return;
    getPoiData(state).forEach((poi) => {
        if (state.discoveredPois.has(poi.id)) return;
        const dx = state.player.position.x - poi.x, dz = state.player.position.z - poi.z;
        if (Math.hypot(dx, dz) < DISCOVERY_RADIUS) state.discoveredPois.add(poi.id);
    });
}

// Called every frame from main.js's animate() loop — only handles the
// small always-on icon. The expanded panel runs its own independent
// rAF loop (panelAnimate above), started/stopped by toggleMinimap.
export function updateMinimap(state) {
    if (!state.minimap) return;
    drawIcon(state.minimap.iconCanvas.getContext('2d'), state);
}
