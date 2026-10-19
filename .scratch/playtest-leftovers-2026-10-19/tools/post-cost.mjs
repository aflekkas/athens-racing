// ROOT=<archive> OUT=<file.json> CLASS=potato tools/browser-slot.sh node post-cost.mjs
// Cost of the post chain's passes (window.__post.measure: gl.finish fences, a relative guide on any GPU; software GL here, so pixel cost shows)
// for the Riviera start grid at 1280x800: the scene pass at the class's ratio and the final pass at the canvas ratio.
import {resolve} from 'node:path';import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {tmpdir} from 'node:os';
const root=process.env.ROOT,cls=process.env.CLASS||'potato',scale=process.env.SCALE||'auto';
const {createGameServer}=await import(pathToFileURL(root+'/server/index.mjs').href);
const {chromium}=await import('/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
const dataDir=await fs.mkdtemp(resolve(tmpdir(),'athens-postcost-srv.'));
const app=await createGameServer({root,dataDir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});page.on('pageerror',e=>console.log('PAGEERROR',String(e).slice(0,200)));
 await page.addInitScript(({cls,scale})=>{localStorage.setItem('paraliaki.graphics-onboarding','1');const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freeze&&cb.name==='frame'?0:raf(cb);
  localStorage.setItem('paraliaki.settings',JSON.stringify({perfClass:cls,dynamicResolution:false,renderScale:scale==='auto'?'auto':+scale,frameCap:60}));let seed=9001;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};},{cls,scale});
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&map=riviera&guest=1&cam=chase`,{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.__sim?.player&&document.body.classList.contains('loaded'),null,{timeout:600000});
 await page.evaluate(async()=>{const s=window.__sim,f=window.__flow;await f.startEvent({...f.event().def,id:'post',rivals:0,traffic:0,police:false,conditions:{time:'morning',weather:'clear'}});s.G.state='race';f.menu.hide();});
 await page.waitForTimeout(4000);
 const res=await page.evaluate(async()=>{window.__freeze=true;await new Promise(r=>setTimeout(r,400));const s=window.__sim;for(let i=0;i<30;i++)s.step(1);s.render();s.render();
  const runs=[];for(let k=0;k<5;k++)runs.push(window.__post.measure(12));const med=key=>runs.map(r=>r[key]).sort((a,b)=>a-b)[2];
  const c=document.querySelector('canvas'),info=window.__renderInfo();return {scene:med('scene'),final:med('final'),post:med('post'),pixelRatio:info.pixelRatio,canvas:[c.width,c.height],up:window.__post.u.uUp?.value??0,src:window.__post.u.uSrc?.value.toArray()??null};});
 console.log(JSON.stringify({cls,scale,...res}));await fs.writeFile(process.env.OUT,JSON.stringify({cls,scale,...res},null,1));
}finally{await browser.close();app.server.close();await fs.rm(dataDir,{recursive:true,force:true});setTimeout(()=>process.exit(0),300);}
