// Recovery uses a drivable carriageway centre, never a verge or a divided-road median.
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export function roadCentreU(route,s,dir=1) {
  return route.closed ? 0 : Math.sign(dir || 1) * ((route.medHalf?.(s) || 0) + route.edge(s)) / 2;
}
export function roadRecoveryPose(route,vehicle,dir=1,station=null) {
  let s = Number.isFinite(station) ? station : route.project(vehicle.x,vehicle.z,null).s;
  if (!Number.isFinite(s)) s = Number.isFinite(vehicle.s) ? vehicle.s : 0;
  if (!route.closed) s = clamp(s,0,route.length);
  const u = roadCentreU(route,s,dir);
  const f = route.contactFrame?.(s,u,{}) || route.frame(s,{});
  return {s,u,yaw:Math.atan2(-f.tx,-f.tz)+(dir<0?Math.PI:0)};
}
