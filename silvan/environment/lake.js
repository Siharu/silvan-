import * as THREE from 'three';
import { state, WATER_LEVEL } from '../core/state.js';
import { heightAt as getElevation } from '../core/heightmap.js';

// Terrain v2 / B-20: was PlaneGeometry(WORLD_SIZE, WORLD_SIZE, ...) fixed at
// the world origin — correct only because the hard shoreline wall in
// player-controller.js meant nobody could ever walk far enough to see its
// edge, and it scaled with WORLD_SIZE (a 1600u world = a 1600u water plane,
// most of it never visible at once). Now that the shoreline is a current
// instead of a wall (same change), the plane has to actually follow the
// player to keep looking infinite, and can be a fixed, modest size
// regardless of world size — same "cost independent of world size"
// principle 4.3's terrain chunks already established.
const PLANE_SIZE = 700;      // covers the ~380u fog/draw radius from any recenter position with margin
const SEGMENTS = 48;         // unchanged from the old fixed plane — wave displacement is low-frequency, doesn't need more
const RECENTER_DIST = 48;    // re-centre once the player's drifted this far from the last snap point
const SNAP = 16;             // snap the new centre to a grid so the recentre itself is imperceptible, not just "close enough"

let localX = null, localZ = null; // per-vertex LOCAL offsets (fixed for this plane's lifetime)
let centerX = 0, centerZ = 0;      // current world-space centre (where the plane is actually positioned)

function recomputeDepths(geo) {
    const pos = geo.attributes.position;
    const depthAttr = geo.getAttribute('aDepth');
    for (let i = 0; i < pos.count; i++) {
        const depth = Math.max(0, WATER_LEVEL - getElevation(localX[i] + centerX, localZ[i] + centerZ));
        depthAttr.setX(i, Math.min(depth / 20.0, 1.0));
    }
    depthAttr.needsUpdate = true;
}

export function createLake() {
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position;
    localX = new Float32Array(posAttr.count);
    localZ = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) { localX[i] = posAttr.getX(i); localZ[i] = posAttr.getZ(i); }

    // Per-vertex depth, sampled from real terrain data (not a periodic
    // function) — drives shallow/deep color grading and shoreline foam so
    // both actually follow the basin shape instead of tiling. Recomputed
    // whenever the plane recentres (updateLake), since it's now keyed to
    // world position rather than baked once for a plane that never moved.
    geo.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(posAttr.count), 1));
    recomputeDepths(geo);

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
    state.waterMesh.position.set(centerX, 1.6, centerZ); // Water surface level
    state.waterMesh.receiveShadow = true;
    state.scene.add(state.waterMesh);
    // Lily pads dropped here — this is now open ocean around The Hearth's
    // island, not a lake basin, so lily-pad set dressing no longer fits.
    // (Vegetation/set-dressing passes for Map 1 are being handled separately.)
}

// Call every frame (main.js's animate()) — cheap no-op unless the player has
// actually drifted RECENTER_DIST from the last snap point, same pattern as
// terrain.js's chunk streaming.
export function updateLake(px, pz) {
    if (!state.waterMesh) return;
    const dx = px - centerX, dz = pz - centerZ;
    if (dx * dx + dz * dz < RECENTER_DIST * RECENTER_DIST) return;
    centerX = Math.round(px / SNAP) * SNAP;
    centerZ = Math.round(pz / SNAP) * SNAP;
    state.waterMesh.position.x = centerX;
    state.waterMesh.position.z = centerZ;
    recomputeDepths(state.waterMesh.geometry);
}

