import * as THREE from 'three';
import { state, WORLD_SIZE } from '../core/state.js';
import { MESH_SEGMENTS, getMeshHeights } from '../core/heightmap.js';
import { getSplatTexture, CRATER } from '../core/splat.js';

// Terrain v2: per-fragment splat shading (audit 4.4). The old per-vertex
// elevation bands (near-black at 3 u vertex spacing, no path/grass/rock
// awareness) are gone. Colour now comes from core/splat.js's mask texture
// (R grass, G rock, B sand/ash, A path) + height bands + procedural
// value-noise detail in the fragment shader — zero texture files.
// Palette is authored AFTER the B-01 OutputPass fix, so these are real
// display colours (Color(hex) converts to linear, as three expects).
const PALETTE = {
    oceanBed:   0x1b2a33,
    wetSand:    0x5b5240,
    drySand:    0x8d8262,
    grassA:     0x3f5f2c,
    grassB:     0x59703a,
    rockA:      0x5d5f60,
    rockB:      0x484b50,
    slate:      0x4b525c,
    peak:       0x2b2e35,
    ash:        0x2a2523,
    path:       0x74613f,
    magma:      0xdc2626,
};

const VERT_PARS = `
    varying vec3 vWPos;
`;
const VERT_BODY = `
    #include <begin_vertex>
    vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = `
    uniform sampler2D uSplat;
    uniform float uWorld;
    uniform vec2 uCrater;
    uniform float uTime;
    uniform vec3 uCOcean, uCWet, uCSand, uCGrassA, uCGrassB, uCRockA, uCRockB, uCSlate, uCPeak, uCAsh, uCPath, uCMagma;
    varying vec3 vWPos;
    float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float tNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x),
                   mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float gMagma;
`;

const FRAG_COLOR = `
    {
        vec2 suv = (vWPos.xz + 0.5 * uWorld) / uWorld;
        vec4 sp = texture2D(uSplat, suv);
        float h = vWPos.y;
        float nMacro = tNoise(vWPos.xz * 0.012);          // 100-300 u colour drift
        float nMid   = tNoise(vWPos.xz * 0.07);
        float nFine  = tNoise(vWPos.xz * 0.9);
        float grain  = (nMid * 0.6 + nFine * 0.4) - 0.5;

        // base ground by height: seabed -> wet sand -> dry sand
        vec3 col = mix(uCOcean, uCWet, smoothstep(-0.6, 1.4, h));
        col = mix(col, uCSand, smoothstep(1.6, 4.4, h));
        col *= 1.0 + grain * 0.22;

        // grass ground colour (the "ground-colour trick": blades only add parallax on top)
        vec3 gcol = mix(uCGrassA, uCGrassB, smoothstep(0.25, 0.75, nMacro + grain * 0.5));
        gcol *= 1.0 + grain * 0.3;
        col = mix(col, gcol, sp.r);

        // rock: two tones + a slate tint that takes over with altitude, dark near the summit
        vec3 rcol = mix(uCRockA, uCRockB, smoothstep(0.3, 0.7, nMid + grain));
        rcol = mix(rcol, uCSlate, smoothstep(26.0, 52.0, h));
        rcol = mix(rcol, uCPeak, smoothstep(58.0, 86.0, h));
        rcol *= 1.0 + grain * 0.35;
        col = mix(col, rcol, sp.g);

        // ash apron around the crater (B channel doubles as sand; only near the crater is it ash)
        float cd = distance(vWPos.xz, uCrater);
        float ashW = (1.0 - smoothstep(48.0, 84.0, cd)) * sp.b;
        col = mix(col, uCAsh * (1.0 + grain * 0.4), ashW);

        // trails + POI pads
        vec3 pcol = uCPath * (1.0 + grain * 0.5);
        pcol *= 0.85 + 0.15 * smoothstep(0.4, 1.0, sp.a);     // slightly darker packed centre
        col = mix(col, pcol, sp.a);

        // magma inside the crater bowl (same footprint as the old vertex blend)
        gMagma = (1.0 - smoothstep(10.0, 40.0, cd)) * (1.0 - smoothstep(50.0, 58.0, h));
        col = mix(col, uCMagma, gMagma);

        diffuseColor.rgb *= col;
    }
`;

export function createTerrain() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, MESH_SEGMENTS, MESH_SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const meshH = getMeshHeights(); // same array heightAt() reads — index i matches PlaneGeometry vertex order
    for (let i = 0; i < pos.count; i++) pos.setY(i, meshH[i]);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        roughness: 0.92,
        metalness: 0.0,
        flatShading: true,
    });
    mat.onBeforeCompile = (shader) => {
        const c = (hex) => ({ value: new THREE.Color(hex) });
        shader.uniforms.uSplat = { value: getSplatTexture() };
        shader.uniforms.uWorld = { value: WORLD_SIZE };
        shader.uniforms.uCrater = { value: new THREE.Vector2(CRATER.x, CRATER.z) };
        shader.uniforms.uTime = { value: 0 }; // day-night-cycle.js feeds every material with userData.shader.uniforms.uTime
        shader.uniforms.uCOcean = c(PALETTE.oceanBed);
        shader.uniforms.uCWet = c(PALETTE.wetSand);
        shader.uniforms.uCSand = c(PALETTE.drySand);
        shader.uniforms.uCGrassA = c(PALETTE.grassA);
        shader.uniforms.uCGrassB = c(PALETTE.grassB);
        shader.uniforms.uCRockA = c(PALETTE.rockA);
        shader.uniforms.uCRockB = c(PALETTE.rockB);
        shader.uniforms.uCSlate = c(PALETTE.slate);
        shader.uniforms.uCPeak = c(PALETTE.peak);
        shader.uniforms.uCAsh = c(PALETTE.ash);
        shader.uniforms.uCPath = c(PALETTE.path);
        shader.uniforms.uCMagma = c(PALETTE.magma);
        mat.userData.shader = shader;

        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + VERT_PARS)
            .replace('#include <begin_vertex>', VERT_BODY);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
            // faint self-glow in the crater so it reads from spawn (audit acceptance)
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n    totalEmissiveRadiance += vec3(0.85, 0.10, 0.05) * gMagma * 0.55;');
    };
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    terrain.castShadow = false; // B-07: avoid self-shadow acne
    state.scene.add(terrain);

    // Crater glow light - The Serpent's Coil
    const abyssLight = new THREE.PointLight(0xef4444, 5, 90);
    abyssLight.position.set(0, 40, -12);
    state.scene.add(abyssLight);
}
