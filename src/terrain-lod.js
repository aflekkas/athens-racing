import * as THREE from 'three';
import { settings } from './settings.js';

export const TERRAIN_LOD_PIXELS = Object.freeze({ potato: 12, low: 8, med: 5, high: 3, ultra: 1.5 });
const viewport = new THREE.Vector2(), clipMatrix = new THREE.Matrix4(), patchFrustum = new THREE.Frustum();
const startupPreset = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('quality');

// Each reduction replaces a complete grid patch with a centre fan. Every
// perimeter vertex survives, so adjacent tiles/levels need neither overlap nor
// skirts. Holes and partial patches retain their original triangles. Dense road
// refinement also uses these levels outside the player/contact area. 4/8/16-cell fans give approximately
// half/quarter/eighth of the original triangle count in complete patches.
function terrainValues(g) {
  const p=g.attributes.position, attrs=g.attributes, values=new Float64Array(p.count*8);
  for(let i=0;i<p.count;i++) {const k=i*8;values[k]=p.getY(i);
    for(let c=0;c<3;c++){values[k+1+c]=attrs.normal.getComponent(i,c);values[k+4+c]=attrs.color.getComponent(i,c);}
    values[k+7]=attrs.aU.getX(i);
  }
  return values;
}
export function buildTerrainLods(g, cachedValues = null) {
  const p = g.attributes.position, base = g.index.array, q = p.array;
  const values = cachedValues || terrainValues(g);
  const levels = [{ start: 0, count: base.length, error: 0 }], arrays = [base];
  let total = base.length;
  for (const size of [4, 8, 16]) {
    const blocks = new Map();
    for (let k = 0; k < base.length; k += 3) {
      const a = base[k], b = base[k+1], c = base[k+2];
      const x = Math.min(q[a*3], q[b*3], q[c*3]), z = Math.min(q[a*3+2], q[b*3+2], q[c*3+2]);
      const bx = Math.floor(x / size) * size, bz = Math.floor(z / size) * size, key = bz * 65536 + bx;
      let block = blocks.get(key);
      if (!block) blocks.set(key, block = { bx, bz, triangles: [], vertices: new Map(), min: Infinity, max: -Infinity });
      block.triangles.push(a,b,c);
      for (const v of [a,b,c]) { block.vertices.set((q[v*3+2]-bz)*(size+1)+q[v*3]-bx,v); block.min=Math.min(block.min,p.getY(v)); block.max=Math.max(block.max,p.getY(v)); }
    }
    const indices = []; let error = 0;
    for (const b of blocks.values()) {
      if (b.triangles.length !== size*size*6 || b.vertices.size !== (size+1)**2) { for(const v of b.triangles)indices.push(v); continue; }
      const at = (x,z) => b.vertices.get(z*(size+1)+x), center = at(size/2,size/2);
      error = Math.max(error, patchError(b, size, g, values));
      for(let i=0;i<size;i++) {
        indices.push(center,at(i+1,0),at(i,0), center,at(size,i+1),at(size,i),
          center,at(size-i-1,size),at(size-i,size), center,at(0,size-i-1),at(0,size-i));
      }
    }
    if (indices.length >= levels.at(-1).count) continue;
    const array = new Uint16Array(indices); arrays.push(array);
    levels.push({ start: total, count: array.length, error }); total += array.length;
  }
  if (levels.length === 1) return;
  const index = new Uint16Array(total); let offset = 0;
  for (const array of arrays) { index.set(array, offset); offset += array.length; }
  g.setIndex(new THREE.BufferAttribute(index, 1)); g.setDrawRange(0, base.length);
  g.userData.terrainLod = levels;
}

// Exact vertical error on the overlay of the two piecewise-linear surfaces.
// Its extrema lie at old vertices or intersections of an old edge and a fan
// spoke. Measuring only vertices misses a diagonal crossing over a saddle.
function patchError(block, size, g, values) {
  const p=g.attributes.position,q=p.array;
  const half=size/2,at=(x,z)=>block.vertices.get(z*(size+1)+x),center=at(half,half),spokes=[];
  // Color/normal deviations matter even on flat ground. Convert their
  // interpolation error to a conservative footprint-scaled visual error,
  // otherwise low-relief farmland develops large triangular color patches.
  const extent=size*p.decode.scale[0],weight=[1,extent,extent,extent,extent*2,extent*2,extent*2,extent*2];
  const read=(v,c)=>values[v*8+c];
  for(let i=0;i<size;i++)for(const [x,z]of [[i,0],[size,i],[size-i,size],[0,size-i]])spokes.push([x-half,z-half,at(x,z)]);
  let error=0;
  for(const v of block.vertices.values()){
    const dx=q[v*3]-block.bx-half,dz=q[v*3+2]-block.bz-half,m=Math.max(Math.abs(dx),Math.abs(dz));if(m===0)continue;
    const f=half/m,bx=half+dx*f,bz=half+dz*f;let a,b,t;
    if(Math.abs(dx)>=Math.abs(dz)){const ix=dx>0?size:0,iz=Math.min(size-1,Math.max(0,Math.floor(bz)));a=at(ix,iz);b=at(ix,iz+1);t=bz-iz;}
    else {const iz=dz>0?size:0,ix=Math.min(size-1,Math.max(0,Math.floor(bx)));a=at(ix,iz);b=at(ix+1,iz);t=bx-ix;}
    for(let c=0;c<8;c++){const cv=read(center,c),av=read(a,c);error=Math.max(error,Math.abs(read(v,c)-cv-(av+(read(b,c)-av)*t-cv)/f)*weight[c]);}
  }
  const tri=block.triangles;
  for(let k=0;k<tri.length;k+=3)for(let edge=0;edge<3;edge++){
    const a=tri[k+edge],b=tri[k+(edge+1)%3],ax=q[a*3]-block.bx-half,az=q[a*3+2]-block.bz-half,dx=q[b*3]-q[a*3],dz=q[b*3+2]-q[a*3+2];
    for(const [sx,sz,v]of spokes){
      const det=dx*sz-dz*sx;if(Math.abs(det)<1e-12)continue;
      const t=(-ax*sz+az*sx)/det,u=(dx*az-dz*ax)/det;
      if(t>=0&&t<=1&&u>=0&&u<=1)for(let c=0;c<8;c++){const av=read(a,c),cv=read(center,c);error=Math.max(error,Math.abs(av+(read(b,c)-av)*t-cv-(read(v,c)-cv)*u)*weight[c]);}
    }
  }
  return error+1e-5;
}

export function selectTerrainLod(levels, current, distance, focalPixels, preset = 'high', pinned = false, near = 250) {
  if (pinned || distance < (current === 0 ? near * 1.2 : near)) return 0;
  const budget = TERRAIN_LOD_PIXELS[preset] ?? TERRAIN_LOD_PIXELS.high;
  let next = 0;
  for(let i=1;i<levels.length;i++) {
    // 20% dead band: refining and coarsening have different thresholds.
    const threshold = budget * (i > current ? .8 : 1.2);
    if (levels[i].error * focalPixels / Math.max(1,distance) <= threshold) next=i;
  }
  return next;
}
export function installTerrainLods(terrain, group) {
  const chunks = [];
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    const g=mesh.geometry, levels=mesh.userData.terrainLod;
    if(mesh.userData.terrainLodPatches){chunks.push(installPatchChunk(mesh,group));return;}
    if (!levels) return;
    g.setDrawRange(levels[0].start,levels[0].count);
    if (!g.boundingBox) g.computeBoundingBox();
    const state={mesh,levels,current:0,pinned:false,box:g.boundingBox};chunks.push(state);
    mesh.onBeforeRender = function(renderer,scene,camera) {
      const e=camera.matrixWorld.elements,b=state.box;
      const dx=Math.max(b.min.x-e[12],0,e[12]-b.max.x),dy=Math.max(b.min.y-e[13],0,e[13]-b.max.y),dz=Math.max(b.min.z-e[14],0,e[14]-b.max.z);
      renderer.getDrawingBufferSize(viewport);
      const focal=viewport.y * Math.abs(camera.projectionMatrix.elements[5]) * .5;
      const preset=group.userData.terrainPreset || (TERRAIN_LOD_PIXELS[settings.graphics] ? settings.graphics : startupPreset) || 'high';
      const next=selectTerrainLod(levels,state.current,Math.hypot(dx,dy,dz),focal,preset,state.pinned);
      if(next!==state.current){state.current=next;g.setDrawRange(levels[next].start,levels[next].count);}
    };
  });
  // Contact queries protect only intersecting patches in the new layout.
  // Static props retain their exact support; distant patches in the same
  // submission chunk remain free to coarsen. Old baked layouts keep their
  // legacy tile pins. A streamed tile releases pins with its contact data.
  const sample=terrain.refinedHeight;
  if(chunks.length)terrain.refinedHeight=(x,z)=>{
    for(let i=0;i<chunks.length;i++) {
      const c=chunks[i];
      if(c.patches){const b=c.box;if(x>=b.min.x&&x<=b.max.x&&z>=b.min.z&&z<=b.max.z)pinPatch(c,x,z);continue;}
      const b=c.box;
      if(!c.pinned&&x>=b.min.x&&x<=b.max.x&&z>=b.min.z&&z<=b.max.z){c.pinned=true;c.current=0;c.mesh.geometry.setDrawRange(0,c.levels[0].count);}
    }
    return sample(x,z);
  };
  return chunks;
}

// Selection units are small lattice patches, independent of submission chunks.
// Keep immutable source ranges on the CPU and one reusable active GPU index
// buffer. A change copies preallocated views; no per-patch draw calls or frame
// allocations. The default pack stores the source once and restores the active buffer.
export function buildTerrainPatchLods(g) {
  const p=g.attributes.position,q=p.array,base=g.index.array,blocks=new Map(),size=16;
  for(let k=0;k<base.length;k+=3){
    const a=base[k],b=base[k+1],c=base[k+2];
    const x=Math.min(q[a*3],q[b*3],q[c*3]),z=Math.min(q[a*3+2],q[b*3+2],q[c*3+2]);
    const key=Math.floor(z/size)*65536+Math.floor(x/size);
    let ids=blocks.get(key);if(!ids)blocks.set(key,ids=[]);ids.push(a,b,c);
  }
  const values=terrainValues(g),patches=[],sources=[];let full=0,total=0;
  for(const ids of blocks.values()){
    const part=new THREE.BufferGeometry();part.attributes=g.attributes;part.setIndex(new THREE.BufferAttribute(new Uint16Array(ids),1));
    buildTerrainLods(part,values);
    const levels=part.userData.terrainLod || [{start:0,count:ids.length,error:0}];
    let x0=Infinity,z0=Infinity,y0=Infinity,x1=-Infinity,z1=-Infinity,y1=-Infinity;
    for(const id of ids){const x=p.getX(id),y=p.getY(id),z=p.getZ(id);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);z0=Math.min(z0,z);z1=Math.max(z1,z);}
    patches.push({bounds:[x0,y0,z0,x1,y1,z1],levels});sources.push(part.index.array);full+=ids.length;total+=part.index.count;
  }
  // All full ranges first: contact reconstruction and old consumers see only
  // the original surface in [0,full). Reduced ranges follow it.
  const index=new Uint16Array(total);let f=0,l=full;
  for(let i=0;i<patches.length;i++){
    const levels=patches[i].levels,source=sources[i];
    index.set(source.subarray(0,levels[0].count),f);levels[0].start=f;f+=levels[0].count;
    for(let j=1;j<levels.length;j++){const level=levels[j];index.set(source.subarray(level.start,level.start+level.count),l);level.start=l;l+=level.count;}
  }
  g.userData.terrainLodSource=index;
  g.setIndex(new THREE.BufferAttribute(index.slice(0,full),1).setUsage(THREE.DynamicDrawUsage));g.setDrawRange(0,full);
  g.userData.terrainLod=[{start:0,count:full,error:0}];
  g.userData.terrainLodPatches={version:2,patches};
}

function writeActive(state) {
  const g=state.mesh.geometry, index=g.index.array;let end=state.activeStart;
  for(const p of state.patches){if(!p.visible)continue;const l=p.levels[p.current];index.set(l.indices,end);end+=l.count;}
  g.setDrawRange(state.activeStart,end-state.activeStart);
  state.updateRange.count=end-state.activeStart;g.index.updateRanges.length=0;g.index.updateRanges.push(state.updateRange);g.index.needsUpdate=true;
}
function pinPatch(state,x,z) {
  let changed=false;
  for(const p of state.patches){const b=p.bounds;if(x>=b[0]&&x<=b[3]&&z>=b[2]&&z<=b[5]){p.pinned=true;if(p.current){p.current=0;changed=true;}}}
  if(changed)writeActive(state);
}
function installPatchChunk(mesh,group) {
  const data=mesh.userData.terrainLodPatches;
  const g=mesh.geometry,full=mesh.userData.terrainLod[0].count;
  if(!g.userData.terrainLodSource){g.userData.terrainLodSource=g.index.array;g.setIndex(new THREE.BufferAttribute(g.index.array.slice(0,full),1));}
  g.index.setUsage(THREE.DynamicDrawUsage);
  const source=g.userData.terrainLodSource;
  const state={mesh,box:g.boundingBox,updateRange:{start:0,count:0},activeStart:0,patches:data.patches.map(p=>({...p,levels:p.levels.map(l=>({...l,indices:new Uint16Array(source.buffer,source.byteOffset+l.start*2,l.count)})),current:0,pinned:false,visible:true}))};
  mesh.terrainLodState=state;
  writeActive(state);
  mesh.onBeforeRender=function(renderer,scene,camera){
    const e=camera.matrixWorld.elements;renderer.getDrawingBufferSize(viewport);
    const focal=viewport.y*Math.abs(camera.projectionMatrix.elements[5])*.5;
    const preset=group.userData.terrainPreset || (TERRAIN_LOD_PIXELS[settings.graphics]?settings.graphics:startupPreset) || 'high';
    patchFrustum.setFromProjectionMatrix(clipMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    let changed=false;
    for(const p of state.patches){const b=p.bounds;
      let visible=true;
      for(const plane of patchFrustum.planes){const n=plane.normal;if(n.x*(n.x>=0?b[3]:b[0])+n.y*(n.y>=0?b[4]:b[1])+n.z*(n.z>=0?b[5]:b[2])+plane.constant<0){visible=false;break;}}
      if(visible!==p.visible){p.visible=visible;changed=true;}
      if(!visible)continue;
      const dx=Math.max(b[0]-e[12],0,e[12]-b[3]),dy=Math.max(b[1]-e[13],0,e[13]-b[4]),dz=Math.max(b[2]-e[14],0,e[14]-b[5]);
      const distance=Math.hypot(dx,dy,dz);
      const next=selectTerrainLod(p.levels,p.current,distance,focal,preset,p.pinned,100);
      if(next!==p.current){p.current=next;changed=true;}
    }
    if(changed)writeActive(state);
  };
  return state;
}
