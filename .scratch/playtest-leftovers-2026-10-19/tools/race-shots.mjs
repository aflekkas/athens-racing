// ROOT=<archive> OUT=<dir> TAG=before|after CLASS=potato SCALE=<renderScale|auto> [CAR=gla45] tools/browser-slot.sh node race-shots.mjs
// Riviera, chase camera, the player car at rest on the grid, 1280x800 @1x: a full frame and a 2x crop of the car, at a chosen class / render scale.
import {resolve} from 'node:path';import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {tmpdir,homedir} from 'node:os';import sharp from 'sharp';
const root=process.env.ROOT,out=resolve(process.env.OUT),tag=process.env.TAG,cls=process.env.CLASS||'potato',scale=process.env.SCALE||'auto',car=process.env.CAR||'gla';
await fs.mkdir(out,{recursive:true});
const {createGameServer}=await import(pathToFileURL(root+'/server/index.mjs').href);
const {chromium}=await import('/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
const dataDir=await fs.mkdtemp(resolve(tmpdir(),'athens-raceshot-srv.'));
const app=await createGameServer({root,dataDir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});page.on('pageerror',e=>console.log('PAGEERROR',String(e).slice(0,200)));
 await page.addInitScript(({cls,scale})=>{localStorage.setItem('paraliaki.graphics-onboarding','1');const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>window.__freeze&&cb.name==='frame'?0:raf(cb);
  localStorage.setItem('paraliaki.settings',JSON.stringify({perfClass:cls,dynamicResolution:false,renderScale:scale==='auto'?'auto':+scale,hudMotion:'full',frameCap:60}));let seed=9001;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};},{cls,scale});
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&map=riviera&guest=1&cam=chase&car=${car}`,{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.__sim?.player&&document.body.classList.contains('loaded'),null,{timeout:600000});
 await page.evaluate(async()=>{const s=window.__sim,f=window.__flow;await f.startEvent({...f.event().def,id:'shot',rivals:0,traffic:0,police:false,conditions:{time:'morning',weather:'clear'}});s.G.state='race';f.menu.hide();document.body.classList.remove('counting');document.body.classList.add('racing');});
 await page.waitForTimeout(4000);
 await page.evaluate(async()=>{window.__freeze=true;await new Promise(r=>setTimeout(r,400));const s=window.__sim;for(let i=0;i<30;i++){s.step(1);}s.render();s.render();});
 await page.waitForTimeout(600);
 const info=await page.evaluate(()=>({pr:window.__renderInfo?.().pixelRatio,canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height],cls:window.__renderInfo?.().perfClass}));console.log(JSON.stringify(info));
 const buf=await page.screenshot({type:'png',timeout:240000});
 await sharp(buf).webp({quality:85}).toFile(`${out}/race-${cls}-${scale}-${tag}-1280x800.webp`);
 await sharp(buf).extract({left:440,top:390,width:400,height:250}).resize(1200,750,{kernel:'nearest'}).webp({quality:90}).toFile(`${out}/race-${cls}-${scale}-${tag}-car-crop.webp`);
 console.log('SHOT',cls,scale,tag);
}finally{await browser.close();app.server.close();await fs.rm(dataDir,{recursive:true,force:true});setTimeout(()=>process.exit(0),300);}
