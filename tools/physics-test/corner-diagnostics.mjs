// Isolate chassis/contact causes on the actual routes; no extra grip or yaw.
import './register.mjs';
import { writeFileSync } from 'node:fs';
import { CARS, routes, driveCorner } from './driver-feel.mjs';
import { geometricBend, powerSummary } from './route-corners.mjs';
const results=[];
for(const {def,route} of routes.filter(r=>r.def.id!=='megara'))for(const spec of CARS)for(const s of (def.id==='riviera'?[1483,1577,9447]:[740,1106,5748]))for(const kmh of [60,70]) {
  const bend=geometricBend(route,s);
  for(const variant of ['stock','double-bump-travel','no-texture','lower-CG','raised-CG','zero-camber']) {
    const chassis={...spec,...(variant==='double-bump-travel'?{travel:.15}:variant==='lower-CG'?{hcg:(spec.hcg??.5)-.15}:variant==='raised-CG'?{hcg:(spec.hcg??.5)+.15}:{})};
    const oldBank=route.bank;
    if(variant==='zero-camber')route.bank=()=>0;
    const r=driveCorner(chassis,route,kmh,{bend,gear:2,throttle:1,seconds:2,texture:variant!=='no-texture'});
    route.bank=oldBank;
    results.push({map:def.id,car:spec.id,s,kmh,variant,geometricRadius:bend.geometricRadius,smoothedRadius:bend.smoothedRadius,hcg:chassis.hcg,travelLimit:chassis.travel??.075,...powerSummary(r,.75,1.25)});
  }
}
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
if(out)writeFileSync(out,JSON.stringify({method:'real route, actual lane geometry, 60/70kmh gear2 full W+steer; summary0.75-1.25s; CG height is the physics ride-height proxy, visual body clearance is not a force input',results},null,2)+'\n');
for(const r of results.filter(r=>r.car==='carrera'&&r.kmh===60))console.log(`${r.map} s${r.s} ${r.variant}: R ${r.pathRadius.toFixed(1)}/${r.geometricRadius.toFixed(1)}m, travel ${(r.maxTravel*1000).toFixed(1)}mm, bottom ${r.bottomFrames}, gEff ${r.minGravity.toFixed(3)}, toe ${r.maxToe}`);
