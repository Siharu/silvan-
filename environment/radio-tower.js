// WNCORE radio tower — ported from the standalone radio.html lattice-tower
// build (same procedural-strut construction: createComplexLattice/
// createDetailedStrut/addDetailedPlatform/etc, verbatim geometry) into a
// single static structure planted far out near the world edge, past where
// the player can walk (see BOUNDARY_RADIUS in core/player-controller.js) —
// same "seen, not reached" treatment environment/mountain-boundary.js uses
// for the horizon ring. Day/night toggle, orbit camera, and free-fly
// controls from the source file are gone; only the tower geometry + the
// aviation-beacon/marker-light blink survive, driven by this game's own
// atmosphere state (state.currentSunHeight, set per-frame in
// atmosphere/day-night-cycle.js) instead of a manual isNight toggle.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { getElevation } from './terrain.js';

// Roughly centered on the world's far edge, opposite the lake/spawn side —
// placed just past BOUNDARY_RADIUS (core/player-controller.js clamps the
// player to WORLD_SIZE/2 = 575) so it's genuinely unreachable, same "seen,
// not walked to" treatment as the mountain-boundary ring, which sits just
// beyond it at 0.54-0.62. Tall enough (~340 units incl. mast) to read as a
// silhouette over that ring from spawn, faded by scene.fog like everything
// else out there.
const TOWER_X = 0;
const TOWER_Z = -(WORLD_SIZE * 0.52);

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

    state.radioTowerGroup = towerGroup;
    state.radioTowerLights = aviationLights;
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
}
