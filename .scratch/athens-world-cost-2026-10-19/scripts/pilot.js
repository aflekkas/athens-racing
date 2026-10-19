// Injected into the page: a goal-directed autopilot over the loaded, directed road graph (same graph traffic uses).
(goal)=>{
  const A=window.__athens,g=A.roads.graph,v=A.player.veh,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const pilot={goal,reroutes:0,needsReroute:false,dead:0,speedTarget:13,log:[]};
  function walk(pt,metres){
    let edge=g.edges.get(pt.edge)?.value;if(!edge)return null;
    let seg=1,f=0;{let best=1e9;for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1],b=edge.points[i],dx=b[0]-a[0],dz=b[2]-a[2],l2=dx*dx+dz*dz||1,t=clamp(((pt.x-a[0])*dx+(pt.z-a[2])*dz)/l2,0,1),d=Math.hypot(pt.x-a[0]-dx*t,pt.z-a[2]-dz*t);if(d<best){best=d;seg=i;f=t;}}}
    let remaining=metres;
    for(let hops=0;hops<10;hops++){
      for(;seg<edge.points.length;seg++,f=0){
        const a=edge.points[seg-1],b=edge.points[seg],dx=b[0]-a[0],dz=b[2]-a[2],len=Math.hypot(dx,dz);if(!len)continue;
        const avail=len*(1-f);
        if(remaining<=avail){const t=f+remaining/len;return {edge:edge.id,x:a[0]+dx*t,y:a[1]+(b[1]-a[1])*t,z:a[2]+dz*t,yaw:Math.atan2(-dx,-dz),layer:edge.layer};}
        remaining-=avail;
      }
      const outs=[...(g.outgoing.get(edge.to)||[])].map(id=>g.edges.get(id)?.value).filter(e=>e&&g.legal(edge.id,e)&&Math.abs(e.points[0][1]-edge.points.at(-1)[1])<.5);
      if(!outs.length)return null;
      const end=edge.points.at(-1);let best=null,bs=-1e9;
      for(const e of outs){const p=e.points[Math.min(e.points.length-1,3)],dx=p[0]-end[0],dz=p[2]-end[2],l=Math.hypot(dx,dz)||1,gx=pilot.goal.x-end[0],gz=pilot.goal.z-end[2],gl=Math.hypot(gx,gz)||1,score=(dx*gx+dz*gz)/(l*gl);if(score>bs){bs=score;best=e;}}
      edge=best;seg=1;f=0;
    }
    return null;
  }
  let sinceNearest=0,here=null;
  pilot.drive=(veh,dt)=>{
    sinceNearest+=dt;
    if(!here||sinceNearest>.1){here=g.nearest(veh.x,veh.z,{referenceY:veh.y,layer:0,maxDistance:40});sinceNearest=0;}
    const speed=Math.abs(veh.vLong);
    if(!here){pilot.dead+=dt;if(pilot.dead>4)pilot.needsReroute=true;return {throttle:0,brake:.4,steer:0,steerRaw:0,handbrake:false,nitro:false,lookBack:false};}
    const near=walk(here,8+speed*.5),far=walk(here,22+speed*1.2);
    if(!near||!far){pilot.dead+=dt;if(pilot.dead>3)pilot.needsReroute=true;return {throttle:0,brake:.6,steer:0,steerRaw:0,handbrake:false,nitro:false,lookBack:false};}
    pilot.dead=0;
    const fx=-Math.sin(veh.yaw),fz=-Math.cos(veh.yaw),rx=Math.cos(veh.yaw),rz=-Math.sin(veh.yaw);
    const rel=[near.x-veh.x,near.z-veh.z],ahead=rel[0]*fx+rel[1]*fz,side=rel[0]*rx+rel[1]*rz,angle=Math.atan2(side,Math.max(.5,ahead));
    const turn=Math.abs(Math.atan2(Math.sin(far.yaw-veh.yaw),Math.cos(far.yaw-veh.yaw)));
    const target=clamp(pilot.speedTarget-turn*9,4,pilot.speedTarget),steer=clamp(pilot.sign*angle*1.6,-1,1);
    const err=target-speed;
    return {throttle:clamp(err/3,0,1),brake:clamp(-err/5,0,1),steer,steerRaw:steer,handbrake:false,nitro:false,lookBack:false};
  };
  pilot.sign=+1;
  pilot.reroute=async()=>{
    // Dead end or unloaded continuation: continue from the loaded tow anchor that is closest to the goal ahead of the car.
    // Anchors in the interior of the baked area only (all eight neighbouring cells exist), clearly closer to the goal than the car.
    const tiles=A.stream.manifest.tiles,interior=a=>{const cx=Math.floor(a.x/512),cz=Math.floor(a.z/512);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(!tiles[(cx+dx)+','+(cz+dz)])return false;return true;};
    const here0=Math.hypot(pilot.goal.x-veh().x,pilot.goal.z-veh().z);
    const list=[...A.roads.anchors({validate:true})].filter(a=>{const d=Math.hypot(a.x-veh().x,a.z-veh().z);return d>150&&d<900&&interior(a)&&Math.hypot(pilot.goal.x-a.x,pilot.goal.z-a.z)<here0-80;});
    list.sort((a,b)=>Math.hypot(a.x-pilot.goal.x,a.z-pilot.goal.z)-Math.hypot(b.x-pilot.goal.x,b.z-pilot.goal.z));
    // Never resume from an anchor already used (a dead end next to the goal would trap the car again): take the best unused one.
    pilot.used??=new Set();let t=list.find(a=>!pilot.used.has(a.id));if(!t&&list.length){pilot.used.clear();t=list[0];}if(!t)return false;pilot.used.add(t.id);await A.goto(t.id,t.x,t.z);pilot.reroutes++;pilot.needsReroute=false;pilot.dead=0;here=null;return true;
  };
  pilot.orient=async()=>{
    // Start on a loaded anchor within 900 m whose direction of travel points at the goal (the spawn's own edge may run the other way).
    const v0=veh(),gx=pilot.goal.x-v0.x,gz=pilot.goal.z-v0.z,gl=Math.hypot(gx,gz);
    const list=[...A.roads.anchors({validate:true})].filter(a=>{const d=Math.hypot(a.x-v0.x,a.z-v0.z);return d>20&&d<900&&(-Math.sin(a.yaw)*gx-Math.cos(a.yaw)*gz)/gl>.6;});
    list.sort((a,b)=>Math.hypot(a.x-pilot.goal.x,a.z-pilot.goal.z)-Math.hypot(b.x-pilot.goal.x,b.z-pilot.goal.z));
    const t=list[0];if(!t)return null;await A.goto(t.id,t.x,t.z);here=null;return {id:t.id,x:t.x,z:t.z};
  };
  const veh=()=>A.player.veh;
  window.__pilot=pilot;A.setDriver(pilot.drive);return true;
}
