// Free asphalt pad: actual Vehicle inputs/forces, no walls, heading resets or injected yaw.
import './register.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const source = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const cars = Function('return ' + source.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
const DT=1/60, DEG=180/Math.PI, G=9.81;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const route={frame(s,o){return Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:0,bank:0});},point:(s,u)=>({x:u,y:0,z:-s}),y:()=>0,surfaceY:()=>0,urban:()=>1,edge:()=>900,lin:()=>0,project:(x,z)=>({s:-z,u:x})};
const beta=v=>Math.atan2(v.vLat,Math.max(2,Math.abs(v.vLong)));
function vehicle(car,kmh,aids=false,gear=1){
 const spec=cars.find(c=>c.id===car),v=new Vehicle(aids?spec:{...spec,tc:0,esc:0,edl:0},route);
 v.reset(0,0,kmh/3.6);v.manual=true;v.gear=gear;v.steerAssist=1;v.roadZ=()=>0;
 v.ground={resolve(v){v.s=-v.z;v.u=v.x;v.y=0;v.offroad=0;v.surfMu=1;}};return v;
}
const state=(v,t,input)=>({t,yaw:v.yaw,w:v.w,beta:beta(v)*DEG,kmh:v.speed*3.6,vLong:v.vLong,vLat:v.vLat,ayG:v.ayRaw/G,tc:v.tcCut,esc:v.escCut,latch:v.driftLatch,steer:v.steer,input,x:v.x,z:v.z});
export function spin({car='carrera',kmh=30,aids=false,handbrake=0,preload=0,seconds=16}={}){
 const v=vehicle(car,kmh,aids),start=v.yaw,trace=[];let run=0,best=0;
 for(let i=0;i<seconds/DT;i++){
  const t=i*DT,input={throttle:t<preload?.3:t<preload+handbrake?0:1,brake:0,steer:1,handbrake:t>=preload&&t<preload+handbrake};v.update(DT,input);
  run=v.w>1?run+DT:0;best=Math.max(best,run);trace.push(state(v,t,input));
 }
 return{car,kmh,aids,handbrake,seconds,headingDeg:(start-v.yaw)*DEG,continuousYawSeconds:best,maxCut:Math.max(...trace.map(t=>t.tc)),maxESC:Math.max(...trace.map(t=>t.esc)),trace};
}
function handbrakeEntry(car){const v=vehicle(car,70,false,2);for(let i=0;i<24;i++)v.update(DT,{throttle:0,brake:0,steer:.6,handbrake:i<21});return v;}
export function driftHold(car='carrera'){
 const v=handbrakeEntry(car),side=Math.sign(beta(v))||-1,target=40/DEG,baseThrottle=car==='carrera'?.7:car==='z4'?.5:.9, gain=car==='carrera'?3:4,trace=[];let run=0,best=0;
 for(let i=0;i<8/DT;i++){
  const error=beta(v)*side-target,input={steer:clamp(side*gain*error-.5*v.w,-1,1),throttle:clamp(baseThrottle-.6*Math.max(0,error),.2,1),brake:0};
  v.update(DT,input);const b=beta(v)*side*DEG;run=b>=30&&b<=50&&v.speed*3.6>20?run+DT:0;best=Math.max(best,run);trace.push(state(v,i*DT,input));
 }
 return{car,targetDeg:40,continuousHoldSeconds:best,trace};
}
export function recover(car='carrera'){
 // A specified, mechanically consistent 45° slide; no state injection after the clock starts.
 const v=vehicle(car,60,false,2),side=-1,trace=[];
 v.vLong=60/3.6*Math.cos(Math.PI/4);v.vLat=-60/3.6*Math.sin(Math.PI/4);v.w=.5;v.steer=-.5;v.driftLatch=1;
 const angle=v.steer;
 for(let i=0;i<4;i++){
  const x=v.vLong-v.w*v.cy[i],y=v.vLat+v.w*v.cx[i],c=i<2?Math.cos(angle):1,s=i<2?Math.sin(angle):0;
  const gx=x*c+y*s,gy=-x*s+y*c;v.corners[i].vw=gx;v.corners[i].aDyn=Math.atan(gy/Math.max(3,Math.abs(gx)));
 }
 let previous=beta(v),peakG=0,peakWorldG=0,minBeta=90,initialBeta=45;
 for(let i=0;i<=4/DT;i++){
  const t=i*DT,b=beta(v),rate=(b-previous)/DT;previous=b;
  const input={steer:clamp(1.5*b+.5*rate,-1,1),throttle:.7-.55*clamp(t/.8,0,1),brake:0};
  const wx=-Math.sin(v.yaw)*v.vLong+Math.cos(v.yaw)*v.vLat,wz=-Math.cos(v.yaw)*v.vLong-Math.sin(v.yaw)*v.vLat;
  v.update(DT,input);
  peakG=Math.max(peakG,Math.abs(v.ayRaw/G));minBeta=Math.min(minBeta,beta(v)*side*DEG);
  const nx=-Math.sin(v.yaw)*v.vLong+Math.cos(v.yaw)*v.vLat,nz=-Math.cos(v.yaw)*v.vLong-Math.sin(v.yaw)*v.vLat;
  peakWorldG=Math.max(peakWorldG,Math.hypot(nx-wx,nz-wz)/DT/G);trace.push(state(v,t,input));
 }
 return{car,initialBetaDeg:initialBeta,peakLateralG:peakG,peakWorldG,overshootDeg:minBeta,finalBetaDeg:beta(v)*side*DEG,trace};
}
export function lateralCurve(){
 return [10,20,40,60,80,90,100].map(angle=>{
  const v=vehicle('carrera',60,false,2),a=angle/DEG;v.vLong=v.speed*Math.cos(a);v.vLat=-60/3.6*Math.sin(a);v.driftLatch=1;v.shiftT=1;
  for(const c of v.corners){c.vw=v.vLong;c.aDyn=Math.atan(v.vLat/Math.max(3,Math.abs(v.vLong)));}
  v.update(1/240,{throttle:0,steer:0,brake:0});return{angle,lateralG:v.ayRaw/G};
 });
}
export function lowSpeedYawMoment(coast=false){
 const v=vehicle('carrera',8,false),step=1/240;v.vLong=.5;v.vLat=0;v.w=1.2;v.steer=.6;v.driftLatch=1;
 if(coast){v.vLong=v.vLat=0;v.syncWheels();}
 const before=v.w;v.update(step,{throttle:coast?0:1,steer:1,handbrake:true,brake:0});
 let moment=0;
 for(let i=0;i<4;i++){const c=v.corners[i],s=v._S[i],fx=c.Fx*s.c-c.Fy*s.s,fy=c.Fx*s.s+c.Fy*s.c;moment+=v.cx[i]*fy-v.cy[i]*fx;}
 return{burnout:v.burnout,delta:v.w-before,expected:moment/v.Iz*step,frontRolling:Math.abs(v.corners[0].vw)+Math.abs(v.corners[1].vw)};
}
export function runManeuvers(){
 const results={donuts:[],handbrakeSpins:[],holds:[],recoveries:[],lateralCurve:lateralCurve()};
 for(const car of ['carrera','z4','e36','gtv']){
  for(const kmh of car==='carrera'?[20,30,40]:[30])results.donuts.push(spin({car,kmh}));
  results.holds.push(driftHold(car));results.recoveries.push(recover(car));
 }
 for(const car of ['carrera','z4','e36','gtv','gr_yaris','mini'])for(const aids of [false,true])results.handbrakeSpins.push(spin({car,kmh:car==='mini'?80:60,aids,handbrake:car==='mini'?1.5:.6,seconds:car==='mini'?9.5:8})); // MINI 9.5 s (was 9): with the friction ellipse at a real 4% (was 10%) the aids-on FWD crawl after the slide is ~0.3 s slower; 357.5° at 9 s
 return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const r=runManeuvers(),out=process.argv.find(s=>s.startsWith('--out='))?.slice(6);if(out)writeFileSync(out,JSON.stringify(r,null,2)+'\n');
 for(const d of r.donuts)console.log('donut',d.car,d.kmh,d.headingDeg.toFixed(1),d.continuousYawSeconds.toFixed(2),'TC',d.maxCut.toFixed(3));
 for(const d of r.handbrakeSpins)console.log('HB spin',d.car,d.aids,d.headingDeg.toFixed(1));
 for(const d of r.holds)console.log('hold',d.car,d.continuousHoldSeconds.toFixed(2));
 for(const d of r.recoveries)console.log('recover',d.car,'initial',d.initialBetaDeg?.toFixed(2),'latG',d.peakLateralG.toFixed(3),'worldG',d.peakWorldG.toFixed(3),'overshoot',d.overshootDeg.toFixed(2),'final',d.finalBetaDeg.toFixed(2));
 console.log('lateral curve',r.lateralCurve);
}
