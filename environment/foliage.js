// Ported from a standalone Three.js r128 demo (single-file, global THREE,
// its own renderer/camera/OrbitControls/UI panel, SimplexNoise CDN dep)
// into a proper Silvan module. Not a drop-in — the source was a self-
// contained showcase scene (one plant + one mossy rock centered at the
// origin, own render loop), not a placeable piece of world content, so
// this rebuilds the same generation logic (fern fronds via Catmull-Rom
// stems + Frenet-frame leaf placement, tetrahedron moss clumps) as
// terrain-scattered clusters using this project's conventions instead:
// ES module import of THREE (not the r128 global), state.scene /
// state.quality / getElevation() like every other environment/*.js file,
// no bundled SimplexNoise (moss patchiness uses a cheap sine-based hash
// instead — one extra dependency avoided for a purely cosmetic patchiness
// check), and material.userData.shader = shader + addDynamicFog() so wind
// sway and fog both pick up the existing per-frame update conventions
// (see atmosphere/day-night-cycle.js's scene.traverse and
// fx/dynamic-fog.js) instead of the demo's own animate() loop.
//
// Two exports: createFerns (the big arching fronds — a sparse "hero flora"
// accent, not ground cover) and createMossClusters (small clumps scattered
// more densely near rock/tree bases). Call both from main.js after
// createRocks/generateFractalForest so getElevation() reflects final
// terrain and moss reads as growing near what's already been placed.

import * as THREE from 'three';
import { WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from './terrain.js';
import { addDynamicFog } from '../fx/dynamic-fog.js';

let cachedLeafTexture = null;

// Cheap deterministic hash standing in for the demo's SimplexNoise dep —
// only used for moss patchiness (a "does this spot get moss or not" cull),
// which doesn't need real coherent noise, just something less regular than
// pure Math.random() clumping.
function hash2(x, z) {
    const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return s - Math.floor(s);
}

// Procedural leaf vein texture, used as a bump map — same technique as the
// source file (painted midrib + lateral veins + fine vein network onto
// per-pixel noise), cached module-wide since every leaf instance shares one
// material/texture.
function getLeafTexture() {
    if (cachedLeafTexture) return cachedLeafTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#666666';
    ctx.fillRect(0, 0, 512, 1024);

    const imgData = ctx.getImageData(0, 0, 512, 1024);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 15;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i+1] = data[i];
        data[i+2] = data[i];
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 14;
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.moveTo(256, 1024);
    ctx.lineTo(256, 10);
    ctx.stroke();

    ctx.shadowBlur = 4;
    ctx.lineWidth = 4.5;
    for (let y = 1000; y > 60; y -= 45) {
        const offsetR = Math.random() * 15;
        const offsetL = Math.random() * 15;
        ctx.beginPath();
        ctx.moveTo(256, y - offsetR);
        ctx.quadraticCurveTo(390, y - offsetR - 60, 510, y - offsetR - 130);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(256, y - offsetL);
        ctx.quadraticCurveTo(122, y - offsetL - 60, 2, y - offsetL - 130);
        ctx.stroke();
    }

    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 1;
    for (let y = 980; y > 80; y -= 12) {
        ctx.beginPath();
        ctx.moveTo(256, y);
        ctx.quadraticCurveTo(350, y - 25, 480, y - 40 + Math.random() * 40);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(256, y);
        ctx.quadraticCurveTo(162, y - 25, 32, y - 40 + Math.random() * 40);
        ctx.stroke();
    }

    cachedLeafTexture = new THREE.CanvasTexture(canvas);
    cachedLeafTexture.anisotropy = 4;
    return cachedLeafTexture;
}

function buildLeafGeometry() {
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
    return leafGeo;
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

// Fern clusters — a handful of arching fronds sharing one origin. Sparse
// "hero flora" accent (like the radio tower or a mossy boulder), not ground
// cover, so counts stay modest even at High quality.
export function createFerns(state) {
    const CLUSTER_COUNT = state.quality.fernClusterCount;
    if (!CLUSTER_COUNT) return;

    // Was a full-map scatter (radius up to WORLD_SIZE*0.4 from origin) —
    // moved to hug the lake basin instead, since the source scene's whole
    // concept was moss/ferns growing on a rock right at water's edge.
    // The basin dip in terrain.js's getElevation() is centered on the
    // origin with a ~160-unit radius; shoreline (dry ground close to
    // WATER_LEVEL) lands roughly in this annulus around it.
    const SHORE_MIN = 90;
    const SHORE_MAX = 230;
    const frondsPerCluster = 5;
    const leavesPerFrond = 24;

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
        side: THREE.DoubleSide,
    });
    leafMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        leafMat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            float flutter = sin(uTime * 3.0 + position.x * 10.0) * 0.05 * position.y;
            transformed.z += flutter;
            transformed.x += flutter * 0.5;`
        );
    };
    addDynamicFog(leafMat, state.backgroundRenderTarget.texture);

    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1a, roughness: 0.8 });
    stemMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        stemMat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            float swayAmount = max(0.0, position.y) * 0.02;
            transformed.x += sin(uTime * 1.5) * swayAmount;
            transformed.z += cos(uTime * 1.2) * swayAmount;`
        );
    };
    addDynamicFog(stemMat, state.backgroundRenderTarget.texture);

    const leafGeo = buildLeafGeometry();
    const totalLeaves = CLUSTER_COUNT * frondsPerCluster * leavesPerFrond * 2;
    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, totalLeaves);
    leafMesh.castShadow = true;
    leafMesh.receiveShadow = true;

    const stemGroup = new THREE.Group();
    const dummy = new THREE.Object3D();
    let leafIndex = 0;

    for (let c = 0; c < CLUSTER_COUNT; c++) {
        // Ring around the lake basin instead of a full-map scatter, plus a
        // dry check AND an upper elevation cap — the cap is what actually
        // keeps clusters hugging the shoreline instead of just being
        // "somewhere in the general annulus but possibly well up a hillside".
        let cx, cz, cy;
        let attempts = 0;
        do {
            const r = SHORE_MIN + Math.random() * (SHORE_MAX - SHORE_MIN);
            const th = Math.random() * Math.PI * 2;
            cx = Math.cos(th) * r; cz = Math.sin(th) * r;
            cy = getElevation(cx, cz);
            attempts++;
        } while ((cy < WATER_LEVEL + 0.4 || cy > WATER_LEVEL + 7) && attempts < 12);
        if (cy < WATER_LEVEL + 0.4 || cy > WATER_LEVEL + 7) continue; // gave up finding shoreline — skip rather than plant inland or in the lake

        const clusterScale = 0.5 + Math.random() * 0.5; // smaller than the demo's giant single showcase plant

        for (let i = 0; i < frondsPerCluster; i++) {
            const angle = (i / frondsPerCluster) * Math.PI * 2 + Math.random() * 0.4;
            const length = (8 + Math.random() * 6) * clusterScale;
            const archHeight = length * 0.8 + Math.random() * 2;

            const startPt = new THREE.Vector3(cx + (Math.random() - 0.5) * 1.5, cy + 0.3, cz + (Math.random() - 0.5) * 1.5);
            const midPt = new THREE.Vector3(
                startPt.x + Math.cos(angle) * length * 0.4,
                startPt.y + archHeight,
                startPt.z + Math.sin(angle) * length * 0.4
            );
            const endPt = new THREE.Vector3(
                startPt.x + Math.cos(angle) * length,
                startPt.y + archHeight * 0.2 - Math.random() * 3,
                startPt.z + Math.sin(angle) * length
            );

            const curve = new THREE.CatmullRomCurve3([startPt, midPt, endPt]);
            const stemGeo = new THREE.TubeGeometry(curve, 24, 0.12 * clusterScale, 6, false);
            const stemMesh = new THREE.Mesh(stemGeo, stemMat);
            stemMesh.castShadow = true;
            stemGroup.add(stemMesh);

            const frenetFrames = curve.computeFrenetFrames(leavesPerFrond, false);
            for (let j = 1; j <= leavesPerFrond; j++) {
                const t = j / leavesPerFrond;
                if (t < 0.1 || t > 0.98) continue;
                const point = curve.getPointAt(t);
                const tangent = frenetFrames.tangents[j];
                const normal = frenetFrames.normals[j];
                const binormal = frenetFrames.binormals[j];
                const sizeT = Math.sin(t * Math.PI);
                const baseScale = (0.4 + sizeT * 1.1) * clusterScale;

                if (leafIndex >= totalLeaves) continue;
                placeLeaf(dummy, point, tangent, normal, binormal, baseScale, true);
                leafMesh.setMatrixAt(leafIndex, dummy.matrix);
                setLeafColor(leafMesh, leafIndex, t);
                leafIndex++;

                if (leafIndex >= totalLeaves) continue;
                placeLeaf(dummy, point, tangent, normal, binormal, baseScale, false);
                leafMesh.setMatrixAt(leafIndex, dummy.matrix);
                setLeafColor(leafMesh, leafIndex, t);
                leafIndex++;
            }
        }
    }

    leafMesh.count = leafIndex;
    leafMesh.instanceMatrix.needsUpdate = true;
    leafMesh.instanceColor.needsUpdate = true;
    state.scene.add(leafMesh);
    state.scene.add(stemGroup);
}

// Small tetrahedron moss clumps — scattered around the lake shoreline
// rather than map-wide, same annulus as createFerns above, since the
// source scene's whole concept was moss growing on a rock at water's edge.
export function createMossClusters(state) {
    const mossCount = state.quality.mossCount;
    if (!mossCount) return;

    const SHORE_MIN = 85;
    const SHORE_MAX = 240; // slightly wider than the fern annulus so moss forms a looser halo around the fern clusters
    const mGeo = new THREE.TetrahedronGeometry(0.28, 1);
    const mMat = new THREE.MeshStandardMaterial({ roughness: 1.0, metalness: 0.0 });
    addDynamicFog(mMat, state.backgroundRenderTarget.texture);

    const mossMesh = new THREE.InstancedMesh(mGeo, mMat, mossCount);
    mossMesh.receiveShadow = true;
    mossMesh.castShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const baseColors = [0x3c6e26, 0x4a7c2f, 0x2d541b, 0x5a8f3b];

    let idx = 0;
    let guard = 0;
    while (idx < mossCount && guard < mossCount * 6) {
        guard++;
        const r = SHORE_MIN + Math.random() * (SHORE_MAX - SHORE_MIN);
        const th = Math.random() * Math.PI * 2;
        const x = Math.cos(th) * r;
        const z = Math.sin(th) * r;

        // Patchy, not uniform — same "is this spot in a patch" idea as the
        // source's simplex threshold, via the cheap hash above.
        if (hash2(x * 0.08, z * 0.08) < 0.55) continue;

        const y = getElevation(x, z);
        if (y < WATER_LEVEL + 0.15 || y > WATER_LEVEL + 9) continue; // no moss on the lake surface, and cap keeps it hugging the shore rather than drifting inland

        dummy.position.set(x + (Math.random() - 0.5) * 0.6, y + 0.05, z + (Math.random() - 0.5) * 0.6);
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        const s = 0.5 + Math.random() * 1.2;
        dummy.scale.set(s, s * 0.8, s);
        dummy.updateMatrix();
        mossMesh.setMatrixAt(idx, dummy.matrix);

        color.setHex(baseColors[Math.floor(Math.random() * baseColors.length)]);
        color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
        mossMesh.setColorAt(idx, color);
        idx++;
    }

    mossMesh.count = idx;
    mossMesh.instanceMatrix.needsUpdate = true;
    mossMesh.instanceColor.needsUpdate = true;
    state.scene.add(mossMesh);
}
