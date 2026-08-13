// World-boundary mountains — a painted backdrop, not walkable geometry.
// Two concentric inward-facing cylinders wrap tileable pixel-art mountain
// layers (craftpix.net "Free Mountain Backgrounds" pack, set m1: snow-capped
// peaks + green foothills, chosen to match Silvan's forest palette) around
// the play area at WORLD_SIZE's edge. state.colliders / the WORLD_SIZE
// clamp in core/player-controller.js already stop the player from walking
// past the edge — this is purely the visual reason that edge exists.
//
// The two layers give cheap parallax depth: far peaks sit further out and
// taller, near foothills sit closer and lower, matching how the source pack
// is meant to be composited. Both fade into state.scene.fog at their base
// so the seam between real terrain and painted backdrop disappears instead
// of reading as a flat wall.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';

const TEX_ASPECT = 576 / 324;

function loadTiledTexture(url, repeatX) {
    const tex = new THREE.TextureLoader().load(url);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(repeatX, 1);
    tex.magFilter = THREE.NearestFilter; // keep the pixel-art crispness
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function buildRing(state, url, radius, height, repeatX, yOffset) {
    const tex = loadTiledTexture(url, repeatX);
    const geo = new THREE.CylinderGeometry(radius, radius, height, 64, 1, true);
    const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.BackSide, // inward-facing, seen from inside the world
        depthWrite: false,
        fog: true, // lets scene.fog tint/hide the base, matching day-night-cycle.js's fog color
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = yOffset + height / 2;
    mesh.renderOrder = -10; // draw behind everything else, avoids z-fighting with the sky dome
    state.scene.add(mesh);
    return mesh;
}

export function createMountainBoundary(state) {
    // How many times the 576x324 tile repeats around the full 360°ring —
    // picked so individual peaks read at a believable scale rather than
    // looking either stretched-thin or repetitively tiny.
    const FAR_REPEATS = 10;
    const NEAR_REPEATS = 14;

    const farRadius = WORLD_SIZE * 0.62;
    const nearRadius = WORLD_SIZE * 0.54;
    const farHeight = farRadius * 0.55 / TEX_ASPECT * 2;
    const nearHeight = nearRadius * 0.55 / TEX_ASPECT * 2;

    state.mountainFarMesh = buildRing(
        state, 'assets/textures/mountains/m1-far-peaks.png',
        farRadius, farHeight, FAR_REPEATS, -farHeight * 0.15
    );
    state.mountainNearMesh = buildRing(
        state, 'assets/textures/mountains/m1-near-foothills.png',
        nearRadius, nearHeight, NEAR_REPEATS, -nearHeight * 0.35
    );
}
