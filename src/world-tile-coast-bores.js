// Cell-owned port of the Loumbarda shell/pier recipe. Broad overlapping rock
// shoulders make one hill; both clear bore prisms are cut out of every face.
import {groundIndex} from './world-tile-ground.js';
import {COASTAL_BORES,BORE_TERRAIN,COASTAL_APPROACHES} from './coastal-bore-data.js';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const PORTALS=COASTAL_BORES.flatMap(b=>[b.axis[0],b.axis.at(-1)]);
export const boreLiningShade=(x,z)=>1-.7*Math.min(1,Math.min(...PORTALS.map(p=>Math.hypot(x-p[0],z-p[2])))/18);

function clip(poly,plane){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=dot(a,plane.slice(0,3))+plane[3],db=dot(b,plane.slice(0,3))+plane[3];if(da>=-1e-7)out.push(a);if((da>=0)!==(db>=0)){const f=da/(da-db);out.push(a.map((v,j)=>v+(b[j]-v)*f));}}return out;}
// Subtract a convex volume without introducing a face across its opening.
function subtract(poly,planes){
 // Do not split a face when the complete cutter misses it. Sequential half-plane
 // subtraction alone introduces needless fragments outside the cutter's bounds.
 let overlap=poly;for(const plane of planes){overlap=clip(overlap,plane);if(overlap.length<3)return [poly];}
 let inside=poly;const outside=[];for(const plane of planes){const p=clip(inside,plane.map(v=>-v));if(p.length>=3)outside.push(p);inside=clip(inside,plane);if(inside.length<3)break;}return outside;}
export function coastalBoreSurfaces(t,cell){
 const ox=cell[0]*512,oz=cell[1]*512;
 if(ox>9140||ox+512<9030||oz>18480||oz+512<18340)return [];
 const rock=[],concrete=[],lining=[],boxes=[];
 const bores=COASTAL_BORES.map(b=>{let length=0;const segments=b.axis.slice(1).map((p,i)=>{const a=b.axis[i],dx=p[0]-a[0],dz=p[2]-a[2],n=Math.hypot(dx,dz),seg={a,b:p,dx:dx/n,dz:dz/n,n,start:length};length+=n;return seg;});return {...b,segments,length};});
 const floor=(x,z,fallback)=>{const g=BORE_TERRAIN,u=Math.max(0,Math.min(g.nx-1.001,(x-g.x)/g.step)),v=Math.max(0,Math.min(g.nz-1.001,(z-g.z)/g.step)),i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,h=(dx,dz)=>g.heights[(j+dz)*g.nx+i+dx];return (h(0,0)*(1-a)+h(1,0)*a)*(1-b)+(h(0,1)*(1-a)+h(1,1)*a)*b;};
 const at=(b,s,u,h=0)=>{const seg=b.segments.find(q=>s<=q.start+q.n)||b.segments.at(-1),f=(s-seg.start)/seg.n,x=seg.a[0]+seg.dx*(s-seg.start)-seg.dz*u,z=seg.a[2]+seg.dz*(s-seg.start)+seg.dx*u,y=seg.a[1]+f*(seg.b[1]-seg.a[1]);return [x,floor(x,z,y)+h,z];};
 const volumes=[];
 for(const b of bores)for(const seg of b.segments){const {a,dx,dz,n}=seg,w=b.width/2+.65;
  // Full approach openings, from below ground to the clear roof. The oblique
  // floor follows the source segment grade, keeping the road envelope empty.
  const grade=(seg.b[1]-a[1])/n,top=a[1]+6.6;
  volumes.push([[dx,0,dz,-dx*a[0]-dz*a[2]+1],[-dx,0,-dz,dx*a[0]+dz*a[2]+n+1],[-dz,0,dx,dz*a[0]-dx*a[2]+w],[dz,0,-dx,-dz*a[0]+dx*a[2]+w],[grade*dx,-1,grade*dz,top-grade*(dx*a[0]+dz*a[2])]]);
 }
 // Preserve the complete curved approach corridors, not just straight extensions
 // of the bore axis. Their roads and shoulders retain seven metres of headroom.
 // All adjoining cells use the same complete approach cuts before clipping.
 // Per-cell road fragments would leave mismatched rock faces on their border.
 for(const {a:A,b:B,width}of COASTAL_APPROACHES){const n=Math.hypot(B[0]-A[0],B[2]-A[2]);if(n<.01)continue;const dx=(B[0]-A[0])/n,dz=(B[2]-A[2])/n,w=width/2,grade=(B[1]-A[1])/n;
  volumes.push([[dx,0,dz,-dx*A[0]-dz*A[2]],[-dx,0,-dz,dx*A[0]+dz*A[2]+n],[-dz,0,dx,dz*A[0]-dx*A[2]+w],[dz,0,-dx,-dz*A[0]+dx*A[2]+w],[grade*dx,-1,grade*dz,A[1]+7-grade*(dx*A[0]+dz*A[2])]]);
 }
 const bounds=[[1,0,0,-ox],[-1,0,0,ox+512],[0,0,1,-oz],[0,0,-1,oz+512]];
 function tri(a,b,c,out,cut=true){let polygons=[[a,b,c]];if(cut)for(const volume of volumes)polygons=polygons.flatMap(p=>subtract(p,volume));
  for(let p of polygons){for(const bound of bounds)p=clip(p,bound);for(let i=1;i<p.length-1;i++){const u=p[i].map((v,k)=>v-p[0][k]),v=p[i+1].map((v,k)=>v-p[0][k]);if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-7)continue;for(const q of [p[0],p[i],p[i+1]])out.push(q[0]-ox,q[1],q[2]-oz);}}}
 const quad=(a,b,c,d,out,cut=true)=>{tri(a,b,c,out,cut);tri(a,c,d,out,cut);};
 for(const b of bores){const w=b.width/2+.65,inner=[[-w,-.35],[-w,4.8],[-w*.8,6.9],[-w*.28,7.4],[w*.32,7.6],[w*.83,6.9],[w,4.8],[w,-.35]],outer=[[-32,-1],[-25,2],[-15,12],[-5,17],[6,18],[16,12],[25,2],[32,-1]];
  const ring=(s,profile,end=false)=>profile.map(([u,h],k)=>{const along=end?s+(s===0?1:-1)*(h>5?5:-6):s;return at(b,along,u,h+(h>5?.65*Math.sin(s*.35+k*1.3):0));});
  const liningSteps=Math.ceil(b.length/3);for(let i=0;i<liningSteps;i++){const a=inner.map(([u,h])=>at(b,b.length*i/liningSteps,u,h)),c=inner.map(([u,h])=>at(b,b.length*(i+1)/liningSteps,u,h));for(let k=0;k<7;k++)quad(a[k],c[k],c[k+1],a[k+1],lining,false);}
  const steps=Math.ceil(b.length/4);for(let i=0;i<steps;i++){const a=ring(b.length*i/steps,outer),c=ring(b.length*(i+1)/steps,outer);for(let k=0;k<7;k++)quad(a[k],c[k],c[k+1],a[k+1],rock);}
  for(const s of [0,b.length]){const direction=s===0?-1:1,face=inner.map(([u,h])=>at(b,s+direction*.15,u,h)),rim=inner.map(([u,h])=>at(b,s+direction*.2,u+Math.sign(u)*.9,h+(h>0?.9:0))),hill=ring(s,outer,true),top=ring(s,outer);
   for(let k=0;k<7;k++){quad(face[k],rim[k],rim[k+1],face[k+1],concrete,false);quad(rim[k],hill[k],hill[k+1],rim[k+1],rock);quad(hill[k],top[k],top[k+1],hill[k+1],rock);}
   // Flared concrete wing walls retain the cut slope, outside the bore walls.
   for(const side of [-1,1]){const a=at(b,s+direction*.25,side*(w+.95),-.4),c=at(b,s+direction*5,side*(w+3),-.4);quad(a,[a[0],a[1]+4.2,a[2]],[c[0],c[1]+1.3,c[2]],c,concrete);
    let lo=0,hi=1;for(const [axis,min,max]of [[0,ox,ox+512],[2,oz,oz+512]]){const d=c[axis]-a[axis];if(Math.abs(d)<1e-8){if(a[axis]<min||a[axis]>max)hi=-1;}else{const u=(min-a[axis])/d,v=(max-a[axis])/d;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));}}
    if(hi>lo){const A=a.map((v,k)=>v+(c[k]-v)*lo),B=a.map((v,k)=>v+(c[k]-v)*hi);boxes.push((A[0]+B[0])/2-ox,Math.min(A[1],B[1]),(A[2]+B[2])/2-oz,Math.atan2(B[0]-A[0],B[2]-A[2]),Math.hypot(B[0]-A[0],B[2]-A[2])/2,.2,4.2);}}
  }
 }
 // The native recipe's shared limestone pier joins the two bores, outside
 // both clear carriageways. This solid closes the median's view to the sky.
 const west=bores.find(b=>b.name==='loumbarda-west'),east=bores.find(b=>b.name==='loumbarda-east');
 if(west&&east){const z0=Math.max(Math.min(...west.axis.map(p=>p[2])),Math.min(...east.axis.map(p=>p[2]))),z1=Math.min(Math.max(...west.axis.map(p=>p[2])),Math.max(...east.axis.map(p=>p[2])));
  const axisAt=(b,z)=>{const q=b.segments.find(s=>z>=Math.min(s.a[2],s.b[2])&&z<=Math.max(s.a[2],s.b[2]))||b.segments.at(-1),f=(z-q.a[2])/(q.b[2]-q.a[2]);return [q.a[0]+f*(q.b[0]-q.a[0]),q.a[1]+f*(q.b[1]-q.a[1])];};
  const section=z=>{const a=axisAt(west,z),b=axisAt(east,z),x0=a[0]+west.width/2+1.3,x1=b[0]-east.width/2-1.3,base=Math.min(a[1],b[1])-1,top=Math.max(a[1],b[1])+15;return [[x0,base,z],[x0,top,z],[x1,top+.4,z],[x1,base,z]];};
  for(let z=z0;z<z1;z+=3){const a=section(z),b=section(Math.min(z1,z+3));for(let k=0;k<3;k++)quad(a[k],b[k],b[k+1],a[k+1],rock,false);}
  for(const z of [z0,z1]){const p=section(z);quad(p[0],p[1],p[2],p[3],rock,false);}
 }
 return [{kind:'rock',positions:rock},{kind:'concrete',positions:concrete,boxes},{kind:'lining',positions:lining}];
}

/** Keep the essential inside of the old bore; its isolated outer boxes are
 * replaced by the shared hill. Collision floors/walls and their tables stay intact. */
export function dressCoastalBoreShells(pack,t){
 const o=pack.metadata.origin,ground=groundIndex(t);let bytes=0;
 for(const mesh of pack.metadata.meshes){if(!mesh.userData?.rockBore||mesh.userData.tileSurface==='coastalDetail')continue;const p=pack.arrays[mesh.attributes.position.array],ix=pack.arrays[mesh.index],keep=[];
  const inside=i=>{const x=p[i*3]+o[0],z=p[i*3+2]+o[2],h=p[i*3+1]-ground.heightAt(p[i*3],p[i*3+2]);if(h>6.8)return false;
   return COASTAL_BORES.some(b=>b.axis.slice(1).some((B,k)=>{const A=b.axis[k],dx=B[0]-A[0],dz=B[2]-A[2],n=dx*dx+dz*dz,f=((x-A[0])*dx+(z-A[2])*dz)/n,ff=Math.max(0,Math.min(1,f));return f>=-.05&&f<=1.05&&Math.hypot(x-A[0]-ff*dx,z-A[2]-ff*dz)<=b.width/2+.7;}));};
  // The old shell duplicated every face in both directions. Keep only faces
  // looking into the bore; their outward backs otherwise appear as tan slabs.
  const inward=(a,b,c)=>{
   const A=[p[a*3],p[a*3+1],p[a*3+2]],B=[p[b*3],p[b*3+1],p[b*3+2]],C=[p[c*3],p[c*3+1],p[c*3+2]],q=A.map((v,k)=>(v+B[k]+C[k])/3),u=B.map((v,k)=>v-A[k]),v=C.map((w,k)=>w-A[k]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
   let best=Infinity,target;
   for(const bore of COASTAL_BORES)for(let k=1;k<bore.axis.length;k++){const a=bore.axis[k-1],b=bore.axis[k],dx=b[0]-a[0],dz=b[2]-a[2],f=Math.max(0,Math.min(1,((q[0]+o[0]-a[0])*dx+(q[2]+o[2]-a[2])*dz)/(dx*dx+dz*dz))),x=a[0]+dx*f-o[0],z=a[2]+dz*f-o[2],d=Math.hypot(x-q[0],z-q[2]);if(d<best){best=d;target=[x,a[1]+(b[1]-a[1])*f+2.5,z];}}
   return target&&dot(normal,target.map((v,k)=>v-q[k]))>0;
  };
  const start=mesh.drawRange?.start||0,end=start+(mesh.drawRange?.count??ix.length);for(let i=start;i<end;i+=3)if(inside(ix[i])&&inside(ix[i+1])&&inside(ix[i+2])&&inward(ix[i],ix[i+1],ix[i+2]))keep.push(ix[i],ix[i+1],ix[i+2]);
  mesh.userData.landmarkBox=true;const index=new ix.constructor(keep);mesh.index=pack.arrays.push(index)-1;mesh.drawRange={start:0,count:index.length};bytes+=index.byteLength*2;
 }
 return bytes;
}

/** Highest upper rock surface for optional vegetation. Never used for driving contacts. */
export function coastalHillGround(surfaces,ground){
 const grid=new Map();
 for(const s of surfaces)if(s.kind==='rock')for(let i=0;i<s.positions.length;i+=9){const p=s.positions.slice(i,i+9),[ax,ay,az,bx,by,bz,cx,cy,cz]=p,d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-5)continue;
  for(let x=Math.floor(Math.min(ax,bx,cx)/8);x<=Math.floor(Math.max(ax,bx,cx)/8);x++)for(let z=Math.floor(Math.min(az,bz,cz)/8);z<=Math.floor(Math.max(az,bz,cz)/8);z++){const k=x+','+z;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(p);}}
 return {heightAt(x,z){let y=ground.heightAt(x,z);for(const [ax,ay,az,bx,by,bz,cx,cy,cz]of grid.get(Math.floor(x/8)+','+Math.floor(z/8))||[]){const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz),u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d,w=1-u-v;if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6)y=Math.max(y,u*ay+v*by+w*cy);}return y;}};
}
