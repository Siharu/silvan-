import * as THREE from 'three';
import { state, DAY_LENGTH_MS, WEATHER_CHANGE_INTERVAL_MS } from '../core/state.js';
import { heightAt as getElevation } from '../core/heightmap.js';

// Cached once instead of getElementById() every frame (Phase 3 #20) — these
// three never change identity for the life of the page.
let weatherEl = null, weatherTextEl = null, dayEl = null, timeEl = null;

// Phase 7 #40: hoisted out of updateAtmosphere() — see the note there.
const SKY_DAY = new THREE.Color(0x5a6a7a), SKY_NIGHT = new THREE.Color(0x0a0f1c);
const HOR_DAY = new THREE.Color(0x8a9aa8), HOR_SUNSET = new THREE.Color(0xa86c42), HOR_NIGHT = new THREE.Color(0x040810);
const CLOUD_TWI_A = new THREE.Color(0x222233), CLOUD_TWI_B = new THREE.Color(0x887777), CLOUD_TWI_C = new THREE.Color(0xa0a5ab);
const FOG_DAY = new THREE.Color(0x607080), CLOUD_DAY = new THREE.Color(0x9098a0);
const FOG_NIGHT = new THREE.Color(0x040810), CLOUD_NIGHT = new THREE.Color(0x111125);
const RAIN_FOG = new THREE.Color(0x2a3038), RAIN_TOP = new THREE.Color(0x3a4048), RAIN_CLOUD = new THREE.Color(0x2a2a2a);
const RAIN_COL_DAY = new THREE.Color(0xe6f0fa), RAIN_COL_NIGHT = new THREE.Color(0x334466);
const _top = new THREE.Color(), _bot = new THREE.Color(), _fog = new THREE.Color(), _cloud = new THREE.Color();
const _camDir = new THREE.Vector3();

export function updateAtmosphere(delta) {
    if (!weatherEl) weatherEl = document.getElementById('weather-display');
    if (!weatherTextEl) weatherTextEl = document.getElementById('weather-text');
    if (!dayEl) dayEl = document.getElementById('day-display');
    if (!timeEl) timeEl = document.getElementById('time-display');

    state.timeMultiplier = state.keys.g ? 50 : 1;
    
    // WEATHER LOGIC
    state.weatherChangeTimer += delta * state.timeMultiplier;
    if (state.weatherChangeTimer > WEATHER_CHANGE_INTERVAL_MS) { // Change weather periodically (accelerated by resting)
        state.weatherChangeTimer = 0;
        state.targetRainIntensity = Math.random() > 0.5 ? 0.0 : Math.random(); 
    }
    // Smoothly interpolate rain intensity
    state.currentRainIntensity += (state.targetRainIntensity - state.currentRainIntensity) * 0.0005 * delta;
    
    const isNight = state.gameTime < 0.25 || state.gameTime > 0.79;
    const weatherKey = state.currentRainIntensity > 0.7 ? 'heavy' : (state.currentRainIntensity > 0.15 ? 'light' : (isNight ? 'clear-night' : 'clear'));
    if (weatherEl && weatherEl.dataset.weather !== weatherKey) {
        weatherEl.dataset.weather = weatherKey;
        const label = { heavy: 'heavy rain', light: 'light rain', clear: 'clear skies', 'clear-night': 'clear night' }[weatherKey];
        weatherTextEl.textContent = label;
    }

    state.gameTime += (delta / DAY_LENGTH_MS) * state.timeMultiplier;
    if (state.gameTime >= 1.0) { state.gameTime -= 1.0; state.daysPassed++; if (dayEl) dayEl.textContent = `Day ${state.daysPassed}`; }
    const h24 = Math.floor(state.gameTime * 24);
    const hrs = (h24 % 12) === 0 ? 12 : h24 % 12;
    const mins = Math.floor((state.gameTime * 24 * 60) % 60).toString().padStart(2, '0');
    if (timeEl) timeEl.textContent = `${hrs}:${mins} ${h24 < 12 ? 'am' : 'pm'}`;

    const angle = state.gameTime * Math.PI * 2 - Math.PI / 2;
    const sy = Math.sin(angle); const sx = Math.cos(angle);
    state.sunLight.position.set(sx * 600, sy * 600, -200);
    state.moonLight.position.set(-sx * 600, -sy * 600, 200);
    if(state.moonSprite) { state.moonSprite.position.set(-sx*550, -sy*550, 200); state.moonSprite.material.opacity = Math.max(0, -sy + 0.3); }

    const dayBlend = Math.max(0, Math.min(1, sy * 2.5 + 0.5));
    state.sunLight.intensity = Math.max(0, sy) * 1.5;
    state.moonLight.intensity = Math.max(0, -sy) * 0.5;

    // Phase 4 #22: was hardcoded once at creation and never touched again,
    // so ambient light never dimmed at night. Sky/ground hues left as-is
    // (they already read fine in both states); only intensity tracks
    // day/night now, floored so night isn't pitch-black everywhere shadows
    // fall (moon/star/fire lighting still needs *something* to bounce off).
    if (state.hemiLight) {
        state.hemiLight.intensity = THREE.MathUtils.lerp(0.18, 1.15, dayBlend);
    }

    // Phase 7 #40: palette constants and working colors live at module
    // scope and are mutated in place — this used to allocate ~15 new
    // THREE.Color objects every frame. Working colors are always .copy()'d
    // from a constant before being lerped, so the constants never get mutated.
    const topC = _top, botC = _bot, fogC = _fog, cloudC = _cloud;
    if (sy > -0.2 && sy < 0.2) {
        const t = (sy + 0.2) / 0.4;
        topC.copy(SKY_NIGHT).lerp(SKY_DAY, t);
        botC.copy(HOR_NIGHT).lerp(HOR_SUNSET, t<0.5?t*2:1).lerp(HOR_DAY, t>0.5?(t-0.5)*2:0);
        fogC.copy(HOR_NIGHT).lerp(HOR_SUNSET, t);
        cloudC.copy(CLOUD_TWI_A).lerp(CLOUD_TWI_B, t<0.5?t*2:1).lerp(CLOUD_TWI_C, t>0.5?(t-0.5)*2:0);
    } else if (sy >= 0.2) {
        topC.copy(SKY_DAY); botC.copy(HOR_DAY); fogC.copy(FOG_DAY); cloudC.copy(CLOUD_DAY);
    } else {
        topC.copy(SKY_NIGHT); botC.copy(HOR_NIGHT); fogC.copy(FOG_NIGHT); cloudC.copy(CLOUD_NIGHT);
    }
    
    // Darken the atmosphere when it's raining
    fogC.lerp(RAIN_FOG, state.currentRainIntensity * 0.6);
    topC.lerp(RAIN_TOP, state.currentRainIntensity * 0.7);
    
    state.scene.fog.color.copy(fogC); state.skyMat.uniforms.topColor.value.copy(topC); state.skyMat.uniforms.bottomColor.value.copy(botC);
    if(state.cloudMat) {
        cloudC.lerp(RAIN_CLOUD, state.currentRainIntensity * 0.8);
        state.cloudMat.uniforms.cloudColor.value.copy(cloudC);
    }

    const ts = performance.now() * 0.001;
    state.scene.traverse((c) => { if (c.material && c.material.userData && c.material.userData.shader) c.material.userData.shader.uniforms.uTime.value = ts; });
    if (state.rainMaterial) {
        const u = state.rainMaterial.uniforms;
        u.uTime.value = ts;

        // Anchor follows the camera's position only (never rotation), so
        // rain always falls straight down in world space regardless of
        // where the player is looking — see the note in createRainSystem().
        state.rainAnchor.position.set(state.camera.position.x, 0, state.camera.position.z);
        u.uAnchorY.value = state.camera.position.y;

        // Squash the sprite UV and shrink point size a bit when looking
        // more up/down, so streaks don't read as flat dots from directly
        // overhead/below.
        const camDir = _camDir;
        state.camera.getWorldDirection(camDir);
        const verticalFacing = Math.abs(camDir.y);
        u.uUvSquash.value = THREE.MathUtils.lerp(1, 0.05, verticalFacing);
        u.uSize.value = 7 * THREE.MathUtils.lerp(1, 0.7, verticalFacing) * (0.5 + 0.5 * u.uUvSquash.value);

        u.uColor.value.copy(RAIN_COL_DAY).lerp(RAIN_COL_NIGHT, 1 - dayBlend);
        u.uOpacity.value = THREE.MathUtils.lerp(0.15, 0.95, Math.min(1.0, state.currentRainIntensity * 1.3));

        const activeCount = Math.max(0, Math.floor(45000 * state.currentRainIntensity));
        state.rainMesh.geometry.setDrawRange(0, activeCount);
        state.rainMesh.visible = state.currentRainIntensity > 0.01;
    }

    if (state.rainSplashMat) {
        state.rainSplashMat.opacity = THREE.MathUtils.lerp(0.2, 0.85, Math.min(1.0, state.currentRainIntensity * 1.3));
        state.rainSplashMesh.visible = state.currentRainIntensity > 0.15; // match the CLEAR/LIGHT RAIN threshold above
    }

    // Feed the water shader its fake-reflection sun/moon glint direction & strength
    if (state.waterMaterial && state.waterMaterial.userData && state.waterMaterial.userData.shader) {
        const wU = state.waterMaterial.userData.shader.uniforms;
        wU.uSunDir.value.copy(state.sunLight.position).normalize();
        wU.uMoonDir.value.copy(state.moonLight.position).normalize();
        wU.uSunStrength.value = Math.max(0, sy);
        wU.uMoonStrength.value = Math.max(0, -sy);
        wU.uSkyColor.value.copy(topC);
    }

    // Update puddle shader uniforms and opacity based on rain intensity
    if (state.puddleMaterial && state.puddleMaterial.userData && state.puddleMaterial.userData.shader) {
        state.puddleMaterial.userData.shader.uniforms.uTime.value = ts;
        state.puddleMaterial.userData.shader.uniforms.uRainIntensity.value = state.currentRainIntensity;
        state.puddleMaterial.opacity = Math.min(0.85, state.currentRainIntensity * 1.2);
    }
    
    // Fireflies hide in heavy rain
    if (state.fireflyMat) state.fireflyMat.opacity = Math.max(0, 1.0 - dayBlend * 2.2) * (1.0 - state.currentRainIntensity * 0.8);
    
    // Update Stars
    if (state.starMat) {
        const starVisibility = Math.max(0, -sy * 1.5); // Visible only at night
        const weatherClearance = 1.0 - (state.currentRainIntensity * 1.2); // Hidden by rain
        state.starMat.uniforms.uOpacity.value = Math.max(0, starVisibility * weatherClearance);
        state.starMat.uniforms.uTime.value = ts;
    }

    // Update Dust
    if (state.dustMat) {
        state.dustMat.uniforms.uTime.value = ts;
        state.dustMat.uniforms.uCameraPos.value.copy(state.camera.position);
        const dustWeatherVisibility = Math.max(0, 1.0 - state.currentRainIntensity * 1.5);
        const lightVisibility = Math.max(0.3, sy); // More visible in day
        state.dustMat.uniforms.uVisibility.value = dustWeatherVisibility * lightVisibility;
    }

    if (state.isPlaying) { 
        state.dayAmbientAudio.volume(dayBlend * 0.45);
        state.nightAmbientAudio.volume((1 - dayBlend) * 0.35);
        state.windAudio.volume(0.08 + state.currentRainIntensity * 0.07); // Subtle always-on breeze, swells a bit with weather
        state.rainAudio.volume(0.35 * state.currentRainIntensity); 

        // Fade water ambience in as the state.player nears the lake shoreline elevation
        const playerGroundY = getElevation(state.player.position.x, state.player.position.z);
        const waterProximity = Math.max(0, 1.0 - Math.abs(playerGroundY - 1.6) / 20.0);
        state.waterAudio.volume(waterProximity * 0.4);
    }
}