// Deterministic CPU-only busy Riviera race. No GL timings or synthetic systems.
// node --import ./tools/physics-test/register.mjs tools/cpu-race-benchmark.mjs [output.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import * as THREE from '../node_modules/three/build/three.module.js';
import { Vehicle } from '../src/physics.js';
import { Route } from '../src/map.js';
import { RIVIERA_TUNNELS } from '../src/maps/riviera-tunnels.js';
import { RivalAI } from '../src/rival-ai.js';
import { Police } from '../src/police.js';
import { PeoplePolicy, peopleSchedule, villageResidents } from '../src/people-policy.js';
import { RagdollPool, pedestrianThump } from '../src/impact-ragdoll.js';
import { RNG, clamp, damp, wrapAngle } from '../src/util.js';
import { buildWorld } from './headless-traffic.mjs';
const src = n => readFileSync(new URL('../src/' + n, import.meta.url), 'utf8');
const strip = s => s.replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const human = new Function('THREE','RNG','clamp','lerp', strip(src('human.js'))+'\nreturn {makeLook,newPose,poseWalk,poseCycle,poseStand,poseSit,poseLie,poseSwim,armsPanic,armsFist,armsWave,HIP_Y};')(THREE,RNG,clamp,(a,b,t)=>a+(b-a)*t);
const ROAD = { gutter: .55, sidewalk: () => 2.4, curbH: () => .12 };
const People = new Function('THREE','RNG','clamp','damp','wrapAngle','ROAD','PeoplePolicy','peopleSchedule','villageResidents','COND','COND_STATE','hourForTime','pedestrianThump',...Object.keys(human),strip(src('people.js'))+'\nreturn People;')(THREE,RNG,clamp,damp,wrapAngle,ROAD,PeoplePolicy,peopleSchedule,villageResidents,{hour:8.5},{rain:0},()=>8.5,pedestrianThump,...Object.values(human));
const seeded = new RNG(9001); Math.random = () => seeded.next();
const data = JSON.parse(readFileSync(new URL('../data/map.json', import.meta.url)));
const route = new Route(data.route,{corridors:RIVIERA_TUNNELS});
const {traffic,signals,busStops} = buildWorld(route,data,{hour:8.5});
const cars = Function('return '+src('cars.js').split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
const field = ['z4','mini','taxi'].map((id,i)=>{const veh=new Vehicle(cars.find(c=>c.id===id),route);veh.reset(4150-i*12,route.laneU(4150,0),35);return {veh,ai:new RivalAI(route,veh,{driver:{id:'cpu-'+i,mistakeRate:0}})};});
const actors=field.map((c,i)=>({veh:c.veh,kind:i?'rival':'player'}));
traffic.reset(field[0].veh.s);
const police = new Police(traffic,route);traffic.police=police;police.reset(true);
const workerMode = process.argv.includes('--worker');
const bodies = new RagdollPool();const ground=(x,z,b)=>{const q=route.project(x,z,b.groundS);b.groundS=q.s;return route.surfaceY(q.s,q.u)+.015;};
const people=Object.assign(Object.create(People.prototype),{map:{id:'riviera',data},route,terrain:{height:()=>0},rng:new RNG(2024),policy:new PeoplePolicy({id:'riviera',data,route},ROAD.sidewalk),peds:Array.from({length:28},(_,slot)=>({slot,active:false,P:human.newPose()})),anchors:[],zebras:signals.J.filter(j=>j.ped).map(j=>({s:j.zF,j})),t:0,acts:[{},{},{}],onRoad:[],events:[],bodies:{bodies:[],render(){},clear(){}},_impactGround:ground,_f:{},_v:new THREE.Vector3(),drawRadius:175,traffic});
// No meshes: production pedestrian decisions, poses and ragdoll solver still run.
people.draw=function(){for(const p of this.peds)if(p.active)this.pose(p);};
people.reset(field[0].veh.s);
for(let i=0;i<20;i++){const s=4200+i*4,u=route.edge(s)+2,p=route.point(s,u);people.anchors.push({kind:'cafe',s,x:p.x,y:route.surfaceY(s,u)+.12,z:p.z,yaw:0,rank:0});}
people.anchors.sort((a,b)=>a.s-b.s);traffic.people=people;
let client=null,waitForIdle=null,workerHandlerCpu=0,workerHandlerWall=0;
if(workerMode){
 const {RagdollClient}=await import('../src/ragdoll-client.js');
 const harness=await import('./ragdoll-worker-harness.mjs');waitForIdle=harness.waitForIdle;client=new RagdollClient(ground,harness.nodeWorker);
 const receive=client.receive;client.receive=function(m){const c=process.threadCpuUsage(),t=performance.now();receive.call(this,m);if(measured){const used=process.threadCpuUsage(c);workerHandlerCpu+=(used.user+used.system)/1000;workerHandlerWall+=performance.now()-t;}};
}
const names=['playerPhysics','rivalPlanning','rivalPhysics','signals','traffic','police','pedestrians','ragdolls'];
const totals=Object.fromEntries(names.map(k=>[k,0])),cpuTotals=Object.fromEntries(names.map(k=>[k,0])),samples=[],wallSamples=[],events=[],opts={racers:field,traffic:traffic.cars,signals};
let measured=false,gc=[],measurementStart=Infinity,measurementEnd=Infinity;const observer=new PerformanceObserver(list=>{gc.push(...list.getEntries().filter(e=>e.startTime>=measurementStart&&e.startTime<=measurementEnd).map(e=>({ms:e.duration,kind:e.detail.kind})));});observer.observe({entryTypes:['gc']});
let maxTraffic=0,maxPeds=0;
const timed=(name,fn)=>{const t=performance.now(),c=process.threadCpuUsage();fn();if(measured){totals[name]+=performance.now()-t;const used=process.threadCpuUsage(c);cpuTotals[name]+=(used.user+used.system)/1000;}};
const frames=+(process.env.CPU_FRAMES || 3600),warm=600,dt=1/60;
for(let frame=-warm;frame<frames;frame++){
 measured=frame>=0;const start=performance.now(),cpuStart=process.threadCpuUsage(),pv=field[0].veh;if(frame===0)measurementStart=start;
 timed('rivalPlanning',()=>{for(const c of field)c.input=c.ai.update(dt,opts);});
 timed('playerPhysics',()=>pv.update(dt,field[0].input));
 timed('rivalPhysics',()=>{for(let i=1;i<field.length;i++)field[i].veh.update(dt,field[i].input);});
 timed('signals',()=>signals.update(dt,pv.s));
 timed('traffic',()=>{traffic.update(dt,pv.s,actors);events.length=0;for(const a of actors)traffic.collide(a,events,frame*dt);});
 timed('police',()=>police.update(dt,{events,racing:true,dir:1}));
 timed('pedestrians',()=>people.update(dt,pv.s,actors,pv));
 // Sustained worst case: all three bodies relaunched every 2 s (ordinary impacts are much rarer).
 if(frame%120===0)for(let i=0;i<3;i++){client?.reset(bodies.bodies[i]);bodies.bodies[i].launch({x:pv.x+i,y:pv.y,z:pv.z,s:pv.s,vx:12,vz:4,seed:i});}
 timed('ragdolls',()=>{if(client)for(const b of bodies.bodies)client.advance(b,dt);else bodies.update(dt,ground);});
 if(client)await waitForIdle(client);
 if(measured){wallSamples.push(performance.now()-start);const used=process.threadCpuUsage(cpuStart);samples.push((used.user+used.system)/1000);maxTraffic=Math.max(maxTraffic,traffic.cars.filter(c=>c.active).length);maxPeds=Math.max(maxPeds,people.peds.filter(p=>p.active).length);}
 if(frame%300===0)await new Promise(r=>setImmediate(r));
}
measurementEnd=performance.now();client?.clear();await new Promise(r=>setImmediate(r));observer.disconnect();cpuTotals.ragdolls+=workerHandlerCpu;totals.ragdolls+=workerHandlerWall;samples.sort((a,b)=>a-b);
const hash=createHash('sha256').update(JSON.stringify({field:field.map(c=>[c.veh.x,c.veh.z,c.veh.vLong,c.ai.seed]),traffic:traffic.cars.map(c=>[c.active,c.s,c.u,c.v]),peds:people.peds.map(p=>[p.active,p.x,p.z]),bodies:bodies.bodies.map(b=>[...b.p])})).digest('hex');
const out={workerMode,frames,simulatedSeconds:frames/60,warmupSeconds:10,scenario:{map:'riviera',rivals:2,hour:8.5,police:true,maxTraffic,maxPeds,ragdolls:3},systemCpuMs:Object.fromEntries(names.map(k=>[k,cpuTotals[k]/frames])),systemWallMs:Object.fromEntries(names.map(k=>[k,totals[k]/frames])),totalCpuMs:samples.reduce((a,b)=>a+b,0)/frames,p95CpuMs:samples[Math.floor(frames*.95)],p99CpuMs:samples[Math.floor(frames*.99)],framesOver50ms:wallSamples.filter(n=>n>50).length,gcWindow:{startMs:measurementStart,endMs:measurementEnd},gc:{count:gc.length,totalMs:gc.reduce((n,e)=>n+e.ms,0),maxMs:Math.max(0,...gc.map(e=>e.ms))},workerFallback:client?.disabled??false,meanSimCompletionWallMs:wallSamples.reduce((a,b)=>a+b,0)/frames,heapBytes:process.memoryUsage().heapUsed,hash,limits:'CPU-only simulation; no DOM, AudioContext, GL, real input-to-photon or browser long-task observation.'};
console.log(JSON.stringify(out,null,2));const output=process.argv.slice(2).find(a=>!a.startsWith('--'));if(output)writeFileSync(output,JSON.stringify(out,null,2)+'\n');
