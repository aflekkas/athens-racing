import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './fixtures/routes/fixture.mjs';import{compileRoute}from'../src/route-compile.js';import{RouteRuntime}from'../src/route-runtime.js';import{planWorldTow}from'../src/tow-placement.js';
test('world tow prefers a route within 40 m, otherwise the nearest road',async()=>{const f=fixture(),r=new RouteRuntime(await compileRoute(f.definition,f.graph,f.contacts)),s=500,frame=r.frame(s),own={...r.point(s),yaw:frame.yaw,edgeId:frame.edgeId,layer:0,surfaceId:frame.surfaceId},other={...own,z:148,edgeId:'parallel',surfaceId:'parallel'},course={validProgress:490,lastRoad:{s:490}};let p=planWorldTow({pose:{x:own.x,z:130,y:0,yaw:frame.yaw,s},course,route:r,roadCandidates:[other,own]});assert.equal(p.edgeId,own.edgeId);p=planWorldTow({pose:{x:own.x,z:151,y:0,yaw:frame.yaw,s},course,route:r,roadCandidates:[other,own]});assert.equal(p.edgeId,'parallel');});
test('tow cannot go behind the latest valid pose, including a compiled run-in',async()=>{const f=fixture(),r=new RouteRuntime(await compileRoute(f.definition,f.graph,f.contacts)),frame=r.frame(-25),p={...r.point(-25),yaw:frame.yaw,edgeId:'preceding-runin',layer:0,surfaceId:frame.surfaceId};assert.equal(planWorldTow({pose:{...r.point(5,20),s:5,yaw:0},course:{validProgress:0,lastRoad:{s:0}},route:r,roadCandidates:[p]}),null);});

import {rememberTowHeading,towHeading} from '../src/tow-heading.js';
import {planTow} from '../src/tow-placement.js';
test('departure heading survives a spin, rest and reverse body yaw; velocity includes sideslip',()=>{
 const p={yaw:0,vLong:20,vLat:0,w:0};rememberTowHeading(p,true);p.yaw=Math.PI;p.vLong=0;rememberTowHeading(p,false);assert.equal(towHeading(p),0);
 p.vLong=15;p.w=2;rememberTowHeading(p,true);assert.equal(towHeading(p),0,'a spin on the tarmac cannot overwrite departure direction');
 p.w=0;p.vLong=-20;rememberTowHeading(p,true);assert.ok(Math.cos(towHeading(p))>.999,'reverse velocity, not body direction');
 const sliding={yaw:0,vLong:0,vLat:20};rememberTowHeading(sliding,true);assert.ok(Math.abs(towHeading(sliding)+Math.PI/2)<1e-9);
});
test('two-way directed edges choose pre-departure direction even when the reverse lane is nearer',()=>{
 for(const yaw of [0,Math.PI]){const pose={x:0,z:10,yaw:yaw+Math.PI,towHeading:yaw},forward={x:3,z:0,yaw,edgeId:'forward',roadId:'pair'},back={x:0,z:0,yaw:yaw+Math.PI,edgeId:'back',roadId:'pair'};
  assert.equal(planWorldTow({pose,roadCandidates:[back,forward]}).edgeId,'forward');}
});
test('one-way and divided carriageways keep legal direction even against departure heading',()=>{
 const pose={x:0,z:10,yaw:0,towHeading:Math.PI},legal={x:0,z:0,yaw:0,edgeId:'oneway'},opposite={x:20,z:0,yaw:Math.PI,edgeId:'separate-carriageway'};
 assert.equal(planWorldTow({pose,roadCandidates:[legal]}).yaw,0);
 assert.equal(planWorldTow({pose,roadCandidates:[legal,opposite]}).edgeId,'oneway');
});
test('route recovery faces race direction after a spin in both world and legacy planners',async()=>{
 const f=fixture(),r=new RouteRuntime(await compileRoute(f.definition,f.graph,f.contacts)),s=500,frame=r.frame(s),own={...r.point(s),yaw:frame.yaw,edgeId:frame.edgeId,layer:0,surfaceId:frame.surfaceId},reverse={...own,yaw:frame.yaw+Math.PI,edgeId:'reverse'};
 assert.equal(planWorldTow({pose:{...own,yaw:reverse.yaw,towHeading:reverse.yaw},course:{validProgress:490,lastRoad:{s:490}},route:r,roadCandidates:[reverse,own]}).edgeId,own.edgeId);
 const route={closed:false,length:1000,project:()=>({s:500,u:10}),centre:s=>({x:s,z:0,tx:1,tz:0}),edge:()=>5,pose:(s,d)=>({x:s,z:0,s,u:0,yaw:d>0?-Math.PI/2:Math.PI/2})};
 for(const dir of [1,-1])assert.equal(planTow({x:500,z:10,yaw:dir*Math.PI/2,route,course:{s0:dir>0?0:1000,dir,floor:100,ref:500}}).d,dir);
});
