import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures/routes/fixture.mjs';import {compileRoute} from '../src/route-compile.js';import {roadLayersConnect} from '../src/world-tile-graph.js';import {allowedTurn} from '../src/route-geometry.js';import {trafficSuccessors,WorldTraffic} from '../src/world-traffic.js';import {WorldSignals} from '../src/world-signals.js';import {routeEvent} from '../src/route-events.js';import {applySetup,resolveSetup,setupFields} from '../src/race-setup.js';import {recordIdentity,migrateRouteRecords,routeHistory,historicalGhostIdentity} from '../src/route-migrations.js';import {getRouteHistoricalTimes} from '../src/personal-bests.js';import {AthensGround} from '../src/athens-ground.js';

test('rendered historical times use human course labels and never leak edition ids or hashes',async()=>{
 const {renderTrackTimes}=await import('../src/leaderboards-screen.js'),{historicalEditionLabel}=await import('../src/route-migrations.js');
 for(const [routeId,edition,label]of [['riviera-coast','legacy-riviera-4718fbec','Original Riviera track'],['psychiko-faros','legacy-faros-v3','Original Faros circuit'],['riviera-coast','unrecognized:abc123def456','Earlier course']]){
  const d={trackTimes:{loading:false,entries:[],history:[{time:420.25,date:'2026-10-20',car:'mini',identity:{routeId,edition}}],requested:true}},html=renderTrackTimes({screen:'test'},d,{routeId,historyEdition:edition});
  assert.ok(html.includes(label));assert.equal(html.includes(edition),false);assert.doesNotMatch(html,/4718fbec|abc123def456|LEGACY[-_]|legacy[-_]/);assert.equal(historicalEditionLabel(edition),label);
 }
 assert.equal(historicalEditionLabel('constructor'),'Earlier course');
});

for(const [kind,layer,flag]of [['tunnel',-1,4],['bridge',1,2]])test(`${kind}: compile mapped approach, correct deck and departure; reject stacked fork`,async()=>{
 const f=fixture(),a=f.graph.edges.get('a').value,b=f.graph.edges.get('b').value,c=f.graph.edges.get('c').value;b.layer=layer;b.flags|=flag;
 f.contacts.contact=(x,z,o)=>({y:0,layer:o.layer,flags:1,surfaceId:z>100.001?'road-a':x<500?'road-b':'road-c'});
 const compiled=await compileRoute(f.definition,f.graph,f.contacts);assert.deepEqual([...new Set(compiled.occurrences.map(o=>o.layer))],[0,layer]);assert.ok(allowedTurn(f.definition,f.graph,a,b));assert.equal(trafficSuccessors(f.graph,a).some(e=>e.id==='b'),true);
 const stacked={...b,id:'stacked',points:b.points.map(p=>[p[0],6,p[2]])};assert.equal(roadLayersConnect(a,stacked),false);assert.equal(allowedTurn(f.definition,f.graph,a,stacked),false);assert.equal(roadLayersConnect(a,{...b,from:'other-node'}),false);assert.equal(roadLayersConnect(a,{...b,flags:1}),false);
 f.graph.turns.set('no',{value:{from:a.id,via:a.to,to:b.id,rule:1}});assert.equal(allowedTurn(f.definition,f.graph,a,b),false);assert.equal(trafficSuccessors(f.graph,a).some(e=>e.id==='b'),false);
});

test('Riviera JSON preserves quick, full nominal course, two rivals and default traffic/police; reverse stays unavailable',async()=>{
 const d=JSON.parse(await readFile(new URL('../data/routes/riviera-coast.route.json',import.meta.url)));assert.equal(d.allowReverse,false);assert.equal(d.events.length,1);assert.equal(d.events[0].id,'quick');assert.equal(d.rivals,2);assert.equal(d.trafficLevel,1);assert.equal(d.police,true);assert.equal(d.signals,true);assert.ok(d.lengthM>10300&&d.lengthM<10400);assert.ok(d.path.edges.some(id=>id.startsWith('osm:way:25371523:')));assert.ok(!d.path.edges.some(id=>id.startsWith('osm:way:172988026:')));
 const event=routeEvent({id:d.id,regionId:d.regionId,lengthM:d.lengthM,definition:{...d,events:d.events.map(e=>({...e,enabled:true,laps:1}))},geometryHash:'hash'});assert.equal(resolveSetup(event).police,true);assert.equal(applySetup(event,{}).rules.police,true);assert.equal(applySetup(event,{police:false}).rules.police,false);assert.equal(setupFields(event).some(f=>f.key==='reverse'),false);
});

function signalFixture(){const f=fixture(),edge=f.graph.edges.get('a').value,rec={edge:'a',offset:0,group:0};const session={props:{time:21,byEdge:new Map([['a',rec]])},roads:{graph:f.graph,width:()=>({left:4,right:4})}};const route={project:()=>({s:391,edgeId:'a',distance:0})};return {signals:new WorldSignals(session,route),session,edge};}
test('tile signals retain red/amber/green laws with detail hidden; red crossing is finite, layer-aware and teleport-safe',()=>{
 const {signals:s,session}=signalFixture();s.update();assert.equal(s.J.length,1);assert.equal(s.J[0].main,'R');assert.equal(s.stopFor(370,1,10,{}),21);
 const a={x:100,y:0,z:112,yaw:0,halfL:0,layer:0,surfaceId:'road-a'},b={...a,z:106};assert.ok(s.crossed(a,b));assert.equal(s.crossed({...a,layer:1},{...b,layer:1}),null);assert.equal(s.crossed({...a,x:110},{...b,x:110}),null);assert.equal(s.crossed({...a,z:150},b),null);assert.equal(s.crossed(b,a),null);
 session.props.time=19.1;s.update();assert.equal(s.crossed(a,b),null,'red grace');session.props.time=10;s.update();assert.equal(s.stopFor(370,1,10,{}),null);session.props.time=17;s.update();assert.equal(s.J[0].main,'A');
});

test('police only witness the same physical deck and red offences never change time into a fine',()=>{
 const {session}=signalFixture();session.obstacles={contact:()=>null};session.roads.graph.nearest=()=>null;const traffic=new WorldTraffic(session,{},{});traffic.policeEnabled=true;traffic.tuning={witnessRange:135,pursuitRange:250,speedMargin:15,bustDist:10,bustSpeed:1};const offences=[];traffic.hm={active:false,state:'idle',warningT:0,offence:(...a)=>offences.push(a),update:()=>[]};traffic.cars=[{active:true,police:true,vehicle:{x:100,y:6,z:110}}];traffic.crossedRed={};traffic.updatePolice(.1,{x:100,y:0,z:115,vLong:0,yaw:0});assert.equal(offences.length,0);traffic.cars[0].vehicle.y=0;traffic.crossedRed={};traffic.updatePolice(.1,{x:100,y:0,z:115,vLong:0,yaw:0});assert.deepEqual(offences[0],['red',.3,true]);assert.equal(traffic.crossedRed,null);
});

test('coast contact exposes water and independent tunnel asphalt to native Vehicle ground',()=>{
 const stream={contact:(x,z,{referenceY})=>x<0?{y:-2,layer:0,flags:0}:{y:referenceY>4?6:0,layer:referenceY>4?-1:0,flags:1}},g=new AthensGround(stream,{height:0},{},{});assert.equal(g.at(-1,0).surf,'water');assert.equal(g.at(-1,0).water,1.95);assert.equal(g.at(1,0).surf,'asphalt');g.referenceY=6;assert.equal(g.at(1,0).layer,-1);stream.contact=()=>null;assert.throws(()=>g.at(0,0),/Missing mandatory/);
});

test('concrete Riviera and Faros history excludes unknown versions, garden course, custom events and stale v2 wildcard copies',()=>{
 const known={mapId:'riviera',eventId:'quick',version:'4718fbec',time:300,car:'mini',date:'2026-10-20',setup:{map:'riviera',event:'quick',from:241,to:10548,direction:1}};
 assert.equal(recordIdentity(known).edition,'legacy-riviera-4718fbec');for(const row of [{...known,version:''},{...known,version:'unknown'},{...known,eventId:'custom',setup:undefined},{mapId:'psychiko',eventId:'psychiko-race',version:'653bca47:garden-v2',time:201}])assert.equal(recordIdentity(row),null);
 const garden={mapId:'psychiko',eventId:'psychiko-race',version:'653bca47:garden-v2',time:201},stale={...garden,identity:{routeId:'psychiko-faros',edition:'legacy-psychiko:653bca47:garden-v2',compatibility:'historical'},migration:{version:2,id:'stale',key:'garden',original:garden}};
 assert.deepEqual(routeHistory([stale],'psychiko-faros'),[]);const rows=migrateRouteRecords([known],{source:'fixture'});assert.deepEqual(migrateRouteRecords(rows),rows);assert.deepEqual(rows[0].migration.original,known);assert.equal(routeHistory(rows,'riviera-coast',{edition:'other'}).length,0);
 const values=new Map([['paraliaki.personalBests.v2',JSON.stringify({version:2,exact:{},routes:{},history:{stale,...Object.fromEntries(rows.map(r=>[r.migration.id,r]))}})]]),store={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};assert.equal(getRouteHistoricalTimes('psychiko-faros',store).length,0);assert.equal(getRouteHistoricalTimes('riviera-coast',store).length,1);assert.equal(getRouteHistoricalTimes('riviera-coast',store,{edition:'other'}).length,0);
 assert.equal(historicalGhostIdentity({trackVersion:'4718fbec',type:'sprint',routeKey:'241>10548'}).routeId,'riviera-coast');assert.equal(historicalGhostIdentity({trackVersion:'4718fbec',type:'sprint',routeKey:'10548>241'}),null);
});

test('validated route setup variants finish under their concrete event and retain independent PB setup keys',async()=>{
 const {RouteRuntime}=await import('../src/route-runtime.js'),{EventRun}=await import('../src/events.js'),{personalBestSetup,exactBestKey}=await import('../src/personal-bests.js');const f=fixture(),compiled=await compileRoute(f.definition,f.graph,f.contacts),route=new RouteRuntime(compiled),base=routeEvent(compiled),def=applySetup(base,{rivals:0,traffic:2,police:true,policeLevel:'tough',time:'night',weather:'rain'}),st={getItem:()=>null,setItem:()=>{}};assert.equal(def.custom,true);const run=new EventRun(def,{route,marks:[]},{storage:st,car:'z4'});run.start();let done;for(let s=0;s<=960;s+=2.5){const fr=route.frame(s),p={...route.point(s),s,t:s/25+.1,yaw:fr.yaw,layer:fr.layer,surfaceId:fr.surfaceId};done=run.update(.1,p).find(e=>e.kind==='finish');if(done)break;}assert.ok(done);const result=run.finish({time:done.time});assert.equal(result.eventId,base.id);assert.equal(result.valid,true);const setup=personalBestSetup({mapId:'athens',def,route:run.r,car:'z4'});assert.equal(setup.traffic,2);assert.equal(setup.police,true);assert.equal(setup.weather,'rain');assert.notEqual(exactBestKey(setup),exactBestKey({...setup,traffic:0}));
});

test('bore walls occlude police sight while low coast rails and an independent deck do not',async()=>{
 const {WorldTileBarriers}=await import('../src/world-tile-barriers.js');const b=new WorldTileBarriers();b.install('coast',{metadata:{origin:[512,0,512],safetyRails:[[0,10,-20,0,10,20,.65]]}});const a={x:500,y:11,z:512},c={x:524,y:11,z:512};assert.equal(b.lineBlocked(a,c),false);b.remove('coast');b.install('bore',{metadata:{origin:[512,0,512],safetyRails:[[0,10,-20,0,10,20,3.6]]}});assert.equal(b.lineBlocked(a,c),true);assert.equal(b.lineBlocked({...a,y:5},{...c,y:5}),false);b.remove('bore');assert.equal(b.lineBlocked(a,c),false);
});

test('historical aliases never infer concrete event ids from a custom-event storage key or partial Riviera timing',()=>{
 assert.equal(recordIdentity({bestTime:200},{key:'paraliaki.events.psychiko-race-custom.faros-v3'}),null);
 assert.equal(recordIdentity({bestTime:200,trackVersion:'4718fbec'},{key:'paraliaki.events.quick~rev'}),null);
 assert.equal(recordIdentity({mapId:'riviera',eventId:'quick',version:'4718fbec',setup:{from:300,to:700}}),null);
 assert.equal(recordIdentity({mapId:'riviera',eventId:'quick',version:'4718fbec',routeKey:'10548>241'}).direction,-1);
});

test('Riviera replays the emitted staging proof deterministically, retains the layer −1 bore and refuses its wrong fork',async()=>{
 const {readRouteInputs}=await import('./route-input.mjs'),{mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const shard=JSON.parse(await readFile(new URL('../data/routes/validation/athens.inputs.json',import.meta.url))),definition=JSON.parse(await readFile(new URL('../data/routes/riviera-coast.route.json',import.meta.url))),dir=await mkdtemp(join(tmpdir(),'athens-riviera-proof-'));try{const world=join(dir,'manifest.json');await writeFile(world,JSON.stringify({revision:shard.worldSetRevision,tiles:shard.cells}));const input=await readRouteInputs({world,graph:new URL('../data/routes/validation/athens.inputs.json',import.meta.url)}),first=await compileRoute(definition,input.graph,input.contacts),second=await compileRoute(definition,input.graph,input.contacts);assert.deepEqual(first,second);assert.ok(Math.abs(first.lengthM-10337.229708621433)<.001);const bore=first.occurrences.find(o=>o.edgeId.startsWith('osm:way:25371523:'));assert.equal(bore.layer,-1);assert.ok(first.decisions.some(d=>d.rejected.length));assert.equal(first.grid.length,3);assert.ok(first.runOut.length>30);
 const ids=[...definition.path.edges],fork=first.decisions.find(d=>d.rejected.length&&ids.indexOf(d.toEdge)>0),i=ids.indexOf(fork.toEdge);assert.ok(i>0);ids[i]=fork.rejected[0];await assert.rejects(compileRoute({...definition,path:{edges:ids}},input.graph,input.contacts));
 }finally{await rm(dir,{recursive:true,force:true});}
});


function stalledTraffic(){
 const edge={id:'road',points:[[0,0,0],[0,0,100]],layer:0},session={safePose:()=>true},traffic=new WorldTraffic(session,{}, {project:(x,z)=>({s:z,u:x})});
 const c={active:true,crashed:true,v:0,len:4,wid:2,vehicle:{x:1,y:0,z:50,yaw:Math.PI,vLong:8,vLat:2,w:1},m:{root:{visible:true}}};
 traffic.cars=[c];traffic.candidate=()=>({x:0,y:0,z:50,yaw:Math.PI,edge:'road'});
 return {traffic,c,edge};
}
test('graph traffic settles and rejoins its nearest lane gradually, without a visible snap',()=>{
 const {traffic:t,c,edge}=stalledTraffic();
 for(let i=0;i<39;i++){t.t+=.1;t.recover(c,edge,.1,[]);assert.equal(c.vehicle.x,1);}
 for(let i=0;i<40&&c.crashed;i++){const x=c.vehicle.x;t.t+=.1;t.recover(c,edge,.1,[]);assert.ok(Math.abs(c.vehicle.x-x)<=.071);}
 assert.equal(c.crashed,false);assert.ok(c.vehicle.x<.05);assert.equal(c.vehicle.vLat,0);assert.equal(c.vehicle.w,0);assert.equal(c.vehicle.vLong,0);assert.equal(c.s,50);
});
test('graph traffic recovery respects live contacts, other cars, safe poses and missing lanes',()=>{
 for(const block of ['contact','car','unsafe','missing']){
  const {traffic:t,c,edge}=stalledTraffic();c.recoveryT=8;
  if(block==='unsafe')t.session.safePose=()=>false;if(block==='missing')t.candidate=()=>null;
  for(let i=0;i<60;i++){t.t+=.1;if(block==='contact')c.contactAt=t.t;t.recover(c,edge,.1,block==='car'?[{x:0,y:0,z:50,halfL:2}]:[]);}
  assert.equal(c.crashed,true,block);assert.equal(c.vehicle.x,1,block);
 }
});
test('graph traffic never recovers through another road layer or a distant lane',()=>{
 for(const p of [{x:20,y:0,z:50,yaw:Math.PI},{x:0,y:5,z:50,yaw:Math.PI}]){
  const {traffic:t,c,edge}=stalledTraffic();c.recoveryT=8;t.candidate=()=>p;t.recover(c,edge,.1,[]);assert.equal(c.vehicle.x,1);assert.equal(c.crashed,true);
 }
});

import {Traffic} from '../src/traffic.js';
function graphQueue(speed=8,gap=20){
 const edge={id:'lane',from:'a',to:'b',points:[[0,0,0],[0,0,1000]],speedKph:60,layer:0},graph={edges:new Map([['lane',{value:edge}]]),outgoing:new Map(),legal:()=>true};
 const t=new WorldTraffic({roads:{graph,width:()=>({left:3,right:3,width:6})},props:{hold:()=>false},safePose:()=>true},{},{project:(x,z)=>({s:z,u:x})}),mesh={isMesh:true,onBeforeRender(){}};
 const c={active:true,crashed:false,len:4,wid:2,v:speed,offset:100,point:{edge:'lane'},vehicle:{x:0,y:0,z:100,yaw:Math.PI,vLong:speed,vLat:0,w:0,halfL:2,halfW:1},drv:{a:1.8,b:3,T:1.2,s0:2.2,vf:1},m:{root:{visible:true,traverse:fn=>fn(mesh)}}};
 t.pool={idm:Traffic.prototype.idm};t.cars=[c];t.spawnT=100;t.candidate=(_e,s)=>({x:0,y:0,z:s,yaw:Math.PI,edge:'lane'});
 const leader={x:0,y:0,z:104+gap,yaw:Math.PI,vLong:0,vLat:0,halfL:2,halfW:1};return {t,c,leader,edge,mesh};
}
test('streamed traffic brakes for normal queues and cannot push through a sudden close blockage',()=>{
 for(const [speed,gap] of [[8,20],[15,8]]){const {t,c,leader}=graphQueue(speed,gap);let minimum=gap;
  for(let i=0;i<2400;i++){t.update(1/240,{x:200,y:0,z:100},[leader]);minimum=Math.min(minimum,leader.z-c.vehicle.z-4);}
  assert.ok(minimum>=.349);assert.equal(c.v,0);assert.equal(c.vehicle.vLong,0);
 }
});
test('streamed traffic ignores a stopped leader on a stacked bridge',()=>{
 const {t,c,leader}=graphQueue();leader.y=6;
 for(let i=0;i<1200;i++)t.update(1/240,{x:200,y:0,z:100},[leader]);
 assert.ok(c.v>8);assert.ok(c.vehicle.z>leader.z);
});
test('streamed traffic arms a timer for missing candidates and dead ends, and recycles only after unseen',()=>{
 for(const failure of ['candidate','successor']){const {t,c,mesh}=graphQueue();if(failure==='candidate')t.candidate=()=>null;else{c.offset=c.vehicle.z=999.99;}
  const player={x:100,y:0,z:c.vehicle.z};
  for(let i=0;i<100;i++){t.update(.1,player,[]);mesh.onBeforeRender();assert.equal(c.active,true,failure);}
  assert.ok(c.blockedAt!=null);assert.equal(c.vehicle.vLong,0);
  for(let i=0;i<25;i++)t.update(.1,player,[]);
  assert.equal(c.active,false,failure);assert.equal(c.m.root.visible,false);
 }
});
test('streamed traffic retires far-displaced, invalid-lane and paired wrecks without moving visible bodies',()=>{
 for(const failure of ['far','missing','pair']){const {traffic:t,c,edge}=stalledTraffic();c.visibilityTracked=true;c.lastSeenAt=0;c.recoveryT=9;t.t=20;
  if(failure==='far')t.candidate=()=>({x:20,y:0,z:50,yaw:Math.PI});if(failure==='missing')t.candidate=()=>null;
  if(failure==='pair')t.cars.push({...c,vehicle:{...c.vehicle,x:2},m:{root:{visible:true}}});
  for(const car of t.cars)t.recover(car,edge,.1,[]);
  assert.ok(t.cars.every(car=>!car.active));assert.equal(c.vehicle.x,1);
 }
});
test('rendered traffic including mirrors stays protected, and nearby actors protect unseen wrecks',()=>{
 const {t,c,mesh,edge}=graphQueue();let previous=0;mesh.onBeforeRender=()=>previous++;t.watchVisibility(c);c.crashed=true;c.recoveryT=9;t.t=20;t.candidate=()=>null;mesh.onBeforeRender();
 t.recover(c,edge,.1,[]);assert.equal(c.active,true);assert.equal(previous,1);
 t.t=23;t.recover(c,edge,.1,[{x:0,y:0,z:105}]);assert.equal(c.active,true);
 t.recover(c,edge,.1,[]);assert.equal(c.active,false);
});
test('graph traffic recovery can gently separate an existing overlap and does not confuse adjacent lanes',()=>{
 const {traffic:t,c,edge}=stalledTraffic();c.recoveryT=5;
 t.cars.push({active:true,vehicle:{x:3,y:0,z:50,yaw:Math.PI,halfW:1,halfL:2,vLong:0,vLat:0}});
 t.recover(c,edge,.1,[]);assert.ok(c.vehicle.x<1,'reducing an existing overlap is permitted');
});
test('streamed traffic yields its proposed footprint at a crossing junction',()=>{
 const {t,c}=graphQueue();const crossing={x:3,y:0,z:103,yaw:Math.PI/2,halfL:3,halfW:1,vLong:0,vLat:0};
 t.update(.1,{x:100,y:0,z:100},[crossing]);assert.equal(c.vehicle.z,100);assert.equal(c.vehicle.vLong,0);assert.ok(c.blockedAt!=null);
});

test('rendered traffic beyond the old distance cutoff remains visible until it is actually unseen',()=>{
 const {t,c,mesh}=graphQueue(),player={x:700,y:0,z:100};
 for(let i=0;i<30;i++){t.update(.1,player,[]);mesh.onBeforeRender();assert.equal(c.active,true);}
 for(let i=0;i<25;i++)t.update(.1,player,[]);
 assert.equal(c.active,false);
});

test('free-world red crossing uses every loaded physical head rather than a competitive route projection',()=>{
 const {signals,session}=signalFixture();signals.route={isFreeWorldRoute:true,project:()=>({s:0,u:10000})};signals.update();assert.equal(signals.J.length,1);const a={x:100,y:0,z:112,yaw:0,halfL:0,layer:0,surfaceId:'road-a'},b={...a,z:106};assert.ok(signals.crossed(a,b));assert.equal(signals.crossed({...a,layer:1},{...b,layer:1}),null);session.props.time=10;signals.update();assert.equal(signals.crossed(a,b),null);
});
