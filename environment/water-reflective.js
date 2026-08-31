// Real-time reflective water, using Three.js's stock Water addon (see
// 'three/addons/objects/Water.js' — already resolvable via index.html's
// existing importmap entry for 'three/addons/', no new dependency wiring
// needed). Replaces the fully-custom Gerstner-wave shader that used to
// live in environment/water-shader.js.
//
// Why the swap: the old shader only faked a horizon blend — it mixed
// toward a live sky-color uniform at grazing viewing angles, but there was
// never an actual reflected image of the scene (sky dome, sun, moon,
// mountains) in the water. THREE.Water does a real planar reflection: it
// renders the scene from a mirrored camera into a render target every
// frame and samples that texture in its shader, distorted by a scrolling
// normal map — which is what the requested reference (day_night_cycle.html)
// is actually built on. That's a fundamentally different technique, not a
// tuning difference, so this replaces the old shader outright rather than
// patching it — see environment/water-shader.js's removal.
//
// One deliberate deviation from the reference: it fetches
// 'waternormals.jpg' from a CDN. Everything else visual in this project is
// generated procedurally at runtime (fx/textures.js) with zero external
// asset fetches, so pulling in one CDN image for this "for now" swap is a
// known, flagged exception — worth revisiting with a procedurally-baked
// normal map later if the CDN dependency becomes a problem (offline dev,
// flaky network, ad-block false positives, etc).

import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

// Shared across ocean + lake so the (small, ~5kb) normal map is only
// fetched once regardless of how many water bodies exist.
let _sharedNormalsPromise = null;
function loadSharedNormals() {
    if (_sharedNormalsPromise) return _sharedNormalsPromise;
    _sharedNormalsPromise = new Promise((resolve) => {
        new THREE.TextureLoader().load(
            'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/waternormals.jpg',
            (tex) => {
                tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                resolve(tex);
            },
            undefined,
            () => resolve(null) // fall back to no normal map rather than block water creation
        );
    });
    return _sharedNormalsPromise;
}

// Builds a THREE.Water mesh from any geometry (Ring, Plane, whatever the
// caller already has) and adds it to the scene immediately with a
// placeholder/no normal-map material; the real normal map swaps in
// asynchronously once the fetch resolves, matching the reference file's
// own "create water even if texture fails/is still loading" approach.
//
// Returns the Water instance itself (it doubles as the THREE.Mesh —
// nothing else needs to reach in and wrap it further).
export function createReflectiveWater(state, {
    geometry,
    y,
    waterColor = 0x001e0f,
    distortionScale = 3.7,
    baseSize = 4.0,
    sunColorDay = 0xffffff,
    sunColorNight = 0x7c93ff,
}) {
    const water = new Water(geometry, {
        textureWidth: state.quality.waterReflectionRes || 512,
        textureHeight: state.quality.waterReflectionRes || 512,
        waterNormals: null,
        sunDirection: new THREE.Vector3(0, 1, 0),
        sunColor: sunColorDay,
        waterColor,
        distortionScale,
        fog: !!state.scene.fog,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = y;
    water.material.uniforms.size.value = baseSize;

    // baseDistortionScale/baseSize kept on userData so day-night-cycle.js
    // and the settings-panel wave sliders (core/input.js) can apply live
    // multipliers the same way the old shader's baseSteepness/baseSpeed
    // pattern worked, without hardcoding a new number in two places.
    water.userData.baseDistortionScale = distortionScale;
    water.userData.baseSize = baseSize;
    water.userData.sunColorDay = new THREE.Color(sunColorDay);
    water.userData.sunColorNight = new THREE.Color(sunColorNight);

    state.scene.add(water);

    loadSharedNormals().then((tex) => {
        if (!tex) return; // reference file's own fallback: water still renders, just without normal-map ripple detail
        water.material.uniforms.normalSampler.value = tex;
    });

    return water;
}
