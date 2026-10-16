import {islandDistance} from './roundabouts.js';
// Distance to the union of modelled road strips, including finite road ends.
// Spatial capsules keep the per-player query independent of map size.
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export function roadEdgeDistance(x,z,a,b,width) {
  const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;
  const t=l2?clamp(((x-a.x)*dx+(z-a.z)*dz)/l2,0,1):0;
  return Math.max(0,Math.hypot(x-a.x-t*dx,z-a.z-t*dz)-width);
}
export class DrivableCorridor {
  constructor(route,network=null,terrain=null) {
    this.network=network;this.cells=new Map(); this.cell=64; this.terrain=terrain;
    const add=(a,b,w)=>{
      const seg={a,b,w};
      for(let i=Math.floor((Math.min(a.x,b.x)-w)/64);i<=Math.floor((Math.max(a.x,b.x)+w)/64);i++)
        for(let j=Math.floor((Math.min(a.z,b.z)-w)/64);j<=Math.floor((Math.max(a.z,b.z)+w)/64);j++){
          const key=`${i},${j}`;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(seg);
        }
    };
    const addRoute=r=>{for(let s=0;s<r.length;s+=4){const end=Math.min(s+4,r.length);add(r.point(s,0),r.point(end,0),Math.max(r.edge(s),r.edge(end)));}};
    addRoute(route);
    for(const r of route.localCorridors||[]) {
      const [lo,hi]=r.transitionS;
      for(let s=lo;s<hi;s+=4)add(r.point(s,0,{}),r.point(Math.min(s+4,hi),0,{}),r.width/2);
    }
    for(const s of network?.segments||[])add({x:s.ax,z:s.az},{x:s.bx,z:s.bz},s.hw);
  }
  distance(x,z,limit=96) {
    if(!Number.isFinite(x)||!Number.isFinite(z))return Infinity;
    const island=this.network?.islandAt?.(x,z);if(island)return islandDistance(x,z,island.ring);
    const C=this.cell, seen=new Set();let best=Infinity;
    for(let i=Math.floor((x-limit)/C);i<=Math.floor((x+limit)/C);i++)for(let j=Math.floor((z-limit)/C);j<=Math.floor((z+limit)/C);j++)
      for(const s of this.cells.get(`${i},${j}`)||[]){if(seen.has(s))continue;seen.add(s);best=Math.min(best,roadEdgeDistance(x,z,s.a,s.b,s.w));if(best===0)return 0;}
    return best;
  }
  outsideBounds(x,z) {
    const t=this.terrain;if(!t)return false;
    return x<t.minX||z<t.minZ||x>(t.maxX??t.minX+(t.GX-1)*t.T)||z>(t.maxZ??t.minZ+(t.GZ-1)*t.T);
  }
}
export function corridorThresholds(mapId,freeRoam=false) {
  if(freeRoam)return {soft:mapId==='megara'?60:40,hard:mapId==='megara'?60:40,seconds:0};
  return mapId==='megara'?{soft:25,hard:60,seconds:2.5}:{soft:12,hard:30,seconds:2.5};
}
export function corridorRecovery({distance,bounds=false,mapId,freeRoam=false,drop=0},dt,state) {
  const t=corridorThresholds(mapId,freeRoam),valley=mapId==='penteli'&&distance>3&&drop>4;
  state.corridorT=distance>t.soft||valley?(state.corridorT||0)+dt:0;
  const seconds=valley?.75:t.seconds;
  return {tow:bounds||distance>t.hard||(state.corridorT>0&&state.corridorT>=seconds),
    warning:distance>t.soft*.65||valley,remaining:Math.max(0,seconds-state.corridorT)};
}
