// Run one job with tools/browser-slot.sh. Actual Police.update + Web Audio + shipped Ogg.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.POLICE_EVIDENCE_DIR||resolve(root,'.scratch/police-voice'));
await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'/tmp/pw/node_modules/playwright/index.mjs'));
const app=await createGameServer({root,dataDir:resolve(out,'server-data')});
const [serve]=app.server.listeners('request');app.server.removeAllListeners('request');
app.server.on('request',async(req,res)=>{
 if(req.url?.startsWith('/voice-three/')){res.setHeader('Content-Type','text/javascript');res.end(await readFile(resolve(root,'node_modules/three',req.url.slice(13))));return;}
 if(req.url==='/' || req.url?.startsWith('/?')){res.setHeader('Content-Type','text/html');res.end((await readFile(resolve(root,'index.html'),'utf8')).replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/voice-three/'));return;}
 if(req.url==='/tools/police-fixture.mjs'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(resolve(root,'tools/police-fixture.mjs')));return;}
 if(req.url==='/voice-fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Police voice capture</title><link rel="icon" href="data:,"><style>body{background:#131b22;color:#f1efe5;font:18px monospace;padding:32px}pre{white-space:pre-wrap}</style><h1>Greek police voice · scripted chase</h1><p>Actual Police.update → PoliceVoice → VoiceReactions → Ogg / Web Audio</p><pre id="log"></pre>');return;}
 serve(req,res);
});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/home/dev/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1100,height:760}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/voice-fixture`);
 const report=await page.evaluate(async()=>{
  const {VoiceReactions}=await import('/src/voice.js'),{PoliceVoice,impactVoiceCue}=await import('/src/police-voice.js'),{AudioMix}=await import('/src/audio.js');
  const {world,step}=await import('/tools/police-fixture.mjs');
  const lines=await(await fetch('/assets/audio/voice/lines.json')).json();
  const ctx=new AudioContext(),mix=new AudioMix(ctx),settings={voice:.65,mildLanguage:false};await ctx.resume();
  const stream=ctx.createMediaStreamDestination();mix.limiter.connect(stream);
  const chunks=[],rec=new MediaRecorder(stream.stream);rec.ondataavailable=e=>chunks.push(e.data);rec.start();
  const v=new VoiceReactions({ctx,mix},{settings,random:()=>.1});
  const w=world(),p=w.police;let c;
  const pv=new PoliceVoice(v,unit=>({x:unit.u-2,y:0,z:2000-unit.s}));
  v.update({enabled:true,relative:p=>p});
  p.onVoice=(state,events)=>pv.observe(state,events);
  const fired=[],transitions=[];
  const trigger=v.trigger.bind(v);v.trigger=async(...args)=>{const ok=await trigger(...args);if(ok){const l=lines.lines.find(l=>l.id===v.active.line.id);const row={time:+ctx.currentTime.toFixed(2),category:args[0],cue:args[3]?.cue,id:l.id,text:l.text,language:l.language,position:v.active.locate(),distance:v.active.distance};fired.push(row);document.querySelector('#log').textContent+=JSON.stringify(row)+'\n';}return ok;};
  const run=secs=>{const out=step(w,secs);transitions.push(...out.map(e=>e.phase));return out;};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function flush(cue){const before=fired.length;for(let i=0;i<140;i++){await pv.tick();if(fired.slice(before).some(x=>x.cue===cue))return;await wait(100);}throw Error('No cue '+cue+'; '+JSON.stringify(pv.queue));}
  p.reset(true);p.patrols=[];w.player(2000,2,15);c=p.spawnCop(1990,1);c.u=2;
  p.hm.offence('red',.3,true);run(.01);await flush('warning');await wait(5500);
  p.hm.offence('hitcop',1,true,{serious:true});run(.01);await flush('start');await wait(5500);
  // Existing close job follows the start with its own cooldown.
  await flush('close');await wait(5500);
  w.player(2000,2,0);c.s=1996;run(.01);await flush('stop');await wait(12500);
  // Established pursuit and a real nearby unit produce the bust transition.
  run(13);await flush('stop');await wait(5500);
  p.reset(true);p.patrols=[];pv.reset();w.player(2000,2,15);c=p.spawnCop(1990,1);c.u=2;p.hm.begin(1);run(.01);
  // Ignore the second start; record loss of sight while the car remains audible.
  pv.queue=[];p.los=()=>false;run(4);await flush('escape');await wait(5500);
  const crash=[];
  for(const [kind,dv,mild] of [['bump',2,false],['crash',9,false],['wall',9,true]]){
   v.reset();settings.mildLanguage=mild;
   const ok=await v.trigger('driver',{},()=>({x:0,y:0,z:-2}),{cue:impactVoiceCue({kind,dv}),gender:'male'});
   if(!ok)throw Error('crash cue');crash.push({kind,dv,mild,line:v.active.line});await wait(2800);
  }
  const done=new Promise(r=>rec.onstop=r);rec.stop();await done;
  const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
  await ctx.close();return{fired,transitions,crash,audio:btoa(binary)};
 });
 await writeFile(resolve(out,'scripted-chase.webm'),Buffer.from(report.audio,'base64'));delete report.audio;
 await page.screenshot({path:resolve(out,'scripted-chase.png')});
 await writeFile(resolve(out,'browser-capture.json'),JSON.stringify({...report,errors},null,2));
 assert.deepEqual(errors,[]);assert.ok(report.transitions.includes('busted'));assert.ok(report.fired.some(x=>x.cue==='escape'));assert.equal(report.crash[2].line.strong,false);
 console.log(JSON.stringify(report,null,2));
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;});
 await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&quality=low&car=mini&cam=chase`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.__sim?.player && window.__voice && document.body.classList.contains('loaded'),null,{timeout:240000,polling:250});
 const live=await page.evaluate(async()=>{
  dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  const {playerVoices,playerImpactVoice,voices,policeVoice}=__voice;
  __game.state='race';__sim.step(1);
  // Actual player object, appearance and camera-local source; no replaced load or trigger.
  const hits=[];
  for(const dv of [2,9]){
   playerVoices.reset();const played=await playerImpactVoice({kind:'crash',dv});
   hits.push({dv,played,cue:playerVoices.active?.line.cue,profile:playerVoices.speakers.get(__sim.player)?.profile});
  }
  const wired=typeof __police.onVoice==='function';
  playerVoices.reset();voices.reset();policeVoice.reset();
  return {hits,wired};
 });
 await writeFile(resolve(out,'live-game-smoke.json'),JSON.stringify({live,errors},null,2));
 assert.equal(live.wired,true);assert.ok(live.hits.every(x=>x.played));assert.deepEqual(live.hits.map(x=>x.cue),['tap','hard']);assert.deepEqual(errors,[]);
 console.log('Live game player crash hooks and police observer passed.',live);
}finally{await browser.close();await app.close();}
