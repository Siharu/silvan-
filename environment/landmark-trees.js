// Two landmark tree species ported from the user's two_new_trees.html
// prototype (a standalone "Living Trees" demo). Kept as rare, hand-placed
// landmarks rather than forest-fill trees — they're much bigger/more
// detailed than forest.js's procedural pines/deciduous and are meant to be
// found, not walked past a hundred of.
//
// STRIPPED from the source prototype (kept out of Silvan's world-gen on
// purpose — these are all gameplay/interaction systems, not tree shape):
//   - chop() / health / die() (axe-chopping the tree down)
//   - ignite() / wetness / fire particles (burning, rain extinguishing it)
//   - GrandBlueTree's night-time heal/poison proximity effect + glow pulse
//   - BurrowingCoconut's loose coconut fruit props + wind-sway per frond
//     (the sink-underground-at-night burrow animation IS ported — see
//     updateLeaningPalms below)
// These are genuine gameplay hooks worth revisiting once Silvan is in the
// gameplay/story pass (see the audit's "landmark trees" addendum) — the
// Grand Blue's glow + proximity effect in particular fits an animal-afterlife
// game well. For now these are static geometry only, so they cost nothing
// per frame beyond one InstancedMesh draw call each.
import * as THREE from 'three';
import { state, WORLD_SIZE } from '../core/state.js';
import { heightAt as getElevation, slopeAt } from '../core/heightmap.js';
import { rngFor } from '../core/rng.js';

const rand = rngFor('landmark-trees');
const SCALE = WORLD_SIZE / 320; // same convention as environment/pois.js

// ---- shared canvas textures (ported from the prototype's createFoliageTexture
// / createPalmFrondTextures, same technique Silvan's own utils.js already
// uses for its leaf/flower textures) ----------------------------------------
function buildGrandBlueFoliageTexture() {
    const cvs = document.createElement('canvas');
    cvs.width = 128; cvs.height = 128;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'white';
    ctx.shadowBlur = 8;
    for (let i = 0; i < 10; i++) {
        ctx.beginPath();
        ctx.arc(64 + (rand() - 0.5) * 50, 64 + (rand() - 0.5) * 50, 15 + rand() * 20, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function buildPalmFrondTextures() {
    const cvs = document.createElement('canvas'), alphaCvs = document.createElement('canvas');
    cvs.width = 256; cvs.height = 512; alphaCvs.width = 256; alphaCvs.height = 512;
    const ctx = cvs.getContext('2d'), aCtx = alphaCvs.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#8b1111'); grad.addColorStop(0.2, '#2a7b32');
    grad.addColorStop(0.85, '#053305'); grad.addColorStop(0.96, '#3a2312'); grad.addColorStop(1, '#241408');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 512);

    aCtx.fillStyle = '#000000'; aCtx.fillRect(0, 0, 256, 512);
    aCtx.fillStyle = '#ffffff'; aCtx.fillRect(118, 0, 20, 512);
    aCtx.lineWidth = 6; aCtx.strokeStyle = '#ffffff'; aCtx.lineCap = 'round';
    for (let y = 5; y < 460; y += 6) {
        const taper = Math.sin((y / 460) * Math.PI);
        const width = taper * 110;
        aCtx.beginPath(); aCtx.moveTo(128, y);
        aCtx.quadraticCurveTo(128 - width / 2, y + 15, 128 - width, y + 30 + rand() * 10);
        aCtx.stroke();
        aCtx.beginPath(); aCtx.moveTo(128, y);
        aCtx.quadraticCurveTo(128 + width / 2, y + 15, 128 + width, y + 30 + rand() * 10);
        aCtx.stroke();
    }
    const map = new THREE.CanvasTexture(cvs), alphaMap = new THREE.CanvasTexture(alphaCvs);
    map.colorSpace = THREE.SRGBColorSpace;
    return { map, alphaMap };
}

// ---- Grand Blue Tree: massive ancient flared-root tree with a domed canopy
export function createGrandBlueTrees() {
    // Hand-placed, not random: these are landmarks meant to be composed, not
    // scattered. Kept away from POIs/crater/steep ground (checked below).
    const spots = [
        { x: 20 * SCALE, z: 30 * SCALE, scale: 0.75 },
        { x: -55 * SCALE, z: 55 * SCALE, scale: 0.65 },
        { x: 60 * SCALE, z: -30 * SCALE, scale: 0.8 },
        { x: -25 * SCALE, z: -55 * SCALE, scale: 0.7 },
    ];

    const trunkHeight = 90; // base height before per-instance `scale`
    const trunkGeo = new THREE.CylinderGeometry(4.5, 14, trunkHeight, 16, 12);
    const pos = trunkGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), x = pos.getX(i), z = pos.getZ(i);
        if (y < -trunkHeight / 2 + 20) {
            const distFromBottom = y - -trunkHeight / 2;
            let factor = 1 + Math.pow(Math.max(0, 20 - distFromBottom) / 20, 2.5) * 1.8;
            const angle = Math.atan2(z, x);
            factor += Math.max(0, Math.sin(angle * 7)) * (Math.max(0, 20 - distFromBottom) / 20) * 0.9;
            pos.setX(i, x * factor); pos.setZ(i, z * factor);
        } else {
            pos.setX(i, x + Math.sin(y * 0.1) * 1.5);
            pos.setZ(i, z + Math.cos(y * 0.12) * 1.5);
        }
    }
    trunkGeo.translate(0, trunkHeight / 2, 0); // base sits at the instance's y=0
    trunkGeo.computeVertexNormals();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.95, flatShading: true });

    const foliageTex = buildGrandBlueFoliageTexture();
    const leafMat = new THREE.MeshStandardMaterial({
        map: foliageTex, color: 0x1a4a55, transparent: true, alphaTest: 0.4,
        side: THREE.DoubleSide, roughness: 0.9,
    });
    const leafGeo = new THREE.PlaneGeometry(10, 10);
    const LEAVES_PER_TREE = 60; // was 1500 in the prototype — cut hard for perf, canopy silhouette barely changes

    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    trunkMesh.castShadow = true; trunkMesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const colliders = [];
    spots.forEach((s, i) => {
        const y = getElevation(s.x, s.z);
        dummy.position.set(s.x, y, s.z);
        dummy.rotation.y = rand() * Math.PI * 2;
        dummy.scale.setScalar(s.scale);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(i, dummy.matrix);
        colliders.push({ x: s.x, z: s.z, r: 6 * s.scale });

        const leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAVES_PER_TREE);
        leaves.castShadow = true;
        const leafDummy = new THREE.Object3D();
        for (let j = 0; j < LEAVES_PER_TREE; j++) {
            const phi = Math.acos(-1 + (2 * j) / LEAVES_PER_TREE);
            const theta = Math.sqrt(LEAVES_PER_TREE * Math.PI) * phi;
            const r = 20 + rand() * 25;
            leafDummy.position.setFromSphericalCoords(r, phi, theta);
            leafDummy.position.x *= 1.8; leafDummy.position.y *= 0.5; leafDummy.position.z *= 1.8;
            leafDummy.position.y += trunkHeight - 4;
            leafDummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
            const ls = 1.0 + rand() * 1.5;
            leafDummy.scale.setScalar(ls);
            leafDummy.updateMatrix();
            // bake this tree's world transform (position+rotation+scale) into every leaf instance,
            // since InstancedMesh entries are absolute matrices, not parented to the trunk
            const world = dummy.matrix.clone().multiply(leafDummy.matrix);
            leaves.setMatrixAt(j, world);
        }
        state.scene.add(leaves);
    });
    state.scene.add(trunkMesh);
    state.colliders.push(...colliders);
}

// ---- Leaning shore palm: curved trunk + collar + drooping fronds, placed
// along the coastline in the 4-8 unit elevation band (just above the beach).
// Burrow state, one entry per palm. Instanced meshes have no scene graph, so
// updateLeaningPalms() rebuilds the affected instance matrices whenever a
// palm's burrowProgress is still moving (idle palms cost nothing per frame).
const palms = [];
let palmMeshes = null;
const PALM_FRONDS = 14;
const PALM_END = new THREE.Vector3(4, 18, -1.5); // curvePoint(1): sin(pi/2)*4, 18, cos(pi)*1.5
const BURROW_SECONDS = 8;                        // full sink/rise duration
const FROND_FOLDED_PITCH = 0.1;                  // ~straight up = closed bundle

export function createLeaningPalms() {
    const COUNT = 10;

    // Deterministic curve (no randomness in the path itself, matching the
    // prototype) — one geometry is reused for every instance via InstancedMesh.
    function curvePoint(t) {
        return new THREE.Vector3(Math.sin(t * Math.PI * 0.5) * 4, t * 18, Math.cos(t * Math.PI) * 1.5);
    }
    const curve = new THREE.Curve();
    curve.getPoint = curvePoint;
    const trunkGeo = new THREE.TubeGeometry(curve, 20, 1.2, 10, false);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.95, flatShading: true });

    const crownGeo = new THREE.CylinderGeometry(1.2, 1.4, 3.5, 16, 8, true);
    const cPos = crownGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
        const y = cPos.getY(i), ny = (y + 1.75) / 3.5, x = cPos.getX(i), z = cPos.getZ(i);
        const angle = Math.atan2(z, x);
        let flare = 1.0 + Math.pow(ny, 3.0) * 0.7;
        let spike = Math.sin(angle * 8) * Math.cos(ny * Math.PI * 3) * 0.35;
        if (ny > 0.5) spike *= ny * 1.5;
        flare += spike;
        cPos.setX(i, x * flare); cPos.setZ(i, z * flare);
    }
    const endPos = curvePoint(1);
    crownGeo.translate(endPos.x, endPos.y + 1.0, endPos.z);
    crownGeo.computeVertexNormals();
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2e1a0c, roughness: 0.95, side: THREE.DoubleSide });

    const { map, alphaMap } = buildPalmFrondTextures();
    const leafMat = new THREE.MeshStandardMaterial({
        map, alphaMap, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.7,
    });
    const leafLen = 24;
    const leafGeo = new THREE.PlaneGeometry(6, leafLen, 4, 8);
    leafGeo.translate(0, leafLen / 2, 0);
    const lPos = leafGeo.attributes.position;
    for (let i = 0; i < lPos.count; i++) {
        const y = lPos.getY(i), x = lPos.getX(i), normY = y / leafLen;
        const zOff = Math.pow(normY, 2.2) * 14;
        const xCurl = -Math.abs(x) * normY * 1.5;
        lPos.setZ(i, zOff + xCurl);
    }
    leafGeo.computeVertexNormals();

    const FRONDS_PER_TREE = PALM_FRONDS; // was 28 in the prototype
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
    const crownMesh = new THREE.InstancedMesh(crownGeo, crownMat, COUNT);
    const frondMesh = new THREE.InstancedMesh(leafGeo, leafMat, COUNT * FRONDS_PER_TREE);
    trunkMesh.castShadow = true; crownMesh.castShadow = true; frondMesh.castShadow = true;

    const dummy = new THREE.Object3D(), leafDummy = new THREE.Object3D();
    const colliders = [];
    let placed = 0, attempts = 0;
    while (placed < COUNT && attempts < COUNT * 40) {
        attempts++;
        const r = Math.sqrt(rand()) * (WORLD_SIZE * 0.44);
        const th = rand() * Math.PI * 2;
        const x = Math.cos(th) * r, z = Math.sin(th) * r;
        const y = getElevation(x, z);
        if (y < 4.0 || y > 8.0) continue;        // just above the beach line only
        if (slopeAt(x, z) > 20) continue;

        dummy.position.set(x, y, z);
        dummy.rotation.y = rand() * Math.PI * 2;
        const s = 0.8 + rand() * 0.5;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(placed, dummy.matrix);
        crownMesh.setMatrixAt(placed, dummy.matrix);
        const collider = { x, z, r: 1.5 * s };
        colliders.push(collider);

        const fronds = [];
        for (let j = 0; j < FRONDS_PER_TREE; j++) {
            let tier = 0;
            if (j >= 4 && j < 9) tier = 1;
            if (j >= 9) tier = 2;
            let basePitch = tier === 0 ? 0.4 + rand() * 0.2 : tier === 1 ? 1.1 + rand() * 0.25 : 1.75 + rand() * 0.3;
            const yaw = (j / (FRONDS_PER_TREE / 3)) * Math.PI * 2 + rand() * 0.2;
            fronds.push({ basePitch, yaw });
            leafDummy.position.set(endPos.x, endPos.y + 1.8, endPos.z);
            leafDummy.rotation.set(basePitch, yaw, 0, 'YXZ');
            leafDummy.scale.setScalar(1);
            leafDummy.updateMatrix();
            const world = dummy.matrix.clone().multiply(leafDummy.matrix);
            frondMesh.setMatrixAt(placed * FRONDS_PER_TREE + j, world);
        }
        palms.push({
            index: placed, x, y, z, s, rotY: dummy.rotation.y, fronds, collider,
            colliderR: collider.r, burrowProgress: 0,
        });
        placed++;
    }
    // Instance matrices get rewritten at runtime by updateLeaningPalms.
    trunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    crownMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    frondMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    palmMeshes = { trunkMesh, crownMesh, frondMesh };
    state.scene.add(trunkMesh, crownMesh, frondMesh);
    state.colliders.push(...colliders);
}

// Burrowing coconut behaviour (ported back from two_new_trees.html): at night
// each palm sinks fully underground while its fronds fold up into a closed
// bundle; at dawn it rises and the fronds spread back out. `deltaMs` is the
// same frame delta updateAtmosphere gets. Night window matches
// day-night-cycle.js's isNight exactly.
const _pDummy = new THREE.Object3D(), _fDummy = new THREE.Object3D(), _fWorld = new THREE.Matrix4();
export function updateLeaningPalms(deltaMs) {
    if (!palmMeshes || !palms.length) return;
    const isNight = state.gameTime < 0.25 || state.gameTime > 0.79;
    const target = isNight ? 1 : 0;
    const step = (deltaMs / 1000) / BURROW_SECONDS;
    const { trunkMesh, crownMesh, frondMesh } = palmMeshes;
    let dirty = false;

    for (const p of palms) {
        if (p.burrowProgress === target) continue;
        p.burrowProgress = target > p.burrowProgress
            ? Math.min(1, p.burrowProgress + step)
            : Math.max(0, p.burrowProgress - step);

        // Sink deep enough that trunk + crown vanish below the terrain.
        const sinkDepth = 20.5 * p.s;
        _pDummy.position.set(p.x, p.y - p.burrowProgress * sinkDepth, p.z);
        _pDummy.rotation.set(0, p.rotY, 0);
        _pDummy.scale.setScalar(p.s);
        _pDummy.updateMatrix();
        trunkMesh.setMatrixAt(p.index, _pDummy.matrix);
        crownMesh.setMatrixAt(p.index, _pDummy.matrix);

        for (let j = 0; j < p.fronds.length; j++) {
            const f = p.fronds[j];
            _fDummy.position.set(PALM_END.x, PALM_END.y + 1.8, PALM_END.z);
            _fDummy.rotation.set(THREE.MathUtils.lerp(f.basePitch, FROND_FOLDED_PITCH, p.burrowProgress), f.yaw, 0, 'YXZ');
            _fDummy.scale.setScalar(1);
            _fDummy.updateMatrix();
            _fWorld.multiplyMatrices(_pDummy.matrix, _fDummy.matrix);
            frondMesh.setMatrixAt(p.index * PALM_FRONDS + j, _fWorld);
        }

        // Trunk is underground past the halfway point — don't block the player on empty ground.
        p.collider.r = p.burrowProgress > 0.5 ? 0 : p.colliderR;
        dirty = true;
    }
    if (dirty) {
        trunkMesh.instanceMatrix.needsUpdate = true;
        crownMesh.instanceMatrix.needsUpdate = true;
        frondMesh.instanceMatrix.needsUpdate = true;
    }
}
