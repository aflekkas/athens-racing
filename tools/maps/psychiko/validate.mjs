// Frozen real-road source and game geometry must agree, including the lap seam.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Route,Terrain} from '../../../src/map.js';
import {resolve} from '../../../src/events.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const d=read('../../../data/maps/psychiko/map.json'),raw=read('./raw/route.json'),ed=read('./raw/route-dem.json');
const osm=JSON.parse(gunzipSync(fs.readFileSync(new URL('./raw/osm.json.gz',import.meta.url)))).elements;
const nodes=new Map(osm.filter(e=>e.type==='node').map(e=>[e.id,e])),ways=new Map(osm.filter(e=>e.type==='way').map(e=>[e.id,e]));
const r=new Route(d.route),bytes=fs.readFileSync(new URL('../../../data/maps/psychiko/terrain.bin',import.meta.url));
const t=new Terrain(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
assert.equal(d.id,'psychiko');assert.equal(d.length,r.length);assert(d.length>4000&&d.length<8000);
assert.equal(r.closed,true);assert.equal(r.streetCircuit,true);
for(const k of ['x','y','z','width','lanes','div']){assert.equal(d.route[k].length,r.N);assert(d.route[k].every(Number.isFinite));assert.equal(d.route[k][0],d.route[k].at(-1),k+' seam');}
assert.equal(new Set(raw.sourceNodeIds.slice(0,-1)).size,raw.sourceNodeIds.length-1,'simple loop');
for(let i=0;i<raw.sourceNodeIds.length-1;i++){
 const a=raw.sourceNodeIds[i],b=raw.sourceNodeIds[i+1];assert(nodes.has(a)&&nodes.has(b));
 const w=raw.sourceWayIds.map(id=>ways.get(id)).find(w=>w.nodes.some((id,k)=>id===a&&(w.nodes[k+1]===b||w.nodes[k-1]===b)));
 assert(w,'edge has primary source');assert(!w.tags.surface||w.tags.surface==='asphalt');assert(!['private','no'].includes(w.tags.access));
 assert(!['private','no'].includes(w.tags.motor_vehicle));
 // Closed-course permissions intentionally reverse some public one-way streets.
}
assert(Math.max(...r.GR.map(Math.abs))<.12,'drivable grades');
let maxDemError=0;for(const q of ed)maxDemError=Math.max(maxDemError,Math.abs(q.elevation-r.y(q.s)));assert(maxDemError<12);
for(let s=0;s<r.length*2;s+=4){const p=r.point(s,0),q=r.project(p.x,p.z,s-1,8);assert(Math.abs(q.s-s)<.1);assert(Number.isFinite(t.height(p.x,p.z)));assert(Math.abs(t.height(p.x,p.z)-p.y)<2.5);}
for(const e of d.events){const out=resolve(e,{route:r,marks:d.marks});assert.equal(e.mapId,'psychiko');assert.equal(out.len,d.length*(e.laps||1));assert.equal(out.laps,e.laps);assert.equal(out.checkpoints.at(-1).s,out.s1);}
assert(d.buildings.length>300);assert(d.roadNetwork.roads.length>100);assert(d.furniture.some(f=>f.t==='bus_stop'));
console.log(JSON.stringify({pass:true,length:d.length,maxDemError,stats:d.psychiko.stats,ways:raw.orderedWays.map(w=>w.id),buildings:d.buildings.length,networkRoads:d.roadNetwork.roads.length},null,2));
