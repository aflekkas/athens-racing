// Fail closed on mapped rock bores: same emitted asphalt layer, visible roof,
// full-carriageway headroom and continuous collision walls. No grade exceptions.
import {tileTables} from '../src/world-tile-format.js';
import {buildTileContactIndex,sampleTileContact} from '../src/world-tile-contact.js';
function heightAt(p,a,b,c,x,z){
 const ax=p[a*3],az=p[a*3+2],bx=p[b*3],bz=p[b*3+2],cx=p[c*3],cz=p[c*3+2],d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
 if(Math.abs(d)<1e-9)return null;const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d;
 return u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6?u*p[a*3+1]+v*p[b*3+1]+(1-u-v)*p[c*3+1]:null;
}
export function auditRockBores(pack){
 const m=pack.metadata,bores=m.tunnelBores||[],problems=[],safety=m.safetyRails||[];
 for(const r of safety)if(!Array.isArray(r)||r.length!==7||!r.every(Number.isFinite)||r[6]<=0||r[6]>4.5||[0,2,3,5].some(k=>r[k]<-.001||r[k]>512.001))problems.push('Invalid cell-owned safety wall');
 if(safety.length&&!m.meshes.some(mesh=>mesh.userData?.rockBore||mesh.userData?.coastGuard))problems.push('Safety walls have no visible mesh');
 let samples=0,minimumClearance=Infinity;
 if(!bores.length)return {passed:!problems.length,bores:0,samples:0,minimumClearance:null,safetyRails:safety.length,problems};
 const t=tileTables(pack),index=buildTileContactIndex(t),meshes=m.meshes.filter(mesh=>mesh.userData?.rockBore),walls=m.safetyRails||[];
 for(const bore of bores){
  if(bore.layer!==-1||!/^w\d+:\d+$/.test(bore.id)||bore.minimumClearance<4.5||!meshes.length){problems.push('Invalid bore metadata/shell '+bore.id);continue;}
  const surface=m.ids.indexOf('surface:'+bore.id);
  for(let i=0;i<t.edges.length;i+=10)if(t.edges[i+9]===surface&&(!(t.edges[i+8]&4)||t.edgeLayers[i/10]!==-1))problems.push('Bore graph lost tunnel flags/layer '+bore.id);
  for(let k=1;k<bore.axis.length;k++){
   const a=bore.axis[k-1],b=bore.axis[k],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz),n=Math.ceil(length);
   for(let j=0;j<=n;j++)for(const side of[-.48,0,.48]){
    const f=j/n,x=a[0]+dx*f-dz/length*side*bore.width,z=a[2]+dz*f+dx/length*side*bore.width;
    if(x<.001||z<.001||x>511.999||z>511.999)continue;
    const floor=sampleTileContact(t,index,x,z,{layer:-1,requiredFlags:1});
    // A portal boundary belongs to its adjoining approach; only the bore's
    // interior is required to have layer -1 across the whole carriageway.
    if(!floor){if(j>1&&j<n-1)problems.push('Missing bore contact '+bore.id);continue;}
    let roof=Infinity;
    for(const mesh of meshes){const p=pack.arrays[mesh.attributes.position.array],ix=pack.arrays[mesh.index];for(let q=0;q<ix.length;q+=3){const y=heightAt(p,ix[q],ix[q+1],ix[q+2],x,z);if(y!==null&&y>floor.y+2)roof=Math.min(roof,y);}}
    samples++;minimumClearance=Math.min(minimumClearance,roof-floor.y);
    if(!Number.isFinite(roof)||roof-floor.y<4.5-.002)problems.push('Bore headroom below 4.5 m '+bore.id);
   }
   for(let j=1;j<n;j++)for(const side of[-1,1]){
    const f=j/n,w=bore.width/2+.8,x=a[0]+dx*f-dz/length*side*w,z=a[2]+dz*f+dx/length*side*w;
    if(x<.22||z<.22||x>511.78||z>511.78)continue;
    if(!walls.some(r=>{const dx=r[3]-r[0],dz=r[5]-r[2],f=Math.max(0,Math.min(1,((x-r[0])*dx+(z-r[2])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-r[0]-dx*f,z-r[2]-dz*f)<.3&&r[6]>=3.6;}))problems.push('Missing bore wall '+bore.id);
   }
  }
 }
 return {passed:!problems.length,bores:bores.length,samples,safetyRails:safety.length,minimumClearance:Number.isFinite(minimumClearance)?minimumClearance:null,problems:[...new Set(problems)]};
}
