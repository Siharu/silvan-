// Water plane (fresnel + fake sun/moon glint shader) and lily pads.
// Depends on environment/terrain.js for getElevation() and pushes nothing
// into state.colliders (the lake itself isn't collided with).

import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL } from '../core/world-state.js';
import { getElevation } from './terrain.js';

export function createLake(state) {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 48, 48);
    geo.rotateX(-Math.PI / 2);

    // Per-vertex depth, sampled once from real terrain data (not a periodic
    // function) — drives shallow/deep color grading and shoreline foam so both
    // actually follow the basin shape instead of tiling.
    const posAttr = geo.attributes.position;
    const depths = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) {
        const wx = posAttr.getX(i);
        const wz = posAttr.getZ(i);
        const depth = Math.max(0, WATER_LEVEL - getElevation(wx, wz));
        depths[i] = Math.min(depth / 20.0, 1.0);
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));

    state.waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x0d2f3d,
        roughness: 0.08,
        metalness: 0.05,
        transparent: true,
        opacity: 0.92
    });
    state.waterMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
        shader.uniforms.uMoonDir = { value: new THREE.Vector3(0, 1, 0) };
        shader.uniforms.uSunColor = { value: new THREE.Color(0xfff4d6) };
        shader.uniforms.uMoonColor = { value: new THREE.Color(0xaac4ff) };
        shader.uniforms.uSunStrength = { value: 0 };
        shader.uniforms.uMoonStrength = { value: 0 };
        shader.uniforms.uSkyColor = { value: new THREE.Color(0x8a9aa8) };
        shader.uniforms.uDeepColor = { value: new THREE.Color(0x061c26) };
        shader.uniforms.uShallowColor = { value: new THREE.Color(0x2f7a6e) };
        state.waterMaterial.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
            #include <common>
            uniform float uTime;
            attribute float aDepth;
            varying vec3 vWorldPos;
            varying vec3 vViewDirW;
            varying vec3 vWaveNormal;
            varying float vDepth;
        `);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
            vViewDirW = cameraPosition - vWorldPos;
            vDepth = aDepth;

            // height(x,z) and its analytic slope, so the surface actually has a
            // normal that responds to the swell instead of staying flat.
            float ax = 0.05, az = 0.04, aSp = 0.6, bSp = 0.45;
            float ampA = 0.12, ampB = 0.10;
            transformed.y += sin(position.x * ax + uTime * aSp) * ampA
                            + cos(position.z * az - uTime * bSp) * ampB;
            float dHdx = ampA * ax * cos(position.x * ax + uTime * aSp);
            float dHdz = -ampB * az * sin(position.z * az - uTime * bSp);
            vWaveNormal = normalize(vec3(-dHdx, 1.0, -dHdz));
        `);

        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
            #include <common>
            uniform float uTime;
            uniform vec3 uSunDir;
            uniform vec3 uMoonDir;
            uniform vec3 uSunColor;
            uniform vec3 uMoonColor;
            uniform float uSunStrength;
            uniform float uMoonStrength;
            uniform vec3 uSkyColor;
            uniform vec3 uDeepColor;
            uniform vec3 uShallowColor;
            varying vec3 vWorldPos;
            varying vec3 vViewDirW;
            varying vec3 vWaveNormal;
            varying float vDepth;
        `);
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            vec3 viewDirN = normalize(vViewDirW);
            vec3 waterNormal = normalize(vWaveNormal);

            // Depth-graded color: bright shallows near shore, dark water in the
            // basin — driven by real terrain depth, so it follows the actual shore.
            vec3 baseCol = mix(uShallowColor, uDeepColor, smoothstep(0.0, 0.35, vDepth));

            // Fresnel: near-grazing views (far shore, horizon) read as reflective sky,
            // straight-down views read as deep tinted water. This fakes a mirror
            // without an actual reflection pass.
            float fresnel = pow(1.0 - clamp(dot(waterNormal, viewDirN), 0.0, 1.0), 4.0);
            baseCol = mix(baseCol, uSkyColor, fresnel * 0.8);

            // Thin foam line right at the shore, where depth is near zero.
            float foam = 1.0 - smoothstep(0.0, 0.025, vDepth);
            baseCol = mix(baseCol, vec3(0.82, 0.9, 0.86), foam * 0.5);

            // Sun/moon glint: tight specular highlight along the reflected view,
            // now catching the wave's actual slope instead of a flat plane.
            vec3 reflected = reflect(-viewDirN, waterNormal);
            float sunGlint = pow(max(dot(reflected, uSunDir), 0.0), 200.0) * uSunStrength;
            float moonGlint = pow(max(dot(reflected, uMoonDir), 0.0), 240.0) * uMoonStrength;
            baseCol += uSunColor * sunGlint * 3.0;
            baseCol += uMoonColor * moonGlint * 2.0;

            vec4 diffuseColor = vec4(baseCol, opacity);
            `
        );
    };
    state.waterMesh = new THREE.Mesh(geo, state.waterMaterial);
    state.waterMesh.position.y = 1.6; // Water surface level
    state.waterMesh.receiveShadow = true;
    state.scene.add(state.waterMesh);
    
    // Add stylized Lily Pads to the lake
    const lilyCount = 350;
    // Cylinder with a slice removed to look like a pac-man lily pad
    const lilyGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.05, 14, 1, false, 0, Math.PI * 1.8);
    const lilyMat = new THREE.MeshStandardMaterial({ color: 0x3d7a31, roughness: 0.9 });
    const lilyMesh = new THREE.InstancedMesh(lilyGeo, lilyMat, lilyCount);
    lilyMesh.receiveShadow = true;
    
    const lilyDummy = new THREE.Object3D();
    let lIdx = 0;
    for(let i=0; i < lilyCount * 3 && lIdx < lilyCount; i++) {
        const r = Math.random() * 150; 
        const th = Math.random() * Math.PI * 2;
        const x = Math.cos(th)*r; const z = Math.sin(th)*r;
        const y = getElevation(x,z);
        if(y < 1.4) { // Only place in the water basin
            lilyDummy.position.set(x, 1.62, z); // Sits on water
            lilyDummy.rotation.set(0, Math.random()*Math.PI*2, 0);
            const s = 0.4 + Math.random()*0.7;
            lilyDummy.scale.set(s, 1, s);
            lilyDummy.updateMatrix();
            lilyMesh.setMatrixAt(lIdx++, lilyDummy.matrix);
        }
    }
    lilyMesh.count = lIdx;
    state.scene.add(lilyMesh);
}

