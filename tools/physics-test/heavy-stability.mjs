// Production suspension, every catalogue configuration, dry level support plane.
// Deterministic prescribed accelerations isolate vertical dynamics from steering/engine tuning.
import {catalogue,flatRoute} from './powertrain.mjs';
import {Vehicle} from '../../src/physics.js';
export function stabilityScenarios(specs=catalogue(),VehicleClass=Vehicle,{cruise=true,traces=false}={}){
 const rows=[],dt=1/240,G=9.81,zero=[0,0,0,0];
 for(const sp of specs){
  const make=()=>{const v=new VehicleClass(sp,flatRoute);v.settleSuspension(zero);return v;};
  const record=(v,t)=>({t,pitch:v.pose.pitch,roll:v.pose.roll,heave:v.pose.heave,compression:v.sus.d.slice(),tyreCompression:v.sus.r.map((r,i)=>r-v.sus.zu[i]),load:v.sus.Ft.slice(),contact:v.sus.Ft.map(f=>f>1)});
  const v=make();v.sus.z=.06;v.sus.th=.01;v.sus.ph=.02;let first=[0,0,0],late=[0,0,0],trace=[];
  for(let i=0;i<4/dt;i++){
   v.stepSuspension(dt,0,0,1,zero,0);const p=[v.pose.heave,v.pose.pitch,v.pose.roll];
   for(let j=0;j<3;j++){if(i*dt<.5)first[j]=Math.max(first[j],Math.abs(p[j]));if(i*dt>=2&&i*dt<2.5)late[j]=Math.max(late[j],Math.abs(p[j]));}
   if(traces&&i%4===0)trace.push(record(v,i*dt));
  }
  rows.push({id:sp.id,type:'drop',ratios:late.map((x,j)=>x/first[j]),ok:late.every((x,j)=>x<first[j]*.1),...(traces?{trace}:{})});
  for(const type of ['step-steer','lane-change','kerb','brake']){
   const c=make();let roll=0,pitch=0,travel=0,minLoad=Infinity,lastLoad=Infinity,peakAy=0,lostRun=0,maxLost=0;trace=[];
   for(let i=0;i<6/dt;i++){
    const t=i*dt,ay=type==='step-steer'?(t>=.5&&t<3?G*.3:0):type==='lane-change'?(t>=.5&&t<3.5?G*.25*Math.sin((t-.5)*Math.PI*2/3):0):0;
    const ax=type==='brake'&&t>=.5&&t<2.5?-G*.6:0;
    // A 80 mm raised kerb at 25 km/h, front then rear with the actual wheelbase delay.
    const step=t0=>t>=t0&&t<t0+.35?.08:0;
    const road=type==='kerb'?[0,step(.5),0,step(.5+sp.wheelbase/(25/3.6))]:zero;
    c.stepSuspension(dt,ax,ay,1,road,25/3.6);
    roll=Math.max(roll,Math.abs(c.pose.roll)*180/Math.PI);pitch=Math.max(pitch,Math.abs(c.pose.pitch)*180/Math.PI);travel=Math.max(travel,...c.sus.d.map(Math.abs));
    lostRun=c.corners.some(w=>w.Fz<=1)?lostRun+dt:0;maxLost=Math.max(maxLost,lostRun);
    minLoad=Math.min(minLoad,...c.corners.map((w,j)=>w.Fz/c.Ft0[j]));if(t>5)lastLoad=Math.min(lastLoad,...c.corners.map((w,j)=>w.Fz/c.Ft0[j]));peakAy=Math.max(peakAy,Math.abs(ay));
    if(traces&&i%4===0)trace.push(record(c,t));
   }
   const settled=Math.max(Math.abs(c.pose.heave),Math.abs(c.pose.roll),Math.abs(c.pose.pitch))<.005;
   rows.push({id:sp.id,type,roll,pitch,travel,minLoad,lastLoad,peakAy,maxLost,ok:Number.isFinite(roll+pitch+travel)&&roll<8&&pitch<8&&travel<.25&&settled&&(type==='kerb'?lastLoad>.8&&maxLost<.25:minLoad>.02),...(traces?{trace}:{})});
  }
  if(sp.rollDamping){
   const c=make();c.bodyKick(-.6,.05,.1);let peak=0;
   for(let i=0;i<90;i++){
    c.stepSuspension(1/15,0,i<30?G*.3:0,1,zero,20);
    peak=Math.max(peak,Math.abs(c.pose.heave),Math.abs(c.pose.pitch),Math.abs(c.pose.roll));
   }
   rows.push({id:sp.id,type:'coarse-step',peak,ok:Number.isFinite(peak)&&peak<.2&&Math.abs(c.pose.roll)<.001});
   const stop=make();stop.bodyKick(-2.5);let bump=0,droop=0;
   for(let i=0;i<6/dt;i++){
    stop.stepSuspension(dt,0,0,1,zero,10);bump=Math.max(bump,...stop.sus.d);droop=Math.min(droop,...stop.sus.d);
   }
   const hang=make();hang.bodyKick(2.5);let maxDroop=0;
   for(let i=0;i<6/dt;i++){
    hang.stepSuspension(dt,0,0,1,zero,10);maxDroop=Math.min(maxDroop,...hang.sus.d);
   }
   rows.push({id:sp.id,type:'bump-stop',bump,droop,maxDroop,ok:Number.isFinite(bump+droop+maxDroop)&&bump>stop.travel&&bump<stop.travel+.06&&droop>-sp.droop-.06&&maxDroop<-sp.droop&&maxDroop>-sp.droop-.02&&Math.abs(stop.pose.heave)<.001&&Math.abs(hang.pose.heave)<.001});

  }
  // Also exercise the complete tyre/steering/load-transfer feedback loop.
  for(const type of ['driven-step-steer','driven-lane-change','driven-brake']){
   const c=make(),speed=60/3.6;c.reset(0,0,speed);c.gear=Math.min(3,sp.gears.length);c.steerAssist=0;c.syncWheels();c.roadZ=()=>0;
   let roll=0,pitch=0,minLoad=Infinity;
   for(let i=0;i<6*60;i++){
    const t=i/60,targetAy=type==='driven-step-steer'?(t>.5&&t<3?G*.25:0):type==='driven-lane-change'?(t>.5&&t<3.5?G*.25*Math.sin((t-.5)*Math.PI*2/3):0):0;
    const steer=c.steerInputFor(targetAy/Math.max(25,c.speed**2),Math.max(5,c.speed));
    c.update(1/60,{throttle:type==='driven-brake'?0:Math.max(0,Math.min(1,.3+(speed-c.speed)*.2)),brake:type==='driven-brake'&&t>.5?1:0,steer});
    roll=Math.max(roll,Math.abs(c.pose.roll)*180/Math.PI);pitch=Math.max(pitch,Math.abs(c.pose.pitch)*180/Math.PI);
    minLoad=Math.min(minLoad,...c.corners.map((w,j)=>w.Fz/c.Ft0[j]));
   }
   rows.push({id:sp.id,type,roll,pitch,minLoad,ok:Number.isFinite(roll+pitch+c.vLong)&&roll<8&&pitch<8&&(type==='driven-brake'||minLoad>.02)});
  }
  if(cruise){
   const c=make();let early=0,lateEnergy=0,maxPose=0,finite=true;
   const energy=()=>{const S=c.sus;let e=.5*c.mSpr*S.zv**2+.5*c.Ixx*S.phv**2+.5*c.Iyy*S.thv**2;
    for(let j=0;j<4;j++)e+=.5*c.mUns*S.zuv[j]**2+.5*c.kSpr[j]*S.d[j]**2+.5*c.kTyre*(S.r[j]-S.zu[j])**2;
    for(let j=0;j<2;j++)e+=.5*c.kBar[j]*(S.d[j*2]-S.d[j*2+1])**2;return e;};
   // Repeatable 20 m road texture at 72 km/h, 2 mm amplitude. Compare equal 10 s windows.
   for(let i=0;i<300/dt;i++){
    const t=i*dt,road=c.cx.map((x,j)=>.002*Math.sin(2*Math.PI*(t+x/20))+.001*Math.sin(4*Math.PI*t+j*Math.PI));
    c.stepSuspension(dt,0,0,1,road,20);const e=energy();if(t>=10&&t<20)early=Math.max(early,e);if(t>=290)lateEnergy=Math.max(lateEnergy,e);
    maxPose=Math.max(maxPose,Math.abs(c.pose.heave),Math.abs(c.pose.roll),Math.abs(c.pose.pitch));if(!Number.isFinite(e)){finite=false;break;}
   }
   rows.push({id:sp.id,type:'cruise300s',early,lateEnergy,maxPose,ok:finite&&lateEnergy<=early*1.02+1e-9&&maxPose<.03});
   // End-to-end 5 minute powered cruise. Ideal smooth asphalt isolates solver
   // energy from random road texture; the powertrain/load-transfer loop stays live.
   const driven=make();driven.reset(0,0,72/3.6);driven.gear=Math.min(3,sp.gears.length);driven.syncWheels();driven.roadZ=()=>0;
   let firstEnergy=0,lastEnergy=0,peak=0;
   const kinetic=()=>{const S=driven.sus;return .5*driven.mSpr*S.zv**2+.5*driven.Ixx*S.phv**2+.5*driven.Iyy*S.thv**2+S.zuv.reduce((e,v)=>e+.5*driven.mUns*v*v,0);};
   for(let i=0;i<300*60;i++){
    driven.update(1/60,{throttle:Math.max(0,Math.min(1,.25+(20-driven.speed)*.25)),brake:0,steer:0});
    const e=kinetic(),t=i/60;if(t>=30&&t<60)firstEnergy=Math.max(firstEnergy,e);if(t>=270)lastEnergy=Math.max(lastEnergy,e);
    peak=Math.max(peak,Math.abs(driven.pose.heave),Math.abs(driven.pose.pitch),Math.abs(driven.pose.roll));
   }
   rows.push({id:sp.id,type:'driven-cruise300s',firstEnergy,lastEnergy,peak,speed:driven.kmh,ok:Number.isFinite(lastEnergy+driven.vLong)&&lastEnergy<=firstEnergy*1.25+.02&&peak<.15&&driven.kmh>50&&driven.kmh<82});
  }
 }
 return rows;
}
if(process.argv[1]?.endsWith('/heavy-stability.mjs')){
 const rows=stabilityScenarios();console.log(JSON.stringify(rows,null,2));if(rows.some(r=>!r.ok))process.exitCode=1;
}
