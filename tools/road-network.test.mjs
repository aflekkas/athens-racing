import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractRoadNetwork,readNetworkSource,ROAD_WIDTHS} from './build-road-network.mjs';
import {RoadNetwork,triangleHeight} from '../src/road-network-surface.js';
import {wheelGround} from '../src/wheel-ground.js';
const terrain={GX:3,GZ:3,T:10,minX:0,minZ:0,H:Float32Array.from([10,12,14,11,14,15,12,15,17])};
const route={length:100,closed:false,edge:()=>3,surfaceY:()=>10,project:(x,z)=>({s:x,u:z}),point:(s,u)=>({x:s,z:u,y:10})};
const roads=[{id:1,h:'residential',sf:'asphalt',urban:1,w:6,p:[0,20,20,20]},{id:2,h:'tertiary',sf:'asphalt',w:7,p:[10,0,10,30]}];
const make=()=>new RoadNetwork({route,terrain,data:{roadNetwork:{length:50,roads}}});
test('side asphalt and pavement use the same continuous height; their step belongs to wheelGround',()=>{const n=make(),a=n.sample(4,20),p=n.sample(4,23.7);assert.equal(a.surf,'asphalt');assert.equal(p.surf,'pavement');assert.equal(p.step,.14);assert.ok(Math.abs(a.y-n.height(4,20))<1e-9);const w=wheelGround(route,{}, {...p,network:true,networkStep:p.step},4,23.7);assert.equal(w.paved,true);assert.ok(Math.abs(w.plane-n.height(4,23.7))<1e-9);assert.equal(w.input,.14);assert.equal(n.sample(28,35),null);});
test('a crossing has asphalt priority over either pavement, and mouths open onto the race route',()=>{const n=make();assert.equal(n.sample(10,23.7).surf,'asphalt');assert.equal(n.mouth(10,1),true);assert.equal(n.mouth(70,1),false);assert.equal(n.height(10,3.55),10);});
test('DEM sampling follows terrain triangles rather than bilinear interpolation',()=>{assert.equal(triangleHeight(terrain,terrain.H,0,0),10);assert.equal(triangleHeight(terrain,terrain.H,10,10),14);assert.equal(triangleHeight(terrain,terrain.H,5,5),11.5);});
test('terrain carving only touches cells near roads and preserves the DEM source',()=>{const n=make(),h=terrain.H.slice(),before=h.slice();let stamps=0;n.prepareTerrain(h,()=>stamps++);assert.ok(stamps>0);assert.deepEqual(n.source,before);for(let i=0;i<h.length;i++)assert.ok(h[i]<=before[i]);});
test('wheel heights interpolate the generated triangle plane, including the pavement step',()=>{const n=make();n.installSurface([{pos:[0,10,20,10,12,20,0,11,30],col:[0,0,0,0,0,0,0,0,0]}]);assert.ok(Math.abs(n.height(2,22)-10.6)<1e-8);n.installSurface([{pos:[0,10.14,20,10,12.14,20,0,11.14,30],col:[1,0,0,1,0,0,1,0,0]}]);assert.ok(Math.abs(n.height(2,22)-10.6)<1e-8);assert.equal(n.meshHeight(20,20),null);});
test('extraction preserves highway classes and widths, excludes tunnels and unpaved surface lies',()=>{const d={proj:{lat0:0,lon0:0,mlon:1,mlat:1},route:{x:[0,20,40,60,80,100],z:[0,0,0,0,0,0],width:[6,6,6,6,6,6],step:20}};
 const way=(id,h,x,z,t={})=>({type:'way',id,tags:{highway:h,...t},geometry:[{lon:x,lat:-z},{lon:x,lat:-z-40}]});
 const n=extractRoadNetwork(d,[way(1,'residential',20,0),way(2,'service',40,20,{surface:'gravel'}),way(3,'primary',60,10,{tunnel:'yes'}),way(4,'footway',80,20),way(5,'secondary',100,700)]);
 assert.equal(n.roads.length,2);assert.equal(n.roads[0].w,ROAD_WIDTHS.residential);assert.equal(n.roads[1].sf,'gravel');assert.equal(n.roads[0].id,1);});
// Freeze each saved map and its saved OSM once before the test callbacks run.
// This exercises a repeatable build without allowing either pipeline to rewrite sources or routes.
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
const saved=['riviera','megara'].map(id=>({id,data:freeze(JSON.parse(fs.readFileSync(id==='riviera'?'data/map.json':`data/maps/${id}/map.json`))),osm:freeze(readNetworkSource('.',id))}));
for(const {id,data:d,osm} of saved)test(id+' complete surrounding roads reproduce from frozen saved OSM, with unchanged race-route arrays',()=>{const before=JSON.stringify(d.route),n=extractRoadNetwork(d,osm);assert.deepEqual(JSON.parse(JSON.stringify(n)),d.roadNetwork);assert.equal(JSON.stringify(d.route),before);assert.ok(n.roads.length>10);assert.ok(n.length>1000);assert.ok(n.roads.every(r=>r.p.every(Number.isFinite)&&r.w>=3&&r.w<=14&&Number.isFinite(r.v)&&['osm','inferred'].includes(r.vs)));});
