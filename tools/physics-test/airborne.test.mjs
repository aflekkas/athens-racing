import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from '../../src/physics.js';
import { startFlight, bodyQuaternion, angularVelocity } from '../../src/airborne-dynamics.js';
import { catalogue } from './powertrain.mjs';
import { flatAirborneRoute, runAirborneScenario } from './airborne-scenarios.mjs';
const specs=catalogue(),make=id=>{const v=new Vehicle(specs.find(c=>c.id===id),flatAirborneRoute);v.roadZ=()=>0;return v;};
const input={throttle:0,brake:0,steer:0};
for(const name of ['crest','barrier','bus','sports'])test(`airborne: ${name}`,()=>{
  const r=runAirborneScenario(Vehicle,specs,name),{trace,...summary}=r;console.log(JSON.stringify(summary));
  assert.ok(trace.every(p=>[p.x,p.y,p.z,p.yaw,p.vy,p.speed,...p.load].every(Number.isFinite)));
  assert.ok(trace.filter(p=>p.bodyDynamic).every(p=>p.load.every(f=>f===0)),'unsupported tyres exert no force');
  if(name==='crest'){
    assert.ok(r.maxAir>.3&&r.airTime>.2&&r.airTime<2);
    assert.equal(r.final.bodyDynamic,false);assert.equal(r.final.air,0);
    assert.ok(Math.abs(r.final.pose.heave)<.01&&Math.abs(r.final.pose.pitch)<.01&&Math.abs(r.final.pose.roll)<.01);
  }
  if(name==='barrier'){assert.ok(r.maxAir>.5&&r.maxRoll>.7);assert.ok(r.maxHeight<12&&r.final.speed<4);}
  if(name==='bus'){assert.ok(r.maxRoll>Math.PI*.48);assert.equal(r.final.bodyDynamic,true);assert.ok(r.final.speed<.2);}
  if(name==='sports'){assert.ok(r.maxRoll<.5);assert.equal(r.final.bodyDynamic,false);}
});
test('parked flat car remains still without hopping',()=>{
  for(const id of ['carrera','bus','van']){
    const v=make(id);v.reset(0,0);let peak=0;
    for(let i=0;i<600;i++){v.update(1/60,{...input,brake:.2,handbrake:true});peak=Math.max(peak,Math.abs(v.y),Math.abs(v.pose.heave));}
    assert.ok(Math.hypot(v.x,v.z)<.001&&peak<.001,`${id}: no drift or hop`);assert.equal(v.bodyDynamic,false);
  }
});
test('free flight conserves world angular momentum, falls under gravity and ignores tyre inputs',()=>{
  const v=make('carrera');v.reset(0,0,20);v.y=20;startFlight(v);v.rigid.L=[1300,500,800];
  const momentum=v.rigid.L.slice(),cy=v.rigid.cy;let force=0;
  for(let i=0;i<60;i++){
    v.update(1/60,{throttle:1,brake:0,steer:i<30?1:-1});
    force=Math.max(force,...v.corners.flatMap(c=>[Math.abs(c.Fx),Math.abs(c.Fy),Math.abs(c.Fz)]));
  }
  assert.deepEqual(v.rigid.L,momentum);assert.equal(force,0);
  assert.ok(Math.abs(v.rigid.cy-(cy-4.905))<.04);assert.ok(Math.abs(v.vy+9.81)<.01);
  assert.ok(Math.abs(Math.hypot(...v.rigid.q)-1)<1e-12);
  assert.ok(angularVelocity(v).every(Number.isFinite));
});
test('springs never pull the road, including commercial droop stops',()=>{
  const v=make('bus');v.settleSuspension([0,0,0,0]);v.sus.z=.5;v.sus.zv=3;
  for(let i=0;i<100;i++){
    v.stepSuspension(1/240,0,0,1,[0,0,0,0],20);
    assert.ok(v._Fs.every((f,j)=>f+v.Fs0[j]>=-1e-9));assert.ok(v.corners.every(c=>c.Fz>=0));
  }
});
test('fast roof-first fall cannot tunnel through flat terrain',()=>{
  const v=make('bus');v.reset(0,0);v.y=5;startFlight(v);v.rigid.q=bodyQuaternion(0,0,Math.PI);v.vy=-50;
  let minimum=Infinity;
  for(let i=0;i<300;i++){v.update(1/60,input);minimum=Math.min(minimum,v.y);}
  assert.ok(minimum>=0&&Number.isFinite(v.y));assert.ok(v.speed<.2);
});
