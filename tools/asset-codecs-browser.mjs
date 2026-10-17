// Run only through tools/browser-slot.sh. Tests production bundles at fixed poses, one browser job.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { brotliCompressSync, constants } from 'node:zlib';
const root = resolve(import.meta.dirname, '..'), out = resolve(process.argv[2] || '.scratch/perf-2026-10-15/textures-data');
await fs.mkdir(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const state=await fs.mkdtemp('/tmp/asr-codec-browser-state-');
const app=await createGameServer({root,dataDir:state});
let activePage;
const report = { baselineSha: process.env.BASELINE_SHA || null, implementationSha: process.env.ASR_GIT_SHA || null, mode: process.env.CODEC_DOWNLOAD === '1' ? 'paired HTTP packs' : 'default generated world', errors: [], runs: [] }, types = { '.js':'text/javascript', '.mjs':'text/javascript', '.html':'text/html', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.webp':'image/webp', '.png':'image/png', '.wasm':'application/wasm' };
const server = http.createServer(async (req,res) => {
  const path = new URL(req.url,'http://localhost').pathname;
  if(path==='/__probe'){try{const data=await activePage?.evaluate(()=>({state:window.__game?.state,runtime:window.__mapRuntime?.(),loading:document.querySelector('#ldText')?.textContent,body:document.body.className}));res.end(JSON.stringify(data));}catch(e){res.end(e.message);}return;}
  if (path.startsWith('/api/')||path==='/health') return app.server.emit('request',req,res);
  try {
    const before = path.startsWith('/before/'), rel = before ? '/' + path.slice(8) : path;
    let file = resolve(before ? process.env.BASELINE_PUBLIC : resolve(root,'.deploy/assets'), '.' + (rel === '/' ? '/index.html' : rel));
    if (path.startsWith('/vendor/')) file = resolve(root,'node_modules/three',path.slice(8));
    let body = await fs.readFile(file);
    if (file.endsWith('index.html')) {
      let html = body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/','/vendor/').replace(/<script type="module" src="\.\/src\/offline-cache.js"><\/script>/g,'');
      if (before) html = html.replace('src="./src/main-', 'src="/before/src/main-');
      body = Buffer.from(html);
    }
    if (process.env.CODEC_DOWNLOAD === '1' && file.endsWith('.json')) { const data = JSON.parse(body); if (data.bakedWorld) { delete data.bakedWorld.worker; body = Buffer.from(JSON.stringify(data)); } }
    const headers = { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' };
    // Binary containers and images are already compressed. Match the live WebP identity transfer.
    // Compress text modules/JSON with Brotli to measure realistic browser transfer payloads.
    if (/\.(?:js|mjs|json|css|html|svg)$/.test(file) && /br/.test(req.headers['accept-encoding'] || '')) { body = brotliCompressSync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:6}}); headers['Content-Encoding']='br'; }
    headers['Content-Length']=body.length; res.writeHead(200,headers);res.end(body);
  } catch { res.writeHead(404);res.end(); }
});
server.on('upgrade',(...args)=>app.server.emit('upgrade',...args));
await new Promise(r=>server.listen(0,'127.0.0.1',r)); console.log('SERVER',server.address().port);
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-precise-memory-info']});
const collectMetrics = page => page.evaluate(()=>{const rs=performance.getEntriesByType('resource');const seen=new Set();let geometryBytes=0;__sim.scene.traverse(o=>{if(!o.geometry||seen.has(o.geometry))return;seen.add(o.geometry);for(const a of Object.values(o.geometry.attributes))geometryBytes+=(a.array||a.data?.array)?.byteLength||0;geometryBytes+=o.geometry.index?.array.byteLength||0;});return{geometryBytes,state:__game.state,assets:window.__assetMetrics||null,heapBytes:performance.memory?.usedJSHeapSize||null,requests:rs.filter(r=>new URL(r.name).origin===location.origin&&!new URL(r.name).pathname.startsWith('/vendor/')).map(r=>({url:new URL(r.name).pathname,bodyBytes:r.encodedBodySize,transferBytes:r.transferSize})),render:__renderInfo()};});
try {
  const sides=(process.env.SIDES||'before,after').split(','), ids=(process.env.MAPS||'riviera,penteli,megara').split(','), rounds=+(process.env.ROUNDS||1);
  const visits=process.env.INTERLEAVE==='1'?Array.from({length:rounds},(_,round)=>ids.flatMap(id=>(round%2?[...sides].reverse():sides).map(side=>({side,id,round})))).flat():sides.flatMap(side=>ids.map(id=>({side,id,round:0})));
  for (const {side,id,round} of visits) {
    const context=await browser.newContext({viewport:{width:1000,height:650},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];activePage=page;
    page.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url());});
    page.on('pageerror',e=>{ errors.push(e.stack); console.error(side,id,e.stack); });
    page.on('console',m=>{if(m.type()==='error'||m.type()==='warning'&&/KTX2|Baked world/.test(m.text()))console.log('WARN',m.text());});
    page.on('request',r=>{if(/\/data\//.test(new URL(r.url()).pathname))requests.push(r.url());});
    await page.route('https://fonts.googleapis.com/**',r=>r.abort()); await page.route('https://fonts.gstatic.com/**',r=>r.abort());
    await page.addInitScript(()=>{performance.setResourceTimingBufferSize(5000);const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>['frame','onAnimationFrame'].includes(cb.name)?0:raf(cb);localStorage.setItem('paraliaki.settings',JSON.stringify({perfClass:'high',renderScale:1,dynamicResolution:false,mirrors:false,master:0}));});
    const prefix=side==='before'?'/before/':'/';
    console.log('NAV',side,id);
    await page.goto(`http://127.0.0.1:${server.address().port}${prefix}?menu&simhook&cam=chase&map=${id}${side==='after'?'&assetcodec=1':''}${process.env.CODEC_DOWNLOAD==='1'?'&bakedownload=1':''}`,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.__flow&&document.body.classList.contains('loaded'),null,{timeout:180000});
    assert.equal(requests.length,0,'fresh menu /data/ requests');
    await page.evaluate(()=>document.fonts.ready);
    if(process.env.TIMING_ONLY!=='1')await page.screenshot({path:resolve(out,`${side}-${id}-menu.png`),timeout:120000,animations:'disabled'});
    console.log('MENU',side,id);
    let peakHeapBytes=0; const sample = setInterval(()=>{void page.evaluate(()=>performance.memory?.usedJSHeapSize||0).then(n=>{peakHeapBytes=Math.max(peakHeapBytes,n);}).catch(()=>{});},250);
    const started=Date.now();
    await page.evaluate(async()=>{if(!__flow.startEvent)await __bootMenu.h.ensureRuntime();void __flow.startEvent(__flow.freeRoamDef());});
    await page.waitForFunction(()=>window.__sim?.renderer&&['countdown','race'].includes(__game.state),null,{timeout:600000});
    await page.evaluate(()=>{__game.countWall=performance.now()-3000;__game.countT=3;__sim.step(1,.05);__sim.render();});
    const loadToRaceMs=Date.now()-started; clearInterval(sample);console.log('FIRST_FRAME',side,id,loadToRaceMs);
    report.runs.push({side,id,round,loadToRaceMs,peakHeapBytes,errors,pendingScreens:true});await fs.writeFile(resolve(out,'browser.json'),JSON.stringify(report,null,2));
    if(process.env.TIMING_ONLY==='1'){
      const metrics=await collectMetrics(page);Object.assign(report.runs.at(-1),{metrics,pendingScreens:false});report.errors.push(...errors);
      if(side==='after'&&process.env.CODEC_DOWNLOAD==='1'){assert.equal(metrics.assets?.maps[id]?.codec,'meshopt');assert.equal(metrics.assets?.maps[id]?.error,undefined);}
      await fs.writeFile(resolve(out,'browser.json'),JSON.stringify(report,null,2));await context.close();continue;
    }
    // Freeze simulation, set exact camera transforms relative to the same starting car.
    for (const [pose, offset] of [['front', [5,2.2,-6]],['road',[0,3,10]],['badge',[.6,.8,-3]],['overview',[0,100,100]]]) {
      await page.evaluate(({offset,pose})=>{const {camera,player}=__sim,v=player.veh;camera.position.set(v.x+offset[0],v.y+offset[1],v.z+offset[2]);camera.lookAt(v.x,v.y+.65,v.z);camera.fov=pose==='badge'?35:55;camera.updateProjectionMatrix();},{offset,pose});
      const png=await page.evaluate(()=>{__sim.render();return __sim.canvas.toDataURL('image/png').split(',')[1];});
      await fs.writeFile(resolve(out,`${side}-${id}-${pose}.png`),Buffer.from(png,'base64'));console.log('POSE',side,id,pose);
    }
    await page.evaluate(async()=>{
      const THREE=await import('/vendor/build/three.module.js'); let atlas;
      __sim.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]) if(m.map?.name==='shared-brand-badges')atlas=m.map;});
      if (!atlas) throw new Error('Brand atlas missing from scene');
      const scene=new THREE.Scene(); scene.background=new THREE.Color('#22252b');
      const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map:atlas,transparent:true}));scene.add(quad);
      const camera=new THREE.OrthographicCamera(-1.54,1.54,1,-1,.1,10);camera.position.z=2;
      __sim.renderer.render(scene,camera);window.__atlasPng=__sim.canvas.toDataURL('image/png').split(',')[1];
    });
    await fs.writeFile(resolve(out,`${side}-${id}-atlas.png`),Buffer.from(await page.evaluate(()=>window.__atlasPng),'base64'));
    const signs=await page.evaluate(()=>{let image;const group=__sim.scene.getObjectByName('Greek direction and warning signs')||__sim.scene.getObjectByName('speed signs');group?.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])if(!image&&m.map?.image?.toDataURL)image=m.map.image;});return image?{width:image.width,height:image.height,png:image.toDataURL('image/png').split(',')[1]}:null;});
    if(signs){await fs.writeFile(resolve(out,`${side}-${id}-signs.png`),Buffer.from(signs.png,'base64'));delete signs.png;}
    const metrics=await collectMetrics(page);
    if(side==='after'&&process.env.CODEC_DOWNLOAD==='1'){const map=metrics.assets?.maps[id];assert.equal(map?.codec,'meshopt');assert.equal(map.error,undefined);assert.ok(map.loadMs>=0&&map.geometryBytes>0&&map.downloadBytes>0,'ASR2 must install actual decoded buffers');}
    const baseline=report.runs.find(r=>r.side==='before'&&r.id===id&&r.metrics);if(side==='after'&&baseline)assert.equal(metrics.geometryBytes,baseline.metrics.geometryBytes,'Codec must preserve scene geometry capacity');
    Object.assign(report.runs.at(-1),{metrics,signs,pendingScreens:false});report.errors.push(...errors);
    await fs.writeFile(resolve(out,'browser.json'),JSON.stringify(report,null,2));console.log('RACE',side,id,loadToRaceMs,metrics.heapBytes);await context.close();
  }
} finally { await browser.close();await new Promise(r=>server.close(r));await app.close();await fs.rm(state,{recursive:true,force:true});await fs.writeFile(resolve(out,'browser.json'),JSON.stringify(report,null,2)); }
const reference=process.env.REFERENCE_BROWSER_JSON?JSON.parse(await fs.readFile(process.env.REFERENCE_BROWSER_JSON,'utf8')):null;
for(const after of report.runs.filter(r=>r.side==='after')){
 if(after.id==='megara')assert.equal(after.metrics.requests.filter(r=>/assets\/codecs\/|KTX2Loader-/.test(r.url)).length,0,'Megara must not fetch the texture loader/transcoder');
 const before=report.runs.find(r=>r.side==='before'&&r.id===after.id&&r.round===after.round)||reference?.runs.find(r=>r.side==='before'&&r.id===after.id);if(!before)continue;
 const total=r=>r.metrics.requests.reduce((n,x)=>n+x.bodyBytes,0);assert.ok(total(after)<=total(before),`Startup bytes grew for ${after.id}: ${total(before)} -> ${total(after)}`);

}
assert.equal(report.errors.length,0,report.errors.join('\n'));
