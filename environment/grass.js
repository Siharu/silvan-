// Grass — ported directly from silvan_part2_with_original_grass.html's
// createGrass(), the prototype's "still works fine" grass system. This
// intentionally replaces BOTH the old modular project's approaches:
//   - the original 1.1M-instance static InstancedMesh (too heavy)
//   - the newer player-relative sliding-window patch (had the
//     uPlayerPosition/camera.position bug that sank blades underground)
// This version is InstancedMesh like the first, but each blade
// billboard-faces the camera in the vertex shader (atan trick) and wind
// is a simple two-term sine, so it's much cheaper per-instance than the
// old static version implies, and has no player-relative math to get
// wrong. Scattered once at init across a radius, same as the prototype.
//
// Only real change from the reference: getElevation(x, z) -> (x, z, state)
// to match this project's terrain.js signature.

import * as THREE from 'three';
import { getElevation } from './terrain.js';

export function createGrass(state) {
    const grassCount = 400000; // halved from the prototype's 850000 as a
    // starting point for this rebuild, given animals.js/forest/rocks will
    // all be layering on top in the same scene, unlike the prototype which
    // was testing grass in relative isolation. Raise this back up once the
    // full scene is assembled and there's real fps headroom to spend.
    const grassGeo = new THREE.BufferGeometry();

    const grassVertices = new Float32Array([
        -0.03, 0, 0,
         0.03, 0, 0,
         0,   2.2, 0
    ]);
    grassGeo.setAttribute('position', new THREE.BufferAttribute(grassVertices, 3));
    grassGeo.computeVertexNormals();

    const grassMat = new THREE.MeshStandardMaterial({
        color: 0x3d661d,
        roughness: 0.9,
        side: THREE.DoubleSide
    });

    grassMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        grassMat.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            varying float vHeight;
            varying vec3 vWorldPos;
            varying float vCamDist;`
        );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vHeight = position.y;
            vec4 worldPos = instanceMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            vCamDist = distance(cameraPosition, worldPos.xyz);

            vec3 look = normalize(cameraPosition - worldPos.xyz);
            float angle = atan(look.x, look.z);
            float s = sin(angle);
            float c = cos(angle);
            float nx = transformed.x * c + transformed.z * s;
            float nz = transformed.z * c - transformed.x * s;
            transformed.x = nx;
            transformed.z = nz;

            float wind = sin(worldPos.x * 0.2 + uTime * 1.5) * cos(worldPos.z * 0.2 + uTime * 1.2);
            wind += sin(worldPos.x * 1.2 - uTime * 2.5) * 0.15;
            transformed.x += wind * 0.45 * pow(vHeight/2.2, 2.0);
            transformed.z += wind * 0.45 * pow(vHeight/2.2, 2.0);`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying float vHeight;
            varying vec3 vWorldPos;
            varying float vCamDist;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `vec3 rootColor = vec3(0.01, 0.03, 0.005);
            float grad = clamp(vHeight / 2.2, 0.0, 1.0);
            float shadow = pow(grad, 0.6);
            // Fade blades out right in front of the camera instead of letting them
            // collapse into degenerate near-black slivers when nearly edge-on.
            if (vCamDist < 0.6) discard;
            float nearFade = smoothstep(0.6, 1.8, vCamDist);
            vec4 diffuseColor = vec4(mix(rootColor, diffuse, shadow), opacity * nearFade);`
        );
    };

    state.grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
    state.grassMat = grassMat;
    state.grassMesh.receiveShadow = false;

    const dummy = new THREE.Object3D();
    let validGrass = 0;
    for (let i = 0; i < grassCount; i++) {
        const r = Math.sqrt(Math.random()) * 300;
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = getElevation(x, z, state);

        if (y < 1.7) continue; // Keep grass out of the lake

        dummy.position.set(x, y, z);

        const scaleW = 0.5 + Math.random() * 0.7;
        const scaleH = 0.4 + Math.random() * 1.2;
        dummy.scale.set(scaleW, scaleH, scaleW);

        dummy.updateMatrix();
        state.grassMesh.setMatrixAt(validGrass++, dummy.matrix);
    }
    state.grassMesh.count = validGrass;
    state.scene.add(state.grassMesh);
}

// Called every frame from main.js's animate() loop. No player-relative
// math at all here — that's the whole point vs. the old sliding-window
// version — so this only ever needs uTime.
export function updateGrass(state, ts) {
    if (!state.grassMat || !state.grassMat.userData.shader) return;
    state.grassMat.userData.shader.uniforms.uTime.value = ts;
}
