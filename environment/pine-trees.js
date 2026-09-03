// Detailed standalone pine trees — a single richly-branched, high-vertex
// tree design (trunk + merged branch tubes + instanced needles), adapted
// from a standalone tree-viewer reference build. Too expensive to spawn at
// TREE_COUNT (380) density, so these are placed sparsely as landmark trees
// instead: see PINE_TREE_COUNT below. The old low-poly layered-cone pine
// variant that used to live inside generateFractalForest() (forest.js) has
// been removed — all procedurally-generated forest trees are now the
// deciduous/maple fractal-branch type, and pines exclusively come from here.

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_SIZE, WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from './terrain.js';
// addDynamicFog import removed — dynamic fog itself was removed for
// performance, see main.js.

export const PINE_TREE_COUNT = 16;

const BARK_MATERIAL = new THREE.MeshStandardMaterial({
    color: 0x4a3424,
    roughness: 0.9,
    metalness: 0.05,
});

const NEEDLE_MATERIAL = new THREE.MeshStandardMaterial({
    color: 0x2e5c33, // deep pine green
    roughness: 0.8,
    metalness: 0.1,
    side: THREE.DoubleSide,
});

// Shared needle geometry — one triangular-cross-section cylinder, instanced
// per tree (each tree gets its own InstancedMesh since counts vary per tree).
const NEEDLE_GEO = new THREE.CylinderGeometry(0.005, 0.015, 0.4, 3);
NEEDLE_GEO.translate(0, 0.2, 0); // pivot at base
NEEDLE_GEO.rotateX(Math.PI / 2); // point outward

function collectNeedleMatrices(matrices, dummy, curve, curveLength, radius, density) {
    // Was called once per short curve sub-segment (~7x per branch), each
    // call independently computing numNeedles as if sizing the WHOLE
    // branch — that 7x redundancy stacked on top of an already-high
    // density*2.5 multiplier produced ~523,000 needle instances per tree
    // (~8.3 million across 16 trees), which is what was actually causing
    // the lag, not just visual clutter. This now takes the branch's full
    // curve and computes the needle count exactly once, distributed along
    // its whole length.
    const numNeedles = Math.max(2, Math.floor(curveLength * density));
    for (let i = 0; i < numNeedles; i++) {
        const t = i / numNeedles;
        const pos = curve.getPoint(t);
        const tangent = curve.getTangent(t);
        const lookTarget = pos.clone().add(tangent);
        pos.add(new THREE.Vector3(
            (Math.random() - 0.5) * radius * 0.5,
            (Math.random() - 0.5) * radius * 0.5,
            (Math.random() - 0.5) * radius * 0.5
        ));

        dummy.position.copy(pos);
        dummy.lookAt(lookTarget);

        const angle = Math.random() * Math.PI * 2;
        const upBias = (Math.sin(angle) > 0 ? 0.3 : 0);
        dummy.rotateZ(angle);
        dummy.rotateX(Math.PI / 2 - 0.4 - Math.random() * 0.3 + upBias);

        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
    }
}

// Builds one detailed pine tree as a THREE.Group (trunk mesh + merged-branch
// mesh + instanced needle mesh). Not added to the scene — caller positions
// and adds it. `treeHeight` lets placement vary tree size a little.
function buildDetailedPineTree(treeHeight = 25) {
    const trunkRadiusBottom = 1.2 * (treeHeight / 25);
    const trunkRadiusTop = 0.1 * (treeHeight / 25);
    const trunkSegments = 12;
    const trunkHeightSegments = Math.max(4, Math.floor(treeHeight * 0.8));

    const treeGroup = new THREE.Group();

    // --- trunk ---
    const trunkGeo = new THREE.CylinderGeometry(
        trunkRadiusTop, trunkRadiusBottom, treeHeight,
        trunkSegments, trunkHeightSegments, false
    );
    const positionAttribute = trunkGeo.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);
        const heightFactor = (vertex.y + treeHeight / 2) / treeHeight;
        const noise = (Math.random() - 0.5) * 0.15 * (1 - heightFactor * 0.5);
        const angle = Math.atan2(vertex.z, vertex.x);
        const ridge = Math.sin(angle * 12) * 0.05;
        if (vertex.y > -treeHeight / 2 + 0.1) {
            vertex.x += Math.cos(angle) * (noise + ridge);
            vertex.z += Math.sin(angle) * (noise + ridge);
        }
        const bend = Math.sin(heightFactor * Math.PI) * 0.5;
        vertex.x += bend;
        positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    trunkGeo.computeVertexNormals();

    const trunkMesh = new THREE.Mesh(trunkGeo, BARK_MATERIAL);
    trunkMesh.position.y = treeHeight / 2;
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    treeGroup.add(trunkMesh);

    // --- branches + needles ---
    const numWhorls = 16;
    const branchesPerWhorl = 6;
    const branchGeometries = [];
    const needleMatrices = [];
    const dummy = new THREE.Object3D();

    for (let w = 0; w < numWhorls; w++) {
        const heightFactor = 0.1 + (0.85 * (w / (numWhorls - 1)));
        const yPos = heightFactor * treeHeight;
        const trunkBend = Math.sin(heightFactor * Math.PI) * 0.5;
        const whorlRadius = (1.0 - heightFactor) * (treeHeight * 0.36);
        const branchThickness = (1.0 - heightFactor) * 0.25 + 0.05;
        const currentBranches = Math.max(4, Math.floor(branchesPerWhorl * (1.1 - heightFactor)));
        const angleOffset = Math.random() * Math.PI;

        for (let b = 0; b < currentBranches; b++) {
            const angle = (b / currentBranches) * Math.PI * 2 + angleOffset;
            const droop = -0.2 + (heightFactor * 0.6);
            const dir = new THREE.Vector3(Math.cos(angle), droop, Math.sin(angle)).normalize();
            const length = Math.max(0.2, whorlRadius * (0.8 + Math.random() * 0.4));

            const trunkRadAtHeight = (trunkRadiusBottom * (1 - heightFactor) + trunkRadiusTop * heightFactor) * 0.2;
            const startPos = new THREE.Vector3(
                (Math.cos(angle) * trunkRadAtHeight) + trunkBend,
                yPos,
                Math.sin(angle) * trunkRadAtHeight
            );
            const endPos = new THREE.Vector3().copy(startPos).add(dir.clone().multiplyScalar(length));
            const midPos = new THREE.Vector3().lerpVectors(startPos, endPos, 0.5);
            midPos.y -= length * 0.15 * (1 - heightFactor);

            const curve = new THREE.QuadraticBezierCurve3(startPos, midPos, endPos);
            const tubularSegments = Math.max(3, Math.floor(length * 2));
            const branchGeo = new THREE.TubeGeometry(curve, tubularSegments, branchThickness, 5, false);
            branchGeometries.push(branchGeo);

            // Was: loop over 7 short curve sub-segments each independently
            // sizing needles as if for the whole branch (see
            // collectNeedleMatrices' comment) — now one call per branch,
            // density dropped from 180*2.5=450/unit to 14/unit.
            collectNeedleMatrices(needleMatrices, dummy, curve, length, branchThickness, 14);

            const numSubBranches = Math.max(1, Math.floor(length * 1.8));
            for (let sb = 0; sb < numSubBranches; sb++) {
                const t = 0.15 + (0.85 * (sb / numSubBranches)) + (Math.random() * 0.1 - 0.05);
                if (t >= 1.0) continue;

                const sbStart = curve.getPoint(t);
                const tangent = curve.getTangent(t);
                const perpendicular = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
                const side = (sb % 2 === 0) ? 1 : -1;
                perpendicular.applyAxisAngle(tangent, side * (Math.PI / 2 - 0.2 + Math.random() * 0.4));

                const sbLength = Math.max(0.1, length * (1 - t) * 0.6 * (0.8 + Math.random() * 0.4));
                const sbDir = tangent.clone().multiplyScalar(0.5).add(perpendicular.clone().multiplyScalar(0.8)).normalize();
                sbDir.y -= 0.2;
                sbDir.normalize();

                const sbEnd = new THREE.Vector3().copy(sbStart).add(sbDir.multiplyScalar(sbLength));
                const sbCurve = new THREE.LineCurve3(sbStart, sbEnd);
                const sbGeo = new THREE.TubeGeometry(sbCurve, 2, branchThickness * 0.4, 3, false);
                branchGeometries.push(sbGeo);

                collectNeedleMatrices(needleMatrices, dummy, sbCurve, sbLength, branchThickness * 0.4, 22);
            }
        }
    }

    if (branchGeometries.length > 0) {
        const mergedBranches = BufferGeometryUtils.mergeGeometries(branchGeometries);
        const branchesMesh = new THREE.Mesh(mergedBranches, BARK_MATERIAL);
        branchesMesh.castShadow = true;
        branchesMesh.receiveShadow = true;
        treeGroup.add(branchesMesh);
    }

    // top cap needles
    const topBend = Math.sin(Math.PI) * 0.5;
    const belowTopBend = Math.sin(((treeHeight - 0.5) / treeHeight) * Math.PI) * 0.5;
    const topPos = new THREE.Vector3(topBend, treeHeight, 0);
    const slightlyBelowTop = new THREE.Vector3(belowTopBend, treeHeight - 0.5, 0);
    const topCurve = new THREE.LineCurve3(slightlyBelowTop, topPos);
    collectNeedleMatrices(needleMatrices, dummy, topCurve, 0.5, trunkRadiusTop, 22);

    const needleInstancedMesh = new THREE.InstancedMesh(NEEDLE_GEO, NEEDLE_MATERIAL, needleMatrices.length);
    needleInstancedMesh.castShadow = true;
    needleInstancedMesh.receiveShadow = true;
    for (let i = 0; i < needleMatrices.length; i++) {
        needleInstancedMesh.setMatrixAt(i, needleMatrices[i]);
    }
    treeGroup.add(needleInstancedMesh);

    return treeGroup;
}

// Scatters PINE_TREE_COUNT detailed pine trees across the map, on land,
// away from the lake, with basic minimum spacing between them so they read
// as individual landmarks rather than a clump. Pushes a trunk collider for
// each onto state.colliders.
export function createDetailedPineTrees(state, count = PINE_TREE_COUNT) {
    // BARK_MATERIAL/NEEDLE_MATERIAL are module-level constants (shared
    // across every pine instance) — dynamic fog removed for performance
    // (see main.js), materials now use the built-in flat-color fog.

    const placed = [];
    const minSpacing = 60;
    let attempts = 0;

    while (placed.length < count && attempts < count * 40) {
        attempts++;
        const r = 30 + Math.random() * (WORLD_SIZE / 2 - 60);
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z, state);

        if (y < WATER_LEVEL + 2.5) continue; // keep off the shoreline/lake
        if (Math.hypot(x - 0, z - 20) < 12) continue; // keep clear of player spawn (0, _, 20)

        const tooClose = placed.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < minSpacing * minSpacing);
        if (tooClose) continue;

        placed.push({ x, z, y });
    }

    for (const { x, z, y } of placed) {
        const heightScale = 0.85 + Math.random() * 0.35;
        const treeHeight = 22 * heightScale;
        const tree = buildDetailedPineTree(treeHeight);
        tree.position.set(x, y, z);
        tree.rotation.y = Math.random() * Math.PI * 2;
        state.scene.add(tree);
        state.colliders.push({ x, z, r: 1.3 * heightScale });
    }
}