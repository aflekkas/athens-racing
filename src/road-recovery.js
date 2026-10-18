// Recovery uses a drivable carriageway centre, never a verge or a divided-road median.
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export function roadCentreU(route,s,dir=1) {
  return route.closed ? 0 : Math.sign(dir || 1) * ((route.medHalf?.(s) || 0) + route.edge(s)) / 2;
}
export function roadRecoveryPose(route,vehicle,dir=1,station=null,retreat=dir,floor=null) {
  let s = Number.isFinite(station) ? station : route.project(vehicle.x,vehicle.z,null).s;
  if (!Number.isFinite(s)) s = Number.isFinite(vehicle.s) ? vehicle.s : 0;
  if (!route.closed) s = clamp(s,0,route.length);
  const requested=s;
  // Ground.resolve reprojects with a six-sample window on the first live step.
  // A narrow, folded hairpin can put an inner-lane pose on the neighbouring
  // leg. Retreat away from the race direction (`retreat`, default `dir`) until the same production projection keeps
  // the car on its own leg. Recovery never gifts forward progress.
  // `floor` ({ s0, dir, floor }, route progress) forbids retreating before the car's latest valid pose: a hairpin
  // that cannot be cleared by retreating is cleared by advancing instead (the placement grants no progress).
  const attempt=(at,back)=>{
    const s=route.closed?at:clamp(at,0,route.length),u=roadCentreU(route,s,dir),p=route.point(s,u),q=route.project(p.x,p.z,s,6);
    if(Math.abs(q.s-s)>.35||Math.abs(q.u-u)>.15)return null;
    const f=route.contactFrame?.(s,u,{})||route.frame(s,{});
    return {s,u,yaw:Math.atan2(-f.tx,-f.tz)+(dir<0?Math.PI:0)};
  };
  const sign=Math.sign(retreat||1),allowed=at=>!floor||(at-floor.s0)*floor.dir>=floor.floor-1e-9;
  let blocked=false;
  for(let back=0;back<=80;back+=2) {
    s=requested-sign*back;
    if(!allowed(s)){blocked=true;break;}
    const pose=attempt(s,back);if(pose)return pose;
    if(!route.closed)s=clamp(s,0,route.length);
  }
  if(blocked)for(let ahead=2;ahead<=80;ahead+=2){const pose=attempt(requested+sign*ahead,ahead);if(pose)return pose;}
  if(blocked)s=requested;
  const u=roadCentreU(route,s,dir),f=route.contactFrame?.(s,u,{})||route.frame(s,{});
  return {s,u,yaw:Math.atan2(-f.tx,-f.tz)+(dir<0?Math.PI:0)};
}
// The Route as the tow planner sees it (src/tow-placement.js); the server builds the same interface from raw geometry.
export function routeTowAdapter(route) {
  return {
    closed: route.closed, length: route.length,
    project: (x, z, hint = null, range = 120) => route.closed && Number.isFinite(hint) ? route.project(x, z, hint, Math.ceil(range / route.step)) : route.project(x, z, null),
    edge: s => route.edge(s),
    centre: s => route.frame(s, {}),
    pose(s, d, retreat = d, floor = null) {
      const p = roadRecoveryPose(route, {}, d, s, retreat, floor), q = route.point(p.s, p.u);
      return { x: q.x, y: q.y, z: q.z, s: p.s, u: p.u, yaw: p.yaw };
    },
  };
}
