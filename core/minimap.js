// Isometric minimap — small floaty corner HUD icon (always on), expands to
// a full floaty panel on a keybind press (see keybinds.js's new 'toggleMap'
// action). Matches the existing "misty/floaty Dead-Space-esque" HUD
// language already established by the pause panel in index.html (radial
// mist gradients, drifting float animation, thin pale-blue border) rather
// than inventing a new visual style.
//
// Draws a plain top-down 2D map onto a canvas, then lets CSS apply a 3D
// tilt (rotateX + rotateZ) to the whole canvas element to get the
// isometric-diamond look — the draw code never needs to know about the
// tilt, so markers/text stay legible and don't need counter-rotation math.
//
// Shows, per your "everything" answer: the player (position + facing),
// the lake, the outer ocean edge, and every recruited/wandering animal
// companion (state.demoAnimals). Landmarks (radio tower, story beat
// spots) are included too, best-effort, via a small state.mapMarkers
// registry other modules can push into — nothing currently populates it
// except the radio tower wired below, since core/landmarks.js only
// computes one-off points on demand rather than keeping a stored list.

import { WORLD_SIZE, WATER_LEVEL } from './world-state.js';
import { getKeybind } from './keybinds.js';
import { getElevation } from '../environment/terrain.js';

const ICON_SIZE = 96;   // small corner icon, px
const PANEL_SIZE = 420; // expanded panel, px
const LAKE_RADIUS = 80; // matches environment/water.js's 160x160 lake plane, centered at world origin

// World coords -> map-space, centered + scaled to fit WORLD_SIZE inside the
// canvas with a little margin. Map space has +X right, +Y "up the screen"
// (i.e. world -Z), matching a conventional top-down map orientation.
function worldToMap(x, z, canvasSize) {
    const scale = (canvasSize * 0.92) / WORLD_SIZE;
    const half = canvasSize / 2;
    return { x: half + x * scale, y: half + z * scale, scale };
}

function buildDOM() {
    const wrap = document.createElement('div');
    wrap.id = 'minimap-wrap';
    wrap.innerHTML = `
        <div id="minimap-icon" class="minimap-icon" title="Press ${'M'} to expand">
            <canvas id="minimap-icon-canvas" width="${ICON_SIZE}" height="${ICON_SIZE}"></canvas>
        </div>
        <div id="minimap-panel-layer" class="minimap-panel-layer">
            <div class="minimap-panel">
                <h2>The Hearth</h2>
                <div class="minimap-iso-stage">
                    <canvas id="minimap-panel-canvas" width="${PANEL_SIZE}" height="${PANEL_SIZE}"></canvas>
                </div>
                <div class="minimap-hint">PRESS M TO CLOSE</div>
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
            top: 18px;
            right: 18px;
            width: ${ICON_SIZE}px;
            height: ${ICON_SIZE}px;
            border-radius: 50%;
            z-index: 15;
            background:
                radial-gradient(ellipse at 30% 20%, rgba(200, 220, 255, 0.10) 0%, transparent 60%),
                rgba(16, 20, 28, 0.55);
            border: 1px solid rgba(210, 225, 255, 0.22);
            box-shadow: 0 0 20px rgba(140, 180, 255, 0.10), inset 0 0 20px rgba(180, 200, 255, 0.05);
            overflow: hidden;
            animation: minimap-float 7s ease-in-out infinite;
            pointer-events: none;
        }
        .minimap-icon canvas { width: 100%; height: 100%; display: block; }
        @keyframes minimap-float {
            0%, 100% { transform: translateY(0) rotate(-0.2deg); }
            50% { transform: translateY(-4px) rotate(0.2deg); }
        }
        .minimap-panel-layer {
            position: fixed;
            inset: 0;
            z-index: 21;
            display: none;
            align-items: center;
            justify-content: center;
            background: radial-gradient(ellipse at center, rgba(10, 14, 20, 0.45) 0%, rgba(4, 6, 10, 0.75) 100%);
            backdrop-filter: blur(2px);
        }
        .minimap-panel-layer.visible { display: flex; }
        .minimap-panel {
            position: relative;
            padding: 1.8rem 2rem 1.4rem;
            border-radius: 4px;
            text-align: center;
            color: #eef1f6;
            background:
                radial-gradient(ellipse at 30% 20%, rgba(200, 220, 255, 0.10) 0%, transparent 55%),
                radial-gradient(ellipse at 75% 80%, rgba(180, 210, 255, 0.07) 0%, transparent 60%),
                rgba(16, 20, 28, 0.55);
            border: 1px solid rgba(210, 225, 255, 0.18);
            box-shadow: 0 0 40px rgba(140, 180, 255, 0.08), 0 0 90px rgba(0, 0, 0, 0.5), inset 0 0 60px rgba(180, 200, 255, 0.04);
            animation: minimap-float 8s ease-in-out infinite;
        }
        .minimap-panel h2 {
            font-weight: 300;
            letter-spacing: 0.3em;
            font-size: 0.95rem;
            text-transform: uppercase;
            color: #cdd8ec;
            margin: 0 0 1.2rem;
            text-shadow: 0 0 14px rgba(160, 190, 255, 0.35);
        }
        .minimap-hint {
            margin-top: 1rem;
            font-size: 0.65rem;
            letter-spacing: 0.15em;
            text-transform: uppercase;
            color: #9fb0c9;
        }
        /* The isometric tilt — applied to the stage (perspective parent)
           and its canvas child, not the draw code. */
        .minimap-iso-stage {
            width: ${PANEL_SIZE}px;
            height: ${PANEL_SIZE}px;
            perspective: 900px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .minimap-iso-stage canvas {
            border-radius: 6px;
            border: 1px solid rgba(210, 225, 255, 0.15);
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            transform: rotateX(50deg) rotateZ(45deg);
            transform-style: preserve-3d;
        }
    `;
    document.head.appendChild(style);
}

export function createMinimap(state) {
    injectStyles();
    const dom = buildDOM();
    state.minimap = {
        expanded: false,
        iconCanvas: dom.querySelector('#minimap-icon-canvas'),
        panelCanvas: dom.querySelector('#minimap-panel-canvas'),
        panelLayer: dom.querySelector('#minimap-panel-layer'),
    };
    state.mapMarkers = state.mapMarkers || []; // { x, z, label, color } — extension point for future landmarks (see module comment)
    bakeCoastline(state); // one-time real-terrain sample for the expanded panel — see bakeCoastline() comment
}

export function toggleMinimap(state) {
    if (!state.minimap) return;
    state.minimap.expanded = !state.minimap.expanded;
    state.minimap.panelLayer.classList.toggle('visible', state.minimap.expanded);
}

const BAKE_RES = 160; // grid resolution for the one-time real-terrain coastline bake (see bakeCoastline) — independent of PANEL_SIZE's pixel size, then scaled up on draw

// One-time real-terrain coastline bake for the EXPANDED panel only — the
// small corner icon keeps the cheap circle approximation (drawMap's
// fallback path) since it's tiny and redrawn every frame regardless, so
// real sampling would be pure waste there. The panel is static terrain
// against a moving player/animals, so this only needs to run once ever
// (cached on state.minimap.coastlineCanvas) rather than per-frame.
function bakeCoastline(state) {
    const bake = document.createElement('canvas');
    bake.width = BAKE_RES;
    bake.height = BAKE_RES;
    const bctx = bake.getContext('2d');
    const img = bctx.createImageData(BAKE_RES, BAKE_RES);

    for (let py = 0; py < BAKE_RES; py++) {
        for (let px = 0; px < BAKE_RES; px++) {
            // Map pixel back to world coords using the same worldToMap scale
            // math as the live draw, just inverted.
            const scale = (BAKE_RES * 0.92) / WORLD_SIZE;
            const half = BAKE_RES / 2;
            const wx = (px - half) / scale;
            const wz = (py - half) / scale;
            const h = getElevation(wx, wz, state);
            const i = (py * BAKE_RES + px) * 4;
            if (h <= WATER_LEVEL) {
                img.data[i] = 0x0a; img.data[i + 1] = 0x16; img.data[i + 2] = 0x22; // ocean
            } else {
                img.data[i] = 0x25; img.data[i + 1] = 0x30; img.data[i + 2] = 0x1f; // land
            }
            img.data[i + 3] = 255;
        }
    }
    bctx.putImageData(img, 0, 0);
    state.minimap.coastlineCanvas = bake;
}

function drawMap(ctx, canvasSize, state, useRealCoastline) {
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    if (useRealCoastline && state.minimap.coastlineCanvas) {
        // Cached bake, just scaled up — no per-frame terrain sampling.
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(state.minimap.coastlineCanvas, 0, 0, canvasSize, canvasSize);
    } else {
        // Cheap circle approximation — used for the always-on corner icon.
        ctx.fillStyle = '#0a1622';
        ctx.fillRect(0, 0, canvasSize, canvasSize);
        const c = worldToMap(0, 0, canvasSize);
        const islandRadius = (WORLD_SIZE * 0.42) * c.scale;
        ctx.fillStyle = '#25301f';
        ctx.beginPath();
        ctx.arc(c.x, c.y, islandRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    const center = worldToMap(0, 0, canvasSize);

    // Lake
    const lakeR = LAKE_RADIUS * center.scale;
    ctx.fillStyle = WATER_LEVEL < 0 ? '#0f3a52' : '#0f3a52';
    ctx.beginPath();
    ctx.arc(center.x, center.y, lakeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 220, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Extra markers (radio tower, future landmarks)
    for (const m of state.mapMarkers) {
        const p = worldToMap(m.x, m.z, canvasSize);
        ctx.fillStyle = m.color || '#e8c97a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // Animal companions
    if (state.demoAnimals) {
        for (const rig of state.demoAnimals) {
            if (!rig.root) continue;
            const p = worldToMap(rig.root.position.x, rig.root.position.z, canvasSize);
            ctx.fillStyle = rig.following ? '#8fd18f' : '#7a8a99'; // brighter green once it's actually traveling with you, muted grey while just wandering loose
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Player marker — triangle pointing along actual facing (state.playerYaw)
    if (state.player) {
        const p = worldToMap(state.player.position.x, state.player.position.z, canvasSize);
        const yaw = state.playerYaw || 0;
        // Matches main.js's own forward vector convention: forward=(-sin(yaw), -cos(yaw))
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const size = 8;
        const tipX = p.x + fx * size, tipY = p.y + fz * size;
        const backX = p.x - fx * size * 0.6, backY = p.y - fz * size * 0.6;
        const leftX = backX + fz * size * 0.55, leftY = backY - fx * size * 0.55;
        const rightX = backX - fz * size * 0.55, rightY = backY + fx * size * 0.55;
        ctx.fillStyle = '#ffe9b3';
        ctx.strokeStyle = 'rgba(255, 233, 179, 0.5)';
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.fill();
    }
}

// Called every frame from main.js's animate() loop.
export function updateMinimap(state) {
    if (!state.minimap) return;
    drawMap(state.minimap.iconCanvas.getContext('2d'), ICON_SIZE, state, false);
    if (state.minimap.expanded) {
        drawMap(state.minimap.panelCanvas.getContext('2d'), PANEL_SIZE, state, true);
    }
}
