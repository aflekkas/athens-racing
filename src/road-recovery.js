// Recovery uses a drivable carriageway centre, never a verge or a divided-road median.
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export function roadCentreU(route,s,dir=1) {
  return route.closed ? 0 : Math.sign(dir || 1) * ((route.medHalf?.(s) || 0) + route.edge(s)) / 2;
}
export function roadRecoveryPose(route,vehicle,dir=1,station=null) {
  let s = Number.isFinite(station) ? station : route.project(vehicle.x,vehicle.z,null).s;
  if (!Number.isFinite(s)) s = Number.isFinite(vehicle.s) ? vehicle.s : 0;
  if (!route.closed) s = clamp(s,0,route.length);
  const requested=s;
  // Ground.resolve reprojects with a six-sample window on the first live step.
  // A narrow, folded hairpin can put an inner-lane pose on the neighbouring
  // leg. Retreat in race direction until the same production projection keeps
  // the car on its own leg. Recovery never gifts forward progress.
  for(let back=0;back<=80;back+=2) {
    s=requested-Math.sign(dir||1)*back;
    if(!route.closed)s=clamp(s,0,route.length);
    const u=roadCentreU(route,s,dir),p=route.point(s,u),q=route.project(p.x,p.z,s,6);
    if(Math.abs(q.s-s)>.35||Math.abs(q.u-u)>.15)continue;
    const f=route.contactFrame?.(s,u,{})||route.frame(s,{});
    return {s,u,yaw:Math.atan2(-f.tx,-f.tz)+(dir<0?Math.PI:0)};
  }
  const u=roadCentreU(route,s,dir),f=route.contactFrame?.(s,u,{})||route.frame(s,{});
  return {s,u,yaw:Math.atan2(-f.tx,-f.tz)+(dir<0?Math.PI:0)};
}
