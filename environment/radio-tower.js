// WNCORE radio tower — ported from the standalone radio.html lattice-tower
// build (same procedural-strut construction: createComplexLattice/
// createDetailedStrut/addDetailedPlatform/etc, verbatim geometry). Day/night
// toggle, orbit camera, and free-fly controls from the source file are gone;
// only the tower geometry + the aviation-beacon/marker-light blink survive,
// driven by an isNight boolean this game's own atmosphere/day-night-cycle.js
// computes from the sun's height each frame and passes into
// updateRadioTower() below — there's no direct state field for it.
//
// Now a reachable landmark inside the playable area (see TOWER_X/TOWER_Z)
// rather than an unreachable horizon silhouette — walking up to it and
// pressing E triggers the awe cutscene, see attemptTowerInteraction().

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { getElevation } from './terrain.js';
import { BOUNDARY_START } from '../core/player-controller.js';

// Dynamically sited rather than hardcoded — mirrors environment/animals.js's
// findDryAnchor() approach. Scans outward along the "opposite the lake/
// spawn side" direction (-Z, matching the tower's original intent) for dry,
// reasonably flat ground with enough clearance from BOUNDARY_START that the
// player can walk a full circle around the tower's base without ever
// entering the boundary wind-resistance zone. Re-running this after a future
// WORLD_SIZE or terrain retune just finds a new valid spot instead of
// silently placing the tower underwater or out of bounds again.
// Base lattice is baseW=40 wide (see createRadioTower's createComplexLattice
// call) — half-width ~20, so a clearance ring a little past that (25) is
// enough to catch real dips without being so conservative it can't find
// anywhere valid on bumpy terrain. TOWER_COLLIDER_RADIUS below is set a
// bit past this for a safety margin against clipping.
const TOWER_FOOTPRINT_CLEARANCE = 25;

function isFlatDrySpot(x, z) {
    const y = getElevation(x, z);
    if (y < 6) return null;
    for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const ny = getElevation(x + Math.cos(ang) * TOWER_FOOTPRINT_CLEARANCE, z + Math.sin(ang) * TOWER_FOOTPRINT_CLEARANCE);
        if (ny < 3) return null;
    }
    return y;
}

function findTowerAnchor() {
    const maxDist = BOUNDARY_START - 100; // stay well clear of the soft boundary zone
    // Expanding rings outward from spawn; at each ring, sweep angle in a
    // zigzag starting from due -Z (the preferred "opposite the lake/spawn
    // side" direction) and widening outward both ways. A single fixed
    // straight-line scan (the original version of this function) isn't
    // reliable on this terrain — it's noisy/hilly enough that a valid
    // flat+dry spot along one exact line can be genuinely rare, and the
    // original silently fell back to an unvalidated hardcoded point when
    // that happened, which in practice landed the tower's base straddling
    // a real dip. Sweeping angle at each distance instead of just distance
    // finds a valid spot close to the preferred direction far more reliably.
    for (let d = 280; d <= maxDist; d += 10) {
        for (let aStep = 0; aStep < 32; aStep++) {
            const angOffset = (aStep % 2 === 0 ? 1 : -1) * Math.ceil(aStep / 2) * (Math.PI / 16);
            const x = d * Math.sin(angOffset), z = -d * Math.cos(angOffset);
            const y = isFlatDrySpot(x, z);
            if (y !== null) return { x, z };
        }
    }
    // Should be unreachable given the terrain's actual noise range, but
    // fall back to a point that's at least been through the same dryness/
    // flatness check (just without the distance-ring preference) rather
    // than an unvalidated guess.
    for (let d = maxDist; d >= 100; d -= 10) {
        for (let aStep = 0; aStep < 32; aStep++) {
            const ang = aStep * (Math.PI / 16);
            const x = d * Math.cos(ang), z = d * Math.sin(ang);
            const y = isFlatDrySpot(x, z);
            if (y !== null) return { x, z };
        }
    }
    return { x: 0, z: -280 }; // last resort, verified dry+flat during development (see conversation) even though not re-checked at runtime here
}

const TOWER_INTERACT_RANGE = 26; // generous — this is a big structure, not a close-contact prompt
const TOWER_COLLIDER_RADIUS = 24; // keeps the player from clipping into the lattice legs

// Cutscene timing: ease-in to looking up at the tower, hold, then ease back
// out. Skippable early via any movement key or Escape.
const CUTSCENE_EASE_IN = 1.4;
const CUTSCENE_HOLD = 3.2;
const CUTSCENE_EASE_OUT = 0.9;
const CUTSCENE_TOTAL = CUTSCENE_EASE_IN + CUTSCENE_HOLD + CUTSCENE_EASE_OUT;

function smoothstep(t) { return t * t * (3 - 2 * t); }

// Position is resolved at createRadioTower() time via findTowerAnchor()
// above — see that function for how the spot is chosen. TOWER_X/TOWER_Z
// are filled in once the anchor is found, so other code in this file (and
// the interaction/cutscene logic below) can still reference them directly.
let TOWER_X = 0;
let TOWER_Z = 0;

function createProceduralTexture(baseColor, noiseColor, density, isRusty) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = baseColor; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < density; i++) {
        ctx.fillStyle = noiseColor;
        ctx.globalAlpha = Math.random() * 0.5 + 0.1;
        const x = Math.random() * 512; const y = Math.random() * 512;
        let w = Math.random() * 6 + 1;
        let h = isRusty ? Math.random() * 25 + 5 : Math.random() * 6 + 1;
        ctx.fillRect(x, y, w, h);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 3);
    return tex;
}

function createDetailedStrut(parent, p1, p2, thickness, material, segments) {
    const distance = p1.distanceTo(p2);
    const geometry = new THREE.CylinderGeometry(thickness, thickness, distance, segments);
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.copy(p1).add(p2).divideScalar(2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
    mesh.castShadow = true; mesh.receiveShadow = true;

    parent.add(mesh);
}

function createComplexLattice(parent, yStart, height, bottomWidth, topWidth, material, subdivisions, hasInnerBracing) {
    const group = new THREE.Group();
    group.position.y = yStart;

    const b = bottomWidth / 2;
    const t = topWidth / 2;
    const h = height;

    const legThickness = Math.max(0.6, bottomWidth * 0.03);
    const braceThickness = legThickness * 0.5;

    for (let i = 0; i < 4; i++) {
        let angle = (i * Math.PI / 2) + Math.PI / 4;
        let bX = b * Math.cos(angle) * 1.414;
        let bZ = b * Math.sin(angle) * 1.414;
        let tX = t * Math.cos(angle) * 1.414;
        let tZ = t * Math.sin(angle) * 1.414;

        createDetailedStrut(group, new THREE.Vector3(bX, 0, bZ), new THREE.Vector3(tX, h, tZ), legThickness, material, 8);
    }

    const subH = h / subdivisions;
    for (let j = 0; j < subdivisions; j++) {
        let currentY = j * subH;
        let nextY = (j + 1) * subH;

        let currentW = b - (b - t) * (j / subdivisions);
        let nextW = b - (b - t) * ((j + 1) / subdivisions);

        for (let i = 0; i < 4; i++) {
            let a1 = (i * Math.PI / 2) + Math.PI / 4;
            let a2 = ((i + 1) * Math.PI / 2) + Math.PI / 4;

            let p1_low = new THREE.Vector3(currentW * Math.cos(a1) * 1.414, currentY, currentW * Math.sin(a1) * 1.414);
            let p2_low = new THREE.Vector3(currentW * Math.cos(a2) * 1.414, currentY, currentW * Math.sin(a2) * 1.414);
            let p1_high = new THREE.Vector3(nextW * Math.cos(a1) * 1.414, nextY, nextW * Math.sin(a1) * 1.414);
            let p2_high = new THREE.Vector3(nextW * Math.cos(a2) * 1.414, nextY, nextW * Math.sin(a2) * 1.414);

            createDetailedStrut(group, p1_low, p2_low, braceThickness * 1.2, material, 5);
            createDetailedStrut(group, p1_low, p2_high, braceThickness, material, 5);
            createDetailedStrut(group, p2_low, p1_high, braceThickness, material, 5);

            if (hasInnerBracing) {
                let midP12 = new THREE.Vector3().addVectors(p1_low, p2_low).multiplyScalar(0.5);
                let midP_high = new THREE.Vector3().addVectors(p1_high, p2_high).multiplyScalar(0.5);
                createDetailedStrut(group, midP12, midP_high, braceThickness * 0.7, material, 4);
            }
        }
    }

    parent.add(group);
}

function createInnerCore(parent, yStart, height, radius, material) {
    const group = new THREE.Group();
    group.position.y = yStart;

    const coreGeo = new THREE.CylinderGeometry(radius, radius, height, 8);
    const coreMesh = new THREE.Mesh(coreGeo, material);
    coreMesh.position.y = height / 2;
    group.add(coreMesh);

    const stepCount = Math.floor(height * 2.5);
    const stepGeo = new THREE.BoxGeometry(radius * 1.6, 0.15, radius * 0.4);
    stepGeo.translate(radius * 0.9, 0, 0);

    const stairInstanced = new THREE.InstancedMesh(stepGeo, material, stepCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < stepCount; i++) {
        dummy.position.y = (i / stepCount) * height;
        dummy.rotation.y = i * 0.5;
        dummy.updateMatrix();
        stairInstanced.setMatrixAt(i, dummy.matrix);
    }
    group.add(stairInstanced);
    parent.add(group);
}

function buildPolygonRailing(parent, radius, yHeight, sides, material) {
    for (let i = 0; i < sides; i++) {
        const angle1 = (i / sides) * Math.PI * 2;
        const angle2 = ((i + 1) / sides) * Math.PI * 2;

        const p1 = new THREE.Vector3((radius - 0.2) * Math.cos(angle1), yHeight, (radius - 0.2) * Math.sin(angle1));
        const p2 = new THREE.Vector3((radius - 0.2) * Math.cos(angle2), yHeight, (radius - 0.2) * Math.sin(angle2));

        createDetailedStrut(parent, p1, p2, 0.15, material, 4);

        const pBase = new THREE.Vector3((radius - 0.2) * Math.cos(angle1), 0.25, (radius - 0.2) * Math.sin(angle1));
        createDetailedStrut(parent, pBase, p1, 0.2, material, 4);
    }
}

function addDetailedPlatform(parent, y, radius, material, sides) {
    const group = new THREE.Group();
    group.position.y = y;

    const deckGeo = new THREE.CylinderGeometry(radius, radius, 0.5, sides);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0.5 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.receiveShadow = true; deck.castShadow = true;
    group.add(deck);

    buildPolygonRailing(group, radius, 1.8, sides, material);
    buildPolygonRailing(group, radius, 0.9, sides, material);

    parent.add(group);
}

function addControlRoom(parent, y, radius, materials, aviationLights) {
    const group = new THREE.Group();
    group.position.y = y;

    const deckGeo = new THREE.CylinderGeometry(radius, radius, 1, 8);
    const deck = new THREE.Mesh(deckGeo, materials.steel);
    group.add(deck);

    const roomRadius = radius - 2.5;
    const roomHeight = 9;

    const roomGeo = new THREE.CylinderGeometry(roomRadius, roomRadius, roomHeight, 8);
    const room = new THREE.Mesh(roomGeo, materials.white);
    room.position.y = roomHeight / 2;
    group.add(room);

    const roofGeo = new THREE.ConeGeometry(roomRadius + 1.2, 3, 8);
    const roof = new THREE.Mesh(roofGeo, materials.red);
    roof.position.y = roomHeight + 1.5;
    group.add(roof);

    const roomLight = new THREE.PointLight(0xffaa55, 0, 50, 1.5);
    roomLight.position.y = roomHeight / 2;
    group.add(roomLight);

    aviationLights.push({ type: 'room', light: roomLight, baseIntensity: 2.5 });

    buildPolygonRailing(group, radius, 2.0, 8, materials.steel);
    buildPolygonRailing(group, radius, 1.0, 8, materials.steel);

    parent.add(group);
}

function addDetailedMicrowaveDishes(parent, y, radius, count, size) {
    const dishMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7 });

    for (let i = 0; i < count; i++) {
        const angle = (i * Math.PI / 2) + (Math.random() * 0.4);
        const group = new THREE.Group();

        const drumGeo = new THREE.CylinderGeometry(size, size, size * 0.8, 24);
        const drum = new THREE.Mesh(drumGeo, backMat);
        drum.rotation.x = Math.PI / 2;

        const coverGeo = new THREE.SphereGeometry(size, 24, 16, 0, Math.PI * 2, 0, Math.PI / 4);
        const cover = new THREE.Mesh(coverGeo, dishMat);
        cover.position.z = size * 0.4 - 0.2;
        cover.rotation.x = Math.PI / 2;

        group.add(drum); group.add(cover);

        const dist = radius + (size * 0.4) + 1;
        group.position.set(dist * Math.cos(angle), y, dist * Math.sin(angle));
        group.lookAt(new THREE.Vector3(group.position.x * 2, group.position.y, group.position.z * 2));

        parent.add(group);
    }
}

function addPanelAntennas(parent, yStart, height, bottomWidth, topWidth, material) {
    const panelCount = 3;
    const panelWidth = 1.5, panelHeight = height * 0.8, panelDepth = 0.5;
    const panelGeo = new THREE.BoxGeometry(panelWidth, panelHeight, panelDepth);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.9 });

    for (let face = 0; face < 4; face++) {
        const faceAngle = face * Math.PI / 2;
        for (let p = 0; p < panelCount; p++) {
            const group = new THREE.Group();
            const panel = new THREE.Mesh(panelGeo, panelMat);
            group.add(panel);

            const avgW = ((bottomWidth + topWidth) / 2) / 2;
            const faceDist = avgW * 1.414;
            const offset = (p - (panelCount - 1) / 2) * (panelWidth + 0.5);

            group.position.set(offset, yStart + height / 2, faceDist + 1);

            const pivot = new THREE.Group();
            pivot.add(group);
            pivot.rotation.y = faceAngle;
            parent.add(pivot);
        }
    }
}

function addHighlyDetailedBandedMast(parent, yStart, height, radius, materials) {
    const group = new THREE.Group();
    group.position.y = yStart;

    const segments = 9;
    const segHeight = height / segments;

    for (let i = 0; i < segments; i++) {
        const isRed = (segments - 1 - i) % 2 === 0;
        const mat = isRed ? materials.red : materials.white;

        const rBot = radius - (i * radius * 0.06);
        const rTop = radius - ((i + 1) * radius * 0.06);

        const geo = new THREE.CylinderGeometry(rTop, rBot, segHeight, 16);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = (i * segHeight) + (segHeight / 2);
        group.add(mesh);
    }

    const lightningRod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 5), materials.steel);
    lightningRod.position.y = height + 2.5;
    group.add(lightningRod);

    parent.add(group);
}

function addAviationBeacon(parent, y, aviationLights) {
    const group = new THREE.Group();
    group.position.y = y;

    const casing = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.5, 12), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    group.add(casing);

    const lensMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.9 });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 12), lensMat);
    lens.position.y = 0.5;
    group.add(lens);

    const light = new THREE.PointLight(0xff0000, 0, 300, 2);
    light.position.y = 0.5;
    group.add(light);

    parent.add(group);

    aviationLights.push({ type: 'beacon', lens: lensMat, light, flashColor: 0xffdddd });
}

function addPlatformMarkerLights(parent, y, radius, aviationLights) {
    for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI / 2);
        const lx = (radius - 0.5) * Math.cos(angle);
        const lz = (radius - 0.5) * Math.sin(angle);

        const group = new THREE.Group();
        group.position.set(lx, y + 2.5, lz);

        const lensMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), lensMat);
        group.add(lens);

        const light = new THREE.PointLight(0xff0000, 0, 80, 1.5);
        group.add(light);

        parent.add(group);

        aviationLights.push({ type: 'marker', lens: lensMat, light, baseColor: 0xff0000 });
    }
}

function addLatticeMarkerLights(parent, y, width, aviationLights) {
    for (let i = 0; i < 2; i++) {
        const angle = (i * Math.PI) + Math.PI / 4;
        const dist = (width / 2) * 1.414 + 1;

        const group = new THREE.Group();
        group.position.set(dist * Math.cos(angle), y, dist * Math.sin(angle));

        const lensMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), lensMat);
        group.add(lens);

        const light = new THREE.PointLight(0xff0000, 0, 100, 1.5);
        group.add(light);

        parent.add(group);

        aviationLights.push({ type: 'marker', lens: lensMat, light, baseColor: 0xff0000 });
    }
}

export function createRadioTower(state) {
    const anchor = findTowerAnchor();
    TOWER_X = anchor.x; TOWER_Z = anchor.z;

    const towerGroup = new THREE.Group();
    const aviationLights = [];

    const rustTex = createProceduralTexture('#8b3a30', '#4a1c14', 12000, true);
    const dirtWhiteTex = createProceduralTexture('#c0c0c0', '#777777', 8000, false);
    const rustSteelTex = createProceduralTexture('#5a5d60', '#2a2c24', 10000, true);

    const materials = {
        red: new THREE.MeshStandardMaterial({ map: rustTex, metalness: 0.1, roughness: 0.9, side: THREE.DoubleSide, fog: true }),
        white: new THREE.MeshStandardMaterial({ map: dirtWhiteTex, metalness: 0.1, roughness: 0.95, side: THREE.DoubleSide, fog: true }),
        steel: new THREE.MeshStandardMaterial({ map: rustSteelTex, metalness: 0.6, roughness: 0.7, fog: true }),
    };

    let currentHeight = 0;
    const scaleFactor = 1.2;

    const baseW = 40, w1 = 30, h1 = 60 * scaleFactor;
    createComplexLattice(towerGroup, currentHeight, h1, baseW, w1, materials.white, 4, true);
    currentHeight += h1;

    const w2 = 24, h2 = 45 * scaleFactor;
    createComplexLattice(towerGroup, currentHeight, h2, w1, w2, materials.red, 3, true);
    currentHeight += h2;

    addDetailedPlatform(towerGroup, currentHeight, w2 + 8, materials.steel, 6);

    const w3 = 20, h3 = 35 * scaleFactor;
    createComplexLattice(towerGroup, currentHeight, h3, w2, w3, materials.white, 2, false);
    currentHeight += h3;

    addDetailedPlatform(towerGroup, currentHeight, w3 + 15, materials.steel, 8);
    addDetailedMicrowaveDishes(towerGroup, currentHeight - 5, (w3 + 15) / 2, 3, 4.5);
    addDetailedMicrowaveDishes(towerGroup, currentHeight - 15, (w3 + 10) / 2, 2, 3);

    const w4 = 14, h4 = 50 * scaleFactor;
    createComplexLattice(towerGroup, currentHeight, h4, w3, w4, materials.red, 4, true);
    currentHeight += h4;

    addDetailedPlatform(towerGroup, currentHeight, w4 + 12, materials.steel, 8);

    const w5 = 10, h5 = 40 * scaleFactor;
    createComplexLattice(towerGroup, currentHeight, h5, w4, w5, materials.white, 4, true);
    createInnerCore(towerGroup, currentHeight, h5, 3, materials.steel);
    currentHeight += h5;

    addControlRoom(towerGroup, currentHeight, w5 + 10, materials, aviationLights);

    const w6 = 6, h6 = 30 * scaleFactor;
    createComplexLattice(towerGroup, currentHeight, h6, w5, w6, materials.steel, 3, false);
    addPanelAntennas(towerGroup, currentHeight, h6, w5, w6, materials.white);
    currentHeight += h6;

    const mastH = 80 * scaleFactor, mastR = 1.8;
    addHighlyDetailedBandedMast(towerGroup, currentHeight, mastH, mastR, materials);

    const topHeight = currentHeight + mastH;
    addAviationBeacon(towerGroup, topHeight, aviationLights);
    addAviationBeacon(towerGroup, currentHeight + (mastH * 0.7), aviationLights);
    addAviationBeacon(towerGroup, currentHeight + (mastH * 0.35), aviationLights);

    addPlatformMarkerLights(towerGroup, currentHeight, (w5 + 10) / 2, aviationLights);
    addPlatformMarkerLights(towerGroup, currentHeight - h5 - h4, (w3 + 15) / 2, aviationLights);
    addLatticeMarkerLights(towerGroup, h1 + (h2 / 2), (w1 + w2) / 2, aviationLights);

    towerGroup.position.set(TOWER_X, getElevation(TOWER_X, TOWER_Z), TOWER_Z);
    towerGroup.renderOrder = -9; // just in front of mountain-boundary.js's -10 rings, behind normal scene geo
    state.scene.add(towerGroup);

    state.colliders.push({ x: TOWER_X, z: TOWER_Z, r: TOWER_COLLIDER_RADIUS });

    state.radioTowerGroup = towerGroup;
    state.radioTowerLights = aviationLights;
    state.radioTowerTopHeight = topHeight; // world-space Y offset of the mast tip above towerGroup's base, used by the awe cutscene's look-at target
}

// Called every frame from atmosphere/day-night-cycle.js. isNight is the
// same sun-height threshold the rest of that module uses (sy < 0) — no
// separate day/night state to keep in sync.
export function updateRadioTower(state, time, isNight) {
    if (!state.radioTowerLights) return;
    state.radioTowerLights.forEach((item) => {
        if (!isNight) {
            if (item.type === 'room') item.light.intensity = 0;
            else { item.lens.color.setHex(0x330000); item.light.intensity = 0; }
        } else {
            if (item.type === 'beacon') {
                const pulseCycle = time % 1.5;
                if (pulseCycle < 0.1) { item.lens.color.setHex(item.flashColor); item.light.intensity = 8; }
                else { item.lens.color.setHex(0x660000); item.light.intensity = 0.2; }
            } else if (item.type === 'marker') {
                item.lens.color.setHex(item.baseColor);
                item.light.intensity = 2;
            } else if (item.type === 'room') {
                item.light.intensity = item.baseIntensity;
            }
        }
    });

    // Proximity check for the awe interaction below. Only sets the flag —
    // does not touch the #interact-prompt element directly, since
    // environment/animals.js's updateInteractPrompt() is the single place
    // that reconciles this against the animal-recruit prompt each frame
    // (both wanting to write the same element in the same frame was a real
    // bug during development: whichever ran second would blindly clear
    // whatever the other had just set).
    if (!state.player || state.cutsceneActive) { state.nearRadioTower = false; return; }
    const dist = Math.hypot(state.player.position.x - TOWER_X, state.player.position.z - TOWER_Z);
    state.nearRadioTower = dist < TOWER_INTERACT_RANGE;
}

function getCutsceneCaptionEl(state) {
    if (state.cutsceneCaptionEl === undefined) {
        state.cutsceneCaptionEl = document.getElementById('cutscene-caption');
    }
    return state.cutsceneCaptionEl;
}

// E near the tower — starts the scripted "look up in awe" sequence.
// core/input.js checks state.nearRadioTower ahead of the animal-recruit
// interaction, so this takes priority if a player somehow triggers both
// ranges at once (shouldn't normally happen given TOWER_INTERACT_RANGE vs
// RECRUIT_RANGE, but the priority is explicit rather than accidental).
export function attemptTowerInteraction(state) {
    if (!state.nearRadioTower || state.cutsceneActive || !state.radioTowerGroup) return;

    state.cutsceneActive = true;
    state.cutsceneTimer = 0;
    state.cutsceneStartRotX = state.player.rotation.x;
    state.cutsceneStartRotY = state.player.rotation.y;
    // Snapshot which movement keys are already held the instant the
    // cutscene starts — the player very likely walked up holding W, and is
    // probably still holding it the moment they press E. Without this, the
    // "any movement key skips the cutscene" check below would fire on
    // frame one every single time and the cutscene would never actually
    // play. Only a key that transitions from *not* held at start to held
    // during the cutscene counts as a real skip request. (Releasing and
    // re-pressing the same originally-held key won't re-trigger a skip —
    // an acceptable gap given how rarely that sequence would happen.)
    state.cutsceneKeysHeldAtStart = { w: state.keys.w, a: state.keys.a, s: state.keys.s, d: state.keys.d };

    // Look-at target: the mast tip, from the player's current position.
    const topWorldY = state.radioTowerGroup.position.y + state.radioTowerTopHeight;
    const dx = TOWER_X - state.player.position.x;
    const dz = TOWER_Z - state.player.position.z;
    const dy = topWorldY - state.player.position.y;
    const horizDist = Math.hypot(dx, dz);
    state.cutsceneTargetRotY = Math.atan2(-dx, -dz); // matches the yaw convention player.rotation.y already uses (see core/input.js mousemove)
    // Pitch: Three.js's YXZ-order forward vector has forward.y = sin(x), so
    // the target pitch is exactly atan2(vertical, horizontal) with no extra
    // sign flip — dy > 0 (tower top above player) must give a *positive*
    // rotation.x to look up, matching how core/input.js's mousemove handler
    // already treats +x as "looking up".
    state.cutsceneTargetRotX = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, Math.atan2(dy, horizDist)));

    const el = getCutsceneCaptionEl(state);
    if (el) { el.textContent = ''; el.classList.add('visible'); }
}

// Called every frame from atmosphere/day-night-cycle.js, same as
// updateRadioTower. Drives player.rotation directly while active;
// core/player-controller.js freezes ordinary movement/mouse-look input for
// the duration (see state.cutsceneActive there) so the two don't fight over
// the same rotation values.
const CUTSCENE_LINES = [
    "Kat stops walking without meaning to.",
    "Whatever this is, it wasn't built for someone Kat's size.",
];

export function updateTowerCutscene(state, dt) {
    if (!state.cutsceneActive) return;

    // Early skip: a NEW movement keypress (one not already held at
    // cutscene start, see cutsceneKeysHeldAtStart above) ends it
    // immediately, easing out from wherever the look currently is rather
    // than snapping. (Escape doesn't need separate handling here — it
    // already exits pointer lock via the existing pointerlockchange
    // listener in core/input.js, which pauses the game entirely; this
    // cutscene keeps advancing underneath that, same as it would if the
    // player alt-tabbed mid-sequence.)
    const held = state.cutsceneKeysHeldAtStart || {};
    const skipRequested =
        (state.keys.w && !held.w) || (state.keys.a && !held.a) ||
        (state.keys.s && !held.s) || (state.keys.d && !held.d);
    if (skipRequested && state.cutsceneTimer < CUTSCENE_EASE_IN + CUTSCENE_HOLD) {
        state.cutsceneTimer = CUTSCENE_EASE_IN + CUTSCENE_HOLD; // jump straight to the ease-out leg
    }

    state.cutsceneTimer += dt;
    const el = getCutsceneCaptionEl(state);

    if (state.cutsceneTimer < CUTSCENE_EASE_IN) {
        const t = smoothstep(state.cutsceneTimer / CUTSCENE_EASE_IN);
        state.player.rotation.x = state.cutsceneStartRotX + (state.cutsceneTargetRotX - state.cutsceneStartRotX) * t;
        state.player.rotation.y = state.cutsceneStartRotY + (state.cutsceneTargetRotY - state.cutsceneStartRotY) * t;
        if (el && t > 0.5) { el.textContent = CUTSCENE_LINES[0]; el.classList.add('visible'); }
    } else if (state.cutsceneTimer < CUTSCENE_EASE_IN + CUTSCENE_HOLD) {
        state.player.rotation.x = state.cutsceneTargetRotX;
        state.player.rotation.y = state.cutsceneTargetRotY;
        const holdT = (state.cutsceneTimer - CUTSCENE_EASE_IN) / CUTSCENE_HOLD;
        if (el && holdT > 0.35) el.textContent = CUTSCENE_LINES[1];
    } else if (state.cutsceneTimer < CUTSCENE_TOTAL) {
        const t = smoothstep((state.cutsceneTimer - CUTSCENE_EASE_IN - CUTSCENE_HOLD) / CUTSCENE_EASE_OUT);
        state.player.rotation.x = state.cutsceneTargetRotX + (state.cutsceneStartRotX - state.cutsceneTargetRotX) * t;
        state.player.rotation.y = state.cutsceneTargetRotY + (state.cutsceneStartRotY - state.cutsceneTargetRotY) * t;
        if (el) el.classList.remove('visible');
    } else {
        state.cutsceneActive = false;
        if (el) { el.classList.remove('visible'); el.textContent = ''; }
    }
}
