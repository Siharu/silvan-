// Radio Tower — ported from reference-assets/NO_1_RADIO.html. 3-legged
// tapering lattice tower (Eiffel-style curve), broken viewing platform,
// bent/damaged antenna + small dish, pulsing red beacon, 3 drooping guy
// wires with ground anchors, and a rusted base shack with a flickering
// porch light. Kept the plain original "Radio Tower" name/flavor text per
// PLAN.md's revert away from the "Iron Antler" lore reskin.
//
// Two things dropped from the mockup since they belonged to its own
// standalone scene rather than the tower prop itself: the procedurally
// textured ground plane (this map already has its own terrain/ground),
// and the ambient dust-particle field (the mockup's atmosphere, not part
// of the structure). Everything structural is otherwise a 1:1 port.
//
// Unlike the other ported POIs, this one has real per-frame animation
// (the beacon's throb and the shack light's flicker are the whole point
// of the "blinks continuously into the fog" description) — see
// updateRadioTower(), wired from pois.js/main.js's animate loop.
import * as THREE from 'three';
import { state } from '../core/state.js';

let beaconMat = null;
let beaconLight = null;
let cabinLight = null;
let cabinBulbMat = null;
let elapsed = 0;

export function createRadioTower(x, y, z) {
    const group = new THREE.Group();

    const matBase = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.9, metalness: 0.8 });
    const matRust = new THREE.MeshStandardMaterial({ color: 0x5a2319, roughness: 1.0, metalness: 0.2 });
    function getMaterial() {
        return Math.random() > 0.75 ? matRust : matBase;
    }

    const towerGroup = new THREE.Group();
    group.add(towerGroup);

    const towerHeight = 24;
    const baseRadius = 4.5;
    const topRadius = 0.4;
    const levels = 9;
    const numLegs = 3;

    const nodes = [];
    for (let i = 0; i <= levels; i++) {
        const t = i / levels;
        const curveT = Math.pow(t, 0.85);
        const currentRadius = THREE.MathUtils.lerp(baseRadius, topRadius, curveT);
        const currentY = t * towerHeight;
        const levelNodes = [];
        for (let j = 0; j < numLegs; j++) {
            const angle = (j / numLegs) * Math.PI * 2;
            levelNodes.push(new THREE.Vector3(
                Math.cos(angle) * currentRadius,
                currentY,
                Math.sin(angle) * currentRadius
            ));
        }
        nodes.push(levelNodes);
    }

    function createBeam(p1, p2, thickness, material) {
        const distance = p1.distanceTo(p2);
        if (distance === 0) return;
        const geo = new THREE.CylinderGeometry(thickness, thickness, distance, 5);
        const mesh = new THREE.Mesh(geo, material || getMaterial());
        mesh.position.copy(p1).lerp(p2, 0.5);
        const direction = new THREE.Vector3().subVectors(p2, p1).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        mesh.quaternion.setFromUnitVectors(up, direction);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        towerGroup.add(mesh);
        return mesh;
    }

    const legThickness = 0.18;
    const braceThickness = 0.08;
    const horizontalThickness = 0.1;

    for (let i = 0; i < levels; i++) {
        const currentLevel = nodes[i];
        const nextLevel = nodes[i + 1];
        for (let j = 0; j < numLegs; j++) {
            const jNext = (j + 1) % numLegs;

            createBeam(currentLevel[j], nextLevel[j], legThickness, getMaterial());

            if (i > 0) {
                createBeam(currentLevel[j], currentLevel[jNext], horizontalThickness, getMaterial());
            }

            if (i % 2 === 0) {
                createBeam(currentLevel[j], nextLevel[jNext], braceThickness, getMaterial());
                createBeam(currentLevel[jNext], nextLevel[j], braceThickness, getMaterial());
            } else {
                const midPointNext = nextLevel[j].clone().lerp(nextLevel[jNext], 0.5);
                createBeam(currentLevel[j], midPointNext, braceThickness, getMaterial());
                createBeam(currentLevel[jNext], midPointNext, braceThickness, getMaterial());
            }
        }
    }

    for (let j = 0; j < numLegs; j++) {
        createBeam(nodes[levels][j], nodes[levels][(j + 1) % numLegs], horizontalThickness, matBase);
    }

    // Broken viewing platform, tilted from decay
    const platformY = towerHeight * 0.68;
    const platformGroup = new THREE.Group();
    const platRadius = 2.0;
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(platRadius, platRadius, 0.1, 6), matBase);
    platform.castShadow = true;
    platform.receiveShadow = true;
    platformGroup.add(platform);

    for (let i = 0; i < 6; i++) {
        if (i === 2) continue; // missing section of railing
        const angle1 = (i / 6) * Math.PI * 2;
        const angle2 = ((i + 1) / 6) * Math.PI * 2;
        const p1 = new THREE.Vector3(Math.cos(angle1) * platRadius * 0.9, 0.5, Math.sin(angle1) * platRadius * 0.9);
        const p2 = new THREE.Vector3(Math.cos(angle2) * platRadius * 0.9, 0.5, Math.sin(angle2) * platRadius * 0.9);

        const postMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4), matBase);
        postMesh.position.set(p1.x, 0.25, p1.z);
        platformGroup.add(postMesh);

        const distance = p1.distanceTo(p2);
        const railMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, distance, 4), matBase);
        railMesh.position.copy(p1).lerp(p2, 0.5);
        railMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
        platformGroup.add(railMesh);
    }
    platformGroup.position.set(0, platformY, 0);
    platformGroup.rotation.z = -0.12;
    platformGroup.rotation.x = 0.08;
    towerGroup.add(platformGroup);

    // Antennas + damaged/bent one + small dish
    const antennaY = towerHeight * 0.9;
    createBeam(new THREE.Vector3(-1.5, antennaY, 0), new THREE.Vector3(1.5, antennaY, 0), 0.06, matBase);
    createBeam(new THREE.Vector3(0, antennaY + 0.5, -1.2), new THREE.Vector3(0, antennaY + 0.5, 1.2), 0.05, matBase);

    const bentP1 = new THREE.Vector3(0.5, antennaY - 0.5, 0.5);
    const bentP2 = new THREE.Vector3(2.5, antennaY - 2.0, 1.5);
    createBeam(bentP1, bentP2, 0.04, matRust);

    const dish = new THREE.Mesh(
        new THREE.ConeGeometry(0.6, 0.2, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide })
    );
    dish.position.set(-0.6, towerHeight * 0.85, 0);
    dish.rotation.x = Math.PI / 2 - 0.2;
    dish.rotation.z = 0.5;
    dish.castShadow = true;
    towerGroup.add(dish);

    // Pulsing beacon at the mast top
    const beaconY = towerHeight + 0.5;
    createBeam(new THREE.Vector3(0, towerHeight, 0), new THREE.Vector3(0, beaconY, 0), 0.08, matBase);

    beaconMat = new THREE.MeshStandardMaterial({
        color: 0x220000,
        emissive: 0xff0000,
        emissiveIntensity: 0,
        roughness: 0.1
    });
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 1), beaconMat);
    beacon.position.set(0, beaconY, 0);
    towerGroup.add(beacon);

    beaconLight = new THREE.PointLight(0xff0000, 0, 15);
    beaconLight.position.copy(beacon.position);
    towerGroup.add(beaconLight);

    // Drooping guy wires + ground anchors
    const wireHeight = towerHeight * 0.55;
    const anchorRadius = 18;
    for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2 + (Math.PI / 6);
        const t = wireHeight / towerHeight;
        const curveT = Math.pow(t, 0.85);
        const radiusAtHeight = THREE.MathUtils.lerp(baseRadius, topRadius, curveT);

        const startP = new THREE.Vector3(Math.cos(angle) * radiusAtHeight, wireHeight, Math.sin(angle) * radiusAtHeight);
        const endP = new THREE.Vector3(Math.cos(angle) * anchorRadius, 0, Math.sin(angle) * anchorRadius);
        const midP = startP.clone().lerp(endP, 0.5);
        midP.y -= 2.5;

        const curve = new THREE.QuadraticBezierCurve3(startP, midP, endP);
        const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.03, 4, false);
        const wire = new THREE.Mesh(tubeGeo, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0 }));
        wire.castShadow = true;
        group.add(wire);

        const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), matBase);
        anchor.position.copy(endP);
        anchor.position.y = 0.3;
        anchor.lookAt(startP);
        anchor.castShadow = true;
        group.add(anchor);
    }

    // Base shack, nestled near the tower's foot
    const shackGroup = new THREE.Group();

    const slab = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.4, 3.8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0 }));
    slab.position.set(0, 0.1, 0);
    slab.receiveShadow = true;
    slab.castShadow = true;
    shackGroup.add(slab);

    const shack = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.5, 3.2), matRust);
    shack.position.set(0, 1.45, 0);
    shack.castShadow = true;
    shack.receiveShadow = true;
    shackGroup.add(shack);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.15, 3.8), matBase);
    roof.position.set(0, 2.8, 0);
    roof.rotation.x = -0.06;
    roof.castShadow = true;
    roof.receiveShadow = true;
    shackGroup.add(roof);

    const openingMat = new THREE.MeshBasicMaterial({ color: 0x020202 });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.9), openingMat);
    door.position.set(-0.7, 1.25, 1.61);
    shackGroup.add(door);

    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), openingMat);
    win.position.set(1.61, 1.5, 0);
    win.rotation.y = Math.PI / 2;
    shackGroup.add(win);

    for (let i = 0; i < 4; i++) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.05), matRust);
        board.position.set(1.63, 1.25 + i * 0.25 + Math.random() * 0.05, (Math.random() - 0.5) * 0.1);
        board.rotation.y = Math.PI / 2;
        board.rotation.z = (Math.random() - 0.5) * 0.3;
        shackGroup.add(board);
    }

    const shackAntenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8), matBase);
    shackAntenna.position.set(1.2, 3.5, -1.2);
    shackAntenna.rotation.z = -0.4;
    shackAntenna.rotation.x = 0.2;
    shackGroup.add(shackAntenna);

    const porchLight = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.15), matBase);
    porchLight.position.set(-0.7, 2.4, 1.68);
    porchLight.rotation.x = Math.PI / 2;
    shackGroup.add(porchLight);

    cabinBulbMat = new THREE.MeshStandardMaterial({ color: 0xffddaa, emissive: 0xffaa00, emissiveIntensity: 0.5 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05), cabinBulbMat);
    bulb.position.set(-0.7, 2.3, 1.76);
    shackGroup.add(bulb);

    cabinLight = new THREE.PointLight(0xffbb44, 0.5, 8);
    cabinLight.position.set(-0.7, 2.2, 1.8);
    shackGroup.add(cabinLight);

    const barrelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.8, 12);
    const barrel1 = new THREE.Mesh(barrelGeo, matRust);
    barrel1.position.set(-2.2, 0.5, 1.2);
    barrel1.rotation.z = 0.15;
    barrel1.castShadow = true;
    shackGroup.add(barrel1);

    const barrel2 = new THREE.Mesh(barrelGeo, matRust);
    barrel2.position.set(-2.6, 0.4, 0.7);
    barrel2.rotation.x = Math.PI / 2;
    barrel2.rotation.z = 0.5;
    barrel2.castShadow = true;
    shackGroup.add(barrel2);

    shackGroup.position.set(2.0, 0, -1.5);
    shackGroup.rotation.y = -0.4;
    group.add(shackGroup);

    group.position.set(x, y, z);
    state.scene.add(group);
    return group;
}

// Per-frame beacon throb + shack-light flicker. delta is in seconds.
// Mirrors the mockup's animate() logic; harmless to call every frame even
// before createRadioTower() has run (module-level refs stay null until
// then), matching how pois.js currently skips build:null entries.
export function updateRadioTower(delta) {
    if (!beaconMat || !beaconLight) return;
    elapsed += delta;

    const pulseRaw = Math.sin(elapsed * 2.5);
    const pulseIntensity = Math.pow(Math.max(0, pulseRaw), 4);
    beaconMat.emissiveIntensity = pulseIntensity * 4.0 + 0.1;
    beaconLight.intensity = pulseIntensity * 5.0;

    if (cabinLight && cabinBulbMat) {
        if (Math.random() > 0.85) {
            cabinLight.intensity = Math.random() * 0.6 + 0.1;
            cabinBulbMat.emissiveIntensity = cabinLight.intensity;
        } else if (Math.random() > 0.97) {
            cabinLight.intensity = 0;
            cabinBulbMat.emissiveIntensity = 0;
        }
    }
}
