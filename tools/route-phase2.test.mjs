import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {fixture} from './fixtures/routes/fixture.mjs';import {resolveRoutePath,compileRoute} from '../src/route-compile.js';import {RouteRuntime} from '../src/route-runtime.js';import {RouteNavigation} from '../src/route-navigation.js';import {RouteClosures} from '../src/route-closures.js';import {trafficSuccessors} from '../src/world-traffic.js';import {routeEvent} from '../src/route-events.js';import {setupFields,applySetup} from '../src/race-setup.js';import {WorldRoadGraph} from '../src/world-tile-graph.js';import {readFile} from 'node:fs/promises';

test('waypoint search permits a reused edge inside one leg when history requires the loop',()=>{
 const f=fixture(),g=f.graph;const a=g.edges.get('a').value,b=g.edges.get('b').value,c=g.edges.get('c').value;
 const d={id:'d',from:c.to,to:a.from,points:[c.points.at(-1),a.points[0]],surface:'road-d',layer:0,flags:0},end={id:'end',from:a.to,to:'end-node',points:[a.points.at(-1),[0,0,100]],surface:'road-end',layer:0,flags:0};
 for(const e of [d,end]){g.edges.set(e.id,{value:e});if(!g.outgoing.has(e.from))g.outgoing.set(e.from,new Set());g.outgoing.get(e.from).add(e.id);}
 const legal=g.legal.bind(g);g.legal=(from,to,history=[])=>legal(from,to)&&!(to.id==='end'&&history.filter(id=>id==='a').length<2);
 const def={...f.definition,finish:{edgeId:'end',offsetM:80,lateralM:0,yawRad:Math.PI/2},path:{waypoints:[{x:100,z:400,layer:0,headingRad:0,snapM:1},{x:20,z:100,layer:0,headingRad:Math.PI/2,snapM:1}]}};
 assert.deepEqual(resolveRoutePath(def,g),['a','b','c','d','a','end']);
});

test('Faros source preserves its concrete two-lap event, disabled TT, reviewed ways and no reverse',async()=>{
 const def=JSON.parse(await readFile(new URL('../data/routes/psychiko-faros.route.json',import.meta.url))),legacy=JSON.parse(await readFile(new URL('../data/maps/psychiko/map.json',import.meta.url))),closures=JSON.parse(await readFile(new URL('../data/routes/psychiko-faros.closures.json',import.meta.url)));
 assert.equal(def.kind,'circuit');assert.equal(def.laps,2);assert.equal(def.allowReverse,false);assert.equal(def.rivals,2);assert.deepEqual(def.events.map(e=>[e.id,e.laps,e.enabled!==false]),[['psychiko-race',2,true],['psychiko-tt',1,false]]);
 assert.equal(closures.blocks.length,legacy.roadworks.length);assert.deepEqual(def.closureIds,legacy.roadworks.map(b=>b.id));
 for(const way of [465224134,25053095,25053533,97722998,97723002,31486851,97723004,25053494,634346640,662139350,371561413])assert.ok(def.path.edges.some(id=>id.startsWith('osm:way:'+way+':')),String(way));
 const frozen=JSON.parse(await readFile(new URL('./world-gen/overrides/psychiko.json',import.meta.url)));assert.equal(frozen.height.sigmaM,20);assert.ok(frozen.height.planes.length>=6);assert.ok(frozen.ways.length>=600);
});

test('race-only closures have neither mesh nor collider in free roam, including after race -> free',()=>{
 const tiles=new Map([['0,0',{state:'active'}]]),scene=new THREE.Scene(),session={stream:{tiles,origin:{x:0,z:0},contact:()=>({y:0})},subscribeTiles:()=>()=>{}},closure=new RouteClosures(session,scene,[{id:'exit',x:100,z:100,yaw:0,hl:4,hw:.65}]);
 closure.setEvent({type:'free'});assert.equal(scene.children.length,0);assert.equal(closure.colliders.length,0);
 closure.setEvent({type:'sprint'});assert.equal(closure.colliders.length,1);assert.ok(scene.children.length>0);assert.equal(closure.safe({x:100,z:100,yaw:0},{halfLength:2.5,halfWidth:1}),false);
 closure.setEvent({type:'free'});assert.equal(scene.children.length,0);assert.equal(closure.colliders.length,0);closure.dispose();closure.dispose();
});

test('civilian graph turns can branch away from the race and respect closures/restrictions',()=>{
 const f=fixture(),g=f.graph,a=g.edges.get('a').value,b=g.edges.get('b').value,branch={...b,id:'alphabetically-first-side-street',to:'side-street'};g.edges.set(branch.id,{value:branch});g.outgoing.get(a.to).delete('exit');g.outgoing.get(a.to).add(branch.id);
 assert.deepEqual(new Set(trafficSuccessors(g,a).map(e=>e.id)),new Set(['b',branch.id]));assert.deepEqual(trafficSuccessors(g,a,{blocksEdge:e=>e.id===branch.id}).map(e=>e.id),['b']);g.turns.set('no',{value:{from:a.id,via:a.to,to:branch.id,rule:1}});assert.deepEqual(trafficSuccessors(g,a).map(e=>e.id),['b']);
});

test('a newly spawned graph traffic actor has finite route coordinates before rival AI sees it',async()=>{
 const {WorldTraffic}=await import('../src/world-traffic.js'),edge={id:'branch',from:'n0',to:'n1',points:[[0,0,200],[0,0,220]],layer:0,flags:0},car={type:{},crashed:true,wid:2,len:4,mass:1200,m:{root:{visible:false}}},route={project:()=>({s:210,u:12})};
 const session={roads:{graph:{edges:new Map([[edge.id,{value:edge}]]),outgoing:new Map(),legal:()=>true}}},traffic=new WorldTraffic(session,{},route);
 traffic.pool={rng:{next:()=>0},pickFree:()=>car,initDrive:c=>{c.drv={vf:1};}};traffic.cars=[car];traffic.level=1;traffic.candidate=()=>({x:0,y:0,z:210,yaw:Math.PI,edge:edge.id,edgeId:edge.id,layer:0});
 traffic.spawn({x:0,z:0},[]);assert.equal(car.active,true);assert.equal(car.crashed,false,'a reused graph pool slot must drive after its earlier wreck');assert.deepEqual([car.veh.s,car.veh.u,car.s,car.u],[210,12,210,12]);assert.equal(car.veh.halfL,2);assert.equal(car.veh.halfW,1);
});

test('off-route notices debounce for .75 s, wrong direction for 1 s, and share a five-second limit',async()=>{
 const f=fixture(),r=new RouteRuntime(await compileRoute(f.definition,f.graph,f.contacts)),nav=new RouteNavigation(r),base={position:r.point(100),heading:r.frame(100).yaw,speed:10,earnedS:100,contact:{y:0,layer:0,surfaceId:'road-a'}};
 let state;for(let i=1;i<=7;i++)state=nav.update({...base,position:r.point(100,20),dt:.1,time:i*.1});assert.equal(state.notice,null);state=nav.update({...base,position:r.point(100,20),dt:.1,time:.8});assert.equal(state.notice,'RETURN TO ROUTE');assert.equal(state.rejoinS,100);
 for(let i=0;i<20;i++){state=nav.update({...base,heading:base.heading+Math.PI,dt:.1,time:1+i*.1});assert.equal(state.notice,null);}state=nav.update({...base,heading:base.heading+Math.PI,dt:.1,time:6});assert.equal(state.notice,'WRONG WAY');
 nav.reset();for(let i=0;i<11;i++)state=nav.update({...base,speed:-10,dt:.1,time:i*.1});assert.equal(state.wrongWay,false,'aligned reversing earns no progress and is exempt from WRONG WAY');
});

test('native route setup offers 0–2 rivals, traffic, police, conditions and laps, with reverse withheld',async()=>{
 const f=fixture(),c=await compileRoute(f.definition,f.graph,f.contacts);c.id='psychiko-faros';c.definition.kind='circuit';c.definition.events[0].rivals=2;const def=routeEvent(c),fields=setupFields(def,{closed:true});
 assert.equal(fields.find(f=>f.key==='rivals').max,2);for(const key of ['traffic','police','policeLevel','busted','laps','time','weather'])assert.ok(fields.some(f=>f.key===key),key);assert.ok(!fields.some(f=>f.key==='reverse'));
 const run=applySetup(def,{rivals:99,traffic:2,laps:3,police:true,policeLevel:'tough',busted:false,time:'night',weather:'rain'},{closed:true});assert.equal(run.rivals,2);assert.equal(run.traffic,2);assert.equal(run.laps,3);assert.equal(run.rules.police,true);assert.equal(run.rules.policeLevel,'tough');assert.equal(run.conditions.weather,'rain');
 assert.deepEqual(setupFields({...def,pilot:true},{closed:true}),[]);
});

test('chunked graph install is removable after a partial activation and a failed portal check',()=>{
 const g=new WorldRoadGraph(),pack={roadGraph:{nodes:Array.from({length:100},(_,i)=>({id:'n'+i,x:i,y:0,z:0})),edges:[],turns:[]}},steps=g.installSteps('a',pack,{batchSize:8});steps.next();assert.equal(g.nodes.size,8);g.remove('a');assert.equal(g.nodes.size,0);steps.return();g.install('a',pack);assert.equal(g.nodes.size,100);assert.throws(()=>g.install('b',{roadGraph:{nodes:[{id:'n0',x:3,y:0,z:0}],edges:[],turns:[]}}),/Conflicting/);assert.equal(g.nodes.get('n0').refs,1);g.dispose();assert.equal(g.nodes.size,0);
});

test('world tow applies the locked 40 m road-edge preference and never lands before earned progress',async()=>{
 const {planWorldTow}=await import('../src/tow-placement.js');const route={project(x,z){return {s:z,u:x,leftM:3,rightM:3,distance:Math.abs(x),layer:0,surfaceId:'route',edgeId:'route'};},frame:()=>({tx:0,tz:1})},candidates=[{x:0,y:0,z:100,yaw:Math.PI,edgeId:'route',layer:0,surfaceId:'route'},{x:43,y:0,z:100,yaw:Math.PI,edgeId:'street',layer:0,surfaceId:'street'}],course={s0:0,validProgress:90,lastRoad:{s:100}};
 const choose=x=>planWorldTow({pose:{x,y:0,z:100,yaw:Math.PI},course,route,roadCandidates:candidates});assert.equal(choose(43).kind,'route');assert.equal(choose(43.001).kind,'road');assert.equal(planWorldTow({pose:{x:2,y:0,z:100,yaw:Math.PI},course:{...course,validProgress:101},route,roadCandidates:candidates}).kind,'road');
});

test('distant rivals follow compiled occurrences for two laps, pin no corridor and rehydrate beyond the visible bubble',async()=>{
 const {RouteRivals}=await import('../src/route-rivals.js'),{buildCourse,courseComplete}=await import('../src/course.js'),f=fixture();f.graph.edges.clear();f.graph.outgoing.clear();const points=[[100,0,400],[100,0,100],[400,0,100],[400,0,400],[100,0,400]];for(let i=0;i<4;i++){const id='abcd'[i],e={id,from:'n'+i,to:'n'+((i+1)%4),points:[points[i],points[i+1]],surface:'circuit',layer:0,flags:1};f.graph.edges.set(id,{value:e});f.graph.outgoing.set(e.from,new Set([id]));}f.contacts.contact=()=>({y:0,flags:1,layer:0,surfaceId:'circuit'});f.contacts.surfaceAllowed=()=>true;
 const compiled=await compileRoute({...f.definition,id:'fixture-loop',kind:'circuit',lengthM:1200,laps:2,path:{edges:['a','b','c','d','a']},start:{edgeId:'a',offsetM:80,lateralM:0,yawRad:0},finish:{edgeId:'a',offsetM:80,lateralM:0,yawRad:0},sectorsM:[]},f.graph,f.contacts),route=new RouteRuntime(compiled),make=()=>({veh:{...route.point(0),s:0,vLong:20,halfW:1,halfL:2.5},model:{root:{visible:true}},course:buildCourse({s0:0,s1:2400,dir:1,laps:2},route),finish:null}),car=make(),extra=make(),rivals=new RouteRivals(route);let nearSteps=0;
 const options={ready:()=>true,safe:()=>true,step:()=>nearSteps++,now:0};for(let i=1;i<=2000&&car.finish==null;i++){options.now=i*.1;rivals.update(.1,[car],{x:10000,z:10000},options);}assert.equal(car.distant,true);assert.equal(nearSteps,0);assert.equal(courseComplete(car.course),true);assert.ok(car.finish>100);assert.ok(car.veh.s>=2400);assert.equal(rivals.interests([car],{x:10000,z:10000}).length,0);
 const p=route.point(car.distantS);rivals.update(.1,[car],{x:p.x+400,z:p.z},options);assert.equal(car.distant,true);rivals.update(.1,[car],{x:p.x+550,z:p.z},options);assert.equal(car.distant,false);assert.equal(car.model.root.visible,true);
 rivals.update(.1,[make(),make(),extra],{x:10000,z:10000},options);assert.equal(extra.distant,undefined,'a third actor is never simulated');
});


test('minimap return path ends at the earned rejoin point within its final edge',async()=>{
 const {returnRoutePoints}=await import('../src/route-navigation.js'),g=fixture().graph,p=returnRoutePoints({edges:['a','b'],start:{x:100,z:300},end:{x:250,z:100}},g);assert.deepEqual(p[0],[100,0,300]);assert.deepEqual(p.at(-1),[250,0,100]);assert.ok(p.every(v=>v[0]<=250));
});

test('lane centres of every published route stay on route, including regional hairpins and both directions',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{readRouteInputs}=await import('./route-input.mjs');
 const dir=await mkdtemp(join(tmpdir(),'athens-route-lanes-'));
 try{const shard=JSON.parse(await readFile(new URL('../data/routes/validation/athens.inputs.json',import.meta.url)));await writeFile(join(dir,'world.json'),JSON.stringify({revision:shard.worldSetRevision,tiles:shard.cells}));
 const input=await readRouteInputs({world:join(dir,'world.json'),graph:new URL('../data/routes/validation/athens.inputs.json',import.meta.url)});
 for(const id of ['syntagma-pilot','riviera-coast','psychiko-faros','penteli-hill','penteli-descent','megara-club']){
  const def=JSON.parse(await readFile(new URL(`../data/routes/${id}.route.json`,import.meta.url))),r=new RouteRuntime(await compileRoute(def,input.graph,input.contacts,{closures:new Set(def.closureIds||[])}));
  const surfaces=new Set([...input.graph.edges.values()].map(({value:e})=>e.layer+'|'+e.surface));
  r.contactAllowed=(q,p)=>q.layer===p.layer&&(q.surfaceId===p.surfaceId||surfaces.has(p.layer+'|'+p.surfaceId));
  for(const side of [-1,1]){const nav=new RouteNavigation(r);let time=0;
   for(let s=0;s<r.length;s+=5){const f=r.frame(s),u=side*Math.min(2,(side<0?f.leftM:f.rightM)/2),p=r.point(s,u),state=nav.update({dt:.9,position:p,heading:f.yaw,speed:20/3.6,earnedS:s,time:time+=.9,contact:{y:p.y,layer:f.layer,surfaceId:f.surfaceId}});
    assert.equal(state.offRoute,false,`${id} lane ${side} at ${s}: ${JSON.stringify(state)}`);assert.equal(state.notice,null,`${id} lane ${side} at ${s}`);
   }
  }
 }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('navigation reacquires a legal lane after recovery beyond its hint without granting course progress',async()=>{
 const f=fixture(),r=new RouteRuntime(await compileRoute(f.definition,f.graph,f.contacts)),nav=new RouteNavigation(r),s=600,p=r.point(s),fr=r.frame(s);
 for(let i=0;i<10;i++){const state=nav.update({dt:.1,position:p,heading:fr.yaw,speed:5,earnedS:10,time:i*.1,contact:{y:p.y,layer:fr.layer,surfaceId:fr.surfaceId}});assert.equal(state.offRoute,false);assert.equal(state.notice,null);assert.equal(state.rejoinS,10);assert.ok(Math.abs(state.s-s)<.01);}
});
