import * as THREE from 'three';
import { settings } from './settings.js';

export const TERRAIN_LOD_PIXELS = Object.freeze({ potato: 12, low: 8, med: 5, high: 3, ultra: 1.5 });
const viewport = new THREE.Vector2();
const startupPreset = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('quality');

// Each reduction replaces a complete grid patch with a centre fan. Every
// perimeter vertex survives, so adjacent tiles/levels need neither overlap nor
// skirts. Holes and partial patches retain their original triangles. Road
// refinement tiles never enter this path. 4/8/16-cell fans give approximately
// half/quarter/eighth of the original triangle count in complete patches.
export function buildTerrainLods(g) {
  const p = g.attributes.position, base = g.index.array, q = p.array;
  const values = new Float64Array(p.count * 8), attrs = g.attributes;
  for(let i=0;i<p.count;i++) {
    const k=i*8;values[k]=p.getY(i);
    for(let c=0;c<3;c++){values[k+1+c]=attrs.normal.getComponent(i,c);values[k+4+c]=attrs.color.getComponent(i,c);}
    values[k+7]=attrs.aU.getX(i);
  }
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
      if (b.triangles.length !== size*size*6 || b.vertices.size !== (size+1)**2 || b.min < 5) { for(const v of b.triangles)indices.push(v); continue; }
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

export function selectTerrainLod(levels, current, distance, focalPixels, preset = 'high', pinned = false) {
  if (pinned || distance < (current === 0 ? 300 : 250)) return 0;
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
  // Contact queries (including static prop grounding) pin intersecting tiles
  // before returning a full-resolution height. Pins are monotonic for this
  // tile lifetime: scenery never floats when the camera leaves it. A streamed
  // tile can release the pin together with its geometry/contact data.
  const sample=terrain.refinedHeight;
  if(chunks.length)terrain.refinedHeight=(x,z)=>{
    for(let i=0;i<chunks.length;i++) {
      const c=chunks[i],b=c.box;
      if(!c.pinned&&x>=b.min.x&&x<=b.max.x&&z>=b.min.z&&z<=b.max.z){c.pinned=true;c.current=0;c.mesh.geometry.setDrawRange(0,c.levels[0].count);}
    }
    return sample(x,z);
  };
  return chunks;
}
