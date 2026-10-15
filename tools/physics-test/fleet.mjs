// Production Vehicle, sourced fleet drivetrains, flat dry road. Also imported by regress.mjs.
import {catalogue,flatRoute} from './powertrain.mjs';
import {Vehicle} from '../../src/physics.js';
export function fleetScenarios(){
 const rows=[],dt=1/60;
 for(const spec of catalogue().filter(c=>c.nativeFleet)){
  const v=new Vehicle(spec,flatRoute);v.reset(0,0,0);let sprint=null;
  const target=Math.min(100,spec.vmax*.7);
  for(let i=0;i<120*60;i++){v.update(dt,{throttle:1,brake:0,steer:0});if(sprint===null&&v.kmh>=target)sprint=(i+1)*dt;}
  const b=new Vehicle(spec,flatRoute),startSpeed=Math.min(80,spec.vmax*.8);b.reset(0,0,startSpeed/3.6);b.gear=spec.gears.length;const z=b.z;
  for(let i=0;i<900&&b.kmh>.3;i++)b.update(dt,{throttle:0,brake:1,steer:0});
  rows.push({id:spec.id,type:'drive',finite:[v.x,v.z,v.rpm,v.vLong,b.vLong].every(Number.isFinite),target,sprint,top:v.kmh,vmax:spec.vmax,stopSpeed:b.kmh,brakeStart:startSpeed,stopDistance:Math.abs(b.z-z)});
  if(['bus','van','van_150','truck'].includes(spec.id)){
   const c=new Vehicle(spec,flatRoute);c.reset(0,0,35/3.6);c.gear=Math.min(2,spec.gears.length);let roll=0,beta=0,minLoad=Infinity;
   for(let i=0;i<300;i++){
    c.update(dt,{throttle:.25,brake:0,steer:.12});
    roll=Math.max(roll,Math.abs(c.pose.roll));beta=Math.max(beta,Math.abs(Math.atan2(c.vLat,Math.max(2,Math.abs(c.vLong)))));
    minLoad=Math.min(minLoad,...c.corners.map(w=>w.Fz/(spec.mass*9.81)));
   }
   rows.push({id:spec.id,type:'gentle',roll,beta,minLoad,finite:[c.x,c.z,c.pose.roll].every(Number.isFinite)});
  }
 }
 return rows;
}
if(process.argv[1]?.endsWith('/fleet.mjs'))console.log(JSON.stringify(fleetScenarios(),null,2));
