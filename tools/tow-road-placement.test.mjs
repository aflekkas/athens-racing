import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap, MAPS } from '../src/map.js';
import { Vehicle } from '../src/physics.js';
import { Ground } from '../src/ground.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { routeTowAdapter } from '../src/road-recovery.js';
import { courseTowLimits, towCourseTo } from '../src/course.js';
import { planTow, RoadIndex } from '../src/tow-placement.js';
import { CARS } from '../src/cars.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Execute both production functions, including the asynchronous fade callback, the nearest-road plan and the
// MP server-authoritative response. Owner decision 2026-10-18: "we just want to tow back onto the road".
function recoveryHarness(route, v, options={}) {
  const callbacks=[],G={state:'race',dir:options.dir||1,ev:{r:{s0:0},def:{type:options.free?'free':'sprint'}},pen:0};
  const dir=G.dir;
  if(options.lastRoad!=null)G.run={r:{s0:0},course:{s0:0,dir,validProgress:options.lastRoad*dir,lastRoad:{s:options.lastRoad,u:0}},courseClock:0,progress:s=>s*dir};
  const safe={s:options.safe??v.s,u:0},towOffer={safe},player={veh:v};
  const multiplayer={active:!!options.online,retired:false,lobby:{raceId:'test',event:{dir}},recover:async()=>options.served??{s:options.serverS??safe.s,u:0,until:250},now:()=>0,stateSender:{discontinuity(){}}};
  const ground=options.ground||{network:null,walls:()=>null},traffic=options.traffic||{cars:[],point(){}},grid=options.grid||[];
  const api=Function('G','multiplayer','towOffer','route','ground','traffic','grid','planTow','RoadIndex','routeTowAdapter','courseTowLimits','towCourseTo','clamp','beginCameraBlend','syncCar','updateCamera','player','look','closeTowOffer','TOW_PROMPT_COOLDOWN','controls','document','sessionTransitions','inFreeRoam','hud','notifications',
    section('// Tow, reset and automatic recovery put', 'function stuckCheck(')+section('function tow(', 'function resetCar(')+'return {tow,backOnRoad};')(
    G,multiplayer,towOffer,route,ground,traffic,grid,planTow,RoadIndex,routeTowAdapter,courseTowLimits,towCourseTo,clamp,()=>{},()=>{},()=>{},player,{},()=>{},20,{releaseMouseLook(){}},{body:{classList:{add(){},remove(){}}}},{after(ms,fn){callbacks.push(fn);}},()=>!!options.free,{message(){}},{dismiss(){}});
  return {G,towOffer,...api,async flush(){while(callbacks.length)await callbacks.shift()(()=>true);}};
}
for(const def of MAPS)test(`${def.id}: real T/R paths put off-road cars on the nearest road, in free roam and in a race`,async t=>{
  const beforeFetch=globalThis.fetch;globalThis.fetch=async u=>new Response(readFileSync(new URL('../'+u,import.meta.url)));
  let map;try{map=await loadMap(undefined,'./',def.id,{preload:false});}finally{globalThis.fetch=beforeFetch;}
  const r=map.route,network=new RoadNetwork(map);network.source=map.terrain.H;map.roadNetwork=network;
  const ground=new Ground(map,(x,z)=>map.terrain.height(x,z),{network}),v=new Vehicle(CARS.find(c=>c.id==='corolla'),r);v.ground=ground;
  let samples=0;
  const stations=Array.from({length:Math.ceil(r.length/73)},(_,i)=>i*73);
  if(def.id==='penteli')for(let s=5700;s<=5860;s+=2)stations.push(s);
  const forwardOf=yaw=>[-Math.sin(yaw),-Math.cos(yaw)];
  let streets=0;
  for(const s of stations)for(const free of [true,false])for(const side of [-1,1])for(const reset of [false,true]){
    v.reset(s,side*(r.edge(s)+12));v._network=true;v.offroad=1;if(reset)v.yaw+=Math.PI;
    const [fx,fz]=forwardOf(v.yaw),nominal=r.project(v.x,v.z,null).s,h=recoveryHarness(r,v,{free,dir:1,ground,safe:s,lastRoad:free?undefined:s-30});h.tow(v,{reset});await h.flush();
    assert.ok([v.x,v.y,v.z,v.s,v.u,v.yaw].every(Number.isFinite));
    if(!v._network){
      assert.ok(Math.abs(v.u)+v.halfW<=r.edge(v.s),`whole car on road at ${s}`);
      assert.ok(Math.abs(v.y-r.point(v.s,v.u).y)<1e-6,'reset uses the road plane, not the DEM');
      const f=r.contactFrame(v.s,v.u,{}),facing=Math.sign(fx*f.tx+fz*f.tz)||1,along=-Math.sin(v.yaw)*f.tx-Math.cos(v.yaw)*f.tz;
      assert.ok(Math.abs(along)>.999,'faces along the road');
      // Only a folded hairpin can shift the station (to keep the leg), and with it the meaning of 'closest to the heading'.
      if(Math.abs(v.s-nominal)<1)assert.ok(along*facing>.999,'faces the direction closest to its heading');
      if(!free)assert.ok(v.s>=s-30-.01,'a race tow never lands before the latest valid pose');
      const placedS=v.s;ground.resolve(v,1/60);
      assert.ok(Math.abs(v.s-placedS)<.35,'first live step retains the recovery leg');
      assert.ok(Math.abs(v.u)+v.halfW<r.edge(v.s)+.05,'first real ground step stays on the road');
      assert.ok(Math.abs(v.y-r.surfaceY(v.s,v.u))<.05,'ground agrees with reset surface');samples++;
    } else {
      // The nearest road was a side street (never in a race: the route is 12 m away): on its tarmac, along it.
      assert.equal(free,true,'a race car within 40 m of the route is towed onto the route');streets++;
      const n=network.sample(v.x,v.z);assert.ok(n&&n.step===0,'on the tarmac of a street');
      assert.ok(Math.abs(v.y-network.height(v.x,v.z))<1e-6,'street height, not the DEM');
      const [yx,yz]=forwardOf(v.yaw);assert.ok(network.candidates(v.x,v.z).some(g=>network.distance(g,v.x,v.z)<=g.hw+.3&&Math.abs(yx*g.dx/g.L+yz*g.dz/g.L)>.999),'faces along the street');
      ground.resolve(v,1/60);assert.equal(v._network,true,'the first live step keeps the street surface');assert.ok(network.sample(v.x,v.z)?.step===0,'and stays on its tarmac');samples++;
    }
  }
  // These exercise the main-game path absent from the helper-only tests.
  // Owner decision 2026-10-18: a tow puts the car on the nearest road, never before its latest valid pose.
  v.reset(200,r.edge(200)+15);const x0=v.x,z0=v.z;let h=recoveryHarness(r,v,{safe:180,lastRoad:150,ground});h.tow(v);await h.flush();assert.ok(Math.hypot(v.x-x0,v.z-z0)<=r.edge(200)+25,'towed to the nearest road, where the car is');
  v.reset(200,20);const x1=v.x,z1=v.z;h=recoveryHarness(r,v,{safe:180,lastRoad:150,ground});h.tow(v,{reset:true});await h.flush();assert.ok(Math.hypot(v.x-x1,v.z-z1)<=r.edge(200)+25,'a reset puts the car on the nearest road too');
  v.reset(200,r.edge(200)+15);h=recoveryHarness(r,v,{safe:180,lastRoad:230,ground});h.tow(v);await h.flush();assert.ok((v.s-230)>=-.01||v._network,`never back along the course, before the latest valid pose (${v.s})`);
  assert.equal(h.G.run.course.validProgress,230,'the tow grants no progress');assert.equal(h.G.run.course.lastRoad.s,230);
  v.reset(200,20);h=recoveryHarness(r,v,{online:true,safe:180,serverS:120,ground});h.tow(v);await h.flush();assert.ok(Math.abs(v.s-120)<=1,'online keeps the server pose');assert.equal(h.towOffer.hold,.25);
  v.reset(200,20);h=recoveryHarness(r,v,{ground});h.backOnRoad(v,{s:NaN});assert.ok([v.x,v.y,v.z,v.s].every(Number.isFinite),'invalid anchor is repaired before reset');
  if(r.closed)for(const dir of [-1,1]){
    const earned=r.length+1000,anchor=dir*earned;
    v.reset(anchor-dir*r.length,r.edge(anchor)+15);v.bodyDynamic=true;const wx=v.x,wz=v.z;
    h=recoveryHarness(r,v,{dir,safe:anchor,lastRoad:anchor,ground});h.tow(v);h.tow(v);await h.flush();
    assert.ok(Math.abs(v.s-anchor)<r.length/2||v.s*dir>=anchor*dir,`wrong-lap projection cannot cause a massive backward tow (${v.s} vs ${anchor})`);assert.ok((v.s-anchor)*dir>=-.01,'never back along the course, even on the wrong lap');assert.ok(Math.hypot(v.x-wx,v.z-wz)<=r.edge(0)+25,'the nearest road where the car is');
    assert.equal(h.G.pen,0,'solo tow has no stacked time penalty');assert.equal(h.towOffer.hold,0);
    assert.equal(v.bodyDynamic,false);assert.equal(v.sus.fresh,true);
    h.tow(v,{automatic:true});assert.equal(h.G.towing,false,'rearm rejects an immediate repeat');
  }
  t.diagnostic(`${samples} production tow/reset samples (${streets} onto side streets), plus latest-pose, MP and invalid-anchor cases`);
});
