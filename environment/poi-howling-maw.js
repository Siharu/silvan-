// The Howling Maw (cave) — ported from
// reference-assets/no_3_the_howling_maw_.html. A jagged fang-cave built
// from clustered, hand-distorted dodecahedron "shards" (createCraggyFang):
// two front fangs, an arch overhead, a backing wall/arch to give the
// cluster mountain-like bulk from any angle, 25 scattered outlying rocks,
// a bottomless tunnel void behind the mouth, and two icicle fields (roof
// + ground). Lighting: an unsteady red "dread" glow from deep inside plus
// a rarer, brighter reddish-violet "pulse" flash on a random 4-9s cycle,
// both animated per-frame — see updateHowlingMaw().
//
// Dropped from the port, same reasoning as Radio Tower's ground/dust:
// these belonged to the mockup's own standalone scene/atmosphere, not
// the cave structure itself — the procedural terrain pit and rock bump
// texture (this map already has its own terrain), and the custom-shader
// mist + ash particle systems (a good candidate for a later fx/ pass
// using this project's existing fx/fireflies.js-style PointsMaterial
// approach, rather than porting the mockup's bespoke ShaderMaterial).
import * as THREE from 'three';
import { state } from '../core/state.js';

let dreadLight = null;
let pulseLight = null;
let elapsed = 0;
let isPulsing = false;
let pulseDuration = 0;
let pulseIntensityTarget = 0;
let nextPulseTime = 4 + Math.random() * 5;

export function createHowlingMaw(x, y, z) {
    const group = new THREE.Group();
    const mawGroup = new THREE.Group();
    group.add(mawGroup);

    const graniteMaterial = new THREE.MeshStandardMaterial({
        color: 0x1f242b,
        roughness: 1.0,
        metalness: 0.1,
        flatShading: true
    });

    function createCraggyFang(height, radius) {
        const fangGroup = new THREE.Group();
        const segments = 4;
        const segmentHeight = height / segments;

        for (let i = 0; i < segments; i++) {
            const radiusAtLevel = radius * (1 - (i / segments) * 0.8);
            const geo = new THREE.DodecahedronGeometry(radiusAtLevel, 1);

            const pos = geo.attributes.position;
            for (let j = 0; j < pos.count; j++) {
                pos.setX(j, pos.getX(j) * (0.6 + Math.random() * 0.8));
                pos.setY(j, pos.getY(j) * (0.6 + Math.random() * 0.8));
                pos.setZ(j, pos.getZ(j) * (0.6 + Math.random() * 0.8));
            }
            geo.computeVertexNormals();

            const mesh = new THREE.Mesh(geo, graniteMaterial);
            mesh.position.y = i * segmentHeight;
            mesh.rotation.y = Math.random() * Math.PI;
            mesh.rotation.z = (Math.random() - 0.5) * 0.3;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            fangGroup.add(mesh);
        }
        return fangGroup;
    }

    const leftShard = createCraggyFang(18, 7);
    leftShard.position.set(-9, 1, -5);
    leftShard.rotation.z = -0.25;
    mawGroup.add(leftShard);

    const rightShard = createCraggyFang(15, 8);
    rightShard.position.set(8, 1, -3);
    rightShard.rotation.z = 0.2;
    mawGroup.add(rightShard);

    const arch = createCraggyFang(22, 6);
    arch.position.set(0, 16, -9);
    arch.rotation.z = Math.PI / 2;
    arch.scale.set(1, 0.7, 1);
    mawGroup.add(arch);

    // Backing rocks to hide the "billboard" effect and build a mountain shape
    const backWall1 = createCraggyFang(25, 10);
    backWall1.position.set(-10, 5, -15);
    backWall1.rotation.y = 0.5;
    mawGroup.add(backWall1);

    const backWall2 = createCraggyFang(22, 12);
    backWall2.position.set(12, 4, -16);
    backWall2.rotation.y = -0.4;
    mawGroup.add(backWall2);

    const backArch = createCraggyFang(28, 8);
    backArch.position.set(0, 20, -18);
    backArch.rotation.z = Math.PI / 2 + 0.2;
    mawGroup.add(backArch);

    const leftBulk = createCraggyFang(18, 9);
    leftBulk.position.set(-18, 0, -8);
    mawGroup.add(leftBulk);

    const rightBulk = createCraggyFang(16, 9);
    rightBulk.position.set(16, 0, -10);
    mawGroup.add(rightBulk);

    // Bottomless tunnel void behind the mouth
    const tunnel = new THREE.Mesh(
        new THREE.CylinderGeometry(6.5, 3, 40, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, fog: false })
    );
    tunnel.position.set(0, -20, -11);
    mawGroup.add(tunnel);

    const tunnelCap = new THREE.Mesh(
        new THREE.CircleGeometry(3.5, 32),
        new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })
    );
    tunnelCap.position.set(0, -19.5, 0);
    tunnelCap.rotation.x = -Math.PI / 2;
    tunnel.add(tunnelCap);

    // Surrounding hostile landscape
    for (let i = 0; i < 25; i++) {
        const rock = createCraggyFang(6 + Math.random() * 10, 3 + Math.random() * 5);
        const angle = Math.random() * Math.PI;
        const dist = 12 + Math.random() * 15;
        rock.position.set(Math.cos(angle) * dist, -2, -10 - Math.sin(angle) * 15);
        rock.rotation.set(Math.random() - 0.5, Math.random() * Math.PI, Math.random() - 0.5);
        mawGroup.add(rock);
    }

    // Deep void blocking the back
    const caveVoid = new THREE.Mesh(
        new THREE.PlaneGeometry(35, 30),
        new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, depthWrite: true })
    );
    caveVoid.position.set(0, 10, -17);
    mawGroup.add(caveVoid);

    // Icicles
    const icicleMaterial = new THREE.MeshStandardMaterial({
        color: 0x8aa8c4,
        transparent: true,
        opacity: 0.45,
        roughness: 0.2,
        metalness: 0.5
    });

    function createIcicles(count, areaWidth, areaDepth, isGround) {
        const icicleGroup = new THREE.Group();
        const coneGeo = new THREE.ConeGeometry(0.5, 1, 5);

        for (let i = 0; i < count; i++) {
            const length = 1.5 + Math.random() * 5;
            const thickness = 0.15 + Math.random() * 0.3;

            const icicle = new THREE.Mesh(coneGeo, icicleMaterial);
            icicle.scale.set(thickness, length, thickness);

            const ix = (Math.random() - 0.5) * areaWidth;
            const iz = (Math.random() - 0.5) * areaDepth;
            icicle.position.set(ix, -length / 2, iz);
            icicle.rotation.x = (Math.random() - 0.5) * 0.3;
            icicle.rotation.z = (Math.random() - 0.5) * 0.3;

            if (isGround) {
                icicle.position.y = length / 2;
                icicle.rotation.x += Math.PI;
            }
            icicleGroup.add(icicle);
        }
        return icicleGroup;
    }

    const upperIcicles = createIcicles(35, 14, 5, false);
    upperIcicles.position.set(0, 15, -8);
    mawGroup.add(upperIcicles);

    const groundIcicles = createIcicles(20, 12, 6, true);
    groundIcicles.position.set(0, 0, -5);
    mawGroup.add(groundIcicles);

    // Dreadful ominous glow from deep inside, animated in updateHowlingMaw()
    dreadLight = new THREE.PointLight(0x880505, 0, 25);
    dreadLight.position.set(0, 5, -12);
    mawGroup.add(dreadLight);

    // Rarer reddish-violet pulse flash
    pulseLight = new THREE.PointLight(0xb15eff, 0, 40);
    pulseLight.position.set(0, 8, -5);
    group.add(pulseLight);

    const interiorColdLight = new THREE.PointLight(0x3b628f, 1.2, 20);
    interiorColdLight.position.set(0, 6, -6);
    mawGroup.add(interiorColdLight);

    group.position.set(x, y, z);
    state.scene.add(group);
    return group;
}

// Per-frame dread-light throb + periodic pulse flash. delta is in
// seconds. Mirrors the mockup's animate() logic 1:1.
export function updateHowlingMaw(delta) {
    if (!dreadLight || !pulseLight) return;
    elapsed += delta;
    const time = elapsed;

    dreadLight.intensity = 1.2 + Math.sin(time * 2.5) * 0.8 + Math.random() * 0.3;

    if (!isPulsing && time > nextPulseTime) {
        isPulsing = true;
        pulseDuration = 1.2 + Math.random() * 1.5;
        pulseIntensityTarget = 1.5 + Math.random() * 2.0;
        nextPulseTime = time + pulseDuration + 4.0 + Math.random() * 5.0;
    }

    if (isPulsing) {
        pulseDuration -= delta;
        if (pulseDuration <= 0) {
            isPulsing = false;
            pulseLight.intensity = 0;
        } else {
            const progress = pulseDuration;
            pulseLight.intensity = Math.sin(progress * Math.PI) * pulseIntensityTarget;
        }
    }
}
