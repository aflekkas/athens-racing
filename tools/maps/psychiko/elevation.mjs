// One continuous Psychiko height field from the frozen Copernicus GLO-30 windows (raw/copernicus.json.gz).
// The lap, every side road, junction, roundabout and the terrain grid sample this same field, so
// shared nodes and crossings agree by construction. See SOURCES.md for provenance.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Terrain grid footprint: the frozen OSM bbox (fetch_osm.py) at 100 m, refined to 10 m by build.mjs.
export const BBOX={S:37.992,W:23.758,N:38.027,E:23.799};
export function gridExtent(proj,step=100){const x0=(BBOX.W-proj.lon0)*proj.mlon,x1=(BBOX.E-proj.lon0)*proj.mlon,z0=-(BBOX.N-proj.lat0)*proj.mlat,z1=-(BBOX.S-proj.lat0)*proj.mlat;return{x0,z0,step,nx:Math.floor((x1-x0)/step)+1,nz:Math.floor((z1-z0)/step)+1};}
export function readCopernicus(path){return JSON.parse(gunzipSync(fs.readFileSync(path)));}
// Mosaic the per-degree windows before filtering (no seam at 38 N), then smooth with a Gaussian in
// world metres. Sigma 20 m removes building/tree-scale DSM bumps but keeps real steep lanes.
export function copernicusField(raw,proj,{sigma=20}={}){
 const W=raw.windows,dlon=W[0].dlon,dlat=W[0].dlat,lon0=Math.min(...W.map(g=>g.lon0)),lat0=Math.max(...W.map(g=>g.lat0));
 const lon1=Math.max(...W.map(g=>g.lon0+(g.nx-1)*dlon)),lat1=Math.min(...W.map(g=>g.lat0+(g.nz-1)*dlat));
 const nx=Math.round((lon1-lon0)/dlon)+1,nz=Math.round((lat1-lat0)/dlat)+1,rawH=new Float64Array(nx*nz);
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const lon=lon0+i*dlon,lat=lat0+j*dlat;let best=Infinity,h=0;
  for(const g of W){const u=Math.round((lon-g.lon0)/dlon),v=Math.round((lat-g.lat0)/dlat),a=clamp(u,0,g.nx-1),b=clamp(v,0,g.nz-1),d=(u-a)**2+(v-b)**2;if(d<best){best=d;h=g.cm[b*g.nx+a]/100;}}
  rawH[j*nx+i]=h;}
 // Separable: the clamped-edge 2D kernel factors exactly into x and z passes.
 const kernel=metres=>{const R=Math.ceil(3*sigma/metres);return Array.from({length:2*R+1},(_,k)=>Math.exp(-(((k-R)*metres)**2)/(2*sigma*sigma)));};
 const kx=kernel(dlon*proj.mlon),kz=kernel(-dlat*proj.mlat),Rx=(kx.length-1)/2,Rz=(kz.length-1)/2,sx=kx.reduce((a,b)=>a+b),sz=kz.reduce((a,b)=>a+b);
 const tmp=new Float64Array(nx*nz),H=new Float64Array(nx*nz);
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){let s=0;for(let k=0;k<kx.length;k++)s+=rawH[j*nx+clamp(i+k-Rx,0,nx-1)]*kx[k];tmp[j*nx+i]=s/sx;}
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){let s=0;for(let k=0;k<kz.length;k++)s+=tmp[clamp(j+k-Rz,0,nz-1)*nx+i]*kz[k];H[j*nx+i]=s/sz;}
 const sample=(A,x,z)=>{const lat=proj.lat0-z/proj.mlat,lon=proj.lon0+x/proj.mlon,u=clamp((lon-lon0)/dlon,0,nx-1.000001),v=clamp((lat-lat0)/dlat,0,nz-1.000001),i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
  return (A[j*nx+i]*(1-a)+A[j*nx+i+1]*a)*(1-b)+(A[(j+1)*nx+i]*(1-a)+A[(j+1)*nx+i+1]*a)*b;};
 return {height:(x,z)=>sample(H,x,z),raw:(x,z)=>sample(rawH,x,z),source:raw.source};
}
// Each complete roundabout ring is one gently sloping plane, least-squares fitted to the field along its own
// carriageway (every ~2 m of the OSM ring), then blended back into the field over 20 m beyond the outer kerb,
// so the ring and all its entries share it. Fitting on the ring (not at the centre) matters for 70 m circles.
export function roundaboutPlanes(loops,field){return loops.map(q=>{const cx=q.p.reduce((s,p)=>s+p[0],0)/q.p.length,cz=q.p.reduce((s,p)=>s+p[1],0)/q.p.length,R=Math.max(...q.p.map(p=>Math.hypot(p[0]-cx,p[1]-cz)))+q.w/2;
 const S=[[0,0,0],[0,0,0],[0,0,0]],b=[0,0,0];
 q.p.forEach((a,i)=>{const c=q.p[(i+1)%q.p.length],n=Math.max(1,Math.ceil(Math.hypot(c[0]-a[0],c[1]-a[1])/2));for(let k=0;k<n;k++){const x=a[0]+(c[0]-a[0])*k/n-cx,z=a[1]+(c[1]-a[1])*k/n-cz,h=field.height(x+cx,z+cz),v=[1,x,z];for(let r=0;r<3;r++){b[r]+=v[r]*h;for(let t=0;t<3;t++)S[r][t]+=v[r]*v[t];}}});
 // Cramer's rule on the 3x3 normal equations.
 const det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]),D=det(S),col=k=>det(S.map((row,r)=>row.map((v,t)=>t===k?b[r]:v)));
 return {id:q.id,cx,cz,R,h:col(0)/D,gx:col(1)/D,gz:col(2)/D};});}
export function plannedHeight(field,planes){return (x,z)=>{let h=field.height(x,z);for(const q of planes){const d=Math.hypot(x-q.cx,z-q.cz);if(d>q.R+20)continue;let t=clamp((d-q.R)/20,0,1);t=t*t*(3-2*t);h=h*t+(q.h+q.gx*(x-q.cx)+q.gz*(z-q.cz))*(1-t);}return h;};}
