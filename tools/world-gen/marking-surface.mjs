// Offline repair of old baked paint. Intersect each marking triangle with the
// rendered asphalt triangles which support ALL of its original corners. This
// preserves its footprint and surface at bridges; it never snaps to a nearby
// road. Run after terrain edits, before the authoritative packTiles gates.
const CELL=8,LIFT=.015,EPS=1e-6;
const cross=(a,b,p)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[2]-b[0]*a[2];},0))/2;
function clip(poly,tri){
 const sign=cross(tri[0],tri[1],tri[2])>=0?1:-1;
 for(let k=0;k<3&&poly.length;k++){
  const a=tri[k],b=tri[(k+1)%3],out=[];
  for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],d=cross(a,b,p)*sign,e=cross(a,b,q)*sign,P=d>=-EPS,Q=e>=-EPS;
   if(P)out.push(p);if(P!==Q){const t=d/(d-e);out.push([p[0]+(q[0]-p[0])*t,0,p[2]+(q[2]-p[2])*t]);}}
  poly=out;
 }
 return poly;
}
function height(tri,x,z){const [a,b,c]=tri,d=cross(a,b,c);return a[1]+((x-a[0])*(c[2]-a[2])-(z-a[2])*(c[0]-a[0]))/d*(b[1]-a[1])+((b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]))/d*(c[1]-a[1]);}
function triangles(pack,mesh){
 const P=pack.arrays[mesh.attributes.position.array],I=pack.arrays[mesh.index],decode=mesh.userData?.terrainDecode,residual=decode&&pack.arrays[mesh.attributes.aHeightResidual.array],first=mesh.drawRange?.start||0,count=mesh.drawRange?.count??I.length,out=[];
 const at=i=>[0,1,2].map(k=>decode?decode.offset[k]+P[i*3+k]*decode.scale[k]+(k===1?residual[i]:0):P[i*3+k]);
 for(let i=first;i<first+count;i+=3){const tri=[at(I[i]),at(I[i+1]),at(I[i+2])];if(Math.abs(cross(...tri))>1e-10)out.push(tri);}
 return out;
}
function surfaceIndex(tris){
 const grid=new Map();
 const cells=(x0,z0,x1,z1,fn)=>{for(let x=Math.floor(x0/CELL);x<=Math.floor(x1/CELL);x++)for(let z=Math.floor(z0/CELL);z<=Math.floor(z1/CELL);z++)fn(x+','+z);};
 tris.forEach((t,i)=>cells(Math.min(...t.map(p=>p[0])),Math.min(...t.map(p=>p[2])),Math.max(...t.map(p=>p[0])),Math.max(...t.map(p=>p[2])),k=>{if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);}));
 const candidates=poly=>{const ids=new Set();cells(Math.min(...poly.map(p=>p[0]))-EPS,Math.min(...poly.map(p=>p[2]))-EPS,Math.max(...poly.map(p=>p[0]))+EPS,Math.max(...poly.map(p=>p[2]))+EPS,k=>{for(const i of grid.get(k)||[])ids.add(i);});return [...ids].map(i=>tris[i]);};
 return {candidates,supports:p=>candidates([p]).some(t=>{const s=cross(...t)>=0?1:-1;return t.every((a,i)=>cross(a,t[(i+1)%3],p)*s>=-EPS)&&Math.abs(height(t,p[0],p[2])+LIFT-p[1])<.035;})};
}
/** Mutates canonical decoded wire pack; returns counts for the publication audit.
 * Metadata triangle accounting is exact; packTiles recalculates bytes, hashes,
 * resident reservations and variants. Contact, graph, owner/layer data untouched.
 * Ambiguous/unsupported surface ownership fails closed, rather than moving paint
 * across layers. A second call is harmless. No source OSM cache is required. */
export function conformMarkingSurfaces(pack){
 const m=pack.metadata;if(m.markingSurface?.version===1)return {...m.markingSurface,alreadyApplied:true};
 const roads=m.meshes.filter(mesh=>mesh.userData?.tileSurface==='asphalt').map(mesh=>{const asphalt=surfaceIndex(triangles(pack,mesh)),domain=surfaceIndex(m.meshes.filter(other=>other.attributes.position.array===mesh.attributes.position.array&&other.userData?.worldSurface).flatMap(other=>triangles(pack,other)));return {...asphalt,supports:domain.supports};}),paint=m.meshes.filter(mesh=>mesh.userData?.tileSurface==='marking');
 const report={version:1,meshes:paint.length,beforeTriangles:0,afterTriangles:0,beforeArea:0,afterArea:0,maxCorrection:0};
 const replacements=new Map();
 for(const mesh of paint){
  if(Object.keys(mesh.attributes).some(k=>k!=='position')||mesh.index==null)throw Error('Unsupported marking attributes');
  const pi=mesh.attributes.position.array,ii=mesh.index;
  if(m.meshes.some(other=>other!==mesh&&(other.index===ii||Object.values(other.attributes).some(a=>a.array===pi))))throw Error('Shared marking buffers require explicit ownership');
  const source=triangles(pack,mesh),P=[],I=[];report.beforeTriangles+=(mesh.drawRange?.count??pack.arrays[ii].length)/3;
  for(const tri of source){
   const owners=roads.filter(road=>tri.every(p=>road.supports(p)));
   if(owners.length!==1)throw Error('Marking surface ownership is '+owners.length+' in cell '+m.cell+' at '+JSON.stringify(tri)+' supports '+JSON.stringify(roads.map(r=>tri.map(p=>r.supports(p)))));
   report.beforeArea+=area(tri);
   for(const roadTri of owners[0].candidates(tri)){
    const poly=clip(tri,roadTri);if(poly.length<3||area(poly)<1e-9)continue;
    for(let j=1;j+1<poly.length;j++){const face=[poly[0],poly[j],poly[j+1]];if(area(face)<1e-9)continue;if(cross(...face)*cross(...tri)<0)face.reverse();
     for(const p of face){const y=height(roadTri,p[0],p[2])+LIFT;report.maxCorrection=Math.max(report.maxCorrection,Math.abs(y-height(tri,p[0],p[2])));I.push(P.length/3);P.push(p[0],y,p[2]);}
     report.afterArea+=area(face);
    }
   }
  }
  report.afterTriangles+=I.length/3;
  // AWT caps each draw at 16384 triangles; retain the original index layout.
  const parts=[];for(let start=0;start<I.length;start+=16000*3){const positions=Float32Array.from(P.slice(start*3,(start+16000*3)*3)),Index=pack.arrays[ii].constructor,index=Index.from({length:positions.length/3},(_,i)=>i),a=parts.length?pack.arrays.push(positions)-1:pi,b=parts.length?pack.arrays.push(index)-1:ii;
   if(!parts.length){pack.arrays[pi]=positions;pack.arrays[ii]=index;}
   parts.push({...mesh,attributes:{position:{...mesh.attributes.position,array:a}},index:b,drawRange:{start:0,count:index.length}});
  }
  replacements.set(mesh,parts);
 }
 m.meshes=m.meshes.flatMap(mesh=>replacements.get(mesh)||[mesh]);m.budgets.triangles+=report.afterTriangles-report.beforeTriangles;m.markingSurface=report;return report;
}
