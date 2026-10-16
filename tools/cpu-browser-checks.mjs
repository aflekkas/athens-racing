// Browser-slot-only integration checks: native module Worker, exact transfer state, default Video UI, DOM scale,
// and local phone-wheel transport primitives. No cross-origin isolation headers or authenticated sessions.
import http from 'node:http';
import fs from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);await fs.mkdir(out,{recursive:true});
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.bin':'application/octet-stream','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://local').pathname;let file=resolve(root,'.'+(name==='/'?'/index.html':name));if(name.startsWith('/vendor/'))file=resolve(root,'node_modules/three',name.slice(8));let body=await fs.readFile(file);if(file.endsWith('index.html'))body=Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/vendor/'));res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const {chromium}=await import('/tmp/pw/node_modules/playwright/index.mjs');const browser=await chromium.launch({headless:true,executablePath:'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/?menu&guest=1&quality=low`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.classList.contains('loaded')&&window.__flow,null,{timeout:120000});
 await page.evaluate(()=>__flow.menu.show('settings',{tab:'video',from:'title'}));await page.locator('[data-key="dynamicResolution"]').first().scrollIntoViewIfNeeded();await page.waitForTimeout(300);await page.screenshot({path:resolve(out,'after-video-default-on.png')});
 await page.evaluate(()=>__flow.menu.show('title'));await page.keyboard.press('F3');await page.waitForFunction(()=>document.querySelector('#perf-overlay').textContent.includes('% SCALE'));await page.screenshot({path:resolve(out,'after-perf-overlay.png')});
 const overlayText=await page.locator('#perf-overlay').innerText();
 const result=await page.evaluate(async()=>{
  const {Ragdoll}=await import('/src/impact-ragdoll.js'),{RagdollClient}=await import('/src/ragdoll-client.js'),{snapshotBody}=await import('/src/ragdoll-snapshot.js');
  const ground=(x,z,b)=>{b.groundS=(b.groundS||0)+.01;return x*.02+Math.sin(z)*.01;};
  const init={x:0,y:1,z:0,s:0,vx:14,vz:2,seed:1},a=new Ragdoll().launch(init),b=new Ragdoll().launch(init),client=new RagdollClient(ground,()=>new Worker('/src/ragdoll-worker.js',{type:'module'}));
  try{for(let i=0;i<60;i++){a.update(1/60,ground);client.advance(b,1/60);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Worker timeout')),5000),receive=client.receive;client.receive=function(m){receive.call(this,m);if(!client.jobs.size){client.receive=receive;clearTimeout(t);resolve();}};});if(JSON.stringify(snapshotBody(a))!==JSON.stringify(snapshotBody(b)))throw Error('Worker differs at '+i);}}finally{client.clear();}
  const rtc=await new Promise(async(resolve,reject)=>{const a=new RTCPeerConnection({iceServers:[]}),b=new RTCPeerConnection({iceServers:[]}),d=a.createDataChannel('phone-wheel-check'),timer=setTimeout(()=>{a.close();b.close();reject(Error('RTC timeout'));},10000);a.onicecandidate=e=>{if(e.candidate)b.addIceCandidate(e.candidate).catch(()=>{});};b.onicecandidate=e=>{if(e.candidate)a.addIceCandidate(e.candidate).catch(()=>{});};b.ondatachannel=e=>{e.channel.onmessage=m=>{clearTimeout(timer);const ok=m.data==='wheel';a.close();b.close();resolve(ok);};};d.onopen=()=>d.send('wheel');try{await a.setLocalDescription(await a.createOffer());await b.setRemoteDescription(a.localDescription);await b.setLocalDescription(await b.createAnswer());await a.setRemoteDescription(b.localDescription);}catch(e){clearTimeout(timer);a.close();b.close();reject(e);}});
  const popup=window.open('about:blank','cpu-popup-check'),opener=!!popup&&popup.opener===window;popup?.close();
  const {settings}=await import('/src/settings.js');
  return {worker:{frames:60,exact:true,disabled:client.disabled},rtc,opener,crossOriginIsolated:globalThis.crossOriginIsolated,dynamicResolutionDefault:settings.dynamicResolution};
 });
 result.overlay=overlayText;result.errors=errors;
 await fs.writeFile(resolve(out,'browser-integration.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();server.close();}
