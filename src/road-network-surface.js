// One spatial/height model shared by roads, terrain carving and wheel contacts. No rendering dependencies.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export function triangleHeight(t,H,x,z){
 const fx=clamp((x-t.minX)/t.T,0,t.GX-1.00001),fz=clamp((z-t.minZ)/t.T,0,t.GZ-1.00001),i=Math.floor(fx),j=Math.floor(fz),a=fx-i,b=fz-j,k=j*t.GX+i;
 const h00=H[k],h10=H[k+1],h01=H[k+t.GX],h11=H[k+t.GX+1];
 // Same shorter-height-diagonal choice as terrain.js, including both possible triangle planes.
 if(Math.abs(h00-h11)<Math.abs(h10-h01))return a>b?h00+(h10-h00)*a+(h11-h10)*b:h00+(h11-h01)*a+(h01-h00)*b;
 return a+b<1?h00+(h10-h00)*a+(h01-h00)*b:h11+(h01-h11)*(1-a)+(h10-h11)*(1-b);
}
export class RoadNetwork {
 constructor(map){this.mainMargin=map.id==='penteli'?.04:map.route.closed?0:.55;this.route=map.route;this.terrain=map.terrain;this.roads=map.data.roadNetwork?.roads||[];this.cells=new Map();this.segments=[];this.C=32;this.stats={length:map.data.roadNetwork?.length||0,roads:this.roads.length};
  this.routeCells=new Map();
  for(let i=0;i<(this.route.N||0);i+=Math.max(1,Math.floor(8/this.route.step))){const k=`${Math.floor(this.route.X[i]/64)},${Math.floor(this.route.Z[i]/64)}`;if(!this.routeCells.has(k))this.routeCells.set(k,[]);this.routeCells.get(k).push(i);}
  this.routeNear=new Set();
  for(const key of this.routeCells.keys()){const [x,z]=key.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)this.routeNear.add(`${x+dx},${z+dz}`);}
  for(const road of this.roads)for(let i=0;i+3<road.p.length;i+=2){const [ax,az,bx,bz]=road.p.slice(i,i+4),dx=bx-ax,dz=bz-az,L=Math.hypot(dx,dz);if(L<.01)continue;const seg={id:this.segments.length,road,ax,az,bx,bz,dx,dz,L,L2:L*L,hw:road.w/2,sw:road.urban&&road.sf==='asphalt'?1.3:0};
   const mx=(ax+bx)/2,mz=(az+bz)/2;
   if(this.route.frame&&this.nearMain(mx,mz)){const q=this.project(mx,mz),f=this.route.frame(q.s,{});if(Math.abs(q.u)<this.route.edge(q.s)+12&&Math.abs(dx/L*f.tx+dz/L*f.tz)<.8)seg.hw+=1.4;}
   this.segments.push(seg);const R=seg.hw+seg.sw+2;
   for(let x=Math.floor((Math.min(ax,bx)-R)/this.C);x<=Math.floor((Math.max(ax,bx)+R)/this.C);x++)for(let z=Math.floor((Math.min(az,bz)-R)/this.C);z<=Math.floor((Math.max(az,bz)+R)/this.C);z++){const k=`${x},${z}`;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(seg);}
  }
 }
 candidates(x,z){return this.cells.get(`${Math.floor(x/this.C)},${Math.floor(z/this.C)}`)||[];}
 nearMain(x,z){return !this.routeCells.size||this.routeNear.has(`${Math.floor(x/64)},${Math.floor(z/64)}`);}
 installSurface(tiles){this.surfaceCells=new Map();
  // Physics shares the renderer's position buffer; it does not copy three arrays for every triangle.
  for(const tile of tiles){const p=tile.positions||tile.pos;for(let i=0;i<p.length;i+=9){
   const ax=p[i],az=p[i+2],bx=p[i+3],bz=p[i+5],cx=p[i+6],cz=p[i+8],det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
   if(Math.abs(det)<1e-7)continue;const triangle={p,i,det,step:tile.col[i]>=.5?.14:0};
   for(let x=Math.floor(Math.min(ax,bx,cx)/8);x<=Math.floor(Math.max(ax,bx,cx)/8);x++)for(let z=Math.floor(Math.min(az,bz,cz)/8);z<=Math.floor(Math.max(az,bz,cz)/8);z++){
    const key=`${x},${z}`;if(!this.surfaceCells.has(key))this.surfaceCells.set(key,[]);this.surfaceCells.get(key).push(triangle);
   }
  }}
 }
 meshHeight(x,z){for(const t of this.surfaceCells?.get(`${Math.floor(x/8)},${Math.floor(z/8)}`)||[]){
  const {p,i,det,step}=t,wa=((p[i+5]-p[i+8])*(x-p[i+6])+(p[i+6]-p[i+3])*(z-p[i+8]))/det,wb=((p[i+8]-p[i+2])*(x-p[i+6])+(p[i]-p[i+6])*(z-p[i+8]))/det,wc=1-wa-wb;
  if(wa>=-1e-4&&wb>=-1e-4&&wc>=-1e-4)return wa*p[i+1]+wb*p[i+4]+wc*p[i+7]-step;
 }return null;}
 project(x,z){if(!this.routeCells.size)return this.route.project(x,z,null);const cx=Math.floor(x/64),cz=Math.floor(z/64);let best=-1,bd=Infinity;
  for(let r=0;r<14;r++){for(let i=-r;i<=r;i++)for(let j=-r;j<=r;j+=Math.abs(i)===r?1:2*r){for(const k of this.routeCells.get(`${cx+i},${cz+j}`)||[]){const d=(x-this.route.X[k])**2+(z-this.route.Z[k])**2;if(d<bd){bd=d;best=k;}}}if(best>=0&&Math.sqrt(bd)<(r-.5)*64)break;}
  return this.route.project(x,z,best<0?null:best*this.route.step,12);
 }
 distance(seg,x,z){const t=clamp(((x-seg.ax)*seg.dx+(z-seg.az)*seg.dz)/seg.L2,0,1);return Math.hypot(x-seg.ax-seg.dx*t,z-seg.az-seg.dz*t);}
 sample(x,z,out={}){let best=null,margin=-Infinity,asphalt=false;for(const s of this.candidates(x,z)){const d=this.distance(s,x,z),paved=d<=s.hw,inside=d<=s.hw+s.sw;if(!inside)continue;const m=s.hw-d;if(paved&&!asphalt||paved===asphalt&&m>margin){best=s;margin=m;asphalt=paved;}}
  if(!best)return null;out.segment=best;out.step=asphalt?0:.14;out.surf=asphalt?best.road.sf:'pavement';out.y=this.height(x,z)+out.step;return out;
 }
 mainInside(x,z){if(!this.nearMain(x,z))return false;const q=this.project(x,z);return (this.route.closed||q.s>=-60&&q.s<=this.route.length+60)&&Math.abs(q.u)<=this.route.edge(q.s)+this.mainMargin;}
 mouth(s,side,padding=0){const p=this.route.point(s,side*(this.route.edge(s)+this.mainMargin+.6));for(const seg of this.candidates(p.x,p.z))if(this.distance(seg,p.x,p.z)<seg.hw+padding)return true;return false;}
 height(x,z){const mesh=this.meshHeight(x,z);if(mesh!==null)return mesh;const terrain=this.terrain.refinedHeight?.(x,z);return terrain==null?this.baseHeight(x,z):terrain+.10;}
 baseHeight(x,z){const dem=triangleHeight(this.terrain,this.source||this.terrain.H,x,z)+.055;if(!this.nearMain(x,z))return dem;const q=this.project(x,z),edge=this.route.edge(q.s)+this.mainMargin,au=Math.abs(q.u),t=!this.route.closed&&(q.s< -60||q.s>this.route.length+60)?1:smooth(edge+12,edge+32,au);const y=this.route.surfaceY(q.s,clamp(q.u,-edge,edge));return y*(1-t)+dem*t;}
 prepareTerrain(H,stamp,base=H){this.source=base.slice();const t=this.terrain;
  const carved=new Uint8Array(H.length);
  // A DEM cell ring around every strip protects interpolation from tall corners and disables invented rock relief.
  for(const seg of this.segments){const R=seg.hw+seg.sw+t.T*1.5;
   for(let d=0;d<=seg.L;d+=Math.min(16,seg.L)){const f=d/seg.L;stamp(seg.ax+seg.dx*f,seg.az+seg.dz*f,48);}
   const i0=clamp(Math.floor((Math.min(seg.ax,seg.bx)-R-t.minX)/t.T),0,t.GX-1),i1=clamp(Math.ceil((Math.max(seg.ax,seg.bx)+R-t.minX)/t.T),0,t.GX-1),j0=clamp(Math.floor((Math.min(seg.az,seg.bz)-R-t.minZ)/t.T),0,t.GZ-1),j1=clamp(Math.ceil((Math.max(seg.az,seg.bz)+R-t.minZ)/t.T),0,t.GZ-1);
   for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const k=j*t.GX+i;if(carved[k])continue;const x=t.minX+i*t.T,z=t.minZ+j*t.T;if(this.distance(seg,x,z)>R)continue;carved[k]=1;H[k]=Math.min(H[k],this.height(x,z)-.08);}
  }
 }
}
