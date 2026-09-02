// Ferns + moss/spores, ported from foliage.html's buildDetailedPlant() /
// buildMoss() / buildSpores(). That reference grew ONE plant centered at
// a fixed origin (on top of a single showcase rock) and moss on that same
// rock's surface. Adapted here into two reusable pieces:
//   - createFerns(): scatters multiple fern clusters across the terrain
//     at random world positions (getElevation-placed), each an
//     independent call into the reference's frond/leaf-growing logic.
//   - applyMoss(rockMesh, ...): the reference's per-vertex upward-normal
//     moss scatter, extracted so environment/rocks.js (next system) can
//     call it directly on whatever rock geometry it builds, instead of
//     this module owning a rock of its own.
//
// Wind uniforms (time/windStrength) are pulled from state each frame via
// updateFoliage(), not the reference's standalone globals.

import * as THREE from 'three';

let _cachedLeafTexture = null;
function getLeafTexture() {
    if (_cachedLeafTexture) return _cachedLeafTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#606060';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    _cachedLeafTexture = new THREE.CanvasTexture(canvas);
    return _cachedLeafTexture;
}

function placeLeaf(dummy, pos, tangent, normal, binormal, scale, isLeft) {
    dummy.position.copy(pos);
    const dirX = isLeft ? binormal.clone().negate() : binormal.clone();
    const forwardLean = 0.5;
    const droop = 0.3;
    const target = pos.clone().add(dirX).add(tangent.clone().multiplyScalar(forwardLean));
    target.y -= droop;
    dummy.lookAt(target);
    dummy.rotateX(Math.PI / 2);
    dummy.rotateY((Math.random() - 0.5) * 0.2);
    dummy.rotateZ((Math.random() - 0.5) * 0.2);
    const finalScale = scale * (0.8 + Math.random() * 0.4);
    dummy.scale.set(finalScale, finalScale, finalScale);
    dummy.updateMatrix();
}

function setLeafColor(mesh, index, t) {
    const color = new THREE.Color();
    const baseC = new THREE.Color(0x2d4c1e);
    const tipC = new THREE.Color(0x75d943);
    color.copy(baseC).lerp(tipC, t * 0.8 + 0.2);
    color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
    mesh.setColorAt(index, color);
}

// Builds one fern cluster (stems + instanced leaves) rooted at `origin`.
// Direct port of buildDetailedPlant(), just parameterized by origin
// instead of a fixed (0, rockRadius, 0), and scaled down (see length/
// baseScale comments below) since this is scattered ground undergrowth,
// not a single showcase centerpiece.
function buildFern(state, origin, numFronds) {
    const leafMat = new THREE.MeshPhysicalMaterial({
        color: 0x1d5c2e,
        emissive: 0x051a08,
        roughness: 0.35,
        metalness: 0.05,
        bumpMap: getLeafTexture(),
        bumpScale: 0.06,
        clearcoat: 0.45,
        clearcoatRoughness: 0.25,
        transmission: 0.4,
        thickness: 0.1,
        side: THREE.DoubleSide
    });

    leafMat.onBeforeCompile = (shader) => {
        shader.uniforms.time = state.foliageUniforms.time;
        shader.uniforms.windStrength = state.foliageUniforms.windStrength;
        shader.vertexShader = `uniform float time;\nuniform float windStrength;\n` + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            float flutter = sin(time * 3.0 + position.x * 10.0) * 0.05 * position.y * windStrength;
            transformed.z += flutter;
            transformed.x += flutter * 0.5;`
        );
    };

    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1a, roughness: 0.8 });
    stemMat.onBeforeCompile = (shader) => {
        shader.uniforms.time = state.foliageUniforms.time;
        shader.uniforms.windStrength = state.foliageUniforms.windStrength;
        shader.vertexShader = `uniform float time;\nuniform float windStrength;\n` + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            float swayAmount = max(0.0, position.y) * 0.02 * windStrength;
            transformed.x += sin(time * 1.5) * swayAmount;
            transformed.z += cos(time * 1.2) * swayAmount;`
        );
    };

    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    const detail = 28;
    for (let i = 1; i <= detail; i++) {
        const t = i / detail;
        let w = Math.sin(t * Math.PI) * 1.2;
        w += Math.abs(Math.sin(t * Math.PI * 14)) * 0.12;
        leafShape.lineTo(w, t * 4);
    }
    for (let i = detail - 1; i >= 0; i--) {
        const t = i / detail;
        let w = -Math.sin(t * Math.PI) * 1.2;
        w -= Math.abs(Math.sin(t * Math.PI * 14)) * 0.12;
        leafShape.lineTo(w, t * 4);
    }
    const leafGeo = new THREE.ShapeGeometry(leafShape);
    const posAttr = leafGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        let z = -Math.pow(y * 0.3, 2);
        z += Math.abs(x) * 0.45;
        posAttr.setZ(i, z);
    }
    leafGeo.computeVertexNormals();

    const leavesPerFrond = 24;
    const totalLeaves = numFronds * leavesPerFrond * 2;
    const leafInstancedMesh = new THREE.InstancedMesh(leafGeo, leafMat, totalLeaves);
    leafInstancedMesh.castShadow = true;
    leafInstancedMesh.receiveShadow = true;

    const leafDummy = new THREE.Object3D();
    let leafIndex = 0;
    const group = new THREE.Group();
    group.position.copy(origin);

    for (let i = 0; i < numFronds; i++) {
        const angle = (i / numFronds) * Math.PI * 2 + Math.random() * 0.4;
        const length = 4 + Math.random() * 3; // scaled down from the reference's 15-25 —
        // that plant was a showcase centerpiece on a 12-radius rock; a
        // scattered ground fern needs to read as undergrowth, not a
        // competing landmark next to actual trees.
        const archHeight = length * 0.8 + Math.random();
        const startPt = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6);
        const midPt = new THREE.Vector3(
            startPt.x + Math.cos(angle) * length * 0.4,
            startPt.y + archHeight,
            startPt.z + Math.sin(angle) * length * 0.4
        );
        const endPt = new THREE.Vector3(
            startPt.x + Math.cos(angle) * length,
            startPt.y + archHeight * 0.2 - Math.random() * 1.5,
            startPt.z + Math.sin(angle) * length
        );
        const curve = new THREE.CatmullRomCurve3([startPt, midPt, endPt]);
        const stemGeo = new THREE.TubeGeometry(curve, 32, 0.06, 6, false);
        const stemMesh = new THREE.Mesh(stemGeo, stemMat);
        stemMesh.castShadow = true;
        group.add(stemMesh);

        const frenetFrames = curve.computeFrenetFrames(leavesPerFrond, false);
        for (let j = 1; j <= leavesPerFrond; j++) {
            const t = j / leavesPerFrond;
            if (t < 0.1 || t > 0.98) continue;
            const point = curve.getPointAt(t);
            const tangent = frenetFrames.tangents[j];
            const normal = frenetFrames.normals[j];
            const binormal = frenetFrames.binormals[j];
            const sizeT = Math.sin(t * Math.PI);
            const baseScale = 0.15 + sizeT * 0.3; // scaled down to match the shorter stem length above

            placeLeaf(leafDummy, point, tangent, normal, binormal, baseScale, true);
            leafInstancedMesh.setMatrixAt(leafIndex, leafDummy.matrix);
            setLeafColor(leafInstancedMesh, leafIndex, t);
            leafIndex++;

            placeLeaf(leafDummy, point, tangent, normal, binormal, baseScale, false);
            leafInstancedMesh.setMatrixAt(leafIndex, leafDummy.matrix);
            setLeafColor(leafInstancedMesh, leafIndex, t);
            leafIndex++;
        }
    }

    leafInstancedMesh.count = leafIndex;
    leafInstancedMesh.instanceMatrix.needsUpdate = true;
    leafInstancedMesh.instanceColor.needsUpdate = true;
    group.add(leafInstancedMesh);
    return group;
}

// Scatters fern clusters across the terrain. Ground-level undergrowth, not
// the single showcase plant the reference built — see buildFern's length/
// scale comments above for the scale-down reasoning.
export async function createFerns(state, onProgress) {
    const { getElevation } = await import('./terrain.js');
    const FERN_RADIUS = 250;
    const clusterCount = 350;

    state.foliageUniforms = state.foliageUniforms || {
        time: { value: 0 },
        windStrength: { value: 1.0 }
    };

    state.fernGroup = new THREE.Group();
    let placed = 0;
    for (let i = 0; i < clusterCount * 3 && placed < clusterCount; i++) {
        const r = Math.sqrt(Math.random()) * FERN_RADIUS;
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z, state);
        if (y < 1.8) continue; // keep out of the lake, same threshold as flowers.js/grass.js
        if (Math.hypot(x - 0, z - 20) < 15) continue; // keep clear of the player's spawn point (0, _, 20) — a fern cluster landing right on/inside the camera read as a giant leaf filling the whole screen

        const fern = buildFern(state, new THREE.Vector3(x, y, z), 3 + Math.floor(Math.random() * 3));
        state.fernGroup.add(fern);
        placed++;

        if (placed % 40 === 0) {
            if (onProgress) onProgress(placed / clusterCount);
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    }
    state.scene.add(state.fernGroup);
}

// Moss + spore decorator, ported from buildMoss()/buildSpores(). Extracted
// to take an arbitrary rock geometry (environment/rocks.js will call this
// on whatever it builds) instead of owning a rock itself.
export function applyMoss(state, rockGeo, densityMult = 2) {
    const instancesPerVertex = densityMult === 3 ? 4 : (densityMult === 2 ? 2 : 1);
    const pos = rockGeo.attributes.position;
    const norm = rockGeo.attributes.normal;
    const vPos = new THREE.Vector3();
    const vNorm = new THREE.Vector3();
    const step = densityMult === 1 ? 2 : 1;

    const validPoints = [];
    for (let i = 0; i < pos.count; i += step) {
        vNorm.fromBufferAttribute(norm, i);
        if (vNorm.y > 0.1) {
            vPos.fromBufferAttribute(pos, i);
            for (let j = 0; j < instancesPerVertex; j++) {
                validPoints.push({
                    p: vPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4)),
                    n: vNorm.clone()
                });
            }
        }
    }

    const mossCount = validPoints.length;
    if (mossCount === 0) return null;

    // 0.15 scaled down from the reference's 0.25 — that rock was a
    // 12-radius showcase centerpiece; rocks in this project
    // (environment/rocks.js) are ground-scattered props, so moss needs to
    // read at that smaller scale.
    const mGeo = new THREE.TetrahedronGeometry(0.15 + Math.random() * 0.05, 1);
    const mMat = new THREE.MeshStandardMaterial({ roughness: 1.0, metalness: 0.0 });
    const mossMesh = new THREE.InstancedMesh(mGeo, mMat, mossCount);
    mossMesh.receiveShadow = true;
    mossMesh.castShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const baseColors = [0x3c6e26, 0x4a7c2f, 0x2d541b, 0x5a8f3b];

    for (let i = 0; i < mossCount; i++) {
        const data = validPoints[i];
        dummy.position.copy(data.p);
        dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), data.n);
        dummy.rotateY(Math.random() * Math.PI * 2);
        const s = 0.5 + Math.random() * 1.5;
        dummy.scale.set(s, s * 0.8, s);
        dummy.updateMatrix();
        mossMesh.setMatrixAt(i, dummy.matrix);
        color.setHex(baseColors[Math.floor(Math.random() * baseColors.length)]);
        color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
        mossMesh.setColorAt(i, color);
    }
    mossMesh.instanceMatrix.needsUpdate = true;
    mossMesh.instanceColor.needsUpdate = true;
    return mossMesh;
}

export function updateFoliage(state, ts) {
    if (state.foliageUniforms) {
        state.foliageUniforms.time.value = ts;
    }
}
