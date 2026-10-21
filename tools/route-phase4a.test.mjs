import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {readRouteInputs} from './route-input.mjs';
import {compileRoute} from '../src/route-compile.js';
import {RouteRuntime} from '../src/route-runtime.js';
import {routeEvent} from '../src/route-events.js';
import {EventRun} from '../src/events.js';
import {recordIdentity,migrateRouteRecords,routeHistory,historicalEditionLabel,historicalGhostIdentity} from '../src/route-migrations.js';
import {getRouteHistoricalTimes} from '../src/personal-bests.js';
import {trackVersion} from '../src/network-track.js';
import {renderTrackTimes} from '../src/leaderboards-screen.js';
import {bindImportedBridgeEdges} from '../src/imported-bridge-graph.js';
import {roadLayersConnect} from '../src/world-tile-graph.js';
import {unifiedRouteConfig} from '../server/route-definitions.mjs';
const read=async p=>JSON.parse(await readFile(new URL('../'+p,import.meta.url)));

for(const id of ['penteli-hill','penteli-descent'])test(`${id}: immutable directed proof, bridges, full continuous timing and teleport rejection`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'athens-phase4a-test-'));try{
  const shard=await read('data/routes/validation/athens.inputs.json');await writeFile(join(dir,'world.json'),JSON.stringify({revision:shard.worldSetRevision,tiles:shard.cells}));
  const input=await readRouteInputs({world:join(dir,'world.json'),graph:new URL('../data/routes/validation/athens.inputs.json',import.meta.url)}),d=await read(`data/routes/${id}.route.json`),c=await compileRoute(d,input.graph,input.contacts),again=await compileRoute(d,input.graph,input.contacts);
  assert.deepEqual(c,again);assert.equal(c.regionId,'penteli');assert.ok(Math.abs(c.lengthM-9920.15898)<.001);assert.equal(d.path.edges.length,265);assert.equal(d.allowReverse,false);assert.equal(d.police,false);assert.equal(d.trafficLevel,0);assert.equal(c.grid.length,id==='penteli-hill'?3:1);assert.equal(new Set(c.occurrences.filter(o=>o.layer===1).map(o=>o.surfaceId)).size,2);
  assert.ok(d.path.edges.every(e=>e.endsWith(id==='penteli-hill'?':f':':r')));
  for(const event of c.definition.events){const route=new RouteRuntime(c),def=routeEvent(c,event.id),run=new EventRun(def,{route,marks:[]},{storage:{getItem:()=>null,setItem:()=>{}},car:'mini'});assert.equal(def.rivals,event.type==='sprint'?2:0);assert.equal(def.rules.police,false);run.start();let finish;for(let s=0;s<=c.lengthM+3;s+=2){const fr=route.frame(s);finish=run.update(.1,{...route.point(s),s,t:s/20+.1,yaw:fr.yaw,layer:fr.layer,surfaceId:fr.surfaceId}).find(e=>e.kind==='finish');if(finish)break;}assert.ok(finish);assert.equal(run.finish({time:finish.time}).valid,true);
   const jump=new EventRun(def,{route,marks:[]},{storage:{getItem:()=>null,setItem:()=>{}}});jump.start();for(const s of [0,10,c.lengthM-10,c.lengthM]){const f=route.frame(s);jump.update(.1,{...route.point(s),s,yaw:f.yaw,layer:f.layer,surfaceId:f.surfaceId});}assert.equal(jump.course.finishedAt,null);
  }
  const bad={...d,path:{edges:d.path.edges.map((e,i)=>i===40?e.replace(/:[fr]$/,id==='penteli-hill'?':r':':f'):e)}};await assert.rejects(compileRoute(bad,input.graph,input.contacts));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Penteli history binds only original signatures and legal event endpoints, preserving originals and separating direction',async()=>{
 const old=await read('data/maps/penteli/map.json');assert.equal(trackVersion(old.route),'33ed3ce1');
 for(const eventId of ['penteli-race','penteli-tt','penteli-descent-tt']){const descent=eventId==='penteli-descent-tt',routeId=descent?'penteli-descent':'penteli-hill',record={mapId:'penteli',eventId,version:'33ed3ce1',time:420.25,car:'mini',date:'2026-10-20',setup:{map:'penteli',event:eventId,from:descent?10188:292,to:descent?292:10188,direction:descent?-1:1,laps:1}};
  assert.equal(recordIdentity(record).routeId,routeId);const rows=migrateRouteRecords([record]);assert.deepEqual(rows[0].migration.original,record);assert.deepEqual(migrateRouteRecords(rows),rows);assert.equal(routeHistory(rows,routeId).length,1);assert.equal(routeHistory(rows,descent?'penteli-hill':'penteli-descent').length,0);
  for(const bad of [{...record,version:'unknown'},{...record,version:''},{...record,version:'33ed3ce1:unknown'},{...record,setup:{...record.setup,from:500}},{...record,setup:{...record.setup,direction:descent?1:-1}},{...record,routeKey:'400>600'}])assert.equal(recordIdentity(bad),null);
  const values=new Map([['paraliaki.personalBests.v1',JSON.stringify({version:1,exact:{[JSON.stringify(record.setup)]:record},routes:{}})]]),store={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};assert.equal(getRouteHistoricalTimes(routeId,store).length,1);assert.equal(getRouteHistoricalTimes(routeId,store).length,1);
  const html=renderTrackTimes({screen:'test'},{trackTimes:{loading:false,entries:[],history:rows,requested:true}},{routeId,historyEdition:rows[0].identity.edition});assert.ok(html.includes('Original Penteli road'));assert.doesNotMatch(html,/33ed3ce1|legacy-penteli/);
 }
 assert.equal(historicalEditionLabel('legacy-penteli-33ed3ce1'),'Original Penteli road');assert.equal(historicalGhostIdentity({trackVersion:'33ed3ce1',type:'timetrial',routeKey:'10188>292'}).routeId,'penteli-descent');assert.equal(historicalGhostIdentity({trackVersion:'33ed3ce1',type:'sprint',routeKey:'10188>292'}),null);
});

test('imported bridge compatibility requires the actual authenticated deck, contact surface and height',()=>{
 const tables={coarseHeights:new Float32Array(1089),contactPositions:new Float32Array([0,5,0,20,5,0,0,5,20]),contactTriangles:new Uint32Array([0,1,2,1,1]),contactLayers:new Int8Array([1]),finePositions:new Float32Array(),fineTriangles:new Uint32Array()},metadata={origin:[0,0,0],ids:['surface:roads','surface:124519741'],extensions:{worldDetail:{penteli:true}},structures:[{kind:'osm-bridge-guarded',layer:1,bridgeSources:[124519741]}]},base={id:'penteli:e:main:68:f',from:'start',to:'end',surface:'surface:roads',layer:1,flags:0,points:[[1,5,1],[5,5,1]]};
 const bind=(edge=structuredClone(base),m=structuredClone(metadata),t=tables)=>bindImportedBridgeEdges({metadata:m,tables:t},[edge])[0];const good=bind();assert.equal(good.flags,2);assert.equal(good.surface,'surface:124519741');assert.equal(roadLayersConnect({to:'start',flags:0,layer:0,points:[[0,0,0],base.points[0]]},good),true);
 for(const mutate of [m=>m.structures=[],m=>m.extensions={},m=>m.structures[0].bridgeSources=[999]]){const m=structuredClone(metadata);mutate(m);assert.equal(bind(undefined,m).flags,0);}
 assert.equal(bind({...base,points:[[1,6,1],[5,6,1]]}).flags,0);assert.equal(bind({...base,points:[[40,5,1],[45,5,1]]}).flags,0);assert.equal(bind({...base,id:'other-road'}).flags,0);
});

test('Penteli rollout independently gates each direction and stays off production',()=>{
 const routes=[{id:'penteli-hill'},{id:'penteli-descent'}];assert.deepEqual(unifiedRouteConfig({environment:'staging',enabled:'penteli-hill',routes}).routes.map(r=>r.id),['penteli-hill']);assert.deepEqual(unifiedRouteConfig({environment:'production',enabled:'penteli-hill,penteli-descent',routes}).routes.map(r=>r.id),['penteli-hill','penteli-descent']);
});

test('Penteli picker retains selected TT, independent setup keys, and marks the disconnected destination',async()=>{
 const {Menu}=await import('../src/menu.js'),hill=await read('data/routes/penteli-hill.route.json'),descent=await read('data/routes/penteli-descent.route.json');
 const events=hill.events.map(e=>routeEvent({id:hill.id,definition:{...hill,events:hill.events.map(e=>({...e,enabled:true,laps:1}))},regionId:'penteli',lengthM:hill.lengthM,geometryHash:'hash'},e.id));
 const menu={data:{mode:'quick'},h:{ctx:()=>({mapId:'athens',route:{isWorldRoute:true},events,eventId:'penteli-tt'})}};menu.eventsHere=()=>Menu.prototype.eventsHere.call(menu);menu.setupDef=()=>Menu.prototype.setupDef.call(menu);
 assert.equal(menu.setupDef().id,'penteli-tt');assert.equal(Menu.prototype.setupKey.call(menu),'penteli-tt');assert.equal(menu.setupDef().rivals,0);
 const priorDocument=globalThis.document;globalThis.document={getElementById:()=>({})};
 try { const html=Menu.prototype.r_routes.call({}, {catalogue:[{id:hill.id,name:hill.name,lengthM:hill.lengthM,regionId:'penteli',preview:[[0,0],[100,100]],events}, {id:descent.id,name:descent.name,lengthM:descent.lengthM,regionId:'penteli',preview:[[100,100],[0,0]],events:[{id:'penteli-descent-tt',laps:1,rivals:0}]}]});for(const id of [hill.id,descent.id])assert.ok(html.includes(`data-map-id="${id}"`));assert.doesNotMatch(html,/data-map-id="penteli"/); }finally{globalThis.document=priorDocument;}

});

test('regional proof siblings reject traversal, nested shards, stale releases and changed exact queries',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'athens-route-shards-'));try{const revision='a'.repeat(64),entry={sha256:'b'.repeat(64)},root={schemaVersion:1,worldSetRevision:revision,cells:{'0,0':entry},sourceHashes:[['0,0',entry.sha256]],edges:[],turns:[],proofs:{contact:{fixture:{y:0}},width:{},safe:{}},shards:['penteli.inputs.json']},extra={...root,proofs:{contact:{fixture:{y:0}},width:{},safe:{}}};delete extra.shards;
  const world=join(dir,'world.json'),graph=join(dir,'athens.inputs.json'),sibling=join(dir,'penteli.inputs.json');await writeFile(world,JSON.stringify({revision,tiles:root.cells}));await writeFile(graph,JSON.stringify(root));await writeFile(sibling,JSON.stringify(extra));assert.equal((await readRouteInputs({world,graph})).shard.worldSetRevision,revision);
  for(const bad of [{...extra,worldSetRevision:'c'.repeat(64)},{...extra,shards:[]},{...extra,proofs:{...extra.proofs,contact:{fixture:{y:1}}}}]){await writeFile(sibling,JSON.stringify(bad));await assert.rejects(readRouteInputs({world,graph}),/emitted-input-mismatch/);}
  await writeFile(graph,JSON.stringify({...root,shards:['../penteli.inputs.json']}));await assert.rejects(readRouteInputs({world,graph}),/emitted-input-mismatch/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
