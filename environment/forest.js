// Recursive fractal branch generator (trunk -> branches -> leaves) for
// deciduous/maple trees. Uses state.branchMatrices/leafMatrices/
// branchColors/leafColors as instancing scratch buffers and pushes trunk
// colliders onto state.colliders. Reads state.globalTextures.leafTex.
//
// Pines are no longer generated here — the old low-poly layered-cone pine
// variant was replaced by the sparse detailed pine trees in
// environment/pine-trees.js (see PINE_TREE_COUNT there).
//
// Distant-tree billboard imposters (see createTreeImposters below): each
// full-detail tree is a recursive branch walk rendered as real 3D geometry,
// which is the right call up close but wasteful once a tree is 150+ units
// away and only a handful of pixels tall. Rather than rewriting instance
// matrices from the CPU every frame to swap detail levels (expensive at
// this instance count, and this codebase's InstancedMesh usage elsewhere
// never does per-frame CPU rewrites either), the swap happens entirely in
// the vertex shader: every tree exists simultaneously as full-detail
// geometry AND as a camera-facing billboard card, and each shader collapses
// its own vertices to a degenerate (clipped) point on the wrong side of
// uSwitchDist. One uCameraPos uniform, updated once per frame by the
// generic feed in atmosphere/day-night-cycle.js, drives both.

import * as THREE from 'three';
import { WORLD_SIZE } from '../core/world-state.js';
// GROVE_CENTER/GROVE_BLEND_RADIUS don't exist in this rebuild (no flattened
// grove concept ported over) — dropped the grove-density-boost block below,
// same call made for environment/animals.js's GROVE_CENTER usage.
import { getElevation, noise } from './terrain.js';
// addDynamicFog import removed — dynamic fog itself was removed for performance, see main.js.

// Beyond this distance, full-detail trees collapse and their billboard
// imposter takes over. Tuned to sit past where the branch/leaf silhouette
// detail is actually resolvable rather than at some perf-driven number —
// see LOD_FADE below for how the pop is softened.
const LOD_SWITCH_DIST = 150.0;
// The switch itself is a hard clip (see collapseVertexGLSL), but fading the
// imposter's opacity in over this many units right around the switch point
// stops it from hard-popping into existence — the collapse is still exact,
// only the imposter's visibility ramps.
const LOD_FADE = 25.0;

// Shared collapse snippet: pushes gl_Position outside the clip volume
// (rather than zeroing it, which risks a w=0 divide) when `hide` is true.
// Appended after #include <project_vertex> so it overrides whatever
// gl_Position that chunk already computed.
const collapseVertexGLSL = (hideExpr) => `
    if (${hideExpr}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
`;

function createTreeCardTexture() {
    // Baked once, tinted per-instance via instanceColor (see
    // createTreeImposters) — a few overlapping soft blobs read as a canopy
    // silhouette at the distance these are actually visible from, no need
    // for anything more detailed than that.
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#2b1c10';
    ctx.fillRect(size * 0.46, size * 0.60, size * 0.08, size * 0.4);
    ctx.fillStyle = '#ffffff'; // multiplied by instanceColor (the tree's own leaf tint) in the shader
    const blobs = [[0.5, 0.32, 0.30], [0.30, 0.42, 0.20], [0.70, 0.42, 0.20], [0.5, 0.52, 0.24]];
    for (const [bx, by, br] of blobs) {
        const grad = ctx.createRadialGradient(size * bx, size * by, 0, size * bx, size * by, size * br);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(size * bx, size * by, size * br, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

function createTreeImposters(state, treeInstances) {
    if (treeInstances.length === 0) return;

    const cardGeo = new THREE.PlaneGeometry(1, 1);
    cardGeo.translate(0, 0.5, 0); // pivot at the base, not the center, so it sits on the ground like the real tree does

    const imposterMat = new THREE.MeshStandardMaterial({
        map: createTreeCardTexture(),
        transparent: true,
        alphaTest: 0.08,
        roughness: 0.9,
        side: THREE.DoubleSide
    });
    imposterMat.onBeforeCompile = (shader) => {
        shader.uniforms.uCameraPos = { value: new THREE.Vector3() };
        shader.uniforms.uSwitchDist = { value: LOD_SWITCH_DIST };
        imposterMat.userData.shader = shader;

        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
            #include <common>
            uniform vec3 uCameraPos;
            uniform float uSwitchDist;
            attribute float aScale;
            varying float vFadeAlpha;
        `);
        // Y-axis ("cylindrical") billboard: only yaws to face the camera,
        // stays upright — the standard technique for tree/foliage
        // imposters specifically (unlike a full spherical billboard, which
        // would tilt trees off-vertical as the camera looks up/down at
        // them). Left as a pure LOCAL offset here (no instPos added) so
        // the standard #include <project_vertex> right after this still
        // does its normal instanceMatrix multiply to place it — adding
        // instPos here too would double-translate it, since this
        // instanceMatrix is otherwise just a plain translation (identity
        // rotation/scale, see createTreeImposters' dummy setup below).
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            vec3 toCam = uCameraPos - instPos;
            float distToCam = length(toCam);
            float yaw = atan(toCam.x, toCam.z);
            float ca = cos(yaw), sa = sin(yaw);
            vec3 localOffset = transformed * aScale;
            transformed = vec3(localOffset.x * ca, localOffset.y, localOffset.x * sa);
            vFadeAlpha = smoothstep(uSwitchDist - ${LOD_FADE.toFixed(1)}, uSwitchDist, distToCam);
        `);
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
            #include <project_vertex>
            ${collapseVertexGLSL(`distToCam < uSwitchDist - ${LOD_FADE.toFixed(1)}`)}
        `);

        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
            #include <common>
            varying float vFadeAlpha;
        `);
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            'vec4 diffuseColor = vec4( diffuse, opacity * vFadeAlpha );'
        );
    };
    // addDynamicFog(imposterMat, ...) removed — dynamic fog removed for performance, see main.js.

    const imposterMesh = new THREE.InstancedMesh(cardGeo, imposterMat, treeInstances.length);
    imposterMesh.castShadow = false; // billboards casting shadows would just be a rotating flat shadow card — not worth it at a distance where the imposter itself is barely resolvable
    imposterMesh.receiveShadow = false;
    imposterMesh.frustumCulled = false; // instances span the whole map; per-object frustum culling on the bounding box of ALL of them would almost never cull anything anyway

    const colorArray = new Float32Array(treeInstances.length * 3);
    const scaleArray = new Float32Array(treeInstances.length);
    const dummy = new THREE.Object3D();
    treeInstances.forEach((t, i) => {
        dummy.position.copy(t.position);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        imposterMesh.setMatrixAt(i, dummy.matrix);
        colorArray[i * 3] = t.color.r; colorArray[i * 3 + 1] = t.color.g; colorArray[i * 3 + 2] = t.color.b;
        // Card sized against the same growBranch() scale (s) and canopy
        // radius (7.5*s trunk length -> roughly a 9-10 unit tall canopy) so
        // the imposter roughly matches the silhouette it's replacing.
        scaleArray[i] = t.scale * 9.5;
    });
    imposterMesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
    // InstancedBufferAttribute is already instanced (per-instance, not
    // per-vertex) by construction — no extra flags needed beyond setting it
    // via setAttribute, same as instanceColor above.
    cardGeo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scaleArray, 1));

    state.scene.add(imposterMesh);
    state.treeImposterMesh = imposterMesh;
}

export async function generateFractalForest(state, onProgress) {
    const baseTrunkColor = new THREE.Color(0x28201a);

    function growBranch(matrix, depth, maxDepth, length, radius, leafBaseColor) {
        const branchMat = matrix.clone();
        const translate = new THREE.Matrix4().makeTranslation(0, length / 2, 0);
        const scale = new THREE.Matrix4().makeScale(radius, length, radius);
        branchMat.multiply(translate).multiply(scale);
        state.branchMatrices.push(branchMat);
        
        const bColor = baseTrunkColor.clone().offsetHSL(0, 0, depth * 0.04);
        state.branchColors.push(bColor.r, bColor.g, bColor.b);

        const endMat = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, length, 0));

        if (depth >= maxDepth) {
            for (let i = 0; i < 4; i++) {
                const leafRot = new THREE.Matrix4().makeRotationFromEuler(
                    new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI)
                );
                const leafScale = new THREE.Matrix4().makeScale(length*3.2, length*3.2, length*3.2);
                state.leafMatrices.push(endMat.clone().multiply(leafRot).multiply(leafScale));
                const lColor = leafBaseColor.clone().offsetHSL(Math.random()*0.1-0.05, Math.random()*0.2, Math.random()*0.1-0.05);
                state.leafColors.push(lColor.r, lColor.g, lColor.b);
            }
            return;
        }

        const numSplits = depth === 0 ? 3 + Math.floor(Math.random()*2) : (depth === 1 ? 3 : 2); 
        for (let i = 0; i < numSplits; i++) {
            const angleY = (Math.PI * 2 / numSplits) * i + (Math.random() * 0.8 - 0.4);
            const angleX = 0.35 + (depth * 0.12) + (Math.random() * 0.2);
            const rotMat = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(angleX, angleY, 0, 'YXZ'));
            growBranch(endMat.clone().multiply(rotMat), depth + 1, maxDepth, length * (0.68 + Math.random()*0.12), radius * 0.65, leafBaseColor);
        }
    }

    // Each tree is a recursive fractal branch walk (depth up to 5, 2-4 way
    // splits per node) — cheap individually but 780 of them (High quality)
    // back-to-back was the same kind of multi-second unbroken block as
    // grass's 1.1M instances. Yielding every 40 trees keeps it smooth
    // without the yields themselves costing anything meaningful.
    const treeInstances = []; // fed to createTreeImposters() after the loop — position/color/scale only, not the full branch geometry
    const YIELD_EVERY = 40;
    const treeCount = (state.quality && state.quality.treeCount) || 350; // default since this rebuild has no core/quality.js yet
    for (let i = 0; i < treeCount; i++) {
        // Grove/clearing clustering: rejection-sample against a low-frequency
        // density mask instead of placing every tree at a uniformly random
        // spot. Pure uniform scatter is exactly why the forest read as
        // featureless haze in every direction — clustering trees into dense
        // groves with open clearings between them creates sightline walls
        // and navigable "rooms", the actual small-island-feels-big trick.
        let x, z, y, attempts = 0, density = 0;
        do {
            const r = 25 + Math.random() * (WORLD_SIZE/2 - 50);
            const theta = Math.random() * Math.PI * 2;
            x = Math.cos(theta) * r;
            z = Math.sin(theta) * r;
            y = getElevation(x, z, state);
            density = noise(x * 0.006 + 300, z * 0.006 - 300);
            attempts++;
        } while (Math.random() > density * 1.5 && attempts < 12);

        if (y < 1.4) continue; // Keep trees out of the deep lake
        if (Math.hypot(x - 0, z - 20) < 12) continue; // keep clear of player spawn (0, _, 20)

        const baseMatrix = new THREE.Matrix4().makeTranslation(x, y - 0.3, z);
        baseMatrix.multiply(new THREE.Matrix4().makeRotationY(Math.random() * Math.PI * 2));
        const s = 0.85 + Math.random() * 1.3;
        
        const biomeVal = noise(x * 0.008, z * 0.008);

        // Every procedurally-generated forest tree is now deciduous/maple —
        // pines are placed separately as sparse landmark trees, see
        // environment/pine-trees.js.
        let leafBase = new THREE.Color(0x244a1f); // Default Green
        if (biomeVal > 0.65) {
            // Maple Tree (Autumn colors based on biome)
            const autumn = [0x992211, 0xaa4411, 0xbb8811, 0xcc3311];
            leafBase.setHex(autumn[Math.floor(Math.random()*autumn.length)]);
        }
        growBranch(baseMatrix, 0, Math.random() > 0.8 ? 5 : 4, 7.5 * s, 0.75 * s, leafBase);
        state.colliders.push({ x: x, z: z, r: (0.7 * s) + 0.6 });
        treeInstances.push({ position: new THREE.Vector3(x, y - 0.3, z), color: leafBase, scale: s });

        if (i > 0 && i % YIELD_EVERY === 0) {
            if (onProgress) onProgress(i / treeCount);
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    }

    // Create a more organic, bumpy trunk geometry instead of a perfect cylinder
    const trunkGeo = new THREE.CylinderGeometry(0.85, 1.25, 1, 16, 8); // Higher poly count (16 radial, 8 height) and tapered
    const trunkPos = trunkGeo.attributes.position;
    for (let j = 0; j < trunkPos.count; j++) {
        const x = trunkPos.getX(j);
        const y = trunkPos.getY(j);
        const z = trunkPos.getZ(j);
        const rad = Math.sqrt(x*x + z*z);
        if (rad > 0.1) {
            const angle = Math.atan2(z, x);
            // More intense, multi-frequency organic vertex displacement
            const bump = 1.0 
                + 0.22 * Math.sin(angle * 4.0 + y * 8.0) 
                + 0.15 * Math.cos(angle * 7.0 - y * 12.0)
                + 0.08 * Math.sin(angle * 13.0 + y * 20.0);
            
            // Add a slight twisting effect to the trunk
            const twist = y * 0.8;
            const nx = x * Math.cos(twist) - z * Math.sin(twist);
            const nz = x * Math.sin(twist) + z * Math.cos(twist);
            
            trunkPos.setX(j, nx * bump);
            trunkPos.setZ(j, nz * bump);
        }
    }
    trunkGeo.computeVertexNormals();

    const trunkMat = new THREE.MeshStandardMaterial({ roughness: 0.95, color: 0xffffff });
    
    // Add custom shader to procedurally blend bark grooves and dynamic moss
    trunkMat.onBeforeCompile = (shader) => {
        shader.uniforms.uCameraPos = { value: new THREE.Vector3() };
        shader.uniforms.uSwitchDist = { value: LOD_SWITCH_DIST };
        trunkMat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec3 uCameraPos;
            uniform float uSwitchDist;
            varying vec3 vLocalPos;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPos;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vLocalPos = position;
            vWorldPos = (instanceMatrix * vec4(position, 1.0)).xyz;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <defaultnormal_vertex>',
            `#include <defaultnormal_vertex>
            // Transform normal to world space for realistic directional moss
            vWorldNormal = normalize(mat3(instanceMatrix) * objectNormal);`
        );
        // Full-detail geometry collapses past LOD_SWITCH_DIST, where its
        // billboard imposter (createTreeImposters, above) takes over —
        // opposite condition from the imposter's own collapse, so exactly
        // one of the two is ever visible for a given tree/camera distance.
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
            ${collapseVertexGLSL('distance(vWorldPos, uCameraPos) > uSwitchDist')}`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vLocalPos;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPos;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            vec4 diffuseColor = vec4( diffuse, opacity );
            
            // Procedural bark grooves based on local position
            float barkNoise = sin(vLocalPos.x * 12.0 + vLocalPos.y * 4.0) * cos(vLocalPos.z * 12.0 + vLocalPos.y * 4.0);
            barkNoise = smoothstep(-1.0, 1.0, barkNoise);
            vec3 barkDark = diffuse * 0.35;
            diffuseColor.rgb = mix(barkDark, diffuse, barkNoise * 0.5 + 0.5);

            // Procedural moss clustered on upward-facing normals and closer to the ground
            float upFactor = clamp(vWorldNormal.y + 0.1, 0.0, 1.0);
            float heightFactor = clamp(1.0 - (vWorldPos.y / 25.0), 0.0, 1.0); 
            
            // Break up the moss with world-space noise
            float n = sin(vWorldPos.x * 6.0) * cos(vWorldPos.y * 8.0) * sin(vWorldPos.z * 6.0);
            float mossAmount = clamp((upFactor * heightFactor * 0.95) + (n * 0.25), 0.0, 1.0);
            
            vec3 mossColor = vec3(0.12, 0.28, 0.08); // Deep forest moss green
            diffuseColor.rgb = mix(diffuseColor.rgb, mossColor, mossAmount);
            `
        );
    };

    // Trees near the boundary are the main thing whose silhouettes read as
    // a hard edge against the sky — melt them into the actual sky/mountain
    // color behind them instead of a flat fog tint (fx/dynamic-fog.js).
    // Called after the bark/moss onBeforeCompile above so it wraps rather
    // than replaces it.
    // addDynamicFog(trunkMat, ...) removed — dynamic fog removed for performance, see main.js.

    const branchMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, state.branchMatrices.length);
    branchMesh.castShadow = true; branchMesh.receiveShadow = true;
    branchMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.branchColors), 3);
    for(let i=0; i < state.branchMatrices.length; i++) branchMesh.setMatrixAt(i, state.branchMatrices[i]);
    state.scene.add(branchMesh);

    const leafGeo = new THREE.PlaneGeometry(1.4, 1.4);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide, map: state.globalTextures.leaf, alphaTest: 0.4, transparent: true });
    leafMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uCameraPos = { value: new THREE.Vector3() };
        shader.uniforms.uSwitchDist = { value: LOD_SWITCH_DIST };
        leafMat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            uniform vec3 uCameraPos;
            uniform float uSwitchDist;
            varying vec3 vLeafWorldPos;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vec4 leafWorldPos = instanceMatrix * vec4(position, 1.0);
            vLeafWorldPos = leafWorldPos.xyz;
            float flutter = sin(leafWorldPos.x * 4.0 + uTime * 2.5) * cos(leafWorldPos.z * 4.0 + uTime * 1.8) * 0.08;
            transformed.xyz += flutter;`
        );
        // Same LOD collapse as trunkMat — leaves and branches share one
        // switch distance so a tree's canopy and trunk always swap to the
        // imposter together, never one without the other.
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
            ${collapseVertexGLSL('distance(vLeafWorldPos, uCameraPos) > uSwitchDist')}`
        );
    };
    // addDynamicFog(leafMat, ...) removed — dynamic fog removed for performance, see main.js.

    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, state.leafMatrices.length);
    // Optimized: Disabled leaf shadows. Overlapping transparent shadows on millions of instances causes severe overdraw
    leafMesh.castShadow = false; 
    leafMesh.receiveShadow = false;
    leafMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.leafColors), 3);
    for(let i=0; i < state.leafMatrices.length; i++) leafMesh.setMatrixAt(i, state.leafMatrices[i]);
    state.scene.add(leafMesh);

    createTreeImposters(state, treeInstances);
}