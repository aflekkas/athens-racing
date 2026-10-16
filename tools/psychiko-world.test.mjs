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
 for(const s of [-1,0,1,route.length-1,route.length+1,1600,2400])for(const u of [-route.edge(s)-1.1,0,route.edge(s)+1.1]){const p=route.point(s,u),q=g.at(p.x,p.z,s,u,{});assert.equal(q.surf,u?'pavement':'asphalt');assert(Math.abs(q.y-(p.y+(u?.16+.02*(Math.abs(u)-route.edge(s)-.55)/(1.98):0)))<.03);}
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

test('all public junction exits have exactly one solid race closure, with no raced edge blocked',async()=>{
 const {publicRoad}=await import('./maps/psychiko/neighbourhood.mjs');
 const {gunzipSync}=await import('node:zlib');
 const osm=JSON.parse(gunzipSync(readFileSync(new URL('./maps/psychiko/raw/osm.json.gz',import.meta.url)))).elements;
 const course=JSON.parse(readFileSync(new URL('./maps/psychiko/raw/route.json',import.meta.url)));
 // Independently count graph degree minus the two raced neighbours at each node.
 const graph=new Map();for(const w of osm.filter(publicRoad))for(let i=1;i<w.nodes.length;i++)for(const [a,b] of [[w.nodes[i-1],w.nodes[i]],[w.nodes[i],w.nodes[i-1]]]){if(!graph.has(a))graph.set(a,new Set());graph.get(a).add(b);}
 const chain=course.sourceNodeIds.slice(0,-1),exits=[];
 for(let i=0;i<chain.length;i++){const node=chain[i],prev=chain[(i-1+chain.length)%chain.length],next=chain[(i+1)%chain.length];
  assert(graph.get(node).has(prev)&&graph.get(node).has(next));
  for(const other of graph.get(node))if(other!==prev&&other!==next)exits.push({id:`${node}:${other}`});
 }
 assert.equal(data.roadworks.length,exits.length);assert.equal(new Set(data.roadworks.map(b=>b.id)).size,exits.length);
 assert.deepEqual(data.roadworks.map(b=>b.id).sort(),exits.map(b=>b.id).sort());
 for(const b of data.roadworks){const q=route.project(b.x,b.z),f=route.frame(q.s,{}),cross=Math.abs(-Math.sin(b.yaw)*f.rx-Math.cos(b.yaw)*f.rz);
  assert(Math.abs(q.u)-b.hl*cross-b.hw>route.edge(q.s)+.05,`${b.id} intrudes on raced carriageway`);
 }
});
test('race → free roam → race toggles every visual/collider and invalidates cached collision cells',async()=>{
 const THREE=await import('three'),{buildRoadworks,roadworksForEvent}=await import('../src/roadworks.js');
 const g=new Ground(map,(x,z)=>terrain.height(x,z),{network:map.roadNetwork});g.parked=[{x:900,z:900,hl:1,hw:1,yaw:0}];const base=g.parked;
 const works=buildRoadworks(map,new THREE.Group(),g);
 assert.equal(works.group.children.length,data.roadworks.length);
 for(const type of ['sprint','free','timetrial','free','sprint']){
  works.setEvent({type});const count=type==='free'?0:data.roadworks.length;
  assert.equal(roadworksForEvent(data,{type}).length,count);assert.equal(works.group.visible,count>0);assert.equal(works.active,count>0);
  assert.equal(g.parked.length,count+base.length);assert.equal(g._ph,null);
  const b=data.roadworks[0];const hit=g.walls(b.x,b.z,.5,{});
  if(count)assert.equal(hit.collider.kind,'roadworks');else assert(!hit||hit.collider.kind!=='roadworks');
 }
 works.setEvent({type:'free'});assert.equal(g.parked,base);
});
test('every preserved garden-course centreline sample remains on drivable asphalt',()=>{
 const old=JSON.parse(readFileSync(new URL('./maps/psychiko/raw/garden-route.json',import.meta.url)));
 let count=0;for(let i=0;i<old.x.length;i+=3){const x=old.x[i],z=old.z[i],q=route.project(x,z);
  assert(Math.abs(q.u)<=route.edge(q.s)+.3||map.roadNetwork.sample(x,z)?.surf==='asphalt',`old loop gap ${i*old.step}`);count++;
 }assert(count>700);
});
test('whole municipal street network and the interior of the drawing are included',async()=>{
 const {publicRoad,boundaryRing,inside}=await import('./maps/psychiko/neighbourhood.mjs'),{gunzipSync}=await import('node:zlib');
 const elements=JSON.parse(gunzipSync(readFileSync(new URL('./maps/psychiko/raw/osm.json.gz',import.meta.url)))).elements;
 const nodes=new Map(elements.filter(e=>e.type==='node').map(n=>[n.id,n])),p=n=>[(n.lon-data.proj.lon0)*data.proj.mlon,-(n.lat-data.proj.lat0)*data.proj.mlat];
 const ring=boundaryRing(JSON.parse(readFileSync(new URL('./maps/psychiko/raw/boundaries.json',import.meta.url))),p);
 const selected=new Set(data.psychiko.networkWayIds),drawn=data.route.x.map((x,i)=>[x,data.route.z[i]]);
 for(const w of elements.filter(publicRoad))if(w.nodes.some(id=>inside(p(nodes.get(id)),ring)||inside(p(nodes.get(id)),drawn)))assert(selected.has(w.id),`municipal way missing ${w.id}`);
 const rendered=new Set([...data.roadNetwork.roads.map(r=>r.id),...data.psychiko.sourceWayIds]);
 const omitted=elements.filter(w=>w.type==='way'&&selected.has(w.id)&&!rendered.has(w.id));
 assert.deepEqual(omitted.map(w=>w.id).sort((a,b)=>a-b),[25117418,113339568,113339581]);
 assert(omitted.every(w=>w.tags.tunnel==='yes'&&w.tags.layer==='-1'),'only documented grade-separated Kifisias underpasses may be omitted');
 assert(data.roadNetwork.length>50000);assert(data.roadNetwork.roads.length>400);
});
test('real vehicle physics cannot cross any roadworks box at 90 km/h; the same paths are open in free roam',async()=>{
 const {Vehicle}=await import('../src/physics.js');
 const catalogue=readFileSync(new URL('../src/cars.js',import.meta.url),'utf8');
 const spec=Function('return '+catalogue.split('export const CARS = ')[1].split('\n];')[0]+'\n];')().find(c=>c.id==='z4');
 for(const b of data.roadworks)for(const offset of [-b.hl+2.8,0,b.hl-2.8])for(const blocked of [true,false]){
  const tx=Math.cos(b.yaw),tz=-Math.sin(b.yaw),x0=b.x-tx*12,z0=b.z-tz*12;
  const r={closed:true,length:1000,wrap:s=>s,GR:null,frame:(s,o)=>Object.assign(o,{tx,tz,rx:-tz,rz:tx,grade:0,bank:0}),point:(s,u)=>({x:x0+s*tx-u*tz,z:z0+s*tz+u*tx,y:0}),y:()=>0,bank:()=>0,surfaceY:()=>0,urban:()=>0,edge:()=>900,lin:()=>0,project:(x,z)=>({s:(x-x0)*tx+(z-z0)*tz,u:(x-x0)*-tz+(z-z0)*tx})};
  const g=Object.assign(Object.create(Ground.prototype),{HC:20,bh:new Map(),parked:blocked?[b]:[],route:r,out:{},traps:[],heightC:()=>0,terrain:{cls:()=>0},hump:()=>0,limits:(s,w,o)=>Object.assign(o,{min:-900,max:900}),at:(x,z,s,u,o)=>Object.assign(o,{y:0,surf:'asphalt',hump:0,water:0,trap:null,network:false})});
  const v=new Vehicle(spec,r);v.reset(0,offset,25);v.ground=g;
  let furthest=-Infinity;for(let i=0;i<240;i++){v.update(1/240,{throttle:1,brake:0,steer:0});furthest=Math.max(furthest,(v.x-b.x)*tx+(v.z-b.z)*tz);}
  if(blocked)assert(furthest< -b.hw,`${b.id}: vehicle crossed solid closure (${furthest})`);
  else assert(furthest>8,`${b.id}: free-roam path was blocked`);
 }
});

test('Psychiko uses the shared two-rival grid and road-aware auto-tow corridor',async()=>{
 const {gridFor,freeRoam}=await import('../src/events.js');
 const {DrivableCorridor,corridorRecovery}=await import('../src/drivable-corridor.js');
 const race=data.events.find(e=>e.id==='psychiko-race');
 assert.equal(gridFor(race).length,2);
 const corridor=new DrivableCorridor(route,map.roadNetwork,terrain);
 for(let s=0;s<route.length;s+=31){const p=route.point(s,0);assert.equal(corridor.distance(p.x,p.z),0);}
 for(const seg of map.roadNetwork.segments.filter((_,i)=>i%37===0))assert.equal(corridor.distance((seg.ax+seg.bx)/2,(seg.az+seg.bz)/2),0);
 for(const free of [false,true])assert.equal(corridorRecovery({distance:60,mapId:'psychiko',freeRoam:free},0,{}).tow,true);
 assert.equal(freeRoam('psychiko').mapId,'psychiko');
});
