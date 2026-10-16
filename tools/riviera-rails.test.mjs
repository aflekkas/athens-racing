import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Group} from 'three';
import {worldFixture} from './world-test-fixture.mjs';
import {ROAD,buildRoad} from '../src/road.js';
import {roadSurfaceSampler} from '../src/maps/penteli-ground.js';
import {RivalAI} from '../src/rival-ai.js';
import {Vehicle} from '../src/physics.js';
import {Ground} from '../src/ground.js';
import {DrivableCorridor} from '../src/drivable-corridor.js';
import {planRivieraRails,railDropHazard} from '../src/riviera-guardrails.js';
import {buildRivieraRails} from '../src/riviera-guardrail-mesh.js';

test('Riviera wide drop protection, access gaps, grounded meshes and sliding contact',async t=>{
 const {map,network,terrain}=await worldFixture('riviera');
 const {runs,samples}=planRivieraRails(map,terrain.heightC,network,ROAD),r=map.route;
 const pavement=roadSurfaceSampler(buildRoad(map,new Group(),terrain.heightC,{network,furniture:false}).group);
 assert.ok(railDropHazard([2.08,6.08,9.2]));assert.ok(!railDropHazard([.2,.4,.8]));
 const example=runs.find(run=>run.side===1&&run.pts.some(p=>p.s===2860));assert.ok(example,'reviewed missed drop at s=2860 receives protection');
 const ground=new Ground(map,terrain.heightC,{rails:runs,network}),corridor=new DrivableCorridor(r,network);
 for(const run of runs){assert.ok(run.pts.length>=7);for(const q of run.pts){
  assert.ok(r.urban(q.s)<.5);assert.ok(!network.mouth(q.s,run.side,8));assert.ok(!r.localLayout?.contains(q.s));
  assert.ok(!samples.find(p=>p.side===run.side&&p.s===q.s).blocked);
  assert.ok(q.u>r.edge(q.s)+1.9,'rails remain outside traffic/rival carriageway');
  const lim=ground.limits(q.s,1,{});assert.ok(lim.max>=r.edge(q.s)-1&&lim.min<=-r.edge(q.s)+1,'carriageway remains clear');
  assert.ok(corridor.distance(q.p.x,q.p.z)<6,'rail contact remains in safe corridor');
  const expected=r.surfaceY(q.s,run.side*(r.edge(q.s)+ROAD.gutter))+ROAD.curbH(r,q.s)+.02;assert.ok(Math.abs(q.p.y-expected)<1e-6);
  // Probe within the post foot, avoiding Float32 triangle-edge roundoff.
  const foot=r.point(q.s+.01,run.side*q.u);const rendered=pavement(foot.x,foot.z);assert.ok(rendered!==null&&Math.abs(rendered-q.p.y)<.04,`rail base meets rendered pavement at ${q.s}: ${rendered} vs ${q.p.y}`);
 }}
 const q=example.pts.find(q=>q.s===2860),f=r.frame(q.s,{}),p=r.point(q.s,q.u);
 const source=readFileSync(resolve(import.meta.dirname,'../src/cars.js'),'utf8');
 const specs=Function('return '+source.slice(source.indexOf('export const CARS = [')+'export const CARS = '.length).split('\n];')[0]+'\n];')();
 const v=new Vehicle(specs.find(s=>s.id==='mini'),r);v.reset(q.s,q.u,0);const yaw=v.yaw;
 // Production contact response: 3 m/s into the rail plus 20 m/s along it.
 const vx=f.tx*20+f.rx*3,vz=f.tz*20+f.rz*3;v.vLong=-Math.sin(yaw)*vx-Math.cos(yaw)*vz;v.vLat=Math.cos(yaw)*vx-Math.sin(yaw)*vz;
 ground.resolve(v,1/60);
 assert.ok(v.u<=ground.limits(v.s,v.halfW,{}).max+.001);
 const outX=-Math.sin(yaw)*v.vLong+Math.cos(yaw)*v.vLat,outZ=-Math.cos(yaw)*v.vLong-Math.sin(yaw)*v.vLat;
 assert.ok(outX*f.tx+outZ*f.tz>17);assert.ok(outX*f.rx+outZ*f.rz<=0);
 // Race the production controller and Ground through both newly protected bends.
 for(const start of [2760,8100]) {
  const racer=new Vehicle(specs.find(s=>s.id==='mini'),r);racer.ground=ground;racer.reset(start,r.laneU(start,0),0);
  const ai=new RivalAI(r,racer,{dir:1,closedRoad:false,driver:{id:'rails-check',racePace:1,aggression:.5,mistakeRate:0}});
  let hits=0;for(let i=0;i<60*70&&racer.s<start+500;i++){racer.wallHit=0;racer.update(1/60,ai.update(1/60,{racers:[],traffic:[],pace:1}));if(racer.wallHit>1)hits++;}
  assert.ok(racer.s>=start+500,`rival progresses through protected bend ${start}: ${racer.s}`);assert.equal(hits,0);
 }
 const group=new Group(),assets={network};buildRivieraRails(map,group,terrain.heightC,assets,ROAD);
 assert.equal(assets.rails.length,runs.length);for(const m of group.children){assert.ok(m.userData.far);if(!m.isInstancedMesh)assert.ok(m.userData.lod&&m.userData.dynamic&&m.boundingSphere);}
 t.diagnostic(JSON.stringify({...group.userData.guardrails,example:samples.find(q=>q.side===1&&q.s===2860)}));
 if(process.env.RAIL_EVIDENCE){const dir=resolve(import.meta.dirname,'../.scratch/riviera-rails');mkdirSync(dir,{recursive:true});writeFileSync(dir+'/placement.json',JSON.stringify({stats:group.userData.guardrails,runs:runs.map(a=>({side:a.side,pts:a.pts.map(q=>({s:q.s,u:q.u,x:q.p.x,y:q.p.y,z:q.p.z}))})),samples,route:Array.from({length:Math.ceil(r.length/10)},(_,i)=>{const p=r.point(i*10,0);return [p.x,p.z];})}));}
});
