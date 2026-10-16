// Run through tools/browser-slot.sh; deterministic camera and simulation input.
import {resolve} from 'node:path';
import fs from 'node:fs/promises';
import {createGameServer} from '../server/index.mjs';
const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');
const root=resolve('.'),out=resolve(process.argv[2]),phase=process.argv[3]||'after';
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.stack)});
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
await page.addInitScript(()=>{let seed=12345;Math.random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning'||m.text().includes('[map]')||m.text().includes('STARTED')||m.text().includes('abs'))console.log('CONSOLE',m.text().slice(0,600));});
page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));
page.setDefaultTimeout(360000);
const capture=async(name,world=false)=>{if(world){const b=await page.evaluate(()=>{__sim.render();return __sim.canvas.toDataURL('image/png').split(',')[1]});await fs.writeFile(resolve(out,phase+'-'+name+'.png'),Buffer.from(b,'base64'));}else{await page.evaluate(()=>__flow.menu.carView?.captureFrame?.());await page.screenshot({path:resolve(out,phase+'-'+name+'.png')});}console.log('CAPTURE',name)};
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&map=riviera`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.classList.contains('loaded'));await page.evaluate(()=>window.__holdFrame=true);
 if(await page.locator('[data-title-hero]').count())await page.waitForFunction(()=>document.querySelector('[data-title-hero]')?.dataset.ready==='true');console.log('HERO',await page.evaluate(()=>({hero:!!__flow.menu.titleView,car:!!__flow.menu.carView,canvases:document.querySelectorAll('canvas').length})));await capture('menu-hero');
 await page.evaluate(()=>{__flow.menu.show('car',{garage:true});document.querySelector('.car-grid').scrollTop=0;});await page.waitForFunction(()=>document.querySelectorAll('[data-thumb-ready=true]').length>=4);await capture('garage');
 console.log('START RACE');await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&car=mini&event=quick&quality=low&fixedres&map=riviera&debug`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__sim?.player?.spec.id==='mini'&&document.body.classList.contains('loaded')&&!document.body.classList.contains('fading'));await page.evaluate(()=>window.__holdFrame=true);
 console.log('RACE READY');await page.evaluate(()=>{__game.countWall=performance.now()-5000;__game.cam='chase';__sim.step(180,1/60);__sim.render();});
 await capture('race-traffic',true);
 const measurements=await page.evaluate(()=>{const geos=new Set(),buffers=new Set(),textures=new Set();let geometryBytes=0,textureBytes=0;__sim.scene.traverse(o=>{if(o.geometry&&!geos.has(o.geometry)){geos.add(o.geometry);for(const a of [...Object.values(o.geometry.attributes),o.geometry.index].filter(Boolean)){if(!buffers.has(a.array.buffer)){buffers.add(a.array.buffer);geometryBytes+=a.array.buffer.byteLength;}}}for(const m of [].concat(o.material||[]))for(const t of Object.values(m))if(t?.isTexture&&!textures.has(t)){textures.add(t);const i=t.image;textureBytes+=(i?.width||0)*(i?.height||0)*4;}});const resources=performance.getEntriesByType('resource');return{render:{...__sim.renderer.info.render},geometryBytes,textureBytes,heap:performance.memory?.usedJSHeapSize,requests:resources.length,transferBytes:resources.reduce((n,r)=>n+r.transferSize,0),encodedBytes:resources.reduce((n,r)=>n+r.encodedBodySize,0),camera:__sim.camera.position.toArray(),player:__sim.player.model.root.position.toArray(),trafficCount:__sim.traffic.cars?.filter(c=>c.active).length,rivals:__sim.cars.length-1,errors:[]};});
 await page.evaluate(()=>{__game.cam='cockpit';__sim.step(60,1/60);__sim.render();});await capture('cockpit-race',true);
 measurements.errors=errors;await fs.writeFile(resolve(out,phase+'-scene.json'),JSON.stringify(measurements,null,2));if(errors.length)throw Error(errors.join('\n'));
}catch(error){await fs.writeFile(resolve(out,phase+'-browser-failure.json'),JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,state:window.__game?.state,sim:!!window.__sim,player:window.__sim?.player?.spec.id})),null,2));throw error;}finally{await browser.close();await app.close();}
