import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ragdoll, RagdollPool } from '../src/impact-ragdoll.js';
import { RagdollClient } from '../src/ragdoll-client.js';
import { snapshotBody } from '../src/ragdoll-snapshot.js';
import { nodeWorker, waitForIdle } from './ragdoll-worker-harness.mjs';
const ground=(x,z,b)=>{b.groundS=(b.groundS??0)+.01;return .01*x+.02*Math.sin(z);};
const launch={x:0,y:1,z:0,s:0,vx:15,vz:6,seed:4};
test('real transferable worker matches every Float64 and scalar over changing dt, terrain, car contacts and sleep',async()=>{
 for(const car of [null,{veh:{x:0,y:0,z:0,yaw:.3,vLong:2,vLat:0},halfL:2.2,halfW:.9,height:1.4},{x:0,y:0,z:0,yaw:.3,halfL:2.2,halfW:.9,height:1.4,vx:2,vz:1}]){
  const direct=new Ragdoll().launch({...launch,car:car&&{...car}}),remote=new Ragdoll().launch({...launch,car:car&&{...car}}),client=new RagdollClient(ground,nodeWorker);
  try {for(let frame=0;frame<240;frame++){
   if(car?.veh){car.veh.x+=.01;car.veh.yaw+=.001;}
   const dt=[1/120,1/60,1/30,.001][frame%4];direct.update(dt,ground);client.advance(remote,dt);await waitForIdle(client);
   assert.deepEqual(snapshotBody(remote),snapshotBody(direct),'frame '+frame);
  }}finally{client.clear();}
 }
});
test('queue overflow and worker error replay every unacknowledged step exactly',()=>{
 for(const failure of ['overflow','error']){
  const direct=new Ragdoll().launch(launch),remote=new Ragdoll().launch(launch),fake={postMessage(){},terminate(){},onmessage:null,onerror:null},client=new RagdollClient(ground,()=>fake);
  const count=failure==='overflow'?5:3;
  for(let i=0;i<count;i++){direct.update(1/60,ground);client.advance(remote,1/60);}
  if(failure==='error')fake.onerror({preventDefault(){}});
  assert.equal(client.disabled,true);assert.deepEqual(snapshotBody(remote),snapshotBody(direct));
 }
});
test('reset rejects stale worker replies and interpolation never changes authoritative state',async()=>{
 const b=new Ragdoll().launch(launch),client=new RagdollClient(ground,nodeWorker);
 try{client.advance(b,1/60);const stale=[...client.jobs.keys()][0];client.reset(b);b.launch({...launch,x:100});client.receive({type:'done',id:stale,state:{}});assert.equal(b.p[0],100);
 client.advance(b,1/60);await waitForIdle(client);const before=snapshotBody(b),p=client.positions(b);assert.equal(p.length,48);assert.deepEqual(snapshotBody(b),before);
 }finally{client.clear();}
});
test('unavailable workers keep synchronous behavior and replicated riders never leave main thread',()=>{
 const a=new Ragdoll().launch({...launch,kind:'rider'}),b=new Ragdoll().launch({...launch,kind:'rider'}),client=new RagdollClient(ground,()=>{throw Error('blocked');});a.update(1/60,ground);client.advance(b,1/60);assert.deepEqual(snapshotBody(a),snapshotBody(b));
 b.launch(launch);a.launch(launch);a.update(1/60,ground);client.advance(b,1/60);assert.deepEqual(snapshotBody(a),snapshotBody(b));assert.equal(client.disabled,true);
});

test('a new impact catches up pending bodies before deterministic pool eviction',()=>{
 const source=readFileSync(new URL('../src/impact-ragdoll-view.js',import.meta.url),'utf8');
 const spawn=source.match(/ spawn\(o\)\{[\s\S]*?\n \}/)[0];
 const View=Function('RagdollPool','return class extends RagdollPool {release(){}'+spawn+'}')(RagdollPool);
 const view=new View(),reference=new RagdollPool(),fake={postMessage(){},terminate(){}};
 view.workerSim=new RagdollClient(()=>0,()=>fake);
 for(const b of view.bodies){b.pedRig=b.rig={mesh:{visible:false}};b.pedLook={};b.helmet={};}
 for(let i=0;i<3;i++){view.spawn({...launch,x:i});reference.spawn({...launch,x:i});}
 for(let i=0;i<3;i++){const dt=i===0?1/30:1/60;view.workerSim.advance(view.bodies[i],dt);reference.bodies[i].update(dt,()=>0);}
 view.spawn({...launch,x:20});reference.spawn({...launch,x:20});
 assert.equal(view.workerSim.disabled,true);
 assert.deepEqual(view.bodies.map(b=>snapshotBody(b)),reference.bodies.map(b=>snapshotBody(b)));
});
