import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Route} from '../src/map.js';
import {EventRun} from '../src/events.js';
import {RIVIERA_TUNNELS} from '../src/maps/riviera-tunnels.js';
import {buildCourse,observeCourse,courseComplete} from '../src/course.js';
for(const id of ['riviera','penteli','megara']) {
 const data=JSON.parse(await readFile(new URL(id==='riviera'?'../data/map.json':`../data/maps/${id}/map.json`,import.meta.url)));
 const route=new Route(data.route,{corridors:id==='riviera'?RIVIERA_TUNNELS:[]});
 for(const reverse of [false,true])for(const rivals of [0,2])for(const traffic of [0,1])test(`${id} ${reverse?'reverse':'forward'} rivals=${rivals} traffic=${traffic}: ordered finish and exact timer`,()=>{
  const st={getItem(){return null},setItem(){}};
  const run=new EventRun({id:`${id}-test`,mapId:id,type:'sprint',from:reverse&&!route.closed?'finish':'start',to:reverse&&!route.closed?'start':'finish',reverse,laps:route.closed?3:1,rivals,traffic},{route,marks:data.marks},{storage:st,car:'mini'});
  run.start();let finish=null;const speed=40,dt=.05;
  for(let i=0;i<30000;i++){const d=-2+i*speed*dt,s=run.r.s0+run.r.dir*d,u=route.closed?0:run.r.dir*route.laneU(s,0),p=route.point(s,u);const e=run.update(dt,{...p,s,u,t:(i+1)*dt});finish=e.find(e=>e.kind==='finish');if(finish)break;if(d>run.r.len+20)break;}
  assert.ok(finish,'the whole route is tracked to a finish');assert.equal(run.sectorIdx,run.r.sectors.length);assert.equal(courseComplete(run.course),true);
  assert.ok(Math.abs(finish.time-(run.r.len+4)/speed)<.03,`${finish.time} vs ${(run.r.len+4)/speed}`);
  if(route.closed)assert.equal(run.lapTimes.length,3);
  run.finish({time:finish.time,valid:true});assert.deepEqual(run.update(1,{s:run.r.s1+100,t:999}),[]);assert.equal(run.result.time,finish.time);
 });
}
test('crossing the line off the road never grants a finish shortcut',()=>{const route={start:0,finish:200,length:200};const run=new EventRun({id:'skip',type:'sprint',from:'start',to:'finish'},{route,marks:[]},{storage:{getItem(){return null}}});run.start();for(const s of [40,90,160,220])assert.equal(run.update(1,{s,u:100,t:s/40}).some(e=>e.kind==='finish'),false);assert.equal(run.course.onRoute,false);assert.equal(courseComplete(run.course),false);});
test('interpolates the finish time between poses instead of using the end of a frame',()=>{const c=buildCourse({s0:0,s1:100,dir:1},{start:0,finish:100});observeCourse(c,{s:70,u:0},2);observeCourse(c,{s:110,u:0},3);assert.equal(c.finishedAt,2.75);});
