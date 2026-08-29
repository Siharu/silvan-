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

// Every one of these used to be a fresh `new THREE.Color(...)` allocated
// inside updateAtmosphere() below, every single frame, forever — 15+
// Color objects/frame at 60fps just to hold fixed reference values that
// never change, plus 4 more scratch Colors below that used to be `.clone()`
// calls doing the same thing. None of this changed the visual output, it
// was pure steady GC pressure for no reason. Hoisted to module scope
// (computed once) with a handful of reusable scratch Colors that get
// overwritten via .copy()+.lerp() each frame instead of re-allocated.
const REF = {
    skyDay: new THREE.Color(0x5a6a7a), skyNight: new THREE.Color(0x0a1428),
    horDay: new THREE.Color(0x8a9aa8), horSunset: new THREE.Color(0xa86c42), horNight: new THREE.Color(0x1a2b4c),
    // skyClearTop/skyClearHor and horNight retuned against the reference
    // cinematic_day_night_cycle.html draft — the old horNight (0x040810,
    // nearly pure black) was a real contributor to "nighttime too dark":
    // the horizon glow at night stayed almost invisible no matter how much
    // hemiLight/moonLight intensity got pushed, because the sky color
    // itself had nowhere to go. 0x1a2b4c gives night an actual visible
    // deep-blue horizon instead of crushing to black.
    skyClearTop: new THREE.Color(0x2b73d9), skyClearHor: new THREE.Color(0x78a8f0),
    // New: a real sunset peak color the twilight window blooms through at
    // its midpoint (see the two-stage lerp below), instead of the old
    // direct night->day fade which never actually produced a visible
    // orange/purple sunset, just a duller version of whichever end it was
    // closer to.
    skySunsetPeakBot: new THREE.Color(0xff8c66), horSunsetPeak: new THREE.Color(0xe8714c),
    sunColorDay: new THREE.Color(0xffffff), sunColorSunset: new THREE.Color(0xffaa66),
    cloudTwilightA: new THREE.Color(0x222233), cloudTwilightB: new THREE.Color(0x887777), cloudTwilightC: new THREE.Color(0xa0a5ab),
    fogClear: new THREE.Color(0x9dc3e0), fogCloudy: new THREE.Color(0x607080),
    cloudClear: new THREE.Color(0xffffff), cloudOvercastDay: new THREE.Color(0x9098a0),
    cloudNight: new THREE.Color(0x33415a),
    rainFogTint: new THREE.Color(0x2a3038), rainTopTint: new THREE.Color(0x3a4048), rainCloudTint: new THREE.Color(0x2a2a2a),
    rainDayColor: new THREE.Color(0xffffff), rainNightColor: new THREE.Color(0x334466),
};
// Reused every frame instead of cloned from REF each time — safe because
// nothing outside this function holds onto these between frames (they're
// copied into real scene uniforms via .copy() before the frame ends).
const _topC = new THREE.Color(), _botC = new THREE.Color(), _fogC = new THREE.Color(), _cloudC = new THREE.Color();
const _rainColor = new THREE.Color(), _sunC = new THREE.Color(), _hemiC = new THREE.Color(), _hemiGroundC = new THREE.Color();



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
        // Was gated behind cloudiness > 0.5 (only ~15% of rolls, since
        // cloudiness = random*random skews low) AND a second independent
        // random() > 0.35 check (65% of those) — combined, only about a
        // 1-in-10 chance of any rain per weather roll, which is what made
        // it feel like it "barely rains" even over a long session. Lowered
        // the cloudiness gate (clouds don't need to be that heavy before
        // rain becomes possible) and loosened the second roll so more of
        // those cloudy moments actually produce rain, without touching the
        // cloudiness distribution itself — clear skies are still the most
        // common state, this only fixes what happens once it's cloudy.
        state.targetCloudiness = Math.random() * Math.random();
        state.targetRainIntensity = (state.targetCloudiness > 0.32 && Math.random() > 0.15)
            ? Math.random() * state.targetCloudiness + 0.15
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

    const dayBlend = Math.max(0, Math.min(1, sy * 3.0 + 0.5));
    // Sun/moon/hemi retuned against the tested reference draft
    // (cinematic_day_night_cycle.html) rather than another guess — sun
    // 1.6->2.5, moon 0.85->1.5. hemi's range actually comes DOWN (0.75-1.85
    // -> 0.45-1.0): with the sun/moon carrying more of the load directly,
    // and skyNight/horNight no longer crushing to near-black (see REF
    // above), a lower ambient floor reads as moodier/more "cinematic"
    // instead of just flatly bright everywhere. Hemi's color itself is now
    // also tinted per-frame below (blue-ish at night, neutral in day)
    // instead of staying fixed at its main.js construction-time color.
    state.sunLight.intensity = Math.max(0, sy) * 2.5;
    state.moonLight.intensity = Math.max(0, -sy) * 1.5;
    if (state.hemiLight) {
        state.hemiLight.intensity = 0.45 + dayBlend * 0.55;
        state.hemiLight.color.copy(_hemiC.setHSL(0.6, 0.5, 0.5 + dayBlend * 0.3));
        state.hemiLight.groundColor.copy(_hemiGroundC.setHSL(0.3, 0.4, 0.2 + dayBlend * 0.1));
    }

    const skyDay = REF.skyDay, skyNight = REF.skyNight;
    const horDay = REF.horDay, horNight = REF.horNight;
    const skyClearTop = REF.skyClearTop, skyClearHor = REF.skyClearHor;
    let topC, botC, fogC, cloudC, sunC;
    // Widened from (-0.2, 0.2) to (-0.2, 0.25) and now blooms through an
    // actual sunset peak color at the midpoint (skySunsetPeakBot/
    // horSunsetPeak) via a proper two-stage lerp — night->peak, then
    // peak->day — instead of the old single lerp straight from night to
    // day/overcast-day, which never produced a real visible sunset color,
    // just whichever endpoint the moment happened to be closer to. topC
    // still lerps straight across (matches the reference draft: the sky's
    // zenith doesn't bloom orange the way the horizon does).
    if (sy > -0.2 && sy < 0.25) {
        const t = (sy + 0.2) / 0.45;
        topC = _topC.copy(skyNight).lerp(skyDay, t);
        if (t < 0.5) {
            const t2 = t * 2;
            botC = _botC.copy(horNight).lerp(REF.skySunsetPeakBot, t2);
            fogC = _fogC.copy(horNight).lerp(REF.horSunsetPeak, t2);
            sunC = _sunC.copy(REF.sunColorSunset);
        } else {
            const t2 = (t - 0.5) * 2;
            botC = _botC.copy(REF.skySunsetPeakBot).lerp(horDay, t2);
            fogC = _fogC.copy(REF.horSunsetPeak).lerp(horDay, t2);
            sunC = _sunC.copy(REF.sunColorSunset).lerp(REF.sunColorDay, t2);
        }
        cloudC = _cloudC.copy(REF.cloudTwilightA).lerp(REF.cloudTwilightB, t<0.5?t*2:1).lerp(REF.cloudTwilightC, t>0.5?(t-0.5)*2:0);
    } else if (sy >= 0.25) {
        topC = _topC.copy(skyClearTop).lerp(skyDay, state.currentCloudiness);
        botC = _botC.copy(skyClearHor).lerp(horDay, state.currentCloudiness);
        fogC = _fogC.copy(REF.fogClear).lerp(REF.fogCloudy, state.currentCloudiness);
        cloudC = _cloudC.copy(REF.cloudClear).lerp(REF.cloudOvercastDay, state.currentCloudiness);
        sunC = _sunC.copy(REF.sunColorDay);
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
        topC = _topC.copy(skyNight); botC = _botC.copy(horNight); fogC = _fogC.copy(horNight); cloudC = _cloudC.copy(REF.cloudNight);
        sunC = _sunC.copy(REF.sunColorSunset); // irrelevant, sun is down
    }
    state.sunLight.color.copy(sunC);
    
    // Darken the atmosphere when it's raining
    fogC.lerp(REF.rainFogTint, state.currentRainIntensity * 0.6);
    topC.lerp(REF.rainTopTint, state.currentRainIntensity * 0.7);
    
    // Declared here (not further down where it's used for updateWindLeaves/
    // updateRadioTower) because the cloudMat block right below also reads
    // it — it was previously declared after that block, which threw a
    // ReferenceError (TDZ: used before its own `const` initializer) on
    // every single frame once cloudMat existed.
    const ts = performance.now() * 0.001;

    state.scene.fog.color.copy(fogC); state.skyMat.uniforms.topColor.value.copy(topC); state.skyMat.uniforms.bottomColor.value.copy(botC);
    if(state.cloudMat) {
        cloudC.lerp(REF.rainCloudTint, state.currentRainIntensity * 0.8);
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
        // Was declared as fed here (see mountain-boundary.js's own comment
        // on why an unlit MeshBasicMaterial needs this at all) but never
        // actually wired into the generic per-frame traverse below it —
        // uBrightness sat frozen at its initial 1.0 forever, so the painted
        // mountain rings never dimmed at night or under cloud cover the way
        // every real lit surface (terrain/forest/rocks/grass) does. Mirrors
        // hemiLight's night floor (0.6 base + dayBlend headroom, see above)
        // so the mountains track the same day/night curve as the rest of
        // the world's ambient light, with cloud cover darkening them a bit
        // further on top since an overcast sky reads flatter/greyer.
        if (u.uBrightness) u.uBrightness.value = (0.35 + dayBlend * 0.65) * (1 - cloudCover * 0.3);
    });
    if (state.rainMaterial && state.rainMaterial.userData && state.rainMaterial.userData.shader) {
        state.rainMaterial.userData.shader.uniforms.uCameraPos.value.copy(state.camera.position);
        state.rainMaterial.color.set(_rainColor.copy(REF.rainDayColor).lerp(REF.rainNightColor, 1 - dayBlend));
        
        state.rainMaterial.opacity = 0.15 * Math.min(1.0, state.currentRainIntensity * 2.0);
        // Was a hardcoded 45000 — that happens to equal High quality's
        // rainCount (core/quality.js), so it silently only worked right at
        // High. On Medium/Low it asked InstancedMesh for more instances
        // than were ever allocated (rainCount 22000/10000), so this either
        // clamped to whatever the GPU buffer actually held or rendered
        // nothing once currentRainIntensity climbed — either way, far
        // less rain than intended outside the High preset.
        state.rainMesh.count = Math.max(0, Math.min(state.quality.rainCount, Math.floor(state.quality.rainCount * state.currentRainIntensity)));
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