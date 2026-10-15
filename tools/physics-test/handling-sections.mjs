import './register.mjs';
import {writeFileSync} from 'node:fs';
import {CARS} from './handling.mjs';
import {routes,driveCorner} from './driver-feel.mjs';
import {tightBends} from './route-corners.mjs';
const {route}=routes.find(r=>r.def.id==='megara');
const bends=[];
for(const b of tightBends(route).sort((a,b)=>a.radius-b.radius))if(bends.every(x=>Math.abs(x.s-b.s)>50))bends.push(b);
const rows=[];
for(const id of ['huracan','carrera','e36_m3','golf_gti','mini','superb_4x4']){
 const spec=CARS.find(c=>c.id===id);
 for(const bend of bends.slice(0,6))for(const device of ['keyboard','gamepad']){
  const kmh=Math.min(60,Math.sqrt(bend.radius*spec.grip*9.81*.8)*3.6);
  const r=driveCorner(spec,route,kmh,{bend,device,seconds:1.5});
  rows.push({id,device,s:bend.s,radius:bend.radius,kmh,yaw90:r.yaw90,g:r.achievedG,frontOverPeakFrames:r.trace.filter(t=>t.frontWheels.some(w=>Math.abs(w.sy)>1.15)).length,maxBeta:Math.max(...r.trace.map(t=>Math.abs(t.betaDeg)))});
 }
}
writeFileSync(process.argv[2],JSON.stringify({method:'six tight geometric sections separated by50m; feasible entry .8*catalogue gripG capped60kmh; full request through actual Input, dry continuation; not a lap driver',rows},null,2));
