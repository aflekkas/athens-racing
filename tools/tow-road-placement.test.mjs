import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap, MAPS } from '../src/map.js';
import { Vehicle } from '../src/physics.js';
import { Ground } from '../src/ground.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { roadRecoveryPose } from '../src/road-recovery.js';
import { courseProgress, courseRecoveryStation } from '../src/checkpoints.js';
import { recoveryPosition } from '../src/race-lifecycle.js';
import { CARS } from '../src/cars.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Execute both production functions, including the asynchronous fade callback,
// saved anchor, solo checkpoint limit and MP server-authoritative response.
function recoveryHarness(route, v, options={}) {
  const callbacks=[],G={state:'race',dir:options.dir||1,ev:{r:{s0:0},def:{type:'free'}},pen:0};
  if(options.checkpoint!=null||options.earned!=null)G.run={r:{s0:0},course:{s0:0,dir:G.dir,validProgress:options.earned??Math.min(options.safe??v.s,options.checkpoint-3)},checkpointClock:0,progress:s=>s*G.dir};
  const safe={s:options.safe??v.s,u:0},towOffer={safe},player={veh:v};
  const multiplayer={active:!!options.online,retired:false,lobby:{raceId:'test',event:{dir:G.dir}},recover:async()=>({s:options.serverS??safe.s,until:250}),now:()=>0,stateSender:{discontinuity(){}}};
  const api=Function('G','multiplayer','towOffer','route','recoveryPosition','courseProgress','courseRecoveryStation','roadRecoveryPose','clamp','beginCameraBlend','syncCar','updateCamera','player','look','closeTowOffer','TOW_PROMPT_COOLDOWN','controls','document','sessionTransitions','inFreeRoam','hud','notifications',
    section('function backOnRoad(', 'function stuckCheck(')+section('function tow(', 'function resetCar(')+'return {tow,backOnRoad};')(
    G,multiplayer,towOffer,route,recoveryPosition,courseProgress,courseRecoveryStation,roadRecoveryPose,clamp,()=>{},()=>{},()=>{},player,{},()=>{},20,{releaseMouseLook(){}},{body:{classList:{add(){},remove(){}}}},{after(ms,fn){callbacks.push(fn);}},()=>!G.run,{message(){}},{dismiss(){}});
  return {G,towOffer,...api,async flush(){while(callbacks.length)await callbacks.shift()(()=>true);}};
}
for(const def of MAPS)test(`${def.id}: real T/R paths place off-road cars on the race surface in both directions`,async t=>{
  const beforeFetch=globalThis.fetch;globalThis.fetch=async u=>new Response(readFileSync(new URL('../'+u,import.meta.url)));
  let map;try{map=await loadMap(undefined,'./',def.id,{preload:false});}finally{globalThis.fetch=beforeFetch;}
  const r=map.route,network=new RoadNetwork(map);network.source=map.terrain.H;map.roadNetwork=network;
  const ground=new Ground(map,(x,z)=>map.terrain.height(x,z),{network}),v=new Vehicle(CARS.find(c=>c.id==='corolla'),r);v.ground=ground;
  let samples=0;
  const stations=Array.from({length:Math.ceil(r.length/73)},(_,i)=>i*73);
  if(def.id==='penteli')for(let s=5700;s<=5860;s+=2)stations.push(s);
  for(const s of stations)for(const dir of [-1,1])for(const side of [-1,1])for(const reset of [false,true]){
    v.reset(s,side*(r.edge(s)+12));v._network=true;v.offroad=1;
    const h=recoveryHarness(r,v,{dir,safe:s});h.tow(v,{reset});await h.flush();
    assert.ok([v.x,v.y,v.z,v.s,v.u,v.yaw].every(Number.isFinite));
    assert.ok(Math.abs(v.u)+v.halfW<=r.edge(v.s),`whole car on road at ${s}`);
    assert.ok(Math.abs(v.y-r.point(v.s,v.u).y)<1e-6,'reset uses the road plane, not the DEM');
    assert.equal(v._network,false,'side-road contact cannot survive a tow');
    const f=r.contactFrame(v.s,v.u,{});assert.ok((-Math.sin(v.yaw)*f.tx-Math.cos(v.yaw)*f.tz)*dir>.999);
    const placedS=v.s;ground.resolve(v,1/60);
    assert.ok(Math.abs(v.s-placedS)<.35,'first live step retains the recovery leg');
    assert.ok(Math.abs(v.u)+v.halfW<r.edge(v.s)+.05,'first real ground step stays on the road');
    assert.ok(Math.abs(v.y-r.surfaceY(v.s,v.u))<.05,'ground agrees with reset surface');samples++;
  }
  // These exercise the main-game path absent from the old helper-only tests.
  v.reset(200,r.edge(200)+15);let h=recoveryHarness(r,v,{safe:180,checkpoint:150});h.tow(v);await h.flush();assert.ok(v.s<=147);
  v.reset(200,20);h=recoveryHarness(r,v,{safe:180,checkpoint:150});h.tow(v,{reset:true});await h.flush();assert.ok(v.s<=147);
  v.reset(200,20);h=recoveryHarness(r,v,{online:true,safe:180,serverS:120});h.tow(v);await h.flush();assert.equal(v.s,120);assert.equal(h.towOffer.hold,.25);
  v.reset(200,20);h=recoveryHarness(r,v);h.backOnRoad(v,{s:NaN});assert.ok([v.x,v.y,v.z,v.s].every(Number.isFinite),'invalid anchor is repaired before reset');
  if(r.closed)for(const dir of [-1,1]){
    const earned=r.length+1000,anchor=dir*earned;
    v.reset(anchor-dir*r.length,r.edge(anchor)+15);v.bodyDynamic=true;
    h=recoveryHarness(r,v,{dir,safe:anchor,earned});h.tow(v);h.tow(v);await h.flush();
    assert.ok((v.s-anchor)*dir<=.01&&Math.abs(v.s-anchor)<=80,'wrong-lap projection cannot cause a massive backward tow or a forward gift');
    assert.equal(h.G.pen,0,'solo tow has no stacked time penalty');assert.equal(h.towOffer.hold,0);
    assert.equal(v.bodyDynamic,false);assert.equal(v.sus.fresh,true);
    h.tow(v,{automatic:true});assert.equal(h.G.towing,false,'rearm rejects an immediate repeat');
  }
  t.diagnostic(`${samples} production tow/reset samples, plus checkpoint, MP and invalid-anchor cases`);
});
