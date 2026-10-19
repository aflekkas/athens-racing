// Drive the Tavros underpass link for real: place the car at the link's first point and let the autopilot (real physics) drive on.
// node link-drive.mjs APP R2 OUT.json
import {readFile,writeFile} from 'node:fs/promises';import {startServer,launch,counters} from './lib.mjs';
const [app,r2,out]=process.argv.slice(2);const pilotSource=await readFile(new URL('./pilot.js',import.meta.url),'utf8');
const c=counters(),{server,port}=await startServer({app,r2,c}),{browser,page}=await launch();const report={errors:[],samples:[]};page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:${port}/?map=athens`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__athens,null,{timeout:600000});
 report.placed=await page.evaluate(async()=>{const A=window.__athens;await A.stream.teleport({x:-5790,z:3968},()=>{});await new Promise(r=>setTimeout(r,7000));
  const edges=[...A.roads.graph.edges.values()].map(v=>v.value),link=edges.find(e=>e.id.includes('way:45190676'));if(!link)return {error:'link not loaded'};
  const pts=link.points,p=pts[1],q=pts[2];A.place({x:p[0],y:p[1]+.15,z:p[2],yaw:Math.atan2(-(q[0]-p[0]),-(q[2]-p[2]))});A.player.veh.vLong=0;
  window.__edges=new Map();setInterval(()=>{const v=A.player.veh;try{const n=A.roads.graph.nearest(v.x,v.z,{referenceY:v.y,maxDistance:12});if(n)window.__edges.set(n.edge,(window.__edges.get(n.edge)||0)+1);}catch{}},500);
  return {link:link.id,from:pts[0],to:pts.at(-1),length:link.points.length,next:[...(A.roads.graph.outgoing.get(link.to)||[])]};});
 await page.evaluate(`(${pilotSource})({x:-8480,z:3917})`);
 for(let t=0;t<=75;t+=5){await page.evaluate(()=>window.__athens.advance(5,{renderEvery:15}));
  report.samples.push(await page.evaluate(()=>{const A=window.__athens,v=A.player.veh;return {x:v.x,y:v.y,z:v.z,speed:v.vLong,holds:A.stats.holds,missing:A.stats.missingContacts};}));}
 report.edgesDriven=await page.evaluate(()=>[...window.__edges.entries()]);report.final=await page.evaluate(()=>{const s=window.__athens.stats;return {metres:s.metres,holds:s.holds,missingContacts:s.missingContacts,carHits:s.carHits};});
}catch(e){report.failure=e.stack}finally{await writeFile(out,JSON.stringify(report,null,1));await browser.close();server.close();}
console.log(JSON.stringify({failure:report.failure,placed:report.placed,final:report.final,errors:report.errors.slice(0,3),edges:report.edgesDriven?.map(e=>e[0])}));
