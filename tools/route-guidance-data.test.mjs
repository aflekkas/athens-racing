import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './fixtures/routes/fixture.mjs';import {compileRoute} from '../src/route-compile.js';import {buildRouteGuidanceData} from '../src/route-guidance-data.js';
test('stable §7 guidance, left/right, endpoints and no portal arrows',async()=>{const f=fixture(),c=await compileRoute(f.definition,f.graph,f.contacts),a=buildRouteGuidanceData(c),b=buildRouteGuidanceData(c);assert.deepEqual(a,b);assert.equal(a.decisions.length,1);assert.equal(a.decisions[0].turn,'right');assert.deepEqual(a.decisions[0].rejectedEdges,['exit']);assert.equal(a.polyline[0].x,a.start.x);assert.equal(a.polyline.at(-1).s,a.finish.s);assert.equal(a.polyline.at(-1).z,a.finish.z);assert.ok(a.polyline.every(p=>Number.isFinite(p.leftM+p.rightM)&&typeof p.cell==='string'));});

test('a tight bend within one compiled edge gets paint without inventing a junction or progress gate',()=>{
 const c={schemaVersion:1,id:'curve',definition:{name:'Curve',kind:'sprint'},lengthM:200,
  points:[[0,0,0,0,4,4],[100,0,0,100,4,4],[100,0,100,200,4,4]],
  occurrences:[{s0:0,s1:200,edgeId:'curve',layer:0}],decisions:[],startPose:{x:0,y:0,z:0,yaw:-Math.PI/2},finishPose:{x:100,y:0,z:100,yaw:Math.PI}};
 const data=buildRouteGuidanceData(c);assert.equal(data.decisions.length,1);assert.equal(data.decisions[0].s,100);
 assert.equal(data.decisions[0].turn,'right');assert.deepEqual(data.decisions[0].rejectedEdges,[]);assert.deepEqual(c.decisions,[]);
});
