// Migration tool only: reuses the existing bake and shared codec, never a second ASR implementation.
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { encodeGeometryPack,decodeGeometryPack } from '../src/baked-geometry.js';
import { prepareTilePacket } from '../src/world-tile-worker.js';
import { terrainWorldPositions } from '../src/terrain-layout.js';
import { tileRenderVariants } from '../src/world-tile-gpu.js';
import { TILE_TABLES, validateWorldTile, tileEdgeSignatures } from '../src/world-tile-format.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const SIZE=512;
function clip(poly,axis,value,sign){
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],inside=(a[axis]-value)*sign>=0,next=(b[axis]-value)*sign>=0;
    if(inside)out.push(a);
    if(inside!==next){const t=(value-a[axis])/(b[axis]-a[axis]),p=a.map((v,k)=>v+(b[k]-v)*t);p[axis]=value;out.push(p);}
  }return out;
}
export function triangleTiles(vertices,emit,profile=null){
  const xs=vertices.map(v=>v[0]),zs=vertices.map(v=>v[2]);
  const x0=Math.floor(Math.min(...xs)/SIZE),x1=Math.max(x0,Math.ceil(Math.max(...xs)/SIZE)-1),z0=Math.floor(Math.min(...zs)/SIZE),z1=Math.max(z0,Math.ceil(Math.max(...zs)/SIZE)-1);
  const seam=x0!==x1||z0!==z1||vertices.some(v=>v[0]%512===0||v[2]%512===0);
  if(profile&&seam)for(const v of vertices)v[11]=Math.round((v[1]-profile(v[0],v[2]))/.14)*.14;
  for(let tx=x0;tx<=x1;tx++)for(let tz=z0;tz<=z1;tz++){
    let p=vertices;
    for(const [axis,value,sign] of [[0,tx*SIZE,1],[0,(tx+1)*SIZE,-1],[2,tz*SIZE,1],[2,(tz+1)*SIZE,-1]])p=clip(p,axis,value,sign);
    for(let i=1;i+1<p.length;i++){
      const tri=[p[0],p[i],p[i+1]],a=tri[0],b=tri[1],c=tri[2];
      const ab=b.map((v,k)=>v-a[k]),ac=c.map((v,k)=>v-a[k]);
      if(Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])<1e-9)continue;
      // Derive boundary heights from the original plane, independent of clip order.
      const [v0,v1,v2]=vertices,det=(v1[2]-v2[2])*(v0[0]-v2[0])+(v2[0]-v1[0])*(v0[2]-v2[2]);
      if(Math.abs(det)>1e-9) for(const v of tri){const u=((v1[2]-v2[2])*(v[0]-v2[0])+(v2[0]-v1[0])*(v[2]-v2[2]))/det,w=((v2[2]-v0[2])*(v[0]-v2[0])+(v0[0]-v2[0])*(v[2]-v2[2]))/det;v[1]=Math.fround(u*v0[1]+w*v1[1]+(1-u-w)*v2[1]);}
      else for(const v of tri)v[1]=Math.fround(v[1]);
      emit(tx,tz,tri);
    }
  }
}
// Reconcile legacy adaptive terrain subdivisions before serializing either contacts or render meshes.
function stitchTerrain(tiles){
  const additions=new Map();
  for(const[key,tile]of tiles){const[x,z]=tile.cell;
    for(const[next,axis,ours,theirs]of[[`${x+1},${z}`,0,512,0],[`${x},${z+1}`,2,512,0]]){
      const neighbour=tiles.get(next);if(!neighbour)continue;
      const edge=(t,at)=>{const p=t.t.finePositions,out=[];for(let i=0;i<p.length;i+=3)if(p[i+axis]===at)out.push([p[i],p[i+1],p[i+2]]);return out;};
      const a=edge(tile,ours),b=edge(neighbour,theirs),global=(v,t)=>[v[0]+t.cell[0]*512,v[1],v[2]+t.cell[1]*512];
      const add=(target,points,source)=>{let out=additions.get(target);if(!out)additions.set(target,out=[]);for(const v of points){const g=global(v,source);out.push([g[0]-target.cell[0]*512,g[1],g[2]-target.cell[1]*512]);}};
      add(tile,a,tile);add(tile,b,neighbour);add(neighbour,a,tile);add(neighbour,b,neighbour);
    }
  }
  for(const[tile,incoming]of additions){
    const p=tile.t.finePositions,old=tile.t.fineTriangles,result=[],bySide=[[],[],[],[]];
    for(const v of incoming){if(v[0]===0)bySide[0].push(v);if(v[0]===512)bySide[1].push(v);if(v[2]===0)bySide[2].push(v);if(v[2]===512)bySide[3].push(v);}
    for(let i=0;i<old.length;i+=3){const original=old.slice(i,i+3),polygon=[];
      for(let edge=0;edge<3;edge++){
        const a=original[edge],b=original[(edge+1)%3],ax=p[a*3],az=p[a*3+2],bx=p[b*3],bz=p[b*3+2];polygon.push(a);
        const side=ax===bx&&(ax===0||ax===512)?(ax===0?0:1):az===bz&&(az===0||az===512)?(az===0?2:3):-1;if(side<0)continue;
        const candidates=[],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz;if(l2<1e-10)continue;
        for(const v of bySide[side]){
          const f=((v[0]-ax)*dx+(v[2]-az)*dz)/l2;if(f<=1e-8||f>=1-1e-8)continue;
          const y=p[a*3+1]+(p[b*3+1]-p[a*3+1])*f;
          candidates.push([f,v,Math.abs(v[1]-y)]);
        }
        const seen=new Set();for(const[f,v]of candidates.sort((a,b)=>a[0]-b[0]||a[2]-b[2])){const station=f.toFixed(8);if(seen.has(station))continue;seen.add(station);
          const key=v.join(',');let id=tile.vertices.terrain.get(key);
          if(id===undefined){id=p.length/3;p.push(...v);tile.vertices.terrain.set(key,id);const ca=tile.fineColors[a],cb=tile.fineColors[b];tile.fineColors[id]=ca.map((c,k)=>c+(cb[k]-c)*f);tile.fineNormals[id]=tile.fineNormals[a].map((c,k)=>c+(tile.fineNormals[b][k]-c)*f);tile.fineUrban[id]=tile.fineUrban[a]+(tile.fineUrban[b]-tile.fineUrban[a])*f;}
          polygon.push(id);
        }
      }
      if(polygon.length===3){result.push(...polygon);continue;}
      const cross=(a,b,c)=>(p[b*3]-p[a*3])*(p[c*3+2]-p[a*3+2])-(p[b*3+2]-p[a*3+2])*(p[c*3]-p[a*3]);
      const sign=Math.sign(cross(...original));
      while(polygon.length>3){let found=false;
        for(let k=0;k<polygon.length;k++){
          const a=polygon[(k+polygon.length-1)%polygon.length],b=polygon[k],c=polygon[(k+1)%polygon.length];if(cross(a,b,c)*sign<1e-8)continue;
          if(polygon.some(v=>v!==a&&v!==b&&v!==c&&cross(a,b,v)*sign>=-1e-8&&cross(b,c,v)*sign>=-1e-8&&cross(c,a,v)*sign>=-1e-8))continue;
          result.push(a,b,c);polygon.splice(k,1);found=true;break;
        }
        if(!found)throw new Error('Legacy terrain boundary cannot be stitched without changing its surface');
      }
      if(Math.abs(cross(...polygon))>1e-8)result.push(...polygon);
    }
    tile.t.fineTriangles=result;
  }
}

// Weld intersecting legacy road fans to their original continuous source profile.
// All overlapping border edges receive the same knots, including tangent tips.
function stitchRoadBorders(tiles,network){
 const stations=new Map(),edgeKey=(tile,axis,side)=>`${axis}:${tile.cell[axis===0?0:1]*512+side}:${tile.cell[axis===0?1:0]}`;
 const add=(tile,v)=>{for(const axis of[0,2])if(v[axis]===0||v[axis]===512){const key=edgeKey(tile,axis,v[axis]);let set=stations.get(key);if(!set)stations.set(key,set=new Set());set.add(v[axis===0?2:0]);}};
 for(const tile of tiles.values()){
  const p=tile.t.contactPositions;for(let i=0;i<p.length;i+=3)add(tile,p.slice(i,i+3));
  for(const batch of tile.batches)for(let i=0;i<batch.p.length;i+=3)add(tile,batch.p.slice(i,i+3));
 }
 let adjusted=0,maxAdjustment=0,addedTriangles=0;
 const snap=(tile,v)=>{if(v[0]!==0&&v[0]!==512&&v[2]!==0&&v[2]!==512)return v;
  const y=Math.fround(network.baseHeight(v[0]+tile.cell[0]*512,v[2]+tile.cell[1]*512)+(v[11]||0)),delta=Math.abs(y-v[1]);
  if(delta>.00001){adjusted++;maxAdjustment=Math.max(maxAdjustment,delta);}v[1]=y;return v;};
 const cross=(a,b,c,axes)=>(b[axes[0]]-a[axes[0]])*(c[axes[1]]-a[axes[1]])-(b[axes[1]]-a[axes[1]])*(c[axes[0]]-a[axes[0]]);
 function split(tile,tri){
  const polygon=[];
  for(let i=0;i<3;i++){
   const a=tri[i],b=tri[(i+1)%3];polygon.push(snap(tile,[...a]));
   const axis=a[0]===b[0]&&(a[0]===0||a[0]===512)?0:a[2]===b[2]&&(a[2]===0||a[2]===512)?2:-1;if(axis<0)continue;
   const other=axis===0?2:0,length=b[other]-a[other];if(!length)continue;
   const incoming=[];for(const station of stations.get(edgeKey(tile,axis,a[axis]))||[]){const f=(station-a[other])/length;if(f<=1e-8||f>=1-1e-8)continue;incoming.push({f,station});}
   incoming.sort((a,b)=>a.f-b.f);for(const{f,station}of incoming){const v=a.map((value,k)=>value+(b[k]-value)*f);v[other]=station;polygon.push(snap(tile,v));}
  }
  if(polygon.length===3)return[polygon];
  const[a,b,c]=tri,normal=[Math.abs((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1])),Math.abs(cross(a,b,c,[0,2])),Math.abs(cross(a,b,c,[0,1]))];
  const axes=normal[1]>1e-12?[0,2]:normal[0]>=normal[2]?[2,1]:[0,1],sign=Math.sign(cross(a,b,c,axes)),result=[];
  if(!sign)return[tri.map(v=>snap(tile,[...v]))];
  while(polygon.length>3){let found=false;
   for(let i=0;i<polygon.length;i++){
    const a=polygon[(i+polygon.length-1)%polygon.length],b=polygon[i],c=polygon[(i+1)%polygon.length];if(cross(a,b,c,axes)*sign<=0)continue;
    if(polygon.some(v=>v!==a&&v!==b&&v!==c&&cross(a,b,v,axes)*sign>=0&&cross(b,c,v,axes)*sign>=0&&cross(c,a,v,axes)*sign>=0))continue;
    result.push([a,b,c]);polygon.splice(i,1);found=true;break;
   }
   if(!found)throw new Error('Road boundary profile cannot be welded without changing its footprint '+JSON.stringify({cell:tile.cell,axes,sign,polygon:polygon.map(v=>v.slice(0,3))}));
  }
  if(Math.abs(cross(...polygon,axes))>1e-10)result.push(polygon);addedTriangles+=result.length-1;return result;
 }
 for(const tile of tiles.values()){
  const p=tile.t.contactPositions,old=tile.t.contactTriangles,oldLayers=tile.t.contactLayers,positions=[],triangles=[],layers=[],vertices=new Map();
  for(let i=0;i<old.length;i+=5){const tri=old.slice(i,i+3).map(id=>p.slice(id*3,id*3+3));for(const out of split(tile,tri)){
   for(const v of out){const key=v.join(',');let id=vertices.get(key);if(id===undefined){id=positions.length/3;positions.push(...v);vertices.set(key,id);}triangles.push(id);}triangles.push(old[i+3],old[i+4]);layers.push(oldLayers[i/5]);
  }}
  tile.t.contactPositions=positions;tile.t.contactTriangles=triangles;tile.t.contactLayers=layers;tile.vertices.road=vertices;
  const batches=[];let batch;
  for(const original of tile.batches)for(let i=0;i<original.p.length;i+=9){const tri=[];for(let j=0;j<3;j++){const v=(i/3+j);tri.push([...original.p.slice(v*3,v*3+3),...original.color.slice(v*3,v*3+3),...original.normal.slice(v*3,v*3+3),...original.uv.slice(v*2,v*2+2),original.offset[v]]);}
   for(const out of split(tile,tri)){
    if(!batch||batch.triangles>=16384){batch={p:[],color:[],normal:[],uv:[],offset:[],triangles:0};batches.push(batch);}
    for(const v of out){batch.p.push(...v.slice(0,3));batch.color.push(...v.slice(3,6));batch.normal.push(...v.slice(6,9));batch.uv.push(...v.slice(9,11));batch.offset.push(v[11]);}batch.triangles++;
   }
  }
  tile.batches=batches;tile.current=batch;
 }
 return {adjusted,maxAdjustment,addedTriangles};
}

function emptyTile(map,cell,revision,boundaries,borderProfiles){
  const t=Object.fromEntries(Object.keys(TILE_TABLES).map(k=>[k,[]]));
  return {t,cell,revision,world:map.id,ids:['','surface:terrain','surface:roads'],strings:[''],batches:[],current:null,boundaries,borderProfiles,vertices:{terrain:new Map(),road:new Map()},fineColors:[],fineNormals:[],fineUrban:[]};
}
function addTriangle(tile,vertices,kind,resolution=10){
  const t=tile.t,[tx,tz]=tile.cell,terrain=kind==='terrain';
  const local=vertices.map(v=>[Math.fround(v[0]-tx*512),v[1],Math.fround(v[2]-tz*512),...v.slice(3)]);
  for (const v of local) if (v[0]===0 || v[0]===512 || v[2]===0 || v[2]===512) {
    const key=`${kind}:${v[0]+tx*512}:${v[2]+tz*512}`;
    if(terrain){const previous=tile.borderProfiles.get(key);if(!previous||resolution<previous.resolution)tile.borderProfiles.set(key,{resolution,y:v[1],normal:v.slice(6,9),urban:v[9],color:v.slice(3,6)});}
    let heights=tile.boundaries.get(key);if(!heights)tile.boundaries.set(key,heights=[]);const previous=heights.find(y=>Math.abs(y-v[1])<=.001);if(previous!==undefined)v[1]=previous;else heights.push(v[1]);
  }
  const [va,vb,vc]=local,contactable=terrain||kind!=='render'&&Math.abs((vb[0]-va[0])*(vc[2]-va[2])-(vb[2]-va[2])*(vc[0]-va[0]))>1e-9;
  const positions=terrain?t.finePositions:t.contactPositions,triangles=terrain?t.fineTriangles:t.contactTriangles,vertexMap=tile.vertices[terrain?'terrain':'road'],indices=[];
  if(contactable) for(const v of local){const xyz=[v[0],Math.fround(v[1] - (!terrain && !tile.authoredRegion && v[3]>=.5 ? .14 : 0)),v[2]],key=xyz.join(',');let index=vertexMap.get(key);if(index===undefined){index=positions.length/3;positions.push(...xyz);vertexMap.set(key,index);if(terrain){tile.fineColors[index]=v.slice(3,6);tile.fineNormals[index]=v.slice(6,9);tile.fineUrban[index]=v[9];}}indices.push(index);}
  if(contactable){triangles.push(...indices,...(terrain?[]:[2,tile.authoredRegion&&local.every(v=>v[3]>=.5)?4:1]));if(!terrain)t.contactLayers.push(0);}
  if(terrain||kind==='contact'||tile.skipRoadRender)return;
  let batch=tile.current;
  if(!batch||batch.triangles>=16384){batch={p:[],color:[],normal:[],uv:[],offset:[],triangles:0};tile.batches.push(batch);tile.current=batch;}
  for(const v of local){batch.p.push(...v.slice(0,3));batch.color.push(...v.slice(3,6));batch.normal.push(...v.slice(6,9));batch.uv.push(...v.slice(9,11));batch.offset.push(v[11]??(v[3]>=.5?.14:0));}batch.triangles++;
}
export async function bakeExistingTiles(bake,out,options={}){
  const transform=options.transform, position=v=>transform?transform.position(v):v;
  const {map,network}=bake,tiles=new Map(),boundaries=new Map(),borderProfiles=new Map(),revision=options.revision||hash(new Uint8Array(bake.terrain)).slice(0,32)+hash(new Uint8Array(bake.roads)).slice(0,32);
  const sourceRoadHeight=!transform&&typeof network.baseHeight==='function'?(x,z)=>{const y=map.terrain.refinedHeight?.(x,z);return y==null?network.baseHeight(x,z):y+.10;}:null;
  const get=(x,z)=>{const key=`${x},${z}`;if(!tiles.has(key)){const tile=emptyTile(map,[x,z],revision,boundaries,borderProfiles);tile.authoredRegion=!!options.authoredContacts;tile.skipRoadRender=options.renderRoads===false;tiles.set(key,tile);}return tiles.get(key);};
  for(const [group,kind] of [[bake.terrainGroup,'terrain'],...(options.sourceRoads===false?[]:[[bake.roadsGroup,'road']])])for(const mesh of group.children){
    if(!mesh.isMesh)continue;
    const p=kind==='terrain'?terrainWorldPositions(mesh):mesh.geometry.attributes.position.array,c=mesh.geometry.attributes.color,index=mesh.geometry.userData.terrainLodSource?{array:mesh.geometry.userData.terrainLodSource,count:mesh.geometry.userData.terrainLodSource.length,getX(i){return this.array[i];}}:mesh.geometry.index;
    const range=mesh.userData.terrainLod?.[0]||mesh.geometry.drawRange;
    const resolution=(map.terrain.T||10)/(mesh.userData.terrainRefinement||1)*(mesh.userData.coarseTerrain?4:1);
    for(let i=range?.start||0,n=index?Math.min(index.count,(range?.start||0)+(Number.isFinite(range?.count)?range.count:index.count)):p.length/3;i<n;i+=3){
      const v=[];for(let j=0;j<3;j++){const k=index?index.getX(i+j):i+j;const normal=mesh.geometry.attributes.normal,urban=mesh.geometry.attributes.aU,uv=mesh.geometry.attributes.uv;v.push([p[k*3],p[k*3+1],p[k*3+2],c?c.getX(k):.4,c?c.getY(k):.4,c?c.getZ(k):.4,normal?normal.getX(k):0,normal?normal.getY(k):1,normal?normal.getZ(k):0,kind==='terrain'?(urban?urban.getX(k):0):(uv?uv.getX(k):0),uv?uv.getY(k):0]);}
      const floorArea=Math.abs((v[1][0]-v[0][0])*(v[2][2]-v[0][2])-(v[1][2]-v[0][2])*(v[2][0]-v[0][0]));
      const triangleKind=kind==='road'&&floorArea<1e-7?'render':kind;
      if(transform)for(const vertex of v){vertex.splice(0,3,...transform.position(vertex));vertex.splice(6,3,...transform.normal(vertex.slice(6,9)));}
      triangleTiles(v,(x,z,tri)=>addTriangle(get(x,z),tri,triangleKind,resolution),kind==='road'?sourceRoadHeight:null);
    }
  }
  // Bounded, plain main-carriageway ribbons, following the exact existing bank/profile.
  const r=map.route;
  for(let s=0;!options.authoredContacts&&s<r.length;s+=2){const end=Math.min(s+2,r.length),v=[];
    for(const [station,side] of [[s,-1],[s,1],[end,-1],[end,1]]){const p=r.point(station,side*(r.edge(station)+(r.closed?0:.55)));v.push([...position([p.x,p.y,p.z]),.13,.14,.15]);}
    for(const tri of [[v[0],v[2],v[1]],[v[1],v[2],v[3]]])triangleTiles(tri,(x,z,tri)=>addTriangle(get(x,z),tri,'contact'),sourceRoadHeight);
  }
  // Legacy coarse/fine patches can disagree by metres at the same XYZ station.
  // Resolve every shared border against its finest emitted source patch before making
  // topology canonical; never disguise a crack by adding unused edge vertices.
  const edgeHeights = new Map(); let repairedVertices = 0, maximumRepairMetres = 0;
  for (const tile of tiles.values()) {
    const p = tile.t.finePositions;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] !== 0 && p[i] !== 512 && p[i+2] !== 0 && p[i+2] !== 512) continue;
      const x = p[i] + tile.cell[0]*512, z = p[i+2] + tile.cell[1]*512, key = `${x},${z}`;
      if (!edgeHeights.has(key)) edgeHeights.set(key, Math.fround(borderProfiles.get(`terrain:${x}:${z}`)?.y ?? p[i+1]));
      const y = edgeHeights.get(key), delta = Math.abs(y-p[i+1]);
      if (delta > .00001) { repairedVertices++; maximumRepairMetres = Math.max(maximumRepairMetres, delta); }
      p[i+1] = y;const profile=borderProfiles.get(`terrain:${x}:${z}`);if(profile){tile.fineNormals[i/3]=profile.normal;tile.fineUrban[i/3]=profile.urban;tile.fineColors[i/3]=profile.color;}
    }
    tile.vertices.terrain.clear();
    for (let i = 0; i < p.length; i += 3) tile.vertices.terrain.set(p.slice(i,i+3).join(','),i/3);
  }
  stitchTerrain(tiles);
  const roadWeld=sourceRoadHeight?stitchRoadBorders(tiles,{baseHeight:sourceRoadHeight}):null;
  await options.populate?.({tiles,get,triangleTiles});
  const dir=resolve(out,'data/tiles',map.id);await mkdir(dir,{recursive:true});
  const manifest={tileVersion:1,world:map.id,revision,tileMetres:512,projection:options.projection||map.data.proj,elevation:options.elevation||{datum:'existing-map',source:map.definition.terrainUrl,sha256:hash(new Uint8Array(map.terrain.H.buffer))},defaults:{speedKph:50},spawn:{cell:[],anchor:'spawn:legacy'},tiles:{},migration:{partial:true,coverage:'terrain and road surfaces; existing scenery and route gameplay stay in the legacy adapter'}};
  const spawn=position(r.point(r.start,0).toArray?.()||Object.values(r.point(r.start,0)));manifest.spawn.cell=[Math.floor(spawn[0]/512),Math.floor(spawn[2]/512)];
  if(options.manifest)Object.assign(manifest,options.manifest);
  if(options.authoredContacts){let best,dist=Infinity;for(const tile of tiles.values())for(let i=0;i<tile.t.anchors.length;i+=5){const p=tile.t.anchorTransforms.slice(tile.t.anchors[i+1]*4,tile.t.anchors[i+1]*4+4),d=Math.hypot(p[0]+tile.cell[0]*512-spawn[0],p[2]+tile.cell[1]*512-spawn[2]);if(d<dist){dist=d;best={cell:tile.cell,anchor:tile.ids[tile.t.anchors[i]]};}}if(!best)throw Error('Imported region has no proven spawn anchor');manifest.spawn=best;}

  const signatures=new Map(),renderVariants=new Map();let totalBytes=0,decodedBytes=0,triangles=0;
  for(const [key,tile] of tiles){
    const {t,cell}=tile,arrays=[],tables={};
    const [x,z]=cell;
    // Existing global height solve, sampled identically on both sides of every border.
    for(let iz=0;iz<33;iz++)for(let ix=0;ix<33;ix++){const q=transform?transform.inverse([x*512+ix*16,0,z*512+iz*16]):[x*512+ix*16,0,z*512+iz*16];t.coarseHeights.push(Math.fround(map.terrain.refinedHeight?.(q[0],q[2])??map.terrain.height(q[0],q[2])));}
    for(const [name,[type]] of Object.entries(TILE_TABLES)){tables[name]=arrays.length;arrays.push(new globalThis[type](t[name]));}
    const add=a=>{arrays.push(a);return arrays.length-1;},meshes=[];
    // Shared canonical positions remove expanded render copies in dense Penteli
    // cells. Each draw stays <=16384 triangles; WebGL2 supports Uint32 indices.
    const color=add(Uint8Array.from(tile.fineColors.flat(),v=>Math.round(Math.max(0,Math.min(1,v))*255)));
    const normal=add(Int8Array.from(tile.fineNormals.flat(),v=>Math.round(Math.max(-1,Math.min(1,v))*127))),urban=add(Uint8Array.from(tile.fineUrban,v=>Math.round(Math.max(0,Math.min(1,v))*255)));
    for(let i=0;i<t.fineTriangles.length;i+=16384*3)meshes.push({name:'migrated-terrain',material:0,attributes:{position:{array:tables.finePositions,itemSize:3,normalized:false},color:{array:color,itemSize:3,normalized:true},normal:{array:normal,itemSize:3,normalized:true},aU:{array:urban,itemSize:1,normalized:true}},index:tables.fineTriangles,drawRange:{start:i,count:Math.min(16384*3,t.fineTriangles.length-i)},userData:{tileSurface:options.terrainSurface||'terrain'},layers:1,renderOrder:0});
    for(const batch of tile.batches){
      const unique=new Map(),positions=[],colors=[],normals=[],uvs=[],indices=[];
      for(let i=0;i<batch.p.length;i+=3){const rgb=batch.color.slice(i,i+3).map(v=>Math.round(Math.max(0,Math.min(1,v))*255)),xyz=batch.p.slice(i,i+3),nrm=batch.normal.slice(i,i+3).map(v=>Math.round(Math.max(-1,Math.min(1,v))*127)),uv=batch.uv.slice(i/3*2,i/3*2+2),key=xyz.join(',')+':'+rgb.join(',')+':'+nrm.join(',')+':'+uv.join(',');
        let vertex=unique.get(key);if(vertex===undefined){vertex=positions.length/3;unique.set(key,vertex);positions.push(...xyz);colors.push(...rgb);normals.push(...nrm);uvs.push(...uv);}indices.push(vertex);
      }
      const p=new Float32Array(positions),c=new Uint8Array(colors),n=new Int8Array(normals),uv=new Float32Array(uvs);
      meshes.push({name:'migrated-tile',material:0,attributes:{position:{array:add(p),itemSize:3,normalized:false},color:{array:add(c),itemSize:3,normalized:true},normal:{array:add(n),itemSize:3,normalized:true},uv:{array:add(uv),itemSize:2,normalized:false}},index:add(new Uint16Array(indices)),userData:{tileSurface:'network'},layers:1,renderOrder:0});
    }
    const metadata={tileVersion:1,world:map.id,revision,cell,origin:[x*512,0,z*512],tables,ids:tile.ids,strings:tile.strings,palette:[[1,1,1]],terrain:{coarseSize:33,spacing:16},meshes,budgets:{triangles:meshes.reduce((n,m)=>n+(m.index==null?arrays[m.attributes.position.array].length/9:(m.drawRange?.count??arrays[m.index].length)/3),0),buildingTriangles:0},migration:manifest.migration};
    options.decorate?.({tile,metadata,arrays,add});
    const pack={metadata,arrays};validateWorldTile(pack);
    signatures.set(key,tileEdgeSignatures(pack).map(hash));
    for(const variant of tileRenderVariants({metadata,arrays}))renderVariants.set(variant.key,variant);
    const raw=encodeGeometryPack(metadata,arrays),plain=gzipSync(new Uint8Array(raw),{level:9}),planeRaw=encodeGeometryPack(metadata,arrays,arrays.map(()=>true)),planes=gzipSync(new Uint8Array(planeRaw),{level:9}),body=plain.length<=planes.length?plain:planes,sha=hash(body),name=`${x}-${z}-${sha.slice(0,16)}.bin.gz`;
    if(body.length>25*1024*1024)throw new Error('Tile exceeds static asset cap');
    await options.beforeWrite?.();
    await writeFile(resolve(dir,name),body);
    // Conservative upper bound includes CSR references, decoder buffers, CPU+GPU data.
    const measured=prepareTilePacket(decodeGeometryPack(plain.length<=planes.length?raw:planeRaw),{world:map.id,revision,cell,entry:{decodedBytes:Number.MAX_SAFE_INTEGER,triangles:metadata.budgets.triangles}});
    const resident=Math.max(raw.byteLength,Math.ceil(measured.bytes*1.02)+65536);
    manifest.tiles[key]={url:`./${name}`,sha256:sha,bytes:body.length,decodedBytes:resident,dependencies:[],triangles:metadata.budgets.triangles};
    totalBytes+=body.length;decodedBytes+=resident;triangles+=metadata.budgets.triangles;
    tile.batches.length=0;for(const values of Object.values(t))values.length=0;tile.current=null;tile.vertices.terrain.clear();tile.vertices.road.clear();tile.fineColors.length=0;tile.fineNormals.length=0;tile.fineUrban.length=0;
  }
  // Record seam failures rather than presenting centroid partition as crack-free migration.
  const seamFailures=[];
  for(const [key,a]of signatures){const[x,z]=key.split(',').map(Number);for(const[next,side,opposite]of[[`${x+1},${z}`,1,0],[`${x},${z+1}`,3,2]])if(signatures.has(next)&&a[side]!==signatures.get(next)[opposite])seamFailures.push([key,next]);}
  manifest.migration.seamFailures=seamFailures.length;
  manifest.renderVariants=[...renderVariants.values()];
  await writeFile(resolve(dir,'world.json'),JSON.stringify(manifest));
  const report={id:map.id,roadWeld,repairedVertices,maximumRepairMetres,tiles:tiles.size,bytes:totalBytes,reservationBytes:decodedBytes,triangles,seamFailures,bytesPerKm2:totalBytes/(tiles.size*.512**2)};
  await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));
  console.log('Experimental world tile migration',JSON.stringify(report));
  return {version:1,manifest:`./data/tiles/${map.id}/world.json`};
}
