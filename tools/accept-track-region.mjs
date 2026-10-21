// Exercise the emitted region with the production stream, tow planner and car
// physics. Rendering has a separate browser proof; GPU bytes still count here.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decodeGeometryPack} from '../src/baked-geometry.js';
import {prepareTilePacket} from '../src/world-tile-worker.js';
import {WorldTileStream} from '../src/world-tile-stream.js';
import {WorldTileRoads} from '../src/world-tile-roads.js';
import {WorldTileBarriers} from '../src/world-tile-barriers.js';
import {WorldTileObstacles} from '../src/world-tile-obstacles.js';
import {AthensRoute,AthensGround} from '../src/athens-ground.js';
import {worldRecoveryTarget} from '../src/world-recovery.js';
import {Vehicle} from '../src/physics.js';
import {CARS} from '../src/cars.js';
export async function acceptTrackRegion(dir){
 const path=resolve(dir,'data/tiles/penteli/world.json'),manifest=JSON.parse(await readFile(path)),report=JSON.parse(await readFile(resolve(dir,'penteli-equivalence.json')));
 if(report.revision!==manifest.revision||report.budgets.worst2x2Bytes>60*1024**2)throw Error('Stale report or insufficient 2x2 headroom');
 if(!report.geometryPassed||!report.attachment.passed||!report.releaseProofs.bridgeClearance.passed)throw Error('Geometry, isolated attachment and bridge proofs required before tow acceptance');
 let roads;const barriers=new WorldTileBarriers(),obstacles=new WorldTileObstacles(),load=async job=>{const body=await readFile(new URL(job.url));if(body.length!==job.entry.bytes||createHash('sha256').update(body).digest('hex')!==job.entry.sha256)throw Error('Acceptance cell integrity');const b=gunzipSync(body);return prepareTilePacket(decodeGeometryPack(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),job);};
 const stream=new WorldTileStream(manifest,{baseURL:new URL('file://'+path),load,capBytes:64*1024**2-(manifest.regionResidentBytes||0),transientBytes:64*1024**2,concurrency:1,pinSpawn:false,adapter:{prepare(key,packet){let installed=false;return{steps:[][Symbol.iterator](),commit(){roads.graph.install(key,packet);barriers.install(key,packet);obstacles.install(key,packet);installed=true;return{};},dispose(){if(installed){roads.graph.remove(key);barriers.remove(key);obstacles.remove(key);}}};}}});roads=new WorldTileRoads(stream);
 const session={stream,roads,route:null,safePose(p,{halfWidth=1.1,halfLength=2.8}={}){if(!roads.safe({...p,edge:p.edgeId||p.edge},{halfWidth,halfLength,connected:true})||!barriers.safe(p,{halfWidth,halfLength}))return false;for(const a of[-halfLength+halfWidth,0,halfLength-halfWidth])if(obstacles.contact(p.x-Math.sin(p.yaw)*a,p.y,p.z-Math.cos(p.yaw)*a,halfWidth+.1))return false;return true;}};
 const timer=setInterval(()=>stream.activateFrame(),2),result={passed:false,capBytes:stream.capBytes,regionalBytes:manifest.regionResidentBytes||0,scenarios:[],missingContacts:0,maximumHeightError:0,maximumVerticalSpeed:0};
 const ready=async(p,contacts=[])=>{stream.update({...p,contacts});const start=performance.now();while(![p,...contacts].every(q=>stream.readyAt(q.x,q.z))){stream.activateFrame();if(stream.metrics.failures||performance.now()-start>30000)throw Error('Acceptance stream could not load mandatory footprint: '+[...stream.tiles].filter(([,t])=>t.error).map(([k,t])=>k+': '+t.error.message).join('; '));await new Promise(r=>setTimeout(r,5));}};
 try{
  const stations=[40,360,680,1200,2000,2398,3000,4400,4600,5136,5680,6400,7600,8800,10000];
  for(const s of stations){const i=Math.round(s/2),p=report.coverage.route[i],next=report.coverage.route[i+1],yaw=Math.atan2(p[0]-next[0],p[2]-next[2]);
   for(const side of[-1,1]){const off={x:p[0]+Math.cos(yaw)*side*18,y:p[1],z:p[2]-Math.sin(yaw)*side*18,yaw},road={x:p[0],z:p[2]};await ready(off,[road]);
    const spec=CARS.find(c=>c.id===(side<0?'corolla':'huracan')),target=worldRecoveryTarget(session,off,{route:null,halfWidth:(spec.width||1.84)/2,halfLength:(spec.length||4.4)/2});if(!target)throw Error('No safe nearest-road tow at '+s+':'+side);
    const route=new AthensRoute(target),v=new Vehicle(spec,route),ground=new AthensGround(stream,route,barriers,obstacles);v.ground=ground;
    await stream.teleport(target,()=>{v.reset(0,0,0);Object.assign(v,{x:target.x,y:target.y,z:target.z,yaw:target.yaw,_network:true});ground.begin(v);ground.resolve(v,1/240);v.syncWheels();},{validatePose:session.safePose});
    let heightError=0,vertical=0;
    for(let frame=0;frame<480;frame++){if(frame%24===0)await ready(v,ground.footprint(v,.5));ground.begin(v);v.update(1/240,{throttle:0,brake:1,steer:0});const c=stream.contact(v.x,v.z,{referenceY:v.y});if(!c){result.missingContacts++;throw Error('Missing streamed contact');}heightError=Math.max(heightError,Math.abs(v.y-c.y));vertical=Math.max(vertical,Math.abs(v.vy||0));if(!Number.isFinite(v.y)||heightError>.5||vertical>3)throw Error('Tow caused fall/launch at '+s);}
    result.maximumHeightError=Math.max(result.maximumHeightError,heightError);result.maximumVerticalSpeed=Math.max(result.maximumVerticalSpeed,vertical);result.scenarios.push({station:s,side,car:spec.id,edge:target.edgeId,layer:target.layer,towDistance:Math.hypot(target.x-off.x,target.z-off.z),heightError,vertical});
   }
  }
  result.metrics=stream.metrics;result.passed=!result.missingContacts&&!stream.metrics.failures;report.releaseProofs.towGameplay=result;report.passed=report.geometryPassed&&report.attachment.passed&&Object.values(report.releaseProofs).every(p=>p.passed);manifest.acceptance={geometryPassed:report.geometryPassed,attachmentPassed:report.attachment.passed,passed:report.passed};await writeFile(path,JSON.stringify(manifest));await writeFile(resolve(dir,'penteli-equivalence.json'),JSON.stringify(report,null,2));return result;
 }finally{clearInterval(timer);stream.dispose();roads.dispose();barriers.dispose();obstacles.dispose();}
}
if(process.argv[1]===import.meta.filename)console.log(JSON.stringify(await acceptTrackRegion(process.argv[2]),null,2));
