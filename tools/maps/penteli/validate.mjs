// Source-grounded bundle invariants, including the intended fork and elevation direction.
import assert from 'node:assert/strict';import fs from 'node:fs';
import {Route,Terrain} from '../../../src/map.js';import {resolve} from '../../../src/events.js';
const d=JSON.parse(fs.readFileSync(new URL('../../../data/maps/penteli/map.json',import.meta.url))),r=new Route(d.route),raw=JSON.parse(fs.readFileSync(new URL('./raw/route-dem.json',import.meta.url)));
const buf=fs.readFileSync(new URL('../../../data/maps/penteli/terrain.bin',import.meta.url)),t=new Terrain(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
assert.equal(d.id,'penteli');assert.equal(d.length,r.finish-r.start);assert(d.length>9000&&d.length<11000);
for(const k of ['x','y','z','width','lanes','div']){assert.equal(d.route[k].length,r.N,k);assert(d.route[k].every(Number.isFinite),k);}
assert(r.Y.every(h=>h>400&&h<760));assert(r.y(r.finish)-r.y(r.start)>200);assert(r.y(3200)<r.y(r.start)-25,'Keep real rolling approach; do not force all uphill');
assert(Math.max(...r.GR.map(Math.abs))<.17,'DEM cuts must not become undrivable vertical steps');
assert(d.sideRoads.some(q=>q.id===224029663&&q.p.length>8),'The real Nea Makri fork arm remains visible');
const fork=r.point(d.penteli.fork,0),ll=[d.proj.lat0-fork.z/d.proj.mlat,d.proj.lon0+fork.x/d.proj.mlon];assert(Math.hypot((ll[0]-38.0719843)*111000,(ll[1]-23.9345426)*87700)<10,'Real Agios Petros fork');
let maxError=0;for(const q of raw)maxError=Math.max(maxError,Math.abs(q.elevation-r.y(q.s)));assert(maxError<25,'Smoothing must remain close to measured DEM');
for(let s=r.start;s<=r.finish;s+=20){const p=r.point(s,0),h=t.height(p.x,p.z);assert(Number.isFinite(h)&&Math.abs(h-p.y)<2,'Road bed meets terrain');const q=r.project(p.x,p.z,s);assert(Math.abs(q.s-s)<2);}
const events=d.events;assert.equal(events.length,3);for(const e of events){assert.equal(e.mapId,'penteli');assert.equal(e.traffic,0);const resolved=resolve(e,{route:r,marks:d.marks});assert.equal(resolved.len,d.length);assert.equal(resolved.dir,e.id==='penteli-descent-tt'?-1:1);if(e.type==='timetrial')assert.equal(e.rivals,0);else assert.equal(e.rivals,3);}
console.log(JSON.stringify({pass:true,length:d.length,stats:d.penteli.stats,maxDemError:maxError,routeNodes:r.N,terrainCells:t.GX*t.GZ,events:events.map(e=>e.id)},null,2));
