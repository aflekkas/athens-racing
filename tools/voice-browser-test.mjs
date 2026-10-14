#!/usr/bin/env node
// One browser job, always run with tools/browser-slot.sh. Needs PLAYWRIGHT_MODULE/CHROME_BIN or local defaults.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
const root=resolve(import.meta.dirname,'..'), out=resolve(root,'.scratch/voice');await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs'));
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});const [normal]=app.server.listeners('request');app.server.removeAllListeners('request');
app.server.on('request',async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/voice-fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Voice offline render</title>');return;}
  if(url.pathname.startsWith('/voice-three/')) {res.setHeader('Content-Type','text/javascript');res.end(await readFile(resolve(process.env.THREE_MODULE_ROOT||'/tmp/roads-v2-three/node_modules/three',url.pathname.slice(13))));return;}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end((await readFile(resolve(root,'index.html'),'utf8')).replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/voice-three/'));return;}
  normal(req,res);
 } catch(e){res.statusCode=500;res.end(String(e));}
});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/home/dev/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:640,height:360}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
 await page.goto(base+'/voice-fixture');
 for(const cockpit of [false,true])for(const d of [5,25,50]) {
  const result=await page.evaluate(async({cockpit,d})=>{
   const {VoiceReactions}=await import('/src/voice.js'),{AudioMix}=await import('/src/audio.js');
   const ctx=new OfflineAudioContext(2,24000*4,24000), audio={ctx,mix:new AudioMix(ctx)};
   let distance=5;const v=new VoiceReactions(audio,{settings:{voice:.65},random:()=>0});
   v.update({enabled:true,cockpit,relative:p=>p});
   if(!await v.trigger('pedestrian',{},()=>({x:0,y:0,z:-distance})))throw Error('render trigger failed');
   distance=d;v.position(v.active,true);
   const buffer=await ctx.startRendering(), data=new ArrayBuffer(44+buffer.length*4),view=new DataView(data);
   const str=(offset,s)=>[...s].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
   str(0,'RIFF');view.setUint32(4,data.byteLength-8,true);str(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,24000,true);view.setUint32(28,96000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,data.byteLength-44,true);
   let sum=0,peak=0;for(let i=0;i<buffer.length;i++)for(let c=0;c<2;c++){const x=buffer.getChannelData(c)[i];sum+=x*x;peak=Math.max(peak,Math.abs(x));view.setInt16(44+(i*2+c)*2,Math.max(-32768,Math.min(32767,Math.round(x*32767))),true);}
   let bin='';for(const b of new Uint8Array(data))bin+=String.fromCharCode(b);
   return {wav:btoa(bin),rms:10*Math.log10(sum/(buffer.length*2)||1e-20),peak:20*Math.log10(peak||1e-20)};
  },{cockpit,d});
  const name=`crash-${d}m-${cockpit?'cockpit':'chase'}`;await writeFile(resolve(out,name+'.wav'),Buffer.from(result.wav,'base64'));delete result.wav;await writeFile(resolve(out,name+'.json'),JSON.stringify(result));console.log(name,result);
 }
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;});
 await page.goto(base+'/?simhook&quality=low&car=mini&cam=chase',{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.__sim?.player && window.__voice && document.body.classList.contains('loaded'),null,{timeout:180000});
 const smoke=[];
 for(const category of ['pedestrian','near','driver','police','artist']) {
  const result=await page.evaluate(async category=>{
   dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
   const {voices,pedestrianVoice,driverVoice}=__voice;const {camera}=__sim;
   __game.state='race';__sim.step(1);voices.reset();
   const x=camera.position.x,y=camera.position.y,z=camera.position.z-5;
   const played=['driver','police'].includes(category)?await driverVoice({veh:{x,y:y-1.25,z}},category):await pedestrianVoice({active:true,x,y:y-1.53,wy:y-1.53,z,look:{h:1.7}},category);
   return {category,played,line:voices.active?.line.id,bus:!!voices.audio.mix.buses.voice};
  },category);
  assert.ok(result.played,JSON.stringify(result));smoke.push(result);await page.waitForTimeout(2800);
 }
 await writeFile(resolve(out,'browser-smoke.json'),JSON.stringify({smoke,errors},null,2));assert.deepEqual(errors,[]);console.log('All five categories played; zero console errors.');
} finally { await browser.close();await new Promise(r=>app.server.close(r)); }
