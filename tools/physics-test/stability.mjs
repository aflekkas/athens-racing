// Repeatable playtest-3 handling probes. Uses the real catalogue; no corrective state changes during a run.
import './register.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const physicsURL = new URL(process.env.PHYS || '../../src/physics.js', import.meta.url);
const { Vehicle } = await import(physicsURL.href);
const { WEATHER } = await import(new URL('./wet-grip.js', physicsURL).href);
const source = readFileSync(new URL(process.env.CATALOG || './cars.js', physicsURL), 'utf8');
const cars = Function('return ' + source.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
export const straightRoad = {
 length: 10000, frame(s,o) { return Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:0,bank:0}); },
 point:(s,u)=>({x:u,z:-s,y:0}), y:()=>0,surfaceY:()=>0,urban:()=>1,edge:()=>900,lin:()=>0,
 project:(x,z)=>({s:-z,u:x}),
};
const DT=1/60, DEG=180/Math.PI, clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const beta=v=>Math.atan2(v.vLat,Math.max(2,Math.abs(v.vLong)));
function car(id,aids,kmh=60,gear=2) {
 const spec=cars.find(c=>c.id===id),v=new Vehicle(aids?spec:{...spec,tc:0,esc:0,edl:0},straightRoad);
 v.reset(100,0,kmh/3.6);v.manual=true;v.gear=gear;v.roadZ=()=>0;v.steerAssist=1;return v;
}
export function stabilityScenarios() {
 const saved={...WEATHER}, rows=[];
 try {
  for(const wet of [false,true]) {
   Object.assign(WEATHER,{wet:wet?1:0,rain:wet?1:0,gripScale:wet?.76:1});
   for(const id of ['huracan','cle','carrera','z4','e36','corolla']) for(const aids of [false,true]) {
    const v=car(id,aids); // Small initial road/driver disturbance, then W with neutral steering.
    v.vLat=.15;v.w=.015;v.syncWheels();let peak=0,cut=0;
    for(let i=0;i<300;i++) {v.update(DT,{throttle:1,brake:0,steer:0});peak=Math.max(peak,Math.abs(beta(v))*DEG);cut=Math.max(cut,v.tcCut);}
    rows.push({scenario:'straight',car:id,wet,aids,peakBeta:peak,finalBeta:beta(v)*DEG,heading:Math.abs(v.yaw)*DEG,offset:Math.abs(v.x),kmh:v.kmh,cut});
   }
   for(const id of ['huracan','carrera','z4','e36']) for(const aids of [false,true]) {
    const v=car(id,aids);let peak=0,entry=0,release=0,cut=0;
    // W+corner input for .8 s, then lift and a simple proportional countersteer.
    for(let i=0;i<300;i++) {
     const b=beta(v), input=i<90?{throttle:1,brake:0,steer:.65}:{throttle:0,brake:0,steer:clamp(2*b-.35*v.w,-1,1)};
     v.update(DT,input);peak=Math.max(peak,Math.abs(beta(v))*DEG);cut=Math.max(cut,v.tcCut);
     if(i===89) {entry=beta(v)*DEG;release=v.driftLatch;}
    }
    rows.push({scenario:'recovery',car:id,wet,aids,peakBeta:peak,entryBeta:entry,entryLatch:release,finalBeta:beta(v)*DEG,latch:v.driftLatch,kmh:v.kmh,cut});
   }
   for(const id of ['huracan','carrera','z4','e36','corolla']) {
    const v=car(id,false,8,1);let peak=0,turn=0;
    for(let i=0;i<600;i++) { // walking-speed full-lock U turn, then unwind/lift after 180 degrees
     if(turn<Math.PI) v.update(DT,{throttle:.15,brake:0,steer:1});
     else v.update(DT,{throttle:0,brake:.15,steer:0});
     turn=Math.max(turn,-v.yaw);peak=Math.max(peak,Math.abs(beta(v))*DEG);
    }
    rows.push({scenario:'uturn',car:id,wet,aids:false,peakBeta:peak,turn:turn*DEG,finalBeta:beta(v)*DEG,yawRate:v.w,kmh:v.kmh,latch:v.driftLatch});
   }
   for(const id of ['huracan','carrera','z4','corolla']) for(const pedal of [1,.5]) {
    const v=car(id,true,100,4),z=v.z;let t=0;
    while(v.kmh>.3&&t<15) {v.update(DT,{throttle:0,brake:pedal,steer:0});t+=DT;}
    rows.push({scenario:pedal===1?'brake':'halfBrake',car:id,wet,distance:Math.abs(v.z-z),seconds:t,kmh:v.kmh});
   }
  }
 } finally {Object.assign(WEATHER,saved);}
 return rows;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const rows=stabilityScenarios(),out=process.argv.find(s=>s.startsWith('--out='))?.slice(6);
 if(out) writeFileSync(out,JSON.stringify(rows,null,2)+'\n');
 console.table(rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='number'?+v.toFixed(2):v]))));
}
