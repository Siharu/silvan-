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
import { setAmbientVolume } from '../audio/ambience.js';
import { updateRadioTower, updateTowerCutscene } from '../environment/radio-tower.js';



// Wave-height modifier + storm reactivity applied continuously (core/
// modifiers.js's waterWaveHeight/waterStormReactivity, both live-editable
// in Settings > Modifiers) rather than only when a slider moves, so wave
// height keeps rising and falling smoothly as rain intensity itself
// changes. Scales each Gerstner wave's steepness relative to the
// material's own baseSteepness (see environment/water-shader.js), never an
// absolute value, so the lake and ocean presets keep their own distinct
// calm-vs-choppy character rather than converging on one number.
function applyWaveHeightModifier(state, mat) {
    if (!mat.userData.baseSteepness || !state.modifiers) return;
    const stormBoost = 1 + state.currentRainIntensity * (state.modifiers.waterStormReactivity - 1);
    const mult = state.modifiers.waterWaveHeight * stormBoost;
    mat.userData.baseSteepness.forEach((base, i) => {
        mat.uniforms.u_waves.value[i].z = base * mult;
    });
}

export function updateAtmosphere(state, delta) {
    state.timeMultiplier = state.keys.r ? 50 : 1;
    
    // WEATHER LOGIC
    state.weatherChangeTimer += delta * state.timeMultiplier;
    if (state.weatherChangeTimer > 25000) { // Change weather periodically (accelerated by resting)
        state.weatherChangeTimer = 0;
        // Cloudiness and rain are rolled together but not identically: rain
        // always implies cloud cover, but cloud cover (or a fully clear sky)
        // can show up with no rain at all. This is what actually varies the
        // sky — previously rain intensity was the only weather variable, so
        // every "not clear" moment read as an overcast rain prelude and nights/
        // days that weren't raining all defaulted to the same muted grey.
        // Math.random() alone averages 0.5 cloudiness, so the sky read as
        // overcast about as often as not. Squaring skews the distribution
        // toward clear (mostly 0.0-0.4, with real overcast/storm days still
        // possible but rarer) — matches how an actual sky spends most of its
        // time mild/clear with occasional heavy cloud, not a coin flip.
        state.targetCloudiness = Math.random() * Math.random();
        state.targetRainIntensity = (state.targetCloudiness > 0.5 && Math.random() > 0.35)
            ? Math.random() * state.targetCloudiness
            : 0.0;
    }
    // Smoothly interpolate rain intensity and cloudiness (cloudiness eases a
    // touch slower so the sky doesn't visibly snap ahead of the rain arriving)
    state.currentRainIntensity += (state.targetRainIntensity - state.currentRainIntensity) * 0.0005 * delta;
    state.currentCloudiness += (state.targetCloudiness - state.currentCloudiness) * 0.0004 * delta;

    const weatherText = state.currentRainIntensity > 0.7 ? "HEAVY RAIN"
        : state.currentRainIntensity > 0.15 ? "LIGHT RAIN"
        : state.currentCloudiness > 0.65 ? "OVERCAST"
        : state.currentCloudiness > 0.3 ? "PARTLY CLOUDY"
        : "CLEAR";
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

    // Cloud cover drives how much the sun/moon sprites and the water's
    // specular glint (environment/lake.js) fade out — computed once here so
    // storm intensity affects sky, water reflection, and the visible sun
    // disc consistently instead of drifting out of sync. Takes the max of
    // independent cloudiness and rain-implied cover so the sun is always
    // hidden the instant it's actually raining, even if currentCloudiness's
    // slower ease hasn't fully caught up yet.
    const cloudCover = Math.max(state.currentCloudiness, Math.min(1.0, state.currentRainIntensity * 1.4));
    if(state.sunSprite) { state.sunSprite.position.set(sx*550, sy*550, -200); state.sunSprite.material.opacity = Math.max(0, sy) * (1.0 - cloudCover); }

    // Moon glow halo tracks the moon sprite's own position exactly, but
    // fades faster with cloud cover than the disc itself — a hazy sky can
    // still show a dim moon shape through thin cloud, but the soft glow
    // around it (which is really "moonlight visibly scattering in clear
    // air") should disappear well before the disc does.
    if(state.moonGlowSprite) {
        state.moonGlowSprite.position.copy(state.moonSprite.position);
        state.moonGlowSprite.material.opacity = Math.max(0, -sy + 0.2) * (1.0 - cloudCover * 0.85);
    }

    // Sun glow factor — how strongly the volumetric god-rays pass
    // (fx/god-rays.js) should read this frame. Same day/cloud fade the old
    // sprite-based ray burst used (Math.max(0, sy) * (1.0 - cloudCover)),
    // kept here since it's genuinely the same "is the sun up and not
    // covered" math — the pass itself only handles the screen-space/
    // occlusion side, not weather. main.js's animate() reads this each
    // frame and feeds it into state.godRaysPass.intensity alongside
    // state.sunSprite's position, rather than the pass duplicating any of
    // this day-night logic itself.
    state.sunGlowFactor = Math.max(0, sy) * (1.0 - cloudCover);

    const dayBlend = Math.max(0, Math.min(1, sy * 2.5 + 0.5));
    // Sun peak trimmed from 1.5 -> 1.1 (was clipping white against the old
    // 0.85 exposure); moon peak raised 0.5 -> 0.85 and hemi light floors at
    // 0.55 at night instead of sitting flat at 1.15 all the time, so night
    // reads dim-but-visible instead of crushed-black. Sun/hemi day peaks
    // nudged up again (1.1->1.25, 0.7->0.85 range) alongside main.js's
    // exposure bump to 0.95 — still comfortably under ACES's clipping
    // point at this exposure, this time actually giving midday its
    // brightness back instead of just trimming to fix the clip.
    state.sunLight.intensity = Math.max(0, sy) * 1.25;
    state.moonLight.intensity = Math.max(0, -sy) * 0.85;
    if (state.hemiLight) state.hemiLight.intensity = 0.6 + dayBlend * 0.85;

    const skyDay = new THREE.Color(0x5a6a7a); const skyNight = new THREE.Color(0x0a0f1c);
    const horDay = new THREE.Color(0x8a9aa8); const horSunset = new THREE.Color(0xa86c42); const horNight = new THREE.Color(0x040810);
    // True clear-sky colors — previously daytime always used the muted
    // skyDay/horDay pair above regardless of weather, so even "CLEAR" read as
    // overcast. Now clear skies lerp toward vivid blue and only settle into
    // the grey/muted look as currentCloudiness climbs.
    const skyClearTop = new THREE.Color(0x3f7fc9); const skyClearHor = new THREE.Color(0xcfe8f5);
    let topC, botC, fogC, cloudC;
    if (sy > -0.2 && sy < 0.2) {
        const t = (sy + 0.2) / 0.4;
        topC = skyNight.clone().lerp(skyDay, t);
        botC = horNight.clone().lerp(horSunset, t<0.5?t*2:1).lerp(horDay, t>0.5?(t-0.5)*2:0);
        fogC = horNight.clone().lerp(horSunset, t);
        cloudC = new THREE.Color(0x222233).lerp(new THREE.Color(0x887777), t<0.5?t*2:1).lerp(new THREE.Color(0xa0a5ab), t>0.5?(t-0.5)*2:0);
    } else if (sy >= 0.2) {
        topC = skyClearTop.clone().lerp(skyDay, state.currentCloudiness);
        botC = skyClearHor.clone().lerp(horDay, state.currentCloudiness);
        fogC = new THREE.Color(0x9dc3e0).lerp(new THREE.Color(0x607080), state.currentCloudiness);
        cloudC = new THREE.Color(0xffffff).lerp(new THREE.Color(0x9098a0), state.currentCloudiness);
    } else {
        // Was pure near-black (0x111125) with opacity climbing to a full
        // 1.0 at max cloudiness — since the cloud shell sits in front of
        // the star sphere (see sky.js), an overcast night stacked an
        // almost-opaque near-black dome directly over an already-near-black
        // night sky (skyNight/horNight below), blotting out every star and
        // reading as flat, featureless black instead of a moonlit overcast
        // night. Lightened toward a visible slate-blue so the cloud layer
        // itself is legible, and its opacity cap is lowered further down
        // (see uOpacity below) so a hint of the sky/stars still shows
        // through even at full overcast.
        topC = skyNight; botC = horNight; fogC = new THREE.Color(0x040810); cloudC = new THREE.Color(0x33415a);
    }
    
    // Darken the atmosphere when it's raining
    fogC.lerp(new THREE.Color(0x2a3038), state.currentRainIntensity * 0.6);
    topC.lerp(new THREE.Color(0x3a4048), state.currentRainIntensity * 0.7);
    
    state.scene.fog.color.copy(fogC); state.skyMat.uniforms.topColor.value.copy(topC); state.skyMat.uniforms.bottomColor.value.copy(botC);
    if(state.cloudMat) {
        cloudC.lerp(new THREE.Color(0x2a2a2a), state.currentRainIntensity * 0.8);
        state.cloudMat.uniforms.cloudColor.value.copy(cloudC);
        // Coverage shapes actual gaps/density (see sky.js fragment shader);
        // opacity fades thin wisps down further so a barely-cloudy sky doesn't
        // still read as a hazy film over everything.
        state.cloudMat.uniforms.uCoverage.value = state.currentCloudiness;
        // Floor dropped 0.35->0.15 — at low cloudiness the old floor still
        // painted a faint haze over the whole dome even when coverage said
        // "basically clear". Capped at 0.8 rather than a fully opaque 1.0 at
        // max cloudiness — a totally solid cloud shell at night left nothing
        // of the sky or stars visible behind it at all (see cloudC above).
        state.cloudMat.uniforms.opacity.value = 0.15 + state.currentCloudiness * 0.65;
        // uTime was never being fed to this material — cloudMat is a plain
        // ShaderMaterial (not compiled via onBeforeCompile), so the generic
        // userData.shader traverse loop above skips it entirely and its fbm
        // sampling was frozen at uTime=0 forever. This is what made the
        // clouds static instead of drifting.
        state.cloudMat.uniforms.uTime.value = ts;
    }

    const ts = performance.now() * 0.001;
    updateWindLeaves(state, ts);
    updateRadioTower(state, ts, sy < 0);
    updateTowerCutscene(state, delta / 1000);
    // Guard uniforms.uTime itself, not just userData.shader — a material's
    // onBeforeCompile can re-fire mid-session (lighting/fog/quality changes)
    // and briefly leave userData.shader pointing at a shader object whose
    // uniforms aren't populated yet. Without this guard that one frame
    // throws and, since traverse doesn't catch, permanently breaks every
    // later call to this function too.
    state.scene.traverse((c) => {
        if (!c.material || !c.material.userData || !c.material.userData.shader) return;
        const u = c.material.userData.shader.uniforms;
        if (u.uTime) u.uTime.value = ts;
        // Same guard reasoning as uTime above — generic so any material
        // (e.g. the forest LOD imposter swap in environment/forest.js)
        // just has to declare this uniform to get it fed, no per-material
        // wiring here.
        if (u.uCameraPos) u.uCameraPos.value.copy(state.camera.position);
        // Live draw-distance setting (core/settings.js) — same generic
        // pattern as uTime/uCameraPos above, so environment/forest.js's
        // tree LOD switch materials just have to declare this uniform to
        // pick it up, no per-material wiring here either.
        if (u.uSwitchDist && state.settings) u.uSwitchDist.value = state.settings.drawDistance;
    });
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

    // Both the lake and ocean now share environment/water-shader.js's
    // Gerstner shader (Calm Lake / Ocean Breeze presets) instead of the old
    // per-material sun+moon Blinn-Phong setups, so they only take a single
    // blended light direction (u_lightDir) and a sky color for the fresnel
    // mix (u_skyColor), fed the same way for both. u_time isn't reached by
    // the generic scene.traverse loop above (that one only looks for
    // `uTime`, this shader's uniform is named `u_time`), so it's set here.
    const lightDir = sy >= 0
        ? state.sunLight.position.clone().normalize()
        : state.moonLight.position.clone().normalize();
    const ts2 = performance.now() * 0.001;
    if (state.waterMaterial && state.waterMaterial.userData && state.waterMaterial.userData.shader) {
        const wU = state.waterMaterial.userData.shader.uniforms;
        wU.u_lightDir.value.copy(lightDir);
        wU.u_skyColor.value.copy(topC);
        wU.u_time.value = ts2;
        applyWaveHeightModifier(state, state.waterMaterial);
    }
    if (state.oceanMaterial && state.oceanMaterial.userData && state.oceanMaterial.userData.shader) {
        const oU = state.oceanMaterial.userData.shader.uniforms;
        oU.u_lightDir.value.copy(lightDir);
        // Ocean's fresnel/horizon mix reads off botC (the sky's horizon
        // color, same one dynamic-fog.js's own blend converges on further
        // out) rather than topC, so the water's edge doesn't seam against
        // the actual skyline color behind it.
        oU.u_skyColor.value.copy(botC);
        oU.u_time.value = ts2;
        applyWaveHeightModifier(state, state.oceanMaterial);
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
        // Was floored at 0.3 so dust stayed nearly as visible at night as in
        // daylight — reading as a redundant second firefly layer. Floored
        // much lower now; it's mostly a sunlit/dusk effect, just present
        // enough at night to catch moonlight faintly rather than glow.
        const lightVisibility = Math.max(0.08, sy); // More visible in day
        state.dustMat.uniforms.uVisibility.value = dustWeatherVisibility * lightVisibility;
        state.dustMat.uniforms.uDayBlend.value = dayBlend;
    }

    if (state.isPlaying) { 
        setAmbientVolume(state, state.dayAmbientAudio, dayBlend * 0.45);
        setAmbientVolume(state, state.nightAmbientAudio, (1 - dayBlend) * 0.35);
        // Subtle always-on breeze that swells with weather; gets an extra
        // kick past the heavy-rain gust threshold so the audio matches the
        // wind-blown leaves kicking in visually (fx/wind-leaves.js).
        const gust = Math.max(0, state.currentRainIntensity - 0.6) / 0.4;
        setAmbientVolume(state, state.windAudio, 0.08 + state.currentRainIntensity * 0.07 + gust * 0.25);
        setAmbientVolume(state, state.rainAudio, 0.35 * state.currentRainIntensity);

        // Fade water ambience in as the state.player nears the lake shoreline elevation
        const playerGroundY = getElevation(state.player.position.x, state.player.position.z);
        const waterProximity = Math.max(0, 1.0 - Math.abs(playerGroundY - 1.6) / 20.0);
        setAmbientVolume(state, state.waterAudio, waterProximity * 0.4);
    }
}