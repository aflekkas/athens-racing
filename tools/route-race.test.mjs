import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './fixtures/routes/fixture.mjs';import {compileRoute} from '../src/route-compile.js';import {RouteRuntime} from '../src/route-runtime.js';import {routeEvent} from '../src/route-events.js';import {EventRun,loadRecord} from '../src/events.js';import {crossTimingLine} from '../src/route-timing.js';
const storage=()=>({m:new Map(),getItem(k){return this.m.get(k)},setItem(k,v){this.m.set(k,v)}});
async function setup(){const f=fixture(),c=await compileRoute(f.definition,f.graph,f.contacts),route=new RouteRuntime(c),def=routeEvent(c),st=storage();route.contactAllowed=(q,p)=>q.layer===p.layer&&['road-a','road-b','road-c'].includes(p.surfaceId);return{route,def,st,run:new EventRun(def,{route,marks:[]},{storage:st,car:'z4'})};}
function pose(route,s,t){const f=route.frame(s);return{...route.point(s),s,t,u:0,yaw:f.yaw,layer:f.layer,surfaceId:f.surfaceId};}
test('green → continuous legal drive → interpolated finish → distinct saved pilot PB → restart',async()=>{const {route,def,st,run}=await setup();assert.deepEqual(run.update(.1,pose(route,5,.1)),[]);run.start();let finish;for(let s=0;s<=960;s+=2.5){const events=run.update(.1,pose(route,s,s/25+.1));finish ||= events.find(e=>e.kind==='finish');if(finish)break;}assert.ok(finish);assert.ok(Math.abs(finish.time-38.1)<.01);const result=run.finish({time:finish.time,valid:true});assert.equal(result.routeId,'fixture-race');assert.equal(loadRecord(def.recordId,st).bestTime,finish.time);assert.equal(loadRecord('riviera-sprint',st).bestTime,undefined);run.reset();assert.equal(run.started,false);assert.equal(run.course.reached,0);assert.equal(run.done,false);});
test('cut, fabricated s, parallel street, bridge layer and reverse cannot produce finish',async()=>{for(const kind of ['cut','claimed','parallel','layer','reverse']){const {route,run}=await setup();run.start();run.update(.1,pose(route,2,.1));for(let i=1;i<30;i++){const p=pose(route,kind==='claimed'?4:950,i*.1);if(kind==='claimed')p.s=100000;if(kind==='parallel')p.z+=12;if(kind==='layer'){p.y=12;p.layer=1;p.surfaceId='bridge';}if(kind==='reverse'){Object.assign(p,pose(route,-i*.1,i*.1));}assert.ok(!run.update(.1,p).some(e=>e.kind==='finish'),kind);}assert.equal(run.course.finishedAt,null,kind);}});
test('finite timing line interpolates and refuses backwards, side miss and wrong surface/layer',()=>{const line={x:0,y:0,z:0,yaw:0,layer:0,leftM:3,rightM:2,surfaceId:'a'},a={x:0,y:0,z:2,layer:0,surfaceId:'a',time:1},b={...a,z:-2,time:2};assert.equal(crossTimingLine(a,b,line).time,1.5);assert.equal(crossTimingLine(b,a,line),null);assert.equal(crossTimingLine({...a,x:4},{...b,x:4},line),null);assert.equal(crossTimingLine(a,{...b,layer:1},line),null);assert.equal(crossTimingLine(a,{...b,surfaceId:'b'},line),null);});
test('crossing a valid contact-label seam at the finish still finishes exactly once',async()=>{const {route,run}=await setup();run.start();let finishes=0;for(let s=0;s<=960;s+=2.5){const p=pose(route,s,s/25);if(s>940)p.surfaceId='road-b';finishes+=run.update(.1,p).filter(e=>e.kind==='finish').length;}assert.ok(finishes>0);const first=run.course.finishedAt;run.finish({time:first,valid:true});assert.deepEqual(run.update(.1,pose(route,949,40)),[]);assert.equal(run.course.finishedAt,first);});
test('an off-road shortcut has fixed rejoin debt; legitimate return restores progress',async()=>{const {route,run}=await setup();run.start();for(let s=0;s<=100;s+=2.5)run.update(.1,pose(route,s,s/25));let time=5;for(let s=100;s<=600;s+=5){const p=pose(route,s,time+=.1);p.x+=40;p.surfaceId='parallel';run.update(.1,p);}assert.ok(run.course.rejoinLimit<=102.01);run.update(.1,pose(route,600,time+=.1));assert.ok(run.course.reached<110);for(let s=600;s>=90;s-=5)run.update(.1,pose(route,s,time+=.1));assert.equal(run.course.rejoinLimit,undefined);for(let s=90;s<=200;s+=2.5)run.update(.1,pose(route,s,time+=.1));assert.ok(run.course.reached>190);});
test('a repeated-edge circuit finishes two laps exactly once; start-line dithering grants no lap',async()=>{const f=fixture();f.graph.edges.clear();f.graph.outgoing.clear();const pts=[[100,0,400],[100,0,100],[400,0,100],[400,0,400],[100,0,400]];for(let i=0;i<4;i++){const id='abcd'[i],e={id,from:'node'+i,to:'node'+((i+1)%4),points:[pts[i],pts[i+1]],surface:'circuit',layer:0,flags:1};f.graph.edges.set(id,{value:e});f.graph.outgoing.set(e.from,new Set([id]));}f.contacts.contact=()=>({y:0,flags:1,layer:0,surfaceId:'circuit'});f.contacts.surfaceAllowed=()=>true;const d={...f.definition,id:'fixture-circuit',kind:'circuit',lengthM:1200,laps:2,path:{edges:['a','b','c','d','a']},start:{edgeId:'a',offsetM:80,lateralM:0,yawRad:0},finish:{edgeId:'a',offsetM:80,lateralM:0,yawRad:0},sectorsM:[300,600,900]},compiled=await compileRoute(d,f.graph,f.contacts),route=new RouteRuntime(compiled),run=new EventRun(routeEvent(compiled),{route,marks:[]},{storage:storage()});run.start();for(let i=0;i<20;i++)assert.ok(!run.update(.1,pose(route,i%2?1:-1,i*.1)).some(e=>e.kind==='lap'));run.reset();run.start();let finish;for(let s=0;s<=2405;s+=2.5){finish=run.update(.1,pose(route,s,s/25+.1)).find(e=>e.kind==='finish');if(s<=1200)assert.equal(finish,undefined);if(finish)break;}assert.ok(finish);assert.equal(run.lapTimes.length,2);assert.ok(Math.abs(finish.time-96.1)<.02);run.finish({time:finish.time,valid:true});assert.deepEqual(run.update(.1,pose(route,2405,100)),[]);});

// Use the reviewed emitted graph for all six picker routes, including every lap.
// Centre, road edge and a brief kerb/shortcut profile all have to reach the result.
for (const id of ['syntagma-pilot','psychiko-faros','riviera-coast','penteli-hill','penteli-descent','megara-club']) {
 test(`${id}: Quick Race drives the actual route points through every split and finish`, async t => {
  const {readFile,mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {readRouteInputs,readRouteClosures}=await import('./route-input.mjs');
  const directory=await mkdtemp('/tmp/athens-finish-test-');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const shard=JSON.parse(await readFile(new URL('../data/routes/validation/athens.inputs.json',import.meta.url)));
  await writeFile(directory+'/world.json',JSON.stringify({revision:shard.worldSetRevision,tiles:shard.cells}));
  const input=await readRouteInputs({world:directory+'/world.json',graph:new URL('../data/routes/validation/athens.inputs.json',import.meta.url)});
  const definition=JSON.parse(await readFile(new URL(`../data/routes/${id}.route.json`,import.meta.url)));
  const closures=await readRouteClosures(new URL('../data/routes/',import.meta.url).pathname,definition);
  const compiled=await compileRoute(definition,input.graph,input.contacts,{closures});
  for(const profile of ['centre','edge','brief-excursion']) {
   const route=new RouteRuntime(compiled),run=new EventRun(routeEvent(compiled),{route,marks:[]},{storage:storage()});
   run.start();let finish;
   for(let s=0;;s=Math.min(s+4,run.r.len+8)) {
    const f=route.frame(s),excursion=profile==='brief-excursion'&&s>=80&&s<=120;
    const u=excursion?f.rightM+8:profile==='edge'?Math.min(3,f.rightM-.15):0;
    const p={...pose(route,s,s/30),...route.point(s,u)};
    if(excursion)p.surfaceId='verge';
    const events=run.update(4/30,p);
    finish=events.find(e=>e.kind==='finish');
    if(finish||s===run.r.len+8)break;
   }
   assert.ok(finish,`${profile}: ${JSON.stringify({reached:run.course.reached,marks:run.course.markTimes,invalid:run.course.firstInvalid})}`);
   assert.equal(run.splits.length,run.r.sectors.length,profile);
   assert.equal(run.lapTimes.length,route.closed?run.r.laps:0,profile);
   assert.ok(Math.abs(finish.time-run.r.len/30)<.3,`${profile}: interpolated finish`);
   run.finish({time:finish.time});
   assert.deepEqual(run.update(.1,pose(route,run.r.len+8,finish.time+.1)),[]);
  }
 });
}


test('a short roundabout chord and a verge crossing at the finish retain every timing split',async()=>{
 const {route,run}=await setup();run.start();let time=0;
 for(let s=0;s<=250;s+=5)run.update(.2,pose(route,s,time+=.2));
 // Cut the inside of the right-angle junction, then rejoin 100 m later.
 for(let i=1;i<=20;i++){
  const p={...pose(route,250+i*5,time+=.2),x:100+i*2.5,z:150-i*2.5,surfaceId:'verge'};
  run.update(.2,p);
 }
 for(let s=355;s<=960;s+=5){const f=route.frame(s),p={...pose(route,s,time+=.2),...route.point(s,s>=940?f.rightM+4:0)};if(s>=940)p.surfaceId='verge';const events=run.update(.2,p);if(events.some(e=>e.kind==='finish')){run.finish({time:events.at(-1).time});break;}}
 assert.ok(run.course.finishedAt!=null);assert.equal(run.splits.length,run.r.sectors.length);assert.equal(run.course.rejoinLimit,undefined);
});

test('a long excursion holds new progress gently, preserves earned distance and can be rejoined',async()=>{
 const {route,run}=await setup();run.start();for(let s=0;s<=100;s+=5)run.update(.2,pose(route,s,s/25));
 const earned=run.course.reached;let time=5;
 for(let i=0;i<60;i++){const p={...pose(route,100,time+=.25),...route.point(100,12),surfaceId:'verge'};run.update(.25,p);}
 assert.ok(run.course.rejoinLimit!=null);assert.equal(run.course.reached,earned);
 for(let s=100;s<=200;s+=5)run.update(.2,pose(route,s,time+=.2));
 assert.equal(run.course.rejoinLimit,undefined);assert.ok(run.course.reached>=199);
});
