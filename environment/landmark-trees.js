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
//   - GrandBlueTree's night-time heal/poison proximity effect (the blue
//     glow + pulse IS ported — see updateGrandBlueGlow below)
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

// Hand-placed landmarks. Exported so forest.js can keep its undergrowth off the
// buttress roots / out from under the canopy instead of growing through them.
export const GRAND_BLUE_SPOTS = [
    { x: 20 * SCALE, z: 30 * SCALE, scale: 0.75 },
    { x: -116, z: 22, scale: 0.65 },   // was (-176,176): that spot is beach (h 1.7). Nothing on the west coast is flat enough for the root flare, so it moved inland west of the crater
    { x: 60 * SCALE, z: -30 * SCALE, scale: 0.8 },
    { x: -25 * SCALE, z: -55 * SCALE, scale: 0.7 },
];
export const GRAND_BLUE_CLEAR_R = 55; // per unit of tree scale: flared roots reach ~50 u

// Shared uniforms so ONE update drives every Grand Blue material (trunk, limbs, leaves).
const glow = {
    uGlow: { value: 0 },
    uTimeG: { value: 0 },
    uGlowColor: { value: new THREE.Color(0.10, 0.62, 1.0) }, // linear, cyan-blue
};

// ---- shared canvas textures (ported from the prototype's createFoliageTexture
// / createPalmFrondTextures, same technique Silvan's own utils.js already
// uses for its leaf/flower textures) ----------------------------------------
function buildGrandBlueFoliageTexture() {
    // A clump of small overlapping leaves (not a few big circles) so each card
    // reads as foliage with a ragged edge rather than a flat sticker.
    const cvs = document.createElement('canvas');
    cvs.width = 128; cvs.height = 128;
    const ctx = cvs.getContext('2d');
    for (let i = 0; i < 36; i++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 44;
        const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
        const shade = 185 + Math.floor(rand() * 70);   // per-leaf brightness = fake depth
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 10 + rand() * 8, 4.5 + rand() * 3.5, a + (rand() - 0.5) * 1.2, 0, Math.PI * 2);
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

// ---- Grand Blue Tree: massive ancient flared-root tree with a domed canopy.
// Bark = grooves + moss at the roots (same idea as forest.js's trunks) plus
// cyan "veins" that light up at night; leaves and veins share one glow uniform.
function makeBarkMaterial(color, mossAmount) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, glow, { uMoss: { value: mossAmount } });
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                varying vec3 vLocalPos;
                varying vec3 vWorldNormal;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vLocalPos = position;`)
            .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
                vWorldNormal = normalize(mat3(instanceMatrix) * objectNormal);`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform float uGlow; uniform float uTimeG; uniform vec3 uGlowColor; uniform float uMoss;
                varying vec3 vLocalPos;
                varying vec3 vWorldNormal;`)
            .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
                vec4 diffuseColor = vec4( diffuse, opacity );
                {
                    float ang = atan(vLocalPos.z, vLocalPos.x);
                    float g1 = sin(ang * 22.0 + sin(vLocalPos.y * 0.25) * 2.0);
                    float g2 = sin(ang * 9.0 - vLocalPos.y * 0.08);
                    float groove = smoothstep(-0.2, 0.9, g1 * 0.6 + g2 * 0.4);
                    vec3 bark = mix(diffuse * 0.32, diffuse * 1.2, groove);
                    float seg = mod(floor((ang / 6.2831853 + 0.5) * 12.0), 12.0);
                    bark *= 0.82 + 0.34 * fract(sin(floor(vLocalPos.y * 0.5) * 12.9898 + seg * 78.233) * 43758.5453);
                    float up = clamp(vWorldNormal.y * 1.2 + 0.1, 0.0, 1.0);
                    float low = 1.0 - smoothstep(4.0, 24.0, vLocalPos.y);
                    float mn = 0.5 + 0.5 * sin(ang * 13.0 + vLocalPos.y * 0.9) * sin(vLocalPos.y * 0.4);
                    float moss = clamp(low * (0.35 + up * 0.6) * (0.6 + 0.4 * mn), 0.0, 1.0) * uMoss;
                    bark = mix(bark, vec3(0.10, 0.24, 0.09), moss * 0.85);
                    diffuseColor.rgb = bark;
                }`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                {
                    float a2 = atan(vLocalPos.z, vLocalPos.x);
                    float vein = smoothstep(0.86, 0.98, sin(a2 * 7.0 + vLocalPos.y * 0.12 + sin(vLocalPos.y * 0.3) * 1.2));
                    float pulse = 0.75 + 0.25 * sin(uTimeG * 1.1 + vLocalPos.y * 0.05);
                    totalEmissiveRadiance += uGlowColor * uGlow * pulse * (vein * 1.5 + 0.05);
                }`);
    };
    return mat;
}

// The root flare (see the vertex warp below) reaches roughly this far from
// the trunk centre at scale 1 — used both to seat the tree into the terrain
// and to size its collider, so the two stay consistent with each other.
const ROOT_FLARE_REACH = 30;

// A single centre-point elevation sample isn't enough to seat a ~60u-wide
// irregular root flare on real terrain — on any slope, half the roots would
// float and half would clip. Sample a ring around the flare's actual reach
// and use the lowest point, so the whole base sits at or below grade
// everywhere (the comment below on `sink` covers the small extra buffer).
function seatElevation(cx, cz, scale) {
    let minY = getElevation(cx, cz);
    const r = ROOT_FLARE_REACH * scale;
    const SAMPLES = 8;
    for (let k = 0; k < SAMPLES; k++) {
        const a = (k / SAMPLES) * Math.PI * 2;
        minY = Math.min(minY, getElevation(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
    return minY;
}

export function createGrandBlueTrees() {
    const spots = GRAND_BLUE_SPOTS;

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
    const trunkMat = makeBarkMaterial(0x6a4a33, 1.0);
    const limbMat = makeBarkMaterial(0x5d4230, 0.0);

    // Big limbs reaching into the canopy: hides the blunt trunk top and makes it read as a tree.
    const LIMBS_PER_TREE = 7, LIMB_LEN = 30;
    const limbGeo = new THREE.CylinderGeometry(1.3, 3.0, LIMB_LEN, 8, 4);
    limbGeo.translate(0, LIMB_LEN / 2, 0);

    const leafMat = new THREE.MeshStandardMaterial({
        map: buildGrandBlueFoliageTexture(), color: 0xffffff, transparent: true, alphaTest: 0.45,
        side: THREE.DoubleSide, roughness: 0.85,
    });
    leafMat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, glow);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                varying float vPhase;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vPhase = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform float uGlow; uniform float uTimeG; uniform vec3 uGlowColor;
                varying float vPhase;`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                {
                    float pulse = 0.65 + 0.35 * sin(uTimeG * 1.4 + vPhase * 6.2831);
                    // night glow + a faint always-on fill so the canopy underside never goes pure black
                    totalEmissiveRadiance += uGlowColor * (0.7 + 0.6 * vPhase) * uGlow * pulse * 1.2 + vec3(0.02, 0.06, 0.07);
                }`);
    };
    const leafGeo = new THREE.PlaneGeometry(10, 10);
    const LEAVES_PER_TREE = 280;

    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    trunkMesh.castShadow = true; trunkMesh.receiveShadow = true;
    const limbMesh = new THREE.InstancedMesh(limbGeo, limbMat, spots.length * LIMBS_PER_TREE);
    limbMesh.castShadow = true; limbMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const limbLocal = new THREE.Matrix4(), limbQ = new THREE.Quaternion(), limbS = new THREE.Vector3(), limbP = new THREE.Vector3();
    const colliders = [];
    const col = new THREE.Color();
    blueTrees.length = 0;

    spots.forEach((s, i) => {
        const y = getElevation(s.x, s.z);
        // Old version sank a fixed guess below the CENTRE point only, so on
        // any real slope one side of the ~60u root spread floated while the
        // other clipped into the hill. Seat instead at the lowest point the
        // flare actually reaches, minus a small buffer so the lowest root
        // finger still bites into the ground rather than sitting exactly at grade.
        const seatY = seatElevation(s.x, s.z, s.scale) - 0.6 * s.scale;
        dummy.position.set(s.x, seatY, s.z);
        dummy.rotation.y = rand() * Math.PI * 2;
        dummy.scale.setScalar(s.scale);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(i, dummy.matrix);
        // Was r: 16*scale — smaller than even the unflared trunk base (radius
        // 14) before the flare multiplies it up to ~3.7x near the ground, which
        // is why the roots could be walked straight through. A single circle
        // can't chase the star-shaped flare exactly; this matches its average
        // reach rather than the tips of its longest fingers.
        colliders.push({ x: s.x, z: s.z, r: ROOT_FLARE_REACH * s.scale });
        blueTrees.push({ x: s.x, y, z: s.z, scale: s.scale });

        for (let k = 0; k < LIMBS_PER_TREE; k++) {
            const a = (k / LIMBS_PER_TREE) * Math.PI * 2 + rand() * 0.6;
            const pitch = 0.6 + rand() * 0.55;                       // ~35-65 deg up from horizontal
            const dir = new THREE.Vector3(Math.cos(a) * Math.cos(pitch), Math.sin(pitch), Math.sin(a) * Math.cos(pitch));
            limbQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            limbP.set(0, 52 + rand() * 30, 0);
            const len = 0.9 + rand() * 0.8, thick = 0.8 + rand() * 0.6;
            limbS.set(thick, len, thick);
            limbLocal.compose(limbP, limbQ, limbS);
            limbMesh.setMatrixAt(i * LIMBS_PER_TREE + k, dummy.matrix.clone().multiply(limbLocal));
        }

        const leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAVES_PER_TREE);
        leaves.castShadow = true;
        const leafDummy = new THREE.Object3D();
        const center = new THREE.Vector3(0, trunkHeight - 12, 0);
        for (let j = 0; j < LEAVES_PER_TREE; j++) {
            // upper dome plus a short skirt (no cards hanging below the crown)
            const u = (j + 0.5) / LEAVES_PER_TREE;
            const phi = Math.acos(1 - u * 1.35);
            const theta = j * 2.399963;                             // golden angle: even spread
            const r = 24 + rand() * 20;
            leafDummy.position.set(
                r * Math.sin(phi) * Math.cos(theta) * 1.8,
                r * Math.cos(phi) * 0.55 + trunkHeight - 2,
                r * Math.sin(phi) * Math.sin(theta) * 1.8,
            );
            // face the card outward from the crown centre, then spin it in-plane
            const out = leafDummy.position.clone().sub(center).normalize();
            out.x += (rand() - 0.5) * 0.5; out.y += (rand() - 0.5) * 0.5; out.z += (rand() - 0.5) * 0.5;
            leafDummy.lookAt(leafDummy.position.clone().add(out));
            leafDummy.rotateZ(rand() * Math.PI * 2);
            leafDummy.scale.setScalar(1.1 + rand() * 1.3);
            leafDummy.updateMatrix();
            // bake this tree's world transform into every leaf instance,
            // since InstancedMesh entries are absolute matrices, not parented to the trunk
            leaves.setMatrixAt(j, dummy.matrix.clone().multiply(leafDummy.matrix));
            col.setHSL(0.5 + rand() * 0.08, 0.45 + rand() * 0.15, 0.24 + rand() * 0.16, THREE.SRGBColorSpace);
            leaves.setColorAt(j, col);
        }
        state.scene.add(leaves);
    });
    state.scene.add(trunkMesh);
    state.scene.add(limbMesh);
    state.colliders.push(...colliders);

    // ONE point light that hops to the nearest Grand Blue tree (audit: keep visible point lights few).
    // Intensity, not .visible, is what changes, so the shader never recompiles at dusk.
    glowLight = new THREE.PointLight(0x4cc9ff, 0, 120, 2);
    state.scene.add(glowLight);
}

const blueTrees = [];
let glowLight = null, glowTree = null;

// Night glow for the Grand Blue trees: ramps up through dusk, stays on all night, fades at dawn.
// Same night window as day-night-cycle.js (gameTime < 0.25 || > 0.79), with a soft edge each side.
const sstep = THREE.MathUtils.smoothstep;
export function updateGrandBlueGlow(dt) {
    glow.uTimeG.value += dt;
    const t = state.gameTime;
    let night;
    if (t > 0.79 || t < 0.25) night = 1;
    else if (t >= 0.25 && t < 0.33) night = 1 - sstep(t, 0.25, 0.33);
    else if (t > 0.70) night = sstep(t, 0.70, 0.79);
    else night = 0;
    const g = night * (0.88 + 0.12 * Math.sin(glow.uTimeG.value * 0.8));
    glow.uGlow.value = g;
    if (!glowLight || !blueTrees.length) return;

    const p = state.player.position;
    let best = blueTrees[0], bd = Infinity;
    for (const bt of blueTrees) { const d = Math.hypot(bt.x - p.x, bt.z - p.z); if (d < bd) { bd = d; best = bt; } }
    // hysteresis so the light doesn't flip-flop between two trees at equal distance
    if (!glowTree || (glowTree !== best && Math.hypot(glowTree.x - p.x, glowTree.z - p.z) - bd > 20)) glowTree = best;
    // sit just outside the trunk, on the player's side, so the bark actually catches it
    const dx = p.x - glowTree.x, dz = p.z - glowTree.z, dl = Math.hypot(dx, dz) || 1;
    const off = 22 * glowTree.scale;
    glowLight.position.set(glowTree.x + (dx / dl) * off, glowTree.y + 20 * glowTree.scale, glowTree.z + (dz / dl) * off);
    glowLight.intensity = 900 * g;
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
