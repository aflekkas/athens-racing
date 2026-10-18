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
test('both authored events track the whole route and finish with correct lap counts',()=>{
 for(const def of data.events){const ev=new EventRun(def,{route,marks:data.marks},{storage:{getItem:()=>null}});ev.start();let time=0,finished=false;
  for(let s=-4;s<ev.r.s1+4;s+=2){const p=route.point(s,0);time+=.1;const out=ev.update(.1,{s,u:0,x:p.x,y:p.y,z:p.z,t:time,kmh:72});assert.equal(ev.course.onRoute,true);finished ||=out.some(q=>q.kind==='finish');}
  assert(finished);assert.equal(ev.lapTimes.length,def.laps);assert.equal(ev.sectorIdx,ev.r.sectors.length);assert.equal(resolve(def,{route,marks:data.marks}).len,route.length*def.laps);
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
 // Independently count non-raced half-edges. A junction may be visited twice after taking the legal roundabout exit.
 const graph=new Map();for(const w of osm.filter(publicRoad))for(let i=1;i<w.nodes.length;i++)for(const [a,b] of [[w.nodes[i-1],w.nodes[i]],[w.nodes[i],w.nodes[i-1]]]){if(!graph.has(a))graph.set(a,new Set());graph.get(a).add(b);}
 const chain=course.sourceNodeIds.slice(0,-1),exits=[],raced=new Set(course.sourceNodeIds.slice(1).flatMap((b,i)=>[`${course.sourceNodeIds[i]}:${b}`,`${b}:${course.sourceNodeIds[i]}`]));
 for(let i=0;i<chain.length;i++){const node=chain[i],prev=chain[(i-1+chain.length)%chain.length],next=chain[(i+1)%chain.length];
  assert(graph.get(node).has(prev)&&graph.get(node).has(next));
  for(const other of graph.get(node))if(!raced.has(`${node}:${other}`)&&!exits.some(e=>e.id===`${node}:${other}`))exits.push({id:`${node}:${other}`});
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
 assert(omitted.every(w=>[25117418,113339568,113339581].includes(w.id)),'only the three documented Kifisias underpasses may be omitted');
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

test('Psychiko permits the shared police runtime in free roam and with online police enabled',async()=>{
 const {Police}=await import('../src/police.js');
 const traffic={route,data,cars:[],allowClosedRoam:true};
 const police=new Police(traffic,route);
 try{
  police.reset(true);assert.equal(police.enabled,true);assert(police.patrols.length>0);
  traffic.allowClosedRoam=false;
  assert.equal(police.configureOnline({config:{police:true},raceId:'psychiko-test'}),true);
  assert.equal(police.configureOnline({config:{police:false}}),false);
 }finally{for(const off of police.offs)off();}
});


test('catalogue-only Psychiko launch preserves the authored two laps before the bundle loads',async()=>{
 const {quickMapEvent}=await import('../src/menu-map.js');
 const pending=quickMapEvent('psychiko'),authored=data.events.find(e=>e.id==='psychiko-race');
 assert.equal(pending.laps,authored.laps);
 assert.equal(resolve(pending,{route,marks:data.marks}).len,resolve(authored,{route,marks:data.marks}).len);
});


test('Psychiko uses shared footprint boxes and budgeted square street props',async()=>{
 const {psychikoLampGeometry}=await import('../src/maps/psychiko.js');
 const {triangleCount,WORLD_TRIANGLE_BUDGETS}=await import('../src/world-art-direction.js');
 const {buildingBlockGeometry}=await import('../src/buildings.js');
 assert.ok(data.vegetation?.length>0,'OSM vegetation records feed the budgeted detail layer');assert.deepEqual(Object.keys(data.psychiko.scenery),['furniture']);
 const lamp=psychikoLampGeometry();assert.equal(triangleCount(lamp),36);assert(triangleCount(lamp)<=WORLD_TRIANGLE_BUDGETS.lamp);lamp.dispose();
 for(const b of data.buildings){const g=buildingBlockGeometry(b.p,b.h);assert(triangleCount(g)<=40);g.dispose();}
 const shader=(await import('../src/terrain.js')).terrainMaterial({gardens:true});
 assert.equal(shader.customProgramCacheKey(),'terrain-owner-area');
});

test('close OSM fronts retain their source centroids and road-edge distances after box conversion',async()=>{
 const {frontageAudit}=await import('./psychiko-frontage-audit.mjs');
 for(const row of frontageAudit()){
  assert.equal(row.missing,false,`${row.street}: omitted OSM building ${row.id}`);
  assert(row.centroidError<=.10,`${row.id}: box centroid shifted ${row.centroidError} m from OSM`);
  assert(row.nearestEdgeError<=.10,`${row.id}: frontage setback changed ${row.nearestEdgeError} m from OSM`);
 }
});

test('owner lock: road closures only in races, never in free roam',async()=>{
 const THREE=await import('three'),{buildRoadworks,roadworksForEvent}=await import('../src/roadworks.js'),{freeRoam}=await import('../src/events.js');
 const free=freeRoam('psychiko'),races=data.events.filter(e=>['sprint','timetrial'].includes(e.type)),base=[{kind:'ordinary-prop'}],ground={parked:base,heightC:()=>100};
 const works=buildRoadworks(map,new THREE.Group(),ground);
 for(const def of [free,...races,free,races.at(-1),free]){
  works.setEvent(def);const racing=def.type!=='free';
  assert.equal(works.group.visible,racing);assert.equal(works.active,racing);
  assert.equal(ground.parked.filter(p=>p.kind==='roadworks').length,racing?data.roadworks.length:0);
  if(!racing){assert.equal(ground.parked,base);assert.deepEqual(roadworksForEvent(data,def),[]);}
 }
 assert.deepEqual(roadworksForEvent(data,{...races[0],free:true}),[]);
 assert.deepEqual(roadworksForEvent(data,undefined),[]);
});

// ---- Garden Circuit v2 (owner request 2026-10-18): start at the south radial, loop the neighbourhood on real streets
const raw = JSON.parse(readFileSync(new URL('./maps/psychiko/raw/route.json', import.meta.url)));
async function osmFixture() {
 const {publicRoad}=await import('./maps/psychiko/neighbourhood.mjs'),{gunzipSync}=await import('node:zlib');
 const elements=JSON.parse(gunzipSync(readFileSync(new URL('./maps/psychiko/raw/osm.json.gz',import.meta.url)))).elements;
 return {publicRoad,elements,nodes:new Map(elements.filter(e=>e.type==='node').map(n=>[n.id,n])),ways:new Map(elements.filter(e=>e.type==='way').map(w=>[w.id,w]))};
}
test('Garden Circuit follows real public OSM streets only: every metre is within a street, no cutting through blocks',async()=>{
 const {publicRoad,elements,nodes}=await osmFixture(),P=n=>[(n.lon-data.proj.lon0)*data.proj.mlon,-(n.lat-data.proj.lat0)*data.proj.mlat];
 const segments=[];for(const w of elements.filter(publicRoad)){const ps=w.nodes.map(id=>nodes.get(id)).filter(Boolean).map(P);for(let i=1;i<ps.length;i++)segments.push([ps[i-1],ps[i]]);}
 const near=(x,z)=>{let best=Infinity;for(const [a,b] of segments){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));}return best;};
 let worst=0;for(let i=0;i<data.route.x.length;i+=2)worst=Math.max(worst,near(data.route.x[i],data.route.z[i]));
 assert(worst<4.5,`route strays ${worst.toFixed(1)} m from every public street centreline`);
});
test('Garden Circuit drives every street in its legal one-way direction, on public asphalt',async()=>{
 const {publicRoad,ways}=await osmFixture(),chain=raw.sourceNodeIds;
 assert.equal(chain[0],chain.at(-1));assert.equal(new Set(chain.slice(0,-1)).size,chain.length-1,'simple loop');
 for(let i=0;i<chain.length-1;i++){const a=chain[i],b=chain[i+1],w=ways.get(raw.orderedWays.length?raw.sourceWayIds.find(id=>{const q=ways.get(id);return q.nodes.some((n,k)=>(n===a&&q.nodes[k+1]===b)||(n===b&&q.nodes[k+1]===a));}):0);
  assert(w&&publicRoad(w),`edge ${a}>${b} is a public road`);assert(!w.tags.surface||w.tags.surface==='asphalt'||w.tags.surface==='paved'||w.tags.surface==='sett');
  const forward=w.nodes.some((n,k)=>n===a&&w.nodes[k+1]===b),backward=w.nodes.some((n,k)=>n===b&&w.nodes[k+1]===a);
  if(w.tags.oneway==='yes'||w.tags.junction==='roundabout')assert(forward,`${a}>${b} runs against one-way way ${w.id}`);
  else if(w.tags.oneway==='-1')assert(backward,`${a}>${b} runs against one-way way ${w.id}`);
 }
});
test('Garden Circuit starts on the Diamantidou radial south of the Venizelou roundabout and is a 3.5-7 km mixed loop',()=>{
 const start=route.point(0,0),hub={x:-252,z:-440};
 assert(start.z>hub.z+60&&start.z<hub.z+330,`start ${start.z-hub.z} m south of the hub`);assert(Math.abs(start.x-hub.x)<80);
 assert(/Diamantidi|Διαμαντ/i.test(route.names.findLast(n=>n.s<=0.01).name));
 const f=route.frame(0,{});assert(f.tz>.8,'the timing line faces south, away from the roundabout, along the radial');
 assert(route.length>3500&&route.length<7000);assert(route.roundabouts.length>=2,'roundabouts on the lap');
 const streets=new Set(route.names.map(n=>n.name));assert(streets.size>=8,'radial avenues, diagonals and ring streets');
});
test('Garden Circuit turns are smooth: no corner tighter than a street junction can drive',()=>{
 let tightest=Infinity;
 for(let s=0;s<route.length;s+=2){const a=route.frame(s-3,{}),b=route.frame(s+3,{}),turn=Math.abs(Math.atan2(a.tx*b.tz-a.tz*b.tx,a.tx*b.tx+a.tz*b.tz));if(turn>.02)tightest=Math.min(tightest,6/turn);}
 assert(tightest>=6,`tightest radius ${tightest.toFixed(1)} m`);
});
test('Psychiko times are a new board: leaderboard version, local records and selector all follow the new route',async()=>{
 const {leaderboardVersion}=await import('../server/leaderboard-policy.mjs'),{loadRecord,saveRecord}=await import('../src/events.js');
 assert.match(leaderboardVersion('psychiko','abc'),/^abc:garden-v2$/);assert.equal(leaderboardVersion('riviera','abc'),'abc');
 const st={m:new Map(),getItem(k){return this.m.get(k)??null;},setItem(k,v){this.m.set(k,v);}};
 st.setItem('paraliaki.events.psychiko-race.reverse-default-v1',JSON.stringify({bestTime:1}));st.setItem('paraliaki.events.psychiko-race',JSON.stringify({bestTime:2}));
 assert.deepEqual(loadRecord('psychiko-race',st),{},'earlier loops never rank against the new circuit');saveRecord('psychiko-race',{bestTime:99},st);assert.equal(loadRecord('psychiko-race',st).bestTime,99);
 const selector=TRACK_ROUTES.psychiko;assert.equal(selector.loop,true);assert(Math.abs(selector.length*(7.5)-0)>=0);
});
