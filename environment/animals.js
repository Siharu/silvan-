// Low-poly voxel-skin animal rigs — Kat, Shuu, Bimo, Primo — ported from
// the Bloodwoods reference build (Babylon.js) into Three.js. Same box/cone
// "skin panel" construction approach: a TransformNode-equivalent hierarchy
// (THREE.Group) of joints (body/head/jaw/ears/legs/tail), with individual
// boxes/cones parented onto each joint. Animation (walk/run/idle gait,
// blink cycle, ear physics) is a straight port of animateAnimalRig().
//
// This first pass just gets them INTO Silvan and visible/animated at a
// standstill-idle near spawn, so we can see how they read in this game's
// lighting/atmosphere — see spawnDemoAnimals(). Not yet wired to the
// confused-pet mechanic, follow AI, or dialogue — that's later work.

import * as THREE from 'three';
import { getElevation } from './terrain.js';
import { WORLD_SIZE } from '../core/world-state.js';

export const ANIMAL_CONFIGS = {
    Kat: {
        type: 'cat', scale: 0.70, earType: 'pointed',
        colors: { main: 0xE58624, dark: 0xC16410, belly: 0xFFF5E6, nose: 0xF49CAE, eye: 0x64D656, pupil: 0x1A1A1A, paw: 0xFFFFFF }
    },
    Shuu: {
        type: 'cat', scale: 0.45, earType: 'wide_pointed',
        colors: { main: 0x1E1E24, dark: 0x121216, belly: 0xFFFFFF, nose: 0xF49CAE, eye: 0xF4D03F, pupil: 0x1A1A1A, paw: 0xFFFFFF }
    },
    Bimo: {
        type: 'dog', scale: 1.15, earType: 'upright',
        colors: { main: 0xDAA520, dark: 0xB8860B, belly: 0xFFF8DC, nose: 0x1A1A1A, eye: 0x5C3A21, pupil: 0x000000, paw: 0xFFF8DC }
    },
    Primo: {
        type: 'dog', scale: 1.25, earType: 'floppy',
        colors: { main: 0xF0E68C, dark: 0xC2B280, belly: 0xFFFFFF, nose: 0x222222, eye: 0x3B6E8C, pupil: 0x000000, paw: 0xFFFFFF }
    }
};

// --- procedural speckled-noise skin texture, cached per color -------------
const _animalMatCache = {};
function getAnimalMaterial(hexColor, isEmissive) {
    const cacheKey = hexColor + (isEmissive ? '_glow' : '');
    if (_animalMatCache[cacheKey]) return _animalMatCache[cacheKey];

    const texSize = 32;
    const canvas = document.createElement('canvas');
    canvas.width = texSize; canvas.height = texSize;
    const ctx = canvas.getContext('2d');
    const base = new THREE.Color(hexColor);
    ctx.fillStyle = `#${base.getHexString()}`;
    ctx.fillRect(0, 0, texSize, texSize);
    for (let x = 0; x < texSize; x += 4) {
        for (let y = 0; y < texSize; y += 4) {
            if (Math.random() > 0.4) {
                const variance = (Math.random() - 0.5) * 0.12;
                const r = Math.max(0, Math.min(255, Math.floor((base.r + variance) * 255)));
                const g = Math.max(0, Math.min(255, Math.floor((base.g + variance) * 255)));
                const b = Math.max(0, Math.min(255, Math.floor((base.b + variance) * 255)));
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(x, y, 4, 4);
            }
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;

    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.02 });
    if (isEmissive) {
        mat.emissive = base;
        mat.emissiveIntensity = 1.0;
    }
    _animalMatCache[cacheKey] = mat;
    return mat;
}

// --- rig construction -------------------------------------------------
export function buildAnimalRig(name, config) {
    const root = new THREE.Group(); root.name = name + 'Root';
    const scale = config.scale;

    function createPart(type, partName, parent, width, height, depth, colorHex, posX = 0, posY = 0, posZ = 0) {
        let geo;
        if (type === 'box') {
            geo = new THREE.BoxGeometry(width * scale, height * scale, depth * scale);
        } else if (type === 'sphere') {
            geo = new THREE.SphereGeometry(0.5, 12, 8);
        } else if (type === 'cone') {
            geo = new THREE.ConeGeometry(width * scale * 0.5, height * scale, 8);
        }
        const isEmissive = partName.includes('Eye') || partName.includes('Pupil');
        const mesh = new THREE.Mesh(geo, getAnimalMaterial(colorHex, isEmissive));
        if (type === 'sphere') mesh.scale.set(width * scale, height * scale, depth * scale);
        mesh.position.set(posX * scale, posY * scale, posZ * scale);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (parent) parent.add(mesh);
        return mesh;
    }

    function createNode(partName, parent, posX = 0, posY = 0, posZ = 0) {
        const node = new THREE.Group(); node.name = name + '_' + partName;
        node.position.set(posX * scale, posY * scale, posZ * scale);
        if (parent) parent.add(node);
        return node;
    }

    const baseY = config.type === 'cat' ? 1.0 : 1.25;
    const body = createNode('body', root, 0, baseY, 0);

    createPart('box', 'bodyMesh', body, 1.2, 1.1, 2.1, config.colors.main, 0, 0, 0);
    createPart('box', 'bellySkin', body, 1.05, 0.4, 1.9, config.colors.belly, 0, -0.36, 0.05);
    createPart('box', 'backCoat', body, 1.22, 0.25, 1.6, config.colors.dark, 0, 0.43, -0.1);

    const headZ = config.type === 'cat' ? 1.0 : 1.2;
    const headY = 0.8;
    const head = createNode('head', body, 0, headY, headZ);

    const headW = config.type === 'cat' ? 1.3 : 1.25;
    const headH = config.type === 'cat' ? 1.1 : 1.15;
    const headD = config.type === 'cat' ? 1.1 : 1.2;
    createPart('box', 'headSkin', head, headW, headH, headD, config.colors.main, 0, 0, 0);

    const snoutW = config.type === 'cat' ? 0.65 : 0.75;
    const snoutH = config.type === 'cat' ? 0.4 : 0.5;
    const snoutD = config.type === 'cat' ? 0.4 : 0.7;
    const snoutZ = (headD / 2) + (snoutD / 2) - 0.02;
    createPart('box', 'snout', head, snoutW, snoutH, snoutD, config.colors.belly, 0, -0.18, snoutZ);

    const noseSize = config.type === 'cat' ? 0.18 : 0.22;
    createPart('box', 'noseTip', head, noseSize, noseSize * 0.7, noseSize, config.colors.nose, 0, 0.08, snoutZ + (snoutD / 2) + 0.01);

    const eyeSpacing = headW * 0.32;
    const eyeY = 0.15;
    const eyeZ = (headD / 2) + 0.02;

    const lEye = createPart('box', 'lEye', head, 0.22, 0.22, 0.05, config.colors.eye, -eyeSpacing, eyeY, eyeZ);
    const lPupil = createPart('box', 'lPupil', head, 0.1, 0.18, 0.06, config.colors.pupil, -eyeSpacing + 0.02, eyeY, eyeZ + 0.01);
    lEye.userData.baseScaleY = lEye.scale.y; lPupil.userData.baseScaleY = lPupil.scale.y;

    const rEye = createPart('box', 'rEye', head, 0.22, 0.22, 0.05, config.colors.eye, eyeSpacing, eyeY, eyeZ);
    const rPupil = createPart('box', 'rPupil', head, 0.1, 0.18, 0.06, config.colors.pupil, eyeSpacing - 0.02, eyeY, eyeZ + 0.01);
    rEye.userData.baseScaleY = rEye.scale.y; rPupil.userData.baseScaleY = rPupil.scale.y;

    const jaw = createNode('jaw', head, 0, -0.35, (headD / 2) - 0.05);
    createPart('box', 'jawSkin', jaw, snoutW * 0.9, 0.18, snoutD * 0.85, config.colors.belly, 0, -0.09, (snoutD / 2));

    const mouth = createNode('mouth', head, 0, -0.2, snoutZ + (snoutD / 2) - 0.08);

    const lEar = createNode('lEar', head, -headW * 0.35, headH * 0.5, 0);
    const rEar = createNode('rEar', head, headW * 0.35, headH * 0.5, 0);

    if (config.earType === 'pointed') {
        createPart('cone', 'lEarSkin', lEar, 0.3, 0.45, 0.25, config.colors.dark, 0, 0.22, 0);
        createPart('cone', 'rEarSkin', rEar, 0.3, 0.45, 0.25, config.colors.dark, 0, 0.22, 0);
    } else if (config.earType === 'wide_pointed') {
        lEar.position.x -= headW * 0.08;
        rEar.position.x += headW * 0.08;
        lEar.rotation.z = 0.3;
        rEar.rotation.z = -0.3;
        createPart('cone', 'lEarSkin', lEar, 0.3, 0.4, 0.25, config.colors.dark, 0, 0.2, 0);
        createPart('cone', 'rEarSkin', rEar, 0.3, 0.4, 0.25, config.colors.dark, 0, 0.2, 0);
    } else if (config.earType === 'upright') {
        createPart('cone', 'lEarSkin', lEar, 0.3, 0.55, 0.2, config.colors.dark, 0, 0.25, 0);
        createPart('cone', 'rEarSkin', rEar, 0.3, 0.55, 0.2, config.colors.dark, 0, 0.25, 0);
    } else if (config.earType === 'floppy') {
        createPart('box', 'lEarSkin', lEar, 0.2, 0.6, 0.3, config.colors.dark, -0.08, -0.2, 0);
        createPart('box', 'rEarSkin', rEar, 0.2, 0.6, 0.3, config.colors.dark, 0.08, -0.2, 0);
    }

    const legW = 0.32, legD = 0.32, legH = config.type === 'cat' ? 0.7 : 0.85;
    const legX = 0.4, legFZ = 0.7, legBZ = -0.7;
    const legY = -0.35;

    function buildLeg(legName, x, z) {
        const legNode = createNode(legName, body, x, legY, z);
        createPart('box', 'legSkin', legNode, legW, legH, legD, config.colors.main, 0, -legH / 2, 0);
        createPart('box', 'pawBoot', legNode, legW * 1.05, legH * 0.3, legD * 1.1, config.colors.paw, 0, -legH + (legH * 0.15), 0.02);
        return legNode;
    }

    const flLeg = buildLeg('flLeg', -legX, legFZ);
    const frLeg = buildLeg('frLeg', legX, legFZ);
    const blLeg = buildLeg('blLeg', -legX, legBZ);
    const brLeg = buildLeg('brLeg', legX, legBZ);

    const tail = createNode('tail', body, 0, 0.2, -1.05);
    if (config.type === 'cat') {
        createPart('box', 'tailBase', tail, 0.2, 0.6, 0.2, config.colors.main, 0, 0.25, -0.08);
        createPart('box', 'tailTip', tail, 0.22, 0.35, 0.22, config.colors.belly, 0, 0.65, -0.04);
    } else {
        createPart('box', 'tailBase', tail, 0.22, 0.22, 0.6, config.colors.main, 0, 0.08, -0.3);
        createPart('box', 'tailTip', tail, 0.24, 0.24, 0.25, config.colors.belly, 0, 0.08, -0.65);
    }

    return {
        name, root, body, head, jaw, lEar, rEar, flLeg, frLeg, blLeg, brLeg, tail, mouth,
        config, baseY: baseY * scale, lEye, rEye, lPupil, rPupil,
        animTime: 0, blinkTimer: undefined
    };
}

// --- animation: gait, blink cycle, ear physics -------------------------
// animState: 'idle' | 'walk' | 'run'
export function animateAnimalRig(rig, dt, animState) {
    rig.animTime += dt;
    const animTime = rig.animTime;
    let speed = 1, legRot = 0, bodyBob = 0, basePitch = 0;

    if (animState === 'idle') {
        speed = 2.5; legRot = 0.04;
        bodyBob = Math.sin(animTime * speed) * 0.02;
        rig.tail.rotation.x = Math.sin(animTime * 1.5) * 0.15;
        rig.tail.rotation.y = Math.sin(animTime * 2.0) * 0.25;
        rig.head.rotation.y = Math.sin(animTime * 0.6) * 0.04;
        basePitch = 0;
    } else if (animState === 'walk') {
        speed = 9; legRot = 0.5;
        bodyBob = Math.abs(Math.sin(animTime * speed)) * 0.06;
        rig.tail.rotation.y = Math.sin(animTime * speed * 0.5) * 0.35;
        rig.head.rotation.y = Math.sin(animTime * speed * 0.5) * 0.05;
        basePitch = 0.05;
    } else if (animState === 'run') {
        speed = 18; legRot = 0.95;
        bodyBob = Math.abs(Math.sin(animTime * speed)) * 0.14;
        rig.tail.rotation.y = Math.sin(animTime * speed * 0.5) * 0.5;
        rig.head.rotation.y = 0;
        basePitch = 0.15;
    }

    rig.head.rotation.x = basePitch + (rig.headPitchOffset || 0);

    if (rig.blinkTimer === undefined) {
        rig.blinkTimer = 2 + Math.random() * 4;
        rig.isBlinking = false;
        rig.blinkProgress = 0;
    }
    rig.blinkTimer -= dt;
    if (rig.blinkTimer <= 0) {
        rig.isBlinking = true;
        rig.blinkTimer = 2 + Math.random() * 4;
        rig.blinkProgress = 0;
    }

    if (rig.isBlinking) {
        rig.blinkProgress += dt * 15;
        let eyeScaleY = 1;
        if (rig.blinkProgress < 1) eyeScaleY = 1 - rig.blinkProgress;
        else if (rig.blinkProgress < 2) eyeScaleY = rig.blinkProgress - 1;
        else {
            rig.isBlinking = false;
            eyeScaleY = 1;
        }
        eyeScaleY = Math.max(0.05, eyeScaleY);
        if (rig.lEye && rig.rEye) {
            rig.lEye.scale.y = rig.lEye.userData.baseScaleY * eyeScaleY;
            rig.rEye.scale.y = rig.rEye.userData.baseScaleY * eyeScaleY;
            rig.lPupil.scale.y = rig.lPupil.userData.baseScaleY * eyeScaleY;
            rig.rPupil.scale.y = rig.rPupil.userData.baseScaleY * eyeScaleY;
        }
    }

    const phase = animTime * speed;
    if (animState === 'run') {
        rig.flLeg.rotation.x = Math.sin(phase) * legRot;
        rig.frLeg.rotation.x = Math.sin(phase + 0.3) * legRot;
        rig.blLeg.rotation.x = Math.sin(phase + Math.PI) * legRot;
        rig.brLeg.rotation.x = Math.sin(phase + Math.PI + 0.3) * legRot;
        rig.body.position.y = rig.baseY + bodyBob + (rig.crouchOffset || 0);
        rig.body.rotation.x = Math.sin(phase) * 0.08;
    } else {
        rig.flLeg.rotation.x = Math.sin(phase) * legRot;
        rig.brLeg.rotation.x = Math.sin(phase) * legRot;
        rig.frLeg.rotation.x = Math.sin(phase + Math.PI) * legRot;
        rig.blLeg.rotation.x = Math.sin(phase + Math.PI) * legRot;
        rig.body.position.y = rig.baseY + bodyBob + (rig.crouchOffset || 0);
        rig.body.rotation.x = 0;
    }

    if (rig.config.earType === 'upright') {
        let windTwitch = Math.sin(animTime * 4) * Math.cos(animTime * 7) * 0.12;
        let speedBend = (animState === 'run') ? -0.35 : ((animState === 'walk') ? -0.1 : 0);
        rig.lEar.rotation.x = speedBend + windTwitch;
        rig.lEar.rotation.z = windTwitch * 0.4;
        rig.rEar.rotation.x = speedBend + windTwitch;
        rig.rEar.rotation.z = -windTwitch * 0.4;
    } else if (rig.config.earType === 'floppy') {
        let bounce = (animState !== 'idle') ? Math.sin(animTime * speed) * 0.28 : Math.sin(animTime * 2) * 0.05;
        rig.lEar.rotation.z = bounce;
        rig.rEar.rotation.z = -bounce;
    } else {
        let catTwitch = Math.sin(animTime * 1.2) * 0.06;
        rig.lEar.rotation.x = catTwitch;
        rig.rEar.rotation.x = catTwitch;
    }
}

// Wander/recruit/follow AI — ported from the Bloodwoods reference build's
// createNPC/recruitChance/attemptRecruit/gameLoop wander+follow blocks
// (same rig code this whole file already comes from). Kat is the player
// character, not a companion — she's no longer spawned by
// spawnDemoAnimals() below at all. Her rig (same buildAnimalRig()/
// animateAnimalRig() this file exports) is built and driven directly by
// core/player-controller.js instead, following state.player.position each
// frame. Shuu/Bimo/Primo remain the recruitable wander/follow companions.
const WANDER_NAMES = ['Shuu', 'Bimo', 'Primo']; // also spawnDemoAnimals()'s full roster now that Kat's excluded — every companion wanders
const RECRUIT_RANGE = 3.2;
const _playerForward = new THREE.Vector3(); // reused in updateDemoAnimals every frame instead of allocated fresh

function getInteractPromptEl(state) {
    if (state.interactPromptEl === undefined) state.interactPromptEl = document.getElementById('interact-prompt');
    return state.interactPromptEl;
}

function setInteractPrompt(state, text, visible) {
    const el = getInteractPromptEl(state);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('visible', visible);
}

// The single place that decides what #interact-prompt actually shows each
// frame. Both this module (nearest animal) and environment/radio-tower.js
// (state.nearRadioTower) want the same DOM element, and originally each
// wrote to it independently from separate per-frame update functions —
// whichever ran second that frame would blindly clear or overwrite
// whatever the other had just set, causing the prompt to flicker or drop
// entirely depending on call order. Called once per frame, after both
// systems have updated their flags, with the tower taking priority on the
// rare frame a player is in range of both at once.
export function updateInteractPrompt(state) {
    if (state.cutsceneActive) return; // the cutscene owns #cutscene-caption instead, leave this alone
    if (state.interactPromptTimer) return; // a JOIN/NOT-THIS-TIME result message is still showing, don't stomp it
    if (state.nearRadioTower) {
        setInteractPrompt(state, '[E] LOOK AT THE TOWER', true);
    } else if (state.currentInteractableAnimal) {
        setInteractPrompt(state, `[E] APPROACH ${state.currentInteractableAnimal.toUpperCase()}`, true);
    } else {
        setInteractPrompt(state, '', false);
    }
}

// Silvan-side spawning/demo harness ---------------------------------
// Places all four named animals near a dry patch of shore so we can see
// how the rig/materials read in this game's lighting.
//
// BUG FIX: this used to anchor the spawn ring at world origin (0,0) with
// radius 6. Origin is the center of the lake basin carved in
// environment/terrain.js (a deliberate ~29-unit-deep bowl under the
// water plane at WATER_LEVEL=1.6) — so all four rigs were landing on the
// literal lake floor, ~27-30 units underwater. The player never notices
// the same basin because player-controller.js floats the camera at the
// water surface whenever isInWater is true; that correction only
// applies to the player, never to these rigs, which just take raw
// getElevation() at face value. Walking the anchor outward along +X
// until it clears the same y > ~2 dry-land threshold grass/flowers/
// forest already use (see grass.js/flowers.js/forest.js) puts them
// somewhere actually visible instead.
// swaps this back out for a real GROVE_CENTER once this project has a
// flattened building-site clearing concept of its own.
export function findDryAnchor(state) {
    for (let d = 20; d <= WORLD_SIZE * 0.5; d += 5) {
        const y = getElevation(d, 0, state);
        if (y > 3.0) return { x: d, z: 0 };
    }
    return { x: 180, z: 0 }; // fallback, shouldn't be hit
}

export function spawnDemoAnimals(state) {
    state.demoAnimals = [];
    const names = WANDER_NAMES;
    const radius = 6;
    // GROVE_CENTER doesn't exist in this rebuild (no flattened/tree-packed
    // grove concept ported over yet) — using findDryAnchor()'s "first dry
    // patch walking out from the lake" instead, same as this project's
    // pine-trees.js/rocks.js/grass.js already do for their own placement.
    const anchor = findDryAnchor(state);
    names.forEach((name, i) => {
        const angle = (i / names.length) * Math.PI * 2;
        const x = anchor.x + Math.cos(angle) * radius;
        const z = anchor.z + Math.sin(angle) * radius;
        const y = getElevation(x, z, state);

        const rig = buildAnimalRig(name, ANIMAL_CONFIGS[name]);
        rig.root.position.set(x, y, z);
        rig.root.rotation.y = -angle + Math.PI / 2; // face roughly toward the anchor center
        state.scene.add(rig.root);

        rig.hasAI = WANDER_NAMES.includes(name);
        if (rig.hasAI) {
            rig.homeX = x; rig.homeZ = z;
            rig.wanderTargetX = x; rig.wanderTargetZ = z;
            rig.wanderTimer = Math.random() * 3; // stagger so they don't all pick a new spot on the same frame
            rig.wanderRadius = 8;
            rig.speed = 1.1 * rig.config.scale;
            rig.followSpeed = rig.speed * 2.2;
            rig.following = false;
            rig.met = false;
            rig.visits = 0;
        }

        state.demoAnimals.push(rig);
    });
}

// E-to-recruit — ported from Bloodwoods' handleInteraction/attemptRecruit,
// minus the dialogue tree and coin-flip modal (Silvan doesn't have either
// yet); keeps the same odds and outcome text. Called from core/input.js on
// a raw KeyE edge-trigger, not per-frame, so holding E can't spam rolls.
export function attemptRecruitInteraction(state) {
    if (!state.demoAnimals || !state.currentInteractableAnimal) return;
    const rig = state.demoAnimals.find(r => r.name === state.currentInteractableAnimal);
    if (!rig || rig.following) return;

    // Dogs join at a flat 30% chance every time you ask. Shuu is warier of
    // the pack — if a dog is already following, her trust drops to 15%
    // until you either come back without one or she's already decided to
    // travel with you. Nothing here locks you out; you can keep asking.
    const dogFollowing = state.demoAnimals.some(r => r.config.type === 'dog' && r.following);
    const chance = (rig.config.type === 'cat') ? (dogFollowing ? 0.15 : 0.3) : 0.3;
    const success = Math.random() < chance;

    rig.visits++;
    rig.met = true;
    if (success) {
        rig.following = true;
        setInteractPrompt(state, `${rig.name.toUpperCase()} JOINS YOU`, true);
    } else {
        setInteractPrompt(state, 'NOT THIS TIME', true);
    }

    if (state.interactPromptTimer) clearTimeout(state.interactPromptTimer);
    state.interactPromptTimer = setTimeout(() => {
        state.interactPromptTimer = null;
        setInteractPrompt(state, '', false);
    }, 1200);
}

// Called every frame from main.js while the demo animals are present.
export function updateDemoAnimals(state, dt) {
    if (!state.demoAnimals) return;
    const player = state.player;
    let nearestDist = RECRUIT_RANGE;
    let nearestName = null;
    let followerIdx = 0;

    // Player forward vector, flattened — same source player-controller.js
    // uses for movement, so followers trail directly behind wherever the
    // camera is actually looking rather than off raw player.rotation.y.
    const forward = _playerForward;
    if (state.camera) { state.camera.getWorldDirection(forward); forward.y = 0; forward.normalize(); }

    for (const rig of state.demoAnimals) {
        if (!rig.hasAI) { animateAnimalRig(rig, dt, 'idle'); continue; }

        if (rig.following) {
            // Trail the player in a loose arc behind them rather than
            // stacking on top of one another — each follower gets a slot
            // angle spread behind the camera's facing direction.
            followerIdx++;
            const slotAngle = (followerIdx - 1) * 0.9 - 0.45;
            const behindX = -forward.x, behindZ = -forward.z;
            const sidewaysX = -behindZ, sidewaysZ = behindX;
            const targetX = player.position.x + behindX * 2.4 + sidewaysX * slotAngle * 1.4;
            const targetZ = player.position.z + behindZ * 2.4 + sidewaysZ * slotAngle * 1.4;

            const toX = targetX - rig.root.position.x;
            const toZ = targetZ - rig.root.position.z;
            const distToTarget = Math.hypot(toX, toZ);
            const moving = distToTarget > 0.4;
            if (moving) {
                const nx = toX / distToTarget, nz = toZ / distToTarget;
                const catchUp = distToTarget > 6 ? rig.followSpeed * 2 : rig.followSpeed;
                rig.root.position.x += nx * catchUp * dt;
                rig.root.position.z += nz * catchUp * dt;
                rig.root.rotation.y = Math.atan2(nx, nz);
            }
            rig.root.position.y = getElevation(rig.root.position.x, rig.root.position.z, state);
            animateAnimalRig(rig, dt, moving ? (distToTarget > 6 ? 'run' : 'walk') : 'idle');
            continue;
        }

        // Not recruited: wanders in loose loops around its own spawn point
        // — picks a new nearby spot every few seconds and ambles toward
        // it, no urgency, no destination that actually matters.
        rig.wanderTimer -= dt;
        if (rig.wanderTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 2 + Math.random() * rig.wanderRadius;
            rig.wanderTargetX = rig.homeX + Math.cos(angle) * dist;
            rig.wanderTargetZ = rig.homeZ + Math.sin(angle) * dist;
            rig.wanderTimer = 2.5 + Math.random() * 3;
        }
        const toX = rig.wanderTargetX - rig.root.position.x;
        const toZ = rig.wanderTargetZ - rig.root.position.z;
        const distToTarget = Math.hypot(toX, toZ);
        const moving = distToTarget > 0.3;
        if (moving) {
            const nx = toX / distToTarget, nz = toZ / distToTarget;
            rig.root.position.x += nx * rig.speed * dt;
            rig.root.position.z += nz * rig.speed * dt;
            rig.root.rotation.y = Math.atan2(nx, nz);
        }
        rig.root.position.y = getElevation(rig.root.position.x, rig.root.position.z, state);
        animateAnimalRig(rig, dt, moving ? 'walk' : 'idle');

        const dPlayer = Math.hypot(player.position.x - rig.root.position.x, player.position.z - rig.root.position.z);
        if (dPlayer < nearestDist) { nearestDist = dPlayer; nearestName = rig.name; }
    }

    state.currentInteractableAnimal = nearestName;
    // Prompt display itself is decided by updateInteractPrompt() (above),
    // called once per frame after this and environment/radio-tower.js's
    // proximity check have both run — see that function for why.
}