// Live view test: boots with ?debug=1, then forces sea/inland views, rain and time of day via window.silvanDebug.state, screenshots each and prints scene triangle counts. See HEADLESS_TESTING.txt. Run: OUT=/dir/ node tools/e2e/live-views.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { readdirSync } from 'node:fs';
const OUT = process.env.OUT, URL_ = process.env.URL || 'http://127.0.0.1:4173/?debug=1';
const base='/opt/pw-browsers/'; const dir=readdirSync(base).filter(d=>/^chromium-\d+$/.test(d)).sort().pop();
const browser = await chromium.launch({ executablePath:`${base}${dir}/chrome-linux/chrome`, args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const ctx = await browser.newContext({ viewport:{width:780,height:360}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
await ctx.addInitScript(() => { try { sessionStorage.setItem('silvan-rotate-dismissed', '1'); } catch (e) {} }); // B-43: portrait "Turn your phone" overlay
const page = await ctx.newPage(); const errs=[];
page.on('pageerror',e=>errs.push(e.message.slice(0,300)));
page.on('console',m=>{ if(m.type()==='error'&&!/ERR_TUNNEL|Failed to load/.test(m.text())) errs.push(m.text().slice(0,300)); });
await page.goto(URL_); await page.waitForTimeout(2500);
const tap=async s=>{const el=await page.$(s); const b=await el.boundingBox(); await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);};
await tap('#title-remember-btn'); await page.waitForTimeout(1500); await tap('#title-slot-panel.open .slot-pick-btn:not(.disabled)');
for(let i=0;i<100;i++){ await page.waitForTimeout(1500); if(await page.evaluate(()=>!document.getElementById('hud-layer').classList.contains('hidden'))) break; }
const shot=async(name,fn)=>{ const info=await page.evaluate(fn); console.log(name, JSON.stringify(info)); await page.waitForTimeout(4000); await page.screenshot({path:OUT+name+'.png',timeout:150000}); };
const setView=`(yawAdd,rain,hour)=>{const s=window.silvanDebug.state; if(window.__yaw0===undefined) window.__yaw0=s.player.rotation.y; s.player.rotation.set(0,window.__yaw0+yawAdd,0,'YXZ'); s.camera.quaternion.setFromEuler(s.player.rotation); s.targetRainIntensity=s.currentRainIntensity=rain; if(hour!==null) s.gameTime=hour/24; s.timeMultiplier=0;
 const p=s.player.position; return {pos:[Math.round(p.x),Math.round(p.y*10)/10,Math.round(p.z)], water:s.waterMesh&&{x:s.waterMesh.position.x,y:s.waterMesh.position.y,vis:s.waterMesh.visible}, rainVis:s.rainMesh&&s.rainMesh.visible, rainDraw:s.rainMesh&&s.rainMesh.geometry.drawRange.count, rain:s.currentRainIntensity};}`;
await shot('1-inland-clear', `(${setView})(0,0,10)`);
await shot('2-sea-clear', `(${setView})(Math.PI,0,10)`);
await shot('3-sea-rain', `(${setView})(Math.PI,1,10)`);
await shot('4-inland-rain', `(${setView})(0,0.6,10)`);
await shot('5-dusk', `(${setView})(0.5,0,18)`);
const info=await page.evaluate(()=>{let tris=0,inst=0,meshes=0;window.silvanDebug.state.scene.traverse(o=>{if(o.isMesh||o.isPoints){const g=o.geometry;if(!g||!g.attributes||!g.attributes.position)return;const n=g.index?g.index.count/3:g.attributes.position.count/3;const c=o.isInstancedMesh?o.count:1;tris+=n*c;if(o.isInstancedMesh)inst+=o.count;meshes++}});return {sceneTris:Math.round(tris),instances:inst,meshes,colliders:window.silvanDebug.state.colliders.length}});
console.log('INFO',JSON.stringify(info)); console.log('ERRORS',errs.length?errs:'none'); await browser.close();
