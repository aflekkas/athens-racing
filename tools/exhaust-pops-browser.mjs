#!/usr/bin/env node
// Frame-hitch probe for exhaust pops. Private server + private headless Chrome on a random port:
//   tools/browser-slot.sh node tools/exhaust-pops-browser.mjs [--label=after] [--map=megara] [--pops=8] [--blips=4] [--out=dir]
// For the SVJ (the only trim with flames) and the Huracán (audio-only pops) it drives real throttle blips and lifts with the
// cockpit mirror forced every frame; for the SVJ it also fires scripted pops. Per frame: CPU ms of step+render,
// renderer.info.programs, visible light count, audio.pop() calls and flame pulses. The server has no GPU, so only
// compare relative numbers and program counts (a programs increase at pop time is a shader recompile).
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
const arg=(k,d)=>process.argv.find(a=>a.startsWith('--'+k+'='))?.split('=')[1]??d;
const label=arg('label','run'),map=arg('map','megara'),pops=+arg('pops',6),blips=+arg('blips',2),root=resolve(fileURLToPath(new URL('../',import.meta.url))),out=resolve(arg('out',resolve(root,'.scratch/exhaust-pops')));
let pw;for(const name of [process.env.PLAYWRIGHT_MODULE,'/tmp/pw/node_modules/playwright/index.mjs','/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs','playwright'].filter(Boolean)){try{pw=await import(name.startsWith('/')?pathToFileURL(name).href:name);break;}catch{}}
if(!pw)throw Error('Install Playwright or set PLAYWRIGHT_MODULE');
await fs.mkdir(out,{recursive:true});
const app=await createGameServer({root,dataDir:resolve(out,'server-data-'+label)});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||resolve(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const errors=[];
async function open(car){
 const page=await browser.newPage({viewport:{width:640,height:400}});page.setDefaultTimeout(+process.env.PROBE_TIMEOUT||500000);
 page.on('pageerror',e=>{console.log('[pageerror]',e.stack?.slice(0,400));errors.push(e.stack);});page.on('console',m=>{if(process.env.PROBE_LOG)console.log('[console]',m.type(),m.text().slice(0,200));if(m.type()==='error'&&!/status of 404/.test(m.text()))errors.push(m.text());});
 await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async r=>r.fulfill({body:await fs.readFile(resolve(root,'node_modules/three',r.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
 await page.route('**/src/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('window.__audio = () =>','window.__audioObj = audio; window.__audio = () =>')});});
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__holdFrame&&cb.name==='frame'?0:raf(cb);});
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&car=${car}&quality=low&fixedres&map=${map}&event=free&notraffic${process.env.PROBE_LOG?"&debug":""}`,{waitUntil:'domcontentloaded'});
 try{await page.waitForFunction(id=>window.__sim?.player?.spec.id===id&&document.body.classList.contains('loaded'),car);}
 catch(e){console.log('LOAD TIMEOUT',await page.evaluate(()=>({cls:document.body.className,text:document.body.innerText.slice(0,300),sim:!!window.__sim})));throw e;}
 await page.mouse.click(300,200);
 await page.evaluate(()=>{
  window.__holdFrame=true;__flow.menu.hide();__game.state='race';__game.cam='cockpit';__sim.player.cockpit.setVisible(true);__sim.step(30,1/60);window.__startS=__sim.player.veh.s;
  const sim=__sim,f=sim.player.model.exhaustFlames,renderer=sim.renderer,scene=sim.scene,info=renderer.info,audio=window.__audioObj;
  window.__probe={popCalls:0,lights:()=>{let n=0;scene.traverseVisible(o=>{if(o.isLight)n++;});return n;},
   inv:()=>{const m=new Set(),g=new Set();scene.traverse(o=>{for(const x of [].concat(o.material||[]))m.add(x);if(o.geometry)g.add(o.geometry);});return {mats:m.size,geoms:g.size,tex:info.memory.textures,programs:info.programs.length};},
   frame:(extra)=>{sim.player.cockpit.rearLast=-Infinity;const t0=performance.now();sim.step(1,1/60);const t1=performance.now();sim.render();const t2=performance.now();
    return {stepMs:t1-t0,renderMs:t2-t1,programs:info.programs.length,lights:window.__probe.lights(),popCalls:window.__probe.popCalls,serial:f?f.pulse.serial:0,rpm:sim.player.veh.rpm,gear:sim.player.veh.gear,kmh:sim.player.veh.kmh,...extra};}};
  if(audio?.pop){const o=audio.pop.bind(audio);audio.pop=(...a)=>{window.__probe.popCalls++;return o(...a);};}
  for(let i=0;i<60;i++)window.__probe.frame(); // warm-up: every material the idle scene needs is compiled
 });
 return page;
}
const driveBlips=async(page,n)=>{
 const rows=[];
 for(let b=0;b<n;b++){
  await page.evaluate(()=>{const v=__sim.player.veh;v.reset(window.__startS,0);v.setManual?.(false);__sim.step(10,1/60);});
  await page.keyboard.down('w');
  rows.push(...await page.evaluate(b=>{const out=[],v=__sim.player.veh;for(let i=0;i<800;i++){const r=__probe.frame({blip:b,phase:'on'});out.push(r);if(v.rpm>=v.spec.redline*.72&&v.gear>=2)break;}return out;},b));
  await page.keyboard.up('w');
  rows.push(...await page.evaluate(b=>{const out=[];for(let i=0;i<90;i++)out.push(__probe.frame({blip:b,phase:'lift'}));return out;},b));
 }
 return rows;
};
const med=a=>a.length?[...a].sort((x,y)=>x-y)[a.length>>1]:0,ms=r=>r.stepMs+r.renderMs;
const result={label,map,errors};
try{
 let page=await open('aventador_svj');
 result.svj={};
 result.svj.idle=await page.evaluate(()=>__probe.inv());
 result.svj.forced=await page.evaluate(({pops})=>{
  const f=__sim.player.model.exhaustFlames,rows=[];
  for(let p=0;p<pops;p++)for(let i=-6;i<30;i++){if(i===0)f.pulse.fire(p%2?1:2,1);rows.push(__probe.frame({pop:p,i,visible:f.group.visible}));}
  return rows;
 },{pops});
 console.log('SVJ forced pops done');await fs.writeFile(resolve(out,label+'.partial.json'),JSON.stringify(result));result.svj.end=await page.evaluate(()=>__probe.inv());
 result.svj.driven=await driveBlips(page,blips);
 console.log('SVJ driven blips done');await fs.writeFile(resolve(out,label+'.partial.json'),JSON.stringify(result));await page.close();
 page=await open('huracan');
 result.huracan={idle:await page.evaluate(()=>__probe.inv())};
 result.huracan.driven=await driveBlips(page,blips);
 console.log('Huracan blips done');await fs.writeFile(resolve(out,label+'.partial.json'),JSON.stringify(result));result.huracan.audio=await page.evaluate(()=>{
  const audio=window.__audioObj,au={available:!!audio?.ctx};
  if(au.available){
   const proto=Object.getPrototypeOf(Object.getPrototypeOf(audio.ctx)),counts={};
   for(const k of Object.getOwnPropertyNames(proto).filter(k=>/^create|^decodeAudioData/.test(k))){const o=proto[k];proto[k]=function(...a){counts[k]=(counts[k]||0)+1;return o.apply(this,a);};}
   const t=[];for(let i=0;i<40;i++){const t0=performance.now();audio.pop(.5,0);t.push(performance.now()-t0);}
   t.sort((a,b)=>a-b);au.popMs={median:+t[20].toFixed(3),max:+t[39].toFixed(3)};au.created=counts;au.audioBuffers=(counts.createBuffer||0)+(counts.decodeAudioData||0);
  }
  return au;
 });
 result.huracan.end=await page.evaluate(()=>__probe.inv());
 await page.close();
}finally{await browser.close();await app.close();}
// ---- summary
const summarise=(rows,isPop)=>{
 const quiet=rows.filter(r=>!isPop(r)).map(ms),popFrames=rows.filter(isPop);
 return {frames:rows.length,quietMedianMs:+med(quiet).toFixed(2),popFrames:popFrames.length,popFrameMedianMs:+med(popFrames.map(ms)).toFixed(2),popFrameMaxMs:+Math.max(0,...popFrames.map(ms)).toFixed(1),
  programsMin:Math.min(...rows.map(r=>r.programs)),programsMax:Math.max(...rows.map(r=>r.programs)),lightCounts:[...new Set(rows.map(r=>r.lights))].sort(),audioPopCalls:rows.at(-1).popCalls-rows[0].popCalls,flamePulses:rows.at(-1).serial-rows[0].serial};
};
const near=(rows)=>{const hit=new Set();let sp=rows[0].serial,pc=rows[0].popCalls;rows.forEach((r,i)=>{if(r.serial!==sp||r.popCalls!==pc){for(let k=0;k<4;k++)hit.add(i+k);sp=r.serial;pc=r.popCalls;}});return r=>hit.has(rows.indexOf(r));};
result.summary={
 svjForced:summarise(result.svj.forced,r=>r.i>=0&&r.i<4),
 svjDriven:summarise(result.svj.driven,near(result.svj.driven)),
 huracanDriven:summarise(result.huracan.driven,near(result.huracan.driven)),
 firstForcedPopFrameMs:+ms(result.svj.forced.find(r=>r.i===0)).toFixed(1),
 svjProgramsAtIdle:result.svj.idle.programs,svjProgramsAfterPops:result.svj.end.programs,huracanProgramsAtIdle:result.huracan.idle.programs,huracanProgramsAfter:result.huracan.end.programs,
};
await fs.writeFile(resolve(out,label+'.json'),JSON.stringify(result,null,1));
console.log(JSON.stringify({...result,svj:{idle:result.svj.idle,end:result.svj.end},huracan:{idle:result.huracan.idle,end:result.huracan.end,audio:result.huracan.audio}},null,1));
assert.deepEqual(errors,[]);
