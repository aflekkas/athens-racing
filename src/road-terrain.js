// A deterministic, local road-level envelope. The DEM outside the feather band
// stays intact; road elevations are inputs, never adjusted by terrain carving.
export const ROAD_TERRAIN_CLEARANCE = .075;
export class RoadTerrain {
  constructor(route, network, { clearance = ROAD_TERRAIN_CLEARANCE } = {}) {
    this.clearance=clearance;
    this.segments = [];
    const add = seg => {
      const dx = seg.bx - seg.ax, dz = seg.bz - seg.az, L = Math.hypot(dx, dz);
      if (L < .001) return;
      Object.assign(seg, { dx, dz, L, L2: L * L }); this.segments.push(seg);
    };
    // Separate physical axes for divided/tunnel carriageways, using point()'s
    // real mapping rather than the nominal route centre between the two bores.
    for (let s = route.closed ? 0 : -64; s < route.length + (route.closed ? 0 : 64); s += 4) {
      const end = Math.min(s + 4, route.length + (route.closed ? 0 : 64));
      for (const side of route.closed ? [0] : [-1, 1]) {
        const centre = t => side * (route.edge(t) + route.medHalf(t)) / 2;
        const a = route.point(s, centre(s)), b = route.point(end, centre(end));
        add({ ax: a.x, az: a.z, bx: b.x, bz: b.z, s, end, side,
          width: route.closed ? Math.max(route.edge(s), route.edge(end)) : Math.max((route.edge(s) - route.medHalf(s)) / 2, (route.edge(end) - route.medHalf(end)) / 2) });
      }
    }
    this.mainCells=new Map();
    const triangle=(a,b,c)=>{
      const det=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(det)<1e-8)return;
      const tri={a,b,c,det,minX:Math.min(a.x,b.x,c.x),maxX:Math.max(a.x,b.x,c.x),minZ:Math.min(a.z,b.z,c.z),maxZ:Math.max(a.z,b.z,c.z)};
      for(let x=Math.floor(Math.min(a.x,b.x,c.x)/16);x<=Math.floor(Math.max(a.x,b.x,c.x)/16);x++)for(let z=Math.floor(Math.min(a.z,b.z,c.z)/16);z<=Math.floor(Math.max(a.z,b.z,c.z)/16);z++){
        const key=`${x},${z}`;if(!this.mainCells.has(key))this.mainCells.set(key,[]);this.mainCells.get(key).push(tri);
      }
    };
    for(let s=route.closed?0:-64;s<route.length+(route.closed?0:64);s+=2)for(const side of [-1,1]){
      const u=t=>side*route.edge(t),v=t=>route.closed?0:side*route.medHalf(t);
      const a=route.point(s,v(s)),b=route.point(s,u(s)),c=route.point(s+2,v(s+2)),d=route.point(s+2,u(s+2));triangle(a,c,b);triangle(b,c,d);
    }
    for (const n of network?.segments || []) add({ ax: n.ax, az: n.az, bx: n.bx, bz: n.bz, width: n.hw + n.sw, branch: n });
  }
  height(x, z, natural) {
    this.fixed=false;
    let surface=Infinity;
    for(const {a,b,c,det}of this.mainCells.get(`${Math.floor(x/16)},${Math.floor(z/16)}`)||[]){
      const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/det,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/det;
      if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)surface=Math.min(surface,u*a.y+v*b.y+(1-u-v)*c.y);
    }
    if(Number.isFinite(surface)){this.fixed=true;return surface-this.clearance;}

    let nearest=Infinity,verge=natural;
    const seen=new Set(),cx=Math.floor(x/16),cz=Math.floor(z/16);
    for(let i=cx-1;i<=cx+1;i++)for(let j=cz-1;j<=cz+1;j++)for(const tri of this.mainCells.get(`${i},${j}`)||[]){
      const bx=Math.max(tri.minX-x,0,x-tri.maxX),bz=Math.max(tri.minZ-z,0,z-tri.maxZ);if(bx*bx+bz*bz>Math.min(36,nearest*nearest)||seen.has(tri))continue;seen.add(tri);
      const points=[tri.a,tri.b,tri.c];for(let k=0;k<3;k++){
        const a=points[k],b=points[(k+1)%3],dx=b.x-a.x,dz=b.z-a.z,L=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(L||1)));
        const distance=Math.hypot(x-a.x-dx*t,z-a.z-dz*t);
        if(distance<nearest){nearest=distance;verge=a.y+(b.y-a.y)*t-this.clearance;}
      }
    }
    this.fixed=nearest<=4;
    return nearest<=6?verge:natural;

  }
}
