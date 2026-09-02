// Day/night cycle — DIRECT PORT of day_night_cycle.html. Unlike the old
// modular project's approach (which kept its own hand-rolled sky gradient/
// water systems and only borrowed the light-intensity curve), this pulls
// the reference's actual THREE.Sky atmospheric scattering dome, sun/moon
// directional lights + shadow cameras, hemisphere light, visual moon mesh
// + point-light glow, and star field — essentially verbatim, just wired
// into this project's state-object/module pattern instead of the
// reference's flat globals.
//
// Orbit radius/scale (90000, moonGeo radius 1500, star field radius
// 40000, shadow camera frustum d=4000) are kept EXACTLY as in the
// reference rather than rescaled to this project's much smaller
// WORLD_SIZE=800 — Sky/sun/moon/stars all live effectively "at infinity"
// relative to gameplay-scale geometry, so the absolute numbers don't need
// to match world scale, only the ANGLES (which drive actual light
// direction) do. Only real values ported down: none — this is why it's a
// "direct port" per your instruction rather than the earlier session's
// blended/rescaled approach.
//
// PERFORMANCE WARNING, same as flagged before: this enables real shadow
// mapping (2048x2048 x2, PCF soft shadows) exactly as the reference did.
// On the reported 12fps-on-Intel-UHD hardware this will be expensive
// layered on top of grass/rocks/ferns/pine-trees. Flagged, not fixed —
// you said trim later once everything's assembled.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';

export function createDayNightCycle(state) {
    state.gameTime = state.gameTime !== undefined ? state.gameTime : 0.5; // 0..1 -> maps to timeOfDay 0..24 below
    state.timeSpeed = 0.02; // slow real-time-feeling day cycle; reference's isPlaying speed (0.5 hrs/sec) was tuned for a demo scrubbing through a full day in ~48s — way too fast for actual gameplay pacing

    // --- Sky (Rayleigh & Mie scattering dome) ---
    const sky = new Sky();
    sky.scale.setScalar(100000);
    state.scene.add(sky);
    state.sky = sky;

    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 4.0;
    skyUniforms['rayleigh'].value = 1.5;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;

    state.sunPosition = new THREE.Vector3();
    state.moonPosition = new THREE.Vector3();

    // --- Sun light ---
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 15000;
    const d = 4000;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.001;
    state.scene.add(sunLight);
    state.sunLight = sunLight;

    // --- Moon light ---
    const moonLight = new THREE.DirectionalLight(0x99aaff, 1.5);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.width = 2048;
    moonLight.shadow.mapSize.height = 2048;
    moonLight.shadow.camera.near = 10;
    moonLight.shadow.camera.far = 15000;
    moonLight.shadow.camera.left = -d;
    moonLight.shadow.camera.right = d;
    moonLight.shadow.camera.top = d;
    moonLight.shadow.camera.bottom = -d;
    moonLight.shadow.bias = -0.001;
    state.scene.add(moonLight);
    state.moonLight = moonLight;

    // --- Hemisphere ambient ---
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
    state.scene.add(hemiLight);
    state.hemiLight = hemiLight;

    // --- Visual moon mesh + glow ---
    const moonGeo = new THREE.SphereGeometry(1500, 64, 64);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    const moonGlow = new THREE.PointLight(0x99aaff, 2.5, 15000);
    moonMesh.add(moonGlow);
    state.scene.add(moonMesh);
    state.moonMesh = moonMesh;

    // --- Water reflection uniforms (only meaningful if environment/water.js's
    // ocean/lake reuses this Water instance — see that module's own
    // comments for how the two connect; this module just feeds sunDirection/
    // sunColor into whatever `state.water` turns out to be, same as the
    // reference's initWater() callback did once its texture loaded). ---
    // Deliberately NOT creating a THREE.Water plane here — the reference's
    // was a single flat 30000x30000 ocean plane for its own demo; this
    // project already has (or will have, see environment/water.js) its own
    // lake/ocean geometry from ocean-water.html's Gerstner system. This
    // module only updates sunDirection/sunColor on state.water if it
    // exists, so water.js can opt in without this module owning the mesh.

    // --- Stars ---
    const starsGeo = new THREE.BufferGeometry();
    const starsCount = 5000;
    const starsPos = new Float32Array(starsCount * 3);
    for (let i = 0; i < starsCount; i++) {
        const r = 40000;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        starsPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        starsPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        starsPos[i * 3 + 2] = r * Math.cos(phi);
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
    const starsMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 80,
        transparent: true,
        opacity: 0,
        depthWrite: false
    });
    state.stars = new THREE.Points(starsGeo, starsMat);
    state.scene.add(state.stars);

    updateDayNightCycle(state, 0); // set initial lighting/sky state before first render
}

// Direct port of updateEnvironment(), driven by state.gameTime (0..1) ->
// timeOfDay (0..24) instead of the reference's standalone timeOfDay var.
export function updateDayNightCycle(state, delta) {
    if (delta) {
        state.gameTime += delta * state.timeSpeed / 24; // timeSpeed is hrs/real-sec in the reference; gameTime is 0..1
        if (state.gameTime >= 1.0) state.gameTime -= 1.0;
    }
    const timeOfDay = state.gameTime * 24;

    const angle = (timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
    const orbitRadius = 90000;

    state.sunPosition.x = Math.cos(angle) * orbitRadius;
    state.sunPosition.y = Math.sin(angle) * orbitRadius;
    state.sunPosition.z = -20000;

    state.moonPosition.x = Math.cos(angle + Math.PI) * orbitRadius;
    state.moonPosition.y = Math.sin(angle + Math.PI) * orbitRadius;
    state.moonPosition.z = 20000;

    state.sky.material.uniforms['sunPosition'].value.copy(state.sunPosition);

    if (state.water) {
        if (state.sunPosition.y > 0) {
            state.water.material.uniforms['sunDirection'].value.copy(state.sunPosition).normalize();
            state.water.material.uniforms['sunColor'].value.setHex(0xffffff);
        } else {
            state.water.material.uniforms['sunDirection'].value.copy(state.moonPosition).normalize();
            state.water.material.uniforms['sunColor'].value.setHex(0x7c93ff);
        }
    }

    state.sunLight.position.copy(state.sunPosition);
    state.moonLight.position.copy(state.moonPosition);
    state.moonMesh.position.copy(state.moonPosition);

    const sunHeightNormalized = Math.sin(angle);

    if (sunHeightNormalized > 0) {
        const intensity = Math.pow(sunHeightNormalized, 0.3);
        state.sunLight.intensity = intensity * 2.5;
        state.moonLight.intensity = 0;

        state.hemiLight.color.setHSL(0.6, 0.75, 0.5 + intensity * 0.5);
        state.hemiLight.groundColor.setHSL(0.095, 0.5, 0.1 + intensity * 0.4);
        state.hemiLight.intensity = 0.6 + intensity * 0.4;

        state.renderer.toneMappingExposure = Math.max(0.4, intensity * 0.8);
        state.stars.material.opacity = 0;
    } else {
        const intensity = Math.pow(-sunHeightNormalized, 0.3);
        state.sunLight.intensity = 0;
        state.moonLight.intensity = intensity * 1.8;

        state.hemiLight.color.setHSL(0.65, 0.4, 0.15 + intensity * 0.1);
        state.hemiLight.groundColor.setHSL(0.65, 0.3, 0.05 + intensity * 0.05);
        state.hemiLight.intensity = 0.3 + intensity * 0.2;

        state.renderer.toneMappingExposure = 0.4 + intensity * 0.2;
        state.stars.material.opacity = intensity;
    }
}

// Called every frame from main.js's animate() loop.
export function updateStars(state, delta) {
    state.stars.rotation.y += delta * 0.005;
}
