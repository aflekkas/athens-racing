import {wheelGround} from '../src/wheel-ground.js';
import * as THREE from 'three';import {buildRoadNetwork} from '../src/road-network.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {roundaboutLoops,legalRoundaboutCourse} from './roundabouts.mjs';
import {extractRoadNetwork} from './build-road-network.mjs';
import {buildRoadGraph} from '../src/road-graph.js';
import {Route,Terrain} from '../src/map.js';import {RoadNetwork} from '../src/road-network-surface.js';import {DrivableCorridor} from '../src/drivable-corridor.js';
import {RacingLine} from '../src/rival-ai.js';import {Ground} from '../src/ground.js';
import {islandRing,insideIsland,circulatingPoint,ringStation,roundaboutYield,entryYieldDistance,polylinePoint,ringPoint} from '../src/roundabouts.js';
const elements=JSON.parse(gunzipSync(fs.readFileSync(new URL('./maps/psychiko/raw/osm.json.gz',import.meta.url)))).elements;
const data=JSON.parse(fs.readFileSync(new URL('../data/maps/psychiko/map.json',import.meta.url))),r=new Route(data.route);
const project=n=>[(n.lon-data.proj.lon0)*data.proj.mlon,-(n.lat-data.proj.lat0)*data.proj.mlat],loops=roundaboutLoops(elements,project);
test('split and closed OSM roundabouts form CCW rings, with implicit one-way directed edges',()=>{
 assert(loops.some(l=>l.ways.length>1));assert(loops.length>=15);
 for(const loop of loops){assert.equal(loop.nodes[0],loop.nodes.at(-1));let area=0;loop.p.forEach((p,i)=>{const q=loop.p[(i+1)%loop.p.length];area+=p[0]*q[1]-p[1]*q[0];});assert(area<0);}
 const graph=buildRoadGraph(data.roadNetwork.roads);
 for(const road of data.roadNetwork.roads.filter(r=>r.junction==='roundabout')){assert.equal(road.oneway,1);const edges=graph.edges.filter(e=>e.road===road.id);assert(edges.length);for(const edge of edges)assert(!edges.some(e=>e.from===edge.to&&e.to===edge.from));}
});
test('geometry-only OSM sources retain implicit one-way loops and reverse one-way tags',()=>{
 const d={proj:{lon0:0,lat0:0,mlon:1,mlat:1},route:{x:[0,100],z:[0,0],width:[6,6],step:100}};
 const n=extractRoadNetwork(d,[{type:'way',id:1,tags:{highway:'residential',junction:'roundabout'},geometry:[{lon:30,lat:-30},{lon:50,lat:-30},{lon:50,lat:-50},{lon:30,lat:-50},{lon:30,lat:-30}]},{type:'way',id:2,tags:{highway:'service',oneway:'-1'},geometry:[{lon:60,lat:-30},{lon:60,lat:-60}]}]);
 assert.equal(n.roundabouts.length,1);assert(n.roads.every(r=>r.oneway));assert.equal(n.roads.find(r=>r.id===2).p[1],60);
});
test('source course uses only forward edges around every roundabout, including implicit one-way ways',()=>{
 const source=JSON.parse(fs.readFileSync(new URL('./maps/psychiko/raw/route.json',import.meta.url))),chain=source.sourceNodeIds;
 for(const loop of loops){for(let i=1;i<chain.length;i++){const a=loop.nodes.slice(0,-1).indexOf(chain[i-1]),b=loop.nodes.slice(0,-1).indexOf(chain[i]);if(a>=0&&b>=0)assert.equal((a+1)%(loop.nodes.length-1),b);}}
 assert.equal(r.roundabouts.length,3,'the Garden Circuit passes the Kamara and Areaki roundabouts and the Venizelou hub');
});
test('racing line, route marks, and both civilian travel directions stay outside island polygons',()=>{
 const islands=data.roadNetwork.roundabouts.map(q=>({id:q.id,p:islandRing(q.p,q.w/2+.12)})),line=new RacingLine(r);
 for(let i=0;i<line.n;i++)for(const island of islands)assert(!insideIsland(line.x[i],line.z[i],island.p),`racing line ${i*line.step} crosses ${island.id}`);
 for(const mark of data.marks){const p=r.point(mark.s,0);for(const island of islands)assert(!insideIsland(p.x,p.z,island.p));}
 for(const q of r.roundabouts)for(const dir of[-1,1]){let previous=null;for(let t=0;t<=1;t+=.005){const s=dir>0?q.s0+(q.s1-q.s0)*t:q.s1-(q.s1-q.s0)*t,p=circulatingPoint(r,{s,u:dir*1.77,dir},{}),station=ringStation(p.x,p.z,q.p);for(const island of islands)assert(!insideIsland(p.x,p.z,island.p));if(dir>0&&previous!==null&&t>.05&&t<.95){const ds=((station.s-previous+station.length/2)%station.length+station.length)%station.length-station.length/2;assert(ds>=-.05,`clockwise path ${q.id} ${dir} ${t}`);}previous=station.s;}}
});
test('island contact is grass and the recovery corridor excludes its interior',()=>{
 const bytes=fs.readFileSync(new URL('../data/maps/psychiko/terrain.bin',import.meta.url)),terrain=new Terrain(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));r.urban=()=>.85;r.seaR=r.seaL=()=>999;
 const map={id:'psychiko',route:r,terrain,data},network=new RoadNetwork(map),ground=new Ground(map,(x,z)=>terrain.height(x,z),{network}),corridor=new DrivableCorridor(r,network,terrain);
 for(const island of network.islands){const x=island.ring.reduce((s,p)=>s+p[0]/island.ring.length,0),z=island.ring.reduce((s,p)=>s+p[1]/island.ring.length,0);if(!insideIsland(x,z,island.ring))continue;assert.equal(network.sample(x,z),null);assert(corridor.distance(x,z)>0);const q=r.project(x,z);const contact=ground.at(x,z,q.s,q.u,{});assert.equal(contact.surf,'grass');assert.equal(wheelGround(r,{},contact,q.s,0).paved,false,'island contact overrides even an overlapping closed-route strip');assert.equal(wheelGround(r,{},contact,q.s,0).step,.14);}
});
test('entry yields to a circulating car approaching the merge, then releases the gap',()=>{
 assert(roundaboutYield({id:1},[{id:2,circulating:true,distance:25,speed:6}]));assert(!roundaboutYield({id:1},[{id:2,circulating:false,distance:0,speed:6}]));assert(!roundaboutYield({id:1},[{id:2,circulating:true,distance:100,speed:2}]));
 const q=r.roundabouts.find(q=>!q.reverse),entrant={s:q.s0-12,dir:1,len:4.5},circulating={s:q.s0+(q.s1-q.s0)*.08,dir:-1,u:-1.77,v:4,active:true};
 assert(entryYieldDistance(r,entrant,[circulating])!==null);assert.equal(entryYieldDistance(r,entrant,[]),null);assert.equal(entryYieldDistance(r,{s:q.s0+5,dir:1},[circulating]),null);
});

test('streets, markings and island kerbs stay in one material per spatial road chunk',()=>{
 const route={N:0,length:100,closed:false,step:2,edge:()=>3,project:(x,z)=>({s:x,u:z+1000}),surfaceY:()=>0,point:(s,u)=>({x:s,z:u,y:0})},terrain={GX:3,GZ:3,T:1000,minX:-1000,minZ:-1000,H:new Float32Array(9)},roads=[{id:1,h:'residential',sf:'asphalt',urban:1,w:5.5,oneway:1,junction:'roundabout',p:[100,100,100,120,120,120,120,100,100,100]}],network=new RoadNetwork({route,terrain,data:{roadNetwork:{roads,roundabouts:[{id:1,p:[[100,100],[100,120],[120,120],[120,100]],w:5.5}]}}}),root=buildRoadNetwork(network,new THREE.Group());
 assert.equal(root.children.length,network.stats.tiles);assert.equal(new Set(root.children.map(m=>m.material)).size,1);
 for(const mesh of root.children){const g=mesh.geometry;assert.equal(g.attributes.aRoadHalfWidth.count,g.attributes.position.count);assert.equal(g.attributes.uv.count,g.attributes.position.count);assert([...g.attributes.color.array].some(v=>v===2));assert([...g.attributes.color.array].filter((_,i)=>i%3===1).every(v=>v===0));}
});
test('the traffic integrator circulates CCW in world space and returns to its intended exit',async()=>{
 const {Traffic}=await import('../src/traffic.js');
 for(const q of r.roundabouts)for(const dir of[-1,1]){
  const c={active:true,type:{},m:{root:new THREE.Group(),body:new THREE.Group(),tail:{},wheels:[]},s:dir>0?q.s0+.1:q.s1-.1,u:dir*1.77,dir,len:4.5,wid:1.8,v:3,wheel:0,drv:{vf:1,a:1.5,b:2,T:1.2,s0:2}},t={route:r,cars:[c],racers:[],roadSpeed:()=>8,point:(c,o)=>circulatingPoint(r,c,o),idm:Traffic.prototype.idm,laneUOf:()=>dir*1.77};let entered=false,last=null;
  for(let i=0;i<18000;i++){Traffic.prototype.driveRoundabout.call(t,c,1/60);if(c._roundabout){entered=true;assert(!insideIsland(c._world.x,c._world.z,islandRing(q.p,q.w/2+.12)));Traffic.prototype.sync.call({...t,syncFrame:{},syncRiders(){},proxies:{begin(){},end(){}}},c.s);assert.equal(c.m.root.position.x,c._world.x);assert.equal(c.m.root.position.z,c._world.z);const at=ringStation(c._world.x,c._world.z,q.p);if(last!==null&&c._roundabout.circulating){const ds=((at.s-last+at.length/2)%at.length+at.length)%at.length-at.length/2;assert(ds>=-.001);}last=c._roundabout.circulating?at.s:null;}else{assert(Math.abs(c.s-(dir>0?q.s1:q.reverse?.s0??q.s0))<.2);break;}}
  assert(entered);assert.equal(c._roundabout,null);
 }
});

test('reverse traffic uses the legal incoming and outgoing OSM arms, including explicit one-way tags',()=>{
 const ways=new Map(elements.filter(w=>w.type==='way').map(w=>[w.id,w]));
 assert(r.roundabouts.some(q=>q.reverse),'at least one roundabout has a street-legal reverse plan (the other has a one-way arm)');
 for(const q of r.roundabouts.filter(q=>q.reverse)){const reverse=q.reverse;assert(reverse.s0<q.s0&&reverse.s1>q.s1);
  for(let i=0;i<reverse.sourceWayIds.length;i++){const w=ways.get(reverse.sourceWayIds[i]),a=reverse.sourceNodeIds[i],b=reverse.sourceNodeIds[i+1],index=w.nodes.indexOf(a);assert(w.nodes[index-1]===b||w.nodes[index+1]===b);if(w.tags.oneway==='yes')assert.equal(w.nodes[index+1],b);if(w.tags.oneway==='-1')assert.equal(w.nodes[index-1],b);}
  let previous=null;for(let s=0;s<=reverse.length;s+=.25){const p=polylinePoint(reverse.path,s);for(const island of data.roadNetwork.roundabouts)assert(!insideIsland(p.x,p.z,islandRing(island.p,island.w/2+.12)));if(s>=reverse.entryDistance&&s<=reverse.exitDistance){const at=ringStation(p.x,p.z,q.p);if(previous!==null)assert((at.s-previous+at.length)%at.length<1);previous=at.s;}}
 }
});

test('a reverse-traffic approach stops at its yield line and enters after circulation clears',async()=>{
 const {Traffic}=await import('../src/traffic.js'),q=r.roundabouts.find(q=>q.reverse),reverse=q.reverse,c={dir:-1,s:q.s1,u:-1.77,len:4.5,wid:1.8,v:8,wheel:0,drv:{vf:1,a:1.5,b:2,T:1.2,s0:2},_roundabout:{r:q,path:reverse.path,travel:reverse.entryDistance-5,length:reverse.length,entryDistance:reverse.entryDistance,exitDistance:reverse.exitDistance,exitS:reverse.s0,entryS:reverse.s1}};
 const entry=polylinePoint(reverse.path,reverse.entryDistance),at=ringStation(entry.x,entry.z,q.p),leader={active:true,len:4.5,v:0,_roundabout:{r:q,circulating:true},_world:ringPoint(q.p,at.s-5)},traffic={route:r,cars:[c,leader],racers:[],roadSpeed:()=>8,point:(c,o)=>circulatingPoint(r,c,o),idm:Traffic.prototype.idm,laneUOf:()=>-1.77};
 for(let i=0;i<120;i++)Traffic.prototype.driveRoundabout.call(traffic,c,1/60);assert(c._roundabout.travel<=reverse.entryDistance-c.len/2-2+.001);assert(!c._roundabout.circulating);
 traffic.cars=[c];for(let i=0;i<600&&c._roundabout.travel<reverse.entryDistance+1;i++)Traffic.prototype.driveRoundabout.call(traffic,c,1/60);assert(c._roundabout.travel>reverse.entryDistance);
});
test('shared-world snapshots render the actual road-space position and resume the legal path on promotion',async()=>{
 for(const q of r.roundabouts.filter(q=>q.reverse)){
 const {Traffic}=await import('../src/traffic.js'),{packCar}=await import('../src/shared-world-protocol.js'),{applySharedCar}=await import('../src/mp-shared-world.js'),c={id:0,s:q.s1-5,u:-1.77,dir:-1,len:4.5,wid:1.8,v:4,wheel:0,drv:{vf:1,a:1.5,b:2,T:1.2,s0:2},mass:1500,I:2500},traffic={route:r,cars:[c],racers:[],roadSpeed:()=>8,point:(c,o)=>circulatingPoint(r,c,o),idm:Traffic.prototype.idm,laneUOf:()=>-1.77,carBody:Traffic.prototype.carBody};
 Traffic.prototype.driveRoundabout.call(traffic,c,1/60);const point=c._world,row=packCar(traffic,c),remote={active:false,len:4.5,wid:1.8,indL:{},indR:{},flash:{},m:{},drv:c.drv};const guest={...traffic,cars:[remote],initDrive(){}};
 applySharedCar(guest,row,0);assert(remote._sharedPosition);const displayed=circulatingPoint(r,remote,{});assert(Math.hypot(displayed.x-point.x,displayed.z-point.z)<2,'road-space s/u reproduce the ring position within 2 m');
 applySharedCar(guest,row,0,true);Traffic.prototype.driveRoundabout.call(guest,remote,1/60);assert(remote._roundabout);assert(Math.hypot(remote._world.x-point.x,remote._world.z-point.z)<1);assert(!remote._sharedPosition);
 }
});
test('road elevation follows the shared Copernicus field along the whole lap',async()=>{
 const {readCopernicus,copernicusField,roundaboutPlanes,plannedHeight}=await import('./maps/psychiko/elevation.mjs');
 const field=copernicusField(readCopernicus(new URL('./maps/psychiko/raw/copernicus.json.gz',import.meta.url)),data.proj),height=plannedHeight(field,roundaboutPlanes(loops,field));let total=0,worst=0;
 for(let i=0;i<r.N;i+=5){const d=Math.abs(r.Y[i]-height(data.route.x[i],data.route.z[i]));total+=d;worst=Math.max(worst,d);}
 // Only the shared 14% two-metre grade cap trims the Diamantidou descent, by about 0.5 m.
 assert(worst<.6,`worst elevation gap ${worst}`);assert(total/(r.N/5)<.03);
});
