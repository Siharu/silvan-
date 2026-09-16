// Minimap system — two parts:
//
// 1. Small always-on corner icon: cheap flat 2D canvas circle + player
//    arrow, redrawn every frame from main.js's animate() loop. Unchanged
//    in spirit from the original version — running a full 3D scene at
//    96px, all the time, would cost real frame budget for a detail nobody
//    can see at that size.
//
// 2. Expanded panel (press M): a genuinely separate THREE.js scene, own
//    camera, own WebGLRenderer — a stylized fictional island (NOT a
//    render of the live game terrain) built from
//    the_hearth_isometric_map.html, the reference file you sent. Ported
//    fairly faithfully (island shape, ember-core pit, instanced
//    tree/rock scatter, mountain fog, ocean, POI markers + card UI,
//    drag/zoom isometric camera), reskinned: POIs renamed to Silvan's own
//    landmarks, day/night lighting now driven by the REAL
//    state.gameTime/state.currentRainIntensity instead of the
//    reference's own separate auto-cycle toggle, and the red
//    tactical-ops HUD chrome is kept (per your call) but blended with a
//    soft misty floaty glow so it doesn't feel totally disconnected from
//    the rest of Silvan's UI.
//
// The panel's THREE engine is built lazily on first expand, not at
// createMinimap() time — a few thousand instanced trees + a 128x128
// terrain mesh is cheap once built, but there's no reason to pay that
// cost (or hold a second WebGLRenderer, second scene graph, etc.) for a
// player who never opens the map.

import * as THREE from 'three';
import { WORLD_SIZE } from './world-state.js';
import { noise } from '../environment/terrain.js'; // reused instead of pulling in the reference file's separate simplex-noise CDN dependency — same hash-based value noise environment/terrain.js's own heightfield already uses

const ICON_SIZE = 96; // small corner icon, px

// ---------------------------------------------------------------------
// Fictional island POIs — renamed from the_hearth_isometric_map.html's
// generic tactical-ops set to Silvan's own landmarks. Positions are
// hand-placed within this fictional terrain's own space (MAP_SIZE=240
// below); they don't correspond 1:1 to the live game's real world
// coordinates, matching the fact that this whole map is a stylized
// standalone piece rather than a render of the actual terrain.
const POI_DATA = [
    {
        id: 'hearth', name: 'The Hearth', x: 0, z: -5,
        desc: "Where Kat first opened its eyes. The warmth here never fully fades, and none of the pets know why.",
        feeling: 'WARM', whisper: 'A low hum, always present, never louder.',
        glowColor: 0xf2843a,
    },
    {
        id: 'radio_tower', name: 'The Radio Tower', x: 35, z: -45,
        desc: "A rusted transmission spire on the eastern ridge. It listens for something that hasn't spoken yet.",
        feeling: 'UNEASY', whisper: 'Static, then silence, then static again.',
        glowColor: 0xef4444,
    },
    {
        id: 'bluff', name: 'The Southern Bluff', x: -70, z: 65,
        desc: 'Where the island ends and the ocean begins. Some nights you can see the horizon glow from here.',
        feeling: 'CALM', whisper: 'Wind off the water, and nothing else.',
        glowColor: 0x60a5fa,
    },
    {
        id: 'willow', name: 'The Willow', x: 60, z: 70,
        desc: 'A lone willow leaning over dark water. Something is buried beneath its roots, and it has never been dug up.',
        feeling: 'COLD', whisper: 'A creak with no wind to explain it.',
        glowColor: 0x4ade80,
    },
    {
        id: 'shore', name: 'The Waking Shore', x: 0, z: 95,
        desc: 'The stretch of beach facing the open water. This is where the light will come, when it comes.',
        feeling: 'WAITING', whisper: 'Three nights now. It keeps getting closer.',
        glowColor: 0xffe066,
    },
    {
        id: 'cabin', name: 'The Ruined Cabin', x: 65, z: 50,
        desc: 'Rotting driftwood beams collapse over dark wet sand. Something used to live here, once, and left in a hurry.',
        feeling: 'SAD', whisper: 'A floorboard settles. Nobody is standing on it.',
        glowColor: 0xeab308,
    },
    {
        id: 'cave', name: 'The Cave', x: -25, z: 35,
        desc: "A jagged maw torn into the western cliff face. The air coming out of it is colder than anything else on the island.",
        feeling: 'AFRAID', whisper: 'Something breathing, slow, from very far back.',
        glowColor: 0x3b82f6,
    },
];

// ===========================================================================
// SMALL CORNER ICON — cheap flat 2D canvas, unchanged approach from before
// ===========================================================================

function drawIcon(ctx, state) {
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    const cx = ICON_SIZE / 2, cy = ICON_SIZE / 2;
    const scale = (ICON_SIZE * 0.42) / (WORLD_SIZE / 2);

    // Water — soft radial darkening toward the rim instead of a flat fill,
    // just enough shading at this size to not read as a single flat color.
    const waterGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, ICON_SIZE * 0.5);
    waterGrad.addColorStop(0, '#0f1f30');
    waterGrad.addColorStop(1, '#060d16');
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);

    // Island — radial shading (lighter center, darker edge) rather than a
    // flat green disc, plus a thin ember-toned rim echoing the expanded
    // map's new red/ember identity so the icon reads as "the same place."
    const landGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, ICON_SIZE * 0.42);
    landGrad.addColorStop(0, '#2f3d26');
    landGrad.addColorStop(0.75, '#232f1c');
    landGrad.addColorStop(1, '#1a2415');
    ctx.fillStyle = landGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, ICON_SIZE * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(224, 90, 58, 0.35)'; // matches the panel's --mm-red
    ctx.lineWidth = 1.5;
    ctx.stroke();

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
                    <div class="mm-panel mm-poi-buttons" id="mm-poi-buttons"></div>
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
            right: 7.6rem; /* left of the existing touch-pause-btn/time-ff-btn row — see main.js's HUD corner */
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

        .mm-bottom-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 0.8rem; flex-wrap: wrap; }
        .mm-poi-buttons { padding: 0.6rem; display: flex; gap: 0.4rem; flex-wrap: wrap; max-width: 60vw; }
        .mm-poi-buttons .mm-btn { text-transform: uppercase; }
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
    const MAP_SIZE = 240, MAP_SEGMENTS = 128;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090e);
    scene.fog = new THREE.FogExp2(0x07090e, 0.0035);

    const rect = container.getBoundingClientRect();
    const aspect = rect.width / rect.height || 1;
    const d = 130;
    const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 2000);
    camera.position.set(180, 180, 180);
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

    function sampleElevation(x, z) {
        const nx = x / MAP_SIZE, nz = z / MAP_SIZE;
        const dist = Math.sqrt(x * x + z * z) / (MAP_SIZE * 0.45);
        let noiseVal = noise(nx * 2.2, nz * 2.2) * 1.0 + noise(nx * 5.5, nz * 5.5) * 0.4 + noise(nx * 12.0, nz * 12.0) * 0.15;
        let islandShape = dist < 1.0 ? Math.pow(1.0 - dist, 1.3) : 0;
        let elevation = (noiseVal + 1.2) * 18 * islandShape;
        if (dist < 0.42) {
            const peakFactor = Math.pow(1.0 - (dist / 0.42), 1.8);
            elevation += peakFactor * 55;
            const abyssDist = Math.sqrt(x * x + (z + 5) * (z + 5));
            if (abyssDist < 16) {
                const pit = Math.cos((abyssDist / 16) * Math.PI * 0.5);
                elevation -= pit * 28;
            }
        }
        if (elevation > 0 && elevation < 3.5) elevation += noise(nx * 30, nz * 30) * 0.3;
        return Math.max(-5, elevation);
    }

    // --- Terrain: island shape + central ember-core pit (was "volcanic
    // magma abyss" in the reference — recolored/reframed as the Hearth's
    // ember-heart, which is thematically exactly what "Hearth" already
    // means, so the terrain concept genuinely fits once renamed).
    const terrainGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, MAP_SEGMENTS, MAP_SEGMENTS);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position;
    const colors = [];
    const oceanBedColor = new THREE.Color(0x0c131d);
    const wetSandColor = new THREE.Color(0x2d2b27);
    const darkLowlandColor = new THREE.Color(0x1a241e);
    const slateHighlandColor = new THREE.Color(0x2f353d);
    const mountainPeakColor = new THREE.Color(0x111317);
    const emberColor = new THREE.Color(0xdc5a26); // warmed from the reference's 0xdc2626 pure-red magma toward ember-orange
    for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i), vz = posAttr.getZ(i);
        const vy = sampleElevation(vx, vz);
        posAttr.setY(i, vy);
        const distFromCenter = Math.sqrt(vx * vx + (vz + 5) * (vz + 5));
        let c = new THREE.Color();
        if (vy < 0.5) c.copy(oceanBedColor);
        else if (vy < 3.5) c.copy(wetSandColor);
        else if (vy < 18.0) c.copy(darkLowlandColor);
        else if (vy < 40.0) c.copy(slateHighlandColor);
        else c.copy(mountainPeakColor);
        if (distFromCenter < 14 && vy < 35) c.lerp(emberColor, Math.min(1.0, (14 - distFromCenter) / 10));
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
    const emberLight = new THREE.PointLight(0xe0703a, 4, 60);
    emberLight.position.set(0, 25, -5);
    scene.add(emberLight);

    // --- Instanced trees/dead-trees/rocks scatter (reference used 9000
    // candidates; trimmed to 4000 — this is a side HUD panel, not a
    // dedicated fullscreen app, and instanced meshes are cheap either way).
    const treeGeo = new THREE.ConeGeometry(0.7, 3.5, 5); treeGeo.translate(0, 1.75, 0);
    const deadTreeGeo = new THREE.CylinderGeometry(0.15, 0.4, 2.8, 5); deadTreeGeo.translate(0, 1.4, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1.0, 0); rockGeo.translate(0, 0.5, 0);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x16261c, roughness: 0.9, flatShading: true }); // warmed slightly greener than the reference's near-black 0x111c15 so it doesn't read as scorched
    const deadTreeMat = new THREE.MeshStandardMaterial({ color: 0x3d3935, roughness: 1.0, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.8, flatShading: true });
    const treeM = [], deadTreeM = [], rockM = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 4000; i++) {
        const x = (Math.random() - 0.5) * MAP_SIZE * 0.95;
        const z = (Math.random() - 0.5) * MAP_SIZE * 0.95;
        const y = sampleElevation(x, z);
        const distFromCenter = Math.sqrt(x * x + z * z);
        if (y > 1.2 && y < 45 && distFromCenter > 18) {
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

    // --- Mountain fog ring around the Hearth's peak
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
        const radius = 16 + Math.random() * 26, height = 46 + Math.random() * 22;
        sprite.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius - 5);
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

    // --- Ruined Cabin — ported from the_hearth_isometric_map.html's
    // buildRuinedCabin() (cut earlier for scope since the old POI list
    // didn't include it; restored now that "The Ruined Cabin" is back in
    // POI_DATA above). Same coordinates as that POI (65, 50) so the pin
    // actually sits on something.
    (function buildRuinedCabin() {
        const cabinGroup = new THREE.Group();
        const cx = 65, cz = 50;
        const cy = sampleElevation(cx, cz);
        cabinGroup.position.set(cx, cy, cz);
        cabinGroup.rotation.y = -Math.PI / 4;
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.95, flatShading: true });
        const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x211510, roughness: 1.0, flatShading: true });
        const stoneMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.9, flatShading: true });
        for (let i = -3; i <= 3; i += 0.8) {
            if (Math.random() > 0.15) {
                const plank = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.15, 6), woodMat);
                plank.position.set(i, 0.08, (Math.random() - 0.5) * 0.4);
                plank.rotation.y = (Math.random() - 0.5) * 0.1;
                cabinGroup.add(plank);
            }
        }
        const wallPositions = [
            { x: -3.2, z: 0, rotZ: 0.08, h: 3.2 },
            { x: 3.2, z: 0, rotZ: -0.15, h: 2.8 },
            { x: 0, z: -3, rotX: 0.12, h: 3.0 },
        ];
        wallPositions.forEach(w => {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, w.h, 0.4), darkWoodMat);
            post.position.set(w.x, w.h / 2, w.z);
            post.rotation.z = w.rotZ || 0;
            post.rotation.x = w.rotX || 0;
            cabinGroup.add(post);
            for (let y = 0.5; y < w.h - 0.3; y += 0.55) {
                if (Math.random() > 0.3) {
                    const log = new THREE.Mesh(new THREE.BoxGeometry(w.z !== 0 ? 6.2 : 0.2, 0.4, w.z !== 0 ? 0.2 : 6.2), woodMat);
                    log.position.set(w.x, y, w.z);
                    log.rotation.z = (Math.random() - 0.5) * 0.08;
                    cabinGroup.add(log);
                }
            }
        });
        const rafters = [-2.5, -1, 0.5, 2];
        rafters.forEach((rx, idx) => {
            const rafterL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 4.2), darkWoodMat);
            rafterL.position.set(rx, 3.8, -1.2);
            rafterL.rotation.set(0.62, 0, (idx === 1 ? 0.25 : 0));
            cabinGroup.add(rafterL);
            if (idx !== 2) {
                const rafterR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 4.2), darkWoodMat);
                rafterR.position.set(rx, 3.5, 1.2);
                rafterR.rotation.set(-0.62, 0, (idx === 0 ? -0.3 : 0));
                cabinGroup.add(rafterR);
            }
        });
        const chimney = new THREE.Group();
        chimney.position.set(2.8, 0, -2.2);
        for (let ccy = 0; ccy < 11; ccy++) {
            if (ccy > 7 && Math.random() > 0.45) continue;
            const brick = new THREE.Mesh(new THREE.BoxGeometry(1.4 + (Math.random() - 0.5) * 0.2, 0.4, 1.4 + (Math.random() - 0.5) * 0.2), stoneMat);
            brick.position.set((Math.random() - 0.5) * 0.15, ccy * 0.4 + 0.2, (Math.random() - 0.5) * 0.15);
            chimney.add(brick);
        }
        cabinGroup.add(chimney);
        for (let d = 0; d < 14; d++) {
            const plank = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 1.8), woodMat);
            plank.position.set((Math.random() - 0.5) * 11, 0.05, (Math.random() - 0.5) * 11);
            plank.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
            cabinGroup.add(plank);
        }
        const cabinLight = new THREE.PointLight(0xeab308, 1.8, 14);
        cabinLight.position.set(0, 1.2, 0);
        cabinGroup.add(cabinLight);
        scene.add(cabinGroup);
    })();

    // --- Ember particles rising from the Hearth core (reference's "ash
    // particles", reframed to rise rather than fall since embers/heat
    // rise — small physical tweak to match the new framing)
    const emberCount = 350;
    const emberGeo = new THREE.BufferGeometry();
    const emberPos = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount * 3; i += 3) {
        emberPos[i] = (Math.random() - 0.5) * MAP_SIZE * 0.9;
        emberPos[i + 1] = Math.random() * 80 + 5;
        emberPos[i + 2] = (Math.random() - 0.5) * MAP_SIZE * 0.9;
    }
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
    const emberParticles = new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xe0703a, size: 1.2, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
    scene.add(emberParticles);

    // --- POI markers
    const poisGroup = new THREE.Group();
    POI_DATA.forEach((poi) => {
        const surfaceY = sampleElevation(poi.x, poi.z);
        const group = new THREE.Group();
        group.position.set(poi.x, surfaceY, poi.z);
        const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 2, 6), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 }));
        baseMesh.position.y = 1;
        group.add(baseMesh);
        const orbMesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), new THREE.MeshBasicMaterial({ color: poi.glowColor, wireframe: true }));
        orbMesh.position.y = 4; orbMesh.name = 'beaconOrb';
        group.add(orbMesh);
        const pLight = new THREE.PointLight(poi.glowColor, 2, 25);
        pLight.position.y = 4;
        group.add(pLight);
        group.userData = poi;
        poisGroup.add(group);
    });
    scene.add(poisGroup);

    // --- Player marker (proportionally mapped from the REAL world
    // position — realX/WORLD_SIZE * MAP_SIZE — onto this fictional
    // terrain's own space. This is a stylized map, not a literal render
    // of the live world, so it doesn't correspond to real landmarks; the
    // proportional mapping just keeps "roughly where you are on the
    // island" legible, the same way a stylized game map usually works.)
    const playerMarker = new THREE.Group();
    const playerCone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4, 4), new THREE.MeshBasicMaterial({ color: 0xffe9b3 }));
    playerCone.rotation.x = Math.PI; // point tip toward facing direction, base up
    playerMarker.add(playerCone);
    const playerLight = new THREE.PointLight(0xffe9b3, 2, 20);
    playerMarker.add(playerLight);
    scene.add(playerMarker);

    return {
        scene, camera, renderer, container,
        sampleElevation, mountainFogGroup, oceanMesh, emberParticles, poisGroup, playerMarker,
        ambientLight, hemisphereLight, directionalLight,
        targetCameraPos: new THREE.Vector3(180, 180, 180),
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
            if (type === 'iso') { eng.targetLookAt.set(0, 0, 0); eng.targetCameraPos.set(180, 180, 180); }
            else if (type === 'hearth') { eng.targetLookAt.set(0, 35, -5); eng.targetCameraPos.set(90, 110, 90); }
            else if (type === 'top') { eng.targetLookAt.set(0, 0, 0); eng.targetCameraPos.set(0, 240, 0.1); }
        });
    });

    document.getElementById('mm-card-close').addEventListener('click', () => closePOICard());

    const btnContainer = document.getElementById('mm-poi-buttons');
    POI_DATA.forEach((poi) => {
        const btn = document.createElement('button');
        btn.className = 'mm-btn';
        btn.textContent = poi.name.toUpperCase();
        btn.id = `mm-quick-${poi.id}`;
        btn.addEventListener('click', () => selectPOI(state, poi));
        btnContainer.appendChild(btn);
    });

    function selectPOI(st, poi) {
        const eng2 = st.minimap.engine;
        eng2.activePoi = poi;
        document.querySelectorAll('#mm-poi-buttons button').forEach(b => b.classList.remove('mm-btn-active'));
        const activeBtn = document.getElementById(`mm-quick-${poi.id}`);
        if (activeBtn) activeBtn.classList.add('mm-btn-active');
        document.getElementById('mm-card-tag').textContent = `LANDMARK // ${poi.id.toUpperCase()}`;
        document.getElementById('mm-card-title').textContent = poi.name;
        document.getElementById('mm-card-desc').textContent = poi.desc;
        document.getElementById('mm-card-feeling').textContent = poi.feeling;
        document.getElementById('mm-card-whisper').textContent = poi.whisper;
        document.getElementById('mm-poi-card').classList.remove('hidden');
        const surfaceY = eng2.sampleElevation(poi.x, poi.z);
        eng2.targetLookAt.set(poi.x, surfaceY, poi.z);
        eng2.targetCameraPos.set(poi.x + 100, surfaceY + 100, poi.z + 100);
    }

    function closePOICard() {
        document.getElementById('mm-poi-card').classList.add('hidden');
        eng.activePoi = null;
        document.querySelectorAll('#mm-poi-buttons button').forEach(b => b.classList.remove('mm-btn-active'));
    }

    // 2D-projected POI pin markers (HTML overlay, same technique as the
    // reference's update2DPOIMarkers)
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
            const worldPos = new THREE.Vector3(poi.x, eng.sampleElevation(poi.x, poi.z) + 6, poi.z);
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
    };
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

// Called every frame from main.js's animate() loop — only handles the
// small always-on icon. The expanded panel runs its own independent
// rAF loop (panelAnimate above), started/stopped by toggleMinimap.
export function updateMinimap(state) {
    if (!state.minimap) return;
    drawIcon(state.minimap.iconCanvas.getContext('2d'), state);
}
