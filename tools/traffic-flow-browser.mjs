// Authenticated staging drive. Use: bash tools/browser-slot.sh node tools/traffic-flow-browser.mjs OUT PHASE [area,...]
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,createHmac} from 'node:crypto';
import {loadSmokeToken} from './smoke-token.mjs';
const [out,phase='after',areas='syntagma,glyfada,quick']=process.argv.slice(2),base='https://staging.athensracing.com';
await mkdir(out,{recursive:true});
const {chromium}=await import('playwright'),token=loadSmokeToken(),nonce=randomBytes(16).toString('hex');
const header=()=>{const p=`smoke:${nonce}:${Date.now()+540000}`;return p+'.'+createHmac('sha256',token).update(p).digest('base64url');};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const report={base,phase,rows:[],errors:[]};
process.once('SIGINT',()=>void browser.close());
try{
 for(const area of areas.split(',')){
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',extraHTTPHeaders:{'X-Smoke-Session':header()}}),page=await context.newPage();
  page.on('pageerror',e=>{report.errors.push(e.message);console.log('PAGEERROR',e.message);});page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text().slice(0,500));});page.setDefaultTimeout(240000);
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{id:'smoke-traffic-flow',displayName:'TRAFFIC AUDIT'},csrf:'x',migrated:true}}));
  for(const name of ['friends','invites'])await page.route('**/api/account/'+name,r=>r.fulfill({json:[]}));
  await page.route('**/api/**',r=>r.request().method()==='GET'?r.fallback():r.abort());
  await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>['frame','onAnimationFrame','tick'].includes(cb.name)?0:raf(cb);localStorage.setItem('paraliaki.settings',JSON.stringify({perfClass:'low',renderScale:.65,frameCap:30,worldDetail:true}));});
  const id=area==='quick'?'riviera-coast':'syntagma-pilot',spawn=area==='glyfada'?`${(23.753-23.73)*87745.27512677578},${(37.863-37.98)*-111320}`:'481,617';
  await page.goto(area==='quick'?`${base}/?routes=1&route=${id}&simhook=1&car=corolla&cam=chase`:`${base}/?map=athens&spawn=${spawn}&simhook=1&car=corolla&cam=chase`,{waitUntil:'domcontentloaded'});
  console.log('NAV',await page.evaluate(()=>({url:location.href,text:document.body.innerText.slice(-900),athens:!!window.__athens,flow:!!window.__flow})));
  await page.waitForFunction(()=> (window.__athens||window.__routePilot&&!__routePilot.G.routePreparing)&&!__flow.menu.accounts?.blocked&&document.body.classList.contains('loaded'),null,{polling:200,timeout:120000}).catch(async e=>{console.log('BOOT FAILURE',await page.evaluate(()=>({url:location.href,text:document.body.innerText.slice(-1800),athens:!!window.__athens,flow:!!window.__flow,loaded:document.body.className})));throw e;});
  console.log('READY',phase,area);
  await page.evaluate(async area=>{
   if(window.__athens){const a=__athens;window.__flowPilot={...a,route:a.player.veh.route,G:{state:'race'},session:{props:a.props,roads:a.roads},traffic:{cars:a.traffic},step(dt,draw){a.stream.activateFrame();for(let i=0;i<4;i++)a.step(dt/4);if(draw)a.render(1/60);}};}else window.__flowPilot=__routePilot;
   const p=__flowPilot,v=p.player.veh;
   await p.traffic.warmFleet?.();__flow.menu.hide();p.G.bestSetupChanged=true;p.G.streamInterrupted=true;
   window.__flowStats={area,elapsed:0,distance:0,last:{x:v.x,z:v.z},maxStopped:0,maxClusters:0,maxStop:0,stoppedCarSeconds:0,clusterSeconds:0,carContacts:0,stops:new Map(),samples:[]};
   if(p.traffic.collide){const collide=p.traffic.collide.bind(p.traffic);p.traffic.collide=(actor,out,...rest)=>{const n=out.length;try{return collide(actor,out,...rest);}finally{__flowStats.carContacts+=out.length-n;}};}
   p.setDriver(v=>{
    if(window.__flowStats.parked)return {throttle:0,brake:0,steer:0,handbrake:true};
    let target;
    if(area!=='quick'){
     const graph=p.session.roads.graph,n=graph.nearest(v.x,v.z,{referenceY:v.y,maxDistance:30});
     const station=(e)=>{let best=Infinity,result=0,at=0;for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],dx=b[0]-a[0],dz=b[2]-a[2],l=Math.hypot(dx,dz),f=Math.max(0,Math.min(1,((v.x-a[0])*dx+(v.z-a[2])*dz)/(l*l||1))),d=Math.hypot(v.x-a[0]-dx*f,v.z-a[2]-dz*f);if(d<best){best=d;result=at+l*f;}at+=l;}return {s:result,length:at,d:best};};
     const at=(e,s)=>{for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],dx=b[0]-a[0],dz=b[2]-a[2],l=Math.hypot(dx,dz);if(s<=l||i===e.points.length-1){const t=Math.max(0,Math.min(1,s/(l||1))),u=e.flags&1?0:1.4;return {x:a[0]+dx*t-dz/(l||1)*u,z:a[2]+dz*t+dx/(l||1)*u};}s-=l;}};
     if(n){let e=graph.edges.get(window.__driveEdge)?.value;const nearest=graph.edges.get(n.edge)?.value;
      if(!e||station(e).d>8){const reverse=[...(graph.outgoing.get(nearest.to)||[])].map(id=>graph.edges.get(id)?.value).find(e=>e?.to===nearest.from);e=[nearest,reverse].filter(Boolean).sort((a,b)=>{const dot=e=>{const q=e.points[1],r=e.points[0],dx=q[0]-r[0],dz=q[2]-r[2];return (dx*-Math.sin(v.yaw)+dz*-Math.cos(v.yaw))/(Math.hypot(dx,dz)||1);};return dot(b)-dot(a);})[0];}
      const q=station(e);let s=q.s+Math.max(8,v.vLong*1.3);if(s>q.length){const last=e.points.at(-1),prior=e.points.at(-2),choices=[...(graph.outgoing.get(e.to)||[])].map(id=>graph.edges.get(id)?.value).filter(next=>next&&next.to!==e.from&&graph.legal(e.id,next));choices.sort((a,b)=>{const score=e=>{const p=e.points[1],r=e.points[0];return ((p[0]-r[0])*(last[0]-prior[0])+(p[2]-r[2])*(last[2]-prior[2]))/(Math.hypot(p[0]-r[0],p[2]-r[2])||1);};return score(b)-score(a);});if(choices[0]){s-=q.length;e=choices[0];}}
      target=at(e,s);window.__driveEdge=e.id;
     }
    }else target=p.route.point(Math.min(p.route.length-5,v.s+Math.max(7,v.vLong*1.2)),Math.min(1.5,p.route.frame(v.s).rightM*.4));
    if(!target)return {throttle:0,brake:1,steer:0};
    const angle=Math.atan2(Math.sin(Math.atan2(-(target.x-v.x),-(target.z-v.z))-v.yaw),Math.cos(Math.atan2(-(target.x-v.x),-(target.z-v.z))-v.yaw));
    const speed=Math.abs(angle)>.5?3:8;
    return {throttle:Math.max(0,Math.min(.65,(speed-v.vLong)*.3)),brake:Math.max(0,Math.min(1,(v.vLong-speed)*.3)),steer:Math.max(-1,Math.min(1,-angle*1.8)),handbrake:false};
   });
  },area);
  for(let batch=0;batch<24;batch++){
   const state=await page.evaluate(async batch=>{
    const p=__flowPilot,v=p.player.veh,s=__flowStats;s.parked=batch>=18;
    for(let i=0;i<600;i++){
     p.step(1/60,false,true,1/60);s.elapsed+=1/60;
     s.distance+=Math.hypot(v.x-s.last.x,v.z-s.last.z);s.last={x:v.x,z:v.z};
     const active=p.traffic.cars.filter(c=>c.active&&!c.police),red=new Set(active.filter(c=>p.session.props.hold(c.point,p.session.roads.graph.edges.get(c.point.edge)?.value.points||[])));
     for(let pass=0;pass<active.length;pass++)for(const c of active)if(!red.has(c)&&active.some(o=>red.has(o)&&Math.abs(o.y-c.y)<2.5&&Math.hypot(o.x-c.x,o.z-c.z)<15&&Math.cos(o.vehicle.yaw-c.vehicle.yaw)>.5))red.add(c);
     const stopped=[];for(const c of active){let r=s.stops.get(c.id);if(!r||r.vehicle!==c.vehicle){r={vehicle:c.vehicle,t:0};s.stops.set(c.id,r);}r.t=Math.abs(c.v)<.5&&!red.has(c)?r.t+1/60:0;s.maxStop=Math.max(s.maxStop,r.t);if(r.t>5)stopped.push(c);}
     const seen=new Set();let clusters=0;for(const c of stopped){if(seen.has(c))continue;const g=[c];seen.add(c);for(let j=0;j<g.length;j++)for(const o of stopped)if(!seen.has(o)&&Math.abs(o.y-g[j].y)<2.5&&Math.hypot(o.x-g[j].x,o.z-g[j].z)<16){seen.add(o);g.push(o);}if(g.length>=3)clusters++;}
     s.maxStopped=Math.max(s.maxStopped,stopped.length);s.maxClusters=Math.max(s.maxClusters,clusters);s.stoppedCarSeconds+=stopped.length/60;s.clusterSeconds+=clusters/60;
     if(i%60===0){p.step(.00001,true,true,1/60);await new Promise(r=>setTimeout(r,0));}
    }
    const row={elapsed:s.elapsed,physicsSeconds:p.stats?.simulationSeconds??p.G.raceT,distance:s.distance,maxStopped:s.maxStopped,maxClusters:s.maxClusters,maxStop:s.maxStop,stoppedCarSeconds:s.stoppedCarSeconds,clusterSeconds:s.clusterSeconds,active:p.traffic.cars.filter(c=>c.active).length,moving:p.traffic.cars.filter(c=>c.active&&Math.abs(c.v)>.5).length,contacts:p.stats?.carHits??s.carContacts,missingContacts:p.stats?.missingContacts??p.session.metrics?.missingContacts??0,holds:p.stats?.holds??p.session.metrics?.holds??0,position:[v.x,v.y,v.z],speed:v.vLong,state:p.G.state};s.samples.push(row);return row;
   },batch);
   console.log(area,batch,JSON.stringify(state));
   if([17,23].includes(batch)){const file=resolve(out,`${phase}-${area}-${batch===17?'drive':'parked'}.png`),temp=file+'.tmp';await page.screenshot({path:temp,type:'png',timeout:60000});await rename(temp,file);}
  }
  report.rows.push(await page.evaluate(()=>{const s=__flowStats,p=__flowPilot;return {area:s.area,build:document.querySelector('meta[name="asr-sha"]')?.content,elapsed:s.elapsed,physicsSeconds:p.stats?.simulationSeconds??p.G.raceT,distance:s.distance,maxStopped:s.maxStopped,maxClusters:s.maxClusters,maxStop:s.maxStop,stoppedCarSeconds:s.stoppedCarSeconds,clusterSeconds:s.clusterSeconds,contacts:p.stats?.carHits??s.carContacts,missingContacts:p.stats?.missingContacts??p.session.metrics?.missingContacts??0,holds:p.stats?.holds??p.session.metrics?.holds??0,samples:s.samples,trafficSource:p.traffic.candidate?.toString().slice(0,100)||'WorldTraffic free roam'};}));
  await context.close();await writeFile(resolve(out,phase+'-browser.json'),JSON.stringify(report,null,2));
 }
}finally{await writeFile(resolve(out,phase+'-browser.json'),JSON.stringify(report,null,2));await browser.close();}
