import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as THREE from 'three';
import {readRouteInputs} from './route-input.mjs';
import {compileRoute} from '../src/route-compile.js';
import {RouteRuntime} from '../src/route-runtime.js';
import {routeEvent} from '../src/route-events.js';
import {EventRun} from '../src/events.js';
import {buildRouteCatalogue,unifiedRouteConfig} from '../server/route-definitions.mjs';
import {quickRaceTracks} from '../src/track-catalog.js';
import {RouteGuidance} from '../src/route-guidance.js';
import {buildRouteGuidanceData} from '../src/route-guidance-data.js';
import {athensDistricts} from '../src/spawn-spots.js';
const read=async p=>JSON.parse(await readFile(new URL('../'+p,import.meta.url)));
let fixture;
async function kifissia(){return fixture??= (async()=>{const dir=await mkdtemp(join(tmpdir(),'athens-kifissia-test-'));try{const root=await read('data/routes/validation/athens.inputs.json');await writeFile(join(dir,'world.json'),JSON.stringify({revision:root.worldSetRevision,tiles:root.cells}));const input=await readRouteInputs({world:join(dir,'world.json'),graph:new URL('../data/routes/validation/athens.inputs.json',import.meta.url)}),definition=await read('data/routes/kifissia-kefalari.route.json'),compiled=await compileRoute(definition,input.graph,input.contacts);return {input,definition,compiled,route:new RouteRuntime(compiled)};}finally{await rm(dir,{recursive:true,force:true});}})();}

test('Kifissia third proof sibling stays bounded, authenticates cells and rejects a fourth sibling',async()=>{
 const root=await read('data/routes/validation/athens.inputs.json');assert.equal(root.shards.length,3);
 for(const name of ['athens.inputs.json',...root.shards])assert.ok((await readFile(new URL('../data/routes/validation/'+name,import.meta.url))).length<=8*1024**2);
 const {compiled,input}=await kifissia();assert.equal(compiled.cells.length,7);for(const key of compiled.cells)assert.ok(input.manifest.tiles[key].sha256);
 const dir=await mkdtemp(join(tmpdir(),'athens-kifissia-limit-'));try{await writeFile(join(dir,'world.json'),JSON.stringify({revision:root.worldSetRevision,tiles:root.cells}));await writeFile(join(dir,'bad.json'),JSON.stringify({...root,shards:[...root.shards,'fourth.inputs.json']}));await assert.rejects(readRouteInputs({world:join(dir,'world.json'),graph:join(dir,'bad.json')}),/emitted-input-mismatch/);}finally{await rm(dir,{recursive:true,force:true});}
});

test('Kifissia is a closed legal OSM circuit with three safe grid poses and full runouts',async()=>{
 const {definition,compiled,input,route}=await kifissia();assert.equal(definition.kind,'circuit');assert.equal(definition.allowReverse,false);assert.equal(definition.path.edges.length,52);assert.equal(compiled.occurrences.length,108);assert.ok(Math.abs(compiled.lengthM-2926.566597800749)<.001);assert.equal(route.closed,true);assert.equal(compiled.grid.length,3);
 const distance=points=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,j)=>v-points[i][j])),0);
 assert.ok(distance(compiled.runIn)>=79.99);assert.ok(distance(compiled.runOut)>=150.99);
 for(const p of compiled.grid){const e=input.graph.edges.get(p.edgeId).value;assert.equal(e.flags&8,0);assert.ok(e.name==='Κοκκιναρά'||e.name==='Λεβίδου');}
 assert.ok(Math.hypot(compiled.startPose.x-compiled.finishPose.x,compiled.startPose.z-compiled.finishPose.z)<.01);
 const names=new Set(definition.path.edges.map(id=>input.graph.edges.get(id).value.name));for(const n of ['Λεβίδου','Κοκκιναρά','Χαριλάου Τρικούπη','Πεντέλης','Καποδιστρίου','Αλωνίων','Κασσαβέτη'])assert.ok(names.has(n));
 const illegal={...definition,path:{edges:[...definition.path.edges]}};illegal.path.edges[4]=definition.path.edges[12];await assert.rejects(compileRoute(illegal,input.graph,input.contacts),/disconnected-portal|illegal-successor/);
});

for(const eventId of ['kifissia-race','kifissia-tt'])test(`${eventId} requires two continuous complete laps and a shortcut cannot finish`,async()=>{
 const {compiled,route}=await kifissia(),def=routeEvent(compiled,eventId),storage={getItem:()=>null,setItem:()=>{}},pose=(s,t)=>{const f=route.frame(s);return {...route.point(s),s,t,yaw:f.yaw,layer:f.layer,surfaceId:f.surfaceId};};
 assert.equal(def.laps,2);assert.equal(def.rivals,eventId==='kifissia-race'?2:0);
 const run=new EventRun(def,{route,marks:[]},{storage,car:'mini'});run.start();let finish;
 for(let s=0;s<2*route.length+8;s+=2){finish=run.update(.1,pose(s,s/20+.1)).find(e=>e.kind==='finish');if(s<route.length*1.99)assert.equal(finish,undefined);if(finish)break;}
 assert.ok(finish);assert.equal(run.lapTimes.length,2);assert.equal(run.finish({time:finish.time}).valid,true);
 const cut=new EventRun(def,{route,marks:[]},{storage});cut.start();for(const s of [0,10,route.length-10,route.length+2,2*route.length+2])cut.update(.1,pose(s,s/20+.1));assert.equal(cut.course.finishedAt,null);
});

test('one Kifissia artifact supplies picker, race/TT, server and independent records',async()=>{
 const {compiled}=await kifissia(),entries=buildRouteCatalogue([compiled]),tracks=quickRaceTracks(entries),track=tracks.find(t=>t.id==='kifissia-kefalari');assert.ok(track);assert.equal(track.type,'circuit');assert.equal(track.eventId,'kifissia-race');assert.deepEqual(entries[0].events.map(e=>e.id),['kifissia-race','kifissia-tt']);assert.notEqual(entries[0].events[0].recordId,entries[0].events[1].recordId);
 for(const environment of ['staging','production']){const config=unifiedRouteConfig({environment,enabled:compiled.id,routes:entries});assert.equal(config.routes[0].geometryHash,compiled.geometryHash);assert.equal(config.routes[0].routeHash,compiled.routeHash);assert.equal(config.routes[0].worldSetRevision,compiled.worldSetRevision);}
});

test('Kefalari is a hosted free-roam area and race paint disappears in free roam',async()=>{
 const {compiled}=await kifissia(),districts=athensDistricts(new Set(compiled.cells));assert.ok(districts.some(d=>d.id==='athens:kefalari'));
 const scene=new THREE.Scene(),guidance=new RouteGuidance(scene);guidance.setRoute(buildRouteGuidanceData(compiled));guidance.onTileActivated('15,-22');guidance.update({cursorS:0,isRace:false});assert.equal(guidance.paint.mesh.visible,false);assert.equal(guidance.stats.instances,0);guidance.dispose();
});
