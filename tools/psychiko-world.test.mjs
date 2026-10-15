import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Route,Terrain} from '../src/map.js';
import {Ground} from '../src/ground.js';
import {RoadNetwork,triangleHeight} from '../src/road-network-surface.js';
import {cutMountainRoads} from '../src/road-cut.js';
import {resolve,EventRun} from '../src/events.js';
import {trackVersion} from '../src/network-track.js';
import {getMap} from '../src/map-catalog.js';
import {isMapEnabled} from '../src/enabled-maps.js';
import {resolveMap} from '../server/map-definitions.mjs';
import {TRACK_ROUTES} from '../src/attica-map-data.js';
const data=JSON.parse(readFileSync(new URL('../data/maps/psychiko/map.json',import.meta.url))),route=new Route(data.route);
route.urban=()=>.85;route.seaR=route.seaL=()=>999;route.district=()=> 'town';
const bytes=readFileSync(new URL('../data/maps/psychiko/terrain.bin',import.meta.url)),terrain=new Terrain(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const map={id:'psychiko',data,route,terrain};map.roadNetwork=new RoadNetwork(map);
test('Psychiko is offered with the same geometry version in solo, selector and multiplayer',()=>{
 const meta=getMap('psychiko'),server=resolveMap(meta,data);assert(isMapEnabled(meta.id));assert.equal(meta.length,route.length);assert(TRACK_ROUTES.psychiko.path);assert.equal(server.track.version,trackVersion(data.route));
 assert.equal(server.definitions.get('psychiko-race').len,2*route.length);assert(server.definitions.has('free:psychiko'));assert.deepEqual(meta.eventIds,data.events.map(e=>e.id));
});
test('carved street bed clears both full carriageways and pavements at the lap seam',()=>{
 const h=terrain.H.slice(),before=Array.from(route.Y);map.roadNetwork.source=terrain.H.slice();cutMountainRoads(terrain,route,h,map.roadNetwork);
 for(let s=-20;s<=route.length+20;s+=2)for(let u=-6.5;u<=6.5;u+=1){const p=route.point(s,u);assert(triangleHeight(terrain,h,p.x,p.z)<p.y-.1,`terrain intersects s=${s} u=${u}`);}
 assert.deepEqual(Array.from(route.Y),before);
 const g=new Ground(map,(x,z)=>triangleHeight(terrain,h,x,z),{network:null});
 for(const s of [-1,0,1,route.length-1,route.length+1,1600,2400])for(const u of [-5,0,5]){const p=route.point(s,u),q=g.at(p.x,p.z,s,u,{});assert.equal(q.surf,u?'pavement':'asphalt');assert(Math.abs(q.y-(p.y+(u?.16+.02*(Math.abs(u)-4.05)/(1.98):0)))<.03);}
});
test('both authored events pass every gate and finish with correct lap counts',()=>{
 for(const def of data.events){const ev=new EventRun(def,{route,marks:data.marks},{storage:{getItem:()=>null}});ev.start();let time=0,finished=false;
  for(let s=-4;s<ev.r.s1+4;s+=2){const p=route.point(s,0);time+=.1;const out=ev.update(.1,{s,u:0,x:p.x,y:p.y,z:p.z,t:time,kmh:72});assert.equal(ev.checkpoint.missed,false);finished ||=out.some(q=>q.kind==='finish');}
  assert(finished);assert.equal(ev.lapTimes.length,def.laps);assert.equal(ev.cpIdx,ev.r.checkpoints.length);assert.equal(resolve(def,{route,marks:data.marks}).len,route.length*def.laps);
 }
});
test('route projections preserve unwrapped progress and elevation across laps',()=>{
 for(let s=-30;s<=route.length*2+30;s+=5){const p=route.point(s,1.4),q=route.project(p.x,p.z,s,10);assert(Math.abs(q.s-s)<.8);assert(Math.abs(q.u-1.4)<.4);const back=route.point(q.s,q.u);assert(Math.hypot(back.x-p.x,back.z-p.z)<.8);assert(Math.abs(route.y(s)-route.y(s+route.length))<1e-6);}
});
