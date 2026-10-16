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
      if (!block) blocks.set(key, block = { bx, bz, triangles: [], vertices: new Int32Array((size+1)**2).fill(-1), vertexCount: 0 });
      block.triangles.push(a,b,c);
      for (let j=0;j<3;j++) { const v=base[k+j],local=(q[v*3+2]-bz)*(size+1)+q[v*3]-bx;if(block.vertices[local]===-1)block.vertexCount++;block.vertices[local]=v; }
    }
    const indices = []; let error = 0;
    for (const b of blocks.values()) {
      if (b.triangles.length !== size*size*6 || b.vertexCount !== (size+1)**2) { for(const v of b.triangles)indices.push(v); continue; }
      const at = (x,z) => b.vertices[z*(size+1)+x], center = at(size/2,size/2);
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

// Both surfaces interpolate the same lattice samples. Subtract an affine
// trend, then bound their difference by the residual range. Every barycentric
// interpolation remains inside that range, including diagonal crossings. This
// conservative bound needs one vertex pass, not a quadratic edge/spoke overlay.
function patchError(block,size,g,values) {
  const width=size+1,at=(x,z)=>block.vertices[z*width+x]*8;
  const a=at(0,0),b=at(size,0),c=at(0,size),d=at(size,size);
  const q=g.attributes.position.array,extent=size*g.attributes.position.decode.scale[0];
  let error=0;
  for(let channel=0;channel<8;channel++){
    const sx=(values[b+channel]+values[d+channel]-values[a+channel]-values[c+channel])/(size*2);
    const sz=(values[c+channel]+values[d+channel]-values[a+channel]-values[b+channel])/(size*2);
    let min=Infinity,max=-Infinity;
    for(const v of block.vertices){
      const residual=values[v*8+channel]-sx*(q[v*3]-block.bx)-sz*(q[v*3+2]-block.bz);
      min=Math.min(min,residual);max=Math.max(max,residual);
    }
    error=Math.max(error,(max-min)*(channel===0?1:channel<4?extent:extent*2));
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
  const selection = createSelection(group);
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    const g=mesh.geometry, levels=mesh.userData.terrainLod;
    if(mesh.userData.terrainLodPatches){chunks.push(installPatchChunk(mesh,group,selection));return;}
    if (!levels) return;
    g.setDrawRange(levels[0].start,levels[0].count);
    if (!g.boundingBox) g.computeBoundingBox();
    const state={mesh,levels,current:0,pinned:false,box:g.boundingBox};chunks.push(state);
    mesh.onBeforeRender = function(renderer,scene,camera) {
      if(renderer.terrainLodCamera && camera!==renderer.terrainLodCamera)return;
      const e=camera.matrixWorld.elements,b=state.box;
      const dx=Math.max(b.min.x-e[12],0,e[12]-b.max.x),dy=Math.max(b.min.y-e[13],0,e[13]-b.max.y),dz=Math.max(b.min.z-e[14],0,e[14]-b.max.z);
      renderer.getDrawingBufferSize(viewport);
      const focal=viewport.y * Math.abs(camera.projectionMatrix.elements[5]) * .5;
      const preset=group.userData.terrainPreset || (TERRAIN_LOD_PIXELS[settings.perfClass] ? settings.perfClass : startupPreset) || 'high';
      const next=selectTerrainLod(levels,state.current,Math.hypot(dx,dy,dz),focal,preset,state.pinned);
      if(next!==state.current){state.current=next;g.setDrawRange(levels[next].start,levels[next].count);}
    };
  });
  // Contact queries protect only intersecting patches in the new layout.
  // Static props retain their exact support; distant patches in the same
  // submission chunk remain free to coarsen. Old baked layouts keep their
  // legacy tile pins. A streamed tile releases pins with its contact data.
  const sample=terrain.refinedHeight;
  terrain.sceneryHeight=sample; // Decoration samples exact support without pinning collision LOD.
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

// Complete 16-cell patches already have regular topology. Build their three
// fans directly from one lattice lookup, rather than sorting the same triangles
// into Maps three more times. Partial coastline/road-hole patches use the
// general builder below and retain every incomplete subpatch.
function regularPatchLods(g,ids,values) {
  if(ids.length!==16*16*6)return null;
  const q=g.attributes.position.array,grid=new Int32Array(17*17).fill(-1);
  let bx=Infinity,bz=Infinity,count=0;
  for(const id of ids){bx=Math.min(bx,q[id*3]);bz=Math.min(bz,q[id*3+2]);}
  for(const id of ids){const x=q[id*3]-bx,z=q[id*3+2]-bz;if(x>16||z>16)return null;const k=z*17+x;if(grid[k]===-1)count++;grid[k]=id;}
  if(count!==289)return null;
  for(let k=0;k<ids.length;k+=3){const a=ids[k]*3,b=ids[k+1]*3,c=ids[k+2]*3;if(Math.max(q[a],q[b],q[c])-Math.min(q[a],q[b],q[c])>1||Math.max(q[a+2],q[b+2],q[c+2])-Math.min(q[a+2],q[b+2],q[c+2])>1)return null;}
  const arrays=[new Uint16Array(ids)],levels=[{start:0,count:ids.length,error:0}];let total=ids.length;
  for(const size of [4,8,16]){
    const indices=new Uint16Array(12*size*(16/size)**2),vertices=new Int32Array((size+1)**2);
    const block={bx:0,bz:0,vertices};let offset=0,error=0;
    for(let z=0;z<16;z+=size)for(let x=0;x<16;x+=size){
      for(let iz=0;iz<=size;iz++)for(let ix=0;ix<=size;ix++)vertices[iz*(size+1)+ix]=grid[(z+iz)*17+x+ix];
      block.bx=bx+x;block.bz=bz+z;error=Math.max(error,patchError(block,size,g,values));
      const at=(ix,iz)=>vertices[iz*(size+1)+ix],center=at(size/2,size/2);
      for(let i=0;i<size;i++)for(const v of [center,at(i+1,0),at(i,0),center,at(size,i+1),at(size,i),center,at(size-i-1,size),at(size-i,size),center,at(0,size-i-1),at(0,size-i)])indices[offset++]=v;
    }
    arrays.push(indices);levels.push({start:total,count:indices.length,error});total+=indices.length;
  }
  const index=new Uint16Array(total);let start=0;for(const a of arrays){index.set(a,start);start+=a.length;}
  return {index,levels};
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
    let built=regularPatchLods(g,ids,values);
    if(!built){
      const part=new THREE.BufferGeometry();part.attributes=g.attributes;part.setIndex(new THREE.BufferAttribute(new Uint16Array(ids),1));
      buildTerrainLods(part,values);built={index:part.index.array,levels:part.userData.terrainLod || [{start:0,count:ids.length,error:0}]};
    }
    const levels=built.levels;
    let x0=Infinity,z0=Infinity,y0=Infinity,x1=-Infinity,z1=-Infinity,y1=-Infinity;
    for(const id of ids){const x=p.getX(id),y=p.getY(id),z=p.getZ(id);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);z0=Math.min(z0,z);z1=Math.max(z1,z);}
    patches.push({bounds:[x0,y0,z0,x1,y1,z1],levels});sources.push(built.index);full+=ids.length;total+=built.index.length;
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
  const g=state.mesh.geometry,index=g.index.array;let end=0;
  for(let i=0;i<state.patches.length;i++){
    state.offsets[i]=end;const p=state.patches[i],l=p.levels[p.current];index.set(l.indices,end);end+=l.count;
  }
  state.offsets[state.patches.length]=end;g.setDrawRange(0,end);g.index.needsUpdate=true;
}
function writeActiveSlice(state,start,end) {
  const g=state.mesh.geometry,index=g.index.array,offsets=state.offsets;
  const oldEnd=offsets[end],total=offsets[state.patches.length];let nextEnd=offsets[start];
  for(let i=start;i<end;i++)nextEnd+=state.patches[i].levels[state.patches[i].current].count;
  const delta=nextEnd-oldEnd;
  // Move the unchanged tail once, then replace only this contiguous queue slice.
  // No complete chunk repack and no scratch allocation on the render thread.
  if(delta)index.copyWithin(nextEnd,oldEnd,total);
  let at=offsets[start];
  for(let i=start;i<end;i++){offsets[i]=at;const p=state.patches[i],l=p.levels[p.current];index.set(l.indices,at);at+=l.count;}
  for(let i=end;i<offsets.length;i++)offsets[i]+=delta;
  g.setDrawRange(0,total+delta);g.index.needsUpdate=true;
}

function pinPatch(state,x,z) {
  let changed=false;
  for(const p of state.patches){const b=p.bounds;if(x>=b[0]&&x<=b[3]&&z>=b[2]&&z<=b[5]){p.pinned=true;if(p.current){p.current=0;changed=true;}}}
  if(changed)writeActive(state);
}
function installPatchChunk(mesh,group,selection) {
  const data=mesh.userData.terrainLodPatches;
  const g=mesh.geometry,full=mesh.userData.terrainLod[0].count;
  if(!g.userData.terrainLodSource){g.userData.terrainLodSource=g.index.array;g.setIndex(new THREE.BufferAttribute(g.index.array.slice(0,full),1));}
  g.index.setUsage(THREE.DynamicDrawUsage);
  const source=g.userData.terrainLodSource;
  const state={mesh,box:g.boundingBox,patches:data.patches.map(p=>({...p,levels:p.levels.map(l=>({...l,indices:new Uint16Array(source.buffer,source.byteOffset+l.start*2,l.count)})),current:0,pinned:false,visible:true}))};
  state.offsets=new Uint32Array(state.patches.length+1);
  mesh.terrainLodState=state;
  writeActive(state);
  state.sphere=g.boundingSphere;state.selectionTests=0;
  for(const p of state.patches){const b=p.bounds;p.cx=(b[0]+b[3])*.5;p.cy=(b[1]+b[4])*.5;p.cz=(b[2]+b[5])*.5;p.radius=Math.hypot(b[3]-b[0],b[4]-b[1],b[5]-b[2])*.5;}
  selection.add(state);
  mesh.onBeforeRender=function(renderer,scene,camera){selection.update(renderer,camera);};
  return state;
}

// A bounded, tile-local work queue. Index views and spheres are allocated at
// installation; the render path only visits a fixed slice and reuses buffers.
// Frustum rejection is per submission chunk; Three also culls each mesh before
// drawing it. Keeping all patches in visible chunks avoids stale culling holes
// when the camera turns between incremental updates.
function createSelection(group) {
  const chunks=[],nearBins=new Map(),dirty=[],matrix=new Float64Array(16),projection=new Float64Array(16);
  let lastCamera=null,cursor=0,patchCursor=0,lastFocal=0,lastPreset='',lastRenderer=null,lastFrame=-1,pendingFrames=0,slices=0;
  function evaluate(state,start,end,x,y,z,focal,budget){
    let first=end,last=start;state.selectionTests+=end-start;
    for(let j=start;j<end;j++){
      const p=state.patches[j],dx=x-p.cx,dy=y-p.cy,dz=z-p.cz,d2=dx*dx+dy*dy+dz*dz;
      let next=0;
      // Nearby patches refine synchronously through the spatial index below;
      // far error selection can therefore use the original 100 m corridor.
      const b=p.bounds,nx=Math.max(b[0]-x,0,x-b[3]),ny=Math.max(b[1]-y,0,y-b[4]),nz=Math.max(b[2]-z,0,z-b[5]);
      const near=p.current===0?120:100;
      if(!p.pinned&&nx*nx+ny*ny+nz*nz>=near*near)for(let i=1;i<p.levels.length;i++){
        const threshold=budget*(i>p.current?.8:1.2),limit=p.radius+p.levels[i].error*focal/threshold;
        if(d2>=limit*limit)next=i;
      }
      if(next!==p.current){p.current=next;first=Math.min(first,j);last=j+1;}
    }
    if(first<last)writeActiveSlice(state,first,last);
  }
  function refineNear(x,y,z){
    const list=nearBins.get(Math.floor(x/100))?.get(Math.floor(z/100));if(!list)return;
    let dirtyCount=0;
    for(let j=0;j<list.length;j++){
      const p=list[j];if(p.current===0)continue;const b=p.bounds,dx=Math.max(b[0]-x,0,x-b[3]),dy=Math.max(b[1]-y,0,y-b[4]),dz=Math.max(b[2]-z,0,z-b[5]);
      if(dx*dx+dy*dy+dz*dz>=10000)continue;
      p.current=0;const state=p.owner;if(state.nearEnd===0)dirty[dirtyCount++]=state;state.nearStart=Math.min(state.nearStart,p.ordinal);state.nearEnd=Math.max(state.nearEnd,p.ordinal+1);
    }
    for(let j=0;j<dirtyCount;j++){const state=dirty[j];dirty[j]=null;writeActiveSlice(state,state.nearStart,state.nearEnd);state.nearStart=state.patches.length;state.nearEnd=0;}
    return dirtyCount;
  }
  return {chunks,add(state){
    chunks.push(state);dirty.push(null);slices+=Math.ceil(state.patches.length/32);state.nearStart=state.patches.length;state.nearEnd=0;
    for(let i=0;i<state.patches.length;i++){const p=state.patches[i],b=p.bounds;p.owner=state;p.ordinal=i;
      for(let x=Math.floor((b[0]-100)/100);x<=Math.floor((b[3]+100)/100);x++){
        let column=nearBins.get(x);if(!column)nearBins.set(x,column=new Map());
        for(let z=Math.floor((b[2]-100)/100);z<=Math.floor((b[5]+100)/100);z++){let list=column.get(z);if(!list)column.set(z,list=[]);list.push(p);}
      }
    }
  },update(renderer,camera){
    if(renderer.terrainLodCamera && camera!==renderer.terrainLodCamera)return;
    const frame=renderer.info?.render.frame;
    if(frame!==undefined&&renderer===lastRenderer&&frame===lastFrame&&camera===lastCamera)return;
    lastRenderer=renderer;lastFrame=frame;
    const e=camera.matrixWorld.elements,pr=camera.projectionMatrix.elements;
    renderer.getDrawingBufferSize(viewport);
    const focal=viewport.y*Math.abs(pr[5])*.5,preset=group.userData.terrainPreset || (TERRAIN_LOD_PIXELS[settings.perfClass]?settings.perfClass:startupPreset) || 'high';
    let moved=lastCamera!==camera,reset=moved,configuration=focal!==lastFocal||preset!==lastPreset;
    for(let i=0;i<16;i++){if(e[i]!==matrix[i])moved=true;if(pr[i]!==projection[i])configuration=true;}
    // Dynamic resolution and speed-dependent FOV must not force a full sweep.
    if(configuration)pendingFrames=slices;
    // An unchanged camera needs no work once its initial selection is ready.
    if(!moved&&!reset&&!pendingFrames)return;
    // Only one slice for each camera transform. The renderer calls this once
    // per mesh, so subsequent calls with this same transform are constant work.
    const dx=e[12]-matrix[12],dy=e[13]-matrix[13],dz=e[14]-matrix[14];
    if(dx*dx+dy*dy+dz*dz>250*250)reset=true;
    matrix.set(e);projection.set(pr);lastCamera=camera;lastFocal=focal;lastPreset=preset;
    patchFrustum.setFromProjectionMatrix(clipMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const budget=TERRAIN_LOD_PIXELS[preset]??3;
    const nearbyChanges=refineNear(e[12],e[13],e[14]);
    if(reset){
      for(const state of chunks)if(patchFrustum.intersectsSphere(state.sphere))evaluate(state,0,state.patches.length,e[12],e[13],e[14],focal,budget);
      cursor=0;patchCursor=0;pendingFrames=0;return;
    }
    if(nearbyChanges){pendingFrames=Math.max(pendingFrames,1);return;}
    if(pendingFrames)pendingFrames--;
    let remaining=32,visited=0;
    while(remaining>0&&visited<chunks.length){
      const state=chunks[cursor];
      if(!patchFrustum.intersectsSphere(state.sphere)){cursor=(cursor+1)%chunks.length;patchCursor=0;visited++;continue;}
      const end=Math.min(state.patches.length,patchCursor+remaining);
      evaluate(state,patchCursor,end,e[12],e[13],e[14],focal,budget);remaining-=end-patchCursor;patchCursor=end;
      if(patchCursor===state.patches.length){cursor=(cursor+1)%chunks.length;patchCursor=0;visited++;}
      break; // At most one far chunk splice, plus immediate nearby refinement.
    }
  }};
}
