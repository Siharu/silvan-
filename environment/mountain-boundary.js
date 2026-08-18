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
import { islandRadiusAt, BASE_BOUNDARY_RADIUS } from './terrain.js';
import { BACKGROUND_LAYER } from '../fx/dynamic-fog.js';

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

// Deforms a perfectly circular cylinder's radius per-angle to match
// islandRadiusAt(), so the painted mountain backdrop follows the same
// coves/headlands the walkable terrain and boundary use instead of reading
// as a flat ring around a jagged coastline. Scales relative to this ring's
// own radius (not an absolute offset) so the far/near rings keep their
// existing parallax separation instead of colliding at tight coves.
function deformRingToIslandShape(geo) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const theta = Math.atan2(z, x);
        const factor = islandRadiusAt(theta) / BASE_BOUNDARY_RADIUS;
        pos.setX(i, x * factor);
        pos.setZ(i, z * factor);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
}

function buildRing(state, url, radius, height, repeatX, yOffset) {
    const tex = loadTiledTexture(url, repeatX);
    const geo = new THREE.CylinderGeometry(radius, radius, height, 64, 1, true);
    deformRingToIslandShape(geo);
    const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.BackSide, // inward-facing, seen from inside the world
        depthWrite: false,
        fog: true, // lets scene.fog tint/hide the base, matching day-night-cycle.js's fog color
    });
    // MeshBasicMaterial is completely unlit — without this, the ring stays
    // exactly as bright as the raw PNG pixels at all times, day or night,
    // since fog tint alone isn't nearly enough to darken it (daytime fog is
    // pale, so it barely dims anything, and the source art is fairly
    // bright/pastel to begin with). This was the cause of the mountains
    // reading as blown-out/too bright, in daylight and at night both —
    // every *other* surface in the scene actually responds to sunLight/
    // hemiLight/moonLight dimming; the mountains previously didn't respond
    // to any of it. uBrightness is fed a day/night + cloud-cover-driven
    // value every frame from atmosphere/day-night-cycle.js, same pattern
    // already used for fx/dust.js's day/night tint.
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
    // Part of the backdrop other materials (terrain, forest, rocks, grass)
    // fog toward — see fx/dynamic-fog.js. This is the layer that actually
    // matters most for hiding the island's edge: distant trees near the
    // boundary now melt into these painted peaks instead of fading to a
    // flat fog color that doesn't match them.
    mesh.layers.enable(BACKGROUND_LAYER);
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
