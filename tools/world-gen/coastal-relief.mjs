// Offline refinement of the DEM inside mapped lake outlines. This is run before
// the normal full-world packer, never in the browser. Render and contact positions
// change together; roads, their eight-metre shoulders and cell borders are fixed.
import {tileTables} from '../../src/world-tile-format.js';
import {groundIndex} from '../../src/world-tile-ground.js';
import {asphaltIndex} from '../../src/world-tile-asphalt.js';
import {inRing} from '../../src/world-tile-trees.js';
import {coastalRecipe} from '../../src/world-tile-coast.js';
const distance=(ring,x,z)=>Math.min(...ring.map((a,i)=>{const b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],f=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-f*dx,z-a[1]-f*dz);}));
function subdivideLakeGround(pack,outlines){
 const t=tileTables(pack),refs=pack.metadata.tables||pack.tables,P=t.finePositions,T=t.fineTriangles,points=Array.from(P),indices=[],flags=[],surface=[],prefix=[0],midpoints=new Map();
 const colourRef=pack.metadata.meshes.find(m=>m.attributes.position.array===refs.finePositions&&m.attributes.color)?.attributes.color.array,oldColours=pack.arrays[colourRef],colours=oldColours?Array.from(oldColours):null;
 const bounds=outlines.map(([,id,rings])=>[Math.min(...rings[0].map(p=>p[0]))-24,Math.min(...rings[0].map(p=>p[1]))-24,Math.max(...rings[0].map(p=>p[0]))+24,Math.max(...rings[0].map(p=>p[1]))+24]);
 const mid=(a,b)=>{const k=Math.min(a,b)+','+Math.max(a,b);if(midpoints.has(k))return midpoints.get(k);const v=points.length/3;for(let j=0;j<3;j++){points.push((points[a*3+j]+points[b*3+j])/2);if(colours)colours.push(Math.round((colours[a*3+j]+colours[b*3+j])/2));}midpoints.set(k,v);return v;};
 function emit(a,b,c,depth,flag,face){if(depth){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);for(const q of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])emit(...q,depth-1,flag,face);}else{indices.push(a,b,c);flags.push(flag);surface.push(face);}}
 for(let i=0;i<T.length;i+=3){const ids=[T[i],T[i+1],T[i+2]],xs=ids.map(v=>P[v*3]),zs=ids.map(v=>P[v*3+2]),near=!(t.fineFlags[i/3]&1)&&bounds.some(b=>Math.max(...xs)>=b[0]&&Math.min(...xs)<=b[2]&&Math.max(...zs)>=b[1]&&Math.min(...zs)<=b[3]);emit(...ids,near?2:0,t.fineFlags[i/3],t.fineSurface?.[i/3]||0);prefix.push(indices.length);}
 pack.arrays[refs.finePositions]=Float32Array.from(points);if(refs.contactPositions!==refs.finePositions)throw Error('Lake refinement requires shared compact terrain/contact positions');
 pack.arrays[refs.fineTriangles]=Uint32Array.from(indices);pack.arrays[refs.fineFlags]=Uint8Array.from(flags);if(refs.fineSurface!=null)pack.arrays[refs.fineSurface]=Uint32Array.from(surface);if(colours)pack.arrays[colourRef]=Uint8Array.from(colours);
 for(const m of pack.metadata.meshes)if(m.index===refs.fineTriangles){const a=m.drawRange?.start||0,b=a+(m.drawRange?.count??T.length);m.drawRange={start:prefix[a/3],count:prefix[b/3]-prefix[a/3]};}
 pack.metadata.meshes=pack.metadata.meshes.flatMap(m=>{if(m.index!==refs.fineTriangles||m.drawRange.count<=49152)return [m];const rows=[];for(let start=m.drawRange.start;start<m.drawRange.start+m.drawRange.count;start+=49152)rows.push({...m,drawRange:{start,count:Math.min(49152,m.drawRange.start+m.drawRange.count-start)}});return rows;});
 if(pack.metadata.budgets)pack.metadata.budgets.triangles+=(indices.length-T.length)/3;
 return points.length/3-P.length/3;
}
export function refineCoastalLakes(pack,recipe=coastalRecipe(pack.metadata.cell)){
 const outlines=recipe?.cover.filter(c=>c[0]==='lake')||[];
 if(!outlines.length)return {lakes:0,vertices:0};
 const addedVertices=subdivideLakeGround(pack,outlines);
 const tables=tileTables(pack),ground=groundIndex(tables),asphalt=asphaltIndex(tables);
 const probes=[[0,0]];for(let r=2;r<=10;r+=2)for(let j=0;j<32;j++)probes.push([r*Math.cos(j*Math.PI/16),r*Math.sin(j*Math.PI/16)]);
 // Vouliagmeni's reported surface is 0.5 m above sea level (GTP, location 72764).
 // The coarse DEM samples its limestone banks, not the water datum. Bathymetry is inferred.
 const lakes=outlines.map(([,id,rings])=>{const ys=rings[0].map(([x,z])=>ground.heightAt(x,z)).filter(Number.isFinite).sort((a,b)=>a-b);return {id,rings,level:id==='w50825797'?.5:ys[0]-.04,inferredElevation:id!=='w50825797'};});
 // Protect whole supporting triangles: a far vertex can influence the shoulder
 // through interpolation even when that vertex itself is well away from asphalt.
 const protectedVertices=new Set(),P=tables.finePositions,T=tables.fineTriangles;
 for(let i=0;i<T.length;i+=3){const ids=[T[i],T[i+1],T[i+2]],ps=ids.map(v=>[P[v*3],P[v*3+2]]);
  if(!ps.some(([x,z])=>lakes.some(l=>inRing(l.rings[0],x,z)||distance(l.rings[0],x,z)<18)))continue;
  const n=Math.ceil(Math.max(...ps.map((a,j)=>Math.hypot(a[0]-ps[(j+1)%3][0],a[1]-ps[(j+1)%3][1])))/4);let guarded=false;
  for(let a=0;a<=n&&!guarded;a++)for(let b=0;b<=n-a&&!guarded;b++){const x=ps[0][0]+(ps[1][0]-ps[0][0])*a/n+(ps[2][0]-ps[0][0])*b/n,z=ps[0][1]+(ps[1][1]-ps[0][1])*a/n+(ps[2][1]-ps[0][1])*b/n;guarded=probes.some(([dx,dz])=>asphalt.inside(x+dx,z+dz));}
  if(guarded)for(const [x,z]of ps)protectedVertices.add(x+','+z);
 }
 const changed=new Map();let vertices=0;
 function lower(x,y,z){
  const key=x+','+z;if(protectedVertices.has(key))return y;if(changed.has(key))return changed.get(key);
  let result=y;
  for(const lake of lakes){const inside=inRing(lake.rings[0],x,z),d=distance(lake.rings[0],x,z);if(lake.rings.slice(1).some(r=>inRing(r,x,z))||(!inside&&(d>=18||y>=12)))continue;
   // Guard the entire emitted carriageway/kerb/shoulder, not an estimated road width.
   if(probes.some(([dx,dz])=>asphalt.inside(x+dx,z+dz)))continue;
   // The DEM's cliff bleed also lifts the low forecourt into a false berm.
   // Grade only low banks within 18 m; the high limestone rim stays intact.
   const shore=y<12?Math.min(y,lake.level+.7):y,weight=inside?Math.min(1,d/3):1-d/18;
   result=Math.min(y,inside?shore+(lake.level-2-shore)*weight:y+(shore-y)*weight);
  }
  changed.set(key,result);return result;
 }
 const arrays=new Set([tables.finePositions,tables.contactPositions]);
 for(const mesh of pack.metadata.meshes)if(mesh.userData?.worldSurface&&mesh.material===0)arrays.add(pack.arrays[mesh.attributes.position.array]);
 for(const p of arrays)for(let i=0;i<p.length;i+=3){const y=lower(p[i],p[i+1],p[i+2]);if(y!==p[i+1]){p[i+1]=y;vertices++;}}
 const after=groundIndex(tables);
 // Existing park vegetation must follow the corrected bank rather than float
 // at the old DEM height. Water removes placements from its mapped footprint.
 const veg=pack.metadata.extensions?.worldDetail?.vegetation;
 if(veg){const p=pack.arrays[veg.positionHeight],kind=pack.arrays[veg.kind],seed=pack.arrays[veg.seed],rows=[],kinds=[],seeds=[];for(let i=0;i<p.length;i+=4){const x=p[i],z=p[i+2],y=after.heightAt(x,z);if(lakes.some(l=>inRing(l.rings[0],x,z)&&y<l.level))continue;rows.push(x,Number.isFinite(y)?y:p[i+1],z,p[i+3]);kinds.push(kind[i/4]);seeds.push(seed[i/4]);}pack.arrays[veg.positionHeight]=new p.constructor(rows);pack.arrays[veg.kind]=new kind.constructor(kinds);pack.arrays[veg.seed]=new seed.constructor(seeds);}

 for(let z=0;z<=32;z++)for(let x=0;x<=32;x++){const before=ground.heightAt(x*16,z*16),now=after.heightAt(x*16,z*16);if(now<before-.001)tables.coarseHeights[z*33+x]+=now-before;}
 pack.metadata.coastalLakes=lakes.map(lake=>{const xs=lake.rings[0].map(p=>p[0]),zs=lake.rings[0].map(p=>p[1]),positions=[];
  const wet=(x,z)=>inRing(lake.rings[0],x,z)&&!lake.rings.slice(1).some(r=>inRing(r,x,z))&&after.heightAt(x,z)<lake.level-.015&&!asphalt.inside(x,z);
  for(let z=Math.floor(Math.min(...zs)/3)*3;z<Math.max(...zs);z+=3)for(let x=Math.floor(Math.min(...xs)/3)*3;x<Math.max(...xs);x+=3)
   for(const tri of [[[x,z],[x,z+3],[x+3,z]],[[x+3,z],[x,z+3],[x+3,z+3]]])if(tri.every(([a,b])=>wet(a,b)))for(const [a,b]of tri)positions.push(a,lake.level,b);
  return {...lake,positions,waterArea:positions.length/9*4.5};
 });
 return {lakes:lakes.length,vertices,addedVertices,waterArea:pack.metadata.coastalLakes.reduce((n,l)=>n+l.waterArea,0)};
}
