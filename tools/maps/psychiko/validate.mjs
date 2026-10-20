// Frozen real-road source and game geometry must agree, including the lap seam.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Route,Terrain} from '../../../src/map.js';
import {resolve} from '../../../src/events.js';
import {readCopernicus,copernicusField,roundaboutPlanes,plannedHeight} from './elevation.mjs';
import {roundaboutLoops} from '../../roundabouts.mjs';
import {loadPsychikoOsm} from './corrections.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const d=read('../../../data/maps/psychiko/map.json'),raw=read('./raw/route.json');
const osm=loadPsychikoOsm();
const nodes=new Map(osm.filter(e=>e.type==='node').map(e=>[e.id,e])),ways=new Map(osm.filter(e=>e.type==='way').map(e=>[e.id,e]));
const r=new Route(d.route),bytes=fs.readFileSync(new URL('../../../data/maps/psychiko/terrain.bin',import.meta.url));
const t=new Terrain(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
assert.equal(d.id,'psychiko');assert.equal(d.length,r.length);assert(d.length>3500&&d.length<8000);
assert.equal(r.closed,true);assert.equal(r.streetCircuit,true);
for(const k of ['x','y','z','width','lanes','div']){assert.equal(d.route[k].length,r.N);assert(d.route[k].every(Number.isFinite));assert.equal(d.route[k][0],d.route[k].at(-1),k+' seam');}
assert.equal(new Set(raw.sourceNodeIds.slice(0,-1)).size,raw.sourceNodeIds.length-1,'simple loop');
for(let i=0;i<raw.sourceNodeIds.length-1;i++){
 const a=raw.sourceNodeIds[i],b=raw.sourceNodeIds[i+1];assert(nodes.has(a)&&nodes.has(b));
 const w=raw.sourceWayIds.map(id=>ways.get(id)).find(w=>w.nodes.some((id,k)=>id===a&&(w.nodes[k+1]===b||w.nodes[k-1]===b)));
 assert(w,'edge has primary source');assert(!w.tags.surface||w.tags.surface==='asphalt');assert(!['private','no'].includes(w.tags.access));
 assert(!['private','no'].includes(w.tags.motor_vehicle));
 const forward=w.nodes.some((n,k)=>n===a&&w.nodes[k+1]===b);
 if(w.tags.oneway==='yes'||w.tags.junction==='roundabout')assert(forward,'forward OSM direction');
 if(w.tags.oneway==='-1')assert(!forward,'reverse-tagged OSM direction');
 assert(!w.tags.tunnel&&!Number(w.tags.layer),'surface course only');
}
// Real Psychiko grades: the runtime caps 2 m steps at 14%; the build already owns that pass.
assert(Math.max(...r.GR.map(Math.abs))<=.1405,'drivable grades');
const runtimeShift=Math.max(...d.route.y.map((y,i)=>Math.abs(y-r.Y[i])));assert(runtimeShift<.011,'runtime conformance is a no-op: '+runtimeShift);
// The lap follows the shared Copernicus field, eased only by junction vertical curves and the 14% two-metre cap.
const P=n=>[(n.lon-d.proj.lon0)*d.proj.mlon,-(n.lat-d.proj.lat0)*d.proj.mlat],field=copernicusField(readCopernicus(new URL('./raw/copernicus.json.gz',import.meta.url)),d.proj),heightAt=plannedHeight(field,roundaboutPlanes(roundaboutLoops(osm,P),field));
let maxDemError=0;for(let i=0;i<r.N;i++)maxDemError=Math.max(maxDemError,Math.abs(heightAt(d.route.x[i],d.route.z[i])-r.Y[i]));assert(maxDemError<1.2,'lap departs from the height field by '+maxDemError);
let maxGrade=0;for(let i=1;i<r.N;i++)maxGrade=Math.max(maxGrade,Math.abs(d.route.y[i]-d.route.y[i-1])/d.route.step);assert(Math.abs(maxGrade*100-d.psychiko.stats.maxGrade)<.02,'stats describe the final profile');
for(let s=0;s<r.length*2;s+=4){const p=r.point(s,0),q=r.project(p.x,p.z,s-1,8);assert(Math.abs(q.s-s)<.1);assert(Number.isFinite(t.height(p.x,p.z)));assert(Math.abs(t.height(p.x,p.z)-p.y)<2.5);}
for(const e of d.events){const out=resolve(e,{route:r,marks:d.marks});assert.equal(e.mapId,'psychiko');assert.equal(out.len,d.length*(e.laps||1));assert.equal(out.laps,e.laps);assert.equal(out.sectors.at(-1).s,out.s1);}
assert(d.buildings.length>300);assert(d.roadNetwork.roads.length>100);assert(d.furniture.some(f=>f.t==='bus_stop'));
console.log(JSON.stringify({pass:true,length:d.length,maxDemError,stats:d.psychiko.stats,ways:raw.orderedWays.map(w=>w.id),buildings:d.buildings.length,networkRoads:d.roadNetwork.roads.length},null,2));
