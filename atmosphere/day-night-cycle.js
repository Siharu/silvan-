// Per-frame time-of-day + weather update: gameTime advance, weather
// transitions, sky/fog/light uniforms, rain/splash/star/dust visibility,
// and ambient audio volume crossfades (day/night/wind/rain/water
// proximity). This was the largest, most tangled function in the original
// build — kept as one function here since the sub-pieces all read the same
// per-frame sun-angle math, but audio *setup* (Howl instances, SOUNDS
// config) has been pulled out to audio/ambience.js.

import * as THREE from 'three';
import { DAY_LENGTH_MS } from '../core/world-state.js';
import { getElevation } from '../environment/terrain.js';
import { updateWindLeaves } from '../fx/wind-leaves.js';

export function updateAtmosphere(state, delta) {
    state.timeMultiplier = state.keys.r ? 50 : 1;
    
    // WEATHER LOGIC
    state.weatherChangeTimer += delta * state.timeMultiplier;
    if (state.weatherChangeTimer > 25000) { // Change weather periodically (accelerated by resting)
        state.weatherChangeTimer = 0;
        state.targetRainIntensity = Math.random() > 0.5 ? 0.0 : Math.random(); 
    }
    // Smoothly interpolate rain intensity
    state.currentRainIntensity += (state.targetRainIntensity - state.currentRainIntensity) * 0.0005 * delta;
    
    const weatherText = state.currentRainIntensity > 0.7 ? "HEAVY RAIN" : (state.currentRainIntensity > 0.15 ? "LIGHT RAIN" : "CLEAR");
    document.getElementById('weather-display').textContent = `WEATHER: ${weatherText}`;

    state.gameTime += (delta / DAY_LENGTH_MS) * state.timeMultiplier;
    if (state.gameTime >= 1.0) { state.gameTime -= 1.0; state.daysPassed++; document.getElementById('day-display').textContent = `DAY: ${state.daysPassed}`; }
    const hrs = Math.floor(state.gameTime * 24).toString().padStart(2, '0');
    const mins = Math.floor((state.gameTime * 24 * 60) % 60).toString().padStart(2, '0');
    document.getElementById('time-display').textContent = `TIME: ${hrs}:${mins}`;

    const angle = state.gameTime * Math.PI * 2 - Math.PI / 2;
    const sy = Math.sin(angle); const sx = Math.cos(angle);
    state.sunLight.position.set(sx * 600, sy * 600, -200);
    state.moonLight.position.set(-sx * 600, -sy * 600, 200);
    if(state.moonSprite) { state.moonSprite.position.set(-sx*550, -sy*550, 200); state.moonSprite.material.opacity = Math.max(0, -sy + 0.3); }

    const dayBlend = Math.max(0, Math.min(1, sy * 2.5 + 0.5));
    state.sunLight.intensity = Math.max(0, sy) * 1.5;
    state.moonLight.intensity = Math.max(0, -sy) * 0.5;

    const skyDay = new THREE.Color(0x5a6a7a); const skyNight = new THREE.Color(0x0a0f1c);
    const horDay = new THREE.Color(0x8a9aa8); const horSunset = new THREE.Color(0xa86c42); const horNight = new THREE.Color(0x040810);
    let topC, botC, fogC, cloudC;
    if (sy > -0.2 && sy < 0.2) {
        const t = (sy + 0.2) / 0.4;
        topC = skyNight.clone().lerp(skyDay, t);
        botC = horNight.clone().lerp(horSunset, t<0.5?t*2:1).lerp(horDay, t>0.5?(t-0.5)*2:0);
        fogC = horNight.clone().lerp(horSunset, t);
        cloudC = new THREE.Color(0x222233).lerp(new THREE.Color(0x887777), t<0.5?t*2:1).lerp(new THREE.Color(0xa0a5ab), t>0.5?(t-0.5)*2:0);
    } else if (sy >= 0.2) {
        topC = skyDay; botC = horDay; fogC = new THREE.Color(0x607080); cloudC = new THREE.Color(0x9098a0);
    } else {
        topC = skyNight; botC = horNight; fogC = new THREE.Color(0x040810); cloudC = new THREE.Color(0x111125);
    }
    
    // Darken the atmosphere when it's raining
    fogC.lerp(new THREE.Color(0x2a3038), state.currentRainIntensity * 0.6);
    topC.lerp(new THREE.Color(0x3a4048), state.currentRainIntensity * 0.7);
    
    state.scene.fog.color.copy(fogC); state.skyMat.uniforms.topColor.value.copy(topC); state.skyMat.uniforms.bottomColor.value.copy(botC);
    if(state.cloudMat) {
        cloudC.lerp(new THREE.Color(0x2a2a2a), state.currentRainIntensity * 0.8);
        state.cloudMat.uniforms.cloudColor.value.copy(cloudC);
    }

    const ts = performance.now() * 0.001;
    updateWindLeaves(state, ts);
    state.scene.traverse((c) => { if (c.material && c.material.userData && c.material.userData.shader) c.material.userData.shader.uniforms.uTime.value = ts; });
    if (state.rainMaterial && state.rainMaterial.userData && state.rainMaterial.userData.shader) {
        state.rainMaterial.userData.shader.uniforms.uCameraPos.value.copy(state.camera.position);
        state.rainMaterial.color.set(new THREE.Color(0xffffff).lerp(new THREE.Color(0x334466), 1 - dayBlend));
        
        state.rainMaterial.opacity = 0.15 * Math.min(1.0, state.currentRainIntensity * 2.0);
        state.rainMesh.count = Math.max(0, Math.floor(45000 * state.currentRainIntensity));
        state.rainMesh.visible = state.currentRainIntensity > 0.01;
    }

    if (state.rainSplashMat) {
        state.rainSplashMat.opacity = 0.5 * Math.min(1.0, state.currentRainIntensity * 1.8);
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
        // Subtle always-on breeze that swells with weather; gets an extra
        // kick past the heavy-rain gust threshold so the audio matches the
        // wind-blown leaves kicking in visually (fx/wind-leaves.js).
        const gust = Math.max(0, state.currentRainIntensity - 0.6) / 0.4;
        state.windAudio.volume(0.08 + state.currentRainIntensity * 0.07 + gust * 0.25);
        state.rainAudio.volume(0.35 * state.currentRainIntensity); 

        // Fade water ambience in as the state.player nears the lake shoreline elevation
        const playerGroundY = getElevation(state.player.position.x, state.player.position.z);
        const waterProximity = Math.max(0, 1.0 - Math.abs(playerGroundY - 1.6) / 20.0);
        state.waterAudio.volume(waterProximity * 0.4);
    }
}
