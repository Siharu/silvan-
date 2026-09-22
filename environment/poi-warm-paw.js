// The Warm Paw (campfire) — ported from
// reference-assets/no_2_the_warm_paw_campfire.html. Much larger than the
// name suggests, per PLAN.md: a fenced sanctuary compound around a
// central campfire — stone ring, log stack + ash/coal/twig debris,
// cooking tripod + pot, two benches, two stumps, a sleeping bed, a
// candle-lit lantern, a ring of 6 torches, a closed palisade gate, and
// paw prints leading up to the camp. All billboarded fire/ember/firefly
// particles face the player camera and flicker per-frame — see
// updateWarmPaw(), wired the same way as Radio Tower/Howling Maw's
// `update` field.
//
// Dropped from the port, same reasoning as the other two large POIs:
// the mockup's own terrain/ground plane (this map has its own terrain),
// its canvas-generated stone/wood grain textures (flat colors used
// instead, matching how the other ported POIs — Chrysalis, Ruined
// Cabin, Obsidian Wing — already do this in this project), and the
// click-to-open gate interaction (no raycaster/UI-button wiring exists
// in this game — the gate is built permanently ajar instead, so the
// compound still reads as open/inviting rather than sealed shut).
import * as THREE from 'three';
import { state } from '../core/state.js';

const rand = (min, max) => Math.random() * (max - min) + min;

const FIRE_COLOR = 0xf97316;
const FIRE_INTENSITY_BASE = 1.8;
const FIRE_RANGE = 15;
const EMBER_COUNT = 40;
const FENCE_RADIUS = 9.5;

function noise(time) {
    return Math.sin(time * 12.34) * Math.cos(time * 34.12) * Math.sin(time * 56.78);
}

function createFireTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    if (type === 'blue') {
        gradient.addColorStop(0.2, 'rgba(100, 200, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(0, 100, 255, 0.4)');
    } else {
        gradient.addColorStop(0.2, 'rgba(255, 200, 50, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.4)');
    }
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

function createGlowSprite(size, inner, mid) {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.3, mid);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

function createDotSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(8, 8, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
}

// Per-instance animated state, reset each createWarmPaw() call.
let flickerLights = [];
let fireParticles = [];
let embers = [];
let emberSystem = null;
let fireflies = [];
let lanternCandleFlameMesh = null;
let texOrange = null;
let texBlue = null;
let colorOrange = null;
let colorBlue = null;
let elapsed = 0;

function resetFireParticle(particle, baseScale) {
    particle.position.set(rand(-0.2, 0.2) * baseScale, 0, rand(-0.2, 0.2) * baseScale);
    particle.material.opacity = 1.0;
}

function createFireSystem(parentGroup, count, baseScale, isTorch = false) {
    const particleGeo = new THREE.PlaneGeometry(1, 1);
    const particleMat = new THREE.MeshBasicMaterial({
        map: texOrange,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    for (let i = 0; i < count; i++) {
        const particle = new THREE.Mesh(particleGeo, particleMat.clone());
        resetFireParticle(particle, baseScale);
        particle.position.y = rand(0, 1.0) * baseScale;
        parentGroup.add(particle);

        fireParticles.push({
            mesh: particle,
            life: rand(0, 1),
            speed: rand(1.5, 3.0),
            scaleBase: rand(0.5, 1.2) * baseScale,
            swayFreq: rand(2, 5),
            swayAmp: rand(0.1, 0.3) * baseScale,
            baseScale,
            isTorch
        });
    }
}

export function createWarmPaw(x, y, z) {
    flickerLights = [];
    fireParticles = [];
    embers = [];
    fireflies = [];
    lanternCandleFlameMesh = null;
    elapsed = 0;

    texOrange = createFireTexture('orange');
    texBlue = createFireTexture('blue');
    colorOrange = new THREE.Color(FIRE_COLOR);
    colorBlue = new THREE.Color(0x33aaff);

    const group = new THREE.Group();
    const campfireGroup = new THREE.Group();
    group.add(campfireGroup);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 0.9, metalness: 0.1 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1.0, metalness: 0.05 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.7, metalness: 0.6 });

    // Paw prints leading up to camp
    function createPawPrint(px, pz, rotation) {
        const pawGroup = new THREE.Group();
        const padMaterial = new THREE.MeshBasicMaterial({ color: 0x08080a, transparent: true, opacity: 0.65, depthWrite: false });

        const mainPad = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), padMaterial);
        mainPad.rotation.x = -Math.PI / 2;
        mainPad.scale.y = 0.8;
        pawGroup.add(mainPad);

        const toeGeo = new THREE.CircleGeometry(0.06, 12);
        [{ x: -0.15, z: -0.15 }, { x: -0.05, z: -0.22 }, { x: 0.05, z: -0.22 }, { x: 0.15, z: -0.15 }].forEach(pos => {
            const toe = new THREE.Mesh(toeGeo, padMaterial);
            toe.rotation.x = -Math.PI / 2;
            toe.position.set(pos.x, 0, pos.z);
            toe.scale.y = 1.2;
            pawGroup.add(toe);
        });

        pawGroup.position.set(px, 0.01, pz);
        pawGroup.rotation.y = rotation;
        return pawGroup;
    }
    [[3.2, 7.8, 0.8], [2.6, 6.4, 0.82], [2.1, 4.8, 0.85], [1.5, 3.2, 0.88], [0.8, 1.8, 0.9]].forEach(([px, pz, r]) => {
        group.add(createPawPrint(px, pz, Math.PI * r));
    });

    // Stone ring
    const stoneGeo = new THREE.DodecahedronGeometry(1);
    const stoneCount = 10;
    const stoneRadius = 1.5;
    for (let i = 0; i < stoneCount; i++) {
        const angle = (i * (Math.PI * 2 / stoneCount)) + rand(-0.2, 0.2);
        const stone = new THREE.Mesh(stoneGeo, stoneMat);
        const radius = stoneRadius + rand(-0.1, 0.15);
        stone.position.x = Math.cos(angle) * radius;
        stone.position.z = Math.sin(angle) * radius;
        const scale = rand(0.25, 0.45);
        stone.scale.set(scale * rand(0.8, 1.2), scale * rand(0.6, 1.0), scale * rand(0.8, 1.2));
        stone.position.y = stone.scale.y * 0.4;
        stone.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
        campfireGroup.add(stone);
    }

    // Top log stack
    const logGeo = new THREE.CylinderGeometry(0.12, 0.15, 1.2, 8);
    const logCount = 4;
    for (let i = 0; i < logCount; i++) {
        const log = new THREE.Mesh(logGeo, woodMat);
        const angle = (i / logCount) * Math.PI * 2 + rand(-0.2, 0.2);
        log.position.x = Math.cos(angle) * 0.4;
        log.position.z = Math.sin(angle) * 0.4;
        log.position.y = 0.5;
        log.lookAt(0, 1.0, 0);
        log.rotateX(Math.PI / 2);
        campfireGroup.add(log);
    }

    // Campfire debris: ash bed, base logs, coals, twigs, wood chips
    const ashBed = new THREE.Mesh(
        new THREE.CircleGeometry(1.3, 16),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1.0, transparent: true, opacity: 0.85, depthWrite: false })
    );
    ashBed.rotation.x = -Math.PI / 2;
    ashBed.position.y = 0.02;
    campfireGroup.add(ashBed);

    const baseLogGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.9, 7);
    for (let i = 0; i < 4; i++) {
        const baseLog = new THREE.Mesh(baseLogGeo, woodMat);
        const angle = (i / 4) * Math.PI * 2 + rand(0.1, 0.5);
        const dist = rand(0.2, 0.5);
        baseLog.position.set(Math.cos(angle) * dist, 0.06, Math.sin(angle) * dist);
        baseLog.rotation.set(Math.PI / 2 + rand(-0.1, 0.1), rand(0, Math.PI * 2), rand(-0.2, 0.2));
        campfireGroup.add(baseLog);
    }

    const coalGeo = new THREE.DodecahedronGeometry(1);
    const coalMat = new THREE.MeshStandardMaterial({ color: 0x1a0f0a, roughness: 1.0, metalness: 0.05 });
    for (let i = 0; i < 50; i++) {
        const coal = new THREE.Mesh(coalGeo, coalMat);
        const radius = rand(0.08, 0.95);
        const angle = rand(0, Math.PI * 2);
        coal.position.set(Math.cos(angle) * radius, rand(0.02, 0.15), Math.sin(angle) * radius);
        const scale = rand(0.05, 0.18);
        coal.scale.set(scale, scale * rand(0.6, 1.2), scale * rand(0.8, 1.2));
        coal.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
        campfireGroup.add(coal);
    }

    const twigGeo = new THREE.CylinderGeometry(0.018, 0.03, 1, 5);
    for (let i = 0; i < 28; i++) {
        const twig = new THREE.Mesh(twigGeo, woodMat);
        const radius = rand(0.25, 1.25);
        const angle = rand(0, Math.PI * 2);
        twig.scale.y = rand(0.25, 0.85);
        twig.position.set(Math.cos(angle) * radius, rand(0.03, 0.12), Math.sin(angle) * radius);
        twig.rotation.set(Math.PI / 2 + rand(-0.25, 0.25), rand(0, Math.PI * 2), rand(-0.25, 0.25));
        campfireGroup.add(twig);
    }

    const chipGeo = new THREE.BoxGeometry(0.12, 0.02, 0.08);
    const chipMat = new THREE.MeshStandardMaterial({ color: 0x18100c, roughness: 0.95 });
    for (let i = 0; i < 20; i++) {
        const chip = new THREE.Mesh(chipGeo, chipMat);
        const radius = rand(0.3, 1.1);
        const angle = rand(0, Math.PI * 2);
        chip.position.set(Math.cos(angle) * radius, rand(0.02, 0.06), Math.sin(angle) * radius);
        chip.rotation.set(rand(-0.2, 0.2), rand(0, Math.PI * 2), rand(-0.2, 0.2));
        chip.scale.set(rand(0.7, 1.5), 1, rand(0.7, 1.5));
        campfireGroup.add(chip);
    }

    // Central fire (billboard particles, animated in updateWarmPaw)
    const fireGroup = new THREE.Group();
    fireGroup.position.y = 0.2;
    campfireGroup.add(fireGroup);
    createFireSystem(fireGroup, 15, 1.0);

    // Cooking tripod + pot, benches, stumps, bed, lantern
    const tripodGroup = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 3.8, 6);
    for (let i = 0; i < 3; i++) {
        const pole = new THREE.Mesh(poleGeo, woodMat);
        const angle = (i / 3) * Math.PI * 2;
        pole.position.set(Math.cos(angle) * 1.2, 1.7, Math.sin(angle) * 1.2);
        pole.lookAt(0, 3.2, 0);
        pole.rotateX(Math.PI / 2);
        tripodGroup.add(pole);
    }
    const potGroup = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 16, 0, Math.PI * 2, Math.PI * 0.25, Math.PI), ironMat);
    potGroup.add(pot);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.02, 6, 16, Math.PI), ironMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.y = 0.3;
    potGroup.add(handle);
    const liquid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 0.05, 16),
        new THREE.MeshStandardMaterial({ color: 0x5a2a18, roughness: 0.3 })
    );
    liquid.position.set(0, 0.05, 0);
    potGroup.add(liquid);
    potGroup.position.set(0, 1.6, 0);
    tripodGroup.add(potGroup);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.45), ironMat);
    chain.position.set(0, 2.5, 0);
    tripodGroup.add(chain);
    campfireGroup.add(tripodGroup);

    function createBench(bx, bz, rot) {
        const benchGroup = new THREE.Group();
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.8, 8), woodMat);
        log.rotation.z = Math.PI / 2;
        log.position.y = 0.4;
        benchGroup.add(log);
        const supportGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.4, 6);
        const s1 = new THREE.Mesh(supportGeo, woodMat);
        s1.position.set(-0.6, 0.2, 0);
        benchGroup.add(s1);
        const s2 = new THREE.Mesh(supportGeo, woodMat);
        s2.position.set(0.6, 0.2, 0);
        benchGroup.add(s2);
        benchGroup.position.set(bx, 0, bz);
        benchGroup.rotation.y = rot;
        return benchGroup;
    }
    group.add(createBench(-2.8, -1.5, Math.PI / 3));
    group.add(createBench(-1.5, -2.8, -Math.PI / 6));

    const stumpGeo = new THREE.CylinderGeometry(0.25, 0.3, 0.7, 8);
    const stump1 = new THREE.Mesh(stumpGeo, woodMat);
    stump1.position.set(2.5, 0.35, -2.0);
    stump1.rotation.set(0.1, rand(0, Math.PI), -0.05);
    group.add(stump1);
    const stump2 = new THREE.Mesh(stumpGeo, woodMat);
    stump2.position.set(3.2, 0.35, -1.0);
    stump2.rotation.set(-0.05, rand(0, Math.PI), 0.1);
    group.add(stump2);

    const bedGroup = new THREE.Group();
    const blanket = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.06, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x8b3a3a, roughness: 0.9 })
    );
    blanket.position.y = 0.03;
    bedGroup.add(blanket);
    const pillow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 1.2, 8),
        new THREE.MeshStandardMaterial({ color: 0xd2c3b3, roughness: 0.9 })
    );
    pillow.rotation.z = Math.PI / 2;
    pillow.position.set(0, 0.15, -0.9);
    bedGroup.add(pillow);
    bedGroup.position.set(0, 0, 3.5);
    bedGroup.rotation.y = Math.PI * 0.15;
    group.add(bedGroup);

    // Lantern with a billboarded candle flame
    const lanternGroup = new THREE.Group();
    const lBase = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.11, 0.04, 8), ironMat);
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.1, transmission: 0.9, thickness: 0.05, ior: 1.5, transparent: true });
    const lGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8), glassMat);
    lGlass.position.y = 0.13;
    const candle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.02, 0.07, 8),
        new THREE.MeshStandardMaterial({ color: 0xffeebb, roughness: 0.6 })
    );
    candle.position.y = 0.055;
    lanternGroup.add(candle);
    const cWick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.002, 0.002, 0.02, 4),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    cWick.position.y = 0.095;
    lanternGroup.add(cWick);
    const cFlameMat = new THREE.MeshBasicMaterial({ map: texOrange, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    lanternCandleFlameMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), cFlameMat);
    lanternCandleFlameMesh.position.y = 0.115;
    lanternGroup.add(lanternCandleFlameMesh);
    const lTop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.06, 8), ironMat);
    lTop.position.y = 0.26;
    const lCap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.04, 8), ironMat);
    lCap.position.y = 0.31;
    const lRing = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 4, 8), ironMat);
    lRing.position.y = 0.35;
    lanternGroup.add(lBase, lGlass, lTop, lCap, lRing);
    const lanternLight = new THREE.PointLight(0xffdd88, 0.6, 4);
    lanternLight.position.y = 0.13;
    lanternGroup.add(lanternLight);
    flickerLights.push({ light: lanternLight, baseInt: 0.6, jitterSpeed: 4.5, isMain: false, isTorch: false, flare: 0 });
    lanternGroup.position.set(2.5, 0.72, -2.0);
    group.add(lanternGroup);

    // Ring of torches
    const torchCount = 6;
    const torchRadius = 6.5;
    const shroudMat = new THREE.MeshStandardMaterial({ color: 0x1f1a14, roughness: 0.95, metalness: 0.1 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x3d352e, roughness: 0.5, metalness: 0.7 });
    const wickMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 1.0 });
    const darkRockMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1.0, metalness: 0.1 });
    const rockGeo = new THREE.DodecahedronGeometry(0.25);
    const tPoleGeo = new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6);
    const shroudGeo = new THREE.CylinderGeometry(0.1, 0.075, 0.28, 8);
    const bandGeo = new THREE.TorusGeometry(0.082, 0.012, 6, 12);
    const wickGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.18, 6);

    for (let i = 0; i < torchCount; i++) {
        const angle = (i / torchCount) * Math.PI * 2;
        const tx = Math.cos(angle) * torchRadius;
        const tz = Math.sin(angle) * torchRadius;

        const torchGroup = new THREE.Group();
        torchGroup.position.set(tx, -0.3, tz);

        const pole = new THREE.Mesh(tPoleGeo, woodMat);
        pole.position.y = 0.7;
        pole.rotation.x = rand(-0.05, 0.05);
        pole.rotation.z = rand(-0.05, 0.05);
        torchGroup.add(pole);

        const shroud = new THREE.Mesh(shroudGeo, shroudMat);
        shroud.position.set(0, 1.52, 0);
        torchGroup.add(shroud);

        const bandUpper = new THREE.Mesh(bandGeo, bandMat);
        bandUpper.rotation.x = Math.PI / 2;
        bandUpper.position.set(0, 1.60, 0);
        torchGroup.add(bandUpper);
        const bandLower = new THREE.Mesh(bandGeo, bandMat);
        bandLower.rotation.x = Math.PI / 2;
        bandLower.position.set(0, 1.42, 0);
        torchGroup.add(bandLower);

        const wick = new THREE.Mesh(wickGeo, wickMat);
        wick.position.set(0, 1.62, 0);
        torchGroup.add(wick);

        const baseRockCount = Math.floor(rand(4, 7));
        for (let j = 0; j < baseRockCount; j++) {
            const rock = new THREE.Mesh(rockGeo, darkRockMat);
            const rAngle = rand(0, Math.PI * 2);
            const rDist = rand(0.05, 0.25);
            rock.position.set(Math.cos(rAngle) * rDist, rand(0.0, 0.2), Math.sin(rAngle) * rDist);
            rock.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
            rock.scale.set(rand(0.4, 1.0), rand(0.4, 0.8), rand(0.4, 1.0));
            torchGroup.add(rock);
        }

        const torchFireGrp = new THREE.Group();
        torchFireGrp.position.y = 1.65;
        torchGroup.add(torchFireGrp);
        createFireSystem(torchFireGrp, 6, 0.4, true);

        const tLight = new THREE.PointLight(FIRE_COLOR, FIRE_INTENSITY_BASE * 0.4, FIRE_RANGE * 0.5);
        tLight.position.set(0, 1.7, 0);
        torchGroup.add(tLight);
        flickerLights.push({ light: tLight, baseInt: FIRE_INTENSITY_BASE * 0.4, jitterSpeed: rand(1, 3), isMain: false, isTorch: true, flare: 0 });

        group.add(torchGroup);
    }

    // Palisade fence with a permanently-ajar gate (no click-to-open wiring
    // in this game — see header comment)
    const fenceGroup = new THREE.Group();
    group.add(fenceGroup);

    const postCount = 38;
    const angleStep = (Math.PI * 2) / postCount;
    const gateAngleCenter = Math.PI * 0.38;
    const gateWidthAngle = 0.42;

    const palisadeWoodMat = new THREE.MeshStandardMaterial({ color: 0x221a14, roughness: 0.95, metalness: 0.05 });
    const ironHardwareMat = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.4, metalness: 0.85 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.9 });

    const postGeo = new THREE.CylinderGeometry(0.12, 0.16, 2.3, 7);
    const spikeGeo = new THREE.ConeGeometry(0.12, 0.4, 7);
    const railGeo = new THREE.CylinderGeometry(0.06, 0.07, 1.8, 6);
    const ropeGeo = new THREE.TorusGeometry(0.15, 0.03, 6, 12);

    for (let i = 0; i < postCount; i++) {
        const angle = i * angleStep;
        const angleDiff = Math.abs(((angle - gateAngleCenter + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (angleDiff < gateWidthAngle) continue;

        const px = Math.cos(angle) * FENCE_RADIUS;
        const pz = Math.sin(angle) * FENCE_RADIUS;

        const post = new THREE.Mesh(postGeo, palisadeWoodMat);
        const heightVar = rand(-0.2, 0.3);
        post.position.set(px, 1.15 + heightVar / 2, pz);
        post.rotation.set(rand(-0.06, 0.06), rand(0, Math.PI * 2), rand(-0.06, 0.06));
        fenceGroup.add(post);

        const spike = new THREE.Mesh(spikeGeo, palisadeWoodMat);
        spike.position.y = 1.15 + 0.2;
        post.add(spike);

        if (Math.random() > 0.4) {
            const scar = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, rand(0.2, 0.5), 0.06),
                new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1.0 })
            );
            scar.position.set(0.1, rand(-0.4, 0.4), 0.08);
            scar.rotation.z = rand(-0.3, 0.3);
            post.add(scar);
        }

        const nextAngle = angle + angleStep;
        const nextDiff = Math.abs(((nextAngle - gateAngleCenter + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (nextDiff >= gateWidthAngle) {
            const nx = Math.cos(nextAngle) * FENCE_RADIUS;
            const nz = Math.sin(nextAngle) * FENCE_RADIUS;
            const midX = (px + nx) / 2;
            const midZ = (pz + nz) / 2;

            const railTop = new THREE.Mesh(railGeo, palisadeWoodMat);
            railTop.position.set(midX, 1.6 + heightVar * 0.3, midZ);
            railTop.lookAt(nx, 1.6 + heightVar * 0.3, nz);
            railTop.rotateX(Math.PI / 2);
            fenceGroup.add(railTop);

            const railBottom = new THREE.Mesh(railGeo, palisadeWoodMat);
            railBottom.position.set(midX, 0.7 + heightVar * 0.3, midZ);
            railBottom.lookAt(nx, 0.7 + heightVar * 0.3, nz);
            railBottom.rotateX(Math.PI / 2);
            fenceGroup.add(railBottom);

            const ropeUpper = new THREE.Mesh(ropeGeo, ropeMat);
            ropeUpper.position.set(px, 1.6, pz);
            ropeUpper.rotation.x = Math.PI / 2;
            fenceGroup.add(ropeUpper);
        }
    }

    const leftHingeAngle = gateAngleCenter - gateWidthAngle;
    const rightLatchAngle = gateAngleCenter + gateWidthAngle;
    const hingeX = Math.cos(leftHingeAngle) * FENCE_RADIUS;
    const hingeZ = Math.sin(leftHingeAngle) * FENCE_RADIUS;
    const latchX = Math.cos(rightLatchAngle) * FENCE_RADIUS;
    const latchZ = Math.sin(rightLatchAngle) * FENCE_RADIUS;

    const gatePostGeo = new THREE.CylinderGeometry(0.22, 0.26, 3.2, 8);
    const hingePost = new THREE.Mesh(gatePostGeo, palisadeWoodMat);
    hingePost.position.set(hingeX, 1.6, hingeZ);
    fenceGroup.add(hingePost);
    const latchPost = new THREE.Mesh(gatePostGeo, palisadeWoodMat);
    latchPost.position.set(latchX, 1.6, latchZ);
    fenceGroup.add(latchPost);

    const gateStoneGeo = new THREE.DodecahedronGeometry(0.45);
    [{ x: hingeX, z: hingeZ }, { x: latchX, z: latchZ }].forEach(pos => {
        for (let k = 0; k < 4; k++) {
            const st = new THREE.Mesh(gateStoneGeo, stoneMat);
            st.position.set(pos.x + rand(-0.25, 0.25), rand(0.05, 0.2), pos.z + rand(-0.25, 0.25));
            st.rotation.set(rand(0, Math.PI), rand(0, Math.PI), 0);
            fenceGroup.add(st);
        }
    });

    const gateDoorWidth = Math.hypot(latchX - hingeX, latchZ - hingeZ);
    const doorAngleBase = Math.atan2(latchZ - hingeZ, latchX - hingeX);

    const gateHingeGroup = new THREE.Group();
    gateHingeGroup.position.set(hingeX, 0, hingeZ);
    // Swung open ~0.62*PI from closed, permanently — see header comment.
    gateHingeGroup.rotation.y = -doorAngleBase - (Math.PI * 0.38 - 0.42) + Math.PI * 0.62;
    fenceGroup.add(gateHingeGroup);

    const hingeRingGeo = new THREE.TorusGeometry(0.25, 0.04, 8, 16);
    const hingeBracketGeo = new THREE.BoxGeometry(0.5, 0.1, 0.04);
    [0.8, 2.2].forEach(yPos => {
        const postHinge = new THREE.Mesh(hingeRingGeo, ironHardwareMat);
        postHinge.position.set(0, yPos, 0);
        postHinge.rotation.x = Math.PI / 2;
        gateHingeGroup.add(postHinge);
        const strap = new THREE.Mesh(hingeBracketGeo, ironHardwareMat);
        strap.position.set(0.25, yPos, 0.05);
        gateHingeGroup.add(strap);
    });

    const doorPanel = new THREE.Group();
    gateHingeGroup.add(doorPanel);
    const plankCount = 6;
    const plankWidth = (gateDoorWidth - 0.2) / plankCount;
    const plankGeo = new THREE.BoxGeometry(plankWidth * 0.92, 2.3, 0.08);
    for (let i = 0; i < plankCount; i++) {
        const plank = new THREE.Mesh(plankGeo, palisadeWoodMat);
        const localX = 0.15 + (i + 0.5) * plankWidth;
        const localY = 1.35 + rand(-0.08, 0.08);
        plank.position.set(localX, localY, 0);
        const topSpike = new THREE.Mesh(new THREE.ConeGeometry(plankWidth * 0.44, 0.35, 4), palisadeWoodMat);
        topSpike.position.y = 1.15 + 0.15;
        topSpike.rotation.y = Math.PI / 4;
        plank.add(topSpike);
        doorPanel.add(plank);
    }
    const crossbeamGeo = new THREE.BoxGeometry(gateDoorWidth - 0.1, 0.12, 0.1);
    const topBeam = new THREE.Mesh(crossbeamGeo, palisadeWoodMat);
    topBeam.position.set(gateDoorWidth / 2, 2.1, 0.05);
    doorPanel.add(topBeam);
    const bottomBeam = new THREE.Mesh(crossbeamGeo, palisadeWoodMat);
    bottomBeam.position.set(gateDoorWidth / 2, 0.7, 0.05);
    doorPanel.add(bottomBeam);
    const diagLength = Math.hypot(gateDoorWidth - 0.1, 1.4);
    const diagBeam = new THREE.Mesh(new THREE.BoxGeometry(diagLength, 0.1, 0.08), palisadeWoodMat);
    diagBeam.position.set(gateDoorWidth / 2, 1.4, 0.05);
    diagBeam.rotation.z = Math.atan2(1.4, gateDoorWidth - 0.1);
    doorPanel.add(diagBeam);
    const handleRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 16), ironHardwareMat);
    handleRing.position.set(gateDoorWidth - 0.25, 1.3, 0.12);
    doorPanel.add(handleRing);
    const latchPlate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.03), ironHardwareMat);
    latchPlate.position.set(gateDoorWidth - 0.25, 1.3, 0.09);
    doorPanel.add(latchPlate);

    // Fireflies drifting inside the compound
    const fireflyGroup = new THREE.Group();
    group.add(fireflyGroup);
    const ffGeo = new THREE.PlaneGeometry(0.15, 0.15);
    const ffMat = new THREE.MeshBasicMaterial({
        map: createGlowSprite(16, 'rgba(255, 255, 150, 1)', 'rgba(200, 255, 100, 0.6)'),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    for (let i = 0; i < 35; i++) {
        const ff = new THREE.Mesh(ffGeo, ffMat);
        ff.position.set(rand(-7, 7), rand(0.5, 3), rand(-7, 7));
        fireflyGroup.add(ff);
        fireflies.push({
            mesh: ff, baseY: ff.position.y, speed: rand(0.3, 1.0), offset: rand(0, Math.PI * 2),
            radiusX: rand(0.5, 1.5), radiusZ: rand(0.5, 1.5), centerX: ff.position.x, centerZ: ff.position.z
        });
    }

    // Embers rising from the fire
    const emberGroup = new THREE.Group();
    campfireGroup.add(emberGroup);
    const emberGeo = new THREE.BufferGeometry();
    const emberPositions = new Float32Array(EMBER_COUNT * 3);
    const emberColors = new Float32Array(EMBER_COUNT * 3);
    for (let i = 0; i < EMBER_COUNT; i++) {
        emberPositions[i * 3] = 0;
        emberPositions[i * 3 + 1] = -10;
        emberPositions[i * 3 + 2] = 0;
        emberColors[i * 3] = 1.0;
        emberColors[i * 3 + 1] = rand(0.4, 0.8);
        emberColors[i * 3 + 2] = 0.1;
        embers.push({ active: false, velocity: new THREE.Vector3(), life: 0, maxLife: rand(2.0, 4.0), index: i });
    }
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
    emberGeo.setAttribute('color', new THREE.BufferAttribute(emberColors, 3));
    const emberMat = new THREE.PointsMaterial({
        size: 0.05, map: createDotSprite(), transparent: true, blending: THREE.AdditiveBlending, vertexColors: true, depthWrite: false
    });
    const emberPoints = new THREE.Points(emberGeo, emberMat);
    emberGroup.add(emberPoints);
    emberSystem = { mesh: emberPoints, data: embers };

    // Main fire light + warm fill light
    const fireLight = new THREE.PointLight(FIRE_COLOR, FIRE_INTENSITY_BASE, FIRE_RANGE);
    fireLight.position.set(0, 0.5, 0);
    campfireGroup.add(fireLight);
    flickerLights.push({ light: fireLight, baseInt: FIRE_INTENSITY_BASE, jitterSpeed: 0, isMain: true, isTorch: false, flare: 0 });

    const fillLight = new THREE.PointLight(0xffaa55, FIRE_INTENSITY_BASE * 0.3, FIRE_RANGE * 0.8);
    fillLight.position.set(0, 1.5, 0);
    campfireGroup.add(fillLight);
    flickerLights.push({ light: fillLight, baseInt: FIRE_INTENSITY_BASE * 0.3, jitterSpeed: 0, isMain: false, isTorch: false, flare: 0 });

    group.position.set(x, y, z);
    state.scene.add(group);
    return group;
}

function spawnEmber() {
    const ember = emberSystem.data.find(e => !e.active);
    if (!ember) return;
    ember.active = true;
    ember.life = 0;
    const positions = emberSystem.mesh.geometry.attributes.position.array;
    const idx = ember.index * 3;
    positions[idx] = rand(-0.3, 0.3);
    positions[idx + 1] = rand(0.2, 0.5);
    positions[idx + 2] = rand(-0.3, 0.3);
    ember.velocity.set(rand(-0.2, 0.2), rand(0.5, 1.5), rand(-0.2, 0.2));
}

// Per-frame fire/ember/firefly/lantern-flame animation, mirroring the
// mockup's animate() 1:1 (values tuned for its ~60fps-assumed per-step
// deltas, so this reads delta in seconds and reconstructs elapsed time
// rather than trying to make every constant delta-independent).
export function updateWarmPaw(delta) {
    if (!emberSystem) return;
    const camera = state.camera;
    elapsed += delta;

    const cycle = elapsed % 10;
    const isBluePhase = cycle >= 8;
    const targetLightColor = isBluePhase ? colorBlue : colorOrange;
    const targetTex = isBluePhase ? texBlue : texOrange;

    if (lanternCandleFlameMesh && camera) {
        lanternCandleFlameMesh.quaternion.copy(camera.quaternion);
        lanternCandleFlameMesh.position.x = noise(elapsed * 8) * 0.003;
        lanternCandleFlameMesh.position.z = noise(elapsed * 9) * 0.003;
        const stretch = 1.0 + noise(elapsed * 15) * 0.2;
        const width = 1.0 + noise(elapsed * 10) * 0.1;
        lanternCandleFlameMesh.scale.set(width, stretch, 1.0);
        lanternCandleFlameMesh.material.opacity = 0.7 + noise(elapsed * 20) * 0.3;
    }

    flickerLights.forEach(fl => {
        let currentFlare = 0;
        if (fl.isTorch) {
            if (Math.random() < 0.01) fl.flare = rand(0.5, 2.5);
            fl.flare *= 0.92;
            currentFlare = fl.flare;
            fl.light.color.lerp(targetLightColor, 0.1);
        }
        const intensityVariation = noise(elapsed * (2.0 + fl.jitterSpeed)) * (fl.baseInt * 0.25);
        fl.light.intensity = fl.baseInt + intensityVariation + currentFlare;
        if (fl.isMain) {
            fl.light.position.x = Math.sin(elapsed * 15) * 0.05;
            fl.light.position.z = Math.cos(elapsed * 13) * 0.05;
        }
    });

    fireParticles.forEach(p => {
        p.life += 0.015 * p.speed;
        if (p.life > 1.0) {
            p.life = 0;
            resetFireParticle(p.mesh, p.baseScale);
        }
        if (p.isTorch && p.mesh.material.map !== targetTex) {
            p.mesh.material.map = targetTex;
            p.mesh.material.needsUpdate = true;
        }
        p.mesh.position.y += 0.02 * p.speed * p.baseScale;
        const sway = Math.sin(elapsed * p.swayFreq + p.mesh.position.y * (3 / p.baseScale)) * p.swayAmp;
        p.mesh.position.x += sway * 0.05;
        p.mesh.position.z += Math.cos(elapsed * (p.swayFreq * 0.8)) * p.swayAmp * 0.05;
        const scaleCurve = 4 * p.life * (1 - p.life);
        const currentScale = p.scaleBase * (0.2 + scaleCurve * 0.8);
        const heightRatio = p.mesh.position.y / Math.max(0.1, p.baseScale);
        const widthScale = currentScale * Math.max(0.1, 1.0 - heightRatio * 0.3);
        p.mesh.scale.set(widthScale, currentScale * 1.5, 1);
        p.mesh.material.opacity = Math.max(0, 1.0 - Math.pow(p.life, 2));
        if (camera) p.mesh.quaternion.copy(camera.quaternion);
    });

    if (Math.random() < 0.2) spawnEmber();

    const positions = emberSystem.mesh.geometry.attributes.position.array;
    let needsUpdate = false;
    emberSystem.data.forEach(ember => {
        if (!ember.active) return;
        ember.life += 0.016;
        if (ember.life >= ember.maxLife) {
            ember.active = false;
            positions[ember.index * 3 + 1] = -10;
        } else {
            const idx = ember.index * 3;
            ember.velocity.x += (Math.random() - 0.5) * 0.05;
            ember.velocity.z += (Math.random() - 0.5) * 0.05;
            ember.velocity.y *= 0.99;
            positions[idx] += ember.velocity.x * 0.016;
            positions[idx + 1] += ember.velocity.y * 0.016;
            positions[idx + 2] += ember.velocity.z * 0.016;
        }
        needsUpdate = true;
    });
    if (needsUpdate) emberSystem.mesh.geometry.attributes.position.needsUpdate = true;

    fireflies.forEach(ff => {
        const t = elapsed * ff.speed + ff.offset;
        ff.mesh.position.x = ff.centerX + Math.sin(t * 0.7) * ff.radiusX;
        ff.mesh.position.z = ff.centerZ + Math.cos(t * 0.8) * ff.radiusZ;
        ff.mesh.position.y = ff.baseY + Math.sin(t * 1.2) * 0.4;
        ff.mesh.material.opacity = 0.4 + Math.sin(t * 3) * 0.6;
        if (camera) ff.mesh.quaternion.copy(camera.quaternion);
    });
}
