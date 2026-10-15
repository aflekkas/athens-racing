import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve('.'),out=resolve('.scratch/svj/flames-v2');
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(180000);const errors=[];
page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.stack);});
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
await page.route('**/tools/svj-*.js',async r=>r.fulfill({body:await fs.readFile(resolve(root,'tools',new URL(r.request().url()).pathname.split('/').at(-1))),contentType:'text/javascript'}));
await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
const save=async n=>{await page.screenshot({path:resolve(out,n+'.png')});console.log('CAPTURE',n);};
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=megara&notraffic`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.classList.contains('loaded'));await page.evaluate(()=>window.__holdFrame=true);
 await page.evaluate(async()=>{const {CARS}=await import('/src/cars.js');__flow.menu.show('car',{index:CARS.findIndex(c=>c.id==='aventador_svj'),detail:true,garage:true});});
 await page.waitForSelector('#carStage canvas');await page.waitForTimeout(600);await save('garage');
 console.log('START');await page.evaluate(()=>{__flow.startEvent(__flow.freeRoamDef(),{car:'aventador_svj'});});
 await page.waitForFunction(()=>window.__sim?.player?.spec.id==='aventador_svj'&&!document.body.classList.contains('fading'),null,{timeout:240000});
 await page.evaluate(()=>{window.__holdFrame=true;__game.countWall=performance.now()-5000;__sim.step(90,1/60);});
 const checks=await page.evaluate(async()=>{const {checkSVJGeometry}=await import('/tools/svj-geometry.js');return checkSVJGeometry();});await fs.writeFile(resolve(out,'geometry-checks.json'),JSON.stringify(checks,null,2));
 const audit=await page.evaluate(async()=>{const T=await import('three'),sim=__sim,m=sim.player.model,b=m.root.position;sim.camera.position.set(-5,2,-6).applyQuaternion(m.root.quaternion).add(b);sim.camera.lookAt(b.x,b.y+.6,b.z);sim.renderer.render(sim.scene,sim.camera);const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(270/1024*2-1,1-8/640*2),sim.camera);return {carPosition:b.toArray(),s:sim.player.veh.s,hits:ray.intersectObjects(sim.scene.children,true).slice(0,8).map(h=>({name:h.object.name,parent:h.object.parent?.name,point:h.point.toArray(),distance:h.distance,car:(()=>{for(let o=h.object;o;o=o.parent)if(o===m.root)return true;return false;})()}))};});
 const capture=async(n,hide)=>{const data=await page.evaluate(hide=>{const sim=__sim;sim.player.model.root.visible=!hide;sim.renderer.render(sim.scene,sim.camera);return sim.canvas.toDataURL().split(',')[1];},hide);await fs.writeFile(resolve(out,n+'.png'),Buffer.from(data,'base64'));};
 await capture('front-original-path',false);await capture('front-without-car',true);await fs.writeFile(resolve(out,'original-path-block-audit.json'),JSON.stringify(audit,null,2));console.log(audit);
}finally{await browser.close();await app.close();}
