// Bushes/undergrowth — ported from a user-provided FoliageSystem module
// (procedural branch-and-leaf-clump generator with wind shader
// injection). Scaled down and adapted from that module's original
// standalone-tree-canopy use (150k leaves / 2500 full trees, y=0 flat
// ground) into a low shrub/bush layer that sits on the real terrain and
// clusters around the forest this project already has:
//   - leafCount/numTrees cut way down (this project already has
//     forest.js/pine-trees.js for canopy — this module was duplicating
//     that at tree scale, not adding a bush layer)
//   - branch recursion depth 2 -> 1 and clumpHeight range 12 -> ~3.5, so
//     growBranch() produces shrub-sized shapes instead of full trees
//   - every position now goes through getElevation(x, z, state) instead
//     of assuming flat y=0 ground, and skips anything below the
//     waterline/beach band
//   - a second placement pass seeds bush clumps directly around existing
//     state.colliders entries (populated by forest.js/pine-trees.js), so
//     bushes actually cluster around trees rather than scattering
//     independently of them
//
// Wind shader injection, leaf geometry/bend, color-variation logic, and
// the branch LineSegments approach are otherwise unchanged from the
// source module.

import * as THREE from 'three';
import { getElevation } from './terrain.js';
import { WORLD_SIZE, WATER_LEVEL } from '../core/world-state.js';

const LEAF_COUNT = 45000;
const CLUSTER_COUNT = 700;       // independent bush clumps, noise-scattered
const UNDERGROWTH_PER_TREE = 3;  // extra small clumps seeded per existing collider
const SPREAD = WORLD_SIZE * 0.42; // stay inside the island's coastline (see terrain.js's coastStart)

// Bushes are a shoreline/wetland feature, not a whole-island ground cover —
// only plant within this band above the waterline. Below WATER_LEVEL+2.5
// is already excluded in plantBushAt (beach/underwater); this caps the
// upper edge so clumps don't creep inland across the whole map.
const BUSH_MAX_HEIGHT_ABOVE_WATER = 5.0;

function injectWindShader(shader, uniforms, isBranch) {
    shader.uniforms.time = uniforms.time;
    shader.vertexShader = `uniform float time;\n` + shader.vertexShader;

    let displacementLogic = '';
    if (!isBranch) {
        displacementLogic = `
            vec4 worldPos = instanceMatrix * vec4(position, 1.0);
            float windPhase = worldPos.x * 0.05 + worldPos.z * 0.05 + time;
            float windStrength = (sin(windPhase) + sin(windPhase * 2.3) * 0.5) * 0.12;

            float worldSway = smoothstep(0.0, 4.0, position.y) * 0.6;
            float localBend = smoothstep(0.0, 1.2, position.y) * 0.4;
            float totalSway = worldSway + localBend;

            transformed.x += windStrength * totalSway;
            transformed.z += windStrength * totalSway;
        `;
    } else {
        displacementLogic = `
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            float windPhase = worldPos.x * 0.05 + worldPos.z * 0.05 + time;
            float windStrength = (sin(windPhase) + sin(windPhase * 2.3) * 0.5) * 0.12;

            float worldSway = smoothstep(0.0, 4.0, position.y) * 0.6;

            transformed.x += windStrength * worldSway;
            transformed.z += windStrength * worldSway;
        `;
    }

    shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${displacementLogic}`
    );
}

export function createBushes(state) {
    const uniforms = { time: { value: 0 } };

    // --- Leaf geometry (unchanged from source module) ---
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.bezierCurveTo(0.4, 0.2, 0.4, 0.8, 0, 1.2);
    leafShape.bezierCurveTo(-0.4, 0.8, -0.4, 0.2, 0, 0);
    const leafGeometry = new THREE.ShapeGeometry(leafShape);
    const posAttribute = leafGeometry.attributes.position;
    for (let i = 0; i < posAttribute.count; i++) {
        const y = posAttribute.getY(i);
        const z = Math.sin(y * Math.PI * 0.8) * 0.15;
        posAttribute.setZ(i, z);
    }
    leafGeometry.computeVertexNormals();

    const leafMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
        metalness: 0.05,
        side: THREE.DoubleSide,
    });
    leafMaterial.onBeforeCompile = (shader) => injectWindShader(shader, uniforms, false);

    const depthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        alphaTest: 0.5,
    });
    depthMaterial.onBeforeCompile = (shader) => injectWindShader(shader, uniforms, false);

    const leavesMesh = new THREE.InstancedMesh(leafGeometry, leafMaterial, LEAF_COUNT);
    leavesMesh.customDepthMaterial = depthMaterial;
    leavesMesh.castShadow = true;
    leavesMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const branchVertices = [];
    let leafIndex = 0;

    const growBranch = (start, dir, length, depth) => {
        if (leafIndex >= LEAF_COUNT) return;
        const end = start.clone().add(dir.clone().multiplyScalar(length));
        end.x += (Math.random() - 0.5) * length * 0.4;
        end.z += (Math.random() - 0.5) * length * 0.4;

        branchVertices.push(start.x, start.y, start.z);
        branchVertices.push(end.x, end.y, end.z);

        if (depth > 0) {
            const numSplits = 2 + Math.floor(Math.random() * 2);
            for (let i = 0; i < numSplits; i++) {
                const newDir = dir.clone();
                newDir.x += (Math.random() - 0.5) * 1.2;
                newDir.y += (Math.random() - 0.1) * 0.5;
                newDir.z += (Math.random() - 0.5) * 1.2;
                newDir.normalize();
                growBranch(end, newDir, length * (0.6 + Math.random() * 0.3), depth - 1);
            }
        } else {
            const leavesHere = 8 + Math.floor(Math.random() * 6);
            for (let i = 0; i < leavesHere; i++) {
                if (leafIndex >= LEAF_COUNT) return;

                const lx = end.x + (Math.random() - 0.5) * 1.4;
                const ly = end.y + (Math.random() - 0.5) * 1.4;
                const lz = end.z + (Math.random() - 0.5) * 1.4;

                dummy.position.set(lx, ly, lz);
                dummy.rotation.set(
                    Math.random() * Math.PI,
                    Math.random() * Math.PI,
                    Math.random() * Math.PI * 0.2 - 0.1
                );
                const scale = 0.14 + Math.random() * 0.22; // shrunk down — was 0.4-0.9, way too large for a bush-scale leaf
                dummy.scale.set(scale, scale, scale);
                dummy.updateMatrix();
                leavesMesh.setMatrixAt(leafIndex, dummy.matrix);

                const mix = Math.random();
                if (mix < 0.7) {
                    color.setHSL(0.25 + Math.random() * 0.1, 0.5 + Math.random() * 0.4, 0.2 + Math.random() * 0.2);
                } else if (mix < 0.9) {
                    color.setHSL(0.15 + Math.random() * 0.05, 0.6 + Math.random() * 0.3, 0.3 + Math.random() * 0.2);
                } else {
                    color.setHSL(0.08 + Math.random() * 0.05, 0.4 + Math.random() * 0.2, 0.15 + Math.random() * 0.1);
                }
                leavesMesh.setColorAt(leafIndex, color);
                leafIndex++;
            }
        }
    };

    const plantBushAt = (bx, bz) => {
        const groundY = getElevation(bx, bz, state);
        if (groundY < WATER_LEVEL + 2.5) return; // keep off beach/underwater
        if (groundY > WATER_LEVEL + BUSH_MAX_HEIGHT_ABOVE_WATER) return; // shoreline band only — don't scatter inland across the whole island
        const clumpHeight = 1.2 + Math.random() * 2.3; // shrub height, not tree height
        const startPos = new THREE.Vector3(bx, groundY, bz);
        const startDir = new THREE.Vector3((Math.random() - 0.5) * 0.5, 1, (Math.random() - 0.5) * 0.5).normalize();
        growBranch(startPos, startDir, clumpHeight * 0.5, 1);
    };

    // --- Pass 1: independent clumps, noise-clustered same as the source
    // module's topography density map, just island-radius-bounded now.
    for (let t = 0; t < CLUSTER_COUNT; t++) {
        if (leafIndex >= LEAF_COUNT) break;
        const r = Math.random() * Math.random() * SPREAD;
        const theta = Math.random() * Math.PI * 2;
        const bx = r * Math.cos(theta);
        const bz = r * Math.sin(theta);

        const clumpDensity = (Math.sin(bx * 0.2) * Math.cos(bz * 0.2) * 0.5 + 0.5);
        if (clumpDensity < 0.35) continue;

        plantBushAt(bx, bz);
    }

    // --- Pass 2: undergrowth seeded right around existing tree colliders
    // (forest.js/pine-trees.js), so bushes actually read as "around
    // trees" instead of just independently scattered.
    if (state.colliders && state.colliders.length) {
        for (const c of state.colliders) {
            if (leafIndex >= LEAF_COUNT) break;
            for (let i = 0; i < UNDERGROWTH_PER_TREE; i++) {
                if (leafIndex >= LEAF_COUNT) break;
                const ang = Math.random() * Math.PI * 2;
                const dist = (c.r || 1) * (1.1 + Math.random() * 1.8);
                plantBushAt(c.x + Math.cos(ang) * dist, c.z + Math.sin(ang) * dist);
            }
        }
    }

    leavesMesh.count = leafIndex;
    leavesMesh.instanceMatrix.needsUpdate = true;
    leavesMesh.instanceColor.needsUpdate = true;
    state.scene.add(leavesMesh);

    const branchGeo = new THREE.BufferGeometry();
    branchGeo.setAttribute('position', new THREE.Float32BufferAttribute(branchVertices, 3));
    const branchMat = new THREE.LineBasicMaterial({
        color: 0x1a110a,
        transparent: true,
        opacity: 0.85,
    });
    branchMat.onBeforeCompile = (shader) => injectWindShader(shader, uniforms, true);

    const branchesMesh = new THREE.LineSegments(branchGeo, branchMat);
    state.scene.add(branchesMesh);

    state.bushUniforms = uniforms;
    state.bushLeavesMesh = leavesMesh;
    state.bushBranchesMesh = branchesMesh;
}

// Called every frame from main.js's animate() loop.
export function updateBushes(state, ts) {
    if (state.bushUniforms) {
        state.bushUniforms.time.value = ts;
    }
}