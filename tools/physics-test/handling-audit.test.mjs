import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARS, route } from './handling.mjs';
import { driveCorner, routes } from './driver-feel.mjs';
import { Vehicle } from '../../src/physics.js';
const ids=['huracan','carrera','e36_m3','golf_gti','mini','superb_4x4'];
test('full gamepad request stays within useful front slip on Megara without a drift latch',()=>{
 const megara=routes.find(r=>r.def.id==='megara').route;
 for(const id of ids){
  const r=driveCorner(CARS.find(c=>c.id===id),megara,60,{device:'gamepad'});
  assert.ok(r.trace.every(t=>t.driftLatch===0),id);
  assert.ok(r.trace.every(t=>t.frontWheels.every(w=>Math.abs(w.sy)<=1.15)),`${id}: front beyond useful slip`);
  assert.ok(r.achievedG>.88,`${id}: planted cornering`);
 }
});
test('AI inverse includes partial-input response and zero-response tuning remains supported',()=>{
 for(const id of ids) for(const steerResponse of [0,.1,.18]){
  const v=new Vehicle({...CARS.find(c=>c.id===id),steerResponse},route);v.vLong=20;v.w=.2;v.vLat=.1;
  const k=.006,ay=400*k,into=Math.atan2(v.vLat+v.a*v.w,20)+v.aPk*(v.spec.steerPk??1);
  const input=v.steerInputFor(k,20),effective=input*(1+steerResponse*(1-input))*into;
  const need=v.wb*k+.45/57.3*ay/9.81;
  assert.ok(Math.abs(effective-need)<1e-10,`${id}: inverse mismatch`);
 }
});

test('handbrake AWD and RWD power-over still hold a physical drift for five seconds',()=>{
 for(const [id,entry] of [['huracan','handbrake'],['e36_m3','power']]){
  const stock=CARS.find(c=>c.id===id),spec=entry==='power'?{...stock,tc:0,esc:0,edl:0}:stock;
  const v=new Vehicle(spec,route),dt=1/60,beta=()=>Math.atan2(v.vLat,Math.max(2,Math.abs(v.vLong)));
  const kmh=entry==='power'?45:70;v.reset(0,0,kmh/3.6);
  for(let i=0;i<90;i++){v.update(dt,{throttle:.25,brake:0,steer:0});v.vLong=kmh/3.6;}
  if(entry==='handbrake')for(let i=0;i<24;i++)v.update(dt,{throttle:0,brake:0,steer:.6,handbrake:i<21});
  else {
   for(let i=0;i<60;i++)v.update(dt,{throttle:.3,brake:0,steer:.55});
   for(let i=0;i<90&&(i<30||Math.abs(beta())<.1);i++)v.update(dt,{throttle:1,brake:0,steer:1});
  }
  const side=Math.sign(beta())||-Math.sign(v.w);let run=0,best=0;
  for(let i=0;i<480;i++){
   const steer=Math.max(-1,Math.min(1,side*3*(beta()*side-.4)-.2*v.w));
   v.update(dt,{throttle:.7,brake:0,steer});
   const b=beta()*side;run=b>=.3&&b<=.6&&v.kmh>20?run+dt:0;best=Math.max(best,run);
  }
  assert.ok(best>=5,`${id} ${entry}: only ${best.toFixed(2)}s sustained`);
 }
});

test('Megara hairpin does not release the slip guard for same-yaw understeer',()=>{
 const megara=routes.find(r=>r.def.id==='megara').route;
 const s=1772.647222987506,radius=10.62414361941502,bend={s,radius,k:megara.curv(s)};
 for(const id of ids)for(const device of ['keyboard','gamepad']){
  const spec=CARS.find(c=>c.id===id),kmh=Math.sqrt(radius*spec.grip*9.81*.8)*3.6;
  const r=driveCorner(spec,megara,kmh,{device,bend,seconds:1.5});
  assert.ok(r.trace.every(t=>t.frontWheels.every(w=>Math.abs(w.sy)<=1.15)),`${id}/${device}: outside front scrub`);
  assert.ok(r.trace.every(t=>t.driftLatch===0),`${id}/${device}: ordinary corner latched drift`);
  assert.ok(r.achievedG>.8,`${id}/${device}: lost useful hairpin grip`);
 }
});
