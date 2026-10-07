import * as THREE from 'three';
import { state, WORLD_SIZE } from '../core/state.js';
import { noise } from '../core/utils.js';
import { heightAt as getElevation } from '../core/heightmap.js';
import { grassAt, pathAt } from '../core/splat.js';

import { rngFor } from '../core/rng.js';
const rand = rngFor('flowers');

// Flower LOD (audit section 7): every placed flower (up to 19,000) drew every
// frame regardless of distance — a meadow you'll never walk is exactly as
// expensive as the one under your feet. Unlike rocks/pines/deciduous trees
// there's no far impostor; past FLOWER_CULL_RADIUS a flower patch reads as
// part of the grass/ground colour anyway (audit 5.1's "ground colour trick"),
// so distant flowers just aren't drawn at all rather than LOD-swapped. Same
// re-partition-on-movement pattern as rocks.js/pine-tree.js: flowerData holds
// every valid placement, updateFlowerLOD() compacts the in-range subset to
// the front of the (fixed-capacity) instanced buffers each time the player
// has moved far enough for the cull boundary to matter.
const FLOWER_CULL_RADIUS = 60;
const FLOWER_LOD_HYSTERESIS = 12;
let flowerData = []; // { matrix, stemMatrix, x, z, color: THREE.Color }
let lodLastPx = null, lodLastPz = null;

export function createFlowers() {
    const count = 19000; // was 12000, scaled by 1.64x world area
    
    // Manually construct crossed planes for foliage billboarding
    const basePlane = new THREE.PlaneGeometry(1.2, 1.2);
    basePlane.translate(0, 0.6, 0); // anchor at bottom
    const plane2 = basePlane.clone(); plane2.rotateY(Math.PI / 2);
    
    const pos1 = basePlane.attributes.position.array;
    const pos2 = plane2.attributes.position.array;
    const uv1 = basePlane.attributes.uv.array;
    
    const mergedPos = new Float32Array([...pos1, ...pos2]);
    const mergedUv = new Float32Array([...uv1, ...uv1]);
    const idx1 = basePlane.index.array;
    const idx2 = idx1.map(i => i + 4);
    const mergedIdx = new Uint16Array([...idx1, ...idx2]);
    
    const flowerGeo = new THREE.BufferGeometry();
    flowerGeo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    flowerGeo.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
    flowerGeo.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
    flowerGeo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ 
        color: 0xffffff, 
        map: state.globalTextures.flower,
        transparent: true,
        alphaTest: 0.3, // Removes background
        side: THREE.DoubleSide,
        roughness: 0.9 
    });
    
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        mat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime;`);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vec4 wPos = instanceMatrix * vec4(position, 1.0);
            // Beautiful organic wind sway tied to flower height
            transformed.x += sin(wPos.x * 4.0 + uTime * 1.5) * 0.15 * position.y;
            transformed.z += cos(wPos.z * 4.0 + uTime * 1.5) * 0.15 * position.y;
        `);
    };

    // Stems (B-10): thin tapered cylinder, separate InstancedMesh since it
    // needs its own green material instead of the flower head's texture/
    // alphaTest map. One extra draw call, not merged into flowerGeo above.
    const stemGeo = new THREE.CylinderGeometry(0.015, 0.025, 1, 4, 1);
    stemGeo.translate(0, 0.5, 0); // anchor at bottom, same as the head planes
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.95 });
    // B-10 (remaining half): heads swayed via the onBeforeCompile below on
    // `mat`, but this stem material had no shader hook at all, so a swaying
    // head sat on a perfectly rigid stem - visually disconnected up close.
    // Same sway formula (same wPos basis, same phase/amplitude), scaled by
    // this geometry's own position.y (0 at the planted base, 1 at the tip,
    // just like the head planes), so stem and head bend together instead of
    // the stem staying dead still underneath a moving head. uTime is fed by
    // atmosphere/day-night-cycle.js's generic `scene.traverse` sweep (it
    // feeds any material with userData.shader, not just hand-picked ones),
    // so adding that one assignment below is the only wiring this needs.
    stemMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        stemMat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime;`);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vec4 wPos = instanceMatrix * vec4(position, 1.0);
            transformed.x += sin(wPos.x * 4.0 + uTime * 1.5) * 0.15 * position.y;
            transformed.z += cos(wPos.z * 4.0 + uTime * 1.5) * 0.15 * position.y;
        `);
    };
    state.flowerStemMesh = new THREE.InstancedMesh(stemGeo, stemMat, count);
    state.flowerMesh = new THREE.InstancedMesh(flowerGeo, mat, count);
    // Capacity = count (every slot the placement loop could fill); .count
    // (how many actually draw) is set by updateFlowerLOD() below, every
    // frame-ish, to just the subset within FLOWER_CULL_RADIUS.
    state.flowerMesh.count = 0;
    state.flowerStemMesh.count = 0;
    state.flowerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    // Which flowers occupy these buffers keeps changing as the player moves
    // (same reasoning as rocks.js/pine-tree.js's LOD meshes), so skip the
    // frustum test entirely rather than cull against a stale bounding sphere.
    state.flowerMesh.frustumCulled = false;
    state.flowerStemMesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const stemDummy = new THREE.Object3D();
    // White Daisy, Blue Forget-me-not, Violet, Goldenrod
    const palette = [new THREE.Color(0xffffff), new THREE.Color(0x4488ff), new THREE.Color(0xa255ff), new THREE.Color(0xffcc22)];

    flowerData = [];
    let valid = 0;
    for (let i = 0; i < count * 3 && valid < count; i++) {
        const r = Math.sqrt(rand()) * (WORLD_SIZE * 0.35); // was hardcoded 280 (0.35 * old 800) -- now scales with world size
        const theta = rand() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z);
        
        const g = grassAt(x, z);
        if (g < 0.35 || pathAt(x, z) > 0.1) continue; // meadow only: grass mask, off trails (replaces the old y<4 line)
        if (y < 4.0) continue; // Match grass/forest's wet-sand line — flowers are meant to sink into grass (see below), so they shouldn't appear where grass doesn't grow
        
        const biome = noise(x * 0.02, z * 0.02);
        if (biome > 0.5) { // Cluster flower fields
            // Density mask (B-10, remaining half): the line above was a flat
            // yes/no on the same grassAt() channel grass itself reads, but
            // never used its actual VALUE - a texel at 0.36 (barely past the
            // floor) got placed exactly as readily as one at 0.95 (thick
            // grass), so clusters were uniformly dense everywhere above the
            // cutoff instead of thinning out toward the meadow's edges the
            // way the grass under them visibly does. Re-roll against g so
            // acceptance odds scale with it.
            if (rand() > g) continue;
            dummy.position.set(x, y - 0.1, z); // Sink into grass slightly
            dummy.rotation.set(0, rand()*Math.PI, 0); // Random spin
            const s = 0.25 + rand() * 0.25; // was 0.4-1.0: heads were dinner-plate sized
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();

            // Stem: same x/z/rotation, full height to the ground (not
            // sunk like the head) so it reads as planted, not floating.
            stemDummy.position.set(x, y, z);
            stemDummy.rotation.copy(dummy.rotation);
            stemDummy.scale.set(1, s * 1.1, 1); // length scales with head size, width stays thin
            stemDummy.updateMatrix();

            // Group colors by micro-biomes — since `biome` is smooth, spatially
            // continuous noise, nearby flowers land in the same palette bucket
            // already, which is most of what "patches of one colour" (section 7)
            // asks for; the cull below is this section's other half.
            const c = palette[Math.floor((biome - 0.5) * 2 * palette.length) % palette.length] || palette[0];
            flowerData.push({ matrix: dummy.matrix.clone(), stemMatrix: stemDummy.matrix.clone(), x, z, color: c });
            valid++;
        }
    }
    state.scene.add(state.flowerMesh);
    state.scene.add(state.flowerStemMesh);
    lodLastPx = null; lodLastPz = null; // force the first updateFlowerLOD() call to actually partition
}

// Re-partitions flowerData into the visible (<FLOWER_CULL_RADIUS) subset,
// compacted to the front of the fixed-capacity instanced buffers — same
// technique as rocks.js's updateRockLOD, minus the far mesh (flowers beyond
// the cull radius just aren't drawn; see the comment above flowerData).
export function updateFlowerLOD(px, pz) {
    if (!flowerData.length) return;
    if (lodLastPx !== null) {
        const moved = Math.hypot(px - lodLastPx, pz - lodLastPz);
        if (moved < FLOWER_LOD_HYSTERESIS) return;
    }
    lodLastPx = px; lodLastPz = pz;

    const r2 = FLOWER_CULL_RADIUS * FLOWER_CULL_RADIUS;
    let visI = 0;
    for (const f of flowerData) {
        const dx = f.x - px, dz = f.z - pz;
        if (dx * dx + dz * dz > r2) continue;
        state.flowerMesh.setMatrixAt(visI, f.matrix);
        state.flowerStemMesh.setMatrixAt(visI, f.stemMatrix);
        state.flowerMesh.instanceColor.setXYZ(visI, f.color.r, f.color.g, f.color.b);
        visI++;
    }
    state.flowerMesh.count = visI;
    state.flowerStemMesh.count = visI;
    state.flowerMesh.instanceMatrix.needsUpdate = true;
    state.flowerStemMesh.instanceMatrix.needsUpdate = true;
    state.flowerMesh.instanceColor.needsUpdate = true;
}

