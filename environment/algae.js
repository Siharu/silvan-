// Shoreline algae — clumps of flattened, irregular blobs scattered along
// the wet-sand band (the same elevation range terrain.js's shader already
// treats as "wet sand": roughly WATER_LEVEL-2.2 to WATER_LEVEL+0.3 — see
// its uCWet smoothstep(-0.6, 1.4, h) with WATER_LEVEL=1.6). Placed in small
// clumps (a handful of blobs per clump center) rather than a uniform
// scatter, since real shoreline algae collects in patches, not an even
// carpet. Flat-shaded, two dark green/olive tones mixed per-instance —
// same "cheap primitive, not a fake photoreal asset" honesty standard as
// fx/rain.js's particles and environment/npc-dog.js's placeholder body;
// there's no algae texture or model in the project.
//
// Unverified (no WebGL in this environment, never rendered) — reasoning
// only, same as everything else built this session.
import * as THREE from 'three';
import { state, WATER_LEVEL } from '../core/state.js';
import { heightAt as getElevation } from '../core/heightmap.js';
import { rngFor } from '../core/rng.js';

const rand = rngFor('algae');

const CLUMP_COUNT = 70;         // number of clump centers tried across the map
const BLOBS_PER_CLUMP_MIN = 3;
const BLOBS_PER_CLUMP_MAX = 7;
const CLUMP_SPREAD = 2.2;       // how far blobs scatter from their clump's center, in world units
const WET_LO = WATER_LEVEL - 2.2; // below this it's deep enough that terrain.js already reads as ocean floor, not shore
const WET_HI = WATER_LEVEL + 0.3; // above this it's into the dry-sand blend, too dry for algae to cling

function buildBlobGeometry() {
    // A single low, irregular flattened blob: an icosahedron squashed flat
    // and jittered per-vertex so instances don't look like identical
    // stamped discs once scattered.
    const geo = new THREE.IcosahedronGeometry(0.3, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const jitter = 0.18;
        pos.setXYZ(
            i,
            x + (rand() - 0.5) * jitter,
            y * 0.22 + (rand() - 0.5) * 0.04, // squash flat
            z + (rand() - 0.5) * jitter
        );
    }
    geo.computeVertexNormals();
    return geo;
}

export function createAlgae() {
    const geo = buildBlobGeometry();
    const mat = new THREE.MeshStandardMaterial({
        color: 0x3d4a28,
        roughness: 0.75,
        flatShading: true,
    });

    // Upper bound on instances — not every clump center will land in the
    // wet band (most of the map isn't shoreline), so this is a ceiling,
    // not the actual count.
    const maxInstances = CLUMP_COUNT * BLOBS_PER_CLUMP_MAX;
    const mesh = new THREE.InstancedMesh(geo, mat, maxInstances);
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let count = 0;
    const WORLD_HALF = 1500; // generous scatter radius — well within WORLD_SIZE=3200's play area, same ballpark as puddles.js's own spread

    for (let c = 0; c < CLUMP_COUNT; c++) {
        const cx = (rand() - 0.5) * WORLD_HALF * 2;
        const cz = (rand() - 0.5) * WORLD_HALF * 2;
        const cy = getElevation(cx, cz);
        if (cy < WET_LO || cy > WET_HI) continue; // not shoreline here — skip this clump entirely

        const blobs = BLOBS_PER_CLUMP_MIN + Math.floor(rand() * (BLOBS_PER_CLUMP_MAX - BLOBS_PER_CLUMP_MIN + 1));
        for (let b = 0; b < blobs && count < maxInstances; b++) {
            const ox = (rand() - 0.5) * CLUMP_SPREAD * 2;
            const oz = (rand() - 0.5) * CLUMP_SPREAD * 2;
            const bx = cx + ox, bz = cz + oz;
            const by = getElevation(bx, bz);
            if (by < WET_LO - 0.5 || by > WET_HI + 0.2) continue; // a clump straddling the band's edge can drift a blob out of it

            dummy.position.set(bx, by + 0.03, bz);
            const s = 0.6 + rand() * 0.9;
            dummy.scale.set(s, 0.5 + rand() * 0.4, s);
            dummy.rotation.set(0, rand() * Math.PI * 2, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(count++, dummy.matrix);
        }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;

    // Per-instance color variance (dark olive <-> darker green) so a clump
    // doesn't read as one flat-colored stamp — same instanceColor pattern
    // already used by this project's grass/flower instancing.
    const colorA = new THREE.Color(0x3d4a28);
    const colorB = new THREE.Color(0x24331c);
    const tmpColor = new THREE.Color();
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 3), 3);
    for (let i = 0; i < count; i++) {
        tmpColor.copy(colorA).lerp(colorB, rand());
        mesh.setColorAt(i, tmpColor);
    }
    mesh.instanceColor.needsUpdate = true;

    state.algaeMesh = mesh;
    state.scene.add(mesh);
    return mesh;
}
