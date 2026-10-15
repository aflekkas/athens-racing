import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Group } from 'three';
import { loadMap } from '../src/map.js';
import { buildTerrain } from '../src/terrain.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { buildRoadNetwork } from '../src/road-network.js';
import { getPlayableMaps } from '../src/enabled-maps.js';
import { MAPS } from '../src/map-catalog.js';

// Sample the actual uploaded triangles, including coarse underlay: a contact
// helper alone can hide clipping from a visually higher second terrain mesh.
function meshHeightSampler(group) {
  const bins=new Map(),size=8;
  group.traverse(mesh=>{
    if(!mesh.geometry?.index)return;
    const p=mesh.geometry.attributes.position.array,ix=mesh.geometry.index.array;
    for(let k=0;k<ix.length;k+=3){const a=ix[k]*3,b=ix[k+1]*3,c=ix[k+2]*3,det=(p[b+2]-p[c+2])*(p[a]-p[c])+(p[c]-p[b])*(p[a+2]-p[c+2]);if(Math.abs(det)<1e-9)continue;
      const tri={p,a,b,c,det,source:mesh.userData};
      for(let x=Math.floor(Math.min(p[a],p[b],p[c])/size);x<=Math.floor(Math.max(p[a],p[b],p[c])/size);x++)for(let z=Math.floor(Math.min(p[a+2],p[b+2],p[c+2])/size);z<=Math.floor(Math.max(p[a+2],p[b+2],p[c+2])/size);z++){
        const key=x+','+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(tri);
      }
    }
  });
  const sample=(x,z)=>{let h=-Infinity;for(const {p,a,b,c,det,source} of bins.get(Math.floor(x/size)+','+Math.floor(z/size))||[]){const u=((p[b+2]-p[c+2])*(x-p[c])+(p[c]-p[b])*(z-p[c+2]))/det,v=((p[c+2]-p[a+2])*(x-p[c])+(p[a]-p[c])*(z-p[c+2]))/det;
    if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001){const y=u*p[a+1]+v*p[b+1]+(1-u-v)*p[c+1];if(y>h){h=y;sample.source=source;}}}return h;};return sample;
}
for(const def of getPlayableMaps(MAPS).filter(d=>!process.env.TERRAIN_MAPS||process.env.TERRAIN_MAPS.split(',').includes(d.id)))test(`${def.id}: rendered terrain clears every road and both six-metre shoulders remain drivable`,async t=>{
  const previousFetch=globalThis.fetch,previousLocation=globalThis.location;
  let bake;
  try {
    globalThis.fetch=async url=>new Response(readFileSync(resolve(import.meta.dirname,'..',String(url))));globalThis.location={search:''};
    const map=await loadMap(undefined,'./',def.id,{preload:false}),network=new RoadNetwork(map),scene=new Group();map.roadNetwork=network;
    const terrain=buildTerrain(map.terrain,map.route,[],scene,{coastal:def.id==='riviera',farmland:def.id==='megara',network});
    const roadsGroup=buildRoadNetwork(network,scene);bake={map,network,terrainGroup:terrain.group,roadsGroup};
  }finally{globalThis.fetch=previousFetch;if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;}
  const r=bake.map.route,n=bake.network,h=meshHeightSampler(bake.terrainGroup);
  if (def.id==='riviera') {
    // Astir's narrow shoreline used to become a submerged 40 m triangle
    // after the corridor budget reduction, leaving parasols over dark water.
    const x=497.2,z=2810.8,y=h(x,z);
    assert.ok(y>.3,`dry Astir sand submerged at ${x},${z}: ${y}`);
    assert.ok(Math.abs(bake.terrain.heightC(x,z)-y)<.02,'beach props must sample the rendered shoreline');
    t.diagnostic(JSON.stringify({astirShoreline:{x,z,y}}));
  }
  let count=0,maxStep=0,maxSlope=0,maxAbove=-Infinity,worstStep,worstSlope,worstAbove;
  const carriage=(x,z,y,where)=>{const delta=h(x,z)-y;count++;if(delta>maxAbove){maxAbove=delta;worstAbove={...where,source:h.source};} };
  const shoulder=(point,edgeY,where)=>{
    let previousPoint=point(0),prev=h(...previousPoint);const step=Math.abs(prev-edgeY);if(step>maxStep){maxStep=step;worstStep={...where,source:h.source};}
    for(let d=.25;d<=6;d+=.25){const currentPoint=point(d),y=h(...currentPoint),distance=Math.hypot(currentPoint[0]-previousPoint[0],currentPoint[1]-previousPoint[1]),slope=Math.abs(y-prev)/Math.max(1e-6,distance);if(slope>maxSlope){maxSlope=slope;worstSlope={...where,d,source:h.source};}prev=y;previousPoint=currentPoint;count++;}
  };
  // Sample every route segment, at most two metres apart. Raised medians
  // and the rock between twin tunnel bores are outside the carriageways.
  for(let s=0;s<r.length;s+=Math.min(2,r.step)){const e=r.edge(s);for(let u=-e;u<=e+.001;u+=1){if(!r.closed&&Math.abs(u)<r.medHalf(s))continue;const p=r.point(s,u);carriage(p.x,p.z,p.y,{s,u});}
    for(const side of [-1,1]){const p=r.point(s,side*e);carriage(p.x,p.z,p.y,{s,side});shoulder(d=>{const p=r.point(s,side*(e+d));return [p.x,p.z];},p.y,{s,side});}
  }
  // Every drivable side-road segment, including street junctions and sidewalks.
  for(const seg of n.segments){const steps=Math.max(1,Math.ceil(seg.L/2));for(let k=0;k<=steps;k++){
    const x=seg.ax+seg.dx*k/steps,z=seg.az+seg.dz*k/steps,e=seg.hw+seg.sw;
    for(let u=-seg.hw;u<=seg.hw+.001;u+=1){const xx=x-seg.dz/seg.L*u,zz=z+seg.dx/seg.L*u;carriage(xx,zz,n.height(xx,zz),{road:seg.road.id,k,u});}
    for(const side of [-1,1]){const point=d=>[x-seg.dz/seg.L*side*(e+d),z+seg.dx/seg.L*side*(e+d)],p=point(0);shoulder(point,n.height(...p),{road:seg.road.id,k,side});}
  }}
  t.diagnostic(JSON.stringify({samples:count,maxAbove,maxStep,maxSlope,worstAbove,worstStep,worstSlope}));
  assert.ok(maxAbove<=.005,`terrain above road by ${maxAbove} m at ${JSON.stringify(worstAbove)}`);
  assert.ok(maxStep<=.15,`road/shoulder step ${maxStep} m at ${JSON.stringify(worstStep)}`);
  assert.ok(maxSlope<=Math.tan(Math.PI/6),`shoulder slope ${maxSlope} at ${JSON.stringify(worstSlope)}`);
  bake.terrainGroup.traverse(m=>m.geometry?.dispose());bake.roadsGroup.traverse(m=>m.geometry?.dispose());
});
