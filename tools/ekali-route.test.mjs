import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolveEkaliSourcePath,authorEkaliRoute} from './author-ekali-route.mjs';
import {compileRoute} from '../src/route-compile.js';

const review={traversals:[{partId:'w1:0',direction:1,from:'a',to:'b',public:true},{partId:'w2:0',direction:1,from:'b',to:'a',public:true}]};
function graph(){
 const values=[{id:'osm:way:1:0-0:f:0:0',from:'osm:node:a',to:'osm:node:b',points:[[0,0,0],[0,0,-10]],flags:0,layer:0,surface:'surface:w1:0'},{id:'osm:way:2:0-0:f:0:0',from:'osm:node:b',to:'osm:node:a',points:[[0,0,-10],[0,0,0]],flags:0,layer:0,surface:'surface:w2:0'}];
 return {edges:new Map(values.map(value=>[value.id,{value}])),outgoing:new Map(values.map(e=>[e.from,new Set([e.id])])),legal:()=>true};
}

test('Ekali source replay uses unique directed emitted edges and a legal closure',()=>{
 assert.deepEqual(resolveEkaliSourcePath(graph(),review),['osm:way:1:0-0:f:0:0','osm:way:2:0-0:f:0:0']);
 const g=graph();g.legal=(from,to)=>!(from.startsWith('osm:way:2:')&&to.id.startsWith('osm:way:1:'));assert.throws(()=>resolveEkaliSourcePath(g,review),/ekali-source-closure/);
});
test('Ekali source replay cannot invent a disconnected link or reverse a one-way',()=>{
 const g=graph();g.outgoing.delete('osm:node:b');assert.throws(()=>resolveEkaliSourcePath(g,review),/ekali-source-disconnected/);
 const wrong=structuredClone(review);wrong.traversals[0].direction=-1;assert.throws(()=>resolveEkaliSourcePath(graph(),wrong),/ekali-source-disconnected/);
 const forbidden=graph();forbidden.edges.get('osm:way:1:0-0:f:0:0').value.flags=8;assert.throws(()=>resolveEkaliSourcePath(forbidden,review),/ekali-source-disconnected/);
});
test('Ekali source replay rejects ambiguous physical part paths and invalid review closure',()=>{
 const g=graph(),value={...g.edges.get('osm:way:1:0-0:f:0:0').value,id:'osm:way:1:0-1:f:0:0'};g.edges.set(value.id,{value});g.outgoing.get(value.from).add(value.id);assert.throws(()=>resolveEkaliSourcePath(g,review),/ekali-source-ambiguous/);
 const broken=structuredClone(review);broken.traversals[1].to='elsewhere';assert.throws(()=>resolveEkaliSourcePath(graph(),broken),/ekali-source-invalid-review/);
});
test('reviewed Ekali roundabout follows implicit forward one-way and preserves source identity',async()=>{
 const source=JSON.parse(await readFile(new URL('./maps/ekali/source-review.json',import.meta.url)));
 assert.equal(source.sourceSha256,'6b3a65219bc0f2d94603b867c5da7e94db16e9160d6112f39ea9c9677dfdca33');
 assert.equal(source.candidateWayVersions['44130959'].tags.junction,'roundabout');
 const roundabout=source.traversals.filter(t=>t.partId.startsWith('w44130959:'));assert.equal(roundabout.length,12);assert.ok(roundabout.every(t=>t.direction===1&&t.public));assert.equal(roundabout[0].from,'560728633');assert.equal(roundabout.at(-1).to,'560728629');
 const border=source.boundaryParts['81720521'][0];assert.equal(border.id,'w81720521:41');assert.deepEqual(border.nodeRefs,['952161299','1030975284','7839198255','952160960']);assert.equal(border.publicBackward,false);
});

// A bounded development query snapshot, separate from the enabled root index.
// Final terrain/world publication must regenerate this proof and all route data.
let development;
async function ekali(){return development??=(async()=>{
 const [{readRouteInputs},{compileRoute},{RouteRuntime},definition]=await Promise.all([import('./route-input.mjs'),import('../src/route-compile.js'),import('../src/route-runtime.js'),readFile(new URL('../.scratch/kifissia-kefalari/ekali-development/ekali-circuit.route.json',import.meta.url)).then(JSON.parse)]);
 const input=await readRouteInputs({world:new URL('../.scratch/kifissia-kefalari/ekali-development/world.json',import.meta.url),graph:new URL('../.scratch/kifissia-kefalari/ekali-development/ekali.inputs.json',import.meta.url)}),compiled=await compileRoute(definition,input.graph,input.contacts);
 return {input,definition,compiled,route:new RouteRuntime(compiled)};
})();}

test('actual Ekali development proof compiles a closed legal course with three grids and full runouts',async()=>{
 const {definition,compiled,input,route}=await ekali();assert.equal(definition.regionId,'basin');assert.equal(definition.allowReverse,false);assert.equal(definition.path.edges.length,28);assert.equal(route.closed,true);assert.ok(Math.abs(compiled.lengthM-2118.0607743659916)<.001);assert.equal(compiled.grid.length,3);assert.deepEqual(compiled.cells,['17,-29','17,-30','18,-29','18,-30']);
 const {projectEdge}=await import('../src/route-geometry.js'),edge=input.graph.edges.get(definition.start.edgeId).value;
 const runInAt=projectEdge(edge,compiled.runIn[0][0],compiled.runIn[0][2]).offsetM,runOutAt=projectEdge(edge,compiled.runOut.at(-1)[0],compiled.runOut.at(-1)[2]).offsetM;
 assert.ok(Math.abs(definition.start.offsetM-runInAt-80)<1e-6);assert.ok(Math.abs(runOutAt-definition.finish.offsetM-151)<1e-6);
 for(let i=0;i<compiled.grid.length;i++){const p=compiled.grid[i];assert.equal(p.layer,0);assert.equal(input.graph.edges.get(p.edgeId).value.name,'Πεύκων');if(i)assert.ok(Math.hypot(p.x-compiled.grid[i-1].x,p.z-compiled.grid[i-1].z)>7.9);}
 const wrong={...definition,path:{edges:[...definition.path.edges]}};wrong.path.edges[2]=definition.path.edges[8];await assert.rejects(compileRoute(wrong,input.graph,input.contacts),/disconnected-portal|illegal-successor/);
});
for(const eventId of ['ekali-race','ekali-tt'])test(`${eventId} needs two continuous laps and rejects shortcut completion`,async()=>{
 const {compiled,route}=await ekali(),{routeEvent}=await import('../src/route-events.js'),{EventRun}=await import('../src/events.js'),event=routeEvent(compiled,eventId),storage={getItem:()=>null,setItem:()=>{}},pose=(s,t)=>{const f=route.frame(s);return {...route.point(s),s,t,yaw:f.yaw,layer:f.layer,surfaceId:f.surfaceId};};
 assert.equal(event.laps,2);assert.equal(event.rivals,eventId==='ekali-race'?2:0);const run=new EventRun(event,{route,marks:[]},{storage,car:'mini'});run.start();let finish;
 for(let s=0;s<2*route.length+8;s+=2){finish=run.update(.1,pose(s,s/20+.1)).find(e=>e.kind==='finish');if(s<1.99*route.length)assert.equal(finish,undefined);if(finish)break;}
 assert.ok(finish);assert.equal(run.lapTimes.length,2);assert.equal(run.finish({time:finish.time}).valid,true);const cut=new EventRun(event,{route,marks:[]},{storage});cut.start();for(const s of [0,10,route.length-10,route.length+2,2*route.length+2])cut.update(.1,pose(s,s/20+.1));assert.equal(cut.course.finishedAt,null);
});
test('Ekali development fixture respects existing caps and is absent from enabled catalogues',async()=>{
 const receipt=JSON.parse(await readFile(new URL('../.scratch/kifissia-kefalari/ekali-development/source.json',import.meta.url))),root=JSON.parse(await readFile(new URL('../data/routes/validation/athens.inputs.json',import.meta.url))),config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url)));
 assert.equal(root.shards.length,3);assert.equal(receipt.rootIntegration.globalRootRebound,false);assert.ok(receipt.proofBytes<8*1024**2);assert.ok(receipt.rootIntegration.combinedNorthProofBytes<8*1024**2);assert.ok(receipt.rootIntegration.prospectiveRootCells<=128);
 for(const env of ['staging','production'])assert.ok(!config.env[env].vars.ASR_UNIFIED_ROUTES.split(',').includes('ekali-circuit'));
});

test('Ekali DEV definition stays outside complete production discovery and matches author output',async()=>{
 const fixture=new URL('../.scratch/kifissia-kefalari/ekali-development/',import.meta.url),receipt=JSON.parse(await readFile(new URL('production-inputs-before-after.json',fixture))),bytes=await readFile(new URL('ekali-circuit.route.json',fixture));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.definitionSha256);assert.equal(receipt.definitionMatchesAuthorOutput,true);
 const files=(await readdir(new URL('../data/routes/',import.meta.url))).filter(f=>f.endsWith('.route.json'));
 assert.equal(files.length,7);assert.deepEqual(files.sort(),receipt.productionInputs.map(p=>p.path.split('/').at(-1)).sort());
 assert.ok(!files.includes('ekali-circuit.route.json'));
 await assert.rejects(authorEkaliRoute({world:'unused',cells:'unused',out:new URL('../data/routes/',import.meta.url).pathname}),/outside production route discovery/);
});
