// Intersect side-road footprints with their already-authored terrain triangles.
// Sampling only the corners of skinny legacy fans invents steep cross-slopes.
// The footprint and texture coordinates remain unchanged; each new face lies on
// one actual source terrain plane, plus the original road/kerb clearance.
import * as THREE from 'three';
import {terrainWorldPositions} from '../../src/terrain-layout.js';
const cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
function clip(poly,a,b,sign){const out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],d=cross(a,b,p)*sign,e=cross(a,b,q)*sign;if(d>=0)out.push(p);if((d>=0)!==(e>=0)){const f=d/(d-e);out.push(p.map((v,k)=>v+(q[k]-v)*f));}}return out;}
export function conformImportedRoads(bake){
 const buckets=new Map(),wanted=new Set(),C=16;
 const keys=(v,fn)=>{for(let x=Math.floor(Math.min(...v.map(p=>p[0]))/C);x<=Math.floor(Math.max(...v.map(p=>p[0]))/C);x++)for(let z=Math.floor(Math.min(...v.map(p=>p[2]))/C);z<=Math.floor(Math.max(...v.map(p=>p[2]))/C);z++)fn(x+','+z);};
 for(const m of bake.roadsGroup.children){const p=m.geometry?.attributes.position;if(!p)continue;for(let i=0;i<p.count;i+=3)keys([0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]),key=>wanted.add(key));}
 // The finest active patch owns a point; coarse patches are underlays.
 for(const m of bake.terrainGroup.children){if(!m.isMesh)continue;const p=terrainWorldPositions(m),ix=m.geometry.userData.terrainLodSource||m.geometry.index.array,range=m.userData.terrainLod?.[0]||m.geometry.drawRange;
  for(let i=range.start||0,n=Math.min(ix.length,(range.start||0)+range.count);i<n;i+=3){const v=[0,1,2].map(j=>Array.from(p.slice(ix[i+j]*3,ix[i+j]*3+3))),det=cross(...v);if(Math.abs(det)<1e-9)continue;const rec={v,det,resolution:(m.userData.coarseTerrain?4:1)/(m.userData.terrainRefinement||1)};keys(v,key=>{if(!wanted.has(key))return;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(rec);});}
 }
 let sourceTriangles=0,triangles=0,maxHeightChange=0,verticalFaces=0,collapsedFaces=0,collapsedArea=0;const group=new THREE.Group();
 for(const m of bake.roadsGroup.children){if(!m.isMesh)continue;const g=m.geometry,fields=Object.entries(g.attributes).filter(([n])=>n!=='normal'),p=g.attributes.position,rows=[];let batch=[];
  const flush=()=>{if(!batch.length)return;const geometry=new THREE.BufferGeometry();let offset=0;for(const [name,a]of fields){const data=[];for(const v of batch)data.push(...v.slice(offset,offset+a.itemSize));geometry.setAttribute(name,new THREE.Float32BufferAttribute(data,a.itemSize));offset+=a.itemSize;}geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,m.material);group.add(mesh);batch=[];};
  for(let i=0;i<p.count;i+=3){const v=[0,1,2].map(j=>fields.flatMap(([,a])=>Array.from({length:a.itemSize},(_,k)=>a.getComponent(i+j,k))));sourceTriangles++;
   let colorOffset=0;for(const[name,a]of fields){if(name==='color')break;colorOffset+=a.itemSize;}
   // The old town kerb is 14 cm above a road already lifted 10 cm off the
   // ground: its outside face is a 24 cm step. Rebuild it as a 14 cm shoulder,
   // keeping asphalt heights/widths and shifting the complete visible face.
   if(v.every(p=>p[colorOffset]>=.5))for(const p of v)p[1]-=.10;
   else for(const p of v)p[1]-=.025; // 7.5 cm asphalt lift leaves room for the graded ground at an edge
   const area=Math.abs(cross(...v));
   if(area<1e-7){verticalFaces++;batch.push(...v);continue;}
   const [aa,bb,cc]=v,ux=bb[0]-aa[0],uy=bb[1]-aa[1],uz=bb[2]-aa[2],vx=cc[0]-aa[0],vy=cc[1]-aa[1],vz=cc[2]-aa[2],grade=Math.hypot(uy*vz-uz*vy,ux*vy-uy*vx)/area;
   const width=area/Math.max(...v.map((p,j)=>Math.hypot(p[0]-v[(j+1)%3][0],p[2]-v[(j+1)%3][2])));
   if(width<.001){collapsedFaces++;collapsedArea+=area/2;continue;}
   // Keep every already-conforming source face byte-for-byte. Only pathological
   // fans need an extra intersection; wholesale subdivision wastes residency.
   if(grade<=.55){batch.push(...v);triangles++;if(batch.length>=16384*3)flush();continue;}
   const candidates=new Set();keys(v,key=>{for(const t of buckets.get(key)||[])candidates.add(t);});let covered=0;
   for(const t of candidates){let poly=v;for(let e=0;e<3&&poly.length>=3;e++)poly=clip(poly,t.v[e],t.v[(e+1)%3],Math.sign(t.det));if(poly.length<3)continue;
    const center=poly.reduce((p,q)=>p.map((v,k)=>v+q[k]/poly.length),[0,0,0]),bucket=buckets.get(Math.floor(center[0]/C)+','+Math.floor(center[2]/C))||[];
    if(bucket.some(other=>other.resolution<t.resolution&&other.v.every((a,e)=>cross(a,other.v[(e+1)%3],center)*Math.sign(other.det)>=-1e-8)))continue;
    const [a,b,c]=t.v,det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
    for(const q of poly){const u=((b[2]-c[2])*(q[0]-c[0])+(c[0]-b[0])*(q[2]-c[2]))/det,w=((c[2]-a[2])*(q[0]-c[0])+(a[0]-c[0])*(q[2]-c[2]))/det,y=u*a[1]+w*b[1]+(1-u-w)*c[1]+.075;
     let offset=3,color;for(const[name,attr]of fields.slice(1)){if(name==='color')color=q[offset];offset+=attr.itemSize;}const next=y+(color>=.5?.065:0);maxHeightChange=Math.max(maxHeightChange,Math.abs(next-q[1]));q[1]=next;
    }
    for(let j=1;j+1<poly.length;j++){const tri=[poly[0],poly[j],poly[j+1]];const area=Math.abs(cross(...tri)),width=area/Math.max(...tri.map((p,j)=>Math.hypot(p[0]-tri[(j+1)%3][0],p[2]-tri[(j+1)%3][2])));if(area<1e-7||width<.001){collapsedFaces++;collapsedArea+=area/2;continue;}batch.push(...tri);triangles++;covered++;if(batch.length>=16384*3)flush();}
   }
   if(!covered)throw Error('Imported road is outside authored terrain');
  }flush();void rows;
 }
 return {group,report:{sourceTriangles,triangles,verticalFaces,maxHeightChange,collapsedFaces,collapsedArea,pavementLoweringMetres:.10,asphaltLoweringMetres:.025}};
}
