// Reproducible handling audit. PHYS selects a saved baseline Vehicle module.
import './register.mjs';
import { writeFileSync } from 'node:fs';
import { CARS, skidpad, route as flat } from './handling.mjs';
import { routes, driveCorner } from './driver-feel.mjs';
import { tightBends } from './route-corners.mjs';
import { RivalAI } from '../../src/rival-ai.js';
import { Input } from '../../src/input.js';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const ids=['huracan','carrera','e36_m3','golf_gti','mini','superb_4x4'];
const dt=1/60, mean=a=>a.reduce((s,n)=>s+n,0)/a.length;
const {route}=routes.find(r=>r.def.id==='megara');
const bends=tightBends(route);
function sweep(spec,kmh){
 let best={g:0};
 for(const input of [.4,.6,.8,1]){
  const v=new Vehicle(spec,flat);v.reset(0,0,kmh/3.6);v.manual=true;v.gear=spec.gears.findIndex(g=>kmh/3.6/spec.wheelR*g*spec.final*30/Math.PI<spec.redline*.7)+1;
  v.roadZ=()=>0;
  // Speed clamp isolates lateral capacity; no extra drive/brake force.
  const rows=[];
  for(let i=0;i<240;i++){v.update(dt,{throttle:.15,brake:0,steer:input});v.vLong=kmh/3.6;if(i>180)rows.push({g:Math.abs(v.ayRaw)/9.81,f:Math.abs(v.wheel[0].sy)});}
  const g=mean(rows.map(r=>r.g));if(g>best.g)best={g,frontSlip:mean(rows.map(r=>r.f)),input};
 }
 return best;
}
function lap(spec,device){
 const v=new Vehicle(spec,route);v.steerAssist=device==='keyboard'?1:.35;v.reset(route.start,0,0);
 const ai=new RivalAI(route,v,{perfect:true,closedRoad:true});
 const controls=new Input({target:null,navigator:null,document:null,storage:null});
 // CPU dry continuation: actual geometry/grade/bank; report departures rather
 // than hiding the steering failure with wall bounces. Browser checks real Ground.
 v.ground={resolve(v){const p=route.project(v.x,v.z,v.s,6);v.s=p.s;v.u=p.u;v.y=route.surfaceY(p.s,p.u);v.offroad=Math.abs(p.u)>route.edge(p.s)-v.halfW?1:0;v.surfMu=1;}};
 let progress=0,prev=v.s,offroad=0,wall=0;const trace=[];
 for(let i=0;i<300/dt;i++){
  const inp=ai.update(dt);
  if(device==='keyboard'){
   const error=inp.steer-controls.state.steer;
   controls.keys.delete('KeyA');controls.keys.delete('KeyD');
   if(Math.abs(error)>.075)controls.keys.add(error>0?'KeyD':'KeyA');
   controls.update(dt,{speed:v.speed});inp.steer=controls.state.steer;
  }
  v.update(dt,inp);let d=v.s-prev;if(d<-route.length/2)d+=route.length;if(d>route.length/2)d-=route.length;progress+=d;prev=v.s;
  offroad+=v.offroad;wall+=v.wallHit>0?1:0;
  trace.push({t:(i+1)*dt,s:v.s,u:v.u,kmh:v.kmh,x:v.x,z:v.z,yaw:v.yaw,steer:inp.steer});
  if(progress>=route.length)break;
 }
 controls.destroy();
 return {device,finished:progress>=route.length,time:trace.length*dt,offroadFrames:offroad,wallFrames:wall,wallModel:'disabled CPU dry continuation; see browser evidence',minCornerSpeeds:bends.map(b=>({s:b.s,radius:b.radius,kmh:Math.min(...trace.filter(r=>Math.abs(r.s-b.s)<10).map(r=>r.kmh))})),trace};
}
const rows=[];
for(const id of ids){
 const spec=CARS.find(c=>c.id===id),sk=skidpad(spec);
 const transients=['keyboard','gamepad'].map(device=>{
  const r=driveCorner(spec,route,60,{device,seconds:3});
  const peak=r.trace.reduce((a,b)=>a.yawRate>b.yawRate?a:b);
  return {device,yaw90:r.yaw90,timeToPeakYaw:peak.t,frontPastPeakFrames:r.trace.filter(t=>t.frontWheels.some(w=>Math.abs(w.sy)>1)).length,frontBeyond115Frames:r.trace.filter(t=>t.frontWheels.some(w=>Math.abs(w.sy)>1.15)).length,g:r.achievedG,trace:r.trace};
 });
 const row={id,understeerDegPerG:sk.K,skidpadG:sk.maxG,capacity:[60,100,150].map(kmh=>({kmh,...sweep(spec,kmh)})),transients};rows.push(row);console.log(id,JSON.stringify({...row,transients:transients.map(({trace,...r})=>r)}));
}
const laps=['keyboard','gamepad'].map(device=>lap(CARS.find(c=>c.id==='huracan'),device));
const out=process.argv[2];writeFileSync(out,JSON.stringify({method:'skidpad existing R40 ramp fit 0.1-0.5g; capacity fixed longitudinal speed sweep .4/.6/.8/1 over4s last1s; turn-in actual Input at60kmh, yaw90 of1-1.5s mean; timeToPeak over3s. Lap perfect RivalAI pedals/line with binary steering error controller through actual Input, gamepad continuous .35 assist; dry continuation omits walls/loose ground.',rows,laps},null,2));console.log(laps.map(({trace,...r})=>r));
