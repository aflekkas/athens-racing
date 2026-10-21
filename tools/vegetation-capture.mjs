// Production/staging cockpit acceptance, using the repository's browser smoke
// workflow (mp-browser-kit). One browser through tools/browser-slot.sh.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHmac,randomBytes} from 'node:crypto';
import {loadSmokeToken} from './smoke-token.mjs';
const [base,out,phase='before',candidate]=process.argv.slice(2);if(!base||!out)throw Error('Usage: base-url feed-directory phase [candidate-bake]');await mkdir(out,{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
const token=loadSmokeToken(),payload=`smoke:${randomBytes(16).toString('hex')}:${Date.now()+540000}`,signature=payload+'.'+createHmac('sha256',token).update(payload).digest('base64url');
const browser=await chromium.launch({executablePath:'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[],report={base,phase,candidate:!!candidate,rows:[],errors};
try{
 const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',extraHTTPHeaders:{'X-Smoke-Session':signature}}),page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
 page.on('console',m=>{if(m.type()==='error'){console.log('CONSOLE',m.text().slice(0,700));if(/shader|WebGLProgram/i.test(m.text()))errors.push(m.text());}});
 if(candidate){
  const bake=resolve(candidate),root=resolve(import.meta.dirname,'..'),publication=JSON.parse(await readFile(resolve(bake,'publication.json'))),index=JSON.parse(await readFile(resolve(bake,'routes/index.json'))),mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.gz':'application/octet-stream','.bin':'application/octet-stream','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
  await page.route('**/*',async r=>{const path=new URL(r.request().url()).pathname;if(new URL(r.request().url()).origin!==new URL(base).origin)return r.fallback();
   if(path==='/api/routes')return r.fulfill({json:{environment:'production',world:false,online:false,routes:index.routes.map(v=>({id:v.id,routeHash:v.routeHash,geometryHash:v.geometryHash,worldSetRevision:v.worldSetRevision,url:`/data/routes/${v.id}.${v.routeHash}.json`}))}});
   if(path==='/data/athens/manifest.json')return r.fulfill({json:publication.definition});
   const file=path.startsWith('/world/')?resolve(bake,'.'+path.slice(6)):path.startsWith('/data/routes/')?resolve(bake,'routes',path.split('/').at(-1)):path==='/'?resolve(root,'index.html'):/^\/(src|assets|data)\//.test(path)||path==='/style.css'?resolve(root,'.'+path):null;
   if(!file)return r.fallback();try{return await r.fulfill({body:await readFile(file),contentType:mime[extname(file)]||'application/octet-stream'});}catch(e){if(e.code==='ENOENT')return r.fallback();throw e;}
  });
 }
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{id:'smoke-vegetation',name:'SCENERY AUDIT',displayName:'SCENERY AUDIT'},csrf:'x'}}));
 // Capture traffic never submits a record or modifies an account.
 await page.route('**/api/**',r=>r.request().method()==='GET'?r.fallback():r.abort());
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>['frame','onAnimationFrame'].includes(cb.name)?0:raf(cb);});
 await page.goto(base+'/?routes=1&route=penteli-hill&simhook&car=cla&cam=cockpit&notraffic&nopedestrians&fixedres=1',{waitUntil:'domcontentloaded',timeout:180000});
 await page.waitForFunction(()=>window.__routePilot&&!__routePilot.G.routePreparing&&!__flow.menu.accounts?.blocked&&document.body.classList.contains('loaded'),{},{timeout:180000,polling:200});console.log('READY');
 for(const [name,s]of [['village',70],['village-upper',250],['hairpin',3630]]){
  const row=await page.evaluate(async({s})=>{const p=__routePilot,v=p.player.veh;p.G.bestSetupChanged=true;p.G.streamInterrupted=true;p.setDriver(()=>({throttle:0,brake:1,steer:0}));__flow.menu.hide();p.G.state='race';document.body.classList.remove('counting','ui-open');document.body.classList.add('racing');v.reset(s,0,0);
   await p.session.prepareSpawn({...v,halfL:v.halfL,halfW:v.halfW},{car:{width:v.halfW*2,length:v.halfL*2}});
   for(let i=0;i<90;i++){v.reset(s,0,0);p.step(1/60,i>86,true);await new Promise(r=>setTimeout(r,20));}
   v.vLong=98/3.6;v.gear=5;p.step(.0001,true,true,1/60);window.__post.render(1/60);p.renderer.getContext().finish();const copy=document.createElement('canvas');copy.width=1280;copy.height=800;copy.getContext('2d').drawImage(p.renderer.domElement,0,0,1280,800);const image=copy.toDataURL('image/webp',.75).split(',')[1];
   return{image,state:p.G.state,routePreparing:p.G.routePreparing,blocked:__flow.menu.accounts?.blocked,contextLost:p.renderer.getContext().isContextLost(),station:s,car:p.player.spec.id,position:[v.x,v.y,v.z],camera:p.camera.position.toArray(),yaw:v.yaw,world:p.session.manifest.revision,stats:p.session.trees.stats,render:{...p.renderer.info.render},resources:p.session.inventory(),failures:p.session.stream.metrics.failures,resident:p.session.stream.residentBytes};},{s});
  const webp=resolve(out,`clearance-${phase}-${name}.webp`),bytes=Buffer.from(row.image,'base64');delete row.image;if(row.state!=='race'||row.routePreparing||row.blocked||row.contextLost||row.failures)throw Error('Capture not playable: '+JSON.stringify(row));if(bytes.length>=150000||bytes.length<5000){console.log('CAPTURE_DIAGNOSTIC',JSON.stringify(row));await writeFile(webp.replace('.webp','-invalid.webp'),bytes);throw Error('Invalid capture byte size: '+bytes.length);}await writeFile(webp,bytes);
  await writeFile(webp.replace('.webp','.txt'),`${phase}: ${candidate?'local candidate over authenticated production assets':base}, Penteli ${name}, compiled-route station ${s} m. Game canvas from the ${candidate?'candidate':'deployed'} renderer and streamed world, Mercedes CLA cockpit at road level, 1280×800, Lighting Off + Effects Off. Reproducible smoke-browser session; no records submitted. Pose and manifest in clearance-${phase}-capture.json.\n`);report.rows.push(row);console.log(name,JSON.stringify(row));
 }
 if(phase!=='before'){
  report.fade=await page.evaluate(async()=>{const p=__routePilot,t=p.session.trees,saved=new Map(t.tiles),forest=t.forest,pose={x:p.player.veh.x,z:p.player.veh.z};t.tiles.clear();t.forest=null;t.rebuild(pose.x,pose.z);t.tiles=saved;t.forest=forest;t.rebuild(pose.x,pose.z);let count=0,maxAge=0;for(const b of t.fade.batches)for(let i=0;i<b.count;i++){count++;maxAge=Math.max(maxAge,t.fade.clock.value-b.attribute.getW(i));}if(!count||maxAge>1e-4)throw Error('Late-cell vegetation did not start at zero coverage');p.step(.0001,true,true);await new Promise(r=>setTimeout(r,650));p.step(.0001,true,true);const middle=t.fade.clock.value;await new Promise(r=>setTimeout(r,650));p.step(.0001,true,true);return{count,maxBirthAgeSeconds:maxAge,middleClock:middle,settledClock:t.fade.clock.value,fadeSeconds:1.2,distanceFade:false,opaqueDistance:true};});
  report.detailOff=await page.evaluate(async()=>{__flow.menu.onChange({key:'worldDetail',value:false,el:{dataset:{scope:'setting'}}});const p=__routePilot;p.step(.0001,true,true);let vegetation=0;p.session.trees.group.traverseVisible(o=>{if(o.isInstancedMesh)vegetation+=o.count;});return{vegetation,visible:p.session.trees.group.visible,detailCollisions:p.session.obstacles.detailEnabled};});
  if(report.detailOff.vegetation||report.detailOff.visible||report.detailOff.detailCollisions)throw Error('World detail Off vegetation failure');
 }
 report.build=await page.evaluate(()=>Object.fromEntries(['sha','build','version'].map(k=>[k,document.querySelector(`meta[name="asr-${k}"]`)?.content])));
 await writeFile(resolve(out,`clearance-${phase}-capture.json`),JSON.stringify(report,null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
