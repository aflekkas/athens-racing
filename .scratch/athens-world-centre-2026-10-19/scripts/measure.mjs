// 10-minute coastal drive with traffic and real physics, measuring download, memory and frame time.
// node measure.mjs APP R2 OUT.json [--mobile] [--seconds 600] [--goal x,z]
import {readFile,writeFile} from 'node:fs/promises';import {startServer,launch,treeRss,counters} from './lib.mjs';
const [app,r2,out]=process.argv.slice(2),mobile=process.argv.includes('--mobile'),seconds=Number(process.argv[process.argv.indexOf('--seconds')+1])||600;
const goalList=(process.argv.includes('--goal')?process.argv[process.argv.indexOf('--goal')+1]:'-7283,4230').split(';').map(g=>g.split(',').map(Number));let goalIndex=0;let goalArg=goalList[0];
const startArg=process.argv.includes('--start')?process.argv[process.argv.indexOf('--start')+1].split(',').map(Number):null;
const pilotSource=await readFile(new URL('./pilot.js',import.meta.url),'utf8');
const c=counters(),{server,port}=await startServer({app,r2,c});
const {browser,page}=await launch({mobile,throttle:mobile?4:1});const pid=process.pid;
const report={mode:mobile?'phone 390x844, 4x CPU throttle':'desktop 1280x720',seconds,errors:[],samples:[]};
page.on('pageerror',e=>report.errors.push(String(e.message).slice(0,300)));page.on('console',m=>{if(m.type()==='error')report.errors.push('console: '+m.text().slice(0,200));});
const started=Date.now();
try{
  await page.goto(`http://127.0.0.1:${port}/?map=athens`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__athens,null,{timeout:600000});
  report.initial={wallSeconds:(Date.now()-started)/1000,worldBytes:c.world.bytes,worldCells:c.world.count,manifestBytes:c.manifest.bytes,otherBytes:c.other.bytes,totalBytes:c.world.bytes+c.manifest.bytes+c.other.bytes,streamDownloaded:await page.evaluate(()=>window.__athens.stats.initialDownloadBytes),initialDriveMs:await page.evaluate(()=>window.__athens.stats.initialDriveMs)};
  if(startArg){report.startRequest=await page.evaluate(async([x,z])=>{const A=window.__athens;
    const near=()=>[...A.roads.anchors({validate:true})].filter(a=>a.layer===undefined||true).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];
    let a=near();for(let i=0;i<5&&(!a||Math.hypot(a.x-x,a.z-z)>60);i++){await A.stream.teleport({x,z},()=>{});await new Promise(r=>setTimeout(r,4000));a=near();}
    if(!a)return {error:'no anchor'};await A.goto(a.id,a.x,a.z);await new Promise(r=>setTimeout(r,4000));return {id:a.id,x:a.x,z:a.z};},startArg);}
  report.start=await page.evaluate(()=>{const v=window.__athens.player.veh;return {x:v.x,z:v.z};});
  await page.evaluate(`(${pilotSource})({x:${goalArg[0]},z:${goalArg[1]}})`);
  report.orient=await page.evaluate(()=>window.__pilot.orient());await page.waitForTimeout(3000);
  const sample=async(t)=>{const s=await page.evaluate(()=>{const A=window.__athens,m=A.inventory(),v=A.player.veh,st=A.stream;return {simSeconds:A.stats.simulationSeconds,metres:A.stats.metres,holds:A.stats.holds,missing:A.stats.missingContacts,carHits:A.stats.carHits,x:v.x,z:v.z,y:v.y,heap:performance.memory?.usedJSHeapSize,js:m.js,gpu:m.gpu,tileJS:m.tileJS,tileGPU:m.tileGPU,streamResident:st.residentBytes,streamReserved:m.streamReserved,transient:m.transient,tiles:[...st.tiles.values()].filter(t=>t.packet).length,peakResident:st.metrics.peakResidentBytes,failures:st.metrics.failures,traffic:A.traffic.filter(c=>c.active).length,reroutes:window.__pilot.reroutes};});s.rss=treeRss(pid);s.t=t;s.worldBytes=c.world.bytes;s.worldCells=c.world.count;report.samples.push(s);return s;};
  await sample(0);
  let elapsed=0;const chunk=15;
  while(elapsed<seconds){
    await page.evaluate(n=>window.__athens.advance(n,{renderEvery:15}),chunk);elapsed+=chunk;
    // A car at the edge of the baked area (no tile beyond) or at a dead end stops: resume from an interior anchor nearer the goal.
    const at=await page.evaluate(()=>{const v=window.__athens.player.veh;return [v.x,v.z];});
    if(goalList.length>1&&Math.hypot(at[0]-goalArg[0],at[1]-goalArg[1])<250){goalIndex=(goalIndex+1)%goalList.length;goalArg=goalList[goalIndex];report.goalsReached=(report.goalsReached||0)+1;report.bestGd=undefined;await page.evaluate(g=>{window.__pilot.goal={x:g[0],z:g[1]};},goalArg);}if(report.lastAt&&Math.hypot(at[0]-report.lastAt[0],at[1]-report.lastAt[1])<8)await page.evaluate(()=>{window.__pilot.needsReroute=true;});report.lastAt=at;
    // No net progress toward the goal for 75 s (a local loop or a jam): resume from an interior anchor nearer the goal.
    const gd=Math.hypot(at[0]-goalArg[0],at[1]-goalArg[1]);if(report.bestGd===undefined||gd<report.bestGd-40){report.bestGd=gd;report.lastImprove=elapsed;}else if(elapsed-report.lastImprove>=75){await page.evaluate(()=>{window.__pilot.needsReroute=true;});report.lastImprove=elapsed;}
    if(await page.evaluate(()=>window.__pilot.needsReroute)){const ok=await page.evaluate(()=>window.__pilot.reroute());report.reroutes=(report.reroutes||0)+(ok?1:0);report.lastAt=await page.evaluate(()=>{const v=window.__athens.player.veh;return [v.x,v.z];});}
    if(elapsed%30===0||elapsed>=seconds){const s=await sample(elapsed);if(elapsed%120===0)console.log(`t=${elapsed}s metres=${s.metres.toFixed(0)} cells=${s.worldCells} MB=${(s.worldBytes/1048576).toFixed(1)} rss=${(s.rss/1048576).toFixed(0)}MB reroutes=${s.reroutes} holds=${s.holds}`);}
  }
  // Real-time frames: let the normal render loop run (driver still active) and read rAF deltas.
  await page.evaluate(()=>{window.__athens.stats.frameMs.length=0;});await page.waitForTimeout(40000);
  report.frames=await page.evaluate(()=>{const f=[...window.__athens.stats.frameMs].sort((a,b)=>a-b),q=p=>f[Math.min(f.length-1,Math.floor(f.length*p))];const c=[...window.__athens.stats.cpuMs].sort((a,b)=>a-b);return {count:f.length,median:q(.5),p95:q(.95),cpuMedian:c[Math.floor(c.length/2)],cpuP95:c[Math.floor(c.length*.95)]};});
  await sample(elapsed+40);
  report.final=await page.evaluate(()=>{const A=window.__athens,s=A.stats;return {metres:s.metres,simulationSeconds:s.simulationSeconds,holds:s.holds,missingContacts:s.missingContacts,carHits:s.carHits,maxEstimatedJSBytes:s.maxEstimatedJSBytes,maxEstimatedGPUBytes:s.maxEstimatedGPUBytes,peakResidentBytes:A.stream.metrics.peakResidentBytes,peakReservedBytes:A.stream.metrics.peakReservedBytes,failures:A.stream.metrics.failures,reroutes:window.__pilot.reroutes,resources:A.inventory().resources};});
  const peak=k=>Math.max(...report.samples.map(s=>s[k]||0));report.peaks={heap:peak('heap'),js:peak('js'),gpu:peak('gpu'),streamResident:peak('streamResident'),streamReserved:peak('streamReserved'),rss:peak('rss'),tiles:peak('tiles')};
  report.clientRequested=await page.evaluate(()=>({poolDownloadedBytes:window.__athens.stream.pool?.downloadedBytes??null,loadedBytes:window.__athens.stream.metrics.loadedBytes,loads:window.__athens.stream.metrics.loads??null}));
  report.download={networkRequestsForCells:c.world.count,distinctCellBytes:[...(c.world.size||new Map()).values()].reduce((n,v)=>n+v,0),worldBytes:c.world.bytes,worldCells:c.world.count,distinctCells:c.world.urls.size,manifestBytes:c.manifest.bytes,otherBytes:c.other.bytes,totalBytes:c.world.bytes+c.manifest.bytes+c.other.bytes,byExt:c.byExt};
  report.wallSeconds=(Date.now()-started)/1000;
}catch(e){report.failure=e.stack}finally{await writeFile(out,JSON.stringify(report,null,1));await browser.close();server.close();}
console.log(JSON.stringify({failure:report.failure,initial:report.initial,peaks:report.peaks,download:{...report.download,byExt:undefined},frames:report.frames,final:report.final,errors:report.errors.slice(0,3)}));
