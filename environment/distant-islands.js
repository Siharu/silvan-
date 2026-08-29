// Scattered small islet silhouettes out on the ocean — the "wait, there's
// more world out there" background detail, so the horizon reads as an
// actual open sea with other land in the distance rather than a flat blue
// plane bounded by a wall of mountains in every direction.
//
// Deliberately built the same way environment/mountain-boundary.js's rings
// are: unlit MeshBasicMaterial (there's no scene lighting worth paying for
// on something this far away and this small on screen), BACKGROUND_LAYER
// so fx/dynamic-fog.js's screen-space background pass captures them behind
// real foreground geometry, and the same uBrightness day/night uniform
// mountain-boundary.js uses (fed generically for any material that
// declares it — see atmosphere/day-night-cycle.js) so these dim at night
// and under cloud cover exactly like the mountain backdrop does, instead of
// reading as a fixed painted sticker regardless of time of day.
//
// Placed across the open water between the coastline (BASE_BOUNDARY_RADIUS,
// ~575) and most of the way out to the ocean disc's own outer edge
// (environment/ocean.js, WORLD_SIZE*1.2) — now that mountain-boundary.js's
// painted ring is gone, this is the entire visible stretch of sea, not just
// a narrow strip before a backdrop wall, so islets are scattered much
// further out to actually fill it and sell the "vast ocean, more land out
// there" read. Random per reload (Math.random(), same convention
// environment/pine-trees.js and rocks.js already use for placement — this
// isn't meant to be a stable seed players can memorize).

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
import { OCEAN_LEVEL } from '../core/world-state.js';
import { islandRadiusAt } from './terrain.js';
import { BACKGROUND_LAYER } from '../fx/dynamic-fog.js';

const ISLAND_COUNT = 18; // was 10 — the placement band widened a lot below (see outerR), 10 islets would now read as sparse/empty across most of the open water
const INNER_MARGIN = 25; // stay this far outside the coastline so islands never poke up out of water that's actually walkable/visible up close
const OUTER_MARGIN = 20; // stay this far inside the ocean disc's own outer edge (environment/ocean.js) so nothing pokes past where the water mesh itself ends

// Cheap hash-based jitter — same sin-scramble trick as rocks.js's hash3,
// just 1D-in/1D-out since an islet's silhouette only needs per-angle radius
// jitter, not full 3D noise.
function hash(n) {
    return (Math.sin(n * 127.1) * 43758.5453) % 1;
}

// One low-poly islet: an irregular jittered cone (a rounded hill silhouette,
// not a sharp mountain peak — these are meant to read as small tropical/
// forested islets, not another mountain range) plus a flatter, wider base
// disc so it doesn't look like it's floating right at the waterline.
function buildIslet(seed, radius, height) {
    const segments = 10 + Math.floor(hash(seed * 3.1) * 6); // 10-15, enough to read as organic at this silhouette size without wasting triangles on something this small on screen
    const geo = new THREE.ConeGeometry(radius, height, segments, 3, true);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const angle = Math.atan2(z, x);
        // Jitter radius per-angle (not per-vertex-ring) so the whole vertical
        // edge at a given angle moves together — an irregular coastline
        // silhouette from every ring, not a noisy/spiky surface.
        const jitter = 1 + (hash(seed * 7.7 + angle * 3.0) - 0.5) * 0.5;
        pos.setX(i, x * jitter);
        pos.setZ(i, z * jitter);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.translate(0, height / 2, 0); // ConeGeometry is centered on its own axis — lift so y=0 is the waterline, not the island's vertical middle
    return geo;
}

export function createDistantIslands(state) {
    const group = new THREE.Group();
    const usedAngles = [];
    const MIN_ANGLE_GAP = (Math.PI * 2) / (ISLAND_COUNT * 1.8); // keeps islets from clumping into one unreadable blob at a random angle, without forcing perfectly even spacing either

    for (let i = 0; i < ISLAND_COUNT; i++) {
        let angle, tries = 0;
        do {
            angle = Math.random() * Math.PI * 2;
            tries++;
        } while (tries < 20 && usedAngles.some(a => Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) < MIN_ANGLE_GAP));
        usedAngles.push(angle);

        // Band width varies with the coastline's own irregular shape
        // (islandRadiusAt) so islets never sit inside terrain that's
        // actually walkable at a headland, or float visibly past the near
        // mountain ring at a tight cove.
        const coastR = islandRadiusAt(angle);
        const innerR = coastR + INNER_MARGIN;
        const outerR = WORLD_SIZE * 1.05 - OUTER_MARGIN; // was WORLD_SIZE*0.54 — see file header, widened now the mountain ring isn't capping visibility
        if (outerR <= innerR) continue; // this angle's coastline already reaches past the ocean's usable band (a deep headland) — no room for an islet here, skip rather than force an overlap
        const dist = innerR + Math.random() * (outerR - innerR);

        const seed = i * 91.7 + 13.3;
        const scale = 0.5 + hash(seed * 1.3) * 1.0; // varied sizes so it doesn't read as one stamped-out template repeated 10 times
        const baseRadius = 14 * scale;
        const height = (5 + hash(seed * 2.1) * 6) * scale;

        const geo = buildIslet(seed, baseRadius, height);
        const mat = new THREE.MeshBasicMaterial({
            // Desaturated blue-grey — real distant landforms read as flat
            // silhouettes tinted by atmospheric haze, not their actual
            // ground color, at this range.
            color: new THREE.Color().setHSL(0.58, 0.18, 0.32 + hash(seed * 4.4) * 0.08),
            fog: true,
            transparent: true,
            opacity: 0.9,
        });
        // Same reasoning as mountain-boundary.js's buildRing: fully unlit
        // MeshBasicMaterial ignores sunLight/hemiLight/moonLight entirely,
        // so without an explicit brightness hook these would stay exactly
        // as bright at midnight as at noon. uBrightness is fed generically
        // in atmosphere/day-night-cycle.js's per-frame traverse for any
        // material that declares it — no per-island wiring needed here.
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uBrightness = { value: 1.0 };
            mat.userData.shader = shader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>\nuniform float uBrightness;`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `#include <map_fragment>\ndiffuseColor.rgb *= uBrightness;`
            );
        };

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(Math.cos(angle) * dist, OCEAN_LEVEL, Math.sin(angle) * dist);
        mesh.layers.enable(BACKGROUND_LAYER);
        mesh.renderOrder = -9; // just in front of the mountain rings' -10 so an islet that happens to sit close to the near ring doesn't z-fight with it
        group.add(mesh);
    }

    state.distantIslandsGroup = group;
    state.scene.add(group);
}